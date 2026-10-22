# Peniel Admission Portal

Peniel Admission Portal is an early-stage school admissions project. The code currently in this repository is a Node.js and Express backend API backed by PostgreSQL. It provides initial endpoints for submitting applications and for administrators to sign in and review application records.

> **Development project:** This repository is being built incrementally. The current implementation and setup are for development and learning, not a finished or production-ready admissions system. Production deployment is a later project phase, not a requirement for the current work.

The applicant-facing website, staff dashboard, automated tests, and a migration system have not been implemented in the files currently present. A starter database schema is provided. This README describes the current implementation, not planned or completed functionality. See [PROJECT_PROGRESS.md](./PROJECT_PROGRESS.md) for the current status and outstanding work.

## Current capabilities

- Accept an applicant's basic details and guardian details.
- Save an application and its guardian record in a single database transaction.
- Generate an application reference in the format `PEN-<year>-<random code>`.
- List applications with optional status, class, and text search filters, plus pagination.
- Retrieve an application together with all guardian records.
- Change an application's status.
- Authenticate an administrator using a password hash and issue a one-hour JSON Web Token (JWT).
- Protect application listing, detail, and status-update routes with admin JWT authentication.
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
│   └── schema.sql        # Starter schema for a development database
├── middleware/
│   └── requireAdmin.js   # Verifies JWT and requires the admin role
├── routes/
│   ├── application.js    # Application submission and review endpoints
│   └── auth.js           # Administrator login endpoint
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

The starter schema is in `db/schema.sql`. It uses `CREATE TABLE/INDEX IF NOT EXISTS` inside a transaction and does not drop existing tables or records. It can be re-run to normalize existing application statuses and set the uppercase status default; it is not a versioned migration system.

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

ADMIN_NAME=Portal Administrator
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace_with_a_strong_password
```

Create the PostgreSQL database named by `DB_NAME`, then apply the starter schema from the `backend` directory:

```powershell
psql -U your_database_user -d your_database_name -f .\db\schema.sql
```

`PORT` defaults to `5000` if omitted. `NODE_ENV` is available for environment configuration but is not currently used by the server. `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are read by `createAdmin.js`. Keep `.env` local and never commit it.

After the database and required tables are ready, create an administrator and start the server:

```powershell
node createAdmin.js
npm run dev
```

`npm run dev` starts the server with Nodemon. Use `npm start` to run it without Nodemon. The server listens on the configured port.

To check the API is responding, visit `http://localhost:5000/`. To check the database connection, request `http://localhost:5000/api/db-test`. The database check returns the database name when the connection succeeds; otherwise it returns HTTP 500.

## API

All request and response bodies use JSON. Application submission is public. Application listing, detail, and status-update routes require the JWT returned by admin login in the `Authorization` HTTP header. The current API does not include a separate applicant-facing status lookup.

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

Submits an application and its guardian information. Required applicant fields are `first_name`, `last_name`, `date_of_birth`, `gender`, `email`, `phone`, `address`, and `class_applied_for`. The guardian's `full_name`, `relationship`, and `phone_number` are required; guardian email is optional and must be a non-empty string if supplied.

Example:

```json
{
  "first_name": "Alex",
  "middle_name": "Taylor",
  "last_name": "Morgan",
  "date_of_birth": "2012-04-15",
  "gender": "unspecified",
  "email": "applicant@example.com",
  "phone": "+10000000000",
  "address": "Example Street",
  "class_applied_for": "Year 7",
  "guardian": {
    "full_name": "Jamie Morgan",
    "relationship": "Parent",
    "phone_number": "+10000000001",
    "email": "guardian@example.com",
    "address": "Example Street"
  }
}
```

`middle_name` and guardian `address` are optional. Guardian email is optional too, but if supplied it must be a non-empty string. On success, returns HTTP 201 with the created application and guardian details. The two database inserts are wrapped in a transaction.

#### `GET /api/applications`

Returns a paginated application list. Supported query parameters:

| Parameter | Description |
| --- | --- |
| `page` | Page number; defaults to `1`, minimum `1`. |
| `limit` | Results per page; defaults to `10`, constrained to `1`–`100`. |
| `status` | Filter by application status (the input is normalized to lowercase). |
| `class` | Filter by applied-for class. |
| `search` | Case-insensitive partial match against first name, last name, email, or application number. |

The response includes `page`, `limit`, `total`, `totalPages`, and `applications`.

#### `GET /api/applications/:id`

Returns one application and its guardian records as a `guardians` array. The schema permits multiple guardians per application, although the current public submission endpoint creates one guardian per request. Returns HTTP 400 for an invalid ID and HTTP 404 if there is no matching application.

#### `PATCH /api/applications/:id/status`

Updates an application's status. The accepted status values are `NEW`, `UNDER_REVIEW`, `ACCEPTED`, and `REJECTED`; input is case-insensitive. The current route normalizes the accepted value to lowercase before saving it to PostgreSQL.

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

Application status casing is currently inconsistent between the schema and routes. The schema sets the default to uppercase `NEW` and normalizes existing non-null statuses to uppercase when run. The list filter compares values as lowercase, while the status update route currently normalizes to lowercase before saving. There is still a mismatch to reconcile across the schema and API. Guardian email is optional in both the route and schema. Re-run `db/schema.sql` on an existing development database to apply status normalization, update its status default, and remove the guardian email `NOT NULL` constraint.

## Development-stage security and privacy notes

Applications contain personal information about applicants and guardians. During development, use test data where possible and keep `.env` and real applicant information out of source control. The current staff routes verify JWTs and require the `admin` role. Applicant submission remains public by design at this stage.

The security items below are future implementation work before any real-world or production use; they are not prerequisites for continuing local feature development:

- Add tests for authentication and authorization, and confirm which endpoints should be public as workflows evolve.
- Limit returned personal information to what each workflow requires.
- Review input validation, database constraints, CORS policy, security headers, logging, retention, and backups.
- Use strong secrets and HTTPS in any deployed environment.

The `helmet` and `cors` packages are listed as dependencies but are not currently configured in `server.js`.

## Tests and scripts

Available npm scripts:

| Command | Current behavior |
| --- | --- |
| `npm start` | Runs `node server.js`. |
| `npm run dev` | Runs `nodemon server.js`. |
| `npm test` | Placeholder script that exits with an error; automated tests have not been added. |

## Development roadmap

- Verify the starter schema against the API and add migrations as the schema evolves.
- Define the admission workflow, required fields, allowed values, and application lifecycle.
- Extend and test JWT verification and role-based authorization for any future staff-only endpoints.
- Build the applicant form and staff dashboard.
- Decide whether applicants need a safe way to check application status.
- Improve validation and duplicate-submission handling.
- Add automated tests for authentication, authorization, validation, and database-backed routes.
- Address deployment, monitoring, backups, and privacy safeguards in a later release phase.

For the evolving implementation status, see [PROJECT_PROGRESS.md](./PROJECT_PROGRESS.md).
