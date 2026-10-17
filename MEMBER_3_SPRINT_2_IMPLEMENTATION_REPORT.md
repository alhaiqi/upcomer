# Upcomer Sprint 2 — Member 3 Implementation Report

## Scope

Implemented the Upcomer Exam from the Sprint 2 plan:

- US-18: The consolidated ordered exam (5 SP)
- US-17: Show a question's repetition evidence (3 SP)
- US-19: Likelihood tiers (3 SP)

All three are built on Member 2's question bank (US-15a, US-16) through `getQuestionBank(courseId)`. Grouping and ranking are not repeated here. This work sits on top of Member 2's `feature/question-bank` commits, so it has to be merged after them.

## Architecture

| Area | Files | Responsibility |
| --- | --- | --- |
| Tier rule | `lib/likelihood-tiers.ts` | Pure functions: `tierFor(paperCount, totalPapers)`, `isLowConfidence(totalPapers)`, the cut-offs, labels, and descriptions |
| Service | `lib/consolidated-exam.ts` | `getConsolidatedExam(courseId)`: every distinct question once, in rank order, with its full text, evidence, and tier; `fullQuestionText` keeps sub-parts on their own lines |
| Page | `app/courses/[courseId]/exam/page.tsx` | The Upcomer Exam page: summary line, low-confidence note, empty states, 404 for an unknown course |
| UI | `components/consolidated-exam.tsx`, `components/consolidated-exam.module.css` | Tier sections, question cards, "Appeared in X of Y papers", and the expandable source paper list |

No schema change and no migration.

## User stories and behavior

| Story | Acceptance test | Behavior |
| --- | --- | --- |
| US-18 | Every distinct question appears exactly once, in ranking order | One card per question group, ordered by the stored rank and numbered Question 1..N down the whole page |
| US-18 | A course with no processed papers says so instead of showing an empty list | "No exam papers have been processed for this course yet." If papers exist but have not been grouped yet: "This course's questions are still being prepared." |
| US-18 | A question with sub-parts shows its full extracted text together | The text comes from the source question the group's stored text was taken from, with its line breaks kept (the stored group text has them collapsed), so the exam reads like the question bank. If that paper was deleted since the last regroup, the next source question is used. The question number and marks on the first line are removed, as in the question bank |
| US-17 | "Appeared in X of Y papers" using the course's current paper count | Y is the course's exam papers with at least one question, counted when the page loads. X is the distinct papers of that course in the question's group |
| US-17 | Expanding a question lists its source papers with year and session | A `<details>` element: "Show the N source papers". Each paper once, newest first: title (opens the file), year, session (term), type, professor. A missing year or session shows as "Year unknown" or "Session unknown" |
| US-17 | The count equals the number of distinct papers in the group | X counts distinct paper IDs, so a question repeated inside one paper counts once |
| US-19 | Every question sits in exactly one tier: very likely, likely, or rare | Questions are shown under tier headings. Tiers follow the ranking, so the reading order is still the rank order |
| US-19 | The same rule for a course with 3 papers and one with 10 | Share of the course's papers: **very likely** at least 1/2, **likely** at least 1/4, **rare** below 1/4 |
| US-19 | Below the agreed minimum, the tiers carry a low-confidence note | Minimum: **5 papers**. Below it the page shows "Low confidence: these tiers are based on only N previous exams. They become more reliable from 5 papers." |

Examples of the rule:

| Papers in the course | Very likely | Likely | Rare |
| --- | --- | --- | --- |
| 2 | 1–2 | — | — |
| 3 | 2–3 | 1 | — |
| 5 | 3–5 | 2 | 1 |
| 10 | 5–10 | 3–4 | 1–2 |

### Out-of-date groups

If a paper moves to another course or becomes a material and no one regroups, its old groups still list it. The exam counts only the course's own exam papers, so X never exceeds Y and a question with no remaining papers is left out. The order stays the stored rank until an admin clicks **Regroup and rank** on `/admin/questions`.

## Monitoring

No new log events, so `lib/logger.ts` is unchanged:

- A failed question bank read is logged by Member 2's `question_bank_retrieval_failed` (with `courseId` and `errorType`).
- A failed read of the course's paper list in `getConsolidatedExam` logs the same event with `source: "consolidated_exam"`.
- A failed course lookup is logged by `course_retrieval_failed`.
- The page then shows the generic error page (`app/error.tsx`).

No question text is logged. If the team wants separate events for this page, `lib/logger.ts` needs two lines.

## Shared files changed

- `app/courses/[courseId]/page.tsx`: one "Upcomer Exam" card linking to `/courses/:courseId/exam`.

Nothing else outside the new files. `README.md` is not updated yet. The new route for its route table is `/courses/:courseId/exam`.

## For Member 2 (cross-tester of US-17, US-18, US-19)

Setup: `npm install`, `npx prisma migrate deploy` (or `npm run db:migrate`), `npm run db:seed`, `npm run dev`.

