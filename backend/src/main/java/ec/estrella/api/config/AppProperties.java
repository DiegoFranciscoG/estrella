package ec.estrella.api.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
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
        @NotNull @Valid Sync sync,
        @NotNull @Valid Ai ai) {

    /**
     * Limits of encrypted project sync. They keep a free database (Neon: 0.5 GB per project) usable
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
