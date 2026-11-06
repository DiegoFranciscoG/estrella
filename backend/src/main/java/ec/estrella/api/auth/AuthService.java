package ec.estrella.api.auth;

import ec.estrella.api.account.Consent;
import ec.estrella.api.account.ConsentRepository;
import ec.estrella.api.account.UserRecord;
import ec.estrella.api.account.UserRepository;
import ec.estrella.api.auth.EmailTokenRepository.Purpose;
import ec.estrella.api.auth.dto.AuthDtos.KeyBundle;
import ec.estrella.api.auth.dto.AuthDtos.LoginKeys;
import ec.estrella.api.auth.dto.AuthDtos.RegisterRequest;
import ec.estrella.api.auth.dto.AuthDtos.ResetBundleResponse;
import ec.estrella.api.auth.dto.AuthDtos.ResetConfirmRequest;
import ec.estrella.api.common.ApiException;
import ec.estrella.api.common.Tokens;
import ec.estrella.api.config.AppProperties;
import ec.estrella.api.mail.MailService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Account lifecycle. Public endpoints answer the same way whether or not an email is registered,
 * so they cannot be used to find out who has an account (OWASP Authentication Cheat Sheet).
 */
@Service
public class AuthService {

    static final int EMAIL_ACTIONS_PER_HOUR = 5;

    public record LoginResult(TokenService.IssuedTokens tokens, String email, LoginKeys keys) {
    }

    private final UserRepository users;
    private final ConsentRepository consents;
    private final EmailTokenRepository emailTokens;
    private final TokenService tokens;
    private final PasswordEncoder encoder;
    private final MailService mail;
    private final AttemptLimiter limiter;
    private final AppProperties properties;
    private final Clock clock;
    private final String dummyHash;

    public AuthService(UserRepository users, ConsentRepository consents, EmailTokenRepository emailTokens,
                       TokenService tokens, PasswordEncoder encoder, MailService mail, AttemptLimiter limiter,
                       AppProperties properties, Clock clock) {
        this.users = users;
        this.consents = consents;
        this.emailTokens = emailTokens;
        this.tokens = tokens;
        this.encoder = encoder;
        this.mail = mail;
        this.limiter = limiter;
        this.properties = properties;
        this.clock = clock;
        // Used to spend the same time on unknown emails as on known ones.
        this.dummyHash = encoder.encode(Tokens.newToken());
    }

