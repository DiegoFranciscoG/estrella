package ec.estrella.api.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "app")
public record AppProperties(
        @NotBlank String jwtSecret,
        @NotNull Duration accessTokenTtl,
        @NotNull Duration refreshTokenTtl,
        @NotNull Duration emailTokenTtl,
        @NotBlank String publicUrl,
        @NotEmpty List<String> corsOrigins,
        boolean cookieSecure,
        @NotBlank String cookieSameSite,
        @NotBlank String mailFrom,
        @Positive long storageQuotaBytes,
        @NotBlank String privacyNoticeVersion,
        @NotNull Duration unverifiedAccountRetention,
        @Min(1) @Max(100_000) int mailPerHour,
        @Min(1024) @Max(1024 * 1024) int maxJsonBytes,
        @NotNull MailProvider mailProvider,
        @NotNull @Valid Brevo brevo,
        @NotNull @Valid Proxy proxy,
        @NotNull @Valid Sync sync,
        @NotNull @Valid Ai ai) {

    /** How emails leave: SMTP (local Mailpit, or a host that allows it) or Brevo's HTTP API. */
    public enum MailProvider { SMTP, BREVO }

    /**
     * Brevo's transactional email API. Render's free instances cannot open SMTP ports (25, 465,
     * 587), so production sends through HTTPS instead.
     *
     * @param apiKey  secret, from BREVO_API_KEY only; required when the provider is Brevo
     * @param baseUrl the API root, replaceable in tests
     */
    public record Brevo(String apiKey, @NotBlank @Pattern(regexp = Ai.HTTP_URL) String baseUrl) {
    }

    /**
     * The panel's proxy in front of the API (Netlify). When {@code secret} is set, every /api request
     * must carry Netlify's signature (x-nf-sign, HS256 with this secret); only then is the student's
     * address taken from {@code clientIpHeader} instead of the proxy's own.
     */
    public record Proxy(String secret, @NotBlank @Pattern(regexp = "^[A-Za-z0-9-]{1,64}$") String clientIpHeader) {

        public boolean enabled() {
            return secret != null && !secret.isEmpty();
        }

        /** HS256 needs a key of at least 256 bits (RFC 7518, section 3.2). */
        @AssertTrue(message = "APP_PROXY_SECRET must be at least 32 bytes long")
        public boolean isSecretStrong() {
            return !enabled() || secret.getBytes(StandardCharsets.UTF_8).length >= 32;
        }
    }

    /**
     * Limits of encrypted project sync. They keep a free database (Neon: 1 GB per project) usable
     * by many students and bound what one account can make the server store or process.
     */
    public record Sync(
            @Min(1024) @Max(64L * 1024 * 1024) long maxVersionBytes,
            @Min(1) @Max(50) int versionsKept,
            @Min(1) @Max(10_000) int maxProjects,
            @Min(1) @Max(1_000) int uploadsPerMinute) {
    }

    /**
     * The assistant, through each student's own OpenRouter key.
     *
     * @param keySecret base64 of 32 random bytes; encrypts the stored keys (AES-256-GCM)
     * @param baseUrl   OpenRouter API, called by this server only
     * @param authUrl   OpenRouter's authorization page, where the browser sends the student
     * @param models    tried in order; only free ones, because a paid model in the fallback list
     *                  is billed to the student (OpenRouter docs, ":free" variant)
     */
    public record Ai(
            @NotBlank String keySecret,
            @NotBlank @Pattern(regexp = HTTP_URL) String baseUrl,
            @NotBlank @Pattern(regexp = HTTP_URL) String authUrl,
            @NotEmpty @Size(max = 5) List<@NotNull @Pattern(regexp = FREE_MODEL) String> models,
            @Min(1) @Max(60) int requestsPerMinute,
            @Min(200) @Max(20_000) int maxMessageChars,
            @Min(64) @Max(4_096) int maxOutputTokens,
            @NotNull Duration timeout) {

        static final String HTTP_URL = "^https?://[^\\s?#]+[^/\\s?#]$";
        static final String FREE_MODEL = "^(openrouter/free|[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*:free)$";
    }
}
