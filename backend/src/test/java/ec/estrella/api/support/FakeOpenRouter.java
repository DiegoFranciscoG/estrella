package ec.estrella.api.support;

import com.jayway.jsonpath.JsonPath;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Deque;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;

/**
 * OpenRouter as its documentation describes it, on a local port: the PKCE exchange
 * ({@code POST /api/v1/auth/keys}) and chat completions. Tests can script the next answer.
 */
public final class FakeOpenRouter {

    /** A chat request as it arrived; header names in lower case. */
    public record Request(Map<String, String> headers, String body) {
        public String header(String name) {
            return headers.get(name.toLowerCase(Locale.ROOT));
        }
    }

    private record Scripted(int status, String body, Map<String, String> headers, long delayMillis) {
    }

    private static final SecureRandom RANDOM = new SecureRandom();

    private final HttpServer server;
    private final Map<String, String> challengeByCode = new ConcurrentHashMap<>();
    private final Set<String> keys = ConcurrentHashMap.newKeySet();
    private final List<Request> chats = new CopyOnWriteArrayList<>();
    private final Deque<Scripted> scripted = new ConcurrentLinkedDeque<>();
    private volatile String lastKey;

    private FakeOpenRouter(HttpServer server) {
        this.server = server;
    }

    public static FakeOpenRouter start() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
            FakeOpenRouter fake = new FakeOpenRouter(server);
            server.createContext("/api/v1/auth/keys", fake::exchangeCode);
            server.createContext("/api/v1/chat/completions", fake::chat);
            server.setExecutor(Executors.newCachedThreadPool(r -> {
                Thread t = new Thread(r, "fake-openrouter");
                t.setDaemon(true);
                return t;
            }));
            server.start();
            return fake;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    public String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1";
    }

    /** What OpenRouter's /auth page does when the student authorizes: a single-use code tied to the challenge. */
    public String authorize(String codeChallenge) {
        String code = "code-" + HexFormat.of().formatHex(bytes(16));
        challengeByCode.put(code, codeChallenge);
        return code;
    }

    /** RFC 7636 S256: BASE64URL(SHA256(ASCII(verifier))) without padding. */
    public static String challengeFor(String verifier) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The key issued by the last successful exchange. */
    public String lastKey() {
        return lastKey;
    }

    /** As if the student deleted every key in their OpenRouter settings. */
    public void forgetKeys() {
        keys.clear();
    }

    /** Drops answers a failed test may have left scripted. */
    public void clearScript() {
        scripted.clear();
    }

    public void answerNext(int status, String body, Map<String, String> headers) {
        scripted.add(new Scripted(status, body, headers, 0));
    }

    public void delayNext(long millis) {
        scripted.add(new Scripted(0, null, Map.of(), millis));
    }

    public Request lastChat() {
        return chats.isEmpty() ? null : chats.get(chats.size() - 1);
    }

    public int chatCount() {
        return chats.size();
    }

    private void exchangeCode(HttpExchange ex) throws IOException {
        String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        if (!"POST".equals(ex.getRequestMethod())) {
            send(ex, 405, error(405, "Method Not Allowed"), Map.of());
            return;
        }
        String method = read(body, "$.code_challenge_method");
        String code = read(body, "$.code");
        String verifier = read(body, "$.code_verifier");
        if (!"S256".equals(method)) {
            send(ex, 400, error(400, "Invalid code_challenge_method"), Map.of());
            return;
        }
        String challenge = code == null ? null : challengeByCode.remove(code);
        if (challenge == null || verifier == null || !challenge.equals(challengeFor(verifier))) {
            send(ex, 403, error(403, "Invalid code or code_verifier"), Map.of());
            return;
        }
        String key = "sk-or-v1-" + HexFormat.of().formatHex(bytes(32));
        keys.add(key);
        lastKey = key;
        send(ex, 200, "{\"key\":\"" + key + "\",\"user_id\":\"user_fake\"}", Map.of());
    }

    private void chat(HttpExchange ex) throws IOException {
        String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        Map<String, String> headers = new ConcurrentHashMap<>();
        ex.getRequestHeaders().forEach((k, v) -> headers.put(k.toLowerCase(Locale.ROOT), String.join(",", v)));
        chats.add(new Request(Map.copyOf(headers), body));

        // Take everything scripted for this request now: a request still sleeping after its caller
        // gave up must not consume what a later test scripted.
        Scripted next = scripted.poll();
        long delay = 0;
        if (next != null && next.delayMillis() > 0) {
            delay = next.delayMillis();
            next = scripted.poll();
        }
        sleep(delay);
        if (next != null) {
            send(ex, next.status(), next.body(), next.headers());
            return;
        }
        String auth = headers.getOrDefault("authorization", "");
        if (!auth.startsWith("Bearer ") || !keys.contains(auth.substring(7))) {
            send(ex, 401, error(401, "User not found."), Map.of());
            return;
        }
        String question = read(body, "$.messages[1].content");
        String model = read(body, "$.models[0]");
        String answer = "1. Escribe REC en la línea de comandos.\\n2. Elige el borde. (Pregunta de "
                + (question == null ? 0 : question.length()) + " caracteres)";
        send(ex, 200, """
                {"id":"gen-test","model":"%s","choices":[{"index":0,"finish_reason":"stop",
                 "message":{"role":"assistant","content":"%s"}}],"usage":{"prompt_tokens":10,"completion_tokens":20}}
                """.formatted(model, answer), Map.of());
    }

    public static String error(int code, String message) {
        return "{\"error\":{\"code\":" + code + ",\"message\":\"" + message + "\"}}";
    }

    private static String read(String json, String path) {
        try {
            Object value = JsonPath.read(json, path);
            return value == null ? null : value.toString();
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static void send(HttpExchange ex, int status, String body, Map<String, String> headers) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        headers.forEach((k, v) -> ex.getResponseHeaders().set(k, v));
        ex.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
        try (var out = ex.getResponseBody()) {
            out.write(bytes);
        }
    }

    private static byte[] bytes(int n) {
        byte[] b = new byte[n];
        RANDOM.nextBytes(b);
        return b;
    }

    private static void sleep(long millis) {
        if (millis <= 0) {
            return;
        }
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
