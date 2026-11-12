# Peniel Admission Portal

Peniel Admission Portal is an early-stage school admissions project. The code currently in this repository is a Node.js and Express backend API backed by PostgreSQL. It provides initial endpoints for submitting applications and for administrators to sign in and review application records.

> **Development project:** This repository is being built incrementally. The current implementation and setup are for development and learning, not a finished or production-ready admissions system. Production deployment is a later project phase, not a requirement for the current work.

The school website frontend lives in the sibling `frontend/` directory (React 18, Vite 6, TypeScript, React Router, and Tailwind CSS v4). Its applicant-facing admissions form is integrated with this backend API. A staff dashboard and self-service application-status lookup remain future tasks. The backend includes a starter schema, status migration, and a test suite using Node's built-in test runner. See [PROJECT_PROGRESS.md](./PROJECT_PROGRESS.md) for the current status and work plan.

## Current capabilities

- Accept an applicant's basic details, guardian details, and a required passport photograph.
- Save an application and its guardian record in a single database transaction, reusing a matching guardian record if one is already linked to that application.
- Generate an application reference in the format `PEN-<year>-<random code>`.
- List applications with optional status, class, and text search filters, plus pagination.
- Retrieve an application together with all guardian records.
- Change an application's status.
- Authenticate an administrator using a password hash and issue a one-hour JSON Web Token (JWT).
- Invalidate prior administrator JWTs after a password reset using a database-backed token version.
- Provide generic forgot-password requests and single-use, 30-minute reset links using SHA-256 token hashes and the existing Resend integration.
- Throttle password-reset requests by IP and normalized email without storing plaintext email addresses in rate-limit keys.
- Protect application listing, detail, status-update, and dashboard-statistics routes with admin JWT authentication.
- Provide dashboard counts for supported application statuses.
- Send a branded Resend notification after each committed application status transition.
- Validate submitted applicant/guardian fields, date of birth, email syntax, and Ghanaian phone number formats.
- Limit repeated login attempts.
- Check whether the API can connect to PostgreSQL.
- Define starter PostgreSQL tables for administrators, applications, guardians, and uploaded-document metadata.
- Upload passport photographs to the private Supabase Storage bucket and store verified metadata in PostgreSQL.
- Generate short-lived signed URLs for authenticated administrator access.
- Send an optional Resend application-confirmation email only after a new successful submission.
- **Frontend Admission Integration:** Online application form at `/admissions?section=apply`, pre-validation (Ghanaian phone formats, non-future calendar DOB, email syntax), snake_case API payload mapping, loading/duplicate submission locks, graceful error preservation, and genuine printable confirmation slip with the generated `PEN-YEAR-HEX` reference.


## Technology

- Node.js with CommonJS modules
- Express 5
- PostgreSQL via `pg`
- `bcrypt` for administrator password hashing
- `jsonwebtoken` for login tokens
- `express-rate-limit` for IP-based login and password-reset throttling
- `dotenv` for local environment configuration

The package manifest does not specify a Node.js engine version. Use a currently supported Node.js LTS release compatible with the installed dependencies.

## Project structure

```text
backend/
├── controllers/          # Reserved for request controllers (currently empty)
├── db/
│   ├── db.js             # PostgreSQL connection pool
│   ├── schema.sql        # Starter schema for a development database
│   └── migrations/
│       ├── 001_normalize_application_status.sql
│       ├── 002_application_idempotency_keys.sql
│       ├── 003_passport_document_metadata.sql
│       ├── 004_additional_information_and_payload_fingerprint.sql
│       ├── 005_admin_password_reset_tokens.sql
│       └── 006_admin_token_version.sql
├── middleware/
│   └── requireAdmin.js   # Verifies JWT, token version, and admin role
├── routes/
│   ├── application.js    # Application submission and review endpoints
│   └── auth.js           # Administrator login endpoint
├── tests/                # Unit/API tests using node:test and mocked DB queries
├── integration-tests/    # PostgreSQL-backed password-reset and status tests
├── services/             # Resend email and Supabase Storage integrations
├── utils/                # Reserved for shared utilities (currently empty)
├── .env                  # Local secrets and configuration; do not commit
├── .gitignore            # Excludes node_modules and .env
├── createAdmin.js        # Creates an administrator account
├── package.json          # Dependencies and npm scripts
├── package-lock.json     # Locked dependency versions
├── PROJECT_PROGRESS.md   # Running project status and work plan
├── README.md             # Project and setup documentation
└── server.js             # Express application setup and server startup
```

