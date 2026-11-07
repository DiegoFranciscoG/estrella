package ec.estrella.api.common;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;

/** RFC 9457 answers written by servlet filters, which run before Spring MVC's error handling. */
final class FilterProblems {

    private FilterProblems() {
    }

    /** {@code code} and {@code detail} are constants of this code base, never request data. */
    static void write(HttpServletResponse response, int status, String code, String detail) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setHeader("Cache-Control", "no-store");
        response.getOutputStream().write(("{\"type\":\"about:blank\",\"status\":" + status + ",\"detail\":\"" + detail
                + "\",\"code\":\"" + code + "\"}").getBytes(StandardCharsets.UTF_8));
    }
}
