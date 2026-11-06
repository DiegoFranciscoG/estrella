package ec.estrella.api.account;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class ProgramStateRepository {

    private final JdbcClient jdbc;

    public ProgramStateRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<String> thanksSeen(UUID userId) {
        return jdbc.sql("SELECT program_id FROM program_state WHERE user_id = :user AND thanks_seen_at IS NOT NULL ORDER BY program_id")
                .param("user", userId)
                .query(String.class)
                .list();
    }

    public void markThanksSeen(UUID userId, String programId, Instant when) {
        jdbc.sql("""
                INSERT INTO program_state (user_id, program_id, thanks_seen_at) VALUES (:user, :program, :when)
                ON CONFLICT (user_id, program_id) DO UPDATE
                   SET thanks_seen_at = COALESCE(program_state.thanks_seen_at, EXCLUDED.thanks_seen_at)
                """)
                .param("user", userId)
                .param("program", programId)
                .param("when", Timestamp.from(when))
                .update();
    }
}