## Prerequisites

- Node.js and npm
- A running PostgreSQL server and a database
- A PostgreSQL database for local development

The starter schema is in `db/schema.sql`. It uses `CREATE TABLE/INDEX IF NOT EXISTS` inside a transaction and does not drop existing tables or records. Application statuses use lowercase values: `new`, `under_review`, `accepted`, and `rejected`. For an existing database, apply the versioned migration described below rather than re-running the starter schema as a migration mechanism.

## Local setup

Run these commands from the `backend` directory:

```powershell
npm install
```

Create a `.env` file locally and set the required configuration variables:

```dotenv
PORT=5000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password

JWT_SECRET=replace_with_a_long_random_secret
FRONTEND_URL=http://localhost:5173
# Optional; defaults to JWT_SECRET.
RESET_RATE_LIMIT_SECRET=replace_with_a_long_random_secret
CORS_ORIGINS=http://localhost:5173

ADMIN_NAME=Portal Administrator
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace_with_a_strong_password
```

Create the PostgreSQL database named by `DB_NAME`, then apply the starter schema from the `backend` directory:

```powershell
psql -U your_database_user -d your_database_name -f .\db\schema.sql
```

`PORT` defaults to `5000` if omitted. `NODE_ENV` controls environment-specific behavior (the test environment skips login throttling). `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are read by `createAdmin.js`. Keep `.env` local and never commit it.

`CORS_ORIGINS` is a comma-separated allowlist for browser frontend origins. Configure it to match the local frontend origin when one is available. Requests without an `Origin` header are allowed for local tools and server-to-server use. CORS does not replace authentication.

After the database and required tables are ready, create an administrator and start the server:

```powershell
node createAdmin.js
npm run dev
```

For an existing development database, apply the status migration rather than resetting the database:

```powershell
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\001_normalize_application_status.sql
```

The migration normalizes statuses in place, sets the lowercase `new` default, makes the column `NOT NULL`, and adds the supported-status constraint. It does not delete application records.

The development database was inspected read-only and already had the expected lowercase status default and constraint; the migration was not run. Check the target database before applying the migration in another environment.

The manually applied `005_admin_password_reset_tokens.sql` table was inspected read-only and matches its migration definition. Migration 006 was applied to the local database on 2026-11-12. For any other existing database, manually apply this additive migration before starting the updated backend:

```powershell
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\006_admin_token_version.sql
```

The migration adds `admins.token_version INTEGER NOT NULL DEFAULT 0`; it does not recreate tables or alter applicant or administrator identity data. Do not start the updated backend against a database until this migration has been reviewed and applied. Existing JWTs without a `token_version` claim are treated as version `0`; a successful password reset increments the database value and invalidates those sessions.

Forgot-password requests remain limited by IP (5 per 15 minutes) and are additionally limited by normalized email (3 per 15 minutes). Email rate-limit keys are HMAC-SHA-256 digests, not stored email addresses. `RESET_RATE_LIMIT_SECRET` may be set to a long random secret; otherwise `JWT_SECRET` is used. Both rate limiters use process-local in-memory state: limits reset on process restart and are not shared across multiple server instances. The email limiter's state is bounded to 10,000 keys with a 15-minute expiry and fails closed for new keys while at capacity. Multi-instance deployments need a shared rate-limit store to enforce a global limit.

The forgot-password endpoint returns a generic response and enforces a minimum response duration. Resend delivery starts after the HTTP response and uses the existing integration; no queue is introduced. Because delivery is not durable, abrupt process termination can interrupt an in-flight reset email.

`npm run dev` starts the server with Nodemon. Use `npm start` to run it without Nodemon. The server listens on the configured port.

## Passport photographs and email notifications

Application submission is multipart and requires a `passport` file in addition to the JSON form fields encoded as the `application` field. The browser must send up to 5 MB as JPEG, PNG, or WebP. The server verifies the file signature, stores it in a private Supabase Storage bucket, and records metadata in the existing `documents` table. For an existing database, apply:

```powershell
psql -v ON_ERROR_STOP=1 -U your_database_user -d your_database_name -f .\db\migrations\003_passport_document_metadata.sql
```

Use the existing private Supabase Storage bucket named `applicant-documents`; confirm `SUPABASE_STORAGE_BUCKET=applicant-documents` in the backend environment. Do not create another bucket or make this bucket public. The service-role key must remain only in the backend environment. Suggested environment variables are documented in `.env.example`.

When configured, Resend sends an HTML/plain-text confirmation after a first successful application commit. Duplicate idempotent retries do not send a second confirmation. If Resend is not configured or delivery fails, the application remains successfully submitted; delivery failures are logged without applicant-facing secret or API details.

When an administrator changes an application to a different supported status, the backend locks and updates the application in a PostgreSQL transaction, commits, then sends a branded HTML/plain-text status notification through Resend. Repeating the current status does not send an email. Email delivery failures do not undo a committed status change. Email templates attach the school logo as an inline Content-ID image from `frontend/public/images/logo.jpeg`; it does not depend on `FRONTEND_URL`, which may be a local URL during development. The status notice also uses the contact details and admissions guidance published in the frontend. No notification outbox is used, so email delivery is best-effort and is not automatically retried after provider failure or process interruption.

Administrators can access a photograph through the protected `GET /api/applications/:id/passport` endpoint. It verifies the application/document association and returns a signed URL valid for five minutes.

To check the API is responding, visit `http://localhost:5000/`. To check the database connection, request `http://localhost:5000/api/db-test`. The database check returns the database name when the connection succeeds; otherwise it returns HTTP 500.

