package ec.estrella.api.mail;

import ec.estrella.api.config.AppProperties;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.util.HtmlUtils;
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
    private static final Pattern URL = Pattern.compile("https?://[^\\s<]+");

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final JsonMapper json = JsonMapper.builder().build();
    private final URI endpoint;
    private final String apiKey;
    private final String from;
    private final String publicUrl;

    @Autowired
    BrevoMailTransport(AppProperties properties) {
        this(properties.brevo().baseUrl(), properties.brevo().apiKey(), properties.mailFrom(), properties.publicUrl());
    }

    BrevoMailTransport(String baseUrl, String apiKey, String from, String publicUrl) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException("BREVO_API_KEY is required when APP_MAIL_PROVIDER=brevo");
        }
        this.endpoint = URI.create(baseUrl + "/smtp/email");
        this.apiKey = apiKey;
        this.from = from;
        this.publicUrl = publicUrl;
    }

    @Override
    public void send(String to, String subject, String text) {
        ObjectNode body = json.createObjectNode();
        body.putObject("sender").put("name", "ESTRELLA").put("email", from);
        body.putArray("to").addObject().put("email", to);
        body.put("subject", subject);
        body.put("textContent", text);
        body.put("htmlContent", html(text));
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

    /**
     * The same text as HTML: everything escaped and line breaks kept. Only links to this site become
     * clickable, so text that reached the email from elsewhere can never turn into a link.
     */
    String html(String text) {
        String escaped = HtmlUtils.htmlEscape(text);
        Matcher m = URL.matcher(escaped);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String url = m.group();
            String replacement = HtmlUtils.htmlUnescape(url).startsWith(publicUrl + "/")
                    ? "<a href=\"" + url + "\">" + url + "</a>"
                    : url;
            m.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        m.appendTail(out);
        return "<p>" + out.toString().replace("\n\n", "</p><p>").replace("\n", "<br>") + "</p>";
    }
}
