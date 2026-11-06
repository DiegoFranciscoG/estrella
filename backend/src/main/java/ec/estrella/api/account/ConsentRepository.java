package ec.estrella.api.account;

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

    public Set<Consent> active(UUID userId) {
        return Set.copyOf(jdbc.sql("SELECT DISTINCT purpose FROM consent_record WHERE user_id = :user AND revoked_at IS NULL")
                .param("user", userId)
                .query((rs, n) -> Consent.valueOf(rs.getString(1)))
                .list());
    }
}
