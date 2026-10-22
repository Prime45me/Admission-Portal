
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
    status VARCHAR(30) DEFAULT 'NEW',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Keep existing development databases aligned with the API's uppercase statuses.
UPDATE applications
SET status = UPPER(status)
WHERE status IS NOT NULL
  AND status <> UPPER(status);

ALTER TABLE applications
    ALTER COLUMN status SET DEFAULT 'NEW';

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

COMMIT;