    public static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    @Transactional
    public void register(RegisterRequest request, String ip) {
        if (!request.consents().contains(Consent.ACCOUNT)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED",
                    "Para crear la cuenta necesitamos tu consentimiento para guardarla");
        }
        String email = normalize(request.email());
        requireEmailBudget("register:" + ip);
        Optional<UserRecord> existing = users.findByEmail(email);
        if (existing.isPresent()) {
            UserRecord user = existing.get();
            if (user.verified()) {
                mail.sendAlreadyRegistered(email, properties.publicUrl() + "/#/ingresar");
            } else {
                sendVerification(user.id(), email);
            }
            return;
        }
        UUID id = UUID.randomUUID();
        KeyBundle bundle = request.keyBundle();
        try {
            users.insert(new UserRecord(id, email, encoder.encode(request.authKey()), null,
                    decode(bundle.wrappedKeyPassword()), decode(bundle.wrappedKeyRecovery()), decode(bundle.kdfSalt()),
                    0, properties.storageQuotaBytes(), false));
        } catch (DuplicateKeyException race) {
            return;
        }
        for (Consent consent : request.consents()) {
            consents.grant(id, consent, properties.privacyNoticeVersion());
        }
        sendVerification(id, email);
    }

    @Transactional
    public void verifyEmail(String token) {
        Instant now = clock.instant();
        byte[] hash = Tokens.sha256(token);
        UUID userId = emailTokens.findValidUser(hash, Purpose.VERIFY_EMAIL, now)
                .filter(u -> emailTokens.consume(hash, Purpose.VERIFY_EMAIL, now))
                .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "INVALID_TOKEN",
                        "El enlace no es válido o ya venció. Pide uno nuevo"));
        users.markVerified(userId, now);
    }

    @Transactional
    public void resendVerification(String rawEmail, String ip) {
        String email = normalize(rawEmail);
        requireEmailBudget("resend:" + ip);
        users.findByEmail(email).filter(u -> !u.verified()).ifPresent(u -> sendVerification(u.id(), email));
    }

    @Transactional
    public LoginResult login(String rawEmail, String authKey, String ip, String device) {
        String email = normalize(rawEmail);
        String key = "login:" + ip + ":" + email;
        long wait = Math.max(limiter.lockedSeconds(key), limiter.lockedSeconds("login-ip:" + ip));
        if (wait > 0) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_ATTEMPTS",
                    "Demasiados intentos. Espera " + wait + " segundos");
        }
        Optional<UserRecord> found = users.findByEmail(email);
        boolean matches = encoder.matches(authKey, found.map(UserRecord::passwordHash).orElse(dummyHash));
        if (found.isEmpty() || !matches) {
            limiter.recordFailure(key);
            limiter.recordFailure("login-ip:" + ip);
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Correo o contraseña incorrectos");
        }
        UserRecord user = found.get();
        limiter.reset(key);
        if (!user.verified()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "EMAIL_NOT_VERIFIED",
                    "Confirma tu correo para entrar. Revisa tu bandeja o pide un enlace nuevo");
        }
        if (consents.active(user.id()).contains(Consent.SECURITY_EMAIL)) {
            mail.sendNewSession(email, device);
        }
        return new LoginResult(tokens.issue(user.id()), email, keysOf(user));
    }

    public LoginResult refresh(String refreshToken) {
        TokenService.RotatedTokens rotated = tokens.rotate(refreshToken);
        UserRecord user = users.findById(rotated.userId())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "SESSION_EXPIRED", "Inicia sesión de nuevo"));
        return new LoginResult(rotated.tokens(), user.email(), keysOf(user));
    }

    public void logout(String refreshToken) {
        tokens.revoke(refreshToken);
    }

    @Transactional
    public void requestPasswordReset(String rawEmail, String ip) {
        String email = normalize(rawEmail);
        requireEmailBudget("reset:" + ip);
        users.findByEmail(email).filter(UserRecord::verified).ifPresent(user -> {
            String token = Tokens.newToken();
            Instant now = clock.instant();
            emailTokens.replace(user.id(), Purpose.RESET_PASSWORD, Tokens.sha256(token),
                    now.plus(properties.emailTokenTtl()), now);
            mail.sendPasswordReset(email, properties.publicUrl() + "/#/restablecer?token=" + token);
        });
    }

    /** Lets the device unwrap its key with the recovery code before choosing a new password. */
    public ResetBundleResponse resetBundle(String token) {
        UserRecord user = userForResetToken(token);
        return new ResetBundleResponse(encode(user.keySalt()), encode(user.wrappedKeyRecovery()));
    }

    @Transactional
    public void confirmPasswordReset(ResetConfirmRequest request) {
        UserRecord user = userForResetToken(request.token());
        if (!emailTokens.consume(Tokens.sha256(request.token()), Purpose.RESET_PASSWORD, clock.instant())) {
            throw invalidResetToken();
        }
        KeyBundle bundle = request.keyBundle();
        users.updateCredentials(user.id(), encoder.encode(request.authKey()), decode(bundle.kdfSalt()),
                decode(bundle.wrappedKeyPassword()), decode(bundle.wrappedKeyRecovery()));
        tokens.revokeAll(user.id());
        // discardEncryptedData: synced projects (phase 6) are deleted because nobody can decrypt them anymore.
    }

    private UserRecord userForResetToken(String token) {
        return emailTokens.findValidUser(Tokens.sha256(token), Purpose.RESET_PASSWORD, clock.instant())
                .flatMap(users::findById)
                .orElseThrow(AuthService::invalidResetToken);
    }

    private static ApiException invalidResetToken() {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_TOKEN", "El enlace no es válido o ya venció");
    }

    private void sendVerification(UUID userId, String email) {
        String token = Tokens.newToken();
        Instant now = clock.instant();
        emailTokens.replace(userId, Purpose.VERIFY_EMAIL, Tokens.sha256(token), now.plus(properties.emailTokenTtl()), now);
        // The token travels in the fragment, which browsers never send to servers or logs.
        mail.sendVerification(email, properties.publicUrl() + "/#/verificar?token=" + token);
    }

    private void requireEmailBudget(String key) {
        if (!limiter.tryAcquire(key, EMAIL_ACTIONS_PER_HOUR, Duration.ofHours(1))) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_ATTEMPTS",
                    "Hiciste muchas solicitudes. Intenta en una hora");
        }
    }

    private static LoginKeys keysOf(UserRecord user) {
        return new LoginKeys(encode(user.keySalt()), encode(user.wrappedKeyPassword()));
    }

    private static byte[] decode(String base64) {
        return Base64.getDecoder().decode(base64);
    }

    private static String encode(byte[] bytes) {
        return Base64.getEncoder().encodeToString(bytes);
    }
}
