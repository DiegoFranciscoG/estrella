package ec.estrella.api.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class AttemptLimiterTest {

    /** A clock the test can move forward. */
    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-11-05T12:00:00Z");

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private final MutableClock clock = new MutableClock();
    private final AttemptLimiter limiter = new AttemptLimiter(clock);

    private void fail(int times) {
        for (int i = 0; i < times; i++) {
            limiter.recordFailure("k");
        }
    }

    @Test
    void firstFailuresAreFree() {
        fail(AttemptLimiter.FREE_FAILURES - 1);
        assertThat(limiter.lockedSeconds("k")).isZero();
    }

    @Test
    void lockStartsAtThirtySecondsAndDoubles() {
        fail(AttemptLimiter.FREE_FAILURES);
        assertThat(limiter.lockedSeconds("k")).isEqualTo(30);
        fail(1);
        assertThat(limiter.lockedSeconds("k")).isEqualTo(60);
        fail(1);
        assertThat(limiter.lockedSeconds("k")).isEqualTo(120);
    }

    @Test
    void lockNeverExceedsFifteenMinutes() {
        fail(40);
        assertThat(limiter.lockedSeconds("k")).isEqualTo(Duration.ofMinutes(15).toSeconds());
    }

    @Test
    void lockExpiresWithTime() {
        fail(AttemptLimiter.FREE_FAILURES);
        clock.advance(Duration.ofSeconds(31));
        assertThat(limiter.lockedSeconds("k")).isZero();
    }

    @Test
    void successResetsTheCounter() {
        fail(AttemptLimiter.FREE_FAILURES);
        limiter.reset("k");
        assertThat(limiter.lockedSeconds("k")).isZero();
    }

    @Test
    void keysAreIndependent() {
        fail(AttemptLimiter.FREE_FAILURES);
        assertThat(limiter.lockedSeconds("other")).isZero();
    }

    @Test
    void fixedWindowAllowsTheLimitThenBlocksUntilItResets() {
        Duration hour = Duration.ofHours(1);
        for (int i = 0; i < 3; i++) {
            assertThat(limiter.tryAcquire("w", 3, hour)).isTrue();
        }
        assertThat(limiter.tryAcquire("w", 3, hour)).isFalse();
        clock.advance(hour);
        assertThat(limiter.tryAcquire("w", 3, hour)).isTrue();
    }

    @Test
    void purgeForgetsOldEntries() {
        fail(1);
        limiter.tryAcquire("w", 1, Duration.ofHours(1));
        clock.advance(Duration.ofDays(2));
        limiter.purgeOlderThan(Duration.ofDays(1));
        assertThat(limiter.tryAcquire("w", 1, Duration.ofDays(10))).isTrue();
        fail(AttemptLimiter.FREE_FAILURES - 1);
        assertThat(limiter.lockedSeconds("k")).isZero();
    }
}
