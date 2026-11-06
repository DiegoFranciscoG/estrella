package ec.estrella.api.project;

import ec.estrella.api.account.Consent;
import ec.estrella.api.account.ConsentRepository;
import ec.estrella.api.account.UserRecord;
import ec.estrella.api.account.UserRepository;
import ec.estrella.api.auth.AttemptLimiter;
import ec.estrella.api.common.ApiException;
import ec.estrella.api.common.Tokens;
import ec.estrella.api.config.AppProperties;
import ec.estrella.api.project.ProjectRepository.Content;
import ec.estrella.api.project.ProjectRepository.ProjectRow;
import ec.estrella.api.project.ProjectRepository.VersionRow;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Encrypted project sync. The server stores opaque bytes: it checks who owns them, how much space
 * they take and that they arrived whole, and never needs to understand them.
 */
@Service
public class ProjectService {

    /** AES-GCM: 12-byte nonce in front of the ciphertext, 16-byte tag at its end. */
    static final int NONCE_BYTES = 12;
    static final int MIN_SEALED_BYTES = NONCE_BYTES + 16 + 1;

    public record Summary(UUID id, String programId, byte[] name, long version, long sizeBytes, Instant createdAt,
                          Instant updatedAt) {
    }

    public record Listing(List<Summary> projects, long storageUsedBytes, long storageQuotaBytes, long maxVersionBytes,
                          UUID syncEpoch) {
    }

    public record Upload(long version, long sizeBytes, long storageUsedBytes, long storageQuotaBytes) {
    }

    private final ProjectRepository projects;
    private final UserRepository users;
    private final ConsentRepository consents;
    private final AttemptLimiter limiter;
    private final AppProperties.Sync limits;
    private final Clock clock;

    public ProjectService(ProjectRepository projects, UserRepository users, ConsentRepository consents,
                          AttemptLimiter limiter, AppProperties properties, Clock clock) {
        this.projects = projects;
        this.users = users;
        this.consents = consents;
        this.limiter = limiter;
        this.limits = properties.sync();
        this.clock = clock;
    }

    public long maxVersionBytes() {
        return limits.maxVersionBytes();
    }

    public Listing list(UUID userId) {
        UserRecord user = requireSync(userId);
        List<Summary> list = projects.list(userId).stream().map(ProjectService::summary).toList();
        return new Listing(list, user.storageUsedBytes(), user.storageQuotaBytes(), limits.maxVersionBytes(),
                users.syncEpoch(userId));
    }

    /** Creates the project, or renames it if it is already this account's. */
    @Transactional
    public Summary save(UUID userId, UUID id, String programId, byte[] encryptedName) {
        requireSync(userId);
        requireSealed(encryptedName, 2048, "El nombre cifrado no es válido");
        Instant now = clock.instant();
        if (projects.find(userId, id).isPresent()) {
            projects.rename(userId, id, encryptedName, now);
        } else {
            // Another account's project with this id looks exactly like a missing one.
            if (projects.exists(id)) {
                throw notFound();
            }
            if (projects.count(userId) >= limits.maxProjects()) {
                throw new ApiException(HttpStatus.CONFLICT, "TOO_MANY_PROJECTS",
                        "Llegaste al máximo de " + limits.maxProjects() + " proyectos en la nube");
            }
            if (!projects.insert(userId, id, programId, encryptedName, now)) {
                throw notFound();
            }
        }
        return summary(projects.find(userId, id).orElseThrow());
    }

