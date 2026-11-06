package ec.estrella.api.project;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Projects, their versions and the encrypted bytes of each version. Every query that reads or
 * changes a project filters by its owner, so one account can never reach another's rows (T-08).
 */
@Repository
public class ProjectRepository {

    public record ProjectRow(UUID id, String programId, byte[] encryptedName, long currentVersion,
                             long sizeBytes, Instant createdAt, Instant updatedAt) {
    }

    public record VersionRow(long version, long sizeBytes, byte[] sha256, Instant createdAt) {
    }

    public record Content(long version, byte[] data, byte[] sha256) {
    }

    private static final String PROJECT_COLUMNS = """
            p.id, p.program_id, p.encrypted_name, p.current_version, p.created_at, p.updated_at,
            COALESCE((SELECT v.size_bytes FROM project_version v
                       WHERE v.project_id = p.id AND v.version = p.current_version), 0) AS size_bytes
            """;

    private final JdbcClient jdbc;

    public ProjectRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<ProjectRow> list(UUID userId) {
        return jdbc.sql("SELECT " + PROJECT_COLUMNS + " FROM project p WHERE p.user_id = :user ORDER BY p.updated_at DESC")
                .param("user", userId)
                .query(ProjectRepository::mapProject)
                .list();
    }

    public Optional<ProjectRow> find(UUID userId, UUID id) {
        return jdbc.sql("SELECT " + PROJECT_COLUMNS + " FROM project p WHERE p.id = :id AND p.user_id = :user")
                .param("id", id)
                .param("user", userId)
                .query(ProjectRepository::mapProject)
                .optional();
    }

    public boolean exists(UUID id) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM project WHERE id = :id)").param("id", id).query(Boolean.class).single();
    }

    public int count(UUID userId) {
        return jdbc.sql("SELECT count(*) FROM project WHERE user_id = :user").param("user", userId).query(Integer.class).single();
    }

    /** Creates the project; false if the id is already taken (by this account or another). */
    public boolean insert(UUID userId, UUID id, String programId, byte[] encryptedName, Instant now) {
        return jdbc.sql("""
                INSERT INTO project (id, user_id, program_id, encrypted_name, created_at, updated_at)
                VALUES (:id, :user, :program, :name, :now, :now)
                ON CONFLICT (id) DO NOTHING
                """)
                .param("id", id)
                .param("user", userId)
                .param("program", programId)
                .param("name", encryptedName)
                .param("now", Timestamp.from(now))
                .update() == 1;
    }

    public boolean rename(UUID userId, UUID id, byte[] encryptedName, Instant now) {
        return jdbc.sql("UPDATE project SET encrypted_name = :name, updated_at = :now WHERE id = :id AND user_id = :user")
                .param("name", encryptedName)
                .param("now", Timestamp.from(now))
                .param("id", id)
                .param("user", userId)
                .update() == 1;
    }

    /** Current version, locking the row until the transaction ends so two uploads cannot both win. */
    public Optional<Long> lockCurrentVersion(UUID userId, UUID id) {
        return jdbc.sql("SELECT current_version FROM project WHERE id = :id AND user_id = :user FOR UPDATE")
                .param("id", id)
                .param("user", userId)
                .query(Long.class)
                .optional();
    }

    public void insertVersion(UUID projectId, long version, String storageKey, byte[] data, byte[] nonce, byte[] sha256,
                              Instant now) {
        jdbc.sql("""
                INSERT INTO project_version (id, project_id, version, storage_key, size_bytes, nonce, sha256, created_at)
                VALUES (:id, :project, :version, :key, :size, :nonce, :sha, :now)
                """)
                .param("id", UUID.randomUUID())
                .param("project", projectId)
                .param("version", version)
                .param("key", storageKey)
                .param("size", (long) data.length)
                .param("nonce", nonce)
                .param("sha", sha256)
                .param("now", Timestamp.from(now))
                .update();
        jdbc.sql("INSERT INTO project_blob (storage_key, data) VALUES (:key, :data)")
                .param("key", storageKey)
                .param("data", data)
                .update();
        jdbc.sql("UPDATE project SET current_version = :version, updated_at = :now WHERE id = :project")
                .param("version", version)
                .param("now", Timestamp.from(now))
                .param("project", projectId)
                .update();
    }

    /** Deletes the versions numbered below `keepFrom` (their bytes go by cascade); returns the bytes freed. */
    public long deleteVersionsBelow(UUID projectId, long keepFrom) {
        return jdbc.sql("""
                WITH gone AS (
                    DELETE FROM project_version WHERE project_id = :project AND version < :keep RETURNING size_bytes
                )
                SELECT COALESCE(sum(size_bytes), 0) FROM gone
                """)
                .param("project", projectId)
                .param("keep", keepFrom)
                .query(Long.class)
                .single();
    }

    public List<VersionRow> versions(UUID userId, UUID id) {
        return jdbc.sql("""
                SELECT v.version, v.size_bytes, v.sha256, v.created_at
                  FROM project_version v JOIN project p ON p.id = v.project_id
                 WHERE p.id = :id AND p.user_id = :user
                 ORDER BY v.version DESC
                """)
                .param("id", id)
                .param("user", userId)
                .query((rs, n) -> new VersionRow(rs.getLong(1), rs.getLong(2), rs.getBytes(3), rs.getTimestamp(4).toInstant()))
                .list();
    }

    public Optional<Content> content(UUID userId, UUID id, long version) {
        return jdbc.sql("""
                SELECT v.version, b.data, v.sha256
                  FROM project_version v
                  JOIN project p ON p.id = v.project_id
                  JOIN project_blob b ON b.storage_key = v.storage_key
                 WHERE p.id = :id AND p.user_id = :user AND v.version = :version
                """)
                .param("id", id)
                .param("user", userId)
                .param("version", version)
                .query((rs, n) -> new Content(rs.getLong(1), rs.getBytes(2), rs.getBytes(3)))
                .optional();
    }

    /** Deletes one project with its versions and bytes; returns the bytes freed, or -1 if it was not there. */
    public long delete(UUID userId, UUID id) {
        long size = jdbc.sql("""
                SELECT COALESCE(sum(v.size_bytes), 0) FROM project_version v JOIN project p ON p.id = v.project_id
                 WHERE p.id = :id AND p.user_id = :user
                """)
                .param("id", id)
                .param("user", userId)
                .query(Long.class)
                .single();
        int rows = jdbc.sql("DELETE FROM project WHERE id = :id AND user_id = :user")
                .param("id", id)
                .param("user", userId)
                .update();
        return rows == 1 ? size : -1;
    }

    /** Deletes every project of the account; returns how many. */
    public int deleteAll(UUID userId) {
        return jdbc.sql("DELETE FROM project WHERE user_id = :user").param("user", userId).update();
    }

    /** Bytes really stored for the account, to check the counter kept in user_account. */
    public long storedBytes(UUID userId) {
        return jdbc.sql("""
                SELECT COALESCE(sum(v.size_bytes), 0) FROM project_version v JOIN project p ON p.id = v.project_id
                 WHERE p.user_id = :user
                """)
                .param("user", userId)
                .query(Long.class)
                .single();
    }

    private static ProjectRow mapProject(ResultSet rs, int row) throws SQLException {
        return new ProjectRow(
                rs.getObject("id", UUID.class),
                rs.getString("program_id"),
                rs.getBytes("encrypted_name"),
                rs.getLong("current_version"),
                rs.getLong("size_bytes"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }
}
