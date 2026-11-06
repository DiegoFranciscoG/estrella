package ec.estrella.api.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ec.estrella.api.config.AppProperties;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AiKeyCipherTest {

    private static final SecureRandom RANDOM = new SecureRandom();
    /** Generated per run, like every test secret: nothing shaped like a key is written in the repository. */
    private static final String KEY = "sk-or-v1-" + HexFormat.of().formatHex(random(32));

    private static byte[] random(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return b;
    }

    private static String secret(int bytes) {
        return Base64.getEncoder().encodeToString(random(bytes));
    }

    @Test
    void opensOnlyForItsOwnerAndWithItsSecret() {
        String secret = secret(32);
        AiKeyCipher cipher = new AiKeyCipher(secret);
        UUID owner = UUID.randomUUID();
        AiKeyCipher.Sealed sealed = cipher.seal(owner, KEY);

        assertThat(sealed.nonce()).hasSize(12);
        assertThat(new String(sealed.ciphertext(), StandardCharsets.ISO_8859_1)).doesNotContain("sk-or");
        assertThat(cipher.open(owner, sealed.nonce(), sealed.ciphertext())).contains(KEY);
        // Same input, new nonce: two seals never look alike.
        assertThat(cipher.seal(owner, KEY).ciphertext()).isNotEqualTo(sealed.ciphertext());

        assertThat(cipher.open(UUID.randomUUID(), sealed.nonce(), sealed.ciphertext())).isEmpty();
        byte[] tampered = sealed.ciphertext().clone();
        tampered[0] ^= 1;
        assertThat(cipher.open(owner, sealed.nonce(), tampered)).isEmpty();
        assertThat(new AiKeyCipher(secret(32)).open(owner, sealed.nonce(), sealed.ciphertext())).isEmpty();
        assertThat(new AiKeyCipher(secret).open(owner, sealed.nonce(), sealed.ciphertext())).contains(KEY);
    }

    @Test
    void refusesToStartWithoutA256BitSecret() {
        assertThatThrownBy(() -> new AiKeyCipher(secret(16))).isInstanceOf(IllegalStateException.class).hasMessageContaining("32");
        assertThatThrownBy(() -> new AiKeyCipher("CAMBIAR!")).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void onlyFreeModelsAreAccepted() {
        Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
        java.util.function.Function<List<String>, Set<ConstraintViolation<AppProperties.Ai>>> check = models ->
                validator.validate(new AppProperties.Ai(secret(32), "https://openrouter.ai/api/v1", "https://openrouter.ai/auth",
                        models, 6, 4000, 800, Duration.ofSeconds(60)));

        assertThat(check.apply(List.of("google/gemma-4-31b-it:free", "openrouter/free"))).isEmpty();
        // A paid model in the fallback list would be billed to the student.
        assertThat(check.apply(List.of("google/gemma-4-31b-it:free", "openai/gpt-sol"))).isNotEmpty();
        assertThat(check.apply(List.of("openrouter/auto"))).isNotEmpty();
        assertThat(check.apply(List.of())).isNotEmpty();
    }
}
