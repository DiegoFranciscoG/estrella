package ec.estrella.api.account;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Read-only queries for the personal data export (LOPDP arts. 13 and 17). */
@Repository
public class PersonalDataRepository {

    public record AccountData(String email, Instant createdAt, Instant emailVerifiedAt, boolean hasAvatar,
                              long storageUsedBytes, long storageQuotaBytes) {
    }

    public record SessionData(Instant createdAt, Instant expiresAt, Instant revokedAt) {
    }

    public record ProgramData(String programId, Instant thanksSeenAt) {
    }

    public record VersionData(long version, long sizeBytes, Instant createdAt) {
    }

    public record ProjectData(UUID id, String programId, long currentVersion, Instant createdAt, Instant updatedAt,
                              List<VersionData> versions) {
    }

    private final JdbcClient jdbc;

    public PersonalDataRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public AccountData account(UUID userId) {
        return jdbc.sql("""
                SELECT email, created_at, email_verified_at, avatar IS NOT NULL, storage_used_bytes, storage_quota_bytes
                  FROM user_account WHERE id = :id
                """)
                .param("id", userId)
                .query((rs, n) -> new AccountData(rs.getString(1), instant(rs.getTimestamp(2)), instant(rs.getTimestamp(3)),
                        rs.getBoolean(4), rs.getLong(5), rs.getLong(6)))
                .single();
    }

    public List<SessionData> sessions(UUID userId) {
        return jdbc.sql("SELECT created_at, expires_at, revoked_at FROM user_session WHERE user_id = :id ORDER BY created_at")
                .param("id", userId)
                .query((rs, n) -> new SessionData(instant(rs.getTimestamp(1)), instant(rs.getTimestamp(2)), instant(rs.getTimestamp(3))))
                .list();
    }

    public List<ProgramData> programs(UUID userId) {
        return jdbc.sql("SELECT program_id, thanks_seen_at FROM program_state WHERE user_id = :id ORDER BY program_id")
                .param("id", userId)
                .query((rs, n) -> new ProgramData(rs.getString(1), instant(rs.getTimestamp(2))))
                .list();
    }

    public List<ProjectData> projects(UUID userId) {
        List<VersionRow> versions = jdbc.sql("""
                SELECT v.project_id, v.version, v.size_bytes, v.created_at
                  FROM project_version v JOIN project p ON p.id = v.project_id
                 WHERE p.user_id = :id ORDER BY v.version DESC
                """)
                .param("id", userId)
                .query((rs, n) -> new VersionRow(rs.getObject(1, UUID.class),
                        new VersionData(rs.getLong(2), rs.getLong(3), instant(rs.getTimestamp(4)))))
                .list();
        return jdbc.sql("SELECT id, program_id, current_version, created_at, updated_at FROM project WHERE user_id = :id ORDER BY created_at")
                .param("id", userId)
                .query((rs, n) -> {
                    UUID id = rs.getObject(1, UUID.class);
                    return new ProjectData(id, rs.getString(2), rs.getLong(3), instant(rs.getTimestamp(4)),
                            instant(rs.getTimestamp(5)),
                            versions.stream().filter(v -> v.projectId().equals(id)).map(VersionRow::data).toList());
                })
                .list();
    }

    private record VersionRow(UUID projectId, VersionData data) {
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }
}
