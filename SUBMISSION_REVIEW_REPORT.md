# US-74: Review student submissions (admin)

> As an admin, I want to review student submissions and publish or reject them with a reason.

Built on `main` after PR #23 (US-13, student submissions). US-13 already added the model (`CourseFile.status`, `submittedById`, `rejectionReason`, `reviewedAt`) and the review functions in `lib/submissions.ts`. This story adds the admin page on top of them, plus what the professor's checklist asks for: response times in the logs, a load test, a rate limit, and integration and browser tests.

## Acceptance tests

| Acceptance test | How it is met | Tested in |
| --- | --- | --- |
| Publish makes a submission visible, and an exam enters the pipeline | Publish sets `PUBLISHED`, so the file is on its course page. For an exam, `publishSubmission` runs `rebuildQuestionBank`, which groups and ranks its questions with the course's other papers (US-15a, US-16) | Integration: the published exam's repeated question now counts 2 papers and ranks first. e2e: published through the page, it is on the exams page and its question is on `/courses/:id/questions` |
| A reason is required to reject, and it is shown to the student | The textarea is `required` (max 500). The server refuses a blank or too-long reason too. The student sees "Reason: …" on `/my-submissions`, as plain text | Unit, integration, and e2e, including a reason that looks like HTML (no XSS) |
| The queue lists pending submissions oldest first | `createdAt` ascending, ties broken by `id`, 20 per page | Integration (order, ties, pages) and e2e (including one made through `/submit`) |

## What was built

| File | What it does |
| --- | --- |
| `app/admin/submissions/page.tsx` | The queue: course, type, details, submitter, Open file, Edit details, Publish, and a Reject form with a reason. Pages of 20 with Older/Newer links. A notice after each review |
| `lib/submission-review-actions.ts` | The two server actions. `requireAdmin()` first, then back to the same queue page with the outcome. The reason never goes in the URL |
| `lib/submission-review.ts` | `getReviewQueue(page)` and `reviewSubmission(adminId, operation, fileId, reason)`: the per-admin rate limit, the timing, and the audit event around the US-13 functions |
| `lib/submission-review-rules.ts` | The messages. An unknown `error` value gets a general message and is never echoed |
| `lib/rate-limit.ts` | A fixed-window limit in memory |
| `lib/timing.ts` | `timed(operation, context, run)`: one `operation_timed` line per operation, and `slow_operation` over 1 s |
| `tests/load/` | `npm run load -- review-queue` (autocannon) |

### Compared with the earlier version built before US-13 existed

The earlier branch (`feature/submission-review`, never pushed) guessed the US-13 contract. The guess matched on the model, the error codes, the 500-character reason, and the race protection. This version drops everything US-13 now owns:

- No migration and no schema change: the fields are US-13's.
- No `/my-submissions` page, no visibility rules, and no changes to `lib/courses.ts`, `lib/files.ts`, or the file route: US-13 did them.
- No own publish/reject service: it calls `publishSubmission` and `rejectSubmission`. The stand-in pipeline hook is gone; publishing calls the real `rebuildQuestionBank`.
- `reviewedById` (which admin) is not a column; the `submission_reviewed` log event records the admin's ID instead. Adding a column later would need a migration in US-13's model.

## Shared files touched

- `lib/submissions.ts` (US-13): `listPendingSubmissions` takes an optional `{ skip, take }`, and `countPendingSubmissions()` is new. Called without arguments it behaves as before, and its 26 unit tests pass unchanged.
- `lib/logger.ts`: `slow_operation`, `submission_reviewed`, `submission_review_refused`, `submission_review_rate_limited`.
- `app/layout.tsx`: the admin "Review" link.
- `app/admin/catalog/page.tsx`: the Submissions card.
- `app/globals.css`: `.field textarea`.
- `vitest.config.ts` (skips `tests/integration/`), `package.json` (`test:integration`, `load`, `autocannon`), `.github/workflows/ci.yml` (one step), `.env.example`, `README.md`.

## Tests

