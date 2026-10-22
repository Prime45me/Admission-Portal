-- Normalize application statuses and enforce the supported lowercase values.
-- This migration updates rows in place and does not delete application data.
BEGIN;

ALTER TABLE applications
    DROP CONSTRAINT IF EXISTS applications_status_check;

UPDATE applications
SET status = 'new'
WHERE status IS NULL;

UPDATE applications
SET status = LOWER(status)
WHERE status <> LOWER(status);

ALTER TABLE applications
    ALTER COLUMN status SET DEFAULT 'new',
    ALTER COLUMN status SET NOT NULL,
    ADD CONSTRAINT applications_status_check
        CHECK (status IN ('new', 'under_review', 'accepted', 'rejected'));

COMMIT;
