# Upcomer Sprint 2 — Member 2 Implementation Report

## Scope

Implemented the question bank from the Sprint 2 plan:

- US-15a: Group identical and near-identical questions (5 SP)
- US-16: Rank questions by frequency (5 SP)
- US-20: Search and filter the question bank (3 SP)

Not included: extraction (US-14) and failed processing (US-76) belong to Member 5. The consolidated exam, the repetition evidence, and the likelihood tiers (US-17, US-18, US-19) belong to Member 3. The tables and functions below are the agreed hand-off point for both.

## Architecture

| Area | Files | Responsibility |
| --- | --- | --- |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20261016000000_question_bank` | `Question` (linked to its exam `CourseFile`) and `QuestionGroup` (linked to `Course` and its questions), as proposed by Member 3 |
| Grouping and ranking | `lib/question-grouping.ts` | Pure functions: `normalizeQuestionText`, `cleanQuestionText`, `isNearIdentical`, `groupQuestions`, `rankGroups` |
| Service | `lib/question-bank.ts` | `rebuildQuestionBank`, `getQuestionBank`, `getQuestionBankFilterOptions`, `getQuestionBankOverview`, `parseQuestionBankFilters` |
| Admin action | `lib/question-bank-actions.ts` | `rebuildQuestionBankAction`; calls `requireAdmin()` first |
| Pages | `app/courses/[courseId]/questions/page.tsx`, `app/admin/questions/page.tsx` | Student question bank with search and filters; admin overview with "Regroup and rank" |
| UI | `components/question-list.tsx` | Ranked list: rank, question, paper count |
| Seed | `prisma/seed.ts` | 7 sample questions on the two EECE350 exams (5 groups), so the bank has data before US-14 |

## User stories and behavior

| Story | Acceptance test | Behavior |
| --- | --- | --- |
| US-15a | Same question differing only in spacing, punctuation, or capitalisation forms one group | Normalization ignores case, spacing, sentence punctuation, leading numbers (`Q3.`, `3)`), marks (`(10 points)`), and spaces around symbols |
| US-15a | Genuinely different questions stay separate | Math symbols, numbers, acronyms, and short words must match exactly. A typo is allowed only in a word of 6+ letters that keeps its first letter, at most one per 8 words. Each group is compared with its first question only, so typos cannot chain |
| US-15a | A group lists every source question and its paper | `QuestionGroup.questions` → `Question.file`. `getQuestionBank` returns `questions` and `papers` |
| US-16 | Groups in more papers come first | Sorted by distinct paper count. Ties go to the most recent year, then the text |
| US-16 | A repeat inside one paper counts once | `paperCount` counts distinct `fileId`s |
| US-16 | A new paper changes the order when ranking runs again | `rebuildQuestionBank(courseId)` recomputes the whole course |
| US-16 | The same input twice gives the identical order | Input is sorted first and every tie has a final tie-break, so the order never depends on input order |
| US-20 | Keyword and filters work together and keep the ranking order | `q` with `year`, `termId`, `examType`, `professorId`. One paper must match all filters, and results stay in rank order |

## Hand-off

### For Member 3 (US-17, US-18, US-19, and cross-tester of these stories)

Use `getQuestionBank(courseId)` from `lib/question-bank.ts`. It returns:

```ts
{ totalPapers: number;              // the course's exam papers with at least one question: the "Y" in "X of Y papers"
  groups: Array<{                   // already in rank order
    id: string; rank: number;       // rank 1 = most frequent
    text: string;                   // the question as shown
    paperCount: number;             // the "X"
    course: { id; code; name };
    questions: Array<{ id; number; text; fileId }>;              // every source question
    papers: Array<{ id; title; year; examType; term; professor }> // each paper once, newest first
  }> }
```

- Each distinct question appears once, which is what US-18 needs.
- An empty `groups` array with `totalPapers === 0` means the course has no data, which is US-18's empty-course message.
- Tiers can come from `paperCount / totalPapers`.
- You can extend or replace `components/question-list.tsx`.
- To check by hand: run `npm run db:seed`, then open `/courses/course-eece350/questions`.

### For Member 5 (US-14 extraction)

After storing a paper's questions as `Question` rows, call `await rebuildQuestionBank(courseId)`:

- Each row needs `fileId`, `number` (from 1, unique per paper), and `text`.
- To re-extract a paper, replace its questions, then call the rebuild again.
- The seed's sample questions use `number` 1 to 4 on `file-eece350-final` and `file-eece350-midterm`.

### For Member 1 (cross-tester of US-15a, US-16, US-20)

Setup: `npm install`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`.

- **US-15a:** on `/courses/course-eece350/questions`, "Explain the TCP three-way handshake." and "Define a socket." each show "Appeared in 2 papers". The midterm writes them as "Q1. explain the TCP three-way  handshake" and "Define a socket".
- **US-15a, different questions:** "What is the difference between TCP and UDP?" and "What does ARP do?" stay separate.
- **US-16:** add `Question` rows to another EECE350 exam, then click **Regroup and rank EECE350** on `/admin/questions`. The order updates, and clicking again gives the same order.
- **US-20:** try `socket`, `SOCKET!`, Year 2024, Type Final, and their combinations. The order always follows the rank. `zzz` shows "No questions match your search." A course with no questions, such as MATH201, shows the empty message.

### For Member 4 (Integration Lead)

Shared files changed:
- `prisma/schema.prisma`: two models, plus back-relations on `Course` and `CourseFile`. `prisma format` re-aligned the `Course` block.
- `prisma/seed.ts`: sample questions.
- `lib/logger.ts`: `question_grouping_rejected`, `question_grouping_failed`, `question_bank_retrieval_failed`, `question_search_failed`.
- `app/courses/[courseId]/page.tsx`: Question Bank card.
- `app/admin/catalog/page.tsx`: Question bank card.
- `app/globals.css`: `.question-list`.
- `README.md`: routes, events, and a "Question bank" section.

The migration starts directly at the SQL. `prisma migrate diff` reports no drift against the schema.

## Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/question-grouping.test.ts` | 35 | Normalization, near-identical rules, grouping, ranking, ties, determinism |
| `tests/unit/question-bank.test.ts` | 14 | Rebuild (lock, upserts, deletes, ungrouped questions, unknown course, failure), search, filters, options, overview, logging without the keyword |
| `tests/unit/question-bank-pages.test.tsx` | 12 | Student page, empty and no-match messages, kept selections, admin page, action admin check |
| `tests/e2e/question-bank.spec.ts` | 4 | Admin regroup; one group despite spacing, punctuation, and case; search and filters keep the order; a new paper changes the ranking and repeats identically; empty course. Creates its own courses and deletes them |

| Command | Result |
| --- | --- |
| `npm test` | Passed: 468 tests in 30 files |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed |
| `npx prisma migrate deploy` and `npm run db:seed` (twice) | Passed on an empty PostgreSQL 16 database |
| `npm run test:e2e` | Passed: 32 tests, against a throwaway PostgreSQL 16 container. Port 3000 was held by another process on this machine, so the suite ran on port 3100 through a temporary copy of the config. The project config is unchanged |

## Remaining work

- Cross-testing by Member 1.
- US-14 needs to call `rebuildQuestionBank` after extraction.
- Member 4's file edit (US-72) does not regroup yet when a paper moves course. Until it does, an admin can click "Regroup and rank" for both courses.
- Reworded questions (US-15b) are out of scope.
