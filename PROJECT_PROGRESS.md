# Admission Portal — Project Progress

**Last reviewed:** 2026-10-21  
**Project:** Peniel Admission Portal  
**Current phase:** Backend foundation / API development

This document is the running project record. Update the status and review date as features are implemented, tested, or decisions change.

## Project overview

The project is an admission portal intended to support applicant submissions and the staff workflow for reviewing applications. The code currently present is a Node.js/Express backend; no applicant or staff-facing frontend is present in the current project files.

## Current implementation

| Area | Status | What is present |
| --- | --- | --- |
| Backend application | Implemented | Express server, JSON request parsing, and a configurable port (`PORT`, default `5000`). |
| Database connection | Implemented, needs setup verification | PostgreSQL connection pool configured from environment variables. A database connectivity endpoint is available at `GET /api/db-test`. |
| Applicant submission | Basic endpoint implemented | `POST /api/applications` validates required applicant and guardian fields, keeps guardian email optional, creates an application number, and saves the application and guardian in one transaction. |
| Application administration API | Basic endpoints implemented | List/filter/page applications, retrieve an application with all guardian records, and update an application's status. |
| Admin login | Basic endpoint implemented | `POST /api/auth/login` checks a bcrypt password hash and returns a one-hour JWT. Login attempts are rate-limited. |
| Admin route protection | Implemented for staff application routes | `middleware/requireAdmin.js` verifies JWTs and requires role `admin` on application list, detail, and status-update routes. Application submission remains public. |
| Admin provisioning | Script present | `createAdmin.js` creates an admin using environment-provided credentials and stores a bcrypt hash. |
| Automated tests | Not implemented | The package test script is a placeholder that exits with an error. |
| Database schema | Starter schema present | `db/schema.sql` defines `admins`, `applications`, `guardians`, `documents`, and lookup indexes. Guardian email is nullable. It sets the application status default to `NEW` and normalizes existing statuses to uppercase. It is a setup script, not a versioned migration system. |
| Document support | Database metadata only | The schema defines a `documents` table, but file upload/storage/retrieval API routes are not present. |
| Frontend | Not present in the current files | No applicant form, applicant status page, or staff dashboard is present. |

### API routes currently present

- `GET /` — basic API availability response.
- `GET /api/db-test` — checks the PostgreSQL connection.
- `POST /api/auth/login` — admin login.
- `POST /api/applications` — submit an application and guardian details.
- `GET /api/applications` — list applications with status, class, and search filters plus pagination.
- `GET /api/applications/:id` — retrieve an application and a `guardians` array.
- `PATCH /api/applications/:id/status` — change an application's status.

Application listing, detail, and status updates require the JWT returned by admin login in the `Authorization` HTTP header. Application submission is public.

## Important gaps and risks

- Application status casing is inconsistent: the schema defaults to and normalizes values as uppercase, while list filtering normalizes values to lowercase and status updates currently store the accepted value in uppercase. The route behavior needs one canonical casing convention.
- The database schema permits multiple guardians per application and the detail route returns all of them, but the current application-submission endpoint creates one guardian per request.
- A `documents` table exists, but file upload, storage, and retrieval functionality has not been implemented.
- Request validation is foundational only. Email/phone formats, date validity, allowed gender/class values, duplicate submissions, and application-specific business rules still need to be defined and tested.
- No frontend or automated tests are present in the files reviewed.
- Packages for security headers and CORS are listed as dependencies, but their corresponding application behavior is not currently wired into the server.
- Operational error handling/logging and deployment setup remain future work; production deployment is outside the current development phase.

## Suggested work plan

- [ ] Decide the applicant and staff workflows, required fields, application statuses, and access rules.
- [ ] Apply `db/schema.sql` to a clean development database and verify the schema against all API queries.
- [x] Keep guardian email optional consistently in the application endpoint and database schema.
- [ ] Align application status casing across the schema, application creation, list filters, and status updates.
- [ ] Add versioned migrations as the schema evolves.
- [ ] Add tests for admin JWT/role protection on staff routes and preserve public application submission.
- [ ] Implement the applicant experience: application form, submission confirmation/reference, and (if required) application status lookup.
- [ ] Implement the staff experience: sign-in, application list/search, application detail, and review/status actions.
- [ ] Decide whether document uploads are part of the applicant workflow; if so, implement upload/storage/retrieval behavior around the existing metadata table.
- [ ] Add input validation, duplicate handling, and clear error responses for the agreed business rules.
- [ ] Add focused automated tests for database-backed routes, authentication, authorization, and validation.
- [ ] Configure production concerns: secrets, CORS policy, security headers, logging, backups, and deployment checks.
- [ ] Verify the complete applicant-to-admission workflow in a deployment-like environment.

## Update log

- **2026-10-20:** Reviewed the initial backend API foundation and recorded the missing frontend, schema, and tests.
- **2026-10-21:** Updated the project record after adding the PostgreSQL starter schema and admin JWT middleware. Documented that staff application routes are protected, identified schema/API differences, and noted that the document table does not yet have corresponding file endpoints.
- **2026-10-21:** Kept guardian email optional in both application submission and the database schema. Updated the schema default and existing data to uppercase statuses; later route behavior currently lowercases status filters and updates, so consistent status casing remains open.
- **2026-10-21:** Refreshed the project record against the current application routes: status inputs are case-insensitive and stored lowercase, and application detail returns all associated guardians.
