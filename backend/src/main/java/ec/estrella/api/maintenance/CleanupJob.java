package ec.estrella.api.maintenance;

import ec.estrella.api.account.UserRepository;
import ec.estrella.api.auth.AttemptLimiter;
import ec.estrella.api.auth.EmailTokenRepository;
import ec.estrella.api.auth.SessionRepository;
import ec.estrella.api.config.AppProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Retention rules written down (LOPDP art. 10.i): nothing is kept longer than its purpose needs. */
@Component
public class CleanupJob {

    private static final Logger log = LoggerFactory.getLogger(CleanupJob.class);

    private final UserRepository users;
    private final SessionRepository sessions;
    private final EmailTokenRepository emailTokens;
    private final AttemptLimiter limiter;
    private final AppProperties properties;
    private final Clock clock;

    public CleanupJob(UserRepository users, SessionRepository sessions, EmailTokenRepository emailTokens,
                      AttemptLimiter limiter, AppProperties properties, Clock clock) {
        this.users = users;
        this.sessions = sessions;
        this.emailTokens = emailTokens;
        this.limiter = limiter;
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "PT1H", initialDelayString = "PT1M")
    public void run() {
        Instant now = clock.instant();
        int accounts = users.deleteUnverifiedCreatedBefore(now.minus(properties.unverifiedAccountRetention()));
        int expiredSessions = sessions.deleteExpiredBefore(now);
        int tokens = emailTokens.deleteExpiredBefore(now.minus(Duration.ofDays(1)));
        limiter.purgeOlderThan(Duration.ofDays(1));
        log.info("Cleanup removed {} unverified accounts, {} sessions, {} email tokens",
                accounts, expiredSessions, tokens);
    }
}
