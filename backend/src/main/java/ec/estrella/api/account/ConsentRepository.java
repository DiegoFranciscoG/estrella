package ec.estrella.api.account;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class ConsentRepository {

    private final JdbcClient jdbc;

    public ConsentRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void grant(UUID userId, Consent purpose, String noticeVersion) {
        jdbc.sql("INSERT INTO consent_record (id, user_id, purpose, notice_version) VALUES (:id, :user, :purpose, :version)")
                .param("id", UUID.randomUUID())
                .param("user", userId)
                .param("purpose", purpose.name())
                .param("version", noticeVersion)
                .update();
    }

    public record Entry(Consent purpose, String noticeVersion, Instant grantedAt, Instant revokedAt) {
    }

    /** Marks the active consent for a purpose as revoked; returns whether there was one. */
    public boolean revoke(UUID userId, Consent purpose, Instant when) {
        return jdbc.sql("UPDATE consent_record SET revoked_at = :when WHERE user_id = :user AND purpose = :purpose AND revoked_at IS NULL")
                .param("when", Timestamp.from(when))
                .param("user", userId)
                .param("purpose", purpose.name())
                .update() > 0;
    }

    /** Every consent given and revoked, for the data export (LOPDP art. 13). */
    public List<Entry> history(UUID userId) {
        return jdbc.sql("SELECT purpose, notice_version, granted_at, revoked_at FROM consent_record WHERE user_id = :user ORDER BY granted_at")
                .param("user", userId)
                .query((rs, n) -> {
                    Timestamp revoked = rs.getTimestamp(4);
                    return new Entry(Consent.valueOf(rs.getString(1)), rs.getString(2), rs.getTimestamp(3).toInstant(),
                            revoked == null ? null : revoked.toInstant());
                })
                .list();
    }

    public Set<Consent> active(UUID userId) {
        return Set.copyOf(jdbc.sql("SELECT DISTINCT purpose FROM consent_record WHERE user_id = :user AND revoked_at IS NULL")
                .param("user", userId)
                .query((rs, n) -> Consent.valueOf(rs.getString(1)))
                .list());
    }
}
