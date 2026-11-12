# Admission Portal - Project Progress

**Last reviewed:** 2026-11-12
**Project:** Peniel Admission Portal
**Current phase:** Password-reset hardening and production-readiness verification

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
| Admin login and sessions | Implemented; token-version migration pending | Bcrypt password hashes, one-hour JWTs with `token_version`, IP-based login throttling, server-side role/version checks, and session invalidation after password reset. |
| Admin password reset | Implemented; live email delivery unverified | Generic forgot-password response, hashed 30-minute single-use tokens, Resend integration, email and IP throttling, and transactional password/token-version updates. |
| Reset-request throttling | Implemented; process-local | Limits requests by IP and normalized email using HMAC email keys. In-memory state is bounded and expires, but is not shared across instances or restarts. |
| Database schema | Implemented with additive migrations | Starter schema plus status, idempotency/document, password-reset-token, and admin token-version migrations. Migration 005 was verified read-only in the local database; migration 006 has not been applied. |
| Automated tests | Implemented and verified locally | Backend unit/API suite: 86 passed. PostgreSQL password-reset integration suite: 6 passed in an isolated temporary schema. |
| Frontend build | Verified | Frontend React 18/Vite 6 production build completed successfully in clean validation. |
| CI workflow | Implemented | `.github/workflows/ci.yml` includes read-only permissions, separate backend/frontend jobs, backend `npm ci`, frontend frozen pnpm installation/build, and non-blocking audit reporting. Live GitHub Actions execution remains to be confirmed by the repository owner. |

## API routes

- `GET /` - API availability.
- `GET /api/db-test` - PostgreSQL connectivity check.
- `POST /api/auth/login` - public admin login.
- `POST /api/auth/forgot-password` - public generic reset request with IP and account throttling.
- `POST /api/auth/reset-password` - public single-use token consumption and password update.
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
- `FRONTEND_URL` - frontend base URL used in reset links.
- `RESET_RATE_LIMIT_SECRET` - optional HMAC key; defaults to `JWT_SECRET`.

These values must remain server-side. `.env.example` contains placeholders only. The real `.env` must remain excluded from Git. Supabase and Resend credentials and live behavior have not been verified.

The forgot-password IP and account limiters use process-local memory. State resets on restart and is not shared across instances; multi-instance deployments need a shared rate-limit store. Reset emails are sent after the generic response without a durable queue, so abrupt process termination can interrupt delivery.

## Database migrations

Apply migrations to an existing database only after review:

```powershell
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\001_normalize_application_status.sql
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\002_application_idempotency_keys.sql
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\003_passport_document_metadata.sql
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\004_additional_information_and_payload_fingerprint.sql
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\005_admin_password_reset_tokens.sql
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\006_admin_token_version.sql
```

Migration 005's table and indexes were inspected read-only in the local PostgreSQL database and match the migration. Migration 006 adds `admins.token_version INTEGER NOT NULL DEFAULT 0`; it was not applied. Review and manually apply 006 before starting the updated backend against an existing database. Do not recreate or truncate the database. Preserve existing applicant and administrator data.

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
- [x] Admin forgot/reset-password flow with hashed single-use tokens and generic responses.
- [x] JWT token-version enforcement and password-reset session invalidation implementation.
- [x] Account/email reset throttling, bounded in-memory state, and admin-first PostgreSQL locking.
- [x] Mocked reset unit tests and real PostgreSQL concurrency tests in an isolated schema.
- [x] GitHub Actions CI for backend tests and frontend build.
- [x] Dependency remediation where compatible fixes were available; unresolved audit findings remain documented rather than suppressed.

## Remaining work

- [ ] Review and manually apply migration `006_admin_token_version.sql` to target databases before deploying the updated backend.
- [ ] Configure the private Supabase bucket and policies with real project credentials.
- [ ] Verify a live passport upload, signed URL, and cleanup behavior.
- [ ] Verify Resend sender and confirmation email delivery with real credentials.
- [ ] Complete staff-dashboard visual/API end-to-end verification with non-production data.
- [ ] Confirm GitHub Actions runs successfully after the first approved push.
- [ ] Complete institutional policy review for gender and class values.
- [ ] Implement public status lookup if approved.
- [ ] Complete production monitoring, backup, privacy, and deployment planning in a separate phase.

## Update log

- **2026-11-12:** Documented password-reset security hardening: administrator JWT token versions, account-based reset throttling, admin-first reset-token locking, 86 passing backend unit/API tests, and 6 passing PostgreSQL integration tests. Migration 006 remains unapplied; Resend live delivery and multi-instance rate-limit behavior remain unverified.
- **2026-10-31:** Updated the project record for database idempotency verification, private Supabase passport uploads, protected signed-URL retrieval, Resend confirmation delivery, GitHub Actions CI, migration requirements, and the latest verified backend test/build status. Live credential-dependent behavior remains unverified.
