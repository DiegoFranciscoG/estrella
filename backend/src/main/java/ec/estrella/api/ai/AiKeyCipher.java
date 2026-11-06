package ec.estrella.api.ai;

import ec.estrella.api.config.AppProperties;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Encrypts each student's OpenRouter key at rest with AES-256-GCM. The key comes from the
 * environment (AI_KEY_SECRET), so a copy of the database alone does not reveal any OpenRouter key.
 * The owner's id is authenticated data: a ciphertext moved to another account does not open.
 */
@Component
public class AiKeyCipher {

    static final int SECRET_BYTES = 32;
    static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final SecureRandom RANDOM = new SecureRandom();

    public record Sealed(byte[] nonce, byte[] ciphertext) {
    }

    private final SecretKey key;

    @Autowired
    public AiKeyCipher(AppProperties properties) {
        this(properties.ai().keySecret());
    }

    AiKeyCipher(String base64Secret) {
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(base64Secret.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("AI_KEY_SECRET must be base64");
        }
        if (bytes.length != SECRET_BYTES) {
            throw new IllegalStateException("AI_KEY_SECRET must be 32 random bytes in base64 (openssl rand -base64 32)");
        }
        this.key = new SecretKeySpec(bytes, "AES");
    }

    public Sealed seal(UUID owner, String apiKey) {
        byte[] nonce = new byte[NONCE_BYTES];
        RANDOM.nextBytes(nonce);
        try {
            Cipher cipher = cipher(Cipher.ENCRYPT_MODE, owner, nonce);
            return new Sealed(nonce, cipher.doFinal(apiKey.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("AES-GCM is not available", e);
        }
    }

    /** Empty if the data was altered, belongs to another account or was sealed with another secret. */
    public Optional<String> open(UUID owner, byte[] nonce, byte[] ciphertext) {
        try {
            Cipher cipher = cipher(Cipher.DECRYPT_MODE, owner, nonce);
            return Optional.of(new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8));
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private Cipher cipher(int mode, UUID owner, byte[] nonce) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, key, new GCMParameterSpec(TAG_BITS, nonce));
        cipher.updateAAD(("estrella:v1:ai-key:" + owner).getBytes(StandardCharsets.UTF_8));
        return cipher;
    }
}
