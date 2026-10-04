# Cross-Test Report — Member 5's Admin Uploads (US-70, US-71)

**Tester:** Member 1 · **Branch tested:** `feature/admin-uploads` at `4f2a1a0` · **Date:** 2026-10-04

Per the Sprint 1 cross-testing rule, Member 5 did not test these features themselves. This is the independent run.

## Verdict

**US-70 and US-71 work.** 19 of 20 functional checks pass, plus every check in Member 5's own test plan. Two defects were found, both small, plus two integration steps that must happen at merge time. Nothing blocks the stories.

Their report declared that `db:migrate`, `db:seed`, and the e2e tests had never been run, so a successful upload against a real database had never been observed. **It has now.** A PostgreSQL 18.4 server was run as a plain user process (no Docker, no service — see the setup note in `MEMBER_1_IMPLEMENTATION_REPORT.md`), on its own `upcomer_m5` database.

| Suite | Result |
| --- | --- |
| `npm test` (their branch, as pushed) | 78/78 pass, 9 files |
| `npm run db:migrate`, `npm run db:seed` | Applied and seeded, first ever run |
| `npm run test:e2e` (their branch, first ever run) | **3 pass, 1 fail** — see defect 1 |
| My own API matrix, 20 checks | **19 pass, 1 fail** — see defect 2 |
| After merging my auth, 6 access checks | 6/6 pass |
| Merged branch overall | 231/231 unit, 15/15 e2e |

## Defects

### 1. Their e2e test locator matches Next's route announcer (test bug, not a product bug)

`tests/e2e/admin-uploads.spec.ts:54` uses `page.getByRole("alert")`. Next renders `<div role="alert" id="__next-route-announcer__">` on every page, so the locator resolves to two elements and Playwright's strict mode fails:

```
strict mode violation: getByRole('alert') resolved to 2 elements:
  1) <p role="alert" class="form-error">The file is corrupt or is not a real .pdf file.</p>
  2) <div role="alert" aria-live="assertive" id="__next-route-announcer__"></div>
```

The product is correct — the right message is rendered. Only the test is wrong, and it fails deterministically, which is why it was never seen: the suite had not been run.

**Fix (verified):** `page.locator(".form-error")` in all three places.

### 2. An unknown professor returns 400, but the test plan says 404

`lib/uploads.ts` throws `professor_not_found` mapped to **400**. The Sprint 1 cross-testing plan says "an unknown course or professor returns 404." An unknown course correctly returns 404.

```
POST /api/admin/uploads  professorId=prof-does-not-exist
  expected: 404
  actual:   400 professor_not_found
```

Arguably 400 is defensible, since the professor comes from a dropdown and a stale option is a bad field rather than a missing resource. But it contradicts the written plan, so **Member 5 and Member 4 should pick one** and make the test plan and the code agree. One line in `STATUS` either way.

### 3. Non-blocking: their first e2e test is marginal on a cold dev server

`admin-uploads.spec.ts:9` asserts `toHaveURL` within Playwright's default 5s after clicking "View course exams". On a cold `next dev`, that route is being compiled for the first time and the assertion times out; it passed on every warm run and on a cold run of that file alone. Not a product defect, but it will flake in CI. **Recommendation for US-95:** run the e2e suite against `next build && next start`, or raise `expect.timeout` in `playwright.config.ts`.

## What passed

### Accepted types (US-70, US-71)

Each type uploaded to `course-eece350` as an `EXAM`, then opened through `/files/:id` and compared byte for byte with the original.

| Type | Status | Stored mime type | `/files/:id` | Bytes identical | Leaked to another course or category |
| --- | --- | --- | --- | --- | --- |
| PDF | 201 | `application/pdf` | 200 | yes | no |
| DOCX | 201 | `…wordprocessingml.document` | 200 | yes | no |
| PPTX | 201 | `…presentationml.presentation` | 200 | yes | no |
| PNG | 201 | `image/png` | 200 | yes | no |
| JPG | 201 | `image/jpeg` | 200 | yes | no |

A material uploaded to `course-eece330` was stored as `MATERIAL` with a storage key under `materials/`, and appeared under materials only.

### Rejected files

| Case | Expected | Actual | Nothing stored | No database row |
| --- | --- | --- | --- | --- |
| Empty file | 400 `empty_file` | 400 `empty_file` | yes | yes |
| `.txt` renamed to `.pdf` | 400 `content_mismatch` | 400 `content_mismatch` | yes | yes |
| `.exe` | 415 `unsupported_type` | 415 `unsupported_type` | yes | yes |
| 21 MB file | 413 `file_too_large` | 413 `file_too_large` | yes | yes |

Field validation also refuses a missing title, a missing course, a category that is neither `EXAM` nor `MATERIAL`, and a year outside 1950–2027, each with 400 `invalid_fields`.

### Bad references

An unknown course gives 404 `course_not_found`. An unknown professor gives 400 — defect 2.

### Storage failure

`FILE_STORAGE_ROOT` was pointed at a folder with an explicit Windows deny-write ACE, and the server was run unprivileged so the deny applied:

```
status: 500 {"reason":"storage_failed","error":"The file could not be stored. Please try again."}
{"event":"upload_storage_failed","courseId":"course-eece350","resourceCategory":"EXAM","errorType":"Error","errorCode":"EPERM"}
```

Nothing was written to the folder and no `CourseFile` row was created. Exactly the expected behavior.

### Consistency when the database write fails

`CourseFile` was renamed out from under the running server, so the insert failed after the file had already been written:

