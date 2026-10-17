# Upcomer Sprint 2 — Member 1 Implementation Report

Mustafa Ergaibi, branch `feature/mustafa-sprint-2`. This report covers US-13. US-04 and US-03 will be added to it on the same branch.

## Scope

- US-13: Submit a past exam or course material for admin review.

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

## Remaining work

- US-74 (Mohammed): the admin review page on top of `listPendingSubmissions`, `publishSubmission`, and `rejectSubmission`.
- US-14 (Ali Slim): extraction of published exams only.
- US-04 and US-03 on this branch.