| Kind | File | Tests | What it checks |
| --- | --- | ---: | --- |
| Unit | `tests/unit/submission-review.test.ts` | 18 | Hostile inputs: a file or a 100,000-character string as the ID, a reason at exactly 500 characters, emoji and line breaks, and reasons made only of spaces or invisible characters; refused reviews count toward the rate limit. Also: pages and page fallback; no row query for an empty queue; publish regroups an exam; the reason is trimmed and never logged; each refusal is logged with its reason; slow reviews are logged; the rate limit refuses an admin without touching the database and does not affect another admin; actions check the admin first and return to the same page; unknown messages are not echoed |
| Unit | `tests/unit/submission-review-pages.test.tsx` | 6 | Admin check before reading; order, details, and forms; page links and the page kept in the forms; empty queue; notices; student titles and names are escaped |
| Unit | `tests/unit/timing.test.ts`, `tests/unit/rate-limit.test.ts` | 5 | Timing and slow logging, including a failed operation; the limit window and the environment value |
| Integration (real database) | `tests/integration/submission-review.test.ts` | 12 | Oldest first with ID ties; pages keep the order; **two admins publishing at once: exactly one wins**; publish against reject: the first decision stays; each category on its page; **a published exam enters the question bank, a pending or rejected one does not**; each student sees only their own; no second review; blank, too long, and unknown refused without changes; deleted student account; **a 60-question exam published into a course with 20 papers, regrouping included, in under 1 s** |
| Integration (real database) | `tests/integration/submission-review-stress.test.ts` | 7 | **4 admins making 120 random reviews of 24 submissions, 20 at a time, with three fixed random seeds**: every submission is decided at most once, the stored state is always the winner's, every loser is told "already reviewed", the queue shows exactly the undecided files, and the question bank left behind equals a fresh rebuild. Also: 12 exams sharing a question published at the same moment (one group, 12 papers); the rate limit on a real database; a submission moved to another course while waiting; a submission or its course deleted between opening the queue and reviewing |
| e2e (Playwright) | `tests/e2e/admin-submission-review.spec.ts` | 6 | A submission made through `/submit` reaches the queue in order; publish through the page puts the exam on the course page and its question in the question bank; a reason is required and the student sees it, while the file stays hidden from others; an HTML-looking reason is plain text with no dialog; **two admins in two browsers: the second is told it was already reviewed and the publish stays**; visitors are sent to log in, and students get no queue and no Review link |

**The tests catch real bugs.** Each change below was made on purpose, and the tests named failed:

| Change | Failed |
| --- | --- |
| Removing the `status: PENDING` check from the update | The two race tests and "no second review" |
| Not regrouping on publish | The question pipeline test and the 60-question test |
| Dropping the ID tie-break | The order test |
| Removing the `status: PENDING` check (stress test) | All three random concurrent runs |
| Checking the reason with `trim()` only | The invisible-characters test |
| Always showing the first page | The pages test |

## Real run: production server, real database, real browser

A script (not in the repo) ran the whole feature the way people would use it: a production build (`next start`), a fresh PostgreSQL database, Chromium, real PDFs, and `REVIEW_RATE_LIMIT_PER_MINUTE=5`. **30 of 30 checks passed**:

- Two students signed up through `/signup`, and one submitted four real PDFs through `/submit`.
- While pending, the files were on no course page and gave 404 to a visitor and to the other student.
- The admin's queue listed them oldest first (loaded in 98 ms), and "Open file" returned the same PDF byte for byte.
- **Forged requests.** The real publish action ID was taken from the admin's page and posted by a student and by a visitor. Nothing changed: the student got 404, and the visitor was sent to log in.
- A reason of zero-width spaces was refused; a real reason was saved and shown to the student, and to no one else.
- The published exam and notes appeared on their pages and opened for another student; the rejected file stayed 404.
- **Live rate limit.** A second admin's 6th review within a minute got "Too many reviews in a minute." The first admin was not affected.
- **Logs.** The server log had timings for the queue, publish, and reject: 63 timed operations, the slowest 98 ms. Audit rows were saved with the admin's ID, the rate limit as a warning, and `/admin/monitoring` showed them. The rejection reason, the titles, and the students' emails appeared in neither the server log nor the log table.
- **Database rules held for every file:** a rejected file has a reason and a review time, a pending one has neither, and a published submission has a review time and no reason.

