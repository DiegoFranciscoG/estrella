package ec.estrella.api.support;

import com.jayway.jsonpath.JsonPath;
import ec.estrella.api.common.JsonSizeLimitFilter;
import ec.estrella.api.common.SignedProxyFilter;
import ec.estrella.api.mail.MailService;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.postgresql.PostgreSQLContainer;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Boots the whole API against a real PostgreSQL in a container, with outgoing email recorded. */
@SpringBootTest
@Import(IntegrationTest.MailConfig.class)
@ActiveProfiles("test")
public abstract class IntegrationTest {

    /**
     * One database for the whole run. Spring caches the application context across test classes,
     * so a per-class container would leave the cached context pointing at a stopped database.
     * Testcontainers' Ryuk removes it when the JVM ends.
     */
    @ServiceConnection
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18.6-alpine");

    static {
        POSTGRES.start();
    }

    /** OpenRouter on a local port, shared like the database so every test class reuses one context. */
    protected static final FakeOpenRouter OPENROUTER = FakeOpenRouter.start();

    private static final SecureRandom RANDOM = new SecureRandom();

    /** Secrets are generated per run so none is ever written in the repository. */
    @DynamicPropertySource
    static void runtimeProperties(DynamicPropertyRegistry registry) {
        registry.add("app.jwt-secret", () -> randomKey(48));
        registry.add("app.ai.key-secret", () -> randomKey(32));
        registry.add("app.ai.base-url", OPENROUTER::baseUrl);
        // Placeholders only; the service connection supplies the real container credentials.
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired
    protected WebApplicationContext context;

    @Autowired
    protected RecordingMailService mail;

    @Autowired
    protected JdbcClient jdbc;

    protected MockMvc mvc;

    @BeforeEach
    void setUpMvc() {
        // Same order as the running server: size check and proxy signature before security and controllers.
        mvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(context.getBean(JsonSizeLimitFilter.class), context.getBean(SignedProxyFilter.class))
                .apply(springSecurity()).build();
        mail.clear();
        OPENROUTER.clearScript();
    }

    protected static String randomKey(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return Base64.getEncoder().encodeToString(b);
    }

    protected static String uniqueEmail() {
        return "estudiante-" + System.nanoTime() + "@example.com";
    }

    public record Student(UUID id, String email, String authKey, String bearer) {
    }

    /**
     * Registers, confirms and signs in a new student from {@code ip}, as the app does.
     *
     * @param consents JSON strings of the purposes accepted at sign-up, for example {@code "ACCOUNT"}
     */
    protected Student signUp(String ip, String... consents) throws Exception {
        String email = uniqueEmail();
        String key = randomKey(32);
        RequestPostProcessor from = r -> {
            r.setRemoteAddr(ip);
            return r;
        };
        mvc.perform(post("/api/v1/auth/register").with(from).contentType(MediaType.APPLICATION_JSON).content("""
                {"email":"%s","authKey":"%s","ageConfirmed":true,"consents":[%s],
                 "keyBundle":{"kdfSalt":"%s","wrappedKeyPassword":"%s","wrappedKeyRecovery":"%s"}}
                """.formatted(email, key, String.join(",", consents), randomKey(16), randomKey(60), randomKey(60))))
                .andExpect(status().isAccepted());
        mvc.perform(post("/api/v1/auth/verify-email").with(from).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + mail.lastToken(email) + "\"}"))
                .andExpect(status().isOk());
        String body = mvc.perform(post("/api/v1/auth/login").with(from).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(email, key)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String token = JsonPath.read(body, "$.accessToken");
        UUID id = jdbc.sql("SELECT id FROM user_account WHERE email = :e").param("e", email).query(UUID.class).single();
        return new Student(id, email, key, "Bearer " + token);
    }

    @TestConfiguration
    public static class MailConfig {
        @Bean
        @Primary
        RecordingMailService recordingMailService() {
            return new RecordingMailService();
        }
    }

    /** Keeps the emails in memory so tests can follow the links, as a student would. */
    public static class RecordingMailService implements MailService {

        public record Sent(String kind, String to, String body) {
        }

        private static final Pattern TOKEN = Pattern.compile("token=([A-Za-z0-9_-]{43})");
        private final List<Sent> sent = new ArrayList<>();

        public synchronized void clear() {
            sent.clear();
        }

        public synchronized List<Sent> sent() {
            return List.copyOf(sent);
        }

        public synchronized String lastToken(String to) {
            for (int i = sent.size() - 1; i >= 0; i--) {
                Sent s = sent.get(i);
                Matcher m = TOKEN.matcher(s.body());
                if (s.to().equals(to) && m.find()) {
                    return m.group(1);
                }
            }
            throw new AssertionError("No email with a token was sent to " + to);
        }

        private synchronized void add(String kind, String to, String body) {
            sent.add(new Sent(kind, to, body));
        }

        @Override
        public void sendVerification(String to, String link) {
            add("verification", to, link);
        }

        @Override
        public void sendAlreadyRegistered(String to, String loginLink) {
            add("already-registered", to, loginLink);
        }

        @Override
        public void sendNewSession(String to, String device) {
            add("new-session", to, device);
        }

        @Override
        public void sendPasswordReset(String to, String link) {
            add("password-reset", to, link);
        }

        @Override
        public void sendAccountDeleted(String to) {
            add("deleted", to, "");
        }
    }
}
