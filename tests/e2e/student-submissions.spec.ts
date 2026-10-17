import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { configureLogger } from "@/lib/logger";
import { rebuildQuestionBank } from "@/lib/question-bank";
import * as review from "@/lib/submissions";
import "./fixtures";

const expect = baseExpect.configure({ timeout: 15_000 });

// US-13. The spec makes two students and one throwaway course, and deletes them at the end with every file the students
// submitted and its stored copy. It looks things up by stamped titles, never by counts.
const stamp = String(Date.now()).slice(-8);
const password = "password123";
const students = {
  a: { id: `qa-sub-a-${stamp}`, email: `qa-sub-a-${stamp}@mail.aub.edu`, name: "Submitting Student" },
  b: { id: `qa-sub-b-${stamp}`, email: `qa-sub-b-${stamp}@mail.aub.edu`, name: "Other Student" },
};
const titles = {
  pending: `Submitted Exam ${stamp}`, published: `Submitted Material ${stamp}`, refused: `Refused Submission ${stamp}`, extra: `Extra Exam ${stamp}`,
};
const reason = `Blurry scan, please resubmit ${stamp}`;
const fixture = "public/uploads/eece350-final-2025.pdf";
// The throwaway course for the question pipeline: one published exam, and later one pending one.
const courseId = `qa-sub-course-${stamp}`;
const PENDING_ONLY = `Which question only the pending paper has ${stamp}?`;

const db = new PrismaClient();

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  // Calling the review functions here must not add rows to the shared log table.
  configureLogger({ persist: false });
  const passwordHash = await bcrypt.hash(password, 10);
  await db.user.createMany({ data: Object.values(students).map(student => ({ ...student, passwordHash })) });
  await db.course.create({ data: { id: courseId, code: `US${stamp}`, name: `Submission Course ${stamp}`, facultyId: "faculty-eng" } });
  await db.courseFile.create({ data: {
    id: `${courseId}-published`, courseId, title: `Published Exam ${stamp}`, category: "EXAM", year: 2024,
    originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
  } });
  await db.question.create({ data: { fileId: `${courseId}-published`, number: 1, text: "Define a socket." } });
  expect(await rebuildQuestionBank(courseId)).toMatchObject({ ok: true });
});
test.afterAll(async () => {
  try {
    const userIds = Object.values(students).map(student => student.id);
    const submitted = await db.courseFile.findMany({ where: { submittedById: { in: userIds } }, select: { id: true, storageKey: true } });
    const root = path.resolve(process.env.FILE_STORAGE_ROOT || "public/uploads");
    for (const { storageKey } of submitted) {
      // Only ever delete upload copies, never the committed fixtures next to them.
      const file = path.resolve(root, storageKey);
      if (!/^(exams|materials)\/[^/\\]+$/.test(storageKey) || !file.startsWith(root + path.sep)) continue;
      await unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
    await db.$transaction([
      db.courseFile.deleteMany({ where: { id: { in: submitted.map(file => file.id) } } }),
      db.course.deleteMany({ where: { id: courseId } }),
      db.session.deleteMany({ where: { userId: { in: userIds } } }),
      db.userCourse.deleteMany({ where: { userId: { in: userIds } } }),
      db.user.deleteMany({ where: { id: { in: userIds } } }),
    ]);
  } finally {
    await db.$disconnect();
  }
});

async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/my-courses$/);
}

async function submit(page: Page, { title, courseId: course = "course-eece350", material = false, file = fixture as string | { name: string; mimeType: string; buffer: Buffer } }: {
  title: string; courseId?: string; material?: boolean; file?: string | { name: string; mimeType: string; buffer: Buffer };
}) {
  await page.goto("/submit");
  if (material) await page.getByLabel("Course material").check();
  await page.locator('select[name="courseId"]').selectOption(course);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("File").setInputFiles(file);
  await page.getByRole("button", { name: "Submit for review" }).click();
}

