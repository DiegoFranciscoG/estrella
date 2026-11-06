package ec.estrella.api.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * In-memory attempt control. Two policies:
 * <ul>
 *   <li>Login failures: after {@value #FREE_FAILURES} failures, the key is locked for 30 s, doubling on each
 *       further failure up to 15 min (progressive delay, OWASP Authentication Cheat Sheet).</li>
 *   <li>Fixed windows for actions that send email, so they cannot be used to flood an inbox.</li>
 * </ul>
 * Single instance only; a multi-instance deployment would move this to a shared store.
 */
@Component
public class AttemptLimiter {

    static final int FREE_FAILURES = 5;
    static final Duration BASE_LOCK = Duration.ofSeconds(30);
    static final Duration MAX_LOCK = Duration.ofMinutes(15);

    private record Failures(int count, Instant lockedUntil, Instant lastSeen) {
    }

    private record Window(Instant start, int count) {
    }

    private final Map<String, Failures> failures = new ConcurrentHashMap<>();
    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final Clock clock;

    public AttemptLimiter(Clock clock) {
        this.clock = clock;
    }

    /** Seconds the caller must wait, or 0 if allowed. */
    public long lockedSeconds(String key) {
        Failures f = failures.get(key);
        if (f == null || f.lockedUntil() == null) {
            return 0;
        }
        long seconds = Duration.between(clock.instant(), f.lockedUntil()).toSeconds();
        return Math.max(0, seconds);
    }

    public void recordFailure(String key) {
        recordFailure(key, FREE_FAILURES);
    }

    /** Same policy with a custom number of free failures, for keys shared by many people. */
    public void recordFailure(String key, int freeFailures) {
        Instant now = clock.instant();
        failures.compute(key, (k, old) -> {
            int count = old == null ? 1 : old.count() + 1;
            Instant lockedUntil = null;
            if (count >= freeFailures) {
                int exponent = Math.min(count - freeFailures, 10);
                Duration lock = BASE_LOCK.multipliedBy(1L << exponent);
                lockedUntil = now.plus(lock.compareTo(MAX_LOCK) > 0 ? MAX_LOCK : lock);
            }
            return new Failures(count, lockedUntil, now);
        });
    }

    public void reset(String key) {
        failures.remove(key);
    }

    /** True if the action is allowed in the current window, and counts it. */
    public boolean tryAcquire(String key, int limit, Duration window) {
        Instant now = clock.instant();
        Window w = windows.compute(key, (k, old) -> {
            if (old == null || !now.isBefore(old.start().plus(window))) {
                return new Window(now, 1);
            }
            return new Window(old.start(), old.count() + 1);
        });
        return w.count() <= limit;
    }

    /** Forget entries untouched for a day so memory stays bounded. */
    public void purgeOlderThan(Duration age) {
        Instant cutoff = clock.instant().minus(age);
        failures.entrySet().removeIf(e -> e.getValue().lastSeen().isBefore(cutoff)
                && (e.getValue().lockedUntil() == null || e.getValue().lockedUntil().isBefore(cutoff)));
        windows.entrySet().removeIf(e -> e.getValue().start().isBefore(cutoff));
    }
}
