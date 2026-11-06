-- Phase 6: encrypted project sync.
-- The server only ever receives ciphertext: names and content are encrypted on the student's
-- device with a key the server never sees (see frontend/src/core/sync.ts).

ALTER TABLE project ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE project ADD CONSTRAINT project_program_id_format CHECK (program_id ~ '^[a-z0-9-]{1,40}$');
-- nonce (12) + tag (16) + at least one byte, and a bounded size for an encrypted title.
ALTER TABLE project ADD CONSTRAINT project_encrypted_name_size CHECK (octet_length(encrypted_name) BETWEEN 29 AND 2048);

ALTER TABLE project_version ADD CONSTRAINT project_version_nonce_size CHECK (octet_length(nonce) = 12);
CREATE INDEX idx_project_version_project ON project_version(project_id, version DESC);

-- Ciphertext of each version, apart from its metadata so listing versions never loads content.
-- It goes away with its version, which goes away with its project, which goes away with its
-- account: deletion is enforced by the database itself (LOPDP art. 15, test T-10).
CREATE TABLE project_blob (
    storage_key text PRIMARY KEY REFERENCES project_version(storage_key) ON DELETE CASCADE,
    data        bytea NOT NULL
);

-- Changes whenever the server empties the account's cloud (sync revoked, or keys reset without the
-- recovery code). A device that sees a new epoch uploads its projects again instead of reading
-- "missing on the server" as "deleted on another device": nothing local is ever lost that way.
ALTER TABLE user_account ADD COLUMN sync_epoch uuid NOT NULL DEFAULT gen_random_uuid();
