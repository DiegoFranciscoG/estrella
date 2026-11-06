package ec.estrella.api.account;

import ec.estrella.api.common.ApiException;
import ec.estrella.api.mail.MailService;
import java.time.Clock;
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

    private final UserRepository users;
    private final ConsentRepository consents;
    private final ProgramStateRepository programStates;
    private final PasswordEncoder encoder;
    private final MailService mail;
    private final Clock clock;

    public AccountService(UserRepository users, ConsentRepository consents, ProgramStateRepository programStates,
                          PasswordEncoder encoder, MailService mail, Clock clock) {
        this.users = users;
        this.consents = consents;
        this.programStates = programStates;
        this.encoder = encoder;
        this.mail = mail;
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
