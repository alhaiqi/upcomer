# US-92: Integration tests for the exam pipeline

> Integration tests running upload, extraction, grouping, and ranking end to end.

Rebuilt on the team's real code after PRs #21, #22, and #23. The earlier version (`test/exam-pipeline-integration`, never pushed) had its own stand-in extraction, grouping, ranking, and ordered exam, which now exist for real, so it was dropped. This version changes **no product code**: it tests the code the team wrote.

This branch is stacked on US-74 (`feature/us74-admin-review`), which adds `npm run test:integration`, the CI step, and the load test runner. Merge it after US-74.

## What is tested, stage by stage

| Stage | Code on main | Tested |
| --- | --- | --- |
| Upload | `POST /api/admin/uploads`, `saveUpload` (Member 5) | For real: the route is called with real multipart PDFs; the record and the stored bytes are checked |
| Extraction | Not on main (US-14, Ali) | **Stand-in:** `tests/integration/fixtures/pipeline.ts` stores the questions each sample PDF contains, as an extractor would. This is the one swap point |
| Grouping and ranking | `rebuildQuestionBank` (Member 2, US-15a/US-16) | For real |
| Ordered exam and tiers | `getConsolidatedExam` (Lea, US-18/US-19) | For real |
| Failed runs | Not on main (US-76) | Todo tests |
| Visibility | `PUBLISHED_FILES`, `publishSubmission` (Mustafa, US-13) | For real |

## Acceptance tests

| Acceptance test | Status |
| --- | --- |
| Uploaded sample exams produce the expected ordered exam | **Passing.** Five sample papers (2021 to 2024) are uploaded through the route. After extraction and regrouping, the ordered exam has exactly 8 questions in the expected order, with the right "X of 5 papers", tiers, papers newest first, and sections (2 very likely, 2 likely, 4 rare) |
| An image-only PDF run is marked failed with the right reason | **Waiting for US-76 and US-14.** Today an image-only or corrupt PDF passes the upload check (it starts with `%PDF-`) and adds nothing to the exam, which is tested. Marking the run failed needs the processing-run status US-76 will add; two todo tests are ready for it |
| The tests run in CI on every merge to main | **Passing.** `npm run test:integration` runs in the `e2e` job, which runs on every push and pull request to `main` |

## The sample exams

`tests/integration/fixtures/sample-exams.ts` builds five real text PDFs in code, so no binary files are committed. They repeat questions the way real papers do, and are designed against Member 2's grouping rules:

- **Must group:** numbering styles (`1.`, `Q1.`, `Question 1:`, `(1)`, `1)`), case, punctuation, marks (`(10 points)`, `[5 marks]`, `(8 pts)`), spaces before `?`, and one typo in a long word (`hanshake`).
- **Must not group:** `TCP and UDP` vs `TCP and IP`, and `x^2` vs `x^3`.
- **Kept as written:** a question with sub-parts keeps its lines.
- **Ties:** two questions in 2 papers each are ordered by the most recent year.

## Tests

`tests/integration/exam-pipeline.test.ts`, 11 tests and 2 todo:

| Test | Checks |
| --- | --- |
| Sample exams to the expected ordered exam | Acceptance test 1, in full |
| Upload order does not matter | Three upload orders give the same exam |
| All five at the same moment | Concurrent uploads and regroups end in the same exam (the course lock works) |
| One paper at a time | Grows to the same exam; "low confidence" until 5 papers |
| Image-only and corrupt PDFs | Accepted as uploads, add nothing to the exam |
| Student submissions | Pending and rejected submissions are left out; publishing one regroups and re-ranks |
| Materials | Never in the ordered exam, even with extracted text |
| Deleted paper | Leaves the exam at once; the ranking catches up on the next regroup |
| Re-tagged paper | Leaves the old course's exam at once; joins the new course's after a regroup |
| Non-admin upload | 403, nothing stored |
| 20 papers of 25 questions | Each upload, each regroup, and the ordered exam each stay under 1 s |

**The tests catch real bugs.** Each change below was made to the team's code on purpose, and the tests failed:

