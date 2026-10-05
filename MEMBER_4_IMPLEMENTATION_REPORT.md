# Upcomer Sprint 1 — Member 4 Implementation Report

## Scope

This work implements catalog management from the Sprint 1 plan:

- US-69: Manage the course catalog (add and edit faculties, courses, professors, and terms)

It also covers monitoring for catalog failures, which is part of this feature. US-72 (tagging a file with metadata) came later, on its own branch; see "US-72: Tag a file with metadata" below.

Branch: `feature/admin-catalog`, cut from `main` at `0aaa1c7` after PR #3. One integration fix for Member 5's uploads went on its own branch, `fix/admin-upload-auth`; see "Team integration".

## Architecture

| Area | Files | Responsibility |
| --- | --- | --- |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20261005000000_catalog_terms/` | New `Term` model (`id`, unique `name`, timestamps) |
| Catalog service | `lib/catalog-admin.ts` | Read the catalog and single entries; validate, normalize, check for duplicates, and save faculties, courses (with professors), professors, and terms |
| Server actions | `lib/catalog-admin-actions.ts` | `saveFacultyAction`, `saveCourseAction`, `saveProfessorAction`, `saveTermAction`; each calls `requireAdmin` first and redirects with the result |
| Pages | `app/admin/catalog/page.tsx`, `app/admin/catalog/{faculties,courses,professors,terms}/page.tsx` and `…/[id]/page.tsx` | Overview, four list-and-add pages, four edit pages |
| UI | `components/catalog-notice.tsx`, `components/course-fields.tsx` | Saved and error messages; the course fields shared by the add and edit forms |
| Header | `app/layout.tsx` (shared) | "Admin" link for admins only |
| Monitoring | `lib/logger.ts` (shared) | Three new event names |
| Seed | `prisma/seed.ts` (shared) | Upserts the terms Fall, Spring, and Summer |
| Styling | `app/globals.css` (shared) | Appended `.field select`, `.checkbox-list`, `.catalog-list`, `.catalog-links` |

All pages are server components marked `force-dynamic`. Every form is a plain `POST` to a server action, the same as Member 1's auth forms. Results come back as `saved`, `error`, and `value` query parameters, so the feature needs no new client component.

## Design decisions and why

**Access is checked in every page and every action.** Each page and server action starts with `requireAdmin(route)` from `lib/auth.ts`, before it reads the form or the database. A student gets the not-found page and a visitor is sent to `/login?next=…`. The actions check too, because a server action can be called directly without opening the page. The middleware redirect is only a convenience, as Member 1 explained. A denied attempt is logged once as `unauthorized_access` by `requireAdmin`.

**Codes are stored in one canonical form.** `normalizeCode()` removes all whitespace and capitalizes, so `eece 350` is saved as `EECE350`. This matches Member 2's search, which ignores case and spaces, and lets the existing `@unique` index on `Course.code` and `Faculty.code` do the real work. The seeded codes were already in that form, so no data migration was needed. Codes must be 2 to 20 letters or digits after normalization.

**Duplicates are refused twice.** A pre-check finds an existing code (case-insensitively, ignoring the entry being edited), so the admin sees "A course with code EECE350 already exists." The unique index also guarantees it: a second save racing past the check fails with Prisma `P2002`, and that is reported with the same message. This is the same approach Member 1 used for My Courses. It was checked against PostgreSQL; see "Tests and checks performed".

**Editing a course keeps its own code.** The duplicate check excludes the course being edited, so saving a course without changing its code works. Changing it to another course's code is refused.

**Professors are set with the course in one transaction.** `saveCourse` updates or creates the course, removes the professors that are no longer ticked, and adds the new ones with `createMany({ skipDuplicates: true })`, all in one `$transaction`. Unknown faculty or professor IDs are refused before anything is written.

**Terms are a plain list.** Names are trimmed with inner spaces collapsed, and a duplicate is refused ignoring case (`fall` against `Fall`). The database index is case-sensitive, so the case rule comes from the check. That is enough because only this service writes terms.

**Professors have no uniqueness rule**, since two professors can share a name.

**No delete.** US-69 asks for add and edit. Deleting a course would cascade to its files and to students' My Courses entries, so it needs its own decision and confirmation step.

## User stories and behavior

| Acceptance test | Behavior |
| --- | --- |
| An admin adds or edits a faculty, course, professor, or term, and the change shows in the catalog immediately | Each section has an add form and edit pages. After a save, the admin lands back on the list with "Saved. The catalog shows the change now." `/` is `force-dynamic`, so a new or renamed course, a new faculty, and a professor assignment show in Member 2's list and filter dropdowns on the next request. New courses also appear in Member 5's upload form. |
| A course code that already exists is refused as a duplicate | `eece 350`, `EECE350`, and `Eece 350` are all the same code. Adding one that exists returns to the form with "A course with code EECE350 already exists." and nothing is written. Faculty codes and term names behave the same way. |
| A student who tries to reach catalog management is denied | Every `/admin/catalog/*` page returns 404 with the not-found page, and every action refuses before saving. The "Admin" header link is shown only to admins. A visitor is sent to log in. |

Other messages: missing or malformed fields, an unknown faculty or professor, and an entry that was deleted while being edited each have their own message.

## Monitoring

Three event names were appended to `LogEvent` in `lib/logger.ts`:

| Event | Context logged |
| --- | --- |
| `catalog_entry_rejected` | `entity` (`faculty`, `course`, `professor`, `term`), `reason` (`invalid_fields`, `duplicate_code`, `duplicate_name`, `not_found`, `unknown_faculty`, `unknown_professor`), `entryId` when editing |
| `catalog_entry_save_failed` | `entity`, `operation` (`create` or `update`), `entryId`, `errorType`; the error is rethrown to the error page |
| `catalog_admin_retrieval_failed` | `entity` (or `catalog` for the list query), `entryId`, `errorType`; rethrown |

Codes, names, and error messages are never logged, following the team's rule against logging user input. Unit tests assert this for a failed save. The real-database race check printed only `{"event":"catalog_entry_rejected","entity":"course","reason":"duplicate_code"}`.

## Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/catalog-admin.test.ts` | 23 | Code and name normalization; create and update for all four entities; duplicates found by the check and by `P2002`; keeping your own code while editing; professor assignment and removal; invalid fields; unknown faculty or professor; deleted entries (`P2025`); logging without names, codes, or error messages; reads |
| `tests/unit/catalog-admin-actions.test.ts` | 13 | Redirects for success, duplicates, edit failures, and deleted entries; every action calls `requireAdmin` and saves nothing for a student or a visitor |
| `tests/unit/catalog-admin-pages.test.tsx` | 20 | Overview, lists, forms, notices and every message, the prefilled edit forms (selected faculty, ticked professors), not-found edit pages, access checks before any read, and the header link for admin, student, and visitor |
| `tests/e2e/admin-catalog.spec.ts` | 4 | The three acceptance tests end to end, plus the visitor redirect. Covered steps: an admin adds and edits a faculty, professor, term, and course, then finds the course on `/` through the new professor filter with the new faculty; `eece 350` is refused; a new student has no Admin link and gets 404 on three catalog URLs; a visitor is sent to log in |

| Command or check | Result |
| --- | --- |
| `npm test` | Passed: 287 tests in 21 files (56 new, 231 existing) |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed; all nine `/admin/catalog` routes built |
| `npx prisma migrate diff` | The committed SQL is the generated diff and starts at `-- CreateTable`, without the `warn` line that broke Member 1's first migration |
| `prisma migrate deploy` on the dev database | `20261005000000_catalog_terms` applied |
| `npm run db:seed`, run twice | Repeatable; three terms, no duplicates |
| Duplicate race on PostgreSQL | Three concurrent saves of `qa race 1`, `QARACE1`, and `Qarace 1`: one created, two `duplicate_code`, one row. The row was removed afterwards. |
| `npm run test:e2e` on this branch | 16 passed, 3 failed. All 4 catalog tests and all of Members 1, 2, and 3's tests pass. The 3 failures are Member 5's upload tests, which fail on `main` too, because they never log in. That is fixed on `fix/admin-upload-auth`. |
| `npm run test:e2e` on `fix/admin-upload-auth` after the locator fix (`2265875`) | 16/16 passed; the upload spec alone then passed 4/4 twice more |
| `npm run test:e2e` with both branches merged, after the locator fix (local throwaway branch, deleted afterwards) | **20/20 passed, 0 failed, on two runs in a row**, run from an isolated copy of the repository (see below). The first run there, with an empty `.next/`, failed 2 of Members 2's and 3's tests on 5-second timeouts. |

**How e2e was run.** A Next dev server that was already running held port 3000, so it was left alone. The suite ran on port 3100 with a temporary config outside the repository, identical to `playwright.config.ts` except for the port. Playwright's Chromium was installed with `npx playwright install chromium`. On this machine, `npx prisma generate` cannot replace the query-engine DLL while that dev server runs. The generated client already includes `Term`, which the checks above show, so restarting that server is all that is needed.

**Run e2e with no other dev server in the same folder.** Next's dev server keeps its build in `.next/` inside the project folder. A second dev server in the same folder (for example one on port 3000 while Playwright starts its own) writes to the same `.next/`, and switching branches makes both rebuild at once. In the merged runs from the main folder, 3 to 6 tests failed each time across every member's specs. Pages stalled, one upload returned 500, and the dev server crashed with `SyntaxError: Unexpected end of JSON input` reading a half-written manifest. The same code in a separate copy of the repository, with its own `.next/`, had no crashes and passed 20/20 twice. Stop any other `next dev` in the folder before running `npm run test:e2e`.

**The first run on a fresh `.next/` can miss 5-second waits.** The dev server compiles each page on first request. Several existing specs (Members 1, 2, 3, and 5) wait the Playwright default of 5 seconds for a navigation, and a cold compile under 4 parallel workers can take longer. Those runs fail with a URL or element not found, never with a wrong result, and pass once pages are compiled. If this becomes a problem in CI, the options are a longer `expect` timeout in `playwright.config.ts` or running e2e against `npm run build` and `next start`.

**Two test problems found and fixed in my spec while running it:**

- Clicking an Edit link and filling "Name" straight away filled the list page's add form, because the navigation had not finished. The admin's edit then saved the old name. The spec now waits for the edit page's URL. Assertions use exact headings, so "Term 123 draft" can no longer pass for "Term 123".
- The dev server compiles each admin page and action on first use, which can take longer than 5 seconds. The spec uses a 15-second expect timeout, `test.slow()` for the long test, and waits for the network to go idle before using a form.

## Team integration

- **Member 2:** No change to the catalog code. New and edited courses, faculties, and professor assignments appear on `/` automatically. Codes are stored in the form their search already expects. **Your `course-discovery.spec.ts` asserts exactly 3 courses on `/` and 2 for Engineering.** That breaks as soon as anyone adds a course to the database used for e2e, whether through this feature or by hand. My spec deletes the rows it creates in `afterAll` to keep your test green. A course created while your test runs in a parallel worker could still break it, though that didn't happen in the runs here. The robust fix is to assert that the seeded courses are present and ordered, rather than an exact count. Please decide whether to change that.
- **Member 5:** `/admin/uploads/*` and `POST /api/admin/uploads` had no admin check on `main`. A logged-in student could upload, because middleware only checks that a cookie exists. Your e2e tests also failed, because they never logged in. The fix is on **`fix/admin-upload-auth`**, one commit (`83f8b16`). It follows Member 1's verified diff: `getAdminUser` with 403 in the route, checked before the body is read; `requireAdmin` on the three pages; the auth mock in your two unit-test files; and the shared login fixture in your e2e spec. It adds 5 unit tests and 1 e2e test. Course rows on `/admin/catalog/courses` link to `/admin/uploads/exams?courseId=<id>`, as you suggested. **The `getByRole("alert")` locator is fixed** on the same branch in commit `2265875`, at the team leader's request. The "invalid and corrupt files…" test now looks for the alert inside the upload form, so Next's route announcer no longer matches. It is a test-only change.
- **Member 1:** No change to `lib/auth.ts`. The header gained one conditional link. Your header tests in `auth-pages.test.tsx` are unchanged and pass; the admin-link tests are in my own file.
- **Member 3:** No change.
- **Shared files touched on `feature/admin-catalog`:** `prisma/schema.prisma` (the `Term` model), `prisma/seed.ts` (three term upserts before `seedAdmin()`), `lib/logger.ts` (three events, appended), `app/layout.tsx` (Admin link), `app/globals.css` (four appended rules; no existing rule changed), `README.md` (routes and a Member 4 section). New shared file: `tests/e2e/fixtures.ts`, byte-identical on both branches, so they merge without conflict.
- **Merge order:** either branch can merge first. A local merge of both had no conflicts.

## Remaining work

- Review and merge `fix/admin-upload-auth` and `feature/admin-catalog`.
- Member 2 to decide on the exact-count assertions in `course-discovery.spec.ts`.
- ~~US-72: link `CourseFile` to `Term`, add a file type, and edit file metadata.~~ Done; see below.
- Deleting catalog entries, if the team wants it, with a decision on what happens to a course's files and enrollments.
- US-95 (CI) still does not exist.

---

# US-72: Tag a file with metadata

## Scope

US-72: *As an admin, I want to tag a file with course, professor, year, session, topic, and type so that it's analyzed under the right course.*

Branch: `feature/file-metadata`, cut from `main` at `b236b90` (after PR #8). Ten commits, not pushed.

**There is no ranking or analysis feature yet.** "Analyzed under the right course" currently means the file is listed on that course's exams or materials page. A future analysis feature should read `CourseFile.courseId`, `termId`, and `examType`, which this story makes reliable.

## Design decisions and why

**"Session" became a term, and "type" is a new field.** `CourseFile.session` was free text, and the seed used it for "Final"/"Midterm", which is really the exam type. It is replaced by:
- `termId`: an optional link to the US-69 `Term` model, `onDelete: SetNull`, indexed.
- `examType`: an optional enum `ExamType { MIDTERM FINAL QUIZ OTHER }`.

A type is allowed on exams only. Materials have no type field in either form, and the server refuses one.

**The data migration keeps every piece of session text.** In `20261006000000_file_metadata`, for every row with a non-blank session and `s = lower(trim(session))`:

| Old session | Result |
| --- | --- |
| Exactly a term name (any category), e.g. `fall` | `termId` set to that term |
| On an exam, starting with `midterm` / `final` / `quiz` | `examType` MIDTERM / FINAL / QUIZ |
| On an exam, anything else that is not a term | `examType` OTHER |
| Anything that is not *exactly* a term name, or exactly `midterm` / `final` / `quiz` on an exam (e.g. `Midterm 2`, `Final 2025`, `Make-up`, any non-term text on a material) | The original text is also kept in `topic`: copied if the topic is empty, otherwise appended as `topic (session: text)`. Nothing is truncated. |

A `DO $$ … RAISE EXCEPTION` guard runs before `DROP COLUMN "session"`. It counts rows whose text is covered by none of the three, and aborts the migration if any exist, so the column is never dropped while text would be lost. The SQL file starts at `-- CreateEnum`, with no warning lines. Whitespace-only sessions are treated as empty.

**One set of rules for the edit page and the upload form.**
- `lib/file-metadata-rules.ts` holds the type list, year range, topic limit, and every message. It has no database access, so the browser can use it too.
- `lib/file-metadata.ts` has `parseFileMetadata` (form only) and `checkFileMetadata` (database references). Member 5's `parseUploadForm`/`saveUpload` and my `saveFileMetadata` both call them.
- `components/file-metadata-fields.tsx` renders the same fields in both forms.

| Rule | Reason | Message |
| --- | --- | --- |
| Course required | `course_required` | Choose a course. |
| Course must exist | `course_not_found` | The selected course doesn't exist. |
| Professor optional, but must teach the selected course (a `CourseProfessor` row) | `professor_not_assigned` | The selected professor doesn't teach the selected course. |
| Term optional, but must exist | `term_not_found` | The selected term doesn't exist. |
| Year optional; 4 digits, 1950 to next year (the range uploads already used) | `invalid_year` | Year must be a 4-digit year between 1950 and 2027. |
| Topic ≤ 100 characters | `topic_too_long` | Topic must be 100 characters or fewer. |
| Type only on exams | `type_not_allowed` | Only exams have a type. |
| Type must be one of the four | `invalid_type` | Choose Midterm, Final, Quiz, or Other as the type. |

**The professor list follows the course.** The fields component is a small client component, like Member 5's form. It offers only the selected course's professors and clears the professor when the course changes. Retagging a file therefore can't silently keep a professor from the old course. The server still checks the assignment.

**Retagging is one update.** `saveFileMetadata` loads the file's category (which decides whether a type is allowed), validates, checks references, and updates all six fields in one `courseFile.update`. Blank optional fields clear the stored value. The course pages filter by `courseId`, so the file moves at once. After saving, the admin lands on `/admin/files` filtered by the file's new course, with "Saved. The file is listed under its course now."

**The pages follow the catalog pattern.**
- Both `/admin/files` pages are server components marked `force-dynamic`, and each starts with `requireAdmin("/admin/files")`, as does `saveFileMetadataAction`.
- The edit form is a plain POST to the server action.
- Results come back as `saved`/`error` query parameters.
- The list filter is a GET form, like Member 2's catalog filters.
- The catalog overview has a new "Files" card, "Manage files".

**Title and category are not editable.** US-72 lists the six metadata fields only. Changing an exam into a material would need its own decision about the stored type.

## Acceptance tests

| Acceptance test | Behavior | E2E |
| --- | --- | --- |
| 1. Given an uploaded file, when the admin sets course, professor, year, session, topic and type, then the values are saved on it | Values are saved, shown again on the edit page, and shown on the course's exams page as "Term: Fall" and "Type: Final" | `an admin sets course, professor, year, term, topic, and type and they are saved` checks the form, the database row, and the course page |
| 2. Given no course selected, when saved, then it is refused | "Choose a course." Nothing is written. The browser's `required` check is skipped in the test so the server's refusal is what is tested | `saving without a course is refused because the course is required` checks the message, that the database row still has EECE350, and that the file is still on EECE350's page |
| 3. Given a file retagged to another course, it appears under the new course and no longer under the old one | Retag EECE350 → EECE330 with Professor B. Professor A is no longer offered | `a file retagged to another course moves to that course only` |

A fourth e2e test checks that a student gets 404 on `/admin/files` and `/admin/files/:id`.

The e2e spec creates its own three exam records through Prisma. They point at an existing fixture PDF, so no file is written. The spec finds them by stamped title, never by counts, and deletes them and its test student in `afterAll`. After the runs, 0 `qa-` files and 0 test students were left.

## Monitoring

Three events were appended to `LogEvent` in `lib/logger.ts`:

| Event | Context logged |
| --- | --- |
| `file_metadata_rejected` | `fileId`, `reason` (any reason in the table above, or `not_found`) |
| `file_metadata_save_failed` | `fileId`, `errorType`; rethrown to the error page |
| `file_metadata_retrieval_failed` | `entity` (`files`, `file`, or `terms`), `fileId` or `courseId` filter, `errorType`; rethrown |

Titles, topics, and error messages are never logged; unit tests assert this. Upload-side refusals keep Member 5's `upload_rejected` event, now with the new reasons, so nothing is logged twice.

## Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/file-metadata.test.ts` (new) | 35 | Parsing and trimming; course required; year range and format; topic length; type only on exams and only from the list; course, professor-assignment, and term checks; saving all values; clearing blanks; type checked against the stored category; deleted file (`P2025`); logging without typed text; reads; messages |
| `tests/unit/file-metadata-actions.test.ts` (new) | 4 | Redirects for success (filtered by the new course), refusal, and deleted file; nothing saved for a student or visitor |
| `tests/unit/file-metadata-pages.test.tsx` (new) | 13 | List, filter, empty and unknown course, notices, prefilled edit page, professors limited to the course, no type for materials, error messages, not-found, access before any read, catalog link |
| `tests/e2e/admin-file-metadata.spec.ts` (new) | 4 | The three acceptance tests plus student access |
| Member 5's and Member 3's tests (updated) | — | `uploads.test.ts` (44): new reasons, the same messages as the edit page, the professor-assignment and term checks. Also `upload-route.test.ts`, `upload-pages.test.tsx`, `resource-list.test.tsx`, `course-pages.test.tsx`, and `admin-uploads.spec.ts` (selects Term and Type; checks "Term: Fall" and "Type: Final" on the uploaded exam) |

| Command or check | Result |
| --- | --- |
| `npm test` | Passed: 347 tests in 24 files (52 new) |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed; `/admin/files` and `/admin/files/[id]` built |
| Migration dry run | Run inside a transaction that was rolled back, with edge-case rows (`Midterm 2`, material `Final`, ` fall `, `Make-up` with a topic, material `Spring`, `Spring 2024` with a topic, `QUIZ`, blank). Each row mapped as in the table above. A second dry run with the topic step removed was stopped by the guard ("4 file(s) would lose their session text") with the column intact. |
| `prisma migrate deploy` on the dev database | Applied. Before it ran, a snapshot recorded 29 of 58 files with a session (28 `Final`, 1 `Midterm`, all exams). |
| Post-deploy check against the snapshot | 29 checked, 29 got their exact type, 0 failures, 0 topics over 100 characters |
| `npm run db:seed`, run twice | Repeatable; three terms; seeded exams carry FINAL/MIDTERM |
| `npm run test:e2e` | **24/24 passed** against the production build, with no other server running. The first run had 1 failure: my own edit had added the term/type checks to the material upload test too. It was fixed in `ca143e6`, and the next full run passed. |

## Team integration

- **Member 5 (uploads):**
  - The exam form now has a Term dropdown and a Type dropdown (Midterm, Final, Quiz, Other) instead of the free-text Session. The material form has Term but no Type.
  - The course, professor, year, term, type, and topic fields come from the shared `FileMetadataFields`. Labels are unchanged, apart from Session → Term/Type.
  - `parseUploadForm` and `saveUpload` use the shared rules. API changes:
    - `session` is replaced by `termId` and `examType`.
    - New 400 reasons: `course_required`, `invalid_year`, `topic_too_long`, `professor_not_assigned`, `term_not_found`, `invalid_type`, `type_not_allowed`.
    - `professor_not_found` is gone; `professor_not_assigned` covers it.
    - A professor who exists but doesn't teach the course is now refused; before, any professor was accepted.
  - `getUploadOptions` is unchanged and is reused by my pages. The pages also call `getTermOptions()`.
  - **Your e2e upload tests now clean up after themselves.** `admin-uploads.spec.ts` gives its three uploads stamped titles. An `afterAll` deletes those `CourseFile` rows and their stored copies under `FILE_STORAGE_ROOT`. It only deletes keys of the form `exams/<name>` or `materials/<name>` inside the root, never the committed fixtures.
    - Earlier runs had left 55 test uploads in the dev database (28 "Uploaded Exam …" and 27 "Uploaded Material …"; my earlier note said 28 because it counted only exams). They were deleted, matched by title pattern and never seeded `file-*` IDs, along with their 49 stored files; 6 rows had no file on this disk. The database now has the 7 seeded files.
    - Before and after each of three e2e runs, the database had 7 `CourseFile` rows and 0 stored uploads.
  - **The README now says uploads are admin-only** (fixed in `fix/admin-upload-auth`), replacing "not access-controlled yet".
- **Member 3 (course pages):** `getCourseFiles` includes `term`. `ResourceList` shows "Term: …" and "Type: …" instead of "Session: …".
- **Member 2:** No change.
- **Member 1:** No change; access uses `requireAdmin` as before.

**Shared files touched on `feature/file-metadata`:**
- Schema and data: `prisma/schema.prisma` (`ExamType`, `CourseFile.termId`/`examType`, `session` removed, `Term.files`), `prisma/seed.ts` (terms upserted before files; `examType` instead of `session`).
- Shared lib: `lib/logger.ts` (three events, appended).
- Member 5's code: `lib/uploads.ts`, `components/upload-form.tsx`, `app/admin/uploads/exams/page.tsx`, `app/admin/uploads/materials/page.tsx`.
- Member 3's code: `lib/courses.ts`, `components/resource-list.tsx`.
- Docs: `README.md` (routes, the upload API fields, the US-72 section).
- Tests: `tests/unit/uploads.test.ts`, `upload-route.test.ts`, `upload-pages.test.tsx`, `resource-list.test.tsx`, `course-pages.test.tsx`, `tests/e2e/admin-uploads.spec.ts`.

No CSS was needed.

**Before merging:**
- Anyone with an older checkout must run `npx prisma generate` and `prisma migrate deploy` (or `npm run db:migrate`); the generated client no longer has `session`.
- The migration was already applied to the shared dev database during this work. A branch without it will fail on `session` against that database.

## Remaining work

- A ranking or analysis feature that uses the course, term, and type (none exists yet).
- `/admin/files` has no pagination. It lists all files, or one course's files with the filter.
- Deleting files, and editing a file's title or category, if the team wants them.
- ~~Member 1's flaky sign-up test and the test students left by e2e runs~~ Fixed on `fix/e2e-flake-and-users`:
  - `signUp()` in `auth-my-courses.spec.ts` now waits for `/login?registered=1`, so the following navigation can't cancel the sign-up. Attempts that are expected to be refused use a new `submitSignUp()`. No assertion changed.
  - `auth-my-courses.spec.ts` and `admin-catalog.spec.ts` delete the students they create in `afterAll`, matched by their stamped emails, together with their sessions and My Courses entries.
  - 202 leftover test students were removed from the dev database, along with 102 sessions and 68 My Courses entries. The admin account was kept.
  - Over three e2e runs (24/24 each), User, CourseFile, and UserCourse counts were identical before and after.

---

# US-87: Error tracking and alerting

## Scope

Before this work, logging was one function that printed a JSON line. US-87 adds the following, without changing the `logError(event, context)` API any member calls:
- severity levels;
- sanitizing inside the logger;
- persistence with 30-day retention;
- an admin monitoring page;
- threshold alerting to a Discord-compatible webhook.

It also fixes defects 1 and 3 from `MEMBER_4_CROSS_TEST_REPORT_WORKSPACE.md`.

Branch: `feature/monitoring`, cut from `main` at `96cc1fa` (after PR #11). Not pushed.

## Architecture

| Area | Files | Responsibility |
| --- | --- | --- |
| Logger | `lib/logger.ts` (shared) | `EVENT_LEVELS` table, `levelOf`, `sanitizeContext`, `errorCode`, the unchanged `logError`, and a lazy, fire-and-forget hand-off to the store. Imports nothing from Prisma, so it stays safe for edge code. |
| Store | `lib/log-store.ts` (new) | `saveLogEntry`, `purgeOldEntries`, `checkAlert` with cooldown and webhook, and the page's reads. Node only; never calls `logError`. |
| Schema | `prisma/schema.prisma`, `prisma/migrations/20261007000000_monitoring/` | `enum LogLevel`, `model LogEntry` with indexes on `createdAt`, `(level, createdAt)`, and `(event, createdAt)` |
| Page | `app/admin/monitoring/page.tsx` (new) | Banner, 24-hour summary, filtered entries |
| Links | `app/layout.tsx` (shared), `app/admin/catalog/page.tsx` | "Monitoring" in the admin header; a card on the catalog overview |
| Member 3 | `app/files/[fileId]/route.ts` | `errorCode` on `file_open_failed` (one import, one field) |
| Config | `.env.example` | `ALERT_THRESHOLD`, `ALERT_WINDOW_MINUTES`, `ALERT_COOLDOWN_MINUTES`, `ALERT_WEBHOOK_URL`, `LOG_PERSIST`, empty by default |

## Design decisions and why

**One table for levels, checked by the compiler.** `EVENT_LEVELS: Record<LogEvent, LogLevel>`. Adding an event without a level does not compile.
- **error:** failures.
- **warn:** expected refusals.
- **info:** the alert itself.

`file_record_not_found` is warn, because it means an unknown ID was typed into a URL. `physical_file_not_found` is error, because a record points at a file that is gone. Member 1's refusal events use `reason: "db_error"` for real database failures. A rule next to the table raises exactly those to error, so a database outage during login counts toward alerts while wrong passwords don't.

**Sanitizing happens in the logger, for every caller.**
- Every value is a string capped at 200 characters with `…`, which fixes **defect 1**: the 5,000-character ID now logs as 200 characters plus `…`.
- Control characters are removed, so a value can't start a fake second line.
- Keys matching `password`, `token`, `secret`, `cookie`, `email`, `authorization`, or `apiKey` are dropped as defense in depth. `sessionId`, `userId`, and `reason` are kept.
- A context key can't overwrite `event`, `level`, or `timestamp`.

The console line is unchanged apart from a new `level` field. All existing tests passed without changes.

**`errorCode(error)` gives the short code only** (`ENOENT`, `EACCES`, `EISDIR`, `P2002`), never the message, since messages often contain paths. `file_open_failed` now logs it, which fixes **defect 3**. A unit test checks that `EISDIR` is logged and the message's path is not.

**Persistence can never break or slow a request.**
- `logError` stays synchronous and starts the save without waiting.
- The store module is imported lazily and once, only on the Node runtime.
- On any failure (database down, table missing, module not loadable) the line has already gone to the console. One `log_persistence_unavailable` warning is printed per process.
- The store never calls `logError`, so a failure cannot recurse.
- `LOG_PERSIST=off` disables saving.

**Unit tests cannot reach the database.** While writing the tests, I found that under Vitest, several concurrent dynamic imports of a mocked module could resolve to the **real** store. Four test log lines reached the dev database before I noticed. Those 4 rows were identified by event, level, and timestamp and deleted. Two changes fix it:
- The store import is now cached.
- Under `NODE_ENV=test` the default loader refuses to load the real store, so tests must pass their own; a test asserts this.

Four further unit-test runs left the `LogEntry` count unchanged.

**Retention is cheap.** `deleteMany({ createdAt < now − 30 days })` runs at most once an hour per server process, on a log write or when the monitoring page loads, so it also runs on a quiet system. The `createdAt` index keeps it fast.

**Alerting:**
- Only error-level entries count; the alert itself is info.
- On each error, `checkAlert` counts errors in the window by event. At the threshold it checks for a `monitoring_alert_triggered` entry within the cooldown, which defaults to the window.
- If none exists, it records one with the counts and event names, and posts the webhook.
- Because the cooldown is stored in the database, it holds across restarts.
- Within one process, concurrent errors share one check, so a burst can't send two messages.

**The webhook message holds event names and counts only**, which are fixed identifiers, never IDs or user text:
- The message is in Discord's `{ content }` format with `allowed_mentions: { parse: [] }`.
- It has a 3-second timeout.
- Only `https` URLs are used, plus `http` to `localhost`/`127.0.0.1` so it can be tested locally (the plan said https only; I widened it for the demo).
- The URL is a secret and is never printed.

**The page follows the admin pattern.** It is a server component marked `force-dynamic`, with `requireAdmin("/admin/monitoring")` first, a GET filter form like Member 2's, and the newest 100 entries.
- The banner has `role="alert"` and `data-testid="monitoring-alert"`. Tests find it by test ID or text, never by role, because Next's route announcer is also an alert.
- Times are shown in UTC.

## Acceptance and demo

| Check | Result |
| --- | --- |
| 6 × `/files/file-missing` on a production server | 6 `physical_file_not_found` rows saved, so consecutive writes are all stored |
| Threshold | One `monitoring_alert_triggered` row, raised at the 5th error: `count=5`, `events=physical_file_not_found:5` |
| Webhook (local listener) | Exactly one POST: `**Upcomer alert:** 5 errors in the last 10 minutes (threshold 5). • physical_file_not_found: 5 Details: /admin/monitoring` |
| 6 more errors at once | 12 rows, still one alert and one POST: the cooldown held |
| Server whose schema has no `LogEntry` table | Responses unchanged (404 ×3 in 353 ms), 3 console lines, exactly one `log_persistence_unavailable`, no recursion |
| Middleware bundle | No Prisma code (`.next/server/middleware.js`) |

All demo rows and the throwaway schema were deleted afterwards. Only rows created since the demo started were deleted.

## Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/logger.test.ts` | 17 | Every event has a level; the `db_error` rule; the console line; the 200-character cap; control characters; sensitive keys dropped and IDs kept; reserved keys; `errorCode`; `file_open_failed` logs `EISDIR` without the message; persistence off under tests; the real store never loaded in tests; edge runtime skipped; database failure means console only, one warning, no recursion or throw; an unloadable store; no waiting |
| `tests/unit/log-store.test.ts` | 27 | Saving; alert check after errors only; retention cutoff and hourly throttle; below and at the threshold; alert context; cooldown and after the cooldown; one check for concurrent errors; env overrides and defaults; webhook payload, timeout, and mentions; unsafe URLs ignored; local http allowed; webhook failures swallowed without the URL; page reads and filters; banner status cases |
| `tests/unit/monitoring-page.test.tsx` | 12 | Summary, entries, filters kept selected, every event offered, banner hidden, shown, and during the cooldown, webhook wording, retention on load, error page, access before any read, visitor redirect, catalog card, header link for admins only |
| `tests/e2e/admin-monitoring.spec.ts` | 2 | Real errors: 6 opens of `file-missing`, waiting until they are saved; the admin reaches the page from the header, filters by event and 1 hour, sees `fileId=file-missing` at level error and the alert banner (by test ID). A visitor is redirected; a student has no link and gets 404. `afterAll` deletes only rows created since the test started, and the student. |

| Command or check | Result |
| --- | --- |
| `npm test` | Passed: 403 tests in 27 files (56 new; all 347 existing unchanged) |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed; `/admin/monitoring` built |
| Migration | The SQL starts at `-- CreateEnum`, with no warning lines; applied with `prisma migrate deploy` |
| `npm run test:e2e` | 26/26 passed, no other server running; `User` and `CourseFile` counts unchanged; my spec's log rows removed |

## Team integration

- **All members:** no code change needed. `logError` works as before and every line now has a level. New events must be added to `EVENT_LEVELS`; the compiler insists.
- **Member 3:** `app/files/[fileId]/route.ts` gains `errorCode: errorCode(error)` on `file_open_failed`. This fixes the cross-test defects 1 and 3 (the cap is in the logger).
- **Member 1:** one admin-only "Monitoring" link in the header in `app/layout.tsx`. Your header tests are unchanged and pass.

**Shared files touched:**
- `lib/logger.ts`, `prisma/schema.prisma` (plus the new migration)
- `app/layout.tsx`, `app/files/[fileId]/route.ts`
- `app/globals.css` (appended `.log-table`, `.level-*`, `.log-alert`, `.log-details`)
- `.env.example`, `README.md` (route and the Monitoring section)

## Remaining work

- **E2E log rows.** Other members' e2e tests also write warn rows (`login_failed`, `unauthorized_access` and others; about 14 per run). These are real logs of test traffic and expire after 30 days. Delete them in each spec if the team prefers.
- **Multiple processes.** The cooldown is in the database, but two server processes could each raise one alert in the same second. One process is all Sprint 1 runs.
- **Further ideas:** a "send test alert" button, alerting on bursts of warnings (for example many `login_failed`), and paging through more than 100 entries.

---

# US-95: Continuous integration

## Scope

A GitHub Actions workflow now runs the team's checks and the full e2e suite on every push to `main` and every pull request to `main`. Until now these only ran when someone remembered to run them locally.

Branch: `chore/ci`, cut from `main` at `932fee7` (after PR #12). Not pushed. The first real run happens on GitHub when the branch is pushed.

## What was added

| File | Change |
| --- | --- |
| `.github/workflows/ci.yml` (new) | Two jobs, `checks` and `e2e`; triggers; concurrency; read-only permissions; the failure artifact |
| `playwright.config.ts` (shared) | When `CI` is set: an HTML reporter next to `list`, and traces kept for failed tests. Local runs are unchanged. |
| `README.md` (shared) | "Continuous integration" section: what runs, when, how to read a failing run, how to reproduce it, how to make it required |

## Design decisions and why

**Push to `main` and pull requests to `main` only.** Running on every push to every branch would run CI twice for each push to a pull request branch. Feature branches get CI as soon as a pull request is opened.

**A newer push cancels the older run** (`concurrency: ci-${{ github.ref }}`, `cancel-in-progress: true`), so only the latest commit of a branch or pull request uses runner time.

**`checks` and `e2e` run in parallel**, so a type error and a broken page show up together, and a run takes about as long as `e2e` alone. Both need to pass.

**The e2e database is thrown away.** A `postgres:16` service container, with a health check so steps wait until it accepts connections. `prisma migrate deploy` then runs the whole migration history on an empty database, and `db:seed` fills it.
- That also tests every new migration from scratch on every pull request, which the shared dev database cannot do.
- The admin credentials are written in the workflow, because they only exist in a database that is discarded after each run.
- No repository secrets are needed. `ALERT_WEBHOOK_URL` is never set, so CI cannot post alerts.

**`CI=true`** makes Playwright build and start a fresh production server (`reuseExistingServer: !ci`). It also switches on the HTML report and failure traces. Without that change in `playwright.config.ts`, the artifact would have been empty, because Playwright's default CI reporter writes no files.

**Least privilege:** `permissions: contents: read`. The workflow only reads the code.

## Local reproduction before committing

These steps followed the workflow as closely as possible on Windows.

- **Clean checkout.** A fresh `git clone` of `chore/ci` into my scratch folder: no `.env`, `node_modules`, or `.next`, like a runner. No database variables were set for `checks`.
- **Throwaway database.** A real PostgreSQL 18.4, run as a user process from the `embedded-postgres` package installed only in the scratch folder, on port 5433. This stood in for the service container, with the same user, password, and database name. It was stopped with `pg_ctl` and its data deleted afterwards.
- **Project dependencies.** The project's `package.json` and `package-lock.json` were not changed.

| Step | Result |
| --- | --- |
| `actionlint` 1.7.7 on `ci.yml` | No problems. It does flag a deliberately broken workflow, so the check is real. |
| `npm ci` (fresh clone) | Passed, 46 s |
| `npx prisma generate` | Passed |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm test` | Passed: 403 tests |
| `npm run build` with no `DATABASE_URL` at all | Passed, so the `checks` job needs no database settings |
| `npx prisma migrate deploy` on the empty database | All 5 migrations applied, the first from-scratch run of the full history, including the US-72 data migration |
| `npm run db:seed` | 3 courses, 7 files, 3 terms, and the CI admin as the only user |
| `npx playwright install chromium` | Passed (`--with-deps` only installs Linux packages) |
| `npm run test:e2e` with `CI=true` and the workflow's env | **26/26 passed**, exit 0, after a fresh build |
| A deliberately failing spec (temporary, in the clone only) | Exit 1. `playwright-report/index.html` and the failed test's trace were written, which is what the artifact uploads. |
| Team database untouched | `User`, `CourseFile`, and `LogEntry` counts identical before and after |

The only differences from GitHub are the operating system (Windows, not Ubuntu), the database port (5433, not 5432), and PostgreSQL 18 instead of 16. The service image and the Linux browser dependencies will first be exercised by the real run.

Port 3000 was held by a running `npm run dev`. I stopped it (PIDs 27920 and 30160) with the user's permission; it needs restarting by hand.

## Remaining work

- Push `chore/ci` and check the first real run on GitHub, including how long the npm cache and the Chromium install take.
- **Make CI required.** A repository admin turns on branch protection for `main` with `checks` and `e2e` as required checks (README, "Making CI required").
- Consider retries for e2e on CI only if flaky tests appear. None are configured now, so a flaky test shows up as red instead of being hidden.

---

# US-94: End-to-end tests for critical student journeys

## Scope

In the sprint plan, Member 4 coordinates the final integrated verification. `tests/e2e/critical-journey.spec.ts` is that verification for Sprint 1. It is **one** test in which a single new student, in one browser session, walks the Sprint 1 Critical End-to-End Journey in order. The journey crosses the features of all five members:
- Member 1: account, login, My Courses, logout;
- Member 2: browse and search;
- Member 3: course page, exams, materials, original files;
- Member 4: the seeded catalog and file metadata;
- Member 5: the stored PDFs.

Branch: `test/critical-journey`, cut from `main` at `dccd365` (after PR #13). Not pushed. No app code or other spec was changed.

## The journey

Each stage is a `test.step()`, so the Playwright report reads like the journey:

| # | Step | What is checked |
| --- | --- | --- |
| 1 | Create account | Sign-up lands on `/login?registered=1` with "Account created. Log in to continue." |
| 2 | Log in | Lands on `/my-courses`, empty, with "Log out" in the header |
| 3 | Browse courses | `/` lists courses, including exactly one EECE350 card |
| 4 | Search for "eece 350" | The URL carries `q=eece+350`; the first result is EECE350 Computer Networks |
| 5 | Add EECE350 to My Courses | Opened from the search result; "Add to My Courses" gives `?added=1` and "Added to My Courses." |
| 6 | Confirm it shows on My Courses | `/my-courses` has the EECE350 card |
| 7 | Open the course | Opened from My Courses; the "Computer Networks" heading is shown |
| 8 | Browse its exams | "Final Exam 2025" is listed; another course's "Data Structures Final 2025" is not |
| 9 | Open an exam's original file | The link opens in a new tab; fetched with the student's session it returns 200, `application/pdf`, inline, and the bytes start with `%PDF-` |
| 10 | Back to the course | "← Back to EECE350" returns to `/courses/course-eece350` |
| 11 | Browse its materials | "Network Models Lecture" is listed; "Trees and Graphs Notes" is not |
| 12 | Open a material's original file | Same checks as step 9 |
| 13 | Log out | Back on `/` with "Log in"; `/my-courses` now redirects to the login page, so the session really ended |

The test reuses the patterns of the other specs:
- the sign-up and login form labels;
- `waitForURL`-style URL assertions after every submit;
- cards found by their exact code or title, never by position or count;
- a 15-second expect timeout;
- the file check from `course-workspace.spec.ts`.

The student's email is stamped (`student-<time>-journey@mail.aub.edu`). `afterAll` deletes that student, their sessions, and their My Courses entries in one transaction.

## Results (2026-10-05)

| Command or check | Result |
| --- | --- |
| `npx playwright test tests/e2e/critical-journey.spec.ts` | Passed, all 13 steps (9–11 s for the test) |
| `npm run test:e2e` | **27/27 passed**, no dev server running |
| `User` and `CourseFile` rows | 1 and 7, before and after each run, so the student was deleted |
| `npm test` | 403 passed |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |

CI (US-95) runs this spec on every pull request to `main`, against a fresh database.
