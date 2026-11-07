package ec.estrella.api.common;

import ec.estrella.api.config.AppProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Spring reads a JSON body whole into memory before validating it, so its size is checked first
 * (OWASP API4, unrestricted resource consumption). JSON must declare its length and stay under
 * app.max-json-bytes. Photos and encrypted projects have their own limits where they are read.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class JsonSizeLimitFilter extends OncePerRequestFilter {

    private final long maxBytes;

    public JsonSizeLimitFilter(AppProperties properties) {
        this.maxBytes = properties.maxJsonBytes();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String type = request.getContentType();
        if (type != null && type.toLowerCase().startsWith(MediaType.APPLICATION_JSON_VALUE)) {
            long length = request.getContentLengthLong();
            // No length and no chunked body means no body at all; a chunked one could be any size.
            if (length < 0 && request.getHeader("Transfer-Encoding") != null) {
                reject(response, HttpServletResponse.SC_LENGTH_REQUIRED, "LENGTH_REQUIRED", "Falta el tamaño de la solicitud");
                return;
            }
            if (length > maxBytes) {
                reject(response, 413, "TOO_LARGE", "La solicitud es demasiado grande");
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private static void reject(HttpServletResponse response, int status, String code, String detail) throws IOException {
        FilterProblems.write(response, status, code, detail);
    }
}
