# Upcomer Sprint 1 — Member 4 Implementation Report

## Scope

This work implements catalog management from the Sprint 1 plan:

- US-69: Manage the course catalog (add and edit faculties, courses, professors, and terms)

It also covers monitoring for catalog failures, which is part of this feature. US-72 (tagging a file with metadata) is a separate task and is not started. `CourseFile` is unchanged.

Branch: `feature/admin-catalog`, cut from `main` at `0aaa1c7` after PR #3. One integration fix for Member 5's uploads went on its own branch, `fix/admin-upload-auth`; see "Team integration". Neither branch is pushed.

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
- US-72: link `CourseFile` to `Term`, add a file type, and edit file metadata.
- Deleting catalog entries, if the team wants it, with a decision on what happens to a course's files and enrollments.
- US-95 (CI) still does not exist.
