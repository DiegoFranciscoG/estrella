package ec.estrella.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import ec.estrella.api.common.Tokens;
import ec.estrella.api.config.AppProperties;
import ec.estrella.api.support.FakeOpenRouter;
import ec.estrella.api.support.IntegrationTest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The assistant against PostgreSQL and a local OpenRouter: the key is exchanged by PKCE and kept
 * only as ciphertext, the proxy sends exactly the reviewed text to free models, limits hold, and
 * every way of leaving deletes the key (T-10).
 */
class AiAssistantIntegrationTest extends IntegrationTest {

    /** RFC 7636, appendix B. */
    private static final String VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    private static final AtomicInteger IP = new AtomicInteger(1);

    private final String ip = "10.7." + (IP.get() / 250) + "." + (IP.getAndIncrement() % 250 + 1);

    @Autowired
    private AppProperties properties;

    private MockHttpServletRequestBuilder as(Student s, MockHttpServletRequestBuilder b) {
        return b.header("Authorization", s.bearer()).with(r -> {
            r.setRemoteAddr(ip);
            return r;
        });
    }

    private ResultActions connect(Student s, String code, String verifier, boolean adult) throws Exception {
        return mvc.perform(as(s, put("/api/v1/ai/connection")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"%s\",\"codeVerifier\":\"%s\",\"adult\":%s}".formatted(code, verifier, adult)));
    }

