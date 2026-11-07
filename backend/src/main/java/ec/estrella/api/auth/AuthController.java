package ec.estrella.api.auth;

import ec.estrella.api.auth.dto.AuthDtos.EmailRequest;
import ec.estrella.api.auth.dto.AuthDtos.LoginRequest;
import ec.estrella.api.auth.dto.AuthDtos.MessageResponse;
import ec.estrella.api.auth.dto.AuthDtos.RegisterRequest;
import ec.estrella.api.auth.dto.AuthDtos.ResetBundleResponse;
import ec.estrella.api.auth.dto.AuthDtos.ResetConfirmRequest;
import ec.estrella.api.auth.dto.AuthDtos.TokenRequest;
import ec.estrella.api.auth.dto.AuthDtos.TokenResponse;
import ec.estrella.api.common.ClientIp;
import ec.estrella.api.config.AppProperties;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.time.Duration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Auth", description = "Registro, verificación del correo, sesión y cambio de contraseña")
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    static final String REFRESH_COOKIE = "estrella_rt";
    static final String COOKIE_PATH = "/api/v1/auth";
    /** Required on cookie-authenticated endpoints: a cross-site form cannot set custom headers. */
    static final String CLIENT_HEADER = "X-Estrella-Client";
    private static final MessageResponse CHECK_EMAIL =
            new MessageResponse("Si los datos son correctos, te enviamos un correo. Revisa tu bandeja.");

    private final AuthService auth;
    private final AppProperties properties;

    public AuthController(AuthService auth, AppProperties properties) {
        this.auth = auth;
        this.properties = properties;
    }

    @Operation(summary = "Crear una cuenta; envía un correo de verificación")
    @PostMapping("/register")
    @ResponseStatus(HttpStatus.ACCEPTED)
    MessageResponse register(@Valid @RequestBody RegisterRequest request, HttpServletRequest http) {
        auth.register(request, ClientIp.of(http));
        return CHECK_EMAIL;
    }

    @Operation(summary = "Confirmar el correo con el token del enlace")
    @PostMapping("/verify-email")
    MessageResponse verifyEmail(@Valid @RequestBody TokenRequest request) {
        auth.verifyEmail(request.token());
        return new MessageResponse("Correo confirmado. Ya puedes entrar.");
    }

    @Operation(summary = "Reenviar el correo de verificación")
    @PostMapping("/resend-verification")
    @ResponseStatus(HttpStatus.ACCEPTED)
    MessageResponse resend(@Valid @RequestBody EmailRequest request, HttpServletRequest http) {
        auth.resendVerification(request.email(), ClientIp.of(http));
        return CHECK_EMAIL;
    }

    @Operation(summary = "Entrar: token de acceso y cookie de renovación")
    @PostMapping("/login")
    ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest request, HttpServletRequest http,
                                        @Parameter(description = "Solo para nombrar el equipo en el aviso de inicio de sesión")
                                        @RequestHeader(value = HttpHeaders.USER_AGENT, required = false) String agent) {
        AuthService.LoginResult result = auth.login(request.email(), request.authKey(), ClientIp.of(http),
                DeviceLabel.of(agent));
        return withSession(result);
    }

    @Operation(summary = "Renovar la sesión; la cookie rota en cada uso")
    @PostMapping("/refresh")
    ResponseEntity<TokenResponse> refresh(@RequestHeader(CLIENT_HEADER) String client,
                                          @CookieValue(REFRESH_COOKIE) String refreshToken) {
        return withSession(auth.refresh(refreshToken));
    }

    @Operation(summary = "Salir: cierra esta sesión y borra la cookie")
    @ApiResponse(responseCode = "204", description = "Sesión cerrada y cookie borrada")
    @PostMapping("/logout")
    ResponseEntity<Void> logout(@RequestHeader(CLIENT_HEADER) String client,
                                @CookieValue(value = REFRESH_COOKIE, required = false) String refreshToken) {
        if (refreshToken != null) {
            auth.logout(refreshToken);
        }
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO)).build();
    }

    @Operation(summary = "Pedir el correo para cambiar la contraseña")
    @PostMapping("/password-reset/request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    MessageResponse requestReset(@Valid @RequestBody EmailRequest request, HttpServletRequest http) {
        auth.requestPasswordReset(request.email(), ClientIp.of(http));
        return CHECK_EMAIL;
    }

    @Operation(summary = "Llaves cifradas para restablecer con la clave de recuperación")
    @PostMapping("/password-reset/bundle")
    ResetBundleResponse resetBundle(@Valid @RequestBody TokenRequest request) {
        return auth.resetBundle(request.token());
    }

    @Operation(summary = "Cambiar la contraseña; cierra todas las sesiones")
    @PostMapping("/password-reset/confirm")
    MessageResponse confirmReset(@Valid @RequestBody ResetConfirmRequest request) {
        auth.confirmPasswordReset(request);
        return new MessageResponse("Contraseña cambiada. Se cerraron todas tus sesiones.");
    }

    private ResponseEntity<TokenResponse> withSession(AuthService.LoginResult result) {
        TokenService.IssuedTokens t = result.tokens();
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, cookie(t.refreshToken(), properties.refreshTokenTtl()))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new TokenResponse(t.accessToken(), t.expiresIn(), result.email(), result.keys()));
    }

    private String cookie(String value, Duration maxAge) {
        return ResponseCookie.from(REFRESH_COOKIE, value)
                .httpOnly(true)
                .secure(properties.cookieSecure())
                .sameSite(properties.cookieSameSite())
                .path(COOKIE_PATH)
                .maxAge(maxAge)
                .build()
                .toString();
    }
}