const card = (page: Page, title: string) => page.locator("article").filter({ hasText: title });
async function fileIdOf(page: Page, title: string) {
  const href = await card(page, title).getByRole("link", { name: "Open Original File" }).getAttribute("href");
  return decodeURIComponent(href!.replace("/files/", ""));
}
// The status a file link gives. A logged-in check fetches from inside the page: the session cookie is Secure under`n// `next start`, which the browser sends to 127.0.0.1 but Playwright's own request context does not.
const opens = async (request: APIRequestContext, fileId: string) => (await request.get(`/files/${encodeURIComponent(fileId)}`)).status();
const opensFor = (page: Page, fileId: string) => page.evaluate(async url => (await fetch(url)).status, `/files/${encodeURIComponent(fileId)}`);

test("a submitted PDF waits for review and is hidden from other students and visitors (acceptance test 1)", async ({ page, browser, request }) => {
  await logIn(page, students.a.email);
  await page.getByRole("link", { name: "Submit an exam or material" }).click();
  await expect(page.getByRole("heading", { name: "Submit an Exam or Material" })).toBeVisible();
  // The professor list follows the chosen course.
  await page.locator('select[name="courseId"]').selectOption("course-eece350");
  await page.getByLabel("Professor (optional)").selectOption({ label: "Professor A" });
  await page.getByLabel("Year (optional)").fill("2025");
  await page.getByLabel("Term (optional)").selectOption({ label: "Fall" });
  await page.getByLabel("Type (optional)").selectOption({ label: "Final" });
  await page.getByLabel("Title").fill(titles.pending);
  await page.getByLabel("File").setInputFiles(fixture);
  await page.getByRole("button", { name: "Submit for review" }).click();

  await expect(page).toHaveURL(/\/my-submissions\?submitted=1$/);
  await expect(page.getByRole("status")).toContainText("Submitted for review.");
  await expect(card(page, titles.pending)).toContainText("Pending review");
  await expect(card(page, titles.pending)).toContainText("EECE350");
  const fileId = await fileIdOf(page, titles.pending);
  expect(await db.courseFile.findUniqueOrThrow({ where: { id: fileId } })).toMatchObject({ status: "PENDING", submittedById: students.a.id, termId: "term-fall", examType: "FINAL", year: 2025 });

  // The submitter can open it, but it is on no course page, not even theirs.
  expect(await opensFor(page, fileId)).toBe(200);
  await page.goto("/courses/course-eece350/exams");
  await expect(page.getByRole("heading", { name: "Previous Exams" })).toBeVisible();
  await expect(page.getByText(titles.pending)).toHaveCount(0);

  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await logIn(otherPage, students.b.email);
    await otherPage.goto("/courses/course-eece350/exams");
    await expect(otherPage.getByRole("heading", { name: "Previous Exams" })).toBeVisible();
    await expect(otherPage.getByText(titles.pending)).toHaveCount(0);
    await otherPage.goto("/my-submissions");
    await expect(otherPage.getByText(titles.pending)).toHaveCount(0);
    expect(await opensFor(otherPage, fileId)).toBe(404);
    await otherPage.goto(`/files/${encodeURIComponent(fileId)}`);
    await expect(otherPage.getByRole("heading", { name: "File unavailable" })).toBeVisible();
  } finally {
    await other.close();
  }

  // The request fixture has its own cookie jar, so it is a visitor.
  expect(await opens(request, fileId)).toBe(404);
  const visitor = await (await request.get("/courses/course-eece350/exams")).text();
  expect(visitor).not.toContain(titles.pending);
});

