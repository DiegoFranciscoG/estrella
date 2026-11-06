package ec.estrella.api.auth;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class SessionRepository {

    public record Session(UUID id, UUID userId, Instant expiresAt, Instant revokedAt) {
    }

    private final JdbcClient jdbc;

    public SessionRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(UUID id, UUID userId, byte[] tokenHash, Instant expiresAt) {
        jdbc.sql("INSERT INTO user_session (id, user_id, refresh_token_hash, expires_at) VALUES (:id, :user, :hash, :exp)")
                .param("id", id)
                .param("user", userId)
                .param("hash", tokenHash)
                .param("exp", Timestamp.from(expiresAt))
                .update();
    }

    public Optional<Session> findByHash(byte[] tokenHash) {
        return jdbc.sql("SELECT id, user_id, expires_at, revoked_at FROM user_session WHERE refresh_token_hash = :hash")
                .param("hash", tokenHash)
                .query((rs, n) -> {
                    Timestamp revoked = rs.getTimestamp("revoked_at");
                    return new Session(rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
                            rs.getTimestamp("expires_at").toInstant(), revoked == null ? null : revoked.toInstant());
                })
                .optional();
    }

    /** Returns true only for the caller that actually revoked it, so a token can be rotated once. */
    public boolean revoke(UUID id, Instant when) {
        return jdbc.sql("UPDATE user_session SET revoked_at = :when WHERE id = :id AND revoked_at IS NULL")
                .param("when", Timestamp.from(when))
                .param("id", id)
                .update() == 1;
    }

    public void revokeAllForUser(UUID userId, Instant when) {
        jdbc.sql("UPDATE user_session SET revoked_at = :when WHERE user_id = :user AND revoked_at IS NULL")
                .param("when", Timestamp.from(when))
                .param("user", userId)
                .update();
    }

    public int deleteExpiredBefore(Instant cutoff) {
        return jdbc.sql("DELETE FROM user_session WHERE expires_at < :cutoff")
                .param("cutoff", Timestamp.from(cutoff))
                .update();
    }
}
