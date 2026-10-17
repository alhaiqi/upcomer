# Upcomer Sprint 2 — Member 1 Implementation Report

Mustafa Ergaibi, branch `feature/mustafa-sprint-2`. This report covers US-13, US-04, and US-03.

## Scope

- US-13: Submit a past exam or course material for admin review.
- US-04: Manage my profile information (see [US-04](#us-04-manage-my-profile)).
- US-03: Reset a forgotten password (see [US-03](#us-03-reset-a-forgotten-password)).

Not included: the admin review page is Mohammed Al-Haiqi's US-74, and question extraction is Ali Slim's US-14. The model and functions below are the hand-off point for both.

## Architecture

| Area | Files | Responsibility |
| --- | --- | --- |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20261017000000_file_submissions` | `FileStatus` enum; `CourseFile.status`, `submittedById`, `rejectionReason`, `reviewedAt`; `User.submissions` |
| Visibility rule | `lib/file-visibility.ts` | `PUBLISHED_FILES` (the where-fragment) and `canViewFile(file, viewer)`. It has no other imports, so any service can use it without an import cycle |
| Service | `lib/submissions.ts` | `validateSubmissionFile`, `saveSubmission`, `getMySubmissions`, `submissionMessage`, and the review functions for US-74: `listPendingSubmissions`, `publishSubmission`, `rejectSubmission` |
| Route | `app/api/submissions/route.ts` | A plain multipart form post. It answers with a 303 redirect to a relative location. A route handler rather than a server action, because server actions are capped at 1 MB without a `next.config` |
| Pages | `app/submit/page.tsx`, `app/my-submissions/page.tsx`, `components/submission-form.tsx` | Submit form (reuses `FileMetadataFields`), and My Submissions with status and reason |

## User stories and behavior

| Acceptance test | Behavior |
| --- | --- |
| 1. A logged-in student submits a PDF with its course; it enters the queue as pending and is invisible to other students | The submission is saved as `PENDING` with `submittedById`. Every student-facing read filters to `PUBLISHED`: the exam and material lists, the question bank, and the consolidated exam. `/files/:id` gives a 404 to everyone but the submitter and admins, with no course link. A visitor is sent to log in |
| 2. After an admin publishes or rejects it, the student sees the new status, with the reason if rejected | `publishSubmission` / `rejectSubmission(fileId, reason)` work only on a pending file, in one statement. My Submissions shows "Pending review", "Published", or "Rejected" plus "Reason: …" |
| 3. A non-PDF or empty file is refused with a reason | Anything not named `.pdf` is refused ("Only PDF files can be submitted."). Then come the admin upload's checks: empty, over 20 MB, not real `%PDF-` content. The form shows the message and keeps the course and category |

## Hand-off

**One rule for everyone:** any code that reads `CourseFile` or `Question` for students, or that processes files, must add `...PUBLISHED_FILES` (from `lib/file-visibility.ts` or `lib/submissions.ts`) to its `CourseFile` filter.

### For Mohammed Al-Haiqi (US-74, admin review)

The model:

| Field | Meaning |
| --- | --- |
| `status` | `PENDING` → `PUBLISHED` or `REJECTED`. Both are final. It defaults to `PUBLISHED`, so admin uploads and all older files are published |
| `submittedById` / `submittedBy` | The submitting student; null for admin uploads. It is set to null if the account is deleted |
| `rejectionReason` | Shown to the student; set only when the status is `REJECTED` |
| `reviewedAt` | When the file was published or rejected |

The functions, all in `lib/submissions.ts`. None of them checks the caller, so your pages and actions must call `requireAdmin()` first.

```ts
listPendingSubmissions(): Promise<PendingSubmission[]>
// Oldest first. Each is a CourseFile with course { id, code, name }, professor, term, and submittedBy { id, name }.

publishSubmission(fileId: string): Promise<ReviewResult>
// Also runs rebuildQuestionBank(courseId) for an exam.

rejectSubmission(fileId: string, reason: string): Promise<ReviewResult>
// The reason is trimmed, 1 to 500 characters (MAX_REJECTION_REASON_LENGTH), and never logged.

type ReviewResult =
  | { ok: true; id: string; courseId: string }
  | { ok: false; error: "not_found" | "not_pending" | "reason_required" | "reason_too_long" };
```

- **Races:** each review is a single `updateMany({ where: { id, status: "PENDING" } })`, so a second admin acting on the same file gets `not_pending`.
- **Database failures** are logged as `submission_review_failed` and rethrown.
- **Opening files:** an admin can open any pending file at `/files/:id`, and `getAdminFiles` (`/admin/files`) already lists every status with a tag.
- **Tests:** `tests/unit/submissions.test.ts` and `tests/e2e/student-submissions.spec.ts` show how the functions behave.

### For Ali Slim (US-14 extraction; owner of the course workspace code)

- Extract **published exams only** (`category: "EXAM", ...PUBLISHED_FILES`). A pending submission must never be processed.
- Publishing already calls `rebuildQuestionBank`, so after extracting a published paper, call it as Member 2's hand-off describes.
- Minimal edits to your Sprint 1 files:
  - `lib/courses.ts`: the exam and material lists filter to published files.
  - `lib/files.ts`: `getOriginalFile(fileId, viewer?)` hides unpublished files from everyone but their submitter and admins, and logs `unpublished_file_access`.
  - `app/files/[fileId]/route.ts`: passes `getCurrentUser()`, and sends `Cache-Control: private, no-store` for unpublished files.

### For Lea Tass (Member 3, US-17/18/19)

- `getConsolidatedExam` now counts published papers only. That's a one-line `...PUBLISHED_FILES` in its `courseFile.findMany`.
- Together with the question-bank filter, a pending paper never changes X, Y, or the questions.
- Covered by a new case in `tests/unit/consolidated-exam.test.ts` and the last test in `tests/e2e/student-submissions.spec.ts`. Any new paper query you add needs the same filter.

## Monitoring

| Event | Level | Context |
| --- | --- | --- |
| `submission_refused` | warn | `reason`, `courseId`, `resourceCategory`, `userId` |
| `submission_failed` | error | `courseId`, `resourceCategory`, `userId`, `errorType` |
| `submission_rejected` | info | `fileId` |
| `submission_review_failed` | error | `fileId`, `operation`, `errorType` |
| `submission_retrieval_failed` | error | `entity`, `userId`, `errorType` |
| `unpublished_file_access` | warn | `fileId`, `role`, `userId` |

Storage and record failures keep their `upload_*` events, now with `source=submission`. Titles, file names, topics, and rejection reasons are never logged; the unit tests check this.

## Shared files changed

- `prisma/schema.prisma` and the new migration. The SQL file starts at the SQL, and `prisma migrate diff` reports no drift.
- `lib/uploads.ts` (Member 5): `saveUpload(input, submission?)` spreads `{ status, submittedById }` into the record, and its log context gets `source`.
- `lib/question-bank.ts` (Member 2): `courseExams`, the group questions, the `some` filter, and the overview filter to published files.
- `lib/consolidated-exam.ts` (Lea): the published filter.
- `lib/courses.ts`, `lib/files.ts`, `app/files/[fileId]/route.ts` (Ali Slim): as described above.
- `lib/logger.ts`: the six events.
- `middleware.ts`: `/submit` and `/my-submissions` need a session.
- `app/my-courses/page.tsx`: "Submit an exam or material" and "My Submissions" links.
- `app/admin/files/page.tsx`: the status tag for pending and rejected files.
- `app/globals.css`: `.status-tag`, using the same pill and AA-checked tokens as the log levels.
- `tests/reliability/features/browsing.ts`: the trials compare against published files.
- Unit tests updated for the filter: `courses`, `file-service`, `file-route`, `logger`, `question-bank`, `consolidated-exam`, `middleware`, and `file-metadata-pages`.
- `README.md`: the routes, the events, and a "Submissions (US-13)" section.

## Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/submissions.test.ts` | 26 | PDF-only, empty, corrupt, and too-large refusals; saved as PENDING with the submitter; shared metadata rules; nothing stored on refusal; visibility rule; queue order; publish and reject transitions, reason rules, double review, unknown file, failures; nothing typed is logged |
| `tests/unit/submission-route.test.ts` | 8 | Redirects, a visitor, refusals with the course and category kept, oversized requests, no double logging, unknown categories not echoed |
| `tests/unit/submission-pages.test.tsx` | 6 | Login required, the native multipart form, the Type field for exams only, statuses and the escaped reason, the empty state |
| Updated unit tests | +6 | Pending files hidden from a visitor and another student but open for the submitter and admins; no shared caching; the published filter in every query; a pending paper leaves X and Y unchanged; the admin tag |
| `tests/e2e/student-submissions.spec.ts` | 4 | AT1 (another student and a visitor can't see or open it), AT2 (through the review functions), AT3 (DOCX, empty, and fake PDF), and a pending exam with extracted questions not changing the exam page or the question bank. It creates its own students and course and deletes them, the submissions, and their stored files |

| Command | Result |
| --- | --- |
| `npm test` | Passed: 586 tests in 38 files |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed |
| `npx prisma migrate deploy`, `npm run db:seed` | Applied `20261017000000_file_submissions` to the database in `.env` (Neon), with the user's go-ahead |
| `npm run test:e2e` | Passed: 51 tests. No dev server was running. A check afterwards found no leftover test users, courses, submissions, or stored files |

## Found while testing, not changed

- **Lea's random-course unit test is timing-sensitive.** `tests/unit/consolidated-exam-edge-cases.test.tsx` (the "random courses" case) sometimes passes the default 5-second timeout under a full parallel `npm test` on this machine. It runs in about 2 seconds alone. It failed the same way on a clean checkout of `main`, so it isn't caused by this change. The last full run passed. A longer timeout on that one test would fix it; that's her call.
- **The session cookie is `Secure` under `next start`.** Playwright's own request context therefore doesn't send it over `http://127.0.0.1`, while the browser does. Logged-in e2e checks of `/files/:id` fetch from inside the page for that reason.

## US-04: Manage my profile

### Architecture

| Area | Files | Responsibility |
| --- | --- | --- |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20261018000000_user_profile` | `User.facultyId` (optional, to `Faculty`, set to null if the faculty is deleted) and `User.major` (optional) |
| Rules | `lib/profile-rules.ts` | Limits (name and major at most 100 characters), error types, and messages, shared by the server and the form |
| Service | `lib/profile.ts` | `getProfile`, `getFacultyOptions`, `saveProfile(userId, values)`. The ID always comes from the caller, never from a URL or form |
| Action | `lib/profile-actions.ts` | `saveProfileAction` calls `requireUser("/profile")` first and reads only `name`, `facultyId`, and `major` |
| Pages | `app/profile/page.tsx`, `app/profile/[...path]/page.tsx`, `components/profile-form.tsx` | The profile form, and denial of profile URLs that name another user |

### User stories and behavior

| Acceptance test | Behavior |
| --- | --- |
| 1. Edited name, faculty, or major persist after logging out and back in | Saved to `User`, with spacing tidied. The page shows "Profile saved." and reads the stored values each time it opens |
| 2. Invalid input shows the error and keeps the old values | Nothing is saved, so the stored profile is unchanged. The error appears above the form (`role="alert"`, `aria-invalid` on the field), and the form keeps what was typed. The typed values come back through `useActionState`, never through the URL. Empty or spaces-only names, names or majors over 100 characters, and unknown faculties are refused |
| 3. Another student's profile edit page by URL is denied | `/profile/:id` and `/profile/:id/edit` show the not-found page for any ID but your own, which goes to `/profile`. These are logged as `unauthorized_access`. A form with an added `userId` or `id` still saves the session user |

**Note for the team:** a student's faculty and major are `User.facultyId` and `User.major`. Anything that shows them should read them there, and should never let one student edit another's.

### Monitoring

| Event | Level | Context |
| --- | --- | --- |
| `profile_save_rejected` | warn | `userId`, `reason` |
| `profile_save_failed` | error | `userId`, `errorType`, `errorCode` |
| `profile_retrieval_failed` | error | `entity`, `userId`, `errorType` |

Names, majors, and emails are never logged; a unit test checks this.

### Shared files changed

- `prisma/schema.prisma` and the migration. The SQL file starts at the SQL, `migration_lock.toml` is unchanged, and `prisma migrate diff` reports no drift.
- `lib/logger.ts`: the three events.
- `middleware.ts`: `/profile` and `/profile/:path*` need a session.
- `app/layout.tsx`: the "Profile" header link.
- `app/globals.css`: `.field-value`, for the read-only email.
- `tests/unit/middleware.test.ts`: the matcher.
- `README.md`: the route, the events, and a "Profile (US-04)" section.

### Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/profile.test.ts` | 14 | Saving only the given user, tidied spacing, clearing optional fields, limits, empty and spaces-only names, unknown or deleted faculty, database failure without the typed text in the logs, messages, reads |
| `tests/unit/profile-pages.test.tsx` | 8 | Login required and saved values shown; the form keeps typed values and marks the field after an error; a save is confirmed; the action ignores a posted ID; denied, own-ID, and visitor URLs |
| `tests/e2e/profile.spec.ts` | 3 | AT1 across log out and log in; AT2 with browser validation off (empty and 101-character names, typed values kept, stored values unchanged); AT3 (another student's URLs give 404 without their name or email, a visitor is sent to log in, a crafted form saves only the session user). It creates its own two students and faculty and deletes them |

| Command | Result |
| --- | --- |
| `npm test` | 607 of 608 passed. The one failure is the pre-existing timeout in Lea's random-course test (see US-13 "Found while testing"). It took 5.4 to 5.9 s against the 5 s limit in three full runs, and passes alone in about 1 s. All US-04 and US-13 tests passed |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed |
| `npx prisma migrate deploy`, `npm run db:seed` | Applied `20261018000000_user_profile` to the database in `.env` (Neon), with the user's go-ahead |
| `npm run test:e2e` | Passed: 54 tests, with no dev server running and no test records left afterwards |

### Found while testing, not changed

- **Sign-up has no maximum name length** (`validateCredentials` in `lib/auth.ts`). An account created with a name over 100 characters can still log in, but its profile can't be saved until the name is shortened. The fix is a matching limit at sign-up, for whoever owns sign-up.

## US-03: Reset a forgotten password

### Architecture

| Area | Files | Responsibility |
| --- | --- | --- |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20261019000000_password_reset` | `PasswordResetToken`: `userId` (deleted with the user), `tokenHash` (unique), `expiresAt`, `usedAt`, `invalidatedAt`, `createdAt` |
| Mail | `lib/mail.ts` | `sendMail` posts to an HTTP mail API when `MAIL_API_URL`, `MAIL_API_KEY`, and `MAIL_FROM` are set. Without them, it prints a block marked "DEV ONLY" in development and throws `not_configured` everywhere else. `appOrigin` reads `APP_URL` (localhost only in development) |
| Service | `lib/password-reset.ts` | `requestPasswordReset`, `checkResetToken`, `resetPassword`. No Next.js imports, so the e2e test can call it |
| Actions | `lib/password-reset-actions.ts` | `requestResetAction` always redirects to `/forgot-password?sent=1`. `resetPasswordAction` goes to `/login?reset=1`, or back with an error code |
| Pages | `app/forgot-password/page.tsx`, `app/reset-password/page.tsx`, `app/login/page.tsx` | The request form, the new-password form or the rejection message, and the "Forgot password?" link and the notice after a reset |

### User stories and behavior

| Acceptance test | Behavior |
| --- | --- |
| 1. A registered email gets a single-use link that expires | The token is 32 random bytes; only its SHA-256 hash is stored. It expires after 30 minutes, and a new request replaces older unused links. At most 3 links per account per 15 minutes |
| 2. A valid link sets a new password; the old one stops working and the new one logs in | The password is checked first with the sign-up rules (at least 8 characters, typed twice), and a refusal leaves the link usable. Then one transaction claims the link with a conditional update (so it can't be used twice, even from two tabs), sets the new bcrypt hash, deletes **all** of the user's sessions, and replaces their other links |
| 3. An unregistered email gets the same neutral message | Every request ends at the same URL with the same message, including a rate-limited one. The email is sent in the background, so a slow provider doesn't make a registered email answer later |
| 4. A used or expired link is rejected | Used, expired, replaced, and unknown links each show a clear message and a "Request a new link" button. A link that expires while its form is open is rejected when the form is submitted. The page sends no Referer |

### Monitoring

| Event | Level | Context |
| --- | --- | --- |
| `password_reset_requested` | info | `outcome` (`sent` or `unknown_email`), `userId`, `resetLinkId` |
| `password_reset_rate_limited` | warn | `userId` |
| `password_reset_token_rejected` | warn | `reason` (`used`, `expired`, `superseded`, `unknown`), `resetLinkId` |
| `password_reset_rejected` | warn | `reason` (`weak_password`, `password_mismatch`) |
| `password_reset_completed` | info | `userId`, `sessionsEnded` |
| `password_reset_failed` | error | `stage`, `errorType`, `errorCode` |
| `password_reset_email_failed` | error | `userId`, `reason` (`not_configured`, `provider_rejected`, `provider_unreachable`, `app_url_not_configured`), `errorType` |

Emails, tokens, links, and passwords are never logged; unit tests check this. A link is logged by its row ID as `resetLinkId`, because the logger drops any key containing "token". The development-only terminal block is the one place a link is printed, and it never goes through the logger.

### Shared files changed

- `tests/unit/consolidated-exam-edge-cases.test.tsx` (Lea), **at Lea's request**, in its own commit (`0283291`): the "matches the reference and keeps every invariant" test gets a 20-second timeout and a one-line comment. Nothing it checks changed. This fixes the timeout noted under US-13 and US-04.
- `prisma/schema.prisma` and the migration. The SQL file starts at the SQL, `migration_lock.toml` is unchanged, and `prisma migrate diff` reports no drift.
- `lib/logger.ts`: the seven events.
- `app/login/page.tsx`: the "Forgot password?" link and the `reset=1` notice.
- `.env.example`: empty `APP_URL`, `MAIL_API_URL`, `MAIL_API_KEY`, and `MAIL_FROM`, with a comment.
- `README.md`: the routes, the events, and a "Password reset (US-03)" section.
- `lib/auth.ts` is only imported (`normalizeEmail`, `PASSWORD_MIN_LENGTH`, `BCRYPT_COST`), not changed.

### Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/password-reset.test.ts` | 25 | A hashed, random, 30-minute token; older links replaced; unknown and malformed emails; the rate limit; a send failure and a missing `APP_URL`; every rejection reason; the race-safe claim; password refusals that keep the link; session logout; database failures; no email, token, or password in any log line |
| `tests/unit/password-reset-pages.test.tsx` | 14 | The neutral message and redirect for any email, the new-password form, each rejection message with the new-link button, `no-referrer`, the action's redirects (never echoing the password), and the login link and notice |
| `tests/unit/mail.test.ts` | 6 | The dev-only print in development only, nothing printed in production or tests, the provider request, refused and unreachable providers, `appOrigin` |
| `tests/e2e/password-reset.spec.ts` | 4 | AT1 through the UI (only a 64-character hash stored, expiry about 30 minutes out); AT2 with a mismatched confirmation first, the old password refused, the new one logging in, and a second browser logged out; AT3 (same URL and text, no link row); AT4 (used, expired, expired while open, replaced, made up, and missing). It creates its own student and deletes it, which removes its links and sessions |

| Command | Result |
| --- | --- |
| `npm test` | Passed: 653 tests in 43 files, including Lea's random-course test with its new timeout |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed |
| `npx prisma migrate deploy`, `npm run db:seed` | Applied `20261019000000_password_reset` to the database in `.env` (Neon), with the user's go-ahead |
| `npm run test:e2e` | Passed: 58 tests, with no dev server running. A check afterwards found no leftover test users, links, or sessions |

### Found while testing, not changed

- **The e2e run can raise the monitoring alert.** The test server has no `APP_URL` or mail provider, so each run logs `password_reset_email_failed` twice (the UI requests in AT1 and AT3). Running the reset spec alone and then the whole suite within 10 minutes reached the alert threshold (5 errors), together with an existing `physical_file_not_found`. No webhook is configured, so nothing was sent. Setting `APP_URL` alone wouldn't help: with no provider, the server would still log `not_configured`. A fix would be a test-only mail sink or an alert filter, for the team to decide.
- **Timing.** A registered email still costs a few more database reads and writes than an unknown one, so the answer times can differ slightly. This is documented in the README.

## Remaining work

- US-74 (Mohammed): the admin review page on top of `listPendingSubmissions`, `publishSubmission`, and `rejectSubmission`.
- US-14 (Ali Slim): extraction of published exams only.
- Choosing and configuring a mail provider before US-03 can send real emails (`APP_URL`, `MAIL_API_URL`, `MAIL_API_KEY`, `MAIL_FROM`).
