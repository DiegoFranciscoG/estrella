package ec.estrella.api.account;

import ec.estrella.api.account.PersonalDataRepository.AccountData;
import ec.estrella.api.account.PersonalDataRepository.ProgramData;
import ec.estrella.api.account.PersonalDataRepository.ProjectData;
import ec.estrella.api.account.PersonalDataRepository.SessionData;
import ec.estrella.api.common.ApiException;
import ec.estrella.api.config.AppProperties;
import ec.estrella.api.mail.MailService;
import ec.estrella.api.project.ProjectService;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountService {

    public record Profile(String email, boolean hasAvatar, long storageUsedBytes, long storageQuotaBytes,
                          Set<Consent> consents) {
    }

    /** Everything the server keeps about the account, in a common machine-readable format (LOPDP arts. 13 and 17). */
    public record Export(String format, Instant generatedAt, String note, AccountData account,
                         List<ConsentRepository.Entry> consents, List<SessionData> sessions, List<ProgramData> programs,
                         List<ProjectData> projects) {
    }

    private final UserRepository users;
    private final ConsentRepository consents;
    private final ProgramStateRepository programStates;
    private final PersonalDataRepository personalData;
    private final ProjectService projects;
    private final PasswordEncoder encoder;
    private final MailService mail;
    private final AppProperties properties;
    private final Clock clock;

    public AccountService(UserRepository users, ConsentRepository consents, ProgramStateRepository programStates,
                          PersonalDataRepository personalData, ProjectService projects, PasswordEncoder encoder,
                          MailService mail, AppProperties properties, Clock clock) {
        this.users = users;
        this.consents = consents;
        this.programStates = programStates;
        this.personalData = personalData;
        this.projects = projects;
        this.encoder = encoder;
        this.mail = mail;
        this.properties = properties;
        this.clock = clock;
    }

    public Profile profile(UUID userId) {
        UserRecord user = require(userId);
        return new Profile(user.email(), user.hasAvatar(), user.storageUsedBytes(), user.storageQuotaBytes(),
                consents.active(userId));
    }

    public void setAvatar(UUID userId, byte[] image) {
        require(userId);
        ImageType.detect(image).orElseThrow(() -> new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                "INVALID_IMAGE", "La foto debe ser JPG, PNG o WebP"));
        users.setAvatar(userId, image);
    }

    public byte[] avatar(UUID userId) {
        return users.findAvatar(userId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Sin foto"));
    }

    public void removeAvatar(UUID userId) {
        require(userId);
        users.setAvatar(userId, null);
    }

    public List<String> thanksSeen(UUID userId) {
        require(userId);
        return programStates.thanksSeen(userId);
    }

    public void markThanksSeen(UUID userId, String programId) {
        require(userId);
        programStates.markThanksSeen(userId, programId, clock.instant());
    }

    /** Gives an optional consent, recorded with the version of the privacy notice the student saw. */
    @Transactional
    public void grant(UUID userId, Consent purpose) {
        require(userId);
        if (purpose == Consent.ACCOUNT) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Ese consentimiento se da al crear la cuenta");
        }
        if (!consents.active(userId).contains(purpose)) {
            consents.grant(userId, purpose, properties.privacyNoticeVersion());
        }
    }

    /**
     * Revokes an optional consent. Revoking sync deletes the encrypted copies on the server
     * (LOPDP art. 15.6); the projects stay on the student's devices.
     *
     * @return projects deleted from the server
     */
    @Transactional
    public int revoke(UUID userId, Consent purpose) {
        require(userId);
        if (purpose == Consent.ACCOUNT) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "BAD_REQUEST",
                    "Para retirar este consentimiento, borra tu cuenta");
        }
        consents.revoke(userId, purpose, clock.instant());
        return purpose == Consent.PROJECT_SYNC ? projects.deleteAll(userId) : 0;
    }

    public Export export(UUID userId) {
        require(userId);
        return new Export("estrella-datos-personales/1", clock.instant(),
                "Los nombres y el contenido de tus proyectos están cifrados en tu equipo y el servidor no puede leerlos; "
                        + "la app los descifra y los agrega a este archivo al exportar.",
                personalData.account(userId), consents.history(userId), personalData.sessions(userId),
                personalData.programs(userId), personalData.projects(userId));
    }

    /** Real deletion (LOPDP art. 15): every row of the user goes through ON DELETE CASCADE. */
    @Transactional
    public void delete(UUID userId, String authKey) {
        UserRecord user = require(userId);
        if (!encoder.matches(authKey, user.passwordHash())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "INVALID_CREDENTIALS", "La contraseña no es correcta");
        }
        users.delete(userId);
        mail.sendAccountDeleted(user.email());
    }

    private UserRecord require(UUID userId) {
        return users.findById(userId).orElseThrow(() ->
                new ApiException(HttpStatus.UNAUTHORIZED, "SESSION_EXPIRED", "Inicia sesión de nuevo"));
    }
}