| Change | Tests failed |
| --- | --- |
| Removing the most-recent-year tie-break in ranking | 8 |
| Removing typo tolerance in grouping | 7 |
| Removing the published-only filter | 1 |
| Grouping materials as well as exams | 1 |

## Found by the testing (for the team)

| # | Finding | Whose code | Suggestion |
| --- | --- | --- | --- |
| 1 | **The ordered exam page is the slowest page tested.** In a course with 20 papers, up to 10 students at once get it within 1 s; 25 take 2.3 s. The data takes about 18 ms; most of each request is rendering 44 questions with 500 paper references (121 KB of data) | Lea (US-18), Member 2 | Cache the exam per course and clear it on regroup, and show each question's paper list collapsed. Both pay off in big courses |
| 2 | **Changing an exam's course on the file details page does not regroup either course.** The paper leaves the old course's exam at once, but is in no course's exam until an admin presses "Regroup and rank" for the new course. Until then, the old course's order can also be stale (a 1-paper question above a 2-paper one) | Member 4 (`saveFileMetadata`), Member 2 | Call `rebuildQuestionBank` for both courses when the course or category of an exam changes, as publishing a submission already does |
| 3 | **The wording shown for a question is the one in the paper whose ID sorts first**, roughly the earliest upload. If that paper has a typo (`hanshake`), students see the typo even when later papers spell it right | Member 2 | Show the most common wording, or the most recent |
| 4 | **"What's" and "What is" are different questions** to the grouping, because the apostrophe becomes a space. By design: rewording is US-15b | Member 2 | Keep in mind for US-15b |
| 5 | **Upload does not start the pipeline yet**, and an image-only or corrupt PDF is accepted, because it starts with `%PDF-` | Ali (US-14), US-76 | Extraction should run after an exam upload and after a submission is published, and record a failed run with a reason |
| 6 | **The upload route has no rate limit.** One admin session can store about 220 files a second (load test), so a stolen session could fill the disk | Member 5 | A per-admin limit like the review page's (`lib/rate-limit.ts`) |

## When US-14 and US-76 land

1. In `tests/integration/fixtures/pipeline.ts`, replace the body of `extractQuestions` with the real extractor. Keep its `expected` argument to check it found the same questions.
2. If upload or publish starts extraction by itself, drop the `processExam` call after uploading.
3. Turn the two `it.todo` tests into real tests against the processing-run status: `no_text` for the image-only PDF and `unreadable_pdf` for the corrupt one (`FAILING_SAMPLES`).

## Professor's checklist

| Point | What this story does |
| --- | --- |
| **Responsiveness (100 ms to 1 s)** | In a course of 20 papers of 25 questions, each upload, each regroup, and building the ordered exam stays under 1 s (tested). The pages are measured by the load tests below |
| **Load testing** | `npm run load -- ordered-exam` and `npm run load -- exam-upload` |
| **Caching** | Not added: the ordered exam is Lea's code. Finding 1 measures what a cache would save |
| **DoS** | Non-admin uploads are refused before anything is stored (tested). Finding 6 covers a rate limit |
| **Automated tests in CI** | `npm run test:integration` in the `e2e` job |

### Load test results (local, 2026-10-18, production build)

Ordered exam page, a course with 20 papers of 25 questions each:

| Students at once | Req/s | p99 ms | Errors | Within 1 s |
| ---: | ---: | ---: | ---: | --- |
| 1 | 17.0 | 147 | 0 | yes |
| 10 | 12.3 | 995 | 0 | yes, just |
| 25 | 12.5 | 2296 | 0 | no |
| 50 | 10.0 | 4824 | 0 | no |
| 100 | 15.3 | 6262 | 0 | no |

Exam upload (one sample PDF per request):

| Admins at once | Req/s | p99 ms | Errors | Within 1 s |
| ---: | ---: | ---: | ---: | --- |
| 1 | 87.5 | 26 | 0 | yes |
| 10 | 172.9 | 113 | 0 | yes |
| 50 | 219.6 | 324 | 0 | yes |

## Results (local, real PostgreSQL)

| Command | Result |
| --- | --- |
| `npm run lint`, `npx tsc --noEmit` | Passed |
| `npm test` | 682 passed |
| `npm run test:integration` | 30 passed, 2 todo, three runs in a row |
