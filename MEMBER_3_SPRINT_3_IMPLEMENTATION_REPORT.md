# Upcomer Sprint 3 — Member 3 Implementation Report

Lea Tass. Branch: `feature/us21-us28-us33-personal-study-progress`, cut from `main` at `6ce2a0e` (after PR #29).

## Scope

Implemented from the Sprint 3 plan:

- US-33 (SCRUM-47): Learning profile kept per course (Must, 3 SP)
- US-21 (SCRUM-35): Mark questions done and resume (Should, 3 SP)
- US-28 (SCRUM-42): Personalized ordering of the question bank (Must, 5 SP)

**Not implemented, on purpose:** US-24 (rate confidence per topic) and US-27 (priorities combine weakness and exam importance) belong to Mustafa Ergaibi, and US-25 (performance updates the learning profile) is unassigned. A first version built parts of US-24 and US-25 (a confidence rating, "got it" and "struggled" outcomes, practice counts); they were removed again before review. US-28 needs two small stand-ins, kept in one file and marked as placeholders (see "Placeholders").

## Architecture

| Area | Files | Responsibility |
| --- | --- | --- |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20261027000000_learning_profile`, `prisma/migrations/20261028000000_question_progress` | `LearningTopic` (US-33) and `QuestionProgress` (US-21); back-relations on `User`, `Course`, and `QuestionGroup` |
| Learning profile | `lib/learning-profile.ts` | `topicKey`, `questionTopic`, `getLearningProfile`, `setTopicWeakness` |
| Progress service | `lib/question-progress.ts` | `getCourseProgress` (with re-linking after a regroup), `relinkTarget`, `markQuestion` |
| Rules and action | `lib/question-progress-rules.ts`, `lib/question-progress-actions.ts` | `DONE`/`UNDO`, refusal messages; `markQuestionAction`, which calls `requireUser()` first |
| Personal order | `lib/personal-order.ts` | `personalizeQuestions`, `getPersonalOrder`, and the placeholders `personalPriority` and `NEUTRAL_WEAKNESS` |
| UI | `components/mark-done.tsx`, `components/question-progress.tsx`, `components/resume-scroll.tsx`, `components/order-switch.tsx` (each with a CSS module where needed) | Mark/undo form, progress line, scroll on open, the order switch |
| Shared UI | `components/consolidated-exam.tsx`, `app/courses/[courseId]/exam/page.tsx` | The mark form under each question, the `PersonalExamView` list, the progress line, the switch, and the notices |

## User stories and behavior

| Story | Acceptance test | Behavior |
| --- | --- | --- |
| US-21 | A question marked done stays marked after logging out and back in | **Mark done** saves a `QuestionProgress` row for the session's student; the exam reads it on every visit and shows "✓ Done" with **Undo** |
| US-21 | Returning to the course, the exam opens at the first question not yet done | "N of M questions done. Continue at question K" names the first undone question in the order shown, and the page scrolls there on opening. After marking or undoing a question, it scrolls back to that question instead (`?at=N`) |
| US-21 | One student's progress is never shown to another | Every read and write is for the session's user; the action never reads a user ID from the form. A second student sees all questions undone, and their marks don't change the first student's |
| US-33 | Practice in one course does not change the other course's profile | Each profile row is keyed by `(userId, courseId, topicKey)`; `setTopicWeakness` writes one course's row only. **Practice itself is US-25, which doesn't exist**, so the tests change the profile with `setTopicWeakness`, the call US-25 will make |
| US-33 | Two courses that share a topic name track it separately | "TCP" in course A and " TCP " in course B are two rows, each updated on its own |
| US-28 | A student with a profile gets the questions reordered by their priorities in personal mode | **Personal order** (`?order=personal`) shows one list, "Your order", sorted by `personalPriority`; ties keep the frequency order. Each question keeps its number, tier badge, mark form, and report form |
| US-28 | Switching back restores the original frequency order | **Frequency order** is the exam's address without `?order=personal`: the stored ranking and its tier sections |
| US-28 | Two students with different profiles can see different orders | Each order is computed from the session student's profile in that course only. In the e2e test, a student weak in routing and one weak in DNS see different orders of the same course |

## Design decisions

- **A question's topic is its papers' `CourseFile.topic`** (your decision): the most common among its papers, then the newest paper's. No other member's model changes.
- **Profile = one 0–1 weakness per student, course, and topic.** How it is worked out (self-rating, performance) is left to US-24 and US-25. `setTopicWeakness` is the only write path.
- **Marks survive a regroup.** A regroup that changes a group's first question deletes the group and creates a new one. `QuestionProgress.groupId` is set to null instead of deleting the mark (`onDelete: SetNull`). The mark keeps a snapshot of the group's question IDs and is re-linked to the group that now holds its first question, or else most of its other questions, **in the same course only**. A mark with no questions left stays hidden; it is never attached to a guess. Marking re-links first too, so an undone question cannot come back as done.
- **The personal order keeps question numbers.** "Question 7" stays question 7 in both orders, so marks, `?at=`, "Continue at question N", and the report form's `position` always mean the same question.
- **Floating-point ties.** Priorities within `PRIORITY_TIE` (1e-9) are a tie, so rounding (3/5 × 0.5 against 1/5 × 1.5) never decides the order. Found by the e2e test.
- **Next.js drops `#question-N` after a server-action redirect**, so the action adds `?at=N` and a small client component scrolls back. Without JavaScript, the `#question-N` and the "Continue" link do the same.
- **Visuals.** The progress line is a plain line with a mint check (not the orange warning box), and **Mark done** is a small outlined button. Checked at 375 px in light and dark mode: no horizontal scrolling.

## Placeholders

In `lib/personal-order.ts`, each with a `PLACEHOLDER` comment naming its story:
- `personalPriority(paperCount, totalPapers, weakness)` for **US-27**: `share of papers × (0.5 + weakness)`.
- `NEUTRAL_WEAKNESS = 0.5` for **US-24**'s neutral default: the weakness of a question with no topic or a topic without a score.

## Hand-off

### For Mustafa Ergaibi (US-24, US-27)

- **US-27: replace `personalPriority` in `lib/personal-order.ts`, and only that function.** It takes `(paperCount, totalPapers, weakness)` and returns a number; higher comes first. The personal order calls nothing else to rank questions, and ties already fall back to the frequency order. If US-27 needs more inputs (for example a topic's exam frequency instead of the question's), change the signature there and in `personalizeQuestions`, in the same file.
- **The weakness contract.** The learning profile is one number from **0 (strong) to 1 (weak)** per **student, course, and topic**, in `LearningTopic.weakness`. Write it with `setTopicWeakness(userId, courseId, topic, weakness)` from `lib/learning-profile.ts`; it refuses values outside 0–1 and keys the topic with `topicKey` (case and spacing don't matter). Read one course with `getLearningProfile(userId, courseId)`. Topics are matched to questions through their papers' `CourseFile.topic`.
- **US-24.** Keep the ratings wherever US-24 needs them (for example a `confidence` column in your own migration) and write the resulting weakness with `setTopicWeakness`. `NEUTRAL_WEAKNESS` in `lib/personal-order.ts` is the stand-in for your neutral default; replace or remove it.
- **Nothing writes weakness until US-24 and US-25 exist.** Until then every real student has an empty profile, and the personal order shows the frequency order with the "no learning profile" note.

### For Ali Shammakh (cross-tester of US-21, US-28, US-33)

Setup: `npm install`, `npx prisma generate`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`.

- **US-21:** log in as a student, open `/courses/course-eece350/exam`, and click **Mark done** on questions 1 and 2. Log out and back in: both still show "✓ Done", and "2 of 5 questions done. Continue at question 3" is shown; opening the exam from the course page scrolls to question 3. **Undo** removes a mark. A second student sees no marks.
- **US-33 and US-28:** nothing in the app writes a profile yet. Give a student a profile from a script (`await setTopicWeakness(userId, "course-eece350", "<topic>", 1)`) after giving EECE350's exams topics on `/admin/files`. **Personal order** then reorders the questions; **Frequency order** restores the ranking. A student without a profile sees "You have no learning profile for this course yet, so this is the frequency order." The e2e specs `tests/e2e/study-progress.spec.ts` and `tests/e2e/personal-order.spec.ts` are ready-made examples.

### For Ali Shammakh (US-23, owner of the report form)

The report form and the `report` prop are unchanged and sit under every question in both orders. A report sent from the personal order returns to the frequency order, because the report action doesn't keep `order=personal` (see "Known limitations"). If you want it to, pass `order` through like `lib/question-progress-actions.ts` does.

## Migrations

`20261027000000_learning_profile` (table `LearningTopic`) and `20261028000000_question_progress` (table `QuestionProgress`). Both start directly at the SQL. `prisma migrate diff --from-migrations … --to-schema-datamodel …` reports no difference. **After pulling, run `npx prisma generate` and `npm run db:migrate`.** The migrations have not been applied to the team's Neon database; that is for the team to do.

## Shared files changed

Exact lines, in the files as they are now.

- **`prisma/schema.prisma`** (approved)
  - Lines 58–59 (`User`): `learningTopics LearningTopic[]`, `questionProgress QuestionProgress[]`.
  - Lines 116–117 (`Course`): the same two fields.
  - Line 238 (`QuestionGroup`): `progress QuestionProgress[]`.
  - Lines 292–335: the `LearningTopic` and `QuestionProgress` models.
  - **Whitespace only:** `prisma format` re-padded the `Course` block (lines 106–119) and three `QuestionGroup` lines (225, 227, 239–240), because `QuestionProgress[]` is the widest type in them. `git diff -w` shows only the added lines above.
- **`lib/logger.ts`** (approved)
  - Lines 62–69: seven events added to `LogEvent` (line 62 only gained the `|` continuation).
  - Lines 151–159: their levels, with two comment lines.
- **`components/consolidated-exam.tsx`** (approved)
  - Line 4: `MarkDoneForm` import.
  - Lines 22–24: `ProgressTarget` type and comment.
  - Line 26: `Question` gains `progress`.
  - Line 38: the `MarkDoneForm` line.
  - Line 43: `ConsolidatedExamView` gains `progress`.
  - Line 50: `<Question … progress={progress} />`.
  - Lines 54–63: the new `PersonalExamView`.
  - **Ali's report form line (39) and every `report` prop are unchanged.**
- **`app/courses/[courseId]/exam/page.tsx`** (approved)
  - Lines 3–5 and 10–12: imports.
  - Line 25: `searchParams` type gains `progress_error`, `at`, `order`.
  - Line 28: their destructuring.
  - Lines 32–37: the student's marks and personal order.
  - Line 42: the progress error notice.
  - Line 48: "in your personal order" or "the most likely first".
  - Line 49: the order switch.
  - Line 50: the no-profile note.
  - Line 52: the progress line.
  - Line 53: the visitor hint, plain text so Ali's "Log in" link stays the last one.
  - Lines 55–57: the personal or frequency view.
  - **`report={user ? { courseId } : null}` is unchanged in both views**, and so are `ReportNotice` and the "Log in … to report" line.
- **`tests/unit/consolidated-exam-page.test.tsx`**: not changed.
- **`tests/unit/question-report-pages.test.tsx`** (Ali's, approved): line 14 only, `vi.mock("@/lib/question-progress", () => ({ getCourseProgress: vi.fn().mockResolvedValue(new Map()) }));`. No assertion changed.
- **`README.md`**
  - Line 43: the exam route's query parameters.
  - Lines 260–299: the "Study progress and the personal order (Member 3, Sprint 3)" section.
  - Lines 522–525: four rows in the events table.
- **`.env.example`**: lines 28–29, `QUESTION_PROGRESS_RATE_LIMIT_PER_MINUTE` with its comment.

## Monitoring

| Event | Level | Context |
| --- | --- | --- |
| `question_progress_saved` | info | `userId`, `courseId`, `groupId`, `operation` (`mark`, `undo`) |
| `question_progress_refused` | warn | `groupId`, `reason` (`invalid_choice`, `not_found`), `userId` |
| `question_progress_rate_limited` | warn | `userId`, `retryAfterSeconds` |
| `question_progress_failed` | error | `userId`, `courseId`, `groupId`, `operation` (`mark`, `relink`), `errorType` |
| `question_progress_retrieval_failed` | error | `userId`, `courseId`, `errorType` |
| `learning_profile_retrieval_failed` | error | `userId`, `courseId`, `source` (`personal_order` for the paper topics), `errorType` |
| `learning_profile_update_failed` | error | `userId`, `courseId`, `errorType` |

Topics are never logged; unit tests check it.

## Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/learning-profile.test.ts` | 7 | Topic keys, a question's topic from its papers, reading one course, writing one row, 0–1 only, logging without the topic |
| `tests/unit/question-progress.test.ts` | 24 | Re-link target rule; re-linking within the course's published papers, duplicates, races, failures; marking and undoing, no-ops, refusals, rate limit, logs; the action (login first, session user only, `?at=`, `order=personal`, refusals) |
| `tests/unit/personal-order.test.ts` | 12 | The placeholder rule; reordering by profile; two profiles, two orders; no profile; ties, untagged and unscored topics; rounding ties; numbers kept; same order every time; reads filtered to student, course, and published papers |
| `tests/unit/study-progress-pages.test.tsx` | 11 | Mark forms above the report forms, done state, progress line and continue target, all done, visitors, error messages, scroll target |
| `tests/unit/personal-order-pages.test.tsx` | 7 | The switch, the personal list with numbers, badges, and report forms, coming back to personal mode after marking, the no-profile note, visitors, unknown values |
| `tests/integration/learning-profile.test.ts` | 2 | US-33 AT1 and AT2 on a real database |
| `tests/integration/question-progress.test.ts` | 11 | Marks survive a real regroup (new first paper, deleted paper, nothing left, paper moved course, duplicate); marking, undoing, 10 simultaneous clicks, the unique index, marking never changes the profile, pending papers |
| `tests/integration/personal-order.test.ts` | 4 | US-28 AT1 and AT3 on the real exam; no profile; another course's profile changes nothing |
| `tests/e2e/study-progress.spec.ts` | 3 | US-21 AT1, AT2, AT3 in the browser |
| `tests/e2e/personal-order.spec.ts` | 4 | US-28 AT1, AT2, AT3 in the browser; no profile and visitors |

The tests were also checked by planting bugs: dropping the same-course filter from re-linking failed the "never moves a mark to another course" test, and skipping re-linking before marking failed the "undo clears an old mark" test.

**Where the checks ran.** Every check ran against a throwaway PostgreSQL 17 in a scratch folder (127.0.0.1:5433), with `DATABASE_URL` set only in each command's environment. `.env` was not changed, and the Neon database was never written to. **One exception:** during task 5, before the mock line in `tests/unit/question-report-pages.test.tsx` existed, a unit test made the exam page run one read-only `SELECT` on `QuestionProgress` against Neon (from `.env`). It failed because the table doesn't exist there, and nothing was written. After that, every test command set `DATABASE_URL` to the local database.

| Command | Result |
| --- | --- |
| `npx prisma migrate deploy`, `npm run db:seed`, `prisma migrate diff --from-migrations` | Applied to an empty database; no difference detected |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed |
| `npm test` | Passed: 811 tests in 54 files (61 new) |
| `npm run test:integration` | Passed: 47 tests, 2 todo (17 new) |
| `npm run build` | Passed |
| `npm run test:e2e` | Passed: 74 tests (7 new), no dev server running. Afterwards, 0 test courses, users, marks, or profile rows were left |

## Known limitations

- **Nothing writes `weakness` yet.** Until US-24 or US-25 exists, real students have no profile, so the personal order shows the frequency order with the "no learning profile" note.
- **US-33's "practice" is simulated** with `setTopicWeakness` in the tests, because practising is US-25.
- **A report sent from the personal order returns to the frequency order.** Ali's report action doesn't keep `order=personal`, and it wasn't changed. Question numbers are the same in both orders, so the notice and `#question-N` still name the right question.
- **No real race was forced locally.** With the lock removed, 10 simultaneous clicks still never raced on this machine. Correct counts rest on the unique index on `(userId, groupId)`, which a test checks, and the lock only spares the losing click an error.

## Remaining work

- Cross-testing by Ali Shammakh.
- Applying the two migrations to the team's database (`npm run db:migrate`), when the team decides.
- US-24, US-25 (writing `weakness`), and US-27 (replacing `personalPriority`).
