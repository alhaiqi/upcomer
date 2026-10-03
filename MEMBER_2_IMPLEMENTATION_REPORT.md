# Upcomer Sprint 1 — Member 2 Implementation Report

## Scope

Implemented course discovery from the Sprint 1 plan:

- US-05: Browse available courses
- US-06: Search and filter courses

The catalog replaces the placeholder home page and links each course to Member 3's course workspace (`/courses/:courseId`). Authentication, My Courses, admin screens, and uploads are not part of this work. Course codes, faculties, and professors come from the shared models, so courses added through Member 4's catalog management appear automatically.

## Architecture

The work follows the existing project structure: data access in `lib/`, a server-rendered page in `app/`, and a list component in `components/`.

| Area | Files | Responsibility |
| --- | --- | --- |
| Catalog service | `lib/catalog.ts` | Load courses with faculty and professors, apply search and filters, rank exact code matches first, paginate, and load the filter options |
| Page | `app/page.tsx` | Course catalog at `/` with a search form, faculty and professor dropdowns, empty and unknown-filter messages, and Previous/Next links |
| UI | `components/course-list.tsx` | Course cards with code, name, faculty, professors, and an "Open Course" link; empty state |
| Monitoring | `lib/logger.ts` | Three new event names (shared file) |
| Styling | `app/globals.css` | `.search` and `.pagination` classes in the existing style (shared file) |

No database schema change was needed. The search form uses a plain `GET` request, so the page stays a server component with no client-side JavaScript. The page is marked `force-dynamic` so the catalog is read on each request instead of being fixed at build time.

## User stories and behavior

| Story | Jira acceptance test | Implemented behavior |
| --- | --- | --- |
| US-05 | Every course shows its code and name | Each card shows code, name, faculty, and professors, ordered by code. |
| US-05 | More courses than fit on one page are paged without skipping any | 20 courses per page with Previous/Next and "Page X of Y". Courses are ordered by their unique code, so every course appears exactly once across pages. Invalid or out-of-range pages fall back to the first or last page. |
| US-05 | No courses shows an empty-state message | "No courses are available yet." |
| US-06 | A course code search puts that course first; partial and case-insensitive matches work | `q` matches code or name, ignoring case. Codes also match with spaces removed, so `eece 350` finds `EECE350` whether codes are stored with or without spaces. An exact code match comes first, then codes starting with the search, then the rest. |
| US-06 | Faculty and professor filters show only matching courses and combine with the search | `facultyId` and `professorId` dropdowns combine with `q`. The professor filter matches through the `CourseProfessor` join table. Chosen values stay selected and are kept in the page links. |
| US-06 | A search with no match shows "no courses found" | "No courses found." for any search or filter with no result. An ID that no longer exists (for example from an old link) also shows "The selected faculty/professor doesn't exist." |

## Monitoring

`lib/catalog.ts` logs failures with the existing `logError` and then rethrows, so the visitor sees the generic error page:

- `course_catalog_retrieval_failed` — loading the full catalog failed
- `course_search_failed` — a search or filtered query failed; includes `facultyId` and `professorId`, never the search text
- `catalog_filter_options_retrieval_failed` — loading the faculty or professor lists failed

Only `errorType` and IDs are logged, matching the existing convention.

## Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/catalog.test.ts` | 31 | Catalog query, search and filter conditions, ranking, pagination, filter options, failure logging |
| `tests/unit/catalog-page.test.tsx` | 19 | Course list, empty and no-results messages, search box, dropdowns, kept selections, page links, unknown filter IDs, errors reaching the error page |
| `tests/unit/course-list.test.tsx` | 3 | Empty state, card contents and link, courses without professors |
| `tests/e2e/course-discovery.spec.ts` | 3 | Browse, search, filter, open a course; no-match message; unknown faculty link |

| Command/check | Result |
| --- | --- |
| `npm install` | Passed; `npm audit` reports 12 vulnerabilities (3 moderate, 9 high) in dependencies, not changed here |
| `npm run db:migrate` and `npm run db:seed` | Passed against PostgreSQL 17; the seed ran twice without errors |
| `npm test` | Passed; 75 tests in 9 files (53 new, 22 existing) |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed; `/` is built as a dynamic route |
| `npm run test:e2e` | Passed; 4 tests (3 new, plus the existing `course-workspace.spec.ts`), run in Microsoft Edge because the Chromium download timed out on this machine |
| Pagination in the browser | Checked with 42 temporary courses added to the local database (3 pages), then removed |
| Database failure | With the database unreachable, a production build returned the generic error page with no database details, and the three events were logged without the search text |

## Handoff

### For Member 3 (cross-tester of US-05 and US-06)

Setup: `npm install`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`, then open `http://localhost:3000/`.

- **Browse:** all 3 seeded courses show code, name, faculty, and professor; "Open Course" opens the course page.
- **Search by code or name:** `eece 350`, `EECE350`, `350`, `net`, `CALCULUS` (case and spaces don't matter; an exact code match comes first).
- **Filters:** Faculty of Engineering gives 2 courses; Professor C gives MATH201.
- **Combined:** `eece` with Professor B gives EECE330; `data` with Engineering and Professor B gives EECE330.
- **Empty results:** `zzz`, or `eece` with Arts and Sciences, shows "No courses found."
- **Edge cases:** `/?page=abc`, `/?page=99`, `/?facultyId=unknown`, `/?professorId=unknown`.
- **Paging** needs more than 20 courses; the unit tests cover it with 45.

Your `tests/e2e/course-workspace.spec.ts` ran for the first time against a real database and passed.

### For Member 4 (Integration Lead)

- Shared files changed: `lib/logger.ts` (three new events), `app/globals.css` (`.search`, `.pagination`), and `app/page.tsx` (placeholder replaced by the catalog).
- `README.md`: added the `/` route and a "Course discovery (Member 2)" section. Two existing sentences still describe the home page as a placeholder ("Authentication, discovery, …" and "The home route is only a placeholder …") and should be updated by their author.
- Search works whether course codes are stored with or without spaces.
- `npm audit` reports 12 dependency vulnerabilities; not addressed on this branch.
- If Playwright's Chromium cannot be downloaded, the e2e tests can run with an installed Edge (`channel: "msedge"`).

## Remaining work

- Independent cross-testing of US-05 and US-06 by Member 3.
- Code review and merge, coordinated by Member 4.
- Member 2's own cross-testing of Member 1's features (US-01, US-02, US-07), once they are available.
