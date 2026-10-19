# Sprint 2 cross-test: M4 tests M5 (US-14, US-76), and integration check

Tester: Mohammed Al-Haiqi (M4), also Integration Lead. Code tested: PR #26 (`ali_slim_sprint_2`, Ali Slim, M5) on top of `main` at `056b7d8`. Real PostgreSQL, real stored files, the real PDF.js extractor, a production build, and Chromium.

## Verdict

| Story | What the plan says the tester checks | Result |
| --- | --- | --- |
| US-14 Automatic question extraction | A typed PDF gives the correct question count; an image-only PDF fails with "no extractable text" | **Pass.** Correct counts on every layout tried. Image-only gives `no_text`, shown as "No extractable text was found in this PDF." Four extraction issues below, none blocking |
| US-76 See failed file processing | Failed runs show the stage and reason; retry works | **Pass.** The page shows status, stage, and reason; retry after fixing the file completes and the questions reach the ordered exam. One race under simultaneous retries, below |
| PR #26 as a whole | CI green before merge | **Fail: blocks the merge.** One e2e test fails in CI, and the 3 after it in the same serial spec never run. See "CI failure" |

**Recommendation:** merge PR #26 after the CI failure is fixed. The other findings can be fixed later.

## CI failure (blocks the merge)

`tests/e2e/password-reset.spec.ts`, "a registered email gets a single-use link that expires" fails with `Expected: 1, Received: 0`, then 3 tests do not run (61 of 64 in CI).

- **Cause.** PR #26 added `expect.poll(... passwordResetToken.count ...).toBe(1)` right after requesting a reset through the page. CI sets no `APP_URL`, so `requestPasswordReset` stops at `app_url_not_configured` before creating a link, as it does on `main`, and the count stays 0. Reproduced locally; with `APP_URL` set, all 4 tests pass.
- **Fix, either:** add `APP_URL: http://127.0.0.1:3000` to the `e2e` job's `env` in `.github/workflows/ci.yml`, or drop the new `expect.poll` line.
- **Also for Mustafa (M1):** PR #26 changes US-03 code outside US-14 and US-76. `requestResetAction` now runs the whole request after the response (`after()`), and the "sent" log is now written only after the email is accepted. These look reasonable, but it is Mustafa's story, so he should review them.

## US-14: extraction

`tests/integration/cross-test-us14-us76.test.ts` (real database, real PDFs built in code by `tests/integration/fixtures/layout-pdf.ts`).

| Layout | Result |
| --- | --- |
| Header full of numbers ("EECE 350 - Fall 2024", "Duration: 2 hours", "Page 1 of 1") and 12 questions numbered past 9 | 12, correct |
| Number and text drawn as separate pieces on one line | Joined correctly |
| Wrapped lines, `(a)`, `b)`, and `i.` sub-parts | Kept with their question |
| Lines starting with a decimal (`3.5 Mbps`) or a plain number (`100 packets`) | Not counted as questions |
| A question running across a page break | Counted once, text joined |
| Sections that restart numbering (Part A 1-2, Part B 1-2) | 4, correct |
| Image-only PDF | `FAILED`, stage `EXTRACTION`, `no_text`, "No extractable text was found in this PDF." |
| Blank pages, corrupt PDF, typed PDF with no numbered questions | `no_text`, `unreadable_pdf`, `no_questions` |

**Known issues**, written as `it.fails` tests: they state the right behavior, pass today because the code does not do it yet, and turn red once fixed, so they can then become normal tests.

| # | Issue | Effect |
| --- | --- | --- |
| 1 | A page footer ("Page 1 of 2") is appended to the question before it | Footers appear in question text, and can stop two copies of a question from grouping |
| 2 | A section heading ("Part B: Problems") is appended to the previous question | Same |
| 3 | Numbered instructions before the first question ("1. Calculators are not allowed.") are counted as questions | Wrong count: 5 instead of 3 in the test |
| 4 | A scan with a scanner-app watermark ("Scanned with CamScanner") fails with `no_questions`, not `no_text` | Common with phone scans; the admin is told "No numbered questions were found" for what is really an image |

