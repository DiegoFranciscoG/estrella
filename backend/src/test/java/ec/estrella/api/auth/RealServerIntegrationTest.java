package ec.estrella.api.auth;

import static org.assertj.core.api.Assertions.assertThat;

import ec.estrella.api.support.IntegrationTest;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * Behaviour that only the real embedded server shows (MockMvc has no Tomcat valves): which client
 * address the API believes behind proxies, and the hourly ceiling of emails for everyone together.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "app.mail-per-hour=3")
class RealServerIntegrationTest extends IntegrationTest {

    private final HttpClient http = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    private int post(String path, String json, String forwardedFor) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .header("Content-Type", "application/json")
                .header("X-Estrella-Client", "web")
                .header("X-Forwarded-For", forwardedFor)
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
        return http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
    }

    /**
     * Behind a proxy, the address is the one the closest trusted proxy saw. A client that writes its own
     * X-Forwarded-For only adds entries at the left, which the server ignores: it cannot pose as a
     * new address to get more guesses (OWASP API2/API4). This failed with the previous configuration.
     */
    @Test
    void anAddressWrittenByTheClientIsIgnored() throws Exception {
        String bad = "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(uniqueEmail(), randomKey(32));
        for (int i = 0; i < AttemptLimiter.FREE_FAILURES; i++) {
            assertThat(post("/api/v1/auth/login", bad, "198.51.100.7")).isEqualTo(401);
        }
        // Same student behind the same proxy, now claiming to be someone else: still slowed down.
        assertThat(post("/api/v1/auth/login", bad, "203.0.113.9, 198.51.100.7")).isEqualTo(429);
        // A really different address is a different person (a classmate in another place).
        assertThat(post("/api/v1/auth/login", bad, "198.51.100.8")).isEqualTo(401);
    }

    /** OWASP API6: even from many addresses and inboxes, emails per hour have a ceiling. */
    @Test
    void emailsPerHourHaveACeilingForEveryone() throws Exception {
        for (int i = 1; i <= 3; i++) {
            assertThat(post("/api/v1/auth/resend-verification", "{\"email\":\"%s\"}".formatted(uniqueEmail()), "198.51.100." + (20 + i)))
                    .isEqualTo(202);
        }
        assertThat(post("/api/v1/auth/resend-verification", "{\"email\":\"%s\"}".formatted(uniqueEmail()), "198.51.100.30"))
                .isEqualTo(429);
    }
}