## Found by the testing

| Finding | What was done |
| --- | --- |
| A rejection reason made only of invisible characters (zero-width spaces, word joiners, blank fillers) passed the "reason required" check, because `trim()` keeps them. The student would have seen an empty "Reason:" | Fixed in `lib/submission-review.ts`: these are removed before checking that something readable is left. Any language works. The same check could move into `rejectSubmission` in `lib/submissions.ts` (US-13) |
| A rate-limited admin also counts refused attempts, so a script sending bad requests is stopped as well | Kept on purpose, and tested |
| Publishing an exam whose questions have not been extracted adds nothing to the question bank | Expected until US-14 (extraction) exists |

## Professor's checklist

| Point | What this story does |
| --- | --- |
| **Responsiveness (100 ms to 1 s), shown in the logs** | `review_queue`, `submission_publish`, and `submission_reject` each print one `operation_timed` line with `durationMs` (`lib/timing.ts`). Over 1 s is also logged as `slow_operation` and shows on `/admin/monitoring`. Publishing a 60-question exam, regrouping included, took 436 to 541 ms locally in three runs |
| **Load testing** | `npm run load -- review-queue` builds and starts the production app, puts 200 pending submissions in the queue, and opens it with 1 to 100 admins at once. It writes `reports/load-review-queue-<date>.md` and `.json` with the server's own timings, then deletes everything it made. Results below |
| **Monitoring and logs** | `submission_reviewed` (who reviewed what), `submission_review_refused`, `submission_review_rate_limited`, and `slow_operation`, on top of US-13's events. IDs and reason codes only; never titles or the rejection reason |
| **Caching** | Not used, on purpose: the queue must show the current state, or two admins would act on a stale list. The page is `force-dynamic`, and US-13 already serves unpublished files with `Cache-Control: private, no-store` |
| **DoS** | The page and actions are admin-only, so anonymous traffic is refused before any database work. Reviews are limited per admin (`REVIEW_RATE_LIMIT_PER_MINUTE`, default 60), which stops a script or a stolen session from hammering publish, and each publish regroups a whole course. The queue is paginated, so its cost does not grow with the backlog |
| **Automated UI tests (like Selenium)** | Playwright, `tests/e2e/admin-submission-review.spec.ts` |
| **Clearing requests after 10 minutes** | Not part of this story; it is on the separate `chore/session-cleanup` branch |

### Load test result (local, 2026-10-18, 200 pending submissions, production build)

| Admins at once | Req/s | p50 ms | p99 ms | Errors | Within 1 s | Server time, p95 ms |
| ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | 24.6 | 44 | 80 | 0 | yes | 16 |
| 10 | 45.1 | 212 | 404 | 0 | yes | 97 |
| 25 | 46.8 | 517 | 729 | 0 | yes | 210 |
| 50 | 50.0 | 964 | 1278 | 0 | no | 147 |
| 100 | 50.0 | 1900 | 2209 | 0 | no | 228 |

- **Users within 1 s: 25 admins at once**, with no errors even at 100. The earlier version managed 10 before pagination.
- **The database is not the limit.** The server's own timing of the queue stays under 250 ms at p95 even at 100 admins. The rest is rendering on one Node process, which tops out near 50 pages a second.
- A review queue is used by a handful of admins at a time, so this is well beyond the need.

## Run it

```
npm test
npm run test:integration   # needs a migrated database (DATABASE_URL); creates and deletes its own rows
npm run test:e2e           # needs a migrated, seeded database and the admin in .env
npm run load -- review-queue
```

## Results (local, fresh PostgreSQL database)

| Command | Result |
| --- | --- |
| `npm run lint`, `npx tsc --noEmit` | Passed |
| `npm test` | 682 passed |
| `npm run build` | Passed |
| `npm run test:integration` | 19 passed, three runs in a row |
| `npm run test:e2e` | 64 passed. In one earlier full run, `admin-file-metadata.spec.ts` (Member 4's) failed once and then passed alone and in the next full run; it shares nothing with this story |