- **US-18:** open `/courses/course-eece350`, then **Open Upcomer Exam**. Five questions, each once, in the same order as the Question Bank page. MATH201 (`/courses/course-math201/exam`) shows the no-papers message.
- **US-18, sub-parts:** the seed has no multi-part questions. Add a `Question` row whose text has line breaks, for example `3. Consider the network below.\n(a) Find the mask.\n(b) Count the hosts.`, on an EECE350 exam. Regroup EECE350 on `/admin/questions`. The question shows as three lines.
- **US-17:** the handshake and socket questions show "Appeared in 2 of 2 papers". The others show "1 of 2". **Show the 2 source papers** lists Final Exam 2025 and Midterm 2024. The seeded papers have no term, so the session shows "Session unknown". Set a term on `/admin/files` and it appears.
- **US-19:** EECE350 has 2 papers, so every question is very likely (1 of 2 is half) and the low-confidence note shows. To see all three tiers, give one course 5 or more papers with questions in different numbers of them, then regroup.

## Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/likelihood-tiers.test.ts` | 8 | Every cut-off boundary; the same rule for 3 and 10 papers; one tier per question that never rises as the count drops; stale and missing counts; the low-confidence minimum |
| `tests/unit/consolidated-exam.test.ts` | 15 | Sub-part text; each question once in rank order; X and Y; papers newest first; a new paper changes Y; papers that left the course; tiers and sections; empty course; failures logged without question text. Runs against Member 2's real `getQuestionBank` with the database mocked |
| `tests/unit/consolidated-exam-page.test.tsx` | 14 | Order and numbering; sub-parts kept; both empty states; 404; error page; course home link; X of Y and the singular form; collapsed source list with year and session; tier headings; empty tiers skipped; the low-confidence note and its absence |
| `tests/unit/consolidated-exam-edge-cases.test.tsx` | 18 | Tier rule against an integer reference for every count up to 500 papers; scaling; unusual numbers. Extracted text with form feeds, only marks, Arabic, emoji, numbered sub-parts, old line breaks, HTML, LIKE wildcards, 70,000 characters. Escaped HTML and encoded links. 400 random courses (set `EXAM_FUZZ_SEED` to repeat one) checked against a reference built from the generated rows |
| `tests/e2e/consolidated-exam-edge-cases.spec.ts` | 4 | 21 hostile course IDs (`%`, `_`, `*`, SQL, null bytes, `../`, 3,000 characters, unicode) give 404, and broken encoding gives 400. IDs containing `_` and `%` never act as wildcards. HTML in questions and titles is never run, and a 400-letter word does not widen a phone screen. Three random courses on the real database, compared with a reference read from the database before grouping, after grouping, after papers move, change category, or are deleted without a regroup, and after regrouping again (set `EXAM_E2E_SEED` to repeat one; the seed is in the report's annotations) |
| `tests/e2e/consolidated-exam.spec.ts` | 7 | Admin regroup, then a student opens the exam from the course home. Each question once in the stored rank order, with sub-parts on separate lines. "X of Y" with a repeat inside one paper. Expanding the source papers. Very likely, likely, and rare on a 5-paper course with no note. A 2-paper course with the note, then a third paper changes Y and the tiers. Empty course; unknown course is a 404. Makes its own courses and deletes them |

| Command | Result |
| --- | --- |
| `npm test` | Passed: 523 tests in 34 files. The random-course test also passed with 10 fixed seeds (4,000 courses) |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed (after `npx prisma generate`; see below) |
| `npm run build` | Passed, from a clean `.next` |
| `npm run test:e2e` | Passed: 43 tests against the local PostgreSQL, with no dev server running. Both Upcomer Exam specs then passed 3 more times with 2 workers (33 of 33, none flaky), and the random test passed with 7 different seeds in all. The tests leave no data behind |

The tests were also checked by planting bugs on purpose:

- 17 bugs planted one at a time in the tier rule, the service, and the component, each caught by the unit tests. Among them: half is not very likely, a quarter is not likely, the minimum off by one, papers that left the course still counted, the tier taken from the stored count, sub-parts joined into one line, numbering from 0, a missing session hidden, and an unencoded link.
- Two of these bugs planted in the real build, each caught by the random database test.

Checked by hand in light mode, dark mode, and at phone width (375 px): no horizontal scrolling.

Local setup note: after pulling Member 2's schema change, run `npx prisma generate` (or `npm install`) before `npm run db:seed`. With an old Prisma client the seed fails with `db.question` undefined, and `tsc` reports errors in `lib/question-bank.ts`.

## Found while testing, not changed (other members' code or the framework)

- **Admin regroup message (Member 2, `app/admin/questions/page.tsx`).** When a regroup leaves a course with no questions (for example its last paper was deleted), the regroup works but the course drops off the list. The "Regrouped …: 0 distinct questions" message is only shown for listed courses, so the admin gets no confirmation.
- **Course IDs that need URL encoding (all course pages).** Next.js passes a route parameter to the page still percent-encoded. A course whose ID contains `%`, a space, `+`, or an accented letter is therefore not found on every course page (home, exams, materials, question bank, and the Upcomer Exam). It fails safely as a 404 and never shows another course. Generated IDs (`cuid()`) and the seeded IDs never need encoding, so no real course is affected.
- **Papers whose only "question" is a bare number.** Such a paper counts toward Y because it has a question row, even though that row joins no group. This is the same definition as Member 2's `totalPapers`. It only matters if extraction (US-14) stores rows like that.

## Remaining work

- Cross-testing by Member 2.
- US-14 (extraction) is not in this repository yet. The exam assumes one `Question` row holds a whole question, with its sub-parts separated by line breaks. If extraction stores sub-parts differently, `fullQuestionText` is the one place to adjust.
- `README.md`: add `/courses/:courseId/exam` to the routes and a short "Upcomer Exam" section, if the team wants it there.
