# Peniel Admission Portal

Peniel Admission Portal is an early-stage school admissions project. The code currently in this repository is a Node.js and Express backend API backed by PostgreSQL. It provides initial endpoints for submitting applications and for administrators to sign in and review application records.

> **Development project:** This repository is being built incrementally. The current implementation and setup are for development and learning, not a finished or production-ready admissions system. Production deployment is a later project phase, not a requirement for the current work.

The applicant-facing website and staff dashboard are not implemented yet. The backend includes a starter schema, a status migration, and API tests using Node's built-in test runner. This README describes the current implementation, not planned or completed functionality. See [PROJECT_PROGRESS.md](./PROJECT_PROGRESS.md) for the current status and outstanding work.

## Current capabilities

- Accept an applicant's basic details and guardian details.
- Save an application and its guardian record in a single database transaction.
- Generate an application reference in the format `PEN-<year>-<random code>`.
- List applications with optional status, class, and text search filters, plus pagination.
- Retrieve an application together with all guardian records.
- Change an application's status.
- Authenticate an administrator using a password hash and issue a one-hour JSON Web Token (JWT).
- Protect application listing, detail, status-update, and dashboard-statistics routes with admin JWT authentication.
- Provide dashboard counts for supported application statuses.
- Validate submitted applicant/guardian fields, date of birth, email syntax, and Ghanaian phone number formats.
- Limit repeated login attempts.
- Check whether the API can connect to PostgreSQL.
- Define starter PostgreSQL tables for administrators, applications, guardians, and uploaded-document metadata.

These are backend API capabilities only. There is no browser interface or public application-status lookup in the current code.

## Technology

- Node.js with CommonJS modules
- Express 5
- PostgreSQL via `pg`
- `bcrypt` for administrator password hashing
- `jsonwebtoken` for login tokens
- `express-rate-limit` for login throttling
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
│       └── 001_normalize_application_status.sql
├── middleware/
│   └── requireAdmin.js   # Verifies JWT and requires the admin role
├── routes/
│   ├── application.js    # Application submission and review endpoints
│   └── auth.js           # Administrator login endpoint
├── tests/                # API tests using node:test and mocked DB queries
├── services/             # Reserved for business logic (currently empty)
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

`npm run dev` starts the server with Nodemon. Use `npm start` to run it without Nodemon. The server listens on the configured port.

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

`middle_name`, guardian `address`, and guardian `email` are optional; `null` is accepted for optional fields. On success, returns HTTP 201 with the created application and guardian details. The application and guardian inserts are atomic. Application reference collisions on the unique `application_number` constraint are retried up to three times.

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

Updates an application's status. The accepted values are `new`, `under_review`, `accepted`, and `rejected`; input is accepted case-insensitively and normalized to lowercase before saving.

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

There are no document upload or retrieval routes in the current API; `documents` is schema support only. The current submission endpoint inserts one guardian per request, even though the schema supports multiple guardians.

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
| `npm test` | Runs the API suite with Node's built-in test runner (`node --test`). Latest run: 56 tests passed. |

## Development roadmap

- Decide authoritative lists for permitted gender values and school classes; validation currently enforces type and length only for those fields.
- Continue adding tests as new API behavior is introduced.
- Build the applicant form and staff dashboard.
- Decide whether applicants need a safe way to check application status.
- Address deployment, monitoring, backups, and privacy safeguards in a later release phase.

For the evolving implementation status, see [PROJECT_PROGRESS.md](./PROJECT_PROGRESS.md).
