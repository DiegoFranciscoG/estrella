package ec.estrella.api.common;

import ec.estrella.api.config.AppProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * The API behind the panel's Netlify proxy (APP_PROXY_SECRET set). Netlify signs every request it
 * forwards with a JWS in {@code x-nf-sign}: HS256 with the shared secret, {@code iss} "netlify",
 * an expiry and the site's URL. Without a valid signature an /api request did not come through the
 * panel's site and is refused. With one, the student's address is the one Netlify reports: seen
 * from here every request comes from Netlify, and per-address limits would otherwise put every
 * student in one bucket. Without the secret (local stack) this filter does nothing.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class SignedProxyFilter extends OncePerRequestFilter {

    static final String SIGNATURE_HEADER = "x-nf-sign";
    private static final Logger log = LoggerFactory.getLogger(SignedProxyFilter.class);
    private static final Pattern IPV4 = Pattern.compile("^((25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1?\\d?\\d)$");
    private static final Pattern IPV6 = Pattern.compile("^(?=.*:)[0-9A-Fa-f:.]{2,45}$");

    private final String clientIpHeader;
    private final JwtDecoder decoder;
    private final AtomicBoolean sourceLogged = new AtomicBoolean();

    @Autowired
    public SignedProxyFilter(AppProperties properties) {
        this(properties.proxy().enabled() ? properties.proxy().secret() : null, properties.publicUrl(),
                properties.proxy().clientIpHeader());
    }

    /** @param secret null when the API is reached directly */
    SignedProxyFilter(String secret, String siteUrl, String clientIpHeader) {
        this.clientIpHeader = clientIpHeader;
        this.decoder = secret == null ? null : decoder(secret, siteUrl);
    }

    static JwtDecoder decoder(String secret, String siteUrl) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder
                .withSecretKey(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"))
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        String site = withoutTrailingSlash(siteUrl);
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(Duration.ofSeconds(30)),
                new JwtClaimValidator<Instant>(JwtClaimNames.EXP, Objects::nonNull),
                new JwtIssuerValidator("netlify"),
                new JwtClaimValidator<String>("site_url", url -> url != null && withoutTrailingSlash(url).equals(site))));
        return decoder;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // The host's own health checks reach /actuator/health directly, without the proxy.
        return decoder == null || !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String signature = request.getHeader(SIGNATURE_HEADER);
        try {
            if (signature == null || signature.isBlank()) {
                throw new JwtException("unsigned");
            }
            decoder.decode(signature);
        } catch (JwtException e) {
            FilterProblems.write(response, HttpServletResponse.SC_FORBIDDEN, "PROXY_REQUIRED",
                    "Abre ESTRELLA desde su sitio oficial");
            return;
        }
        chain.doFilter(new StudentAddress(request, studentAddress(request)), response);
    }

    /**
     * Netlify's own header first, then the address Netlify added to X-Forwarded-For (the last one
     * left after the host's proxies), and only then the proxy's address.
     */
    private String studentAddress(HttpServletRequest request) {
        String address = literal(request.getHeader(clientIpHeader));
        String source = clientIpHeader;
        if (address == null) {
            address = literal(lastEntry(request.getHeader("X-Forwarded-For")));
            source = "X-Forwarded-For";
        }
        if (address == null) {
            address = request.getRemoteAddr();
            source = "the proxy's own address";
        }
        if (sourceLogged.compareAndSet(false, true)) {
            // The header's name only: addresses are personal data and never logged.
            log.info("Signed proxy verified; student addresses are read from {}", source);
        }
        return address;
    }

    private static String lastEntry(String forwardedFor) {
        if (forwardedFor == null) {
            return null;
        }
        String[] entries = forwardedFor.split(",");
        return entries[entries.length - 1];
    }

    /** An IP address written as such, normalized; never a host name, so nothing is looked up. */
    static String literal(String value) {
        if (value == null) {
            return null;
        }
        String candidate = value.trim();
        if (!IPV4.matcher(candidate).matches() && !IPV6.matcher(candidate).matches()) {
            return null;
        }
        try {
            return InetAddress.getByName(candidate).getHostAddress();
        } catch (UnknownHostException e) {
            return null;
        }
    }

    private static String withoutTrailingSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    private static final class StudentAddress extends HttpServletRequestWrapper {

        private final String address;

        StudentAddress(HttpServletRequest request, String address) {
            super(request);
            this.address = address;
        }

        @Override
        public String getRemoteAddr() {
            return address;
        }

        @Override
        public String getRemoteHost() {
            return address;
        }
    }
}