## US-76: failed runs and retry

| Check | Result |
| --- | --- |
| Image-only, blank, corrupt, and question-less PDFs each record their own reason at the extraction stage | Pass |
| Retry after the admin replaces the file with a typed copy | Pass: runs `FAILED, SUCCEEDED`, questions stored, exam updated |
| Stored file missing: `missing_file`; retry after it is restored | Pass |
| Retry of a successful run, an unknown file, or a material | Refused, no new run |
| Student submission: not processed while pending or after rejection; processed once published (with US-74) | Pass |
| An exam's runs are deleted with it | Pass |
| `/admin/processing` in the browser: Failed, "Text extraction", reason, Retry; Completed with no Retry; Retry then Completed; visitors sent to log in; students do not see it | Pass (`tests/e2e/admin-exam-processing.spec.ts`, 4 tests) |

**Issue 5: simultaneous retries.** Nothing locks between reading the latest run and starting a new one. With 5 retries at the same moment, 3 ran at once in local runs. In about 1 in 10 runs, the latest run then ended as `FAILED` ("Processing failed unexpectedly") although another run had extracted the questions, so the page showed a false failure. The questions themselves were always right (checked 30 times). It only happens with a double click or two admins at once. A per-file lock (for example `pg_advisory_xact_lock` on the file ID, as `rebuildQuestionBank` does per course) would fix it.

## Speed

The upload now waits for extraction and for the course regroup before it answers.

| Upload | Time |
| --- | --- |
| Typical exam: 10 pages, 30 questions | 63 to 211 ms |
| Large exam: 40 pages, 160 questions | 300 to 820 ms in the test runs; 1.16 to 1.3 s when measured alone. About 0.5 s is extraction and about 0.8 s is `rebuildQuestionBank` saving 160 groups one by one |
| 2,000 blank pages (0.5 MB) | 1.1 to 1.8 s, then `no_text` |

**Issue 6:** large exams can go past the 1 s target, because the admin waits for extraction and regrouping. Running the processing after the response (as PR #26 already does for password reset with `after()`), or saving groups in batches, would keep uploads fast.

## Integration Lead: the whole sprint end to end

One realistic journey on `main` + PR #26, with a production server, a real database, and Chromium. **22 of 22 checks passed:**

- **US-04:** a new student edits name and major; both are saved and shown.
- **US-03:** a registered and an unknown email get the same page; only the registered one gets a link row.
- **US-14:** two admin uploads give 3 and 2 questions, each with one succeeded run.
- **US-13:** a typed and a scanned exam are submitted and stay pending, unprocessed, and hidden from other students; a Word file is refused.
- **US-74:** the queue lists them oldest first; publishing the typed one extracts its 2 questions.
- **US-76:** the scan shows "Failed", "Text extraction", "No extractable text"; after the file is fixed, Retry completes.
- **US-15a, US-16, US-20:** case and numbering variants are grouped; the question in the most papers ranks first; a keyword search keeps only matches, in ranking order.
- **US-17, US-18, US-19:** each question appears once, in ranking order, with "Appeared in 4 of 4 papers" and "2 of 4"; tiers are shown; an empty course shows its empty message.
- **Logs:** processing failures are logged with stage and reason; no titles, emails, or passwords appear in the logs.

## Results

| Command | Result |
| --- | --- |
| `npm run lint`, `npx tsc --noEmit` | Passed |
| `npm test` | 701 passed |
| `npm run test:integration` | 31 (PR #26) + 21 cross-tests passed; the cross-tests passed 30 runs in a row |
| `npm run test:e2e` | 64 passed, including the 4 new processing tests; the 1 password-reset failure and 3 not run are the CI failure above |
