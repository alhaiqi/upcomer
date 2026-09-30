# Upcomer Sprint 1 — Member 3 Implementation Report

## Scope

Implemented the student course workspace from `member_3_codex_plan_self_contained.md`:

- US-08: Course home page
- US-09: Browse previous exams for one course
- US-10: Browse materials for one course
- US-12: Open an original file by file ID

This repository does not include authentication, course discovery/search, My Courses, admin screens, uploads, or later study tools. The root page is a placeholder until Member 2 adds course discovery.

## Architecture and packages

The application is one Next.js App Router project using TypeScript and Tailwind CSS. PostgreSQL is modeled through Prisma. Vitest, React Testing Library, and Playwright are configured for tests. Dependencies and commands are declared in `package.json`, with resolved versions in `package-lock.json`.

The main implementation is split into:

| Area | Files | Responsibility |
| --- | --- | --- |
| Database | `prisma/schema.prisma`, `prisma/migrations/20260930000000_init/migration.sql`, `lib/db.ts` | Shared models, initial PostgreSQL migration, Prisma client |
| Course service | `lib/courses.ts` | Load a course and query files by both course ID and category |
| File service | `lib/files.ts` | Find a file record, validate its storage key and physical path, read original bytes |
| Monitoring | `lib/logger.ts` | Structured JSON error events |
| Pages | `app/courses/[courseId]/...` | Course home, exams, and materials |
| File response | `app/files/[fileId]/route.ts` | Return the original file to the browser |
| UI | `components/course-header.tsx`, `components/resource-list.tsx` | Course details, resource cards, metadata, and file links |

## Environment and local data

`.env.example` defines:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection for Prisma |
| `FILE_STORAGE_ROOT` | Server-side folder containing stored files; defaults to `public/uploads` |

The Prisma schema defines `Faculty`, `Professor`, `Course`, `CourseProfessor`, and `CourseFile`. `CourseFile.category` is either `EXAM` or `MATERIAL`. The file model also stores the course, optional professor, title, original filename, storage key, optional year/session/topic, MIME type, size, and timestamps. An index supports course-and-category queries.

The initial migration creates the enum, tables, indexes, and foreign keys. `prisma/seed.ts` adds two faculties, three professors, three courses, two exams and one material for EECE350, one exam and one material for EECE330, and one material for MATH201. It also adds a record pointing to a deliberately missing file for failure testing. Six small PDF fixtures are committed under `public/uploads`; `scripts/create-fixtures.mjs` can regenerate them.

## User stories and routes

| Story | Route | Implemented behavior |
| --- | --- | --- |
| US-08 | `/courses/:courseId` | Shows course code, name, faculty, professors, and links to its exams and materials. Unknown course IDs render a 404. |
| US-09 | `/courses/:courseId/exams` | Shows only `EXAM` records whose `courseId` matches the route. Shows present metadata and an empty state when there are no exams. |
| US-10 | `/courses/:courseId/materials` | Shows only matching `MATERIAL` records. Shows present metadata and an empty state when there are no materials. |
| US-12 | `/files/:fileId` | Looks up a file ID, resolves its stored key within the configured storage root, and returns its original bytes. PDFs open inline; other MIME types download. Missing records/files and unsafe keys return a controlled 404. |

The browser links to `/files/:fileId`; it does not send a filesystem path. The file service rejects absolute paths, traversal components, backslashes, and physical links that resolve outside the upload root. The response sets the MIME type, content disposition, length, and `X-Content-Type-Options: nosniff`.

Unexpected page errors use `app/error.tsx` to show a generic message rather than a stack trace. Resource pages link back to the course home page.

## Monitoring

`lib/logger.ts` emits JSON with an event name, timestamp, and relevant course/file context. The implementation logs:

- `course_retrieval_failed`
- `exam_list_retrieval_failed`
- `material_list_retrieval_failed`
- `file_record_not_found`
- `physical_file_not_found`
- `invalid_storage_key`
- `file_open_failed`

File contents, credentials, and database secrets are not included in these log records.

## Tests and checks performed

Unit and component tests cover course lookup, course/category query isolation, course page links and details, resource lists and empty states, unsafe storage keys, missing file records, missing physical files, and valid file response bytes and headers. The suite passed: **22 tests in 6 files**.

The Playwright test in `tests/e2e/course-workspace.spec.ts` covers the seeded EECE350 exam and material pages, absence of EECE330 content, and successful original-file HTTP responses. It is written but has **not run**, because this environment has no reachable PostgreSQL server.

| Command/check | Result |
| --- | --- |
| `npm install` | Passed; Prisma client generated |
| `npm test` | Passed; 22 tests |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npx prisma validate` with a sample `DATABASE_URL` | Passed |
| `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` | Passed; generated schema reviewed against the migration |
| `npm run build` | Passed; all intended routes built |
| `npm run db:migrate` and `npm run db:seed` | Not run against a live database |
| `npm run test:e2e` | Not run; requires a migrated and seeded PostgreSQL database |

## Team integration

- **Member 2:** Reuse the course, faculty, and professor models. Catalog results should link a `Course.id` to `/courses/:courseId`. Member 2's US-05/US-06 implementation was not available for the planned independent cross-test.
- **Member 4:** Manage the existing catalog and `CourseFile` metadata models. No admin interface is included here.
- **Member 5:** Store uploaded files under `FILE_STORAGE_ROOT` and create `CourseFile` rows with a course ID, category, title, original filename, and relative storage key. New rows appear automatically on the matching course resource page. No upload interface is included here.

## Remaining verification

A PostgreSQL server is needed to apply the migration, run the seed, and execute the Playwright journey. The application code and migration have passed static checks and a production build, but those checks do not replace a live database run.
