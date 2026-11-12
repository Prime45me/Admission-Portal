# Admission Portal - Project Progress

**Last reviewed:** 2026-10-31
**Project:** Peniel Admission Portal
**Current phase:** Production-readiness documentation and external-service configuration

This document records implemented backend, database, frontend, CI, upload, and email behavior. It is not evidence that live third-party services have been configured.

## Current implementation

| Area | Status | What is present |
| --- | --- | --- |
| Backend application | Implemented and tested | Express 5 API, PostgreSQL pool, Helmet, configurable CORS, JSON limits for JSON routes, and admin JWT authentication. |
| Applicant submission | Implemented and verified locally | Atomic PostgreSQL submission, required applicant and guardian validation, application-number collision retries, multipart passport handling, and database-backed idempotency. |
| Repeated submissions | Implemented and verified locally | SHA-256 idempotency-key hashes and payload fingerprints stored in `application_idempotency_keys`; identical retries return the original result, while changed payloads return HTTP 409. Local PostgreSQL verification used no real applicant records. |
| Additional application information | Implemented | Optional current/previous school and child notes flow through multipart submission and the admin detail view; whitespace becomes NULL and child notes are limited to 2,000 characters. |
| Passport upload | Implemented; live storage unverified | Required JPEG, PNG, or WebP multipart photograph, 5 MB limit, signature verification, random storage object names, private Supabase Storage upload, document metadata, and cleanup. |
| Document metadata | Implemented with migration | Migration `003_passport_document_metadata.sql` safely adds MIME type and file-size metadata and lookup indexes. No image binaries are stored in PostgreSQL. |
| Administrator photograph access | Implemented; live storage unverified | Protected `GET /api/applications/:id/passport` verifies the application/document association and returns a short-lived signed URL. |
| Confirmation email | Implemented; live delivery unverified | Resend HTML/plain-text confirmation is sent after a new successful commit only. Missing credentials or delivery failures are non-fatal; duplicate retries do not resend. |
| Application administration API | Implemented and verified locally | List/filter/page applications, statistics, detail retrieval, supported status updates, deletion where implemented, and admin authorization. |
| Dashboard frontend | Implemented | Admin dashboard exists for application review and administrative operations; continue visual and integration verification against the real API/database. |
| Admin login | Implemented and rate-limited | Bcrypt password hashes, JWT issuance, one-hour token lifetime, login throttling, and server-side admin-role enforcement. |
| Database schema | Implemented with additive migrations | Starter schema plus status and idempotency/document migrations. Existing schema was inspected before changes; destructive schema changes were not performed. |
| Automated tests | Implemented | Backend test suite: 74 tests passed locally after the Resend SDK error-response and test-mode safeguards. |
| Frontend build | Verified | Frontend React 18/Vite 6 production build completed successfully in clean validation. |
| CI workflow | Implemented | `.github/workflows/ci.yml` includes read-only permissions, separate backend/frontend jobs, backend `npm ci`, frontend frozen pnpm installation/build, and non-blocking audit reporting. Live GitHub Actions execution remains to be confirmed by the repository owner. |

## API routes

- `GET /` - API availability.
- `GET /api/db-test` - PostgreSQL connectivity check.
- `POST /api/auth/login` - public admin login.
- `POST /api/applications` - public multipart application submission with required `application` JSON field and `passport` file.
- `GET /api/applications` - protected, paginated application list with status, class, and search filters.
- `GET /api/applications/stats` - protected dashboard counts.
- `GET /api/applications/:id` - protected application and guardian detail.
- `GET /api/applications/:id/passport` - protected five-minute Supabase signed-URL retrieval.
- `PATCH /api/applications/:id/status` - protected status update with supported statuses.

## Environment and configuration

The backend requires PostgreSQL and JWT configuration. For Passport and email integration:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET=applicant-documents`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

These values must remain server-side. `.env.example` contains placeholders only. The real `.env` must remain excluded from Git. Supabase and Resend credentials and live behavior have not been verified.

## Database migrations

Apply migrations to an existing database only after review:

```powershell
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\001_normalize_application_status.sql
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\002_application_idempotency.sql
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\003_passport_document_metadata.sql
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\004_additional_information_and_payload_fingerprint.sql
```

Do not recreate or truncate the database. Preserve existing applicant data.

## Important gaps and risks

- Live Supabase upload, signed URL, private-bucket policy, and object cleanup require real credentials and a private `applicant-documents` bucket.
- Live Resend sender verification and confirmation delivery require real credentials.
- The document migration and idempotency migration must be applied to every target PostgreSQL database.
- Multiple guardian records are supported by the schema, but the public submission currently creates one primary guardian per request.
- Public application status lookup is not implemented.
- Gender/class policy lists remain institutional-policy decisions; current validation enforces types and lengths.
- Production monitoring, backup policy, secret rotation, and live privacy review remain release work.

## Completed work

- [x] PostgreSQL-backed application submission transaction and reference collision handling.
- [x] Database-backed submission idempotency with hash-keyed duplicate retries.
- [x] Lowercase status normalization and migration.
- [x] Admin JWT authentication, role protection, login throttling, and safe login errors.
- [x] Application list, detail, statistics, filters, pagination, status updates, and frontend integration.
- [x] Required passport selection, preview, replacement, removal, frontend validation, and multipart submission.
- [x] Backend signature/type validation, 5 MB limit, private Supabase Storage, metadata migration, cleanup, and signed URLs.
- [x] Optional Resend confirmation email and duplicate-retry suppression.
- [x] GitHub Actions CI for backend tests and frontend build.
- [x] Dependency remediation where compatible fixes were available; unresolved audit findings remain documented rather than suppressed.

## Remaining work

- [ ] Apply reviewed migrations to target databases.
- [ ] Configure the private Supabase bucket and policies with real project credentials.
- [ ] Verify a live passport upload, signed URL, and cleanup behavior.
- [ ] Verify Resend sender and confirmation email delivery with real credentials.
- [ ] Complete staff-dashboard visual/API end-to-end verification with non-production data.
- [ ] Confirm GitHub Actions runs successfully after the first approved push.
- [ ] Complete institutional policy review for gender and class values.
- [ ] Implement public status lookup if approved.
- [ ] Complete production monitoring, backup, privacy, and deployment planning in a separate phase.

## Update log

- **2026-10-31:** Updated the project record for database idempotency verification, private Supabase passport uploads, protected signed-URL retrieval, Resend confirmation delivery, GitHub Actions CI, migration requirements, and the latest verified backend test/build status. Live credential-dependent behavior remains unverified.
