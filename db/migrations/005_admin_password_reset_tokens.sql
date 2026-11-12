-- Additive migration for administrator password reset tokens.
-- Does not modify existing administrator or applicant records.

CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_admin_password_reset_admin
        FOREIGN KEY (admin_id)
        REFERENCES admins(id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_password_reset_tokens_token_hash_uq
    ON admin_password_reset_tokens(token_hash);

CREATE INDEX IF NOT EXISTS admin_password_reset_tokens_admin_id_idx
    ON admin_password_reset_tokens(admin_id);

CREATE INDEX IF NOT EXISTS admin_password_reset_tokens_expires_at_idx
    ON admin_password_reset_tokens(expires_at);