## API

All request and response bodies use JSON with a 64 KB body limit. Helmet security headers are enabled. Browser origins are controlled by `CORS_ORIGINS`. Application submission is public. Application listing, statistics, detail, and status-update routes require the JWT returned by admin login as a Bearer token in the `Authorization` header. The current API does not include a separate applicant-facing status lookup.

### Health and database checks

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Returns a basic API availability message. |
| `GET` | `/api/db-test` | Runs a PostgreSQL query to verify database connectivity. |

### Administrator authentication

#### `POST /api/auth/login`

Request:

```json
{
  "email": "admin@example.com",
  "password": "your-password"
}
```

On success, returns a JWT that expires after one hour and basic administrator details. Use the token as a Bearer token for protected application routes. The login route allows up to 10 attempts per 15-minute window per rate-limit policy. Invalid credentials return HTTP 401; missing or invalid required fields return HTTP 400.

#### `POST /api/auth/forgot-password`

Accepts an administrator email and returns the same generic HTTP 200 response for registered and unregistered addresses. Requests are limited to 5 per IP and 3 per normalized email in a 15-minute window. A reset token is generated with a cryptographically secure random source; only its SHA-256 hash is stored, and it expires after 30 minutes. The reset email uses the configured `FRONTEND_URL`. Resend delivery starts after the generic response, so email latency or failure does not alter the response.

#### `POST /api/auth/reset-password`

Accepts the reset token and a new password. The token must be unused and unexpired. Password change, token-version increment, and invalidation of other active reset tokens run in one transaction. Each protected request checks the JWT's `token_version` against the administrator row; a successful reset therefore rejects previously issued sessions.

Run mocked backend unit/API tests with `npm test`. Run PostgreSQL-backed password-reset integration tests with `npm run test:integration`; they create and remove a uniquely named temporary schema and do not apply migrations to the configured public schema. The integration database user must be allowed to create and drop schemas.

### Applications

#### `POST /api/applications`

Submits an application and its guardian information. Required applicant fields are `first_name`, `last_name`, `date_of_birth`, `gender`, `email`, `phone`, `address`, and `class_applied_for`. Text values must be strings, non-empty after trimming, and within schema-based limits. Applicant email receives syntax validation only; this does not establish that the address exists. Date of birth must be a real `YYYY-MM-DD` calendar date and not in the future in the `Africa/Accra` time zone. Applicant and guardian phone numbers accept Ghana local `0XXXXXXXXX` or international `+233XXXXXXXXX` format, with spaces, parentheses, periods, and hyphens permitted as separators. The guardian's `full_name`, `relationship`, and `phone_number` are required; guardian email and address are optional. A supplied guardian email must pass the same syntax validation.

