# Admission Portal — Project Progress

**Last reviewed:** 2026-10-25
**Project:** Peniel Admission Portal  
**Current phase:** Backend API and applicant frontend integration

This document is the running project record. Update the status and review date as features are implemented, tested, or decisions change.

## Project overview

The project includes a Node.js/Express backend and a React-based school website frontend in the sibling `frontend/` directory. The public admissions form is integrated with the backend API. A staff-facing dashboard and public application-status lookup are not yet implemented.

## Current implementation

| Area | Status | What is present |
| --- | --- | --- |
| Backend application | Implemented | Express server, JSON request parsing with 64kb limit, Helmet security headers, CORS origin filtering, and a configurable port (`PORT`, default `5000`). |
| Database connection | Implemented and verified | PostgreSQL connection pool configured from environment variables. A database connectivity endpoint is available at `GET /api/db-test`. |
| Applicant submission | Hardened and verified | `POST /api/applications` validates required applicant and guardian fields, Ghanaian phone formats, calendar-valid date of birth against the `Africa/Accra` date, email syntax, and optional fields. It generates `PEN-YEAR-HEX` references with savepoint collision retries and executes atomic transaction commits/rollbacks. Before inserting a guardian, it reuses one matching the name (case-insensitive), relationship (case-insensitive), and phone number under the new application. |
| Application administration API | Hardened and verified | List/filter/page applications (`GET /api/applications`), retrieve an application with all guardian records (`GET /api/applications/:id`), and update an application's status (`PATCH /api/applications/:id/status`). |
| Dashboard statistics | Implemented and verified | `GET /api/applications/stats` returns numeric counts for `total`, `new`, `under_review`, `accepted`, and `rejected`. Protected by admin authentication. |
| Admin login | Implemented and rate-limited | `POST /api/auth/login` checks a bcrypt password hash and returns a one-hour JWT. Login attempts are rate-limited (10 attempts per 15 minutes). Safe error responses prevent account enumeration. |
| Admin route protection | Implemented for staff application routes | `middleware/requireAdmin.js` verifies JWTs and requires role `admin` on application list, detail, status-update, and statistics routes. Application submission remains public. |
| Admin provisioning | Script present | `createAdmin.js` creates an admin using environment-provided credentials and stores a bcrypt hash. |
| Automated tests | Implemented | The Node.js built-in test suite (`npm test`) covers public submission, authentication/authorization, application listing, individual retrieval, status updates, dashboard stats, and admin login. Latest run: 56 tests passed. |
| Database schema | Starter schema and migration present | `db/schema.sql` defines `admins`, `applications`, `guardians`, `documents`, and lookup indexes. Migration `001_normalize_application_status.sql` enforces lowercase statuses (`new`, `under_review`, `accepted`, `rejected`) and sets the column default to `'new'`. Guardian email is nullable. The development database was inspected read-only and already had the expected lowercase status constraint/default; the migration was not applied. |
| Document support | Database metadata only | The schema defines a `documents` table, but file upload/storage/retrieval API routes are not present. |
| Frontend | Implemented (School Website and Applicant Admission Experience) | The sibling `frontend/` app uses React 18, Vite 6, TypeScript, React Router, and Tailwind CSS v4. It includes Home, About, Academics, Admissions, Gallery, Contact, and Privacy pages. Its `/admissions` form validates input, submits typed snake_case data asynchronously to `POST /api/applications`, guards against repeated clicks while submitting, preserves errors, and displays a printable confirmation with the returned application reference. |

### API routes currently present

- `GET /` — basic API availability response.
- `GET /api/db-test` — checks the PostgreSQL connection.
- `POST /api/auth/login` — admin login with rate limiting and 1-hour JWT.
- `POST /api/applications` — public submission of application and guardian details in an atomic transaction.
- `GET /api/applications` — protected list of applications with status, class, and search filters plus pagination.
- `GET /api/applications/stats` — protected dashboard statistics with numeric counts for all valid statuses.
- `GET /api/applications/:id` — protected retrieval of one application and all associated guardian records.
- `PATCH /api/applications/:id/status` — protected status update normalized to lowercase.

Application listing, statistics, detail, and status updates require the JWT returned by admin login in the `Authorization` HTTP header. Application submission is public.

## Important gaps and risks

