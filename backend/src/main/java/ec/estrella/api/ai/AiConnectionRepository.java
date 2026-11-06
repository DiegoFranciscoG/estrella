package ec.estrella.api.ai;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** One encrypted OpenRouter key per student. Every query is scoped to its owner. */
@Repository
public class AiConnectionRepository {

    public record Connection(byte[] nonce, byte[] ciphertext, Instant createdAt, Instant lastUsedAt) {
    }

    private final JdbcClient jdbc;

    public AiConnectionRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Connecting again replaces the previous key. */
    public void save(UUID userId, AiKeyCipher.Sealed sealed, Instant now) {
        jdbc.sql("""
                INSERT INTO ai_connection (user_id, key_nonce, key_ciphertext, created_at)
                VALUES (:user, :nonce, :ciphertext, :now)
                ON CONFLICT (user_id) DO UPDATE
                   SET key_nonce = EXCLUDED.key_nonce, key_ciphertext = EXCLUDED.key_ciphertext,
                       created_at = EXCLUDED.created_at, last_used_at = NULL
                """)
                .param("user", userId)
                .param("nonce", sealed.nonce())
                .param("ciphertext", sealed.ciphertext())
                .param("now", Timestamp.from(now))
                .update();
    }

    public Optional<Connection> find(UUID userId) {
        return jdbc.sql("SELECT key_nonce, key_ciphertext, created_at, last_used_at FROM ai_connection WHERE user_id = :user")
                .param("user", userId)
                .query((rs, n) -> {
                    Timestamp used = rs.getTimestamp(4);
                    return new Connection(rs.getBytes(1), rs.getBytes(2), rs.getTimestamp(3).toInstant(),
                            used == null ? null : used.toInstant());
                })
                .optional();
    }

    public void touch(UUID userId, Instant when) {
        jdbc.sql("UPDATE ai_connection SET last_used_at = :when WHERE user_id = :user")
                .param("when", Timestamp.from(when))
                .param("user", userId)
                .update();
    }

    /** Returns whether there was a connection. */
    public boolean delete(UUID userId) {
        return jdbc.sql("DELETE FROM ai_connection WHERE user_id = :user").param("user", userId).update() > 0;
    }
}