```
status: 500 record_failed
files in storage: unchanged (delta 0)
{"event":"upload_record_failed","courseId":"course-eece350","resourceCategory":"EXAM","errorType":"PrismaClientKnownRequestError"}
```

The cleanup `unlink` worked, so **no orphan file was left**, and `upload_cleanup_failed` was correctly not logged. Two uploads of the same file also get different `randomUUID()` storage keys, so neither can overwrite the other.

### Metadata and logs

`professorId`, `year`, `session`, and `sizeBytes` are stored as sent. Every failure wrote exactly one JSON line, with `courseId`, `resourceCategory`, `reason`, `errorType`, and `errorCode` only:

```
{"event":"upload_rejected","courseId":"course-eece350","resourceCategory":"EXAM","reason":"content_mismatch"}
{"event":"upload_rejected","reason":"file_too_large"}
{"event":"upload_record_failed","courseId":"course-eece350","resourceCategory":"EXAM","errorType":"PrismaClientKnownRequestError"}
{"event":"upload_storage_failed","courseId":"course-eece350","resourceCategory":"EXAM","errorType":"Error","errorCode":"EPERM"}
```

**No file name, title, or error message text appears in any log line.** Checked by scanning every logged line for the fixture names and the uploaded titles; zero matches.

## Access control after my auth is merged

On `feature/admin-uploads` as pushed, `POST /api/admin/uploads` accepts an upload from anyone with no session at all — 201. Member 5's report declares this gap, so it is expected, not a surprise. I verified the fix rather than only describing it, on a local branch `integration/auth-uploads-spike` (**not pushed**).

| Check | Result |
| --- | --- |
| Upload with no session | **403** `forbidden` |
| Upload as a `STUDENT` | **403** `forbidden` |
| Upload as an `ADMIN` | **201** created |
| Upload with a forged session cookie | **403** `forbidden` |
| Upload with an expired admin session | **403** `forbidden` |
| `GET /admin/uploads` with no session | **307** to `/login?next=%2Fadmin%2Fuploads` |

Each refusal logged `unauthorized_access` with the route and the role, and nothing else:

```
{"event":"unauthorized_access","route":"POST /api/admin/uploads","role":"anonymous"}
{"event":"unauthorized_access","route":"POST /api/admin/uploads","role":"STUDENT","userId":"cmut0xrud0000ud64a97v2osc"}
```

That is 21 lines of change in four files, all verified:

```diff
# app/api/admin/uploads/route.ts  — the guard itself
+import { getAdminUser } from "@/lib/auth";
 export async function POST(request: Request) {
+  if (!(await getAdminUser("POST /api/admin/uploads"))) return failure("forbidden", "Only an admin can upload files.", 403);

# tests/unit/upload-route.test.ts — without this, 8 of their tests fail with
# "`cookies` was called outside a request scope"
-const { saveUpload } = vi.hoisted(() => ({ saveUpload: vi.fn() }));
+const { saveUpload, getAdminUser } = vi.hoisted(() => ({ saveUpload: vi.fn(), getAdminUser: vi.fn() }));
+vi.mock("@/lib/auth", () => ({ getAdminUser }));
 beforeEach(() => {
+  getAdminUser.mockReset().mockResolvedValue({ id: "admin-1", role: "ADMIN" });

# tests/e2e/fixtures.ts (new) — logs in as the ADMIN_EMAIL/ADMIN_PASSWORD admin
# tests/e2e/admin-uploads.spec.ts — without this, all 3 of their e2e tests fail
+import { logInAsAdmin } from "./fixtures";
+test.beforeEach(async ({ page }) => logInAsAdmin(page));
```

The admin pages themselves (`/admin/uploads/*`) are only shielded by the redirect in `middleware.ts` on this spike. Adding `await requireAdmin("/admin/uploads")` to the three page components is still worth doing, so a logged-in student gets a 404 instead of a form that will fail; the API is what actually protects the data, and it does.

## Merge notes for Member 4

Merging `feature/auth-my-courses` into `feature/admin-uploads` conflicts in exactly three files, all of them append-only except the third:

| File | Conflict | Resolution |
| --- | --- | --- |
| `lib/logger.ts` | Both branches extend the `LogEvent` union, and Member 5's branch predates Member 2's merge | Union all event names, one trailing semicolon |
| `README.md` | Both add sections | Keep both |
| `app/globals.css` | **Not a clean union.** Both branches define `.form`, with different rules | See below |

The `.form` collision is real, not textual: Member 5's `.form` styles the upload form with `.form label`, mine styles the auth forms with `.field` and adds `max-width: 26rem`, which would narrow their upload form. `.form .button` also differs (`justify-self: start; margin-top: 0` against `margin-top: .25rem`). In the spike I dropped my `max-width` rule, which is enough, but **the clean fix is for one of us to namespace the class** — `.auth-form` on my side is the smaller change. Member 2's `.search` and `.pagination` do not collide with anything.

Because Member 5's branch was cut before PR #1, merging into it also brings in all of Member 2's catalog work, which widens the conflict surface. Rebasing `feature/admin-uploads` onto current `main` first would make that merge much smaller.

## Reproducing this

The fixtures used are nine small files generated by a script: a valid PDF, DOCX, PPTX, PNG, and JPG header; a zero-byte file; a text file named `.pdf`; an `MZ` executable named `.exe`; and a 21 MB PDF. The runner posts multipart form data straight at `/api/admin/uploads` with `fetch`, then verifies the row with Prisma, the bytes through `/files/:id`, and the storage folder contents. Both the generator and the two runners are in my scratch folder and can be committed to `tests/` if the team wants them kept — say so and I will add them under `tests/integration/`.
