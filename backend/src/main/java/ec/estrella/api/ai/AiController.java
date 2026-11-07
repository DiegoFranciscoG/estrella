package ec.estrella.api.ai;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The assistant. Every route needs a signed-in student; nothing here returns the OpenRouter key. */
@Tag(name = "AI", description = "Asistente con la cuenta de OpenRouter de cada estudiante (PKCE); solo modelos gratuitos")
@RestController
@RequestMapping("/api/v1/ai")
public class AiController {

    /**
     * PKCE step 2. The verifier follows RFC 7636 (43 to 128 unreserved characters). {@code adult}
     * is the student's declaration that they are 18 or older, which OpenRouter's terms require.
     */
    public record ConnectRequest(
            @NotNull @Pattern(regexp = "^[A-Za-z0-9._~-]{8,512}$") String code,
            @NotNull @Pattern(regexp = "^[A-Za-z0-9._~-]{43,128}$") String codeVerifier,
            @AssertTrue boolean adult) {
    }

    /** The exact text the student reviewed. The absolute cap guards memory; the configured one is checked in the service. */
    public record AskRequest(@NotBlank @Size(max = 20_000) String message, boolean allowProviderStorage) {
    }

    private final AiService ai;

    public AiController(AiService ai) {
        this.ai = ai;
    }

    @Operation(summary = "Estado de la conexión y modelos disponibles")
    @GetMapping("/status")
    AiService.Status status(@AuthenticationPrincipal Jwt jwt) {
        return ai.status(userId(jwt));
    }

    @Operation(summary = "Conectar OpenRouter: canjear el código PKCE por la clave")
    @PutMapping("/connection")
    AiService.Status connect(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ConnectRequest request) {
        return ai.connect(userId(jwt), request.code(), request.codeVerifier());
    }

    @Operation(summary = "Desconectar y borrar la clave guardada")
    @DeleteMapping("/connection")
    AiService.Disconnected disconnect(@AuthenticationPrincipal Jwt jwt) {
        return ai.disconnect(userId(jwt));
    }

    @Operation(summary = "Preguntar al asistente")
    @PostMapping("/chat")
    ResponseEntity<AiService.Answer> ask(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody AskRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(ai.ask(userId(jwt), request.message(), request.allowProviderStorage()));
    }

    private static UUID userId(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
