# Ali Slim - Sprint 4 implementation and verification

Implementation commit: `5c5e5a4`.

Branch: `ali_slim_sprint_4`, created from freshly fetched `origin/main` at `8473b83`. Original `ali_slim_sprint_3` and local `main` were not changed. Scope follows the five-page doubled-workload Sprint 4 plan: US-25 (8 SP), US-29 (3 SP), US-44 (8 SP), US-73 (3 SP), monitoring, regression verification, and assigned cross-testing. Work is AI-assisted and needs Ali Slim's review and Mohammed's independent acceptance.

## Delivered behavior

| Story | Implementation | Evidence |
| --- | --- | --- |
| US-25 | Authenticated question-bank practice with correct/incorrect outcomes, atomic event/profile writes, stable idempotency keys, replay conflicts, per-course/student isolation, preserved confidence and evidence counters | Unit action/algorithm tests; real database concurrency, rollback, course privacy, confidence races, and 50 fixed-seed trials; browser form and persisted monitoring |
| US-29 | Priority explanations use the exact ranking formula, stored confidence, correct/incorrect counts, baseline and exam-paper frequency; absent/invalid evidence does not claim mastery | Pure explanation tests, 50 fixed-data ranking checks, real-database profile/order integration, browser personal order |
| US-44 | Offline course-grounded reasoning tasks, exact requested count/topic/difficulty, private persisted libraries, stable IDs, provenance, hashes and source validity; no historical-frequency contamination | Pure generator/validation tests, concurrent generation, exhaustion, corrected-source invalidation, privacy, 50 seeded database trials; browser generation, refresh and mobile dark mode |
| US-73 | Admin replacement/removal forms, version/origin/permission checks, validated staging, transactional extraction replacement and regrouping, active-run protection, safe cleanup and preserved historical outcomes | Real PDF/database rollback/race tests and 50 seeded mutations; browser student denial, invalid replacement, valid replacement, removal and monitoring; cache/header tests |

Question practice is linked from the course home and Upcomer Exam. Generation is linked from practice. File management is linked from Edit File Details. Existing Mark done/Undo behavior is separate and unchanged in meaning.

## Evidence contract and teammate handoff

- `LearningTopic` adds `baselineWeakness`, `correctCount`, and `incorrectCount`. Existing profile fields stay compatible. `getLearningProfile` includes the new optional evidence fields for Mustafa's US-26/30/47 and Lea's US-31.
- `recordLearningEvents(userId, courseId, events)` accepts trusted server events `{ eventId, source, correct, questionId? | generatedQuestionId?, topic? }`. Stable `(userId, source, eventId)` identity is unique. Replays must match course, target and outcome. Inputs and all profile changes in a batch commit together. Session-bound browser actions cannot choose another user or submit mock grades.
- Weakness is `(2*baseline + incorrect)/(2+correct+incorrect)`. The baseline is existing weakness/confidence or neutral 0.5. Confidence saves and outcome writes use the same course/profile lock. Changing confidence does not erase performance. Skip does not create mastery.
- Topic attribution uses distinct published source papers and the question bank's identical year/title/ID ordering for ties. A regression tests that evidence updates the topic displayed in the rationale.
- Mohammed's US-49 calls `recordMockOutcomes(userId, courseId, attemptId, [{ itemId, generatedQuestionId, correct }])` after persisting ownership-checked, rubric-backed grades. This branch tests that adapter against actual stored generated questions, including duplicate delivery and stolen/stale items. There is no browser endpoint for submitting arbitrary mock grades.
- **Actual US-49 integration remains pending** because its attempt/grading producer is absent. E5 flashcard/AI event sources also remain future integrations. Per the PDF's acceptance boundary, US-25 is not claimed fully accepted against every original source until those producers are integrated and independently tested.
- Ali Shammakh's US-45 and Lea's US-46 use `generatePracticeQuestions` and `getGeneratedPracticeQuestions` to select eligible stored items. Source edits/retagging invalidate eligibility; source replacement/removal deletes derived items. Callers must not bypass that read contract with unfiltered table reads.

## Generation scope and manual output review

The generator creates new reasoning tasks around actual published paper context. It does not call a model or require a secret key. Source context is copied verbatim and a new task requests concept identification, solution planning/checking, or comparison/generalization. Three variants per source/difficulty are available; the student receives a controlled exhaustion refusal rather than recycled items or a short batch.

The UI explicitly describes this scope. Difficulty is requested reasoning depth, not calibrated item difficulty. `rubric` is null: existing course papers provide no verified keys. No answer, score or correctness claim is invented. US-49 must flag absent grading evidence instead of guessing. No external inference, email or webhook was invoked during verification.

Manual inspection of the generated source/task combinations checked that the context came from the correct course paper, each task changed the requested reasoning, no new factual solution or numeric assumption was asserted, and all nine task variants across three difficulty settings were distinct. This bounded generator does not claim arbitrary novel numerical problem synthesis or general pedagogical validation. Source length is limited to 12,000 characters per task context.

## File mutation consistency

Replacement validates and extracts new bytes before deleting anything. It keeps `CourseFile.id`, metadata and review state. A staged UUID file is written exclusively within canonically verified storage. The database transaction checks course/file locks, the displayed `updatedAt`, and recent RUNNING processing attempts, then replaces/deletes source questions and regroups before commit. Invalid PDFs and grouping failures leave old bytes/data/ranking intact; failed staged bytes are cleaned up.

Removal requires explicit confirmation. Cascades remove extracted and generated items; outcome events retain immutable target/topic snapshots and nullable source relations. Correction/report snapshots and surviving question groups keep existing semantics. All original-file responses now use `private, no-store` to avoid stale replacement bytes. Old storage is unlinked after commit only when no record shares its key. Cleanup failure is logged and shown to admins; it does not falsely roll back an already committed change.

