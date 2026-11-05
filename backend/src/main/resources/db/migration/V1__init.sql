CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE user_account (
    id                   uuid PRIMARY KEY,
    email                citext NOT NULL UNIQUE,
    password_hash        text NOT NULL,
    email_verified_at    timestamptz,
    wrapped_key_password bytea NOT NULL,
    wrapped_key_recovery bytea NOT NULL,
    key_salt             bytea NOT NULL,
    avatar               bytea CHECK (avatar IS NULL OR octet_length(avatar) <= 262144),
    storage_used_bytes   bigint NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0),
    storage_quota_bytes  bigint NOT NULL CHECK (storage_quota_bytes >= 0),
    created_at           timestamptz NOT NULL DEFAULT now(),
    CHECK (storage_used_bytes <= storage_quota_bytes)
);

CREATE TABLE user_session (
    id                 uuid PRIMARY KEY,
    user_id            uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    refresh_token_hash bytea NOT NULL UNIQUE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    revoked_at         timestamptz
);
CREATE INDEX idx_user_session_user ON user_session(user_id);

CREATE TABLE email_token (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    purpose    text NOT NULL CHECK (purpose IN ('VERIFY_EMAIL', 'RESET_PASSWORD')),
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);
CREATE INDEX idx_email_token_user ON email_token(user_id);

CREATE TABLE consent_record (
    id             uuid PRIMARY KEY,
    user_id        uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    purpose        text NOT NULL CHECK (purpose IN ('ACCOUNT', 'PROJECT_SYNC', 'SECURITY_EMAIL')),
    notice_version text NOT NULL,
    granted_at     timestamptz NOT NULL DEFAULT now(),
    revoked_at     timestamptz
);
CREATE INDEX idx_consent_user ON consent_record(user_id);

CREATE TABLE project (
    id              uuid PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    program_id      text NOT NULL,
    encrypted_name  bytea NOT NULL,
    current_version bigint NOT NULL DEFAULT 0 CHECK (current_version >= 0),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_user_updated ON project(user_id, updated_at DESC);

CREATE TABLE project_version (
    id          uuid PRIMARY KEY,
    project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    version     bigint NOT NULL CHECK (version > 0),
    storage_key text NOT NULL UNIQUE,
    size_bytes  bigint NOT NULL CHECK (size_bytes >= 0),
    nonce       bytea NOT NULL,
    sha256      bytea NOT NULL CHECK (octet_length(sha256) = 32),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, version)
);

CREATE TABLE program_state (
    user_id        uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    program_id     text NOT NULL,
    thanks_seen_at timestamptz,
    PRIMARY KEY (user_id, program_id)
);
