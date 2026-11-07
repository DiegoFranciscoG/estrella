package ec.estrella.api.common;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * "Is the API awake?" for the app: free hosting sleeps when idle and takes about a minute to wake.
 * The app asks here (a GET, safe to repeat) before sending anything that changes data, so a request
 * like a session refresh is never lost halfway while the server starts.
 */
@RestController
public class HealthController {

    @GetMapping("/api/v1/health")
    ResponseEntity<Void> health() {
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
