package ec.estrella.api.account;

import ec.estrella.api.auth.dto.AuthDtos;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@Validated
@RestController
@RequestMapping("/api/v1/me")
public class AccountController {

    static final int MAX_AVATAR_BYTES = 262_144;

    public record DeleteAccountRequest(@NotNull @Pattern(regexp = AuthDtos.KEY_32) String authKey) {
    }

    public record ThanksResponse(List<String> programs) {
    }

    public record RevokeResponse(int deletedProjects) {
    }

    private final AccountService accounts;

    public AccountController(AccountService accounts) {
        this.accounts = accounts;
    }

    @GetMapping
    AccountService.Profile me(@AuthenticationPrincipal Jwt jwt) {
        return accounts.profile(userId(jwt));
    }

    @PutMapping("/avatar")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void setAvatar(@AuthenticationPrincipal Jwt jwt, @RequestPart("file") MultipartFile file) throws IOException {
        if (file.getSize() > MAX_AVATAR_BYTES) {
            throw new ec.estrella.api.common.ApiException(HttpStatus.CONTENT_TOO_LARGE, "TOO_LARGE",
                    "La foto no puede pesar más de 256 KB");
        }
        accounts.setAvatar(userId(jwt), file.getBytes());
    }

    @GetMapping("/avatar")
    ResponseEntity<byte[]> avatar(@AuthenticationPrincipal Jwt jwt) {
        byte[] image = accounts.avatar(userId(jwt));
        return ResponseEntity.ok()
                .contentType(ImageType.detect(image).orElseThrow().mediaType())
                .cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff")
                .body(image);
    }

    @DeleteMapping("/avatar")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void removeAvatar(@AuthenticationPrincipal Jwt jwt) {
        accounts.removeAvatar(userId(jwt));
    }

    @GetMapping("/thanks")
    ThanksResponse thanks(@AuthenticationPrincipal Jwt jwt) {
        return new ThanksResponse(accounts.thanksSeen(userId(jwt)));
    }

    @PutMapping("/thanks/{programId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void markThanks(@AuthenticationPrincipal Jwt jwt,
                    @PathVariable @Pattern(regexp = "^[a-z0-9-]{1,40}$") String programId) {
        accounts.markThanksSeen(userId(jwt), programId);
    }

    @PutMapping("/consents/{purpose}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void grant(@AuthenticationPrincipal Jwt jwt, @PathVariable Consent purpose) {
        accounts.grant(userId(jwt), purpose);
    }

    @DeleteMapping("/consents/{purpose}")
    RevokeResponse revoke(@AuthenticationPrincipal Jwt jwt, @PathVariable Consent purpose) {
        return new RevokeResponse(accounts.revoke(userId(jwt), purpose));
    }

    @GetMapping("/export")
    ResponseEntity<AccountService.Export> export(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(accounts.export(userId(jwt)));
    }

    @PostMapping("/delete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody DeleteAccountRequest request) {
        accounts.delete(userId(jwt), request.authKey());
    }

    private static UUID userId(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
