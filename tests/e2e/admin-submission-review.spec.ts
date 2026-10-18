import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { logInAsAdmin } from "./fixtures";

const expect = baseExpect.configure({ timeout: 15_000 });

// US-74, the admin side of US-13. One submission goes through the real /submit form; the others are inserted as PENDING
// records pointing at a committed fixture, so the queue order can be set. Everything is in a throwaway course and is
// deleted afterwards, with the stored copy of the submitted file.
const stamp = String(Date.now()).slice(-8);
const password = "review-pass-123";
const student = { id: `qa-review-student-${stamp}`, email: `review-student-${stamp}@mail.aub.edu`, name: "Review Student" };
const otherStudent = { id: `qa-review-other-${stamp}`, email: `review-other-${stamp}@mail.aub.edu`, name: "Other Student" };
const courseId = `qa-review-course-${stamp}`;
const courseCode = `RV${stamp}`;
// A reason that looks like HTML must reach the student as plain text.
const htmlReason = `<img src=x onerror="alert(1)"> Wrong course <b>${stamp}</b>`;
const pipelineQuestion = `Explain how the review pipeline handles paper ${stamp}.`;
const minute = 60_000;
const base = Date.now() - 60 * minute;
const files = {
  oldest: { id: `qa-review-oldest-${stamp}`, title: `Oldest Exam ${stamp}`, category: "EXAM" as const, createdAt: new Date(base) },
  middle: { id: `qa-review-middle-${stamp}`, title: `Middle Notes ${stamp}`, category: "MATERIAL" as const, createdAt: new Date(base + minute) },
  html: { id: `qa-review-html-${stamp}`, title: `Html Reason Exam ${stamp}`, category: "EXAM" as const, createdAt: new Date(base + 2 * minute) },
  race: { id: `qa-review-race-${stamp}`, title: `Race Exam ${stamp}`, category: "EXAM" as const, createdAt: new Date(base + 3 * minute) },
};
const submittedTitle = `Form Submission ${stamp}`;

const db = new PrismaClient();
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(password, 10);
  await db.user.createMany({ data: [student, otherStudent].map(user => ({ ...user, passwordHash })) });
  await db.course.create({ data: { id: courseId, code: courseCode, name: `Review Course ${stamp}`, facultyId: "faculty-eng" } });
  for (const file of Object.values(files)) {
    await db.courseFile.create({
      data: {
        ...file, courseId, status: "PENDING", submittedById: student.id, year: 2025,
        originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
      },
    });
  }
  // The oldest exam's extracted questions (US-14), so publishing it shows them in the question bank.
  await db.question.create({ data: { fileId: files.oldest.id, number: 1, text: pipelineQuestion } });
});
test.afterAll(async () => {
  try {
    const submitted = await db.courseFile.findMany({ where: { submittedById: student.id, storageKey: { not: "eece350-final-2025.pdf" } }, select: { storageKey: true } });
    const root = path.resolve(process.env.FILE_STORAGE_ROOT || "public/uploads");
    for (const { storageKey } of submitted) {
      // Only ever delete upload copies, never the committed fixtures next to them.
      const file = path.resolve(root, storageKey);
      if (/^(exams|materials)\/[^/\\]+$/.test(storageKey) && file.startsWith(root + path.sep)) await unlink(file).catch(() => undefined);
    }
    // Deleting the course deletes its files, questions, and question groups.
    await db.course.deleteMany({ where: { id: courseId } });
    await db.session.deleteMany({ where: { userId: { in: [student.id, otherStudent.id] } } });
    await db.user.deleteMany({ where: { id: { in: [student.id, otherStudent.id] } } });
  } finally {
    await db.$disconnect();
  }
});

const queueItem = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const submissionCard = (page: Page, title: string) => page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
// Fetched from inside the page, as the browser would: the session cookie is Secure under `next start`, and Playwright's
// separate request client does not send Secure cookies over http, even to 127.0.0.1.
const fileStatus = (page: Page, fileId: string) => page.evaluate(async url => (await fetch(url)).status, `/files/${fileId}`);

async function logInAsStudent(page: Page, user = student) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/my-courses$/);
}

test("the queue lists pending submissions oldest first, including one made through the submit form", async ({ page }) => {
  await logInAsStudent(page);
  await page.goto("/submit");
  await page.locator('select[name="courseId"]').selectOption(courseId);
  await page.getByLabel("Title").fill(submittedTitle);
  await page.getByLabel("File").setInputFiles("public/uploads/eece350-final-2025.pdf");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page).toHaveURL(/\/my-submissions\?submitted=1$/);

  await page.context().clearCookies();
  await logInAsAdmin(page);
  await page.getByRole("link", { name: "Review", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/submissions$/);
  await expect(page.getByRole("heading", { name: "Review Submissions" })).toBeVisible();
  const titles = await page.getByRole("list", { name: "Pending submissions" }).getByRole("heading").allTextContents();
  expect(titles.filter(title => title.endsWith(stamp))).toEqual([files.oldest.title, files.middle.title, files.html.title, files.race.title, submittedTitle]);
  await expect(queueItem(page, submittedTitle)).toContainText(`Submitted by ${student.name}`);
});

