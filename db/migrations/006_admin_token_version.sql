-- Additive administrator session-revocation version.
-- Existing JWTs are treated as version 0 until the administrator resets a password.

ALTER TABLE admins
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
