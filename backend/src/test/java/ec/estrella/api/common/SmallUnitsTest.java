package ec.estrella.api.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ec.estrella.api.account.ImageType;
import ec.estrella.api.auth.DeviceLabel;
import ec.estrella.api.auth.dto.AuthDtos;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class SmallUnitsTest {

    @ParameterizedTest
    @CsvSource({
        "'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0 Safari/537.36', Chrome en Windows",
        "'Mozilla/5.0 (Windows NT 10.0) Chrome/152.0 Safari/537.36 Edg/152.0', Edge en Windows",
        "'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', Firefox en Linux",
        "'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', Safari en iOS",
        "'Mozilla/5.0 (Linux; Android 15) Chrome/152.0 Mobile', Chrome en Android",
        "'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Safari/605.1', Safari en macOS",
        "'curl/8.0', un navegador en un sistema desconocido"
    })
    void deviceLabelIsCoarse(String agent, String expected) {
        assertThat(DeviceLabel.of(agent)).isEqualTo(expected);
    }

    @Test
    void deviceLabelHandlesMissingAgent() {
        assertThat(DeviceLabel.of(null)).isEqualTo("un dispositivo desconocido");
        assertThat(DeviceLabel.of(" ")).isEqualTo("un dispositivo desconocido");
    }

    @Test
    void imageTypeComesFromMagicBytes() {
        byte[] jpeg = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 0, 0, 0, 0, 0, 0, 0};
        byte[] webp = {'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'E', 'B', 'P'};
        byte[] svg = "<svg onload=x></svg>".getBytes();
        assertThat(ImageType.detect(jpeg)).contains(ImageType.JPEG);
        assertThat(ImageType.detect(webp)).contains(ImageType.WEBP);
        assertThat(ImageType.detect(svg)).isEmpty();
        assertThat(ImageType.detect(new byte[3])).isEmpty();
        assertThat(ImageType.detect(null)).isEmpty();
    }

    @Test
    void tokensAreRandomAndHashedConsistently() {
        String a = Tokens.newToken();
        assertThat(a).matches(AuthDtos.TOKEN).isNotEqualTo(Tokens.newToken());
        assertThat(Tokens.sha256(a)).hasSize(32).isEqualTo(Tokens.sha256(a));
    }

    @Test
    void keyPatternsAcceptOnlyExactSizes() {
        assertThat("A".repeat(43) + "=").matches(AuthDtos.KEY_32);
        assertThat("A".repeat(42) + "=").doesNotMatch(AuthDtos.KEY_32);
        assertThat("A".repeat(22) + "==").matches(AuthDtos.KEY_16);
    }

    @Test
    void shortJwtSecretStopsTheApplication() {
        assertThatThrownBy(() -> ec.estrella.api.config.JwtConfigProbe.key("corto"))
                .isInstanceOf(IllegalStateException.class);
        assertThat(ec.estrella.api.config.JwtConfigProbe.key("x".repeat(32)).getAlgorithm()).isEqualTo("HmacSHA256");
    }
}