    private ResultActions ask(Student s, String message, boolean allowProviderStorage) throws Exception {
        String body = "{\"message\":\"%s\",\"allowProviderStorage\":%s}".formatted(message, allowProviderStorage);
        return mvc.perform(as(s, post("/api/v1/ai/chat")).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private Student connected() throws Exception {
        Student s = signUp(ip, "\"ACCOUNT\"");
        connect(s, OPENROUTER.authorize(FakeOpenRouter.challengeFor(VERIFIER)), VERIFIER, true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(true));
        return s;
    }

    private long count(String sql, UUID user) {
        return jdbc.sql(sql).param("id", user).query(Long.class).single();
    }

    private long aiConsents(UUID user) {
        return count("SELECT count(*) FROM consent_record WHERE user_id = :id AND purpose = 'AI_ASSISTANT' AND revoked_at IS NULL", user);
    }

    @Test
    void theKeyIsStoredOnlyEncryptedAndTheProxyAddsIt() throws Exception {
        Student s = signUp(ip, "\"ACCOUNT\"");
        mvc.perform(as(s, get("/api/v1/ai/status")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(false))
                .andExpect(jsonPath("$.authUrl").value("http://127.0.0.1:9/auth"))
                .andExpect(jsonPath("$.instructions").value(AiService.INSTRUCTIONS));

        String code = OPENROUTER.authorize(FakeOpenRouter.challengeFor(VERIFIER));
        String connectBody = connect(s, code, VERIFIER, true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(true))
                .andExpect(jsonPath("$.models").value(properties.ai().models()))
                .andReturn().getResponse().getContentAsString();
        String key = OPENROUTER.lastKey();
        assertThat(connectBody).doesNotContain(key).doesNotContain("sk-or-");

        // T-09 for the key: the database holds a ciphertext in which the key does not appear.
        assertThat(count("SELECT count(*) FROM ai_connection WHERE user_id = :id", s.id())).isEqualTo(1);
        assertThat(jdbc.sql("SELECT position(convert_to(:key, 'UTF8') in key_ciphertext) FROM ai_connection WHERE user_id = :id")
                .param("key", key).param("id", s.id()).query(Integer.class).single()).isZero();
        assertThat(aiConsents(s.id())).isEqualTo(1);

        // The code works once, as OpenRouter's does.
        connect(s, code, VERIFIER, true).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("AI_CODE_INVALID"));

        String question = "¿Cómo recorto una línea que se pasa?";
        String answer = ask(s, question, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value(org.hamcrest.Matchers.startsWith("1. Escribe REC")))
                .andExpect(jsonPath("$.model").value(properties.ai().models().get(0)))
                .andExpect(jsonPath("$.truncated").value(false))
                .andReturn().getResponse().getContentAsString();
        assertThat(answer).doesNotContain(key);

        // What left the server: the key only in the Authorization header, the reviewed text as is,
        // only free models, providers that do not collect data, a bounded answer and no tools.
        FakeOpenRouter.Request sent = OPENROUTER.lastChat();
        assertThat(sent.header("Authorization")).isEqualTo("Bearer " + key);
        assertThat(sent.header("HTTP-Referer")).isEqualTo(properties.publicUrl());
        assertThat(sent.header("X-OpenRouter-Title")).isEqualTo("ESTRELLA");
        List<String> models = JsonPath.read(sent.body(), "$.models");
        assertThat(models).isEqualTo(properties.ai().models()).allMatch(m -> m.endsWith(":free") || m.equals("openrouter/free"));
        assertThat((String) JsonPath.read(sent.body(), "$.provider.data_collection")).isEqualTo("deny");
        assertThat((Integer) JsonPath.read(sent.body(), "$.max_tokens")).isEqualTo(properties.ai().maxOutputTokens());
        assertThat((String) JsonPath.read(sent.body(), "$.messages[0].role")).isEqualTo("system");
        assertThat((String) JsonPath.read(sent.body(), "$.messages[1].content")).isEqualTo(question);
        assertThat((List<?>) JsonPath.read(sent.body(), "$.messages")).hasSize(2);
        assertThat(sent.body()).doesNotContain("\"tools\"").doesNotContain("\"user\":").doesNotContain(s.email());

        assertThat(count("SELECT count(*) FROM ai_connection WHERE user_id = :id AND last_used_at IS NOT NULL", s.id())).isEqualTo(1);
        mvc.perform(as(s, get("/api/v1/ai/status")))
                .andExpect(jsonPath("$.connected").value(true))
                .andExpect(jsonPath("$.lastUsedAt").isNotEmpty());
    }

    @Test
    void connectingNeedsTheAdultDeclarationAndAValidCode() throws Exception {
        Student s = signUp(ip, "\"ACCOUNT\"");
        String code = OPENROUTER.authorize(FakeOpenRouter.challengeFor(VERIFIER));
        connect(s, code, VERIFIER, false).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        // Too short for RFC 7636, and a well-formed verifier that does not match the challenge.
        connect(s, code, "corto", true).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        connect(s, code, "x".repeat(43), true).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("AI_CODE_INVALID"));
        assertThat(count("SELECT count(*) FROM ai_connection WHERE user_id = :id", s.id())).isZero();
        assertThat(aiConsents(s.id())).isZero();
        // The consent cannot be given without connecting (and declaring the age).
        mvc.perform(as(s, put("/api/v1/me/consents/AI_ASSISTANT"))).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/ai/status")).andExpect(status().isUnauthorized());
    }

    @Test
    void askingNeedsAConnectionAndStaysWithinLimits() throws Exception {
        Student lone = signUp(ip, "\"ACCOUNT\"");
        ask(lone, "Hola", false).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("AI_NOT_CONNECTED"));

        Student s = connected();
        int max = properties.ai().maxMessageChars();
        ask(s, "a".repeat(max + 1), false)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("AI_TOO_LONG"))
                .andExpect(jsonPath("$.maxMessageChars").value(max));
        ask(s, "   ", false).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        for (int i = 0; i < properties.ai().requestsPerMinute(); i++) {
            ask(s, "Pregunta " + i, false).andExpect(status().isOk());
        }
        int sentBefore = OPENROUTER.chatCount();
        ask(s, "Una más", false)
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("AI_TOO_MANY"))
                .andExpect(jsonPath("$.retryAfterSeconds").value(60));
        assertThat(OPENROUTER.chatCount()).isEqualTo(sentBefore);
    }

    @Test
    void oneQuestionAtATime() throws Exception {
        Student s = connected();
        OPENROUTER.delayNext(1500);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<Integer> slow = pool.submit(() -> ask(s, "Primera", false).andReturn().getResponse().getStatus());
            Thread.sleep(400);
            ask(s, "Segunda", false).andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code").value("AI_BUSY"));
            assertThat(slow.get()).isEqualTo(200);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void openRouterErrorsReachTheStudentInPlainWords() throws Exception {
        Student s = connected();
        OPENROUTER.answerNext(429, FakeOpenRouter.error(429, "Rate limit exceeded: free-models-per-day"), Map.of("Retry-After", "30"));
        ask(s, "Hola", false).andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("AI_LIMIT")).andExpect(jsonPath("$.retryAfterSeconds").value(30));

        // No provider that keeps nothing: said as it is, and the student may allow storage for one question.
        OPENROUTER.answerNext(503, FakeOpenRouter.error(503, "No endpoints found matching your data policy"), Map.of());
        ask(s, "Hola", false).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("AI_NO_PROVIDER")).andExpect(jsonPath("$.privacyRestricted").value(true));
        OPENROUTER.answerNext(503, FakeOpenRouter.error(503, "No endpoints"), Map.of());
        ask(s, "Hola", true).andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.privacyRestricted").value(false));
        assertThat((String) JsonPath.read(OPENROUTER.lastChat().body(), "$.provider.data_collection")).isEqualTo("allow");

        OPENROUTER.answerNext(402, FakeOpenRouter.error(402, "Insufficient credits"), Map.of());
        ask(s, "Hola", false).andExpect(status().isPaymentRequired()).andExpect(jsonPath("$.code").value("AI_NO_CREDITS"));

        Student t = connected();
        // An error after processing started comes with status 200 (OpenRouter docs).
        OPENROUTER.answerNext(200, FakeOpenRouter.error(403, "Flagged by moderation"), Map.of());
        ask(t, "Hola", false).andExpect(status().is(422)).andExpect(jsonPath("$.code").value("AI_BLOCKED"));
        OPENROUTER.answerNext(200, "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"\"}}]}", Map.of());
        ask(t, "Hola", false).andExpect(status().isBadGateway()).andExpect(jsonPath("$.code").value("AI_EMPTY"));
        OPENROUTER.answerNext(500, "<html>oops</html>", Map.of());
        ask(t, "Hola", false).andExpect(status().isBadGateway()).andExpect(jsonPath("$.code").value("AI_UNAVAILABLE"));
        // Slower than the configured timeout (2 s in tests).
        OPENROUTER.delayNext(3000);
        ask(t, "Hola", false).andExpect(status().isGatewayTimeout()).andExpect(jsonPath("$.code").value("AI_TIMEOUT"));

        // Deleted at OpenRouter: never a 401 here (that would sign the student out of ESTRELLA),
        // and the useless key goes away.
        Student u = connected();
        OPENROUTER.forgetKeys();
        ask(u, "Hola", false).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("AI_RECONNECT"));
        assertThat(count("SELECT count(*) FROM ai_connection WHERE user_id = :id", u.id())).isZero();
        assertThat(aiConsents(u.id())).isZero();
    }

    @Test
    void everyWayOfLeavingDeletesTheKey() throws Exception {
        Student s = connected();
        String key = OPENROUTER.lastKey();
        mvc.perform(as(s, delete("/api/v1/ai/connection")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.keySettingsUrl").value(matchesPattern("^http://127\\.0\\.0\\.1:9/keys/[0-9a-f]{64}$")))
                .andExpect(jsonPath("$.keySettingsUrl").value("http://127.0.0.1:9/keys/" + HexFormat.of().formatHex(Tokens.sha256(key))));
        assertThat(count("SELECT count(*) FROM ai_connection WHERE user_id = :id", s.id())).isZero();
        assertThat(aiConsents(s.id())).isZero();
        ask(s, "Hola", false).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("AI_NOT_CONNECTED"));

        // Withdrawing the consent from the account page deletes it too (LOPDP art. 15.6).
        connect(s, OPENROUTER.authorize(FakeOpenRouter.challengeFor(VERIFIER)), VERIFIER, true).andExpect(status().isOk());
        mvc.perform(as(s, delete("/api/v1/me/consents/AI_ASSISTANT"))).andExpect(status().isOk());
        assertThat(count("SELECT count(*) FROM ai_connection WHERE user_id = :id", s.id())).isZero();

        // The export says when it was connected and used, never the key.
        connect(s, OPENROUTER.authorize(FakeOpenRouter.challengeFor(VERIFIER)), VERIFIER, true).andExpect(status().isOk());
        ask(s, "Hola", false).andExpect(status().isOk());
        String export = mvc.perform(as(s, get("/api/v1/me/export")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assistant.connectedAt").isNotEmpty())
                .andExpect(jsonPath("$.assistant.lastUsedAt").isNotEmpty())
                .andReturn().getResponse().getContentAsString();
        assertThat(export).doesNotContain(OPENROUTER.lastKey()).doesNotContain("sk-or-");

        // T-10: deleting the account leaves no connection behind.
        mvc.perform(as(s, post("/api/v1/me/delete")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"authKey\":\"" + s.authKey() + "\"}"))
                .andExpect(status().isNoContent());
        assertThat(count("SELECT count(*) FROM ai_connection WHERE user_id = :id", s.id())).isZero();
    }
}
