package ec.estrella.api.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import ec.estrella.api.common.Tokens;
import ec.estrella.api.support.IntegrationTest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Encrypted project sync end to end against PostgreSQL: T-08 (accounts and devices never mix),
 * T-10 (deleting leaves no row and no stored bytes), quotas, versions and the data export.
 */
class ProjectSyncIntegrationTest extends IntegrationTest {

    private static final AtomicInteger IP = new AtomicInteger(1);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String[] USER_TABLES = {"user_session", "email_token", "consent_record", "project", "program_state"};

    private final String ip = "10.6." + (IP.get() / 250) + "." + (IP.getAndIncrement() % 250 + 1);

    private record Student(UUID id, String email, String authKey, String bearer) {
    }

    private MockHttpServletRequestBuilder as(Student s, MockHttpServletRequestBuilder b) {
        return b.header("Authorization", s.bearer()).with(r -> {
            r.setRemoteAddr(ip);
            return r;
        });
    }

    private MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder b, String body) {
        return b.with(r -> {
            r.setRemoteAddr(ip);
            return r;
        }).contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private Student student(boolean sync) throws Exception {
        String email = uniqueEmail();
        String key = randomKey(32);
        String consents = sync ? "\"ACCOUNT\",\"PROJECT_SYNC\"" : "\"ACCOUNT\"";
        mvc.perform(json(post("/api/v1/auth/register"), """
                {"email":"%s","authKey":"%s","ageConfirmed":true,"consents":[%s],
                 "keyBundle":{"kdfSalt":"%s","wrappedKeyPassword":"%s","wrappedKeyRecovery":"%s"}}
                """.formatted(email, key, consents, randomKey(16), randomKey(60), randomKey(60))))
                .andExpect(status().isAccepted());
        mvc.perform(json(post("/api/v1/auth/verify-email"), "{\"token\":\"" + mail.lastToken(email) + "\"}"))
                .andExpect(status().isOk());
        String body = mvc.perform(json(post("/api/v1/auth/login"), "{\"email\":\"%s\",\"authKey\":\"%s\"}".formatted(email, key)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String token = JsonPath.read(body, "$.accessToken");
        UUID id = jdbc.sql("SELECT id FROM user_account WHERE email = :e").param("e", email).query(UUID.class).single();
        return new Student(id, email, key, "Bearer " + token);
    }

    /** What a device sends: a 12-byte nonce, then ciphertext and tag. Random bytes look the same to the server. */
    private static byte[] sealed(int size) {
        byte[] b = new byte[size];
        RANDOM.nextBytes(b);
        return b;
    }

    private static String sha(byte[] b) {
        return Base64.getEncoder().encodeToString(Tokens.sha256(b));
    }

    private static String name() {
        return Base64.getEncoder().encodeToString(sealed(60));
    }

    private ResultActions create(Student s, UUID project) throws Exception {
        return mvc.perform(as(s, put("/api/v1/projects/" + project))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"programId\":\"plano\",\"name\":\"%s\"}".formatted(name())));
    }

    private ResultActions upload(Student s, UUID project, long base, byte[] data) throws Exception {
        return mvc.perform(as(s, put("/api/v1/projects/" + project + "/content"))
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header("If-Match", "\"" + base + "\"")
                .header("X-Content-SHA256", sha(data))
                .content(data));
    }

    private long count(String sql, Object id) {
        return jdbc.sql(sql).param("id", id).query(Long.class).single();
    }

    @Test
    void syncNeedsItsOwnConsent() throws Exception {
        Student s = student(false);
        mvc.perform(as(s, get("/api/v1/projects")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SYNC_DISABLED"));
        mvc.perform(as(s, put("/api/v1/me/consents/PROJECT_SYNC"))).andExpect(status().isNoContent());
        mvc.perform(as(s, get("/api/v1/projects")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projects", hasSize(0)))
                .andExpect(jsonPath("$.storageQuotaBytes").value(org.hamcrest.Matchers.greaterThan(0)));
        // The account consent cannot be withdrawn without deleting the account.
        mvc.perform(as(s, delete("/api/v1/me/consents/ACCOUNT"))).andExpect(status().isBadRequest());
        mvc.perform(as(s, put("/api/v1/me/consents/NOT_A_PURPOSE"))).andExpect(status().isBadRequest());
    }

    @Test
    void uploadsVersionsAndDownloadsExactlyTheSameBytes() throws Exception {
        Student s = student(true);
        UUID project = UUID.randomUUID();
        create(s, project).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(0));
        byte[] v1 = sealed(500);
        upload(s, project, 0, v1)
                .andExpect(status().isOk())
                .andExpect(header().string("ETag", "\"1\""))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.storageUsedBytes").value(500));
        byte[] stored = mvc.perform(as(s, get("/api/v1/projects/" + project + "/content")))
                .andExpect(status().isOk())
                .andExpect(header().string("ETag", "\"1\""))
                .andExpect(header().string("X-Content-SHA256", sha(v1)))
                .andReturn().getResponse().getContentAsByteArray();
        assertThat(stored).isEqualTo(v1);
        // A device that already has version 1 downloads nothing.
        mvc.perform(as(s, get("/api/v1/projects/" + project + "/content")).header("If-None-Match", "\"1\""))
                .andExpect(status().isNotModified());
        mvc.perform(as(s, get("/api/v1/projects")))
                .andExpect(jsonPath("$.projects[0].id").value(project.toString()))
                .andExpect(jsonPath("$.projects[0].version").value(1))
                .andExpect(jsonPath("$.projects[0].sizeBytes").value(500));
    }

    /** T-08, devices: a device that started from an older version cannot overwrite a newer one. */
    @Test
    void anOlderBaseVersionNeverOverwritesANewerOne() throws Exception {
        Student s = student(true);
        UUID project = UUID.randomUUID();
        create(s, project).andExpect(status().isOk());
        upload(s, project, 0, sealed(100)).andExpect(status().isOk());
        upload(s, project, 1, sealed(100)).andExpect(status().isOk());
        // The second device still thinks version 1 is the latest.
        upload(s, project, 1, sealed(100))
                .andExpect(status().isPreconditionFailed())
                .andExpect(jsonPath("$.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.currentVersion").value(2));
        mvc.perform(as(s, put("/api/v1/projects/" + project + "/content"))
                        .contentType(MediaType.APPLICATION_OCTET_STREAM).content(sealed(100)))
                .andExpect(status().isPreconditionRequired());
        assertThat(count("SELECT current_version FROM project WHERE id = :id", project)).isEqualTo(2);
    }

    @Test
    void rejectsDamagedTooSmallAndTooLargeContent() throws Exception {
        Student s = student(true);
        UUID project = UUID.randomUUID();
        create(s, project).andExpect(status().isOk());
        byte[] data = sealed(200);
        mvc.perform(as(s, put("/api/v1/projects/" + project + "/content"))
                        .contentType(MediaType.APPLICATION_OCTET_STREAM)
                        .header("If-Match", "\"0\"").header("X-Content-SHA256", sha(sealed(200))).content(data))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INTEGRITY"));
        upload(s, project, 0, sealed(20)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CIPHERTEXT"));
        upload(s, project, 0, sealed(10 * 1_048_576 + 1)).andExpect(status().isPayloadTooLarge());
        mvc.perform(as(s, put("/api/v1/projects/" + project + "/content"))
                        .contentType(MediaType.APPLICATION_OCTET_STREAM)
                        .header("If-Match", "W/\"0\"").header("X-Content-SHA256", sha(data)).content(data))
                .andExpect(status().isBadRequest());
        assertThat(count("SELECT count(*) FROM project_version WHERE project_id = :id", project)).isZero();
    }

    @Test
    void keepsTheNewestVersionsAndCountsTheirSizeExactly() throws Exception {
        Student s = student(true);
        UUID project = UUID.randomUUID();
        create(s, project).andExpect(status().isOk());
        for (int v = 0; v < 8; v++) {
            upload(s, project, v, sealed(1000 + v)).andExpect(status().isOk());
        }
        String versions = mvc.perform(as(s, get("/api/v1/projects/" + project + "/versions")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        List<Integer> kept = JsonPath.read(versions, "$[*].version");
        assertThat(kept).containsExactly(8, 7, 6, 5, 4);
        long used = count("SELECT storage_used_bytes FROM user_account WHERE id = :id", s.id());
        // Versions 4 to 8 were 1003 to 1007 bytes.
        assertThat(used).isEqualTo(1003 + 1004 + 1005 + 1006 + 1007);
        assertThat(used).isEqualTo(count("""
                SELECT COALESCE(sum(v.size_bytes), 0) FROM project_version v JOIN project p ON p.id = v.project_id WHERE p.user_id = :id
                """, s.id()));
        // An old version is still readable; a pruned one is gone.
        mvc.perform(as(s, get("/api/v1/projects/" + project + "/versions/4"))).andExpect(status().isOk());
        mvc.perform(as(s, get("/api/v1/projects/" + project + "/versions/3"))).andExpect(status().isNotFound());
    }

    @Test
    void outOfSpaceMakesRoomWithOldVersionsOrChangesNothing() throws Exception {
        Student s = student(true);
        jdbc.sql("UPDATE user_account SET storage_quota_bytes = 3000 WHERE id = :id").param("id", s.id()).update();
        UUID project = UUID.randomUUID();
        create(s, project).andExpect(status().isOk());
        upload(s, project, 0, sealed(1000)).andExpect(status().isOk());
        upload(s, project, 1, sealed(1000)).andExpect(status().isOk());
        // 2000 used of 3000: a 1500-byte version fits only by dropping version 1.
        upload(s, project, 2, sealed(1500)).andExpect(status().isOk()).andExpect(jsonPath("$.storageUsedBytes").value(2500));
        // Nothing older is left to drop: refused, and nothing changed.
        upload(s, project, 3, sealed(2000))
                .andExpect(status().isInsufficientStorage())
                .andExpect(jsonPath("$.code").value("QUOTA_EXCEEDED"));
        assertThat(count("SELECT current_version FROM project WHERE id = :id", project)).isEqualTo(3);
        assertThat(count("SELECT storage_used_bytes FROM user_account WHERE id = :id", s.id())).isEqualTo(2500);
    }

    /** T-08, accounts: another student's project behaves exactly like one that does not exist. */
    @Test
    void oneAccountNeverReachesAnothersProjects() throws Exception {
        Student ana = student(true);
        Student luis = student(true);
        UUID project = UUID.randomUUID();
        create(ana, project).andExpect(status().isOk());
        upload(ana, project, 0, sealed(300)).andExpect(status().isOk());

        mvc.perform(as(luis, get("/api/v1/projects"))).andExpect(jsonPath("$.projects", hasSize(0)));
        mvc.perform(as(luis, get("/api/v1/projects/" + project + "/content"))).andExpect(status().isNotFound());
        mvc.perform(as(luis, get("/api/v1/projects/" + project + "/versions"))).andExpect(status().isNotFound());
        mvc.perform(as(luis, get("/api/v1/projects/" + project + "/versions/1"))).andExpect(status().isNotFound());
        upload(luis, project, 1, sealed(300)).andExpect(status().isNotFound());
        create(luis, project).andExpect(status().isNotFound());
        mvc.perform(as(luis, delete("/api/v1/projects/" + project))).andExpect(status().isNotFound());

        assertThat(count("SELECT current_version FROM project WHERE id = :id", project)).isEqualTo(1);
        assertThat(jdbc.sql("SELECT user_id FROM project WHERE id = :id").param("id", project).query(UUID.class).single())
                .isEqualTo(ana.id());
        mvc.perform(as(luis, get("/api/v1/projects/not-a-uuid/content"))).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/projects")).andExpect(status().isUnauthorized());
    }

    @Test
    void deletingAProjectRemovesItsVersionsAndBytes() throws Exception {
        Student s = student(true);
        UUID project = UUID.randomUUID();
        create(s, project).andExpect(status().isOk());
        upload(s, project, 0, sealed(400)).andExpect(status().isOk());
        upload(s, project, 1, sealed(400)).andExpect(status().isOk());
        List<String> keys = jdbc.sql("SELECT storage_key FROM project_version WHERE project_id = :id").param("id", project)
                .query(String.class).list();
        mvc.perform(as(s, delete("/api/v1/projects/" + project))).andExpect(status().isNoContent());
        assertThat(count("SELECT count(*) FROM project_version WHERE project_id = :id", project)).isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM project_blob WHERE storage_key IN (:keys)").param("keys", keys)
                .query(Long.class).single()).isZero();
        assertThat(count("SELECT storage_used_bytes FROM user_account WHERE id = :id", s.id())).isZero();
        mvc.perform(as(s, delete("/api/v1/projects/" + project))).andExpect(status().isNotFound());
    }

    /** LOPDP art. 15.6: withdrawing consent deletes the server copies. */
    @Test
    void revokingSyncDeletesEveryServerCopy() throws Exception {
        Student s = student(true);
        for (int i = 0; i < 3; i++) {
            UUID project = UUID.randomUUID();
            create(s, project).andExpect(status().isOk());
            upload(s, project, 0, sealed(100)).andExpect(status().isOk());
        }
        String before = JsonPath.read(mvc.perform(as(s, get("/api/v1/projects"))).andReturn().getResponse().getContentAsString(), "$.syncEpoch");
        mvc.perform(as(s, delete("/api/v1/me/consents/PROJECT_SYNC")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deletedProjects").value(3));
        mvc.perform(as(s, put("/api/v1/me/consents/PROJECT_SYNC"))).andExpect(status().isNoContent());
        // A new epoch tells the other devices to upload again rather than delete what they have.
        mvc.perform(as(s, get("/api/v1/projects")))
                .andExpect(jsonPath("$.syncEpoch").value(org.hamcrest.Matchers.not(before)));
        mvc.perform(as(s, delete("/api/v1/me/consents/PROJECT_SYNC"))).andExpect(status().isOk());
        assertThat(count("SELECT count(*) FROM project WHERE user_id = :id", s.id())).isZero();
        assertThat(count("SELECT storage_used_bytes FROM user_account WHERE id = :id", s.id())).isZero();
        // Every grant and revocation stays in the history (LOPDP art. 8: consent must be provable).
        assertThat(count("SELECT count(*) FROM consent_record WHERE user_id = :id AND purpose = 'PROJECT_SYNC' AND revoked_at IS NOT NULL", s.id()))
                .isEqualTo(2);
        mvc.perform(as(s, get("/api/v1/projects"))).andExpect(status().isForbidden());
    }

    /** T-10: deleting the account leaves no row about it and no stored bytes. */
    @Test
    void deletingTheAccountLeavesNothingBehind() throws Exception {
        Student s = student(true);
        UUID project = UUID.randomUUID();
        create(s, project).andExpect(status().isOk());
        upload(s, project, 0, sealed(700)).andExpect(status().isOk());
        upload(s, project, 1, sealed(700)).andExpect(status().isOk());
        mvc.perform(as(s, put("/api/v1/me/thanks/plano"))).andExpect(status().isNoContent());
        List<String> keys = jdbc.sql("SELECT storage_key FROM project_version WHERE project_id = :id").param("id", project)
                .query(String.class).list();
        assertThat(keys).hasSize(2);

        mvc.perform(as(s, post("/api/v1/me/delete")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"authKey\":\"" + s.authKey() + "\"}"))
                .andExpect(status().isNoContent());

        assertThat(count("SELECT count(*) FROM user_account WHERE id = :id", s.id())).isZero();
        for (String table : USER_TABLES) {
            assertThat(count("SELECT count(*) FROM " + table + " WHERE user_id = :id", s.id())).as(table).isZero();
        }
        assertThat(count("SELECT count(*) FROM project_version WHERE project_id = :id", project)).isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM project_blob WHERE storage_key IN (:keys)").param("keys", keys)
                .query(Long.class).single()).isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM user_account WHERE email = :e").param("e", s.email()).query(Long.class).single())
                .isZero();
    }

    @Test
    void aPasswordResetWithoutTheRecoveryCodeDiscardsUnreadableCopies() throws Exception {
        Student s = student(true);
        UUID project = UUID.randomUUID();
        create(s, project).andExpect(status().isOk());
        upload(s, project, 0, sealed(100)).andExpect(status().isOk());
        mvc.perform(json(post("/api/v1/auth/password-reset/request"), "{\"email\":\"" + s.email() + "\"}"))
                .andExpect(status().isAccepted());
        String token = mail.lastToken(s.email());
        mvc.perform(json(post("/api/v1/auth/password-reset/confirm"), """
                {"token":"%s","authKey":"%s","discardEncryptedData":true,
                 "keyBundle":{"kdfSalt":"%s","wrappedKeyPassword":"%s","wrappedKeyRecovery":"%s"}}
                """.formatted(token, randomKey(32), randomKey(16), randomKey(60), randomKey(60))))
                .andExpect(status().isOk());
        assertThat(count("SELECT count(*) FROM project WHERE user_id = :id", s.id())).isZero();
        assertThat(count("SELECT storage_used_bytes FROM user_account WHERE id = :id", s.id())).isZero();
    }

    /** LOPDP arts. 13 and 17: the export has every personal datum the server keeps, and no content. */
    @Test
    void exportsPersonalDataWithoutAnyContent() throws Exception {
        Student s = student(true);
        UUID project = UUID.randomUUID();
        create(s, project).andExpect(status().isOk());
        upload(s, project, 0, sealed(250)).andExpect(status().isOk());
        String body = mvc.perform(as(s, get("/api/v1/me/export")))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.format").value("estrella-datos-personales/1"))
                .andExpect(jsonPath("$.account.email").value(s.email()))
                .andExpect(jsonPath("$.consents[*].purpose").value(org.hamcrest.Matchers.containsInAnyOrder("ACCOUNT", "PROJECT_SYNC")))
                .andExpect(jsonPath("$.sessions", hasSize(1)))
                .andExpect(jsonPath("$.projects[0].id").value(project.toString()))
                .andExpect(jsonPath("$.projects[0].versions[0].sizeBytes").value(250))
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("passwordHash", "wrappedKey", "password_hash", "data\"");
    }
}
