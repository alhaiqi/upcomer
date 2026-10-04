# Cross-Test Report — Member 3's Course Workspace (US-08, US-09, US-10, US-12)

**Tester:** Member 4 · **Branch tested:** `main` at `df11bfd` (after PR #10) · **Date:** 2026-10-05

Per the Sprint 1 cross-testing rule, Member 3 did not test these features themselves; this is the independent run. **No Member 3 code was changed.** Every finding below is reported, not fixed.

## Verdict

**US-08, US-09, US-10, and US-12 work.**
- All **43** functional checks pass, covering the course page, the exam and material lists, opening a valid file, missing and broken files, and wrong-course leakage.
- **All seven** of Member 3's log events were triggered against a running production server.
- None of their log lines contain a password, database host, email, title, file name, or file contents.
- Three low-severity defects were found. None blocks the stories.

Member 3's report says their migration, seed, and e2e test had never been run against a database. **They now have**, on the shared dev database, as part of the full suite.

| Suite | Result |
| --- | --- |
| Their unit tests (`courses`, `course-pages`, `resource-list`, `files`, `file-service`, `file-route`) | 22/22 pass |
| `npm run build` | Pass; `/courses/[courseId]`, `/exams`, `/materials`, and `/files/[fileId]` are all dynamic (`ƒ`), so lists are never served from a stale cache |
| Their e2e test `course-workspace.spec.ts` | Pass (first recorded run) |
| Full `npm run test:e2e` | 24/24; `User` and `CourseFile` row counts identical before and after |
| My HTTP and browser checks against a production server | **43/43 pass** |
| Their seven log events | **7/7 triggered**; no sensitive data in them |

## How it was tested

- **Servers.** One `next build`, served by three `next start` processes. Each server's output was captured to a file.

| Port | Database | Purpose |
| --- | --- | --- |
| 3200 | The normal dev database | Functional checks |
| 3201 | A throwaway schema `m3x_nofiles` with copies of `Faculty`, `Professor`, `Course`, and `CourseProfessor` but **no `CourseFile` table**, via Prisma's `schema=` URL parameter | Course lookups succeed and every exam/material query fails, so the list-failure events fire end to end |
| 3202 | An **empty** throwaway schema `m3x_empty` | The course lookup itself fails |

  This triggers real database failures inside Member 3's code path without renaming or breaking anything in the shared `public` schema.
- **Temporary data.** Everything below was created with a stamp and removed afterwards.
  - An extra course owning six odd `CourseFile` records:
    - a real PNG with the original name `Résumé "q";x.png`;
    - storage keys `../../.env`, `C:/Windows/win.ini`, and `..\..\.env`;
    - a key that goes through an NTFS junction inside `public/uploads` to a folder outside it holding a decoy secret;
    - a key that names the `exams` folder itself.
  - A second course with no files, for the empty states.
- **Checks.** A Node script sent plain HTTP requests and computed the expected lists from the database, never from fixed counts. Headless Chromium then rendered the error pages (see the note on E2/E3) and one exam card.
- **Cleanup**, verified:
  - 0 `m3x` rows, courses, or schemas left;
  - the PNG deleted and the junction removed; the decoy file outside the root was never read or touched;
  - 7 `CourseFile` rows and 1 `User`, the same as before.

## Results per check

### Course page (US-08)

| # | Check | Result |
| --- | --- | --- |
| H1 | `/courses/course-eece350`, `course-eece330`, `course-math201` each show code, name, faculty, professors, and links to `/exams` and `/materials` | Pass (3/3) |
| H2 | Unknown course `/courses/no-such-course`, `/exams`, `/materials` → 404 with the "Not found" page | Pass (3/3) |
| H3 | Odd course IDs (`' OR 1=1--`, 500 characters, `%00`) → clean 404, no error page | Pass (3/3) |
| H4 | Course and resource pages open to a visitor with no session (by design, per Member 1's README) | Pass |

### Exam and material lists (US-09, US-10) and wrong-course leakage

For each course and each list, the expected titles come from the database. The page must show all of them, show no title from another course or category, and link to no file ID outside the list.

| # | Page | Expected | Result |
| --- | --- | --- | --- |
| L1 | `course-eece350/exams` | 2 | Pass |
| L2 | `course-eece350/materials` | 1 | Pass |
| L1 | `course-eece330/exams` | 1 | Pass |
| L2 | `course-eece330/materials` | 1 | Pass |
| L1 | `course-math201/exams` | 1 (`Unavailable Sample`) | Pass |
| L2 | `course-math201/materials` | 1 | Pass |
| L1/L2 | Temporary course exams / materials | 5 / 1 | Pass |
| L1/L2 | Course with no files: exams / materials | 0, with "No previous exams are available for this course yet." / "No course materials are available yet." | Pass |
| L3 | Exams are ordered newest year first (`Final Exam 2025` before `Midterm 2024`) | | Pass |
| L4 | An exam card shows its present metadata: "Professor A", "Year: 2025", "Type: Final", and "Open Original File" | | Pass (checked in the browser; the HTML has React's `<!-- -->` between "Year:" and "2025") |
| L5 | The back link returns to the course home | | Pass |

**No leakage found.** No page showed another course's content, mixed exams with materials, or linked to a file outside its own list.

### Opening an original file (US-12)

| # | Check | Result |
| --- | --- | --- |
| F1 | `/files/file-eece350-final` → 200, `application/pdf`, `inline; filename="eece350-final-2025.pdf"`, `nosniff`, `Content-Length` 625, bytes identical to the committed fixture | Pass |
| F2 | Every "Open Original File" link on the three seeded courses' pages opens with 200 (`file-missing` gives its controlled 404) | Pass (7 links) |
| F3 | A PNG downloads as an `attachment`, `image/png`, with a sanitized name: `filename="R_sum_ _q__x.png"` (no quote, semicolon, or non-ASCII can break the header) | Pass |

### Missing and broken files

| # | Check | Result |
| --- | --- | --- |
| F4 | A record whose physical file is missing (`file-missing`) → 404 `File unavailable` | Pass |
| F5 | Unknown file ID → 404 `File unavailable` | Pass |
| F6 | Unsafe storage keys `../../.env`, `C:/Windows/win.ini`, `..\..\.env`, and a junction escaping the upload root → each 404 `File unavailable`. The response contains neither `.env` contents, `win.ini`, nor the decoy secret | Pass (4/4) |
| F7 | A storage key that names a folder → 500 `File unavailable`, no details | Pass |
| F8 | Paths typed into the URL (`/files/..%2F..%2F.env`, `/files/%2E%2E%2F%2E%2E%2F.env`, `/files/C%3A%5CWindows%5Cwin.ini`) are treated as IDs, not paths → 404 | Pass (3/3) |
| F9 | A 5,000-character file ID → 404 | Pass (but see defect 1) |

### Failure pages

| # | Check | Result |
| --- | --- | --- |
| E1 | With the file table unavailable, the course home still loads (200) | Pass |
| E2 | With the file table unavailable, `/exams` and `/materials` → 500 and "Something went wrong / We could not load this page. Please try again later." | Pass (2/2) |
| E3 | With the course table unavailable, the course home, `/exams`, and `/materials` → 500 and the same generic page | Pass (3/3) |

For E2 and E3, the raw 500 response contains only Next's error digest: no Prisma message, table or schema name, or host. The generic text comes from Member 3's `app/error.tsx`, a client component, so it appears only once the page runs in a browser. That is why these were checked in Chromium.

## Monitoring results

Every event was triggered on a production server. Each failing request produced exactly one event line.

| Event | How it was triggered | Count | Context logged |
| --- | --- | --- | --- |
| `course_retrieval_failed` | Course home, `/exams`, `/materials` on the empty-schema server | 6 | `courseId`, `errorType` (`PrismaClientKnownRequestError`) |
| `exam_list_retrieval_failed` | `/courses/course-eece350/exams` on the no-`CourseFile` server | 3 | `courseId`, `resourceCategory: EXAM`, `errorType` |
| `material_list_retrieval_failed` | `/courses/course-eece350/materials` on the no-`CourseFile` server | 2 | `courseId`, `resourceCategory: MATERIAL`, `errorType` |
| `file_record_not_found` | Unknown IDs, path-like IDs, the 5,000-character ID | 5 | `fileId` |
| `physical_file_not_found` | `/files/file-missing` | 2 | `fileId` |
| `invalid_storage_key` | The four unsafe-key records (traversal, absolute, backslash, junction) | 4 | `fileId` |
| `file_open_failed` | A record whose storage key names the `exams` folder (`EISDIR` on read) | 1 | `fileId`, `errorType` (`Error`) |

No event had to be skipped: each could be triggered safely without touching shared data.

**No sensitive data in Member 3's events.** Every log line was scanned for these, with zero matches:
- the database password and host, and the admin email;
- the decoy secret;
- seeded and test file titles;
- the original file name `Résumé`;
- the project's absolute path.

`fileId` holds whatever ID the URL asked for. That includes strings like `../../.env`, but they are request IDs, not storage keys, and they are JSON-escaped, so they cannot forge a log line. Storage keys are never logged.

Next's own error output (`⨯ Error [PrismaClientKnownRequestError]`) also appears for server-component failures. It includes the Prisma message (for example "The table `m3x_nofiles.CourseFile` does not exist"), file paths inside `.next/`, and a digest matching the page. That is framework logging, not Member 3's. It contained no host, password, or user data.

## Defects

### 1. `file_record_not_found` logs the requested ID at any length (low)

**Status: fixed in US-87** (`feature/monitoring`). The logger now caps every value at 200 characters.

`lib/files.ts` logs `{ fileId }` exactly as requested. A request to `/files/` followed by 5,000 characters wrote a **5,084-character** log line. Anyone can repeat this without a session, so the logs can be padded at will. There is no injection risk, because the value is JSON-escaped.

```
GET /files/xxxx…(5000)…  →  404
{"event":"file_record_not_found","timestamp":"…","fileId":"xxxxxxxx…"}   (5,084 characters)
```

**Suggested fix:** log `fileId.slice(0, 100)`, as Member 5's upload route already does for `courseId`.

### 2. A missing or broken file shows a bare text page in a new tab (low, UX)

"Open Original File" uses `target="_blank"`. When the file is missing (`file-missing`) or unreadable, the new tab shows only the plain text `File unavailable`. It has no layout, no explanation, and no link back. The 404 and 500 cases show the same text. This meets "controlled response, no stack trace", but a student cannot tell what happened or what to do. **Suggested fix:** return a small HTML page ("This file isn't available right now") with a link back to the course, keeping the same status codes.

### 3. `file_open_failed` doesn't say which error happened (low, monitoring)

**Status: fixed in US-87** (`feature/monitoring`). The event now logs `errorCode`, for example `EISDIR`.

The event logs `errorType: "Error"` for the `EISDIR` case. Node's file errors are all named `Error`, so a permission problem (`EACCES`), a folder (`EISDIR`), and a locked file look identical in the logs. **Suggested fix:** also log `errorCode`, as Member 5's `upload_storage_failed` does.

### Observations (not defects)

- **Download names drop non-ASCII characters.** `Résumé.png` downloads as `R_sum_.png`. That is safe, but sending `filename*=UTF-8''…` as well would keep the real name.
- **`/files/:id` is not tied to a course or a session.** Any file ID opens for anyone. That matches the current design, where course content is open to visitors. It must be revisited if any content is ever restricted.
- **An unknown course ID is not logged**; it is just a 404. That matches the plan, which only asks for retrieval failures.
- **Their e2e test covers only the happy path.** A missing file, an unknown course, and an unsafe key are covered by unit tests only. Adding `/files/file-missing → 404` and `/courses/no-such-course → 404` to `course-workspace.spec.ts` would be cheap.

## Check by hand in the browser

Run `npm run dev` (stop it again before any `npm run test:e2e`), then:

1. **http://localhost:3000/courses/course-eece350** shows "EECE350", "Computer Networks", "Faculty of Engineering", "Professor A", and the "Browse Previous Exams" and "Browse Course Materials" buttons.
2. **http://localhost:3000/courses/course-eece350/exams** lists "Final Exam 2025" (Professor A · Year: 2025 · Type: Final) above "Midterm 2024", with no "Data Structures Final 2025". "← Back to EECE350" returns to the course.
3. On that page, **Open Original File** on "Final Exam 2025" opens a new tab at http://localhost:3000/files/file-eece350-final and the PDF displays in the browser rather than downloading.
4. **http://localhost:3000/courses/course-eece350/materials** lists only "Network Models Lecture" (Topic: Network Models), and its file opens.
5. **http://localhost:3000/courses/course-eece330/exams** and **http://localhost:3000/courses/course-eece330/materials** show only "Data Structures Final 2025" and "Trees and Graphs Notes". Nothing from EECE350 appears.
6. **http://localhost:3000/courses/course-math201/exams** shows "Unavailable Sample". Click **Open Original File** and judge the plain `File unavailable` tab yourself (defect 2). The terminal running `npm run dev` should print one line `{"event":"physical_file_not_found",…,"fileId":"file-missing"}` and nothing else about it.
7. **http://localhost:3000/files/no-such-file** shows `File unavailable`. The terminal prints `file_record_not_found` with `"fileId":"no-such-file"`.
8. **http://localhost:3000/courses/no-such-course** and **http://localhost:3000/courses/no-such-course/exams** show the "Not found" page.
9. Repeat steps 1 to 3 in a private window (logged out) and while logged in as a student. The pages should look the same either way.
10. Narrow the window to phone width on step 2 and check the exam cards stay readable.

## Reproducing this

The scripts are in my scratch folder:
- `setup.cjs`: temporary records, PNG, junction, and the two schemas;
- `servers.cjs`: the three `next start` servers;
- `run.cjs`: the HTTP checks;
- `browser.cjs`: the Chromium checks;
- `logs.cjs`: event and sensitive-data scan;
- `cleanup.cjs`: removes everything that `setup.cjs` created.

They can be committed under `tests/integration/` if the team wants to keep them.
