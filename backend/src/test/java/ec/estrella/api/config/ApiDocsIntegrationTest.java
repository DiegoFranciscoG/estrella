package ec.estrella.api.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.endsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ec.estrella.api.support.IntegrationTest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The API contract with the docs turned on (APP_API_DOCS=true, as in the local stack). The copy in
 * docs/openapi.json must match what the code generates; {@code mvn verify -Dopenapi.write=true} refreshes it.
 */
@TestPropertySource(properties = {"springdoc.api-docs.enabled=true", "springdoc.swagger-ui.enabled=true"})
class ApiDocsIntegrationTest extends IntegrationTest {

    private static final Path SNAPSHOT = Path.of("..", "docs", "openapi.json");
    /** A value for each path variable, valid enough to reach the security check. */
    private static final Map<String, String> SAMPLE = Map.of(
            "{id}", "00000000-0000-4000-8000-000000000000",
            "{version}", "1",
            "{programId}", "apuntes",
            "{purpose}", "ACCOUNT");

    private final JsonMapper json = JsonMapper.builder().build();

    private JsonNode contract() throws Exception {
        return json.readTree(mvc.perform(get("/api/v1/openapi")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    /** OWASP API9 (inventory): every route the server answers is in the contract, and nothing else. */
    @Test
    void everyRouteTheServerAnswersIsDocumented() throws Exception {
        RequestMappingHandlerMapping mappings =
                context.getBean("requestMappingHandlerMapping", RequestMappingHandlerMapping.class);
        Set<String> served = new TreeSet<>();
        mappings.getHandlerMethods().forEach((info, handler) -> {
            if (handler.getBeanType().getPackageName().startsWith("ec.estrella.api")) {
                info.getPathPatternsCondition().getPatternValues().forEach(path -> info.getMethodsCondition()
                        .getMethods().forEach(method -> served.add(method.name() + " " + path)));
            }
        });
        assertThat(documented().keySet()).isEqualTo(served);
    }

    /** The lock icons cannot lie: a route documented as public answers strangers, any other one refuses them. */
    @Test
    void theDocumentedSessionRuleIsTheRealOne() throws Exception {
        for (Map.Entry<String, Boolean> route : documented().entrySet()) {
            String[] parts = route.getKey().split(" ", 2);
            String path = parts[1];
            for (Map.Entry<String, String> sample : SAMPLE.entrySet()) {
                path = path.replace(sample.getKey(), sample.getValue());
            }
            int status = mvc.perform(request(HttpMethod.valueOf(parts[0]), path)).andReturn().getResponse().getStatus();
            if (route.getValue()) {
                assertThat(status).as(route.getKey()).isEqualTo(401);
            } else {
                assertThat(status).as(route.getKey()).isNotEqualTo(401).isNotEqualTo(403);
            }
        }
    }

    @Test
    void swaggerUiIsServedWithAPageCspThatAllowsNothingFromOtherSites() throws Exception {
        mvc.perform(get("/api/docs"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", endsWith("/api/swagger-ui/index.html")));
        mvc.perform(get("/api/swagger-ui/index.html"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Security-Policy", SecurityConfig.DOCS_CSP))
                .andExpect(header().string("X-Frame-Options", "DENY"));
        mvc.perform(get("/api/v1/openapi/swagger-config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("/api/v1/openapi"));
    }

    @Test
    void theDocsAreReadOnly() throws Exception {
        mvc.perform(post("/api/v1/openapi")).andExpect(status().isForbidden());
        mvc.perform(post("/api/swagger-ui/index.html")).andExpect(status().isForbidden());
    }

    @Test
    void theCommittedContractMatchesTheCode() throws Exception {
        JsonNode generated = contract();
        if (Boolean.getBoolean("openapi.write")) {
            Files.writeString(SNAPSHOT, json.writerWithDefaultPrettyPrinter().writeValueAsString(generated) + "\n",
                    StandardCharsets.UTF_8);
        }
        assertThat(SNAPSHOT).as("Missing docs/openapi.json: run mvn verify -Dopenapi.write=true").exists();
        assertThat(json.readTree(Files.readString(SNAPSHOT, StandardCharsets.UTF_8)))
                .as("docs/openapi.json is out of date: run mvn verify -Dopenapi.write=true")
                .isEqualTo(generated);
    }

    /** "METHOD /path" of every documented operation, mapped to whether it asks for a bearer token. */
    private Map<String, Boolean> documented() throws Exception {
        Map<String, Boolean> routes = new TreeMap<>();
        contract().get("paths").properties().forEach(path -> path.getValue().properties().forEach(operation ->
                routes.put(operation.getKey().toUpperCase() + " " + path.getKey(),
                        operation.getValue().has("security"))));
        return routes;
    }
}