test("the student sees a rejection with its reason, and a published file reaches everyone (acceptance test 2)", async ({ page, browser }) => {
  await logIn(page, students.a.email);
  await page.goto("/my-submissions");
  const pendingId = await fileIdOf(page, titles.pending);
  expect(await review.rejectSubmission(pendingId, `  ${reason}  `)).toMatchObject({ ok: true });
  // Reviewed once is final.
  expect(await review.publishSubmission(pendingId)).toEqual({ ok: false, error: "not_pending" });
  await page.reload();
  await expect(card(page, titles.pending)).toContainText("Rejected");
  await expect(card(page, titles.pending)).toContainText(`Reason: ${reason}`);

  await submit(page, { title: titles.published, courseId: "course-eece330", material: true });
  await expect(page).toHaveURL(/\/my-submissions\?submitted=1$/);
  const publishedId = await fileIdOf(page, titles.published);
  const pendingQueue = (await review.listPendingSubmissions()).map(file => file.id);
  expect(pendingQueue).toContain(publishedId);
  expect(pendingQueue).not.toContain(pendingId);
  expect(await review.publishSubmission(publishedId)).toMatchObject({ ok: true, courseId: "course-eece330" });
  await page.reload();
  await expect(card(page, titles.published)).toContainText("Published");
  await expect(card(page, titles.published)).not.toContainText("Reason:");

  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await logIn(otherPage, students.b.email);
    await otherPage.goto("/courses/course-eece330/materials");
    await expect(otherPage.getByText(titles.published)).toBeVisible();
    expect(await opensFor(otherPage, publishedId)).toBe(200);
    // The rejected one stays hidden.
    expect(await opensFor(otherPage, pendingId)).toBe(404);
  } finally {
    await other.close();
  }
});

test("a non-PDF or empty file is refused with a reason (acceptance test 3)", async ({ page }) => {
  await logIn(page, students.a.email);
  const docx = { name: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]) };
  await submit(page, { title: titles.refused, file: docx });
  await expect(page).toHaveURL(/\/submit\?error=unsupported_type&courseId=course-eece350&category=EXAM$/);
  await expect(page.locator("p.notice.error")).toHaveText("Only PDF files can be submitted.");
  // The course stays chosen after the refusal.
  await expect(page.locator('select[name="courseId"]')).toHaveValue("course-eece350");

  await submit(page, { title: titles.refused, file: { name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) } });
  await expect(page.locator("p.notice.error")).toHaveText("The selected file is empty.");

  await submit(page, { title: titles.refused, file: { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") } });
  await expect(page.locator("p.notice.error")).toHaveText("The file is corrupt or is not a real PDF.");

  expect(await db.courseFile.count({ where: { title: titles.refused } })).toBe(0);
  await page.goto("/my-submissions");
  await expect(page.getByText(titles.refused)).toHaveCount(0);
});

test("a pending exam never changes the paper count, the exam page, or the question bank", async ({ page }) => {
  await page.goto(`/courses/${courseId}/exam`);
  await expect(page.locator("li[data-tier]")).toHaveCount(1);
  await expect(page.locator("li[data-tier]").first()).toContainText("Appeared in 1 of 1 paper");

  await logIn(page, students.a.email);
  await submit(page, { title: titles.extra, courseId });
  await expect(page).toHaveURL(/\/my-submissions\?submitted=1$/);
  const pendingId = await fileIdOf(page, titles.extra);
  // As if extraction had run on the pending paper: the same question as the published paper, and one of its own.
  await db.question.createMany({ data: [{ fileId: pendingId, number: 1, text: "Define a socket." }, { fileId: pendingId, number: 2, text: PENDING_ONLY }] });
  expect(await rebuildQuestionBank(courseId)).toMatchObject({ ok: true, questionCount: 1 });

  await page.goto(`/courses/${courseId}/exam`);
  await expect(page.locator("li[data-tier]")).toHaveCount(1);
  await expect(page.locator("li[data-tier]").first()).toContainText("Appeared in 1 of 1 paper");
  await expect(page.getByText(PENDING_ONLY)).toHaveCount(0);
  await page.goto(`/courses/${courseId}/questions`);
  await expect(page.getByText("Define a socket.").first()).toBeVisible();
  await expect(page.getByText(PENDING_ONLY)).toHaveCount(0);
  await expect(page.getByText("Appeared in 2 papers")).toHaveCount(0);
});
