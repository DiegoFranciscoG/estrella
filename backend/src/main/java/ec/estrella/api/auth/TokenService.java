package ec.estrella.api.auth;

import ec.estrella.api.common.ApiException;
import ec.estrella.api.common.Tokens;
import ec.estrella.api.config.AppProperties;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Short-lived JWT access tokens plus rotating, revocable refresh tokens. */
@Service
public class TokenService {

    public record IssuedTokens(String accessToken, long expiresIn, String refreshToken) {
    }

    private static final Logger log = LoggerFactory.getLogger(TokenService.class);

    private final JwtEncoder encoder;
    private final SessionRepository sessions;
    private final AppProperties properties;
    private final Clock clock;

    public TokenService(JwtEncoder encoder, SessionRepository sessions, AppProperties properties, Clock clock) {
        this.encoder = encoder;
        this.sessions = sessions;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional
    public IssuedTokens issue(UUID userId) {
        Instant now = clock.instant();
        String refresh = Tokens.newToken();
        sessions.insert(UUID.randomUUID(), userId, Tokens.sha256(refresh), now.plus(properties.refreshTokenTtl()));
        return new IssuedTokens(accessToken(userId, now), properties.accessTokenTtl().toSeconds(), refresh);
    }

    /**
     * Rotates a refresh token. Presenting an already rotated token means it was copied, so every
     * session of that user is revoked (refresh token reuse detection).
     */
    @Transactional(noRollbackFor = ApiException.class)
    public RotatedTokens rotate(String refreshToken) {
        Instant now = clock.instant();
        SessionRepository.Session session = sessions.findByHash(Tokens.sha256(refreshToken))
                .orElseThrow(TokenService::invalidSession);
        if (session.revokedAt() != null) {
            sessions.revokeAllForUser(session.userId(), now);
            log.warn("Security event: a rotated refresh token was used again; all sessions of that account were closed");
            throw invalidSession();
        }
        if (!session.expiresAt().isAfter(now) || !sessions.revoke(session.id(), now)) {
            throw invalidSession();
        }
        return new RotatedTokens(session.userId(), issue(session.userId()));
    }

    public record RotatedTokens(UUID userId, IssuedTokens tokens) {
    }

    public void revoke(String refreshToken) {
        sessions.findByHash(Tokens.sha256(refreshToken)).ifPresent(s -> sessions.revoke(s.id(), clock.instant()));
    }

    public void revokeAll(UUID userId) {
        sessions.revokeAllForUser(userId, clock.instant());
    }

    private String accessToken(UUID userId, Instant now) {
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("estrella")
                .subject(userId.toString())
                .issuedAt(now)
                .expiresAt(now.plus(properties.accessTokenTtl()))
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
    }

    private static ApiException invalidSession() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "SESSION_EXPIRED", "Tu sesión terminó. Inicia sesión de nuevo");
    }
}
