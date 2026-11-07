package ec.estrella.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import ec.estrella.api.support.IntegrationTest;
import jakarta.servlet.http.Cookie;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

class AuthFlowIntegrationTest extends IntegrationTest {

    private static final AtomicInteger IP = new AtomicInteger(1);

    /** Each test acts from its own address so per-IP limits of one test do not leak into another. */
    private final String ip = "10.0." + (IP.get() / 250) + "." + (IP.getAndIncrement() % 250 + 1);

    private RequestPostProcessor fromIp() {
        return request -> {
            request.setRemoteAddr(ip);
            return request;
        };
    }

    private MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder builder, String body) {
        return builder.with(fromIp()).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private record Account(String email, String authKey) {
    }

    private String registerBody(String email, String authKey, String consents) {
        return """
                {"email":"%s","authKey":"%s","ageConfirmed":true,"consents":[%s],
                 "keyBundle":{"kdfSalt":"%s","wrappedKeyPassword":"%s","wrappedKeyRecovery":"%s"}}
                """.formatted(email, authKey, consents, randomKey(16), randomKey(60), randomKey(60));
    }

    private Account verifiedAccount(String consents) throws Exception {
        String email = uniqueEmail();
        String key = randomKey(32);
        mvc.perform(json(post("/api/v1/auth/register"), registerBody(email, key, consents)))
                .andExpect(status().isAccepted());
        String token = mail.lastToken(email);
        mvc.perform(json(post("/api/v1/auth/verify-email"), "{\"token\":\"" + token + "\"}"))
                .andExpect(status().isOk());
        return new Account(email, key);
    }

    private MvcResult login(Account account) throws Exception {
        return mvc.perform(json(post("/api/v1/auth/login"),
                        "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(account.email(), account.authKey())))
                .andExpect(status().isOk())
                .andReturn();
    }

    private static String accessToken(MvcResult result) throws Exception {
        return JsonPath.read(result.getResponse().getContentAsString(), "$.accessToken");
    }

    private static String bearer(MvcResult result) throws Exception {
        return "Bearer " + accessToken(result);
    }

    @Test
    void studentRegistersVerifiesAndSignsIn() throws Exception {
        Account account = verifiedAccount("\"ACCOUNT\",\"SECURITY_EMAIL\"");

        MvcResult result = mvc.perform(json(post("/api/v1/auth/login"),
                        "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(account.email().toUpperCase(), account.authKey()))
                        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/152"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(cookie().httpOnly("estrella_rt", true))
                .andExpect(cookie().secure("estrella_rt", true))
                .andExpect(cookie().path("estrella_rt", "/api/v1/auth"))
                .andExpect(jsonPath("$.email").value(account.email()))
                .andExpect(jsonPath("$.keys.wrappedKeyPassword").exists())
                .andReturn();
        assertThat(result.getResponse().getHeader("Set-Cookie")).contains("SameSite=Strict");
        assertThat(mail.sent()).anyMatch(s -> s.kind().equals("new-session") && s.body().equals("Chrome en Windows"));

        mvc.perform(get("/api/v1/me").header("Authorization", bearer(result)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(account.email()))
                .andExpect(jsonPath("$.storageQuotaBytes").value(52428800))
                .andExpect(jsonPath("$.consents", hasItem("SECURITY_EMAIL")));
    }

    @Test
    void newSessionEmailIsNotSentWithoutThatConsent() throws Exception {
        Account account = verifiedAccount("\"ACCOUNT\"");
        login(account);
        assertThat(mail.sent()).noneMatch(s -> s.kind().equals("new-session"));
    }

    @Test
    void registeringAnExistingEmailLooksIdenticalFromOutside() throws Exception {
        Account account = verifiedAccount("\"ACCOUNT\"");
        mail.clear();
        mvc.perform(json(post("/api/v1/auth/register"), registerBody(account.email(), randomKey(32), "\"ACCOUNT\"")))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.message", containsString("Si los datos son correctos")));
        assertThat(mail.sent()).singleElement().extracting(s -> s.kind()).isEqualTo("already-registered");
        login(account);
    }

    @Test
    void unknownEmailAndWrongPasswordGetTheSameAnswer() throws Exception {
        Account account = verifiedAccount("\"ACCOUNT\"");
        String unknown = mvc.perform(json(post("/api/v1/auth/login"),
                        "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(uniqueEmail(), randomKey(32))))
                .andExpect(status().isUnauthorized()).andReturn().getResponse().getContentAsString();
        String wrong = mvc.perform(json(post("/api/v1/auth/login"),
                        "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(account.email(), randomKey(32))))
                .andExpect(status().isUnauthorized()).andReturn().getResponse().getContentAsString();
        assertThat(unknown).isEqualTo(wrong);
    }

    @Test
    void unverifiedAccountCannotSignIn() throws Exception {
        String email = uniqueEmail();
        String key = randomKey(32);
        mvc.perform(json(post("/api/v1/auth/register"), registerBody(email, key, "\"ACCOUNT\"")))
                .andExpect(status().isAccepted());
        mvc.perform(json(post("/api/v1/auth/login"), "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(email, key)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("EMAIL_NOT_VERIFIED"));
    }

    @Test
    void verificationLinkWorksOnlyOnce() throws Exception {
        String email = uniqueEmail();
        mvc.perform(json(post("/api/v1/auth/register"), registerBody(email, randomKey(32), "\"ACCOUNT\"")))
                .andExpect(status().isAccepted());
        String body = "{\"token\":\"" + mail.lastToken(email) + "\"}";
        mvc.perform(json(post("/api/v1/auth/verify-email"), body)).andExpect(status().isOk());
        mvc.perform(json(post("/api/v1/auth/verify-email"), body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_TOKEN"));
    }

    @Test
    void repeatedFailuresLockTheLoginProgressively() throws Exception {
        Account account = verifiedAccount("\"ACCOUNT\"");
        String bad = "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(account.email(), randomKey(32));
        for (int i = 0; i < AttemptLimiter.FREE_FAILURES; i++) {
            mvc.perform(json(post("/api/v1/auth/login"), bad)).andExpect(status().isUnauthorized());
        }
        mvc.perform(json(post("/api/v1/auth/login"),
                        "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(account.email(), account.authKey())))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("TOO_MANY_ATTEMPTS"));
    }

    /** OWASP API2: someone who changes address on every attempt still gets only a few guesses per account. */
    @Test
    void guessingOneAccountStaysSlowFromManyAddresses() throws Exception {
        String bad = "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(uniqueEmail(), randomKey(32));
        for (int i = 0; i < AuthService.ACCOUNT_FREE_FAILURES; i++) {
            String address = "192.0.2." + (i + 1);
            mvc.perform(post("/api/v1/auth/login").with(r -> {
                r.setRemoteAddr(address);
                return r;
            }).contentType(MediaType.APPLICATION_JSON).content(bad)).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/v1/auth/login").with(r -> {
            r.setRemoteAddr("192.0.2.200");
            return r;
        }).contentType(MediaType.APPLICATION_JSON).content(bad))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("TOO_MANY_ATTEMPTS"));
    }

    /** OWASP API4: a JSON body is measured before Spring reads it into memory. */
    @Test
    void jsonBodiesHaveASizeLimit() throws Exception {
        String huge = "{\"email\":\"" + "a".repeat(200_000) + "@example.com\",\"authKey\":\"x\"}";
        mvc.perform(json(post("/api/v1/auth/login"), huge))
                .andExpect(status().is(413))
                .andExpect(jsonPath("$.code").value("TOO_LARGE"));
        mvc.perform(post("/api/v1/auth/login").with(fromIp()).contentType(MediaType.APPLICATION_JSON).header("Transfer-Encoding", "chunked"))
                .andExpect(status().is(411))
                .andExpect(jsonPath("$.code").value("LENGTH_REQUIRED"));
    }

    /** The app asks here whether a sleeping free server has woken up, before changing anything. */
    @Test
    void healthAnswersWithoutSigningInAndIsNeverCached() throws Exception {
        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    /** One student's typos in a lab must not lock out a classmate on the same address. */
    @Test
    void failuresOfOneAccountDoNotLockOthersOnTheSameAddress() throws Exception {
        Account other = verifiedAccount("\"ACCOUNT\"");
        String bad = "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(uniqueEmail(), randomKey(32));
        for (int i = 0; i < AttemptLimiter.FREE_FAILURES + 2; i++) {
            mvc.perform(json(post("/api/v1/auth/login"), bad));
        }
        login(other);
    }

    @Test
    void emailSendingEndpointsAreRateLimitedPerInbox() throws Exception {
        String email = uniqueEmail();
        for (int i = 0; i < AuthService.EMAIL_ACTIONS_PER_EMAIL_HOUR; i++) {
            mvc.perform(json(post("/api/v1/auth/password-reset/request"), "{\"email\":\"" + email + "\"}"))
                    .andExpect(status().isAccepted());
        }
        mvc.perform(json(post("/api/v1/auth/password-reset/request"), "{\"email\":\"" + email + "\"}"))
                .andExpect(status().isTooManyRequests());
    }

    /** A whole class behind one school address can still sign up, but not without limit. */
    @Test
    void emailSendingEndpointsAllowAClassroomPerAddressButNotMore() throws Exception {
        for (int i = 0; i < AuthService.EMAIL_ACTIONS_PER_ADDRESS_HOUR; i++) {
            mvc.perform(json(post("/api/v1/auth/password-reset/request"), "{\"email\":\"" + uniqueEmail() + "\"}"))
                    .andExpect(status().isAccepted());
        }
        mvc.perform(json(post("/api/v1/auth/password-reset/request"), "{\"email\":\"" + uniqueEmail() + "\"}"))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void refreshRotatesAndReuseRevokesEverySession() throws Exception {
        Account account = verifiedAccount("\"ACCOUNT\"");
        Cookie first = login(account).getResponse().getCookie("estrella_rt");

        MvcResult rotated = mvc.perform(post("/api/v1/auth/refresh").with(fromIp())
                        .header("X-Estrella-Client", "web").cookie(first))
                .andExpect(status().isOk())
                .andReturn();
        Cookie second = rotated.getResponse().getCookie("estrella_rt");
        assertThat(second.getValue()).isNotEqualTo(first.getValue());

        mvc.perform(post("/api/v1/auth/refresh").with(fromIp()).header("X-Estrella-Client", "web").cookie(first))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/refresh").with(fromIp()).header("X-Estrella-Client", "web").cookie(second))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void refreshWithoutTheClientHeaderIsRejected() throws Exception {
        Account account = verifiedAccount("\"ACCOUNT\"");
        Cookie cookie = login(account).getResponse().getCookie("estrella_rt");
        mvc.perform(post("/api/v1/auth/refresh").with(fromIp()).cookie(cookie)).andExpect(status().isBadRequest());
    }

    @Test
    void logoutEndsTheSession() throws Exception {
        Account account = verifiedAccount("\"ACCOUNT\"");
        Cookie cookie = login(account).getResponse().getCookie("estrella_rt");
        mvc.perform(post("/api/v1/auth/logout").with(fromIp()).header("X-Estrella-Client", "web").cookie(cookie))
                .andExpect(status().isNoContent())
                .andExpect(cookie().maxAge("estrella_rt", 0));
        mvc.perform(post("/api/v1/auth/refresh").with(fromIp()).header("X-Estrella-Client", "web").cookie(cookie))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void passwordResetWithRecoveryBundleKeepsTheAccount() throws Exception {
        Account account = verifiedAccount("\"ACCOUNT\"");
        Cookie oldSession = login(account).getResponse().getCookie("estrella_rt");

        mvc.perform(json(post("/api/v1/auth/password-reset/request"), "{\"email\":\"" + account.email() + "\"}"))
                .andExpect(status().isAccepted());
        String token = mail.lastToken(account.email());
        mvc.perform(json(post("/api/v1/auth/password-reset/bundle"), "{\"token\":\"" + token + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.wrappedKeyRecovery").exists());

        String newKey = randomKey(32);
        String confirm = """
                {"token":"%s","authKey":"%s","discardEncryptedData":false,
                 "keyBundle":{"kdfSalt":"%s","wrappedKeyPassword":"%s","wrappedKeyRecovery":"%s"}}
                """.formatted(token, newKey, randomKey(16), randomKey(60), randomKey(60));
        mvc.perform(json(post("/api/v1/auth/password-reset/confirm"), confirm)).andExpect(status().isOk());
        mvc.perform(json(post("/api/v1/auth/password-reset/confirm"), confirm)).andExpect(status().isBadRequest());

        mvc.perform(post("/api/v1/auth/refresh").with(fromIp()).header("X-Estrella-Client", "web").cookie(oldSession))
                .andExpect(status().isUnauthorized());
        mvc.perform(json(post("/api/v1/auth/login"), "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(account.email(), account.authKey())))
                .andExpect(status().isUnauthorized());
        login(new Account(account.email(), newKey));
    }

    @Test
    void invalidInputIsRejectedWithFieldNamesOnly() throws Exception {
        mvc.perform(json(post("/api/v1/auth/register"), """
                        {"email":"no-es-correo","authKey":"corta","ageConfirmed":false,"consents":[],
                         "keyBundle":{"kdfSalt":"x","wrappedKeyPassword":"x","wrappedKeyRecovery":"x"}}
                        """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION"))
                .andExpect(jsonPath("$.fields", hasItem("email")))
                .andExpect(jsonPath("$.fields", hasItem("ageConfirmed")))
                .andExpect(jsonPath("$.fields", hasItem("keyBundle.kdfSalt")));
    }

    @Test
    void accountConsentIsRequired() throws Exception {
        mvc.perform(json(post("/api/v1/auth/register"), registerBody(uniqueEmail(), randomKey(32), "\"PROJECT_SYNC\"")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("CONSENT_REQUIRED"));
    }

    @Test
    void malformedJsonDoesNotLeakDetails() throws Exception {
        mvc.perform(json(post("/api/v1/auth/login"), "{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"))
                .andExpect(jsonPath("$.trace").doesNotExist());
    }

    @Test
    void privateEndpointsDenyByDefault() throws Exception {
        mvc.perform(get("/api/v1/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mvc.perform(get("/api/v1/me").header("Authorization", "Bearer forged.token.value"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/anything-else")).andExpect(status().isUnauthorized());
    }

    @Test
    void responsesCarrySecurityHeaders() throws Exception {
        mvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("Content-Security-Policy", containsString("default-src 'none'")))
                .andExpect(header().string("Referrer-Policy", "no-referrer"));
    }

    @Test
    void corsAllowsOnlyConfiguredOrigins() throws Exception {
        mvc.perform(options("/api/v1/auth/login").header("Origin", "http://localhost:5173")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));
        mvc.perform(options("/api/v1/auth/login").header("Origin", "https://evil.example")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden());
    }

    @Test
    void avatarAcceptsRealImagesOnly() throws Exception {
        String auth = bearer(login(verifiedAccount("\"ACCOUNT\"")));
        byte[] png = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 'I', 'H', 'D', 'R'};
        byte[] script = "<script>alert(1)</script>".getBytes();

        mvc.perform(multipart(HttpMethod.PUT, "/api/v1/me/avatar")
                        .file(new MockMultipartFile("file", "x.png", "image/png", script)).header("Authorization", auth))
                .andExpect(status().isUnsupportedMediaType());
        mvc.perform(multipart(HttpMethod.PUT, "/api/v1/me/avatar")
                        .file(new MockMultipartFile("file", "x.png", "image/png", new byte[300_000])).header("Authorization", auth))
                .andExpect(status().is(413));
        mvc.perform(multipart(HttpMethod.PUT, "/api/v1/me/avatar")
                        .file(new MockMultipartFile("file", "../../x.exe", "application/octet-stream", png)).header("Authorization", auth))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/me/avatar").header("Authorization", auth))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "image/png"));
        mvc.perform(get("/api/v1/me").header("Authorization", auth)).andExpect(jsonPath("$.hasAvatar").value(true));
    }

    @Test
    void thanksScreenIsRememberedPerProgram() throws Exception {
        String auth = bearer(login(verifiedAccount("\"ACCOUNT\"")));
        mvc.perform(put("/api/v1/me/thanks/apuntes").header("Authorization", auth)).andExpect(status().isNoContent());
        mvc.perform(put("/api/v1/me/thanks/apuntes").header("Authorization", auth)).andExpect(status().isNoContent());
        mvc.perform(put("/api/v1/me/thanks/NO_VALIDO!").header("Authorization", auth)).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/me/thanks").header("Authorization", auth))
                .andExpect(jsonPath("$.programs.length()").value(1))
                .andExpect(jsonPath("$.programs[0]").value("apuntes"));
    }

    /** T-10: after deletion no row of the user remains in any table. */
    @Test
    void deletingTheAccountRemovesEveryRow() throws Exception {
        Account account = verifiedAccount("\"ACCOUNT\",\"PROJECT_SYNC\"");
        MvcResult session = login(account);
        String auth = bearer(session);
        mvc.perform(put("/api/v1/me/thanks/apuntes").header("Authorization", auth)).andExpect(status().isNoContent());
        UUID id = jdbc.sql("SELECT id FROM user_account WHERE email = :e").param("e", account.email())
                .query(UUID.class).single();

        mvc.perform(json(post("/api/v1/me/delete"), "{\"authKey\":\"" + randomKey(32) + "\"}").header("Authorization", auth))
                .andExpect(status().isForbidden());
        mvc.perform(json(post("/api/v1/me/delete"), "{\"authKey\":\"" + account.authKey() + "\"}").header("Authorization", auth))
                .andExpect(status().isNoContent());

        for (String table : new String[] {"user_session", "email_token", "consent_record", "project", "program_state",
            "ai_connection"}) {
            Integer rows = jdbc.sql("SELECT count(*) FROM " + table + " WHERE user_id = :id").param("id", id)
                    .query(Integer.class).single();
            assertThat(rows).as(table).isZero();
        }
        assertThat(jdbc.sql("SELECT count(*) FROM user_account WHERE id = :id").param("id", id)
                .query(Integer.class).single()).isZero();
        mvc.perform(get("/api/v1/me").header("Authorization", auth)).andExpect(status().isUnauthorized());
        assertThat(mail.sent()).anyMatch(s -> s.kind().equals("deleted"));
    }
}
