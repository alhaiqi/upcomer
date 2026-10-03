# Upcomer Sprint 1 — Member 5 Implementation Report

## Scope

Implemented content ingestion from the Sprint 1 plan:

- US-70: Upload a previous exam
- US-71: Upload course materials

An upload stores the file under `FILE_STORAGE_ROOT` and creates a `CourseFile` row, so it appears on Member 3's exams or materials page and opens through `/files/:fileId` with no change to that code. Authentication, My Courses, course discovery, and catalog management are not part of this work.

## Architecture

The work follows the existing project structure: data access in `lib/`, pages in `app/`, and a form component in `components/`.

| Area | Files | Responsibility |
| --- | --- | --- |
| Upload service | `lib/uploads.ts` | Validate the file and form fields, check the course and professor exist, store the bytes, create the `CourseFile` record, and load the course list for the form |
| Upload rules | `lib/upload-rules.ts` | Size limit and accepted file types, shared by the server and the browser form |
| Endpoint | `app/api/admin/uploads/route.ts` | `POST` handler that turns the service's results into HTTP responses |
| Pages | `app/admin/uploads/page.tsx`, `app/admin/uploads/exams/page.tsx`, `app/admin/uploads/materials/page.tsx` | Upload menu and the two upload forms |
| UI | `components/upload-form.tsx` | One form used for both categories; shows progress, errors, and links to the uploaded file |
| Monitoring | `lib/logger.ts` | Six new event names (shared file) |
| Styling | `app/globals.css` | `.form`, `.form-error`, `.form-success` in the existing style (shared file) |

No database schema change was needed. The form is the project's first client component, because a file upload needs to report progress and errors without losing the selected fields. The two form pages are marked `force-dynamic` so the course list is read on each request.

## User stories and behavior

| Story | Route | Implemented behavior |
| --- | --- | --- |
| US-70 | `/admin/uploads/exams` | Choose a course, enter a title, pick a file, and optionally set professor, year, session, and topic. The exam is saved with category `EXAM` and is listed on `/courses/:courseId/exams` straight away. |
| US-71 | `/admin/uploads/materials` | Same form without the session field. The material is saved with category `MATERIAL` and is listed on `/courses/:courseId/materials`. |
| Both | `POST /api/admin/uploads` | `201` with the new file's ID and `/files/:fileId` link, or `{ reason, error }` with `400`, `404`, `413`, `415`, or `500`. |

Details that apply to both stories:

- **Accepted files:** PDF, DOCX, PPTX, PNG, and JPG, up to 20 MB. The type comes from the extension and is checked against the file's leading bytes. An empty file, a corrupt file, or a file renamed to another extension is refused. The MIME type sent by the browser is not trusted; the stored MIME type comes from the checked extension.
- **Storage:** the storage key is `exams/<uuid>.<ext>` or `materials/<uuid>.<ext>`, built by the server and resolved through Member 3's `resolveStoragePath`. The uploaded file name is never used as a path and is kept only as `originalFileName`. An existing file is never overwritten.
- **Consistency:** the course (and professor, if given) must exist before anything is written. If the record cannot be created after the file is stored, the file is deleted so no orphan is left.
- **Metadata:** professor, year, session, and topic are optional at upload time. Year must be four digits between 1950 and next year. Editing metadata afterwards is Member 4's US-72.
- **Form:** the professor list shows only the professors of the selected course. `?courseId=` preselects a course, so a catalog or course admin page can link straight to the form. With no courses, the page says to add a course first.

## Monitoring

Failures are logged with the existing `logError`:

- `upload_rejected` — the upload was refused; `reason` is one of `invalid_fields`, `invalid_form`, `empty_file`, `content_mismatch`, `unsupported_type`, `file_too_large`, `course_not_found`, `professor_not_found`
- `upload_storage_failed` — writing the file failed; includes the filesystem error code
- `upload_record_failed` — the file was stored but the database record could not be created
- `upload_cleanup_failed` — the stored file could not be removed after a record failure
- `upload_failed` — any other unexpected failure
- `upload_options_retrieval_failed` — loading the course list for the form failed

Logs include the course ID, category, and error type. File names, titles, file contents, and error messages are not logged.

## Tests and checks performed

| Test file | Tests | Covers |
| --- | --- | --- |
| `tests/unit/uploads.test.ts` | 41 | Accepted and refused file types, empty/oversized/corrupt files, form field validation, stored bytes and record fields, storage keys, unknown course or professor, storage failure, cleanup after a record failure, course options, failure logging |
| `tests/unit/upload-route.test.ts` | 8 | Status codes and response bodies, oversized and non-form requests, logging without file names or error messages |
| `tests/unit/upload-pages.test.tsx` | 7 | Upload menu, exam and material forms, preselected course, professor list per course, no-courses message, errors reaching the error page |
| `tests/e2e/admin-uploads.spec.ts` | 3 | Upload an exam and a material, see each on the right course and category only, open the stored file, refuse corrupt and unsupported files |

| Command/check | Result |
| --- | --- |
| `npm install` | Passed |
| `npm test` | Passed; 78 tests in 9 files (56 new, 22 existing) |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed; the three pages and the endpoint built |
| Requests against the built app with `curl` | Corrupt PDF `400`, `.exe` `415`, empty file `400`, missing title `400`, non-form body `400`; each wrote the expected log line. With the database unreachable, a valid PDF returned `500` and logged `upload_failed`, and nothing was left in the storage folder. |
| `npm run db:migrate` and `npm run db:seed` | Not run; no PostgreSQL server was available |
| `npm run test:e2e` | Not run; requires a migrated and seeded PostgreSQL database |

A successful upload against a real database has therefore not been observed yet. It is covered by unit tests with a mocked database and a real temporary storage folder, and by the Playwright test that still has to be run.

## Team integration

- **Member 1:** There is no authentication on this branch, so `/admin/uploads/*` and `POST /api/admin/uploads` are open to anyone. They must be restricted to admins once sessions exist; the endpoint is the place that matters, since the pages only call it. Cross-testing these uploads can use the Playwright test and the status codes above.
- **Member 3:** No change to the course pages or the file route. Uploaded files use `resolveStoragePath` and the same `FILE_STORAGE_ROOT`.
- **Member 4:** Courses and professors created through catalog management appear in the form automatically. An admin page can link to `/admin/uploads/exams?courseId=<id>` or `/admin/uploads/materials?courseId=<id>`. US-72 can edit the `professorId`, `year`, `session`, and `topic` of uploaded rows.
- **Member 2:** `lib/logger.ts` and `app/globals.css` are also changed on `feature/browse-courses-filter`. Both branches only append lines, so the merge keeps both sets.

## Remaining work

- Run `npm run db:migrate`, `npm run db:seed`, and `npm run test:e2e` against PostgreSQL.
- Add the admin check when authentication is merged.
- Cross-test Member 4's US-69 and US-72. Their implementation was not on `origin` when this was written, so that testing has not started.