- **Policy decision needed for allowed gender values:** The schema defines `gender VARCHAR(20) NOT NULL` and the API validates non-empty strings up to 20 characters. The frontend provides "Male" and "Female" options, but an authoritative institutional policy should be formally recorded.
- **Policy decision needed for class list:** The schema defines `class_applied_for VARCHAR(100) NOT NULL` and the API validates non-empty strings up to 100 characters. The frontend form provides Peniel's actual school levels (Creche, Nursery 1–2, Kindergarten 1–2, Basic 1–6, Basic 7–9 / JHS 1–3) while preserving legacy Year 7–13 options; formal validation against an enum or lookup table requires final school confirmation.
- **Multiple guardians submission:** The database schema permits multiple guardians per application and the detail route returns all of them, but the current public application submission endpoint accepts one primary guardian per request.
- **Repeated submission handling:** A guardian match is checked only within the application created by the current request. Posting the same application again still creates a new application record; an idempotency key or other duplicate-application policy is not implemented.
- **Document uploads:** A `documents` table exists in PostgreSQL, but file upload, storage, and retrieval endpoints have not yet been implemented. Document verification is currently handled in-person at the admission interview.
- **Applicant status lookup:** While application reference generation and confirmation slips are complete, a dedicated self-service public status lookup page (`/admissions/status`) is not yet implemented.
- **Staff dashboard interface:** Staff API endpoints are secured and fully tested, but a staff-facing web UI for reviewing applications and changing status has not yet been built.
- **Production deployment:** Deployment configuration, automated backup policies, and monitoring remain future phases.

## Suggested work plan

- [x] Align application status casing across the schema, application creation, list filters, and status updates to lowercase (`new`, `under_review`, `accepted`, `rejected`).
- [x] Keep guardian email optional consistently in the application endpoint and database schema.
- [x] Reuse a matching guardian record rather than inserting another one for the same application.
- [x] Add versioned migrations as the schema evolves (`001_normalize_application_status.sql`).
- [x] Add input validation, duplicate reference handling, and clear error responses across all API endpoints.
- [x] Add tests for admin JWT/role protection on staff routes and preserve public application submission.
- [x] Add focused automated tests for database-backed routes, authentication, authorization, and validation.
- [x] Configure server security concerns: Helmet security headers, CORS origin policy, JSON body limit (64kb), and safe logging.
- [x] Implement the applicant experience: online application form, validation, API integration, and printable confirmation slip.
- [ ] Decide authoritative lists for allowed applicant gender values and school classes.
- [ ] Define and implement duplicate-submission handling so retries of the same application do not create multiple application records.
- [ ] Implement self-service applicant status lookup page (`/admissions/status` or reference check).
- [ ] Implement the staff experience: sign-in, application list/search, application detail, and review/status actions.
- [ ] Decide whether document uploads are part of the applicant workflow; if so, implement upload/storage/retrieval behavior around the existing metadata table.
- [ ] Verify the complete applicant-to-admission workflow in a deployment-like environment.

## Update log

- **2026-10-20:** Reviewed the initial backend API foundation and recorded the missing frontend, schema, and tests.
- **2026-10-21:** Updated the project record after adding the PostgreSQL starter schema and admin JWT middleware. Documented that staff application routes are protected, identified schema/API differences, and noted that the document table does not yet have corresponding file endpoints.
- **2026-10-21:** Kept guardian email optional in both application submission and the database schema. An intermediate schema update used uppercase statuses; the following route/schema alignment standardized statuses to lowercase.
- **2026-10-21:** Refreshed the project record against the current application routes: status inputs are case-insensitive and stored lowercase, and application detail returns all associated guardians.
- **2026-10-22:** Completed validation and hardening across the API. Standardized statuses to lowercase (`new`, `under_review`, `accepted`, `rejected`), added `GET /api/applications/stats`, and hardened date-of-birth validation (calendar-valid and not future in `Africa/Accra`), Ghanaian phone validation, guardian relationship length (maximum 50 characters), and pagination. Configured Helmet, CORS origin handling, and request-body limits. Verified the complete automated test suite: 56 tests passed. Inspected the development database read-only; its status default and constraint already matched the schema convention, so no migration was run.
- **2026-10-22:** Integrated the frontend application experience with the backend API. Configured `CORS_ORIGINS=http://localhost:5173` in backend `.env` and documented `VITE_API_BASE_URL` in frontend `.env.example`. Built typed `admissionsApi.ts` client with client-side phone/DOB/email validation and mapped camelCase state to the backend's snake_case schema. Registered `/admissions` in the router, updated Navbar/Footer navigation, and added a genuine submission confirmation view with copyable reference number and print functionality (`window.print()`). Preserved supplementary form fields (`programme`, `nationality`, `prevSchool`, `boarding`, `message`) in the UI with transparency notes that core data is submitted while notes serve the in-person interview. Successfully verified production frontend build (`npm run build`) and live end-to-end API submission against PostgreSQL (created verification reference `PEN-2026-C09923E3`).
- **2026-10-25:** Documented the guardian lookup before insertion and clarified its scope: it only reuses a matching guardian within the current application; repeated POST requests still create new application records. Added duplicate-submission idempotency to the outstanding work plan.
- **2026-10-25:** Expanded the project record to cover the sibling React/Vite school website frontend, its implemented routes, admissions API integration, and current frontend gaps. Corrected the overview to distinguish the completed applicant experience from the outstanding staff dashboard and status lookup.
