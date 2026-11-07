package ec.estrella.api.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import ec.estrella.api.mail.MailTransport;
import ec.estrella.api.support.IntegrationTest;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;

/**
 * The settings of the free deployment (docs/despliegue.md): emails through Brevo's API because the
 * host blocks SMTP, and the API reachable only through the panel's signed Netlify proxy.
 */
@TestPropertySource(properties = {
    "app.mail-provider=brevo",
    "app.brevo.api-key=xkeysib-solo-para-pruebas",
    "app.public-url=https://estrella-panel.netlify.app"})
class ProductionWiringIntegrationTest extends IntegrationTest {

    /** Made per run, like every other secret of the test suite. */
    static final String SECRET = randomKey(48);

    @DynamicPropertySource
    static void proxySecret(DynamicPropertyRegistry registry) {
        registry.add("app.proxy.secret", () -> SECRET);
    }

    private static String signed() throws Exception {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer("netlify")
                .expirationTime(Date.from(Instant.now().plusSeconds(60)))
                .claim("site_url", "https://estrella-panel.netlify.app")
                .claim("deploy_context", "production")
                .build();
        SignedJWT jws = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
        jws.sign(new MACSigner(SECRET.getBytes(StandardCharsets.UTF_8)));
        return jws.serialize();
    }

    @Test
    void emailsLeaveThroughBrevosApi() {
        assertThat(context.getBean(MailTransport.class).getClass().getSimpleName()).isEqualTo("BrevoMailTransport");
    }

    @Test
    void onlyRequestsSignedByThePanelsProxyReachTheApi() throws Exception {
        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PROXY_REQUIRED"));
        mvc.perform(get("/api/v1/health").header("x-nf-sign", signed())).andExpect(status().isNoContent());
        // The host checks health directly, without the proxy.
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }

    /** Behind the proxy, each student keeps their own address: one student's mistakes slow down only them. */
    @Test
    void loginBrakesFollowTheStudentNotTheProxy() throws Exception {
        String bad = "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(uniqueEmail(), randomKey(32));
        for (int i = 0; i < 5; i++) {
            mvc.perform(post("/api/v1/auth/login").header("x-nf-sign", signed()).header("X-Nf-Client-Connection-Ip", "203.0.113.70")
                    .contentType(MediaType.APPLICATION_JSON).content(bad)).andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/v1/auth/login").header("x-nf-sign", signed()).header("X-Nf-Client-Connection-Ip", "203.0.113.70")
                .contentType(MediaType.APPLICATION_JSON).content(bad)).andExpect(status().isTooManyRequests());
        // Same proxy, same account, but another student's address: not slowed down by the first one.
        mvc.perform(post("/api/v1/auth/login").header("x-nf-sign", signed()).header("X-Nf-Client-Connection-Ip", "203.0.113.71")
                .contentType(MediaType.APPLICATION_JSON).content(bad)).andExpect(status().isUnauthorized());
    }
}
