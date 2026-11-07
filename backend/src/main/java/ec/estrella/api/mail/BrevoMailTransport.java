package ec.estrella.api.mail;

import ec.estrella.api.config.AppProperties;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Brevo's transactional email API over HTTPS (POST /smtp/email, api-key header, 201 on success).
 * For hosts that block SMTP ports, such as Render's free plan.
 */
@Component
@ConditionalOnProperty(name = "app.mail-provider", havingValue = "brevo")
class BrevoMailTransport implements MailTransport {

    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final JsonMapper json = JsonMapper.builder().build();
    private final URI endpoint;
    private final String apiKey;
    private final String from;

    @Autowired
    BrevoMailTransport(AppProperties properties) {
        this(properties.brevo().baseUrl(), properties.brevo().apiKey(), properties.mailFrom());
    }

    BrevoMailTransport(String baseUrl, String apiKey, String from) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException("BREVO_API_KEY is required when APP_MAIL_PROVIDER=brevo");
        }
        this.endpoint = URI.create(baseUrl + "/smtp/email");
        this.apiKey = apiKey;
        this.from = from;
    }

    @Override
    public void send(String to, String subject, String text, String html) {
        ObjectNode body = json.createObjectNode();
        body.putObject("sender").put("name", "ESTRELLA").put("email", from);
        body.putArray("to").addObject().put("email", to);
        body.put("subject", subject);
        body.put("textContent", text);
        body.put("htmlContent", html);
        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(TIMEOUT)
                .header("api-key", apiKey)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                .build();
        int status;
        try {
            status = http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
        } catch (IOException e) {
            throw new MailDeliveryException("Brevo unreachable: " + e.getClass().getSimpleName());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MailDeliveryException("Brevo call interrupted");
        }
        if (status / 100 != 2) {
            throw new MailDeliveryException("Brevo answered HTTP " + status);
        }
    }
}
