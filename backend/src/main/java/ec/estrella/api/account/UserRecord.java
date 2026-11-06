package ec.estrella.api.account;

import java.time.Instant;
import java.util.UUID;

public record UserRecord(
        UUID id,
        String email,
        String passwordHash,
        Instant emailVerifiedAt,
        byte[] wrappedKeyPassword,
        byte[] wrappedKeyRecovery,
        byte[] keySalt,
        long storageUsedBytes,
        long storageQuotaBytes,
        boolean hasAvatar) {

    public boolean verified() {
        return emailVerifiedAt != null;
    }
}
