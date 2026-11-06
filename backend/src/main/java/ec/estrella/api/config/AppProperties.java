package ec.estrella.api.config;

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
        @NotNull Duration unverifiedAccountRetention) {
}
