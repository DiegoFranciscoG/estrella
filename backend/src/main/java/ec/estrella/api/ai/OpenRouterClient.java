package ec.estrella.api.ai;

import ec.estrella.api.config.AppProperties;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The only code that talks to OpenRouter. It sends exactly what the service gives it, never logs
 * questions, answers or keys, and bounds every call in time and size.
 */
@Component
public class OpenRouterClient {

    /** An answer of a few hundred tokens weighs a few KB; anything far bigger is not an answer. */
    static final int MAX_RESPONSE_BYTES = 256 * 1024;
    private static final Pattern KEY = Pattern.compile("^sk-or-[A-Za-z0-9_-]{10,200}$");
    private static final ScheduledExecutorService WATCHDOG = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "openrouter-watchdog");
        t.setDaemon(true);
        return t;
    });

    public record Completion(String text, String model, boolean truncated) {
    }

    /** What went wrong, as OpenRouter's HTTP status, or one of the constants for no usable answer. */
    public static class OpenRouterException extends RuntimeException {

        /** No connection, or it broke. */
        public static final int NETWORK = 0;
        /** OpenRouter answered, but without any text. */
        public static final int EMPTY = -1;

        private final int status;
        private final Long retryAfterSeconds;

        OpenRouterException(int status, Long retryAfterSeconds) {
            super("OpenRouter status " + status, null, false, false);
            this.status = status;
            this.retryAfterSeconds = retryAfterSeconds;
        }

        public int status() {
            return status;
        }

        public Long retryAfterSeconds() {
            return retryAfterSeconds;
        }
    }

    private final AppProperties.Ai config;
    private final String referer;
    private final JsonMapper json = JsonMapper.builder().build();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    public OpenRouterClient(AppProperties properties) {
        this.config = properties.ai();
        this.referer = properties.publicUrl();
    }

    /** PKCE step 2: the single-use code and the verifier become the student's own key. */
    public String exchange(String code, String codeVerifier) {
        ObjectNode body = json.createObjectNode()
                .put("code", code)
                .put("code_verifier", codeVerifier)
                .put("code_challenge_method", "S256");
        String key = post("/auth/keys", null, body).path("key").asString("");
        if (!KEY.matcher(key).matches()) {
            throw new OpenRouterException(OpenRouterException.EMPTY, null);
        }
        return key;
    }

    /**
     * One question, no tools: the model can only answer with text. {@code allowProviderStorage}
     * false asks OpenRouter to use only providers that do not collect the data.
     */
    public Completion complete(String apiKey, String instructions, String message, boolean allowProviderStorage) {
        ObjectNode body = json.createObjectNode();
        ArrayNode models = body.putArray("models");
        config.models().forEach(models::add);
        ArrayNode messages = body.putArray("messages");
        messages.addObject().put("role", "system").put("content", instructions);
        messages.addObject().put("role", "user").put("content", message);
        body.put("max_tokens", config.maxOutputTokens());
        body.put("temperature", 0.3);
        body.putObject("provider").put("data_collection", allowProviderStorage ? "allow" : "deny");

        JsonNode answer = post("/chat/completions", apiKey, body);
        JsonNode choice = answer.path("choices").path(0);
        String text = choice.path("message").path("content").asString("");
        if (text.isBlank()) {
            throw new OpenRouterException(OpenRouterException.EMPTY, null);
        }
        return new Completion(text.strip(), answer.path("model").asString(""),
                "length".equals(choice.path("finish_reason").asString("")));
    }

    private JsonNode post(String path, String apiKey, ObjectNode body) {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(config.baseUrl() + path))
                .timeout(config.timeout())
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                // App attribution (OpenRouter docs): the student sees ESTRELLA in their own activity.
                .header("HTTP-Referer", referer)
                .header("X-OpenRouter-Title", "ESTRELLA")
                .POST(HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body)));
        if (apiKey != null) {
            request.header("Authorization", "Bearer " + apiKey);
        }
        long deadline = System.nanoTime() + config.timeout().toNanos();
        HttpResponse<InputStream> response;
        try {
            response = http.send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
        } catch (HttpTimeoutException e) {
            throw new OpenRouterException(408, null);
        } catch (IOException e) {
            throw new OpenRouterException(OpenRouterException.NETWORK, null);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new OpenRouterException(OpenRouterException.NETWORK, null);
        }
        byte[] bytes = readBefore(response.body(), deadline);
        JsonNode answer = parse(bytes);
        if (response.statusCode() != 200) {
            throw new OpenRouterException(response.statusCode(), retryAfter(response));
        }
        // An error after processing started arrives with status 200 and an "error" object.
        int embedded = answer.path("error").path("code").asInt(0);
        if (answer.path("error").isObject()) {
            throw new OpenRouterException(embedded >= 400 && embedded <= 599 ? embedded : 502, null);
        }
        return answer;
    }

    /** The request timeout only covers the headers; the watchdog also bounds reading the body. */
    private static byte[] readBefore(InputStream in, long deadlineNanos) {
        AtomicBoolean expired = new AtomicBoolean();
        long left = Math.max(1, deadlineNanos - System.nanoTime());
        ScheduledFuture<?> stop = WATCHDOG.schedule(() -> {
            expired.set(true);
            closeQuietly(in);
        }, left, TimeUnit.NANOSECONDS);
        try (in) {
            byte[] bytes = in.readNBytes(MAX_RESPONSE_BYTES + 1);
            if (bytes.length > MAX_RESPONSE_BYTES) {
                throw new OpenRouterException(502, null);
            }
            return bytes;
        } catch (IOException e) {
            throw new OpenRouterException(expired.get() ? 408 : OpenRouterException.NETWORK, null);
        } finally {
            stop.cancel(false);
        }
    }

    private JsonNode parse(byte[] bytes) {
        try {
            return bytes.length == 0 ? json.createObjectNode() : json.readTree(bytes);
        } catch (JacksonException e) {
            return json.createObjectNode();
        }
    }

    private static Long retryAfter(HttpResponse<?> response) {
        return response.headers().firstValue("Retry-After")
                .filter(v -> v.matches("^\\d{1,5}$"))
                .map(Long::parseLong)
                .map(s -> Math.min(s, 3600L))
                .orElse(null);
    }

    private static void closeQuietly(InputStream in) {
        try {
            in.close();
        } catch (IOException ignored) {
            // Closing only aborts the read; there is nothing else to clean up.
        }
    }
}