Example:

```json
{
  "first_name": "Alex",
  "middle_name": "Taylor",
  "last_name": "Morgan",
  "date_of_birth": "2012-04-15",
  "gender": "unspecified",
  "email": "applicant@example.com",
  "phone": "+233241234567",
  "address": "Example Street",
  "class_applied_for": "Year 7",
  "guardian": {
    "full_name": "Jamie Morgan",
    "relationship": "Parent",
    "phone_number": "+233247654321",
    "email": "guardian@example.com",
    "address": "Example Street"
  }
}
```

`middle_name`, guardian `address`, guardian `email`, `current_previous_school`, and `additional_information` are optional; `null` is accepted for optional fields. Whitespace-only text is stored as `NULL`, and `additional_information` is limited to 2,000 characters. On success, returns HTTP 201 with the created application and guardian details. Application and guardian database operations run in one transaction. Before inserting a guardian, the endpoint checks for a matching name (case-insensitive), relationship (case-insensitive), and phone number under that application and reuses a match if found.

To prevent double-click or retry duplication, send an `Idempotency-Key` header (or `idempotency_key` in the JSON body) with a stable unique value. The server hashes the key, uses a PostgreSQL transaction advisory lock, and stores a SHA-256 payload fingerprint together with the original application. The fingerprint includes normalized application and guardian details, `current_previous_school`, `additional_information`, and the SHA-256 hash of the passport bytes. Identical repeated payloads return the original result within 24 hours. Reuse of the key with changed details or a changed/missing photograph returns HTTP 409, and existing records without a fingerprint are not assumed to match. Application reference collisions are retried up to three times.

#### `GET /api/applications`

Returns a paginated application list. Supported query parameters:

| Parameter | Description |
| --- | --- |
| `page` | Page number; defaults to `1`, minimum `1`. |
| `limit` | Results per page; defaults to `10`, constrained to `1`–`100`. |
| `status` | Filter by `new`, `under_review`, `accepted`, or `rejected` (case-insensitive). |
| `class` | Filter by applied-for class. |
| `search` | Case-insensitive partial match against first name, last name, email, or application number. |

The response includes `page`, `limit`, `total`, `totalPages`, and `applications`.

`page` and `limit` must be positive integers if supplied. `limit` is capped at `100`. Invalid status values and malformed filters return HTTP 400. Search and class filter values are trimmed; blank values are ignored.

#### `GET /api/applications/stats`

Returns numeric counts for the supported statuses:

```json
{
  "total": 10,
  "new": 4,
  "under_review": 3,
  "accepted": 2,
  "rejected": 1
}
```

This endpoint requires an admin JWT.

#### `GET /api/applications/:id`

Returns one application and its guardian records as a `guardians` array. The schema permits multiple guardians per application, although the current public submission endpoint creates one guardian per request. Returns HTTP 400 for an invalid ID and HTTP 404 if there is no matching application.

#### `PATCH /api/applications/:id/status`

Updates an application's status. The accepted values are `new`, `under_review`, `accepted`, and `rejected`; input is accepted case-insensitively and normalized to lowercase before saving. A status notification is sent only when the status genuinely changes and after the database transaction commits. Repeating the current status does not send another notification; email failure does not roll back the update.

Request:

```json
{
  "status": "UNDER_REVIEW"
}
```

Returns HTTP 400 for an invalid ID or status, HTTP 404 if the application does not exist, and HTTP 200 with the updated status on success.

## Database and data model

The connection pool is configured in `db/db.js` using `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`.

The starter schema in `db/schema.sql` defines:

- `admins`: administrator name, unique email, password hash, role, and creation timestamp.
- `applications`: unique application number, applicant details, class applied for, status, and timestamps.
- `guardians`: guardian details linked to applications with `ON DELETE CASCADE`; the schema allows multiple guardians per application.
- `documents`: metadata for files linked to applications with `ON DELETE CASCADE`. Actual files are expected to be stored outside PostgreSQL.
- Indexes for application status, class, creation time, and application-to-guardian/document lookup.