## Monitoring

New events are in the existing logger/monitoring system:

- `learning_evidence_saved` (info), `learning_evidence_refused` (warn), `learning_evidence_failed` (error).
- `practice_generation_completed` (info), `practice_generation_refused` (warn), `practice_generation_failed` (error).
- `file_management_completed` (info), `file_management_refused` (warn), `file_management_failed` and `file_management_cleanup_failed` (error).
- Existing `priority_calculation_failed` covers invalid ranking inputs.

Only IDs, counts, operations, reason codes and error types are logged. No student answers, topic text, names, file contents or generated prompts are logged. Browser tests check persistence of successful practice, generation and mutation events. Configurable per-minute limits default to 60 practice updates/student, 20 generation batches/student, and 20 file mutations/admin.

## Verification environment and results

All database/browser tests use disposable PostgreSQL on `127.0.0.1:55434`, database `upcomer_sprint4`. The runtime/data live under the OS temporary directory. Environment settings are passed to individual processes; `.env`, the shared database and project dependency/lock files are untouched. Browser testing builds production code with CI mode and two workers, and disables outbound email/webhooks. No dev server was reused.

Final cleanup queries found **0 Sprint 4 test courses, 0 test users, and 0 test faculties**; no `s4*` uploaded fixtures remained. The temporary database server was stopped after verification. Local ignored logs are under `reports/sprint4-*-final.log`; screenshot/trace artifacts are under `test-results/`.

| Check | Result |
| --- | --- |
| Prisma client generation | Passed |
| Migrations on an empty local database | All 17 migrations applied |
| Prisma migrated database versus schema | No difference detected |
| ESLint and TypeScript | Passed on the final implementation |
| Unit/component suite | 1,058 passed in 69 files |
| Full integration suite | 124 passed in 12 files |
| Production build | Passed; browser run builds again |
| Versioned US-93 accuracy gate | Passed without changing baseline/thresholds: precision 100%, recall 86.8%, F1 92.9%, rank correlation 94.2%, top-5 precision 100% |
| Full browser suite | 94 passed, none failed or skipped, against a fresh production build (5.0 minutes including build) |

Visual checks: inspected desktop practice, admin management, and 375px dark-mode generation screenshots. The mobile browser check confirms no horizontal overflow. Successful practice, generation and file management logs reached persisted monitoring.

The integration suite's reproducible valid/invalid trials:

| Story | Seed | Actual result |
| --- | --- | --- |
| US-25 | 271025 | 50/50: 35 accepted (18 correct, 17 incorrect), 15 invalid-course refusals; every accepted event replayed without duplicate progress |
| US-44 | 271044 | 50/50: 36 configured batches accepted, 14 invalid-setting refusals with no writes |
| US-73 | 271073 | 50/50: 8 replacements, 15 removals, 9 invalid PDFs, 9 stale versions, 9 unconfirmed removals; storage and database assertions checked each outcome |
| US-29 | Fixed 50-case input set | 50/50 rationale/actual-priority consistency checks plus unknown/invalid states |

These are bounded deterministic correctness trials, not a production availability or load-capacity guarantee.

## Defects found and corrected during verification

- Current `origin/main` advice code used six events absent from the logger type/level table, preventing TypeScript/build. Added the existing events' declarations; no advice behavior changed.
- The existing advice integration tests accumulated a per-author rate limit across cases and checked the whole mixed anonymous/named feed for an author's public name. Reset rate state per case and inspect anonymous payloads for name leaks while checking all payloads for raw author IDs.
- The first browser run passed 92/94 and exposed real issues in new code: implicit select labels included option text, and strict origin checks used Next's internal localhost URL. Added explicit control labels and Host/proxy-aware same-origin validation/redirects, with a regression for internal versus public hosts. The final browser rerun supersedes that first run.
- Review found practice topic ties using creation time while personal ordering used year/title/ID. Aligned attribution and added a database regression. Added a real confidence-versus-outcome race regression.

## Shared files touched

- `prisma/schema.prisma`, new `prisma/migrations/20261115000000_practice_evidence/migration.sql`.
- `lib/learning-profile.ts`, `lib/topic-confidence.ts`: additive evidence reads and confidence-preserving recomputation/locking.
- `lib/personal-order.ts`, `lib/consolidated-exam.ts`, `components/consolidated-exam.tsx`: actual-score explanations.
- `lib/question-bank.ts`: extracted the existing regroup body into a transaction-aware helper without changing grouping rules.
- `lib/logger.ts`: new feature events plus missing existing advice event declarations.
- Course home/exam pages, admin files list/detail pages, and original-file route: entry links, cleanup visibility and no-store caching.
- `.env.example`, `README.md`, existing confidence/file-route unit tests, and advice integration tests.

New feature-specific modules, pages, API route, CSS and tests are listed in `git diff --stat` and described in README. No PDF, dependency, lockfile, gold dataset, baseline, CI workflow, timer, mock-session or grading implementation was changed.

## Remaining team acceptance and release work

- Mohammed must independently cross-test US-25/29/44/73; Ali Slim must review AI-assisted code and evidence. This report does not impersonate either person's approval.
- Integrate US-45 mock assembly and US-49 grading with the delivered contracts; test real attempt IDs and graded outcomes. E5 event-source validation remains explicitly open.
- Ali Slim's US-34/35/37/39 automated cross-test evidence is in `CROSS_TEST_ALI_SLIM_SPRINT_4.md`. US-45 independent acceptance awaits that implementation.
- Teammate PR approval, remote CI, Jira records, merging, deployment, complete sprint demo and any real-content rubric review remain team actions. No push, remote change, Jira update or deployment was performed.
