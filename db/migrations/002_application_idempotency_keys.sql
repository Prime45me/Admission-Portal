BEGIN;

CREATE TABLE IF NOT EXISTS application_idempotency_keys (
    id SERIAL PRIMARY KEY,
    key_hash VARCHAR(128) NOT NULL UNIQUE,
    application_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),

    CONSTRAINT fk_idempotency_application
        FOREIGN KEY (application_id)
        REFERENCES applications(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS application_idempotency_keys_expires_at_idx
    ON application_idempotency_keys(expires_at);

COMMIT;