    /**
     * Stores a new version if the client started from the current one (`baseVersion`); otherwise
     * another device saved first and nothing is overwritten (412). Old versions beyond the kept
     * number are pruned; if the quota still does not allow it, nothing changes (507).
     */
    @Transactional
    public Upload upload(UUID userId, UUID id, long baseVersion, byte[] sealed, byte[] declaredSha256) {
        requireSync(userId);
        if (sealed.length > limits.maxVersionBytes()) {
            throw tooLarge();
        }
        requireSealed(sealed, Long.MAX_VALUE, "El contenido cifrado no es válido");
        if (declaredSha256 == null || !MessageDigest.isEqual(declaredSha256, Tokens.sha256(sealed))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INTEGRITY", "El contenido llegó incompleto. Se intentará de nuevo");
        }
        if (!limiter.tryAcquire("sync-upload:" + userId, limits.uploadsPerMinute(), Duration.ofMinutes(1))) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_UPLOADS", "Demasiados guardados seguidos; se reintentará en un minuto");
        }
        long current = projects.lockCurrentVersion(userId, id).orElseThrow(ProjectService::notFound);
        if (current != baseVersion) {
            throw new ApiException(HttpStatus.PRECONDITION_FAILED, "VERSION_CONFLICT",
                    "Otro equipo guardó una versión más nueva", Map.of("currentVersion", current));
        }
        long next = current + 1;
        // Keep the newest versions, counting the one being added.
        long freed = projects.deleteVersionsBelow(id, next - limits.versionsKept() + 1);
        if (freed > 0) {
            users.addStorage(userId, -freed);
        }
        if (!users.addStorage(userId, sealed.length)) {
            // Out of space: make room with older versions of this same project, keeping the current one.
            long more = projects.deleteVersionsBelow(id, current);
            if (more > 0) {
                users.addStorage(userId, -more);
            }
            if (!users.addStorage(userId, sealed.length)) {
                throw new ApiException(HttpStatus.INSUFFICIENT_STORAGE, "QUOTA_EXCEEDED",
                        "No cabe en tu espacio en la nube. Sigue guardado en este equipo");
            }
        }
        Instant now = clock.instant();
        projects.insertVersion(id, next, "v1/" + UUID.randomUUID(), sealed, Arrays.copyOf(sealed, NONCE_BYTES),
                declaredSha256, now);
        UserRecord user = users.findById(userId).orElseThrow();
        return new Upload(next, sealed.length, user.storageUsedBytes(), user.storageQuotaBytes());
    }

    public Content content(UUID userId, UUID id, Long version) {
        requireSync(userId);
        ProjectRow project = projects.find(userId, id).orElseThrow(ProjectService::notFound);
        long wanted = version == null ? project.currentVersion() : version;
        if (wanted < 1) {
            throw new ApiException(HttpStatus.NOT_FOUND, "EMPTY", "Este proyecto todavía no tiene contenido en la nube");
        }
        return projects.content(userId, id, wanted).orElseThrow(ProjectService::notFound);
    }

    public long currentVersion(UUID userId, UUID id) {
        requireSync(userId);
        return projects.find(userId, id).orElseThrow(ProjectService::notFound).currentVersion();
    }

    public List<VersionRow> versions(UUID userId, UUID id) {
        requireSync(userId);
        projects.find(userId, id).orElseThrow(ProjectService::notFound);
        return projects.versions(userId, id);
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        requireSync(userId);
        long freed = projects.delete(userId, id);
        if (freed < 0) {
            throw notFound();
        }
        users.addStorage(userId, -freed);
    }

    /** Removes every synced project of the account (consent revoked, or keys reset without recovery). */
    @Transactional
    public int deleteAll(UUID userId) {
        int deleted = projects.deleteAll(userId);
        users.setStorageUsed(userId, 0);
        users.renewSyncEpoch(userId);
        return deleted;
    }

    private UserRecord requireSync(UUID userId) {
        UserRecord user = users.findById(userId).orElseThrow(() ->
                new ApiException(HttpStatus.UNAUTHORIZED, "SESSION_EXPIRED", "Inicia sesión de nuevo"));
        if (!consents.active(userId).contains(Consent.PROJECT_SYNC)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "SYNC_DISABLED",
                    "La sincronización está desactivada. Puedes activarla en Mi cuenta");
        }
        return user;
    }

    private static void requireSealed(byte[] sealed, long max, String message) {
        if (sealed == null || sealed.length < MIN_SEALED_BYTES || sealed.length > max) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CIPHERTEXT", message);
        }
    }

    private ApiException tooLarge() {
        return new ApiException(HttpStatus.CONTENT_TOO_LARGE, "TOO_LARGE",
                "Este proyecto supera " + (limits.maxVersionBytes() / 1_048_576) + " MB cifrado; queda guardado solo en este equipo");
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "El proyecto no existe");
    }

    private static Summary summary(ProjectRow r) {
        return new Summary(r.id(), r.programId(), r.encryptedName(), r.currentVersion(), r.sizeBytes(), r.createdAt(),
                r.updatedAt());
    }
}
