package ec.estrella.api.project;

import ec.estrella.api.common.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Encrypted projects. Names and content arrive already encrypted by the student's device; versions
 * use HTTP preconditions (RFC 9110: If-Match, ETag, 412) so two devices never overwrite each other.
 */
@Validated
@Tag(name = "Projects", description = "Proyectos cifrados en el dispositivo; versiones con If-Match y ETag (RFC 9110)")
@RestController
@RequestMapping("/api/v1/projects")
public class ProjectController {

    /** Standard base64. */
    static final String BASE64 = "^[A-Za-z0-9+/]+={0,2}$";
    static final String SHA_HEADER = "X-Content-SHA256";
    private static final java.util.regex.Pattern STRONG_ETAG = java.util.regex.Pattern.compile("^\"(\\d{1,18})\"$");

    public record SaveRequest(
            @NotNull @Pattern(regexp = "^[a-z0-9-]{1,40}$") String programId,
            @NotNull @Size(min = 40, max = 2732) @Pattern(regexp = BASE64) String name) {
    }

    public record ProjectView(UUID id, String programId, String name, long version, long sizeBytes, Instant createdAt,
                              Instant updatedAt) {
    }

    public record ListView(List<ProjectView> projects, long storageUsedBytes, long storageQuotaBytes, long maxVersionBytes,
                           UUID syncEpoch) {
    }

    public record VersionView(long version, long sizeBytes, Instant createdAt) {
    }

    private final ProjectService service;

    public ProjectController(ProjectService service) {
        this.service = service;
    }

    @Operation(summary = "Listar proyectos y uso del almacenamiento")
    @GetMapping
    ListView list(@AuthenticationPrincipal Jwt jwt) {
        ProjectService.Listing listing = service.list(userId(jwt));
        return new ListView(listing.projects().stream().map(ProjectController::view).toList(),
                listing.storageUsedBytes(), listing.storageQuotaBytes(), listing.maxVersionBytes(), listing.syncEpoch());
    }

    @Operation(summary = "Crear un proyecto o cambiar su nombre cifrado")
    @PutMapping("/{id}")
    ProjectView save(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody SaveRequest request) {
        return view(service.save(userId(jwt), id, request.programId(), Base64.getDecoder().decode(request.name())));
    }

    @Operation(summary = "Subir una versión nueva; If-Match con la versión de partida")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true, description = "Contenido cifrado",
            content = @Content(mediaType = "application/octet-stream", schema = @Schema(type = "string", format = "binary")))
    @PutMapping(path = "/{id}/content", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    ResponseEntity<ProjectService.Upload> upload(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
                                                 @RequestHeader(name = HttpHeaders.IF_MATCH, required = false) String ifMatch,
                                                 @RequestHeader(name = SHA_HEADER, required = false) String sha256,
                                                 HttpServletRequest request) throws IOException {
        if (ifMatch == null) {
            throw new ApiException(HttpStatus.PRECONDITION_REQUIRED, "VERSION_REQUIRED",
                    "Falta la versión de partida (If-Match)");
        }
        long base = version(ifMatch);
        byte[] declared = decodeSha(sha256);
        byte[] body = readBounded(request, service.maxVersionBytes());
        ProjectService.Upload result = service.upload(userId(jwt), id, base, body, declared);
        return ResponseEntity.ok().eTag(etag(result.version())).cacheControl(CacheControl.noStore()).body(result);
    }

    @Operation(summary = "Descargar la versión actual; 304 si If-None-Match coincide")
    @ApiResponse(responseCode = "200", description = "Contenido cifrado; ETag con la versión y X-Content-SHA256",
            content = @Content(mediaType = "application/octet-stream", schema = @Schema(type = "string", format = "binary")))
    @GetMapping("/{id}/content")
    ResponseEntity<byte[]> content(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
                                   @RequestHeader(name = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        UUID user = userId(jwt);
        long current = service.currentVersion(user, id);
        if (ifNoneMatch != null && ifNoneMatch.equals(etag(current))) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(etag(current)).build();
        }
        return bytes(service.content(user, id, current));
    }

    @Operation(summary = "Listar las versiones guardadas")
    @GetMapping("/{id}/versions")
    List<VersionView> versions(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return service.versions(userId(jwt), id).stream()
                .map(v -> new VersionView(v.version(), v.sizeBytes(), v.createdAt()))
                .toList();
    }

    @Operation(summary = "Descargar una versión anterior")
    @ApiResponse(responseCode = "200", description = "Contenido cifrado de esa versión",
            content = @Content(mediaType = "application/octet-stream", schema = @Schema(type = "string", format = "binary")))
    @GetMapping("/{id}/versions/{version}")
    ResponseEntity<byte[]> version(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
                                   @PathVariable @Min(1) long version) {
        return bytes(service.content(userId(jwt), id, version));
    }

    @Operation(summary = "Borrar un proyecto con todas sus versiones")
    @ApiResponse(responseCode = "204", description = "Proyecto borrado")
    @DeleteMapping("/{id}")
    ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        service.delete(userId(jwt), id);
        return ResponseEntity.noContent().build();
    }

    /** Reads the body without ever holding more than the allowed size plus one byte. */
    static byte[] readBounded(HttpServletRequest request, long max) throws IOException {
        if (request.getContentLengthLong() > max) {
            throw tooLarge(max);
        }
        try (InputStream in = request.getInputStream()) {
            byte[] data = in.readNBytes((int) Math.min(max + 1, Integer.MAX_VALUE - 8));
            if (data.length > max) {
                throw tooLarge(max);
            }
            return data;
        }
    }

    private static ApiException tooLarge(long max) {
        return new ApiException(HttpStatus.CONTENT_TOO_LARGE, "TOO_LARGE",
                "Este proyecto supera " + (max / 1_048_576) + " MB cifrado; queda guardado solo en este equipo");
    }

    private static long version(String ifMatch) {
        Matcher m = STRONG_ETAG.matcher(ifMatch.trim());
        if (!m.matches()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "If-Match debe ser una versión, por ejemplo \"3\"");
        }
        return Long.parseLong(m.group(1));
    }

    private static byte[] decodeSha(String header) {
        try {
            byte[] sha = header == null ? null : Base64.getDecoder().decode(header);
            return sha != null && sha.length == 32 ? sha : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static ResponseEntity<byte[]> bytes(ProjectRepository.Content content) {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .eTag(etag(content.version()))
                .header(SHA_HEADER, Base64.getEncoder().encodeToString(content.sha256()))
                .cacheControl(CacheControl.noStore())
                .body(content.data());
    }

    private static String etag(long version) {
        return "\"" + version + "\"";
    }

    private static ProjectView view(ProjectService.Summary s) {
        return new ProjectView(s.id(), s.programId(), Base64.getEncoder().encodeToString(s.name()), s.version(),
                s.sizeBytes(), s.createdAt(), s.updatedAt());
    }

    private static UUID userId(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
