package ec.estrella.api.common;

import static org.assertj.core.api.Assertions.assertThat;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import ec.estrella.api.config.AppProperties;
import jakarta.validation.Validation;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** Netlify's signed proxy (x-nf-sign): who may call the API, and which address a student has. */
class SignedProxyFilterTest {

    /** Made per run, so no secret-looking value lives in the repository. */
    private static final String SECRET = randomSecret();
    private static final String SITE = "https://estrella-panel.netlify.app";
    private static final String HEADER = "X-Nf-Client-Connection-Ip";

    private final SignedProxyFilter filter = new SignedProxyFilter(SECRET, SITE, HEADER);

    private static String randomSecret() {
        byte[] bytes = new byte[48];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    /** A JWS like Netlify's: HS256 over {deploy_context, exp, iss, netlify_id, site_url}. */
    private static String netlifySignature(String secret, Consumer<JWTClaimsSet.Builder> change) throws JOSEException {
        JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder()
                .claim("deploy_context", "production")
                .expirationTime(Date.from(Instant.now().plusSeconds(60)))
                .issuer("netlify")
                .claim("netlify_id", "1be0f471-6532-45ff-b1b1-f9c66ea24dc1")
                .claim("site_url", SITE);
        change.accept(claims);
        SignedJWT jws = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType.JWT).build(), claims.build());
        jws.sign(new MACSigner(secret.getBytes(StandardCharsets.UTF_8)));
        return jws.serialize();
    }

    private static MockHttpServletRequest fromProxy(String signature) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/login");
        request.setRemoteAddr("198.51.100.200");
        if (signature != null) {
            request.addHeader(SignedProxyFilter.SIGNATURE_HEADER, signature);
        }
        return request;
    }

    private record Outcome(int status, String body, String remoteAddr) {
    }

    private Outcome run(SignedProxyFilter target, MockHttpServletRequest request) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        target.doFilter(request, response, chain);
        return new Outcome(response.getStatus(), response.getContentAsString(StandardCharsets.UTF_8),
                chain.getRequest() == null ? null : chain.getRequest().getRemoteAddr());
    }

    @Test
    void aSignedRequestCarriesTheStudentsAddressNotTheProxys() throws Exception {
        MockHttpServletRequest request = fromProxy(netlifySignature(SECRET, c -> { }));
        request.addHeader(HEADER, "203.0.113.25");
        assertThat(run(filter, request)).isEqualTo(new Outcome(200, "", "203.0.113.25"));
    }

    @Test
    void withoutNetlifysHeaderTheAddressNetlifyForwardedIsUsed() throws Exception {
        MockHttpServletRequest request = fromProxy(netlifySignature(SECRET, c -> { }));
        // What is left after the host's own proxies: whatever the client wrote, then what Netlify saw.
        request.addHeader("X-Forwarded-For", "10.9.8.7, 2001:db8::25");
        assertThat(run(filter, request).remoteAddr()).isEqualTo("2001:db8:0:0:0:0:0:25");
    }

    @Test
    void anAddressThatIsNotAnIpIsIgnoredAndNeverLookedUp() throws Exception {
        MockHttpServletRequest request = fromProxy(netlifySignature(SECRET, c -> { }));
        request.addHeader(HEADER, "attacker.example");
        request.addHeader("X-Forwarded-For", "not-an-address");
        assertThat(run(filter, request).remoteAddr()).isEqualTo("198.51.100.200");
        assertThat(SignedProxyFilter.literal("1.2.3")).isNull();
        assertThat(SignedProxyFilter.literal("256.1.1.1")).isNull();
        assertThat(SignedProxyFilter.literal(":::::")).isNull();
        assertThat(SignedProxyFilter.literal(" 192.0.2.1 ")).isEqualTo("192.0.2.1");
    }

    @Test
    void requestsThatDidNotComeThroughThePanelAreRefused() throws Exception {
        String other = randomSecret();
        for (String signature : new String[] {
            null,
            "",
            "not.a.jws",
            netlifySignature(other, c -> { }),
            netlifySignature(SECRET, c -> c.expirationTime(Date.from(Instant.now().minusSeconds(120)))),
            netlifySignature(SECRET, c -> c.expirationTime(null)),
            netlifySignature(SECRET, c -> c.issuer("someone-else")),
            netlifySignature(SECRET, c -> c.claim("site_url", "https://another-site.netlify.app")),
        }) {
            MockHttpServletRequest request = fromProxy(signature);
            request.addHeader(HEADER, "203.0.113.25");
            Outcome outcome = run(filter, request);
            assertThat(outcome.status()).as(String.valueOf(signature)).isEqualTo(403);
            assertThat(outcome.body()).contains("\"code\":\"PROXY_REQUIRED\"");
            assertThat(outcome.remoteAddr()).isNull();
        }
    }

    @Test
    void theHostsHealthCheckAndTheLocalStackNeedNoSignature() throws Exception {
        MockHttpServletRequest health = new MockHttpServletRequest("GET", "/actuator/health");
        health.setRemoteAddr("10.0.0.1");
        assertThat(run(filter, health)).isEqualTo(new Outcome(200, "", "10.0.0.1"));

        SignedProxyFilter direct = new SignedProxyFilter(null, SITE, HEADER);
        MockHttpServletRequest request = fromProxy(null);
        request.addHeader(HEADER, "203.0.113.25");
        assertThat(run(direct, request)).isEqualTo(new Outcome(200, "", "198.51.100.200"));
    }

    @Test
    void theSharedSecretMustBeLongEnoughForHs256() {
        var validator = Validation.buildDefaultValidatorFactory().getValidator();
        assertThat(validator.validate(new AppProperties.Proxy("", HEADER))).isEmpty();
        assertThat(validator.validate(new AppProperties.Proxy(SECRET, HEADER))).isEmpty();
        assertThat(validator.validate(new AppProperties.Proxy("corta", HEADER))).isNotEmpty();
        assertThat(validator.validate(new AppProperties.Proxy(SECRET, "X-Bad Header"))).isNotEmpty();
    }
}