test("publishing an exam puts it on the course page and its questions in the question bank", async ({ page }) => {
  await page.goto(`/courses/${courseId}/exams`);
  await expect(page.getByRole("heading", { name: files.oldest.title })).toHaveCount(0);

  await logInAsAdmin(page);
  await page.goto("/admin/submissions");
  await queueItem(page, files.oldest.title).getByRole("button", { name: `Publish ${files.oldest.title}` }).click();
  await expect(page).toHaveURL(/\/admin\/submissions\?published=1$/);
  await expect(page.getByText("Published. The file is on its course page now")).toBeVisible();
  await expect(queueItem(page, files.oldest.title)).toHaveCount(0);
  expect(await db.courseFile.findUniqueOrThrow({ where: { id: files.oldest.id } })).toMatchObject({ status: "PUBLISHED", rejectionReason: null, reviewedAt: expect.any(Date) });

  await page.context().clearCookies();
  await logInAsStudent(page, otherStudent);
  await page.goto(`/courses/${courseId}/exams`);
  await expect(page.getByRole("heading", { name: files.oldest.title })).toBeVisible();
  expect(await fileStatus(page, files.oldest.id)).toBe(200);
  await page.goto(`/courses/${courseId}/questions`);
  await expect(page.getByText(pipelineQuestion)).toBeVisible();
});

test("a rejection needs a reason, and the student sees it", async ({ page }) => {
  await logInAsAdmin(page);
  await page.goto("/admin/submissions");
  const item = queueItem(page, files.middle.title);
  const reject = item.getByRole("button", { name: `Reject ${files.middle.title}` });
  // The browser blocks an empty reason; the server refuses a blank one too.
  await reject.click();
  await expect(page).toHaveURL(/\/admin\/submissions$/);
  await item.getByLabel(`Reason for rejecting ${files.middle.title}`).fill("   ");
  await reject.click();
  await expect(page).toHaveURL(/\/admin\/submissions\?error=reason_required$/);
  await expect(page.getByText("Enter a reason so the student knows why it was rejected.")).toBeVisible();
  expect(await db.courseFile.findUniqueOrThrow({ where: { id: files.middle.id } })).toMatchObject({ status: "PENDING" });

  await queueItem(page, files.middle.title).getByLabel(`Reason for rejecting ${files.middle.title}`).fill("The scan is unreadable.");
  await queueItem(page, files.middle.title).getByRole("button", { name: `Reject ${files.middle.title}` }).click();
  await expect(page).toHaveURL(/\/admin\/submissions\?rejected=1$/);
  expect(await db.courseFile.findUniqueOrThrow({ where: { id: files.middle.id } })).toMatchObject({ status: "REJECTED", rejectionReason: "The scan is unreadable." });

  await page.context().clearCookies();
  await logInAsStudent(page);
  await page.goto("/my-submissions");
  await expect(submissionCard(page, files.middle.title)).toContainText("Rejected");
  await expect(submissionCard(page, files.middle.title)).toContainText("Reason: The scan is unreadable.");
  await expect(submissionCard(page, files.race.title)).toContainText("Pending review");
  // Rejected stays off the course page and closed to other students.
  await page.context().clearCookies();
  await logInAsStudent(page, otherStudent);
  await page.goto(`/courses/${courseId}/materials`);
  await expect(page.getByRole("heading", { name: files.middle.title })).toHaveCount(0);
  expect(await fileStatus(page, files.middle.id)).toBe(404);
});

test("a reason that looks like HTML is shown to the student as plain text", async ({ page }) => {
  await logInAsAdmin(page);
  await page.goto("/admin/submissions");
  const item = queueItem(page, files.html.title);
  await item.getByLabel(`Reason for rejecting ${files.html.title}`).fill(htmlReason);
  await item.getByRole("button", { name: `Reject ${files.html.title}` }).click();
  await expect(page).toHaveURL(/\/admin\/submissions\?rejected=1$/);

  await page.context().clearCookies();
  let dialogs = 0;
  page.on("dialog", dialog => { dialogs++; void dialog.dismiss(); });
  await logInAsStudent(page);
  await page.goto("/my-submissions");
  const card = submissionCard(page, files.html.title);
  await expect(card).toContainText(`Reason: ${htmlReason}`);
  await expect(card.locator("img, b")).toHaveCount(0);
  expect(dialogs).toBe(0);
});

test("when two admins review the same submission, the second one is told it was already reviewed", async ({ page, browser }) => {
  await logInAsAdmin(page);
  await page.goto("/admin/submissions");
  const second = await browser.newContext();
  try {
    const otherPage = await second.newPage();
    await logInAsAdmin(otherPage);
    await otherPage.goto("/admin/submissions");
    await queueItem(page, files.race.title).getByRole("button", { name: `Publish ${files.race.title}` }).click();
    await expect(page).toHaveURL(/\?published=1$/);

    // The second admin's page still shows it; their rejection must not overwrite the publish.
    await queueItem(otherPage, files.race.title).getByLabel(`Reason for rejecting ${files.race.title}`).fill("Duplicate");
    await queueItem(otherPage, files.race.title).getByRole("button", { name: `Reject ${files.race.title}` }).click();
    await expect(otherPage).toHaveURL(/\?error=not_pending$/);
    await expect(otherPage.getByText("That submission was already reviewed.")).toBeVisible();
    expect(await db.courseFile.findUniqueOrThrow({ where: { id: files.race.id } })).toMatchObject({ status: "PUBLISHED", rejectionReason: null });
  } finally {
    await second.close();
  }
});

test("students and visitors cannot open the review queue", async ({ page }) => {
  await page.goto("/admin/submissions");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fsubmissions$/);
  await logInAsStudent(page);
  await expect(page.getByRole("link", { name: "Review", exact: true })).toHaveCount(0);
  await page.goto("/admin/submissions");
  await expect(page.getByRole("heading", { name: "Review Submissions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Publish / })).toHaveCount(0);
});
