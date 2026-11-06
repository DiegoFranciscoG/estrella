package ec.estrella.api.auth;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class EmailTokenRepository {

    public enum Purpose { VERIFY_EMAIL, RESET_PASSWORD }

    private final JdbcClient jdbc;

    public EmailTokenRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Stores a new token and invalidates older pending tokens of the same purpose. */
    public void replace(UUID userId, Purpose purpose, byte[] tokenHash, Instant expiresAt, Instant now) {
        jdbc.sql("UPDATE email_token SET used_at = :now WHERE user_id = :user AND purpose = :purpose AND used_at IS NULL")
                .param("now", Timestamp.from(now))
                .param("user", userId)
                .param("purpose", purpose.name())
                .update();
        jdbc.sql("INSERT INTO email_token (id, user_id, purpose, token_hash, expires_at) VALUES (:id, :user, :purpose, :hash, :exp)")
                .param("id", UUID.randomUUID())
                .param("user", userId)
                .param("purpose", purpose.name())
                .param("hash", tokenHash)
                .param("exp", Timestamp.from(expiresAt))
                .update();
    }

    /** User id of a token that exists, has this purpose, is unused and has not expired. */
    public Optional<UUID> findValidUser(byte[] tokenHash, Purpose purpose, Instant now) {
        return jdbc.sql("""
                SELECT user_id FROM email_token
                 WHERE token_hash = :hash AND purpose = :purpose AND used_at IS NULL AND expires_at > :now
                """)
                .param("hash", tokenHash)
                .param("purpose", purpose.name())
                .param("now", Timestamp.from(now))
                .query((rs, n) -> rs.getObject(1, UUID.class))
                .optional();
    }

    /** Consumes the token atomically; false if another request consumed it first. */
    public boolean consume(byte[] tokenHash, Purpose purpose, Instant now) {
        return jdbc.sql("""
                UPDATE email_token SET used_at = :now
                 WHERE token_hash = :hash AND purpose = :purpose AND used_at IS NULL AND expires_at > :now
                """)
                .param("now", Timestamp.from(now))
                .param("hash", tokenHash)
                .param("purpose", purpose.name())
                .update() == 1;
    }

    public int deleteExpiredBefore(Instant cutoff) {
        return jdbc.sql("DELETE FROM email_token WHERE expires_at < :cutoff OR used_at < :cutoff")
                .param("cutoff", Timestamp.from(cutoff))
                .update();
    }
}
