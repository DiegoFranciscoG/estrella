package ec.estrella.api.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
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
        @NotNull @Valid Sync sync) {

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
}
