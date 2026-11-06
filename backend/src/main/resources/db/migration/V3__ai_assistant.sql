-- Phase 7: the assistant uses each student's own OpenRouter account.

-- Its own consent (LOPDP art. 8), given only when connecting with the 18+ declaration.
ALTER TABLE consent_record DROP CONSTRAINT consent_record_purpose_check;
ALTER TABLE consent_record ADD CONSTRAINT consent_record_purpose_check
    CHECK (purpose IN ('ACCOUNT', 'PROJECT_SYNC', 'SECURITY_EMAIL', 'AI_ASSISTANT'));

-- The key never reaches the browser and is never stored readable: AES-256-GCM with a key from the
-- environment, bound to its owner. Questions and answers are not stored anywhere.
CREATE TABLE ai_connection (
    user_id        uuid PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
    key_nonce      bytea NOT NULL CHECK (octet_length(key_nonce) = 12),
    key_ciphertext bytea NOT NULL CHECK (octet_length(key_ciphertext) BETWEEN 17 AND 1024),
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_used_at   timestamptz
);
