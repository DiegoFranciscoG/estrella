package ec.estrella.api.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The API contract (OpenAPI), served only with APP_API_DOCS=true. Which routes need a session is
 * read from {@link SecurityConfig} itself, so the document cannot promise what the server does not do.
 */
@Configuration
public class OpenApiConfig {

    static final String BEARER = "bearer";
    static final String PROBLEM = "Problem";
    /** The order a reader meets them in: sign in, the account, projects, the assistant, the wake-up check. */
    static final List<String> TAG_ORDER = List.of("Auth", "Account", "Projects", "AI", "Health");

    @Bean
    OpenAPI estrellaOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("ESTRELLA API")
                        .version("v1")
                        .description("""
                                Cuentas, consentimientos (LOPDP), proyectos cifrados de extremo a extremo y asistente.

                                - **Sesión:** `POST /api/v1/auth/login` devuelve un token de acceso de 15 minutos y deja \
                                la cookie de renovación (`HttpOnly`, `Secure`, `SameSite`). `refresh` y `logout` exigen \
                                además la cabecera `X-Estrella-Client`, que un formulario de otro sitio no puede enviar.
                                - **La contraseña nunca viaja:** el dispositivo deriva de ella `authKey` y una llave \
                                que no sale del equipo; con esa llave cifra nombres y contenido de los proyectos.
                                - **Errores:** RFC 9457 (`application/problem+json`) con un `code` estable para \
                                programas y un `detail` en español para mostrar.
                                """)
                        .license(new License().name("MIT").url("https://opensource.org/license/mit")))
                .servers(List.of(new Server().url("/").description("El mismo sitio que sirve el panel")))
                .components(new Components()
                        .addSecuritySchemes(BEARER, new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")
                                .description("Token de acceso de login o refresh")));
    }

    /**
     * A bearer token on every route except the ones SecurityConfig leaves public, RFC 9457 errors on
     * all, and the tags in reading order. The error schema is added here because springdoc drops
     * schemas that nothing references before customizers run.
     */
    @Bean
    OpenApiCustomizer sessionsAndErrors() {
        Set<String> publicGets = Set.of(SecurityConfig.PUBLIC_GETS);
        Set<String> publicPosts = Set.of(SecurityConfig.PUBLIC_POSTS);
        return api -> {
            api.getComponents().addSchemas(PROBLEM, problemSchema());
            api.getTags().sort(Comparator.comparingInt(tag -> TAG_ORDER.indexOf(tag.getName())));
            api.getPaths().forEach((path, item) -> item.readOperationsMap().forEach((method, operation) -> {
                boolean open = method == PathItem.HttpMethod.GET && publicGets.contains(path)
                        || method == PathItem.HttpMethod.POST && publicPosts.contains(path);
                if (!open) {
                    operation.addSecurityItem(new SecurityRequirement().addList(BEARER));
                }
                operation.getResponses().addApiResponse("default", new ApiResponse()
                        .description("Error (RFC 9457)")
                        .content(new Content().addMediaType("application/problem+json",
                                new MediaType().schema(new Schema<>().$ref("#/components/schemas/" + PROBLEM)))));
            }));
        };
    }

    private static Schema<?> problemSchema() {
        return new ObjectSchema()
                .description("Problem details (RFC 9457)")
                .addProperty("type", new StringSchema().example("about:blank"))
                .addProperty("title", new StringSchema().example("Bad Request"))
                .addProperty("status", new IntegerSchema().example(400))
                .addProperty("detail", new StringSchema().description("Mensaje para mostrar").example("Hay datos inválidos"))
                .addProperty("instance", new StringSchema().example("/api/v1/auth/register"))
                .addProperty("code", new StringSchema().description("Código estable, para programas").example("VALIDATION"))
                .addProperty("fields", new ArraySchema().items(new StringSchema()).description("Campos inválidos, si los hay"));
    }
}
