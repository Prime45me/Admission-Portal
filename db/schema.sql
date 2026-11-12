
-- Peniel Admission Portal
-- Development database schema.
-- This script does not drop existing tables or records.

BEGIN;

-- 1. Administrator accounts
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Student admission applications
CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    application_number VARCHAR(30) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender VARCHAR(20) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone_number VARCHAR(30) NOT NULL,
    address TEXT NOT NULL,
    class_applied_for VARCHAR(100) NOT NULL,
    current_previous_school TEXT,
    additional_information TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'new',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Replace the status constraint as existing values are normalized.
ALTER TABLE applications
    DROP CONSTRAINT IF EXISTS applications_status_check;

UPDATE applications
SET status = LOWER(status)
WHERE status IS NOT NULL
  AND status <> LOWER(status);

UPDATE applications
SET status = 'new'
WHERE status IS NULL;

ALTER TABLE applications
    ALTER COLUMN status SET DEFAULT 'new',
    ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'applications'::regclass
          AND conname = 'applications_status_check'
    ) THEN
        ALTER TABLE applications
            ADD CONSTRAINT applications_status_check
            CHECK (status IN ('new', 'under_review', 'accepted', 'rejected'));
    END IF;
END
$$;

-- 3. Guardians
-- One application may have multiple guardians.
CREATE TABLE IF NOT EXISTS guardians (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    relationship VARCHAR(50) NOT NULL,
    phone_number VARCHAR(30) NOT NULL,
    email VARCHAR(150),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_guardian_application
        FOREIGN KEY (application_id)
        REFERENCES applications(id)
        ON DELETE CASCADE
);

-- Guardian email is optional for new and existing development databases.
ALTER TABLE guardians
    ALTER COLUMN email DROP NOT NULL;

-- 4. Uploaded document metadata
-- One application may have multiple documents.
-- Actual files are stored separately from PostgreSQL.
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL,
    document_type VARCHAR NOT NULL,
    filename VARCHAR NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type VARCHAR(100),
    file_size INTEGER,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_document_application
        FOREIGN KEY (application_id)
        REFERENCES applications(id)
        ON DELETE CASCADE
);

-- Indexes to help common application queries.
CREATE INDEX IF NOT EXISTS applications_status_idx
    ON applications(status);

CREATE INDEX IF NOT EXISTS applications_class_idx
    ON applications(class_applied_for);

CREATE INDEX IF NOT EXISTS applications_created_at_idx
    ON applications(created_at DESC);

-- These are deliberately non-unique: multiple records per application
-- are allowed in both related tables.
CREATE INDEX IF NOT EXISTS guardians_application_id_idx
    ON guardians(application_id);

CREATE INDEX IF NOT EXISTS documents_application_id_idx
    ON documents(application_id);

CREATE INDEX IF NOT EXISTS documents_application_type_idx
    ON documents(application_id, document_type);

-- 5. Request idempotency keys to prevent duplicate application retries.
CREATE TABLE IF NOT EXISTS application_idempotency_keys (
    id SERIAL PRIMARY KEY,
    key_hash VARCHAR(128) NOT NULL UNIQUE,
    application_id INTEGER NOT NULL,
    payload_fingerprint VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),

    CONSTRAINT fk_idempotency_application
        FOREIGN KEY (application_id)
        REFERENCES applications(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS application_idempotency_keys_expires_at_idx
    ON application_idempotency_keys(expires_at);

-- 6. Administrator password reset tokens.
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

COMMIT;
