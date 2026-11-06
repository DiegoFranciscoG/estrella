package ec.estrella.api.account;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {

    private static final String COLUMNS = "id, email, password_hash, email_verified_at, wrapped_key_password, "
            + "wrapped_key_recovery, key_salt, storage_used_bytes, storage_quota_bytes, avatar IS NOT NULL AS has_avatar";

    private final JdbcClient jdbc;

    public UserRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(UserRecord user) {
        jdbc.sql("""
                INSERT INTO user_account (id, email, password_hash, wrapped_key_password, wrapped_key_recovery,
                                          key_salt, storage_quota_bytes)
                VALUES (:id, :email, :hash, :wkp, :wkr, :salt, :quota)
                """)
                .param("id", user.id())
                .param("email", user.email())
                .param("hash", user.passwordHash())
                .param("wkp", user.wrappedKeyPassword())
                .param("wkr", user.wrappedKeyRecovery())
                .param("salt", user.keySalt())
                .param("quota", user.storageQuotaBytes())
                .update();
    }

    public Optional<UserRecord> findByEmail(String email) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM user_account WHERE email = :email")
                .param("email", email)
                .query(UserRepository::map)
                .optional();
    }

    public Optional<UserRecord> findById(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM user_account WHERE id = :id")
                .param("id", id)
                .query(UserRepository::map)
                .optional();
    }

    public void markVerified(UUID id, Instant when) {
        jdbc.sql("UPDATE user_account SET email_verified_at = :when WHERE id = :id AND email_verified_at IS NULL")
                .param("when", java.sql.Timestamp.from(when))
                .param("id", id)
                .update();
    }

    public void updateCredentials(UUID id, String passwordHash, byte[] keySalt, byte[] wrappedKeyPassword,
                                  byte[] wrappedKeyRecovery) {
        jdbc.sql("""
                UPDATE user_account
                   SET password_hash = :hash, key_salt = :salt,
                       wrapped_key_password = :wkp, wrapped_key_recovery = :wkr
                 WHERE id = :id
                """)
                .param("hash", passwordHash)
                .param("salt", keySalt)
                .param("wkp", wrappedKeyPassword)
                .param("wkr", wrappedKeyRecovery)
                .param("id", id)
                .update();
    }

    public void setAvatar(UUID id, byte[] avatar) {
        jdbc.sql("UPDATE user_account SET avatar = :avatar WHERE id = :id")
                .param("avatar", avatar)
                .param("id", id)
                .update();
    }

    public Optional<byte[]> findAvatar(UUID id) {
        return jdbc.sql("SELECT avatar FROM user_account WHERE id = :id AND avatar IS NOT NULL")
                .param("id", id)
                .query((rs, n) -> rs.getBytes(1))
                .optional();
    }

    public boolean delete(UUID id) {
        return jdbc.sql("DELETE FROM user_account WHERE id = :id").param("id", id).update() == 1;
    }

    public int deleteUnverifiedCreatedBefore(Instant cutoff) {
        return jdbc.sql("DELETE FROM user_account WHERE email_verified_at IS NULL AND created_at < :cutoff")
                .param("cutoff", java.sql.Timestamp.from(cutoff))
                .update();
    }

    private static UserRecord map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        java.sql.Timestamp verified = rs.getTimestamp("email_verified_at");
        return new UserRecord(
                rs.getObject("id", UUID.class),
                rs.getString("email"),
                rs.getString("password_hash"),
                verified == null ? null : verified.toInstant(),
                rs.getBytes("wrapped_key_password"),
                rs.getBytes("wrapped_key_recovery"),
                rs.getBytes("key_salt"),
                rs.getLong("storage_used_bytes"),
                rs.getLong("storage_quota_bytes"),
                rs.getBoolean("has_avatar"));
    }
}
