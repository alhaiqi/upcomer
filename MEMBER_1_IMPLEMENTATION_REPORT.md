# Upcomer Sprint 1 — Member 1 Implementation Report

## Scope

Implemented authentication and My Courses from the Sprint 1 plan:

- US-01: Create an account (3 SP)
- US-02: Log in and log out (3 SP)
- US-07: Add a course to My Courses (3 SP)

Monitoring for auth, session, and My Courses failures is included (US-87 for this code). Admin screens, uploads, and the course catalog belong to other members; this branch adds the session and role model they need. Branch: `feature/auth-my-courses`, cut from `main` after Member 2's PR #1 merge.

## Architecture

| Area | Files | Responsibility |
| --- | --- | --- |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20261004000000_auth_my_courses/` | `Role` enum, `User`, `Session`, `UserCourse`, and `Course.enrollments` |
| Auth service | `lib/auth.ts` | Validation, bcrypt hashing, sessions, `getCurrentUser`, `requireUser`, `requireAdmin`, `getAdminUser` |
| Shared cookie constants | `lib/session-cookie.ts` | `SESSION_COOKIE`, `SESSION_TTL_*`, `safeNext`; no Node-only imports, so `middleware.ts` can use it |
| My Courses service | `lib/my-courses.ts` | `addCourseToMyCourses`, `getMyCourses` |
| Server actions | `lib/auth-actions.ts`, `lib/my-courses-actions.ts` | `signUpAction`, `logInAction`, `logOutAction`, `addCourseAction` |
| Pages | `app/signup/page.tsx`, `app/login/page.tsx`, `app/my-courses/page.tsx` | Server components, `force-dynamic`, no client-side JavaScript |
| Convenience redirect | `middleware.ts` | Sends a request with no session cookie on `/my-courses` or `/admin/*` to `/login?next=…` |
| Shared files touched | `app/layout.tsx`, `app/globals.css`, `lib/logger.ts`, `prisma/seed.ts`, `.env.example`, `README.md`, `app/courses/[courseId]/page.tsx` | Header links, form styles, seven log events, admin seed, env keys, docs, Add-to-My-Courses button |

Every form is a plain `POST` to a server action and every page is a server component, so the feature needs no client-side JavaScript, matching the rest of the project. Error messages travel back as an `error` query parameter rather than through client state; no email or password is ever put in a URL.

## Design decisions and why

**Database sessions, not Auth.js.** A random 32-byte token goes to the browser in an `httpOnly`, `SameSite=Lax`, `path=/`, 7-day cookie (`Secure` in production only, so local HTTP development works); only its SHA-256 hash is stored in `Session.tokenHash`. Auth.js's Credentials provider forces JWT sessions, where logout cannot revoke anything server-side, which would make the US-02 logout test meaningless. Logout here deletes the row, so a stolen cookie stops working.

**Access checked in the data layer.** `requireUser()`, `requireAdmin()`, and `getAdminUser()` are called inside pages, server actions, and route handlers. `middleware.ts` only checks whether a cookie exists and redirects; it never decides who you are. Middleware-only authentication has been bypassed before (CVE-2025-29927), and checking at the data layer is what Next's own documentation recommends.

**`UserCourse` has a composite primary key.** `@@id([userId, courseId])` makes a duplicate impossible in the database. Two racing clicks cannot both insert: the second fails with Prisma `P2002`, which `addCourseToMyCourses` catches and reports as `already_added`. An application-level "check then insert" cannot give that guarantee.

**Login never reveals whether an email exists.** Both an unknown email and a wrong password give "Invalid email or password," and an unknown email still runs one bcrypt comparison against a fixed dummy hash so the response time does not leak the answer either. Sign-up does report a duplicate, because US-01 and the test plan require a "duplicate account" message.

**Emails are normalized** with `trim().toLowerCase()` before every lookup and insert, so `Ali@…` and `ali@…` cannot become two accounts.

**Logout is a `POST`.** The header renders a form with a submit button, never a link. Next prefetches links, so a `GET` logout could end a session on hover, and an `<img src>` could log a user out cross-site.

**`next` is validated.** `safeNext()` accepts only a path starting with a single `/` with no backslash and no whitespace; anything else falls back to `/my-courses`. Without this, `/login?next=https://evil.example.com` would be an open redirect.

**No public path to admin.** `Role` defaults to `STUDENT` and sign-up never sets it. The only way to get an admin is `prisma/seed.ts`, which upserts one from `ADMIN_EMAIL` / `ADMIN_PASSWORD` and stays repeatable; it warns and skips if those are unset.

**Logout failures are logged, not raised.** `endSession()` clears the cookie first, then deletes the row; if the delete fails it logs `logout_failed` and returns normally, because the user is already logged out of the browser and the row expires anyway. Every other failure follows the project's log-and-rethrow convention.

## Assumptions (no Jira acceptance criteria were available)

These were decided to keep the work moving and are each cheap to change. Confirm them with the team, especially with Member 2 before cross-testing.

| Question | Decision | How to change it |
| --- | --- | --- |
| Does sign-up log the user in? | No. It redirects to `/login?registered=1` with "Account created. Log in to continue.", matching the plan's journey, which lists Login after Create account. | In `signUpAction`, call `startSession(result.user.id)` and redirect to `next` instead. |
| Restrict sign-up to `@mail.aub.edu`? | Not restricted by default, but `SIGNUP_EMAIL_DOMAIN` in `.env` turns it on with no code change. | Set `SIGNUP_EMAIL_DOMAIN="@mail.aub.edu"`. |
| Password policy | At least 8 characters, checked on the server and hinted with `minLength`. No composition rules. | `PASSWORD_MIN_LENGTH` in `lib/auth.ts`. |
| Which routes require login? | `/my-courses` and `/admin/*` only. Browsing, search, course pages, and `/files/:id` stay open. | Add a `requireUser()` call in the page and a matcher entry in `middleware.ts`. |
| Session lifetime | 7 days for both the row and the cookie. | `SESSION_TTL_DAYS` in `lib/session-cookie.ts`. |
| Remove from My Courses | Out of scope; it is not in the Sprint 1 table. | — |
| Where the Add button lives | Course home page only. It was deliberately left out of `components/course-list.tsx` (Member 2's file) to avoid a conflict. | — |

## User stories and behavior

| Story | Behavior |
| --- | --- |
| US-01 | `/signup` takes a name, email, and password of at least 8 characters, creates the user with a bcrypt hash (cost 10) and the `STUDENT` role, then sends them to `/login`. A duplicate email says "An account with this email already exists." Invalid input is refused with a specific message and never reaches the database. |
| US-02 | `/login` starts a database session and opens `/my-courses`, or the `next` page the visitor was sent from. A wrong password or an unknown email both say "Invalid email or password." The header shows "Log out" while logged in; the `POST` deletes the session row and the cookie and returns to `/`. Visiting `/my-courses` while logged out lands on `/login?next=%2Fmy-courses`. |
| US-07 | "Add to My Courses" on `/courses/:courseId` adds the course and confirms with "Added to My Courses." A second click succeeds quietly with "Already in My Courses." An unknown course ID gives a 404. `/my-courses` lists the courses, most recently added first, reusing Member 2's `CourseList` component, with "You haven't added any courses yet." when empty. Adding while logged out goes to `/login?next=/courses/:id` and returns to the course after logging in. |

## Monitoring (US-87 for this code)

Seven event names were appended to the `LogEvent` union in `lib/logger.ts`:

| Event | Context logged |
| --- | --- |
| `signup_failed` | `reason` (`email_taken` or `db_error`), `errorType` |
| `login_failed` | `reason` (`invalid_credentials` or `db_error`), `userId` when known, `errorType` |
| `session_validation_failed` | `reason` (`unknown_token`, `expired`, `db_error`), `sessionId`, `userId`, `errorType` |
| `logout_failed` | `errorType` |
| `unauthorized_access` | `route`, `role` (`anonymous`, `STUDENT`), `userId` |
| `my_courses_add_failed` | `userId`, `courseId`, `errorType` |
| `my_courses_retrieval_failed` | `userId`, `errorType` |

No email, password, or session token is ever logged, following the existing rule that user input is not logged. Unit tests assert this for the duplicate-signup, failed-login, and session-creation paths.

## Tests

`npm test` — **175 unit and component tests pass** across 15 files: 100 new ones in the 6 files below, plus the 75 that already existed, all still green.

| File | Covers |
| --- | --- |
| `tests/unit/auth.test.ts` (41) | Validation, email normalization, `safeNext` open-redirect cases, account creation, duplicate `P2002`, login including the equal answer for unknown email and wrong password, session creation (token never stored raw, cookie flags, 7-day expiry), unknown and expired sessions, database failure treated as logged out, logout, and all three guards |
| `tests/unit/auth-actions.test.ts` (18) | Sign-up, login, logout, and add-to-My-Courses actions, including `next` preservation and rejection of off-site values |
| `tests/unit/my-courses.test.ts` (7) | Add, unknown course, `P2002` as "already added", list ordering and includes, logging |
| `tests/unit/auth-pages.test.tsx` (25) | Sign-up and login forms and every error message, My Courses page and empty state, page-level protection, header links for both states, and that logout is never a link |
| `tests/unit/add-to-my-courses.test.tsx` (5) | The button and confirmations on the course page, and that Member 3's resource sections still render |
| `tests/unit/middleware.test.ts` (4) | The redirect, the preserved query string, pass-through with a cookie, and the matcher list |
| `tests/e2e/auth-my-courses.spec.ts` (8) | The full journey, duplicate sign-up, case-insensitive duplicate, short password, protected `/my-courses`, add-while-logged-out and return, the open-redirect attempt, and that browsing stays open |

`npm run lint` is clean and `npm run build` succeeds, with `/signup`, `/login`, `/my-courses`, and the middleware all registered.

### Verified against a real database

`npm run db:migrate` applied `20260930000000_init` and `20261004000000_auth_my_courses` cleanly, `npm run db:seed` ran twice with no duplicate (one admin row, three courses, seven files), and **`npm run test:e2e` passes all 12 Playwright tests**: my 8, Member 2's 3, and Member 3's 1. Member 2's and Member 3's flows were re-run specifically to confirm the new header and the Add button on the course page break nothing.

Two claims were also checked directly against PostgreSQL rather than only against mocks:

- **Duplicate addition under a race.** Three concurrent inserts of the same `(userId, courseId)` produced one row and two `P2002` errors, which is what `addCourseToMyCourses` turns into "Already in My Courses."
- **Cascades.** Deleting a user removed that user's `Session` and `UserCourse` rows.

The dev-server console during the e2e run showed `login_failed`, `signup_failed`, and `unauthorized_access` lines with only a `reason`, a `userId`, a `route`, and a `role` — no email, password, or token, as required.

`npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `npm test` all pass as well.

One real bug was found this way: the first generated `migration.sql` had Prisma's `warn` lines about `package.json#prisma` at the top, because the SQL was captured from a command that writes that warning to the same stream. It failed with `ERROR: syntax error at or near "warn"` on the shadow database and is fixed; the committed file starts at `-- CreateEnum`.

### How the database was run here, without Docker

This machine has no PostgreSQL server: the install under `C:\Program Files\PostgreSQL` has only orphaned `data` folders, no binaries and no service. Docker was not used. Instead, real PostgreSQL 18.4 binaries were run as a plain user process from a scratch folder with the `embedded-postgres` package, on port 5433:

1. `npm install embedded-postgres` in a scratch directory outside the repository, which downloads the `windows-x64` binaries.
2. `initdb -U postgres --pwfile=… -E UTF8 --locale=C` into a scratch data folder, then `pg_ctl -D … -o "-p 5433" start`. PostgreSQL refuses to run from an elevated shell, so both commands were launched through `runas /trustlevel:0x20000`, which drops administrator rights.
3. `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/upcomer?schema=public"` in `.env`. Prisma created the database itself on the first `migrate dev`.

Nothing about this is required by the project: anyone with an ordinary local PostgreSQL on 5432 just uses the `.env.example` value. It is written down only so the result is reproducible, since this is the first time any Sprint 1 branch has been run against a real database.

## Handoff

### For Member 2 (my cross-tester)

Setup: `npm install`, copy `.env.example` to `.env` and set `DATABASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`, then `npm run db:migrate`, `npm run db:seed`, `npm run dev`.

Your plan's checks map to these:

- **Create account:** `/signup` with a name, email, and 8+ character password. You land on `/login` with "Account created. Log in to continue."
- **Duplicate account:** sign up twice with the same email, and once more with the email in a different case (`ALI@…` after `ali@…`). Both say "An account with this email already exists."
- **Invalid input:** a 7-character password, an email with no `@`, an empty name. Each gives its own message and no account is created. The browser blocks a short password first; set `form.noValidate = true` in the console to see the server message.
- **Valid and invalid login:** a wrong password and a never-registered email must both say exactly "Invalid email or password."
- **Logout:** click "Log out" in the header, then press Back. You are logged out, because the session row is gone, not just the cookie. There is no `GET /logout` to visit.
- **Protected access:** open `/my-courses` while logged out; you land on `/login?next=%2Fmy-courses`. Also try `/login?next=//evil.example.com` and `/login?next=https://evil.example.com` and log in: you must stay on this site.
- **Adding a course:** "Add to My Courses" on `/courses/course-eece350`, then check `/my-courses`.
- **Duplicate addition:** click "Add to My Courses" twice. The second says "Already in My Courses." and is not an error. For the race, open the course page in two tabs and submit both quickly; exactly one row exists and neither tab shows an error page.
- **Unknown course:** `/courses/does-not-exist` gives the not-found page.
- **Logs:** watch the `npm run dev` console. Each failure writes one JSON line. Confirm no line ever contains an email, a password, or a cookie value.

### For Member 5 (uploads)

`lib/auth.ts` gives you two entry points. For `/admin/uploads/*` pages:

```ts
const admin = await requireAdmin("/admin/uploads");
```

For `POST /api/admin/uploads`, where the upload actually happens, use the non-throwing form so you control the status code:

```ts
const admin = await getAdminUser("POST /api/admin/uploads");
if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
```

Both log `unauthorized_access` with the route and role. `requireAdmin` sends a logged-out visitor to `/login` and gives a logged-in student a 404 rather than a 403, so the admin area is not advertised. Please add the API line yourself once this branch is merged — it belongs in your route, and I will verify it as your tester. To get an admin account, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` and run `npm run db:seed`.

### For Member 4 (Integration Lead)

- **Shared models.** `Course` gains `enrollments UserCourse[]`. `prisma format` realigned the `Course` field padding, so that model shows as changed although only one field was added. New models are `User`, `Session`, `UserCourse`, and the `Role` enum.
- **Migration order.** My migration is `20261004000000_auth_my_courses`, after `20260930000000_init`, which I did not touch. If you add one, make sure its timestamp is later than mine or `prisma migrate` will complain about order.
- **Shared files I changed:** `lib/logger.ts` (seven events, appended), `app/globals.css` (`.site-nav`, `.form`, `.field`, `.inline-form`, `.notice`, and a flex rule on the existing `.site-header`, all appended), `app/layout.tsx` (header links and the logout form; the layout is now an async server component), `prisma/seed.ts` (a `seedAdmin()` function and one call at the end of `main`), `.env.example` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `SIGNUP_EMAIL_DOMAIN`), `README.md` (new routes, a Member 1 section, and the stale intro sentence Member 2 flagged), and `app/courses/[courseId]/page.tsx` (Member 3's file: the Add button and confirmation).
- **Nobody's existing tests break.** `app/courses/[courseId]/page.tsx` takes `searchParams` as an optional prop, so Member 3's `tests/unit/course-pages.test.tsx` passes unchanged, and no page that Members 2, 3, or 5 test now requires a login. **No shared Playwright login fixture is needed** as long as the team keeps browsing, search, course pages, and `/files/:id` open to visitors. If the team decides browsing must require a login, that fixture becomes necessary and every existing e2e test will need it, so please get that decision made explicitly.
- **US-95 (CI) still does not exist.** There is no `.github/workflows`, so the "CI green" row of the Definition of Done cannot be met by anyone yet. The commands a workflow needs are `npm ci`, `npx prisma generate`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` against a Postgres service container with `npm run db:migrate && npm run db:seed`. I can write it if US-95 is assigned to me.
- **Verified against a real database.** The migration, the seed, and all 12 e2e tests, including Members 2's and 3's, were run and pass. See "Verified against a real database" above for the setup used, which needs no Docker.
- **Still open:** Member 2's cross-test of US-01/02/07, code review, and my own cross-test of Member 5's US-70/71 uploads, which needs `feature/admin-uploads` checked out against a working database.
