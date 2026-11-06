package ec.estrella.api.auth.dto;

import ec.estrella.api.account.Consent;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Set;

/**
 * Request and response bodies of the auth endpoints.
 *
 * <p>The client never sends the password. It derives two independent values from it:
 * {@code authKey} (32 bytes, hashed here again with Argon2id) and a key-encryption key that never
 * leaves the device. That is what lets project content be encrypted end to end.
 */
public final class AuthDtos {

    /** Standard base64 of exactly 32 bytes. */
    public static final String KEY_32 = "^[A-Za-z0-9+/]{43}=$";
    /** Standard base64 of exactly 16 bytes. */
    public static final String KEY_16 = "^[A-Za-z0-9+/]{22}==$";
    /** Standard base64 of a wrapped key, 40 to 96 bytes. */
    public static final String WRAPPED = "^[A-Za-z0-9+/]{54,128}={0,2}$";
    /** Opaque URL-safe token produced by the server. */
    public static final String TOKEN = "^[A-Za-z0-9_-]{43}$";

    private AuthDtos() {
    }

    public record KeyBundle(
            @NotNull @Pattern(regexp = KEY_16) String kdfSalt,
            @NotNull @Pattern(regexp = WRAPPED) String wrappedKeyPassword,
            @NotNull @Pattern(regexp = WRAPPED) String wrappedKeyRecovery) {
    }

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotNull @Pattern(regexp = KEY_32) String authKey,
            @NotNull @Valid KeyBundle keyBundle,
            @AssertTrue boolean ageConfirmed,
            @NotEmpty @Size(max = 3) Set<@NotNull Consent> consents) {
    }

    public record EmailRequest(@NotBlank @Email @Size(max = 254) String email) {
    }

    public record TokenRequest(@NotNull @Pattern(regexp = TOKEN) String token) {
    }

    public record LoginRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotNull @Pattern(regexp = KEY_32) String authKey) {
    }

    public record LoginKeys(String kdfSalt, String wrappedKeyPassword) {
    }

    public record TokenResponse(String accessToken, long expiresIn, String email, LoginKeys keys) {
    }

    public record ResetBundleResponse(String kdfSalt, String wrappedKeyRecovery) {
    }

    public record ResetConfirmRequest(
            @NotNull @Pattern(regexp = TOKEN) String token,
            @NotNull @Pattern(regexp = KEY_32) String authKey,
            @NotNull @Valid KeyBundle keyBundle,
            boolean discardEncryptedData) {
    }

    public record MessageResponse(String message) {
    }
}