The `documents` table stores passport metadata only; image binaries remain in private Supabase Storage. The current submission endpoint accepts one guardian per request, even though the schema supports multiple guardians. It reuses a matching guardian already linked to the application being created. Database-backed idempotency keys prevent retries from creating duplicate application records.

Application statuses use lowercase values (`new`, `under_review`, `accepted`, `rejected`) consistently in the schema and routes. The status column is `NOT NULL`, defaults to `new`, and is constrained to those values. Guardian email is optional in both the route and schema.

## Development-stage security and privacy notes

Applications contain personal information about applicants and guardians. During development, use test data where possible and keep `.env` and real applicant information out of source control. The current staff routes verify JWTs and require the `admin` role. Applicant submission remains public by design at this stage.

Development protections already enabled include JWT verification and admin-role checks on staff routes, Helmet headers, a configurable CORS origin allowlist, a 64 KB JSON body limit, and parameterized SQL. Remaining review before real-world use includes:

- Keep test data separate from real applicant information and continue reviewing returned personal information.
- Revisit validation and database constraints as the admissions workflow becomes defined.
- Establish logging, retention, and backup practices before deployment.
- Use strong secrets and HTTPS in any deployed environment.

## Tests and scripts

Available npm scripts:

| Command | Current behavior |
| --- | --- |
| `npm start` | Runs `node server.js`. |
| `npm run dev` | Runs `nodemon server.js`. |
| `npm test` | Runs the API suite with Node's built-in test runner (`node --test`). Latest run: 74 tests passed. |

## Frontend integration

The school website frontend is in the sibling `frontend/` directory. It is a React 18 and TypeScript single-page application built with Vite 6, React Router DOM 6, and Tailwind CSS v4. The current routes are Home (`/`), About (`/about`), Academics (`/academics`), Admissions (`/admissions`), Gallery (`/gallery`), Contact (`/contact`), and Privacy (`/privacy`).

The admissions page provides an application form that submits to `POST /api/applications` as multipart data. It validates Ghanaian phone numbers, date of birth, and email; enforces a 5 MB JPEG, PNG, or WebP passport selection; previews and allows replacement/removal before submission; maps form values to the backend's snake_case fields; prevents repeated clicks while a submission is in progress; and displays the returned application reference in a printable confirmation.

Configure `VITE_API_BASE_URL` in `..\frontend\.env` to point to the backend (defaults to `http://localhost:5000`; see `..\frontend\.env.example`). Set the backend's `CORS_ORIGINS` to include the frontend development origin, normally `http://localhost:5173`.

### Running frontend and backend together

1. **Start the backend server:**
   ```powershell
   cd backend
   npm run dev
   # Runs on http://localhost:5000
   ```

2. **Start the frontend application:**
   ```powershell
   cd ..\frontend
   npm install
   npm run dev
   # Runs on http://localhost:5173
   ```

3. Visit `http://localhost:5173/admissions?section=apply` to test admissions submission end-to-end. Run `npm run build` from `frontend/` to build the frontend for production.

The staff dashboard and protected application/passport APIs are implemented. Public application-status lookup remains future frontend work.

## Development roadmap

- [x] Integrate applicant admissions form with `POST /api/applications`.
- [x] Implement genuine application reference generation and printable confirmation slip.
- [x] Add database-backed idempotency for repeated application submissions.
- [x] Implement private Supabase passport storage, document metadata, cleanup, and protected signed-URL retrieval.
- [x] Implement optional Resend confirmation email delivery after a first successful submission.
- [ ] Decide authoritative lists for permitted gender values and school classes; validation currently enforces type and length only for those fields.
- [ ] Implement self-service applicant status lookup page (`/admissions/status`).
- [x] Provide staff API support for authentication, application review, search/filter, status updates, and passport retrieval.
- [ ] Complete remaining staff dashboard experience and end-to-end visual verification.
- [ ] Address deployment, monitoring, backups, and privacy safeguards in a later release phase.

For the evolving implementation status, see [PROJECT_PROGRESS.md](./PROJECT_PROGRESS.md).
