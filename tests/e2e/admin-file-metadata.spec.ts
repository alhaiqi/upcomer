import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { logInAsAdmin } from "./fixtures";

const expect = baseExpect.configure({ timeout: 15_000 });

// Each test tags its own exam record, which points at a committed fixture, so no file is written and the seeded files are untouched.
const stamp = String(Date.now()).slice(-8);
const files = {
  tag: { id: `qa-tag-${stamp}`, title: `Tagging Exam ${stamp}` },
  noCourse: { id: `qa-nocourse-${stamp}`, title: `No Course Exam ${stamp}` },
  retag: { id: `qa-retag-${stamp}`, title: `Retag Exam ${stamp}` },
};
const studentEmail = `student-files-${stamp}@mail.aub.edu`;

const db = new PrismaClient();
test.beforeAll(async () => {
  for (const file of Object.values(files)) {
    await db.courseFile.create({
      data: { ...file, courseId: "course-eece350", category: "EXAM", originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf" },
    });
  }
});
test.afterAll(async () => {
  try {
    await db.courseFile.deleteMany({ where: { id: { in: Object.values(files).map(file => file.id) } } });
    await db.user.deleteMany({ where: { email: studentEmail } });
  } finally {
    await db.$disconnect();
  }
});

async function openEdit(page: Page, title: string) {
  await page.goto("/admin/files?courseId=course-eece350");
  await page.getByRole("link", { name: `Edit ${title}`, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/files\/[^/?]+$/);
  await page.waitForLoadState("networkidle");
}

const card = (page: Page, title: string) => page.locator("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("an admin sets course, professor, year, term, topic, and type and they are saved", async ({ page }) => {
  await logInAsAdmin(page);
  await page.goto("/admin/catalog");
  await page.getByRole("link", { name: "Manage files" }).click();
  await expect(page).toHaveURL(/\/admin\/files$/);

  await openEdit(page, files.tag.title);
  await page.getByLabel("Course").selectOption("course-eece350");
  await page.getByLabel("Professor (optional)").selectOption({ label: "Professor A" });
  await page.getByLabel("Year (optional)").fill("2025");
  await page.getByLabel("Term (optional)").selectOption({ label: "Fall" });
  await page.getByLabel("Type (optional)").selectOption({ label: "Final" });
  await page.getByLabel("Topic (optional)").fill("Routing");
  await page.getByRole("button", { name: "Save file details" }).click();
  await expect(page).toHaveURL(/\/admin\/files\?courseId=course-eece350&saved=1$/);
  await expect(page.getByText("Saved. The file is listed under its course now.")).toBeVisible();

  const saved = await db.courseFile.findUniqueOrThrow({ where: { id: files.tag.id }, include: { term: true } });
  expect(saved).toMatchObject({ courseId: "course-eece350", professorId: "prof-a", year: 2025, examType: "FINAL", topic: "Routing" });
  expect(saved.term?.name).toBe("Fall");

  // The edit page shows the saved values when opened again.
  await openEdit(page, files.tag.title);
  await expect(page.getByLabel("Professor (optional)")).toHaveValue("prof-a");
  await expect(page.getByLabel("Year (optional)")).toHaveValue("2025");
  await expect(page.getByLabel("Type (optional)")).toHaveValue("FINAL");
  await expect(page.getByLabel("Topic (optional)")).toHaveValue("Routing");

  await page.goto("/courses/course-eece350/exams");
  const exam = card(page, files.tag.title);
  await expect(exam).toContainText("Professor A");
  await expect(exam).toContainText("Year: 2025");
  await expect(exam).toContainText("Term: Fall");
  await expect(exam).toContainText("Type: Final");
  await expect(exam).toContainText("Topic: Routing");
});

test("saving without a course is refused because the course is required", async ({ page }) => {
  await logInAsAdmin(page);
  await openEdit(page, files.noCourse.title);
  await page.getByLabel("Course").selectOption("");
  // Skip the browser's own required check so the server's refusal is what is tested.
  await page.locator("form").filter({ has: page.getByRole("button", { name: "Save file details" }) }).evaluate(form => form.setAttribute("novalidate", ""));
  await page.getByRole("button", { name: "Save file details" }).click();
  await expect(page).toHaveURL(/\/admin\/files\/[^/?]+\?error=course_required$/);
  await expect(page.locator(".notice.error")).toHaveText("Choose a course.");

  const unchanged = await db.courseFile.findUniqueOrThrow({ where: { id: files.noCourse.id } });
  expect(unchanged.courseId).toBe("course-eece350");
  await page.goto("/courses/course-eece350/exams");
  await expect(card(page, files.noCourse.title)).toHaveCount(1);
});

test("a file retagged to another course moves to that course only", async ({ page }) => {
  await logInAsAdmin(page);
  await page.goto("/courses/course-eece350/exams");
  await expect(card(page, files.retag.title)).toHaveCount(1);

  await openEdit(page, files.retag.title);
  await page.getByLabel("Course").selectOption("course-eece330");
  // Only the new course's professors are offered.
  await expect(page.getByLabel("Professor (optional)").getByRole("option", { name: "Professor A" })).toHaveCount(0);
  await page.getByLabel("Professor (optional)").selectOption({ label: "Professor B" });
  await page.getByLabel("Type (optional)").selectOption({ label: "Midterm" });
  await page.getByRole("button", { name: "Save file details" }).click();
  await expect(page).toHaveURL(/\/admin\/files\?courseId=course-eece330&saved=1$/);
  await expect(page.getByRole("heading", { name: files.retag.title, exact: true })).toBeVisible();

  await page.goto("/courses/course-eece330/exams");
  await expect(card(page, files.retag.title)).toContainText("Professor B");
  await expect(card(page, files.retag.title)).toContainText("Type: Midterm");
  await page.goto("/courses/course-eece350/exams");
  await expect(page.getByRole("heading", { name: "Previous Exams" })).toBeVisible();
  await expect(card(page, files.retag.title)).toHaveCount(0);
});

test("a student cannot reach file management", async ({ page }) => {
  const email = studentEmail;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Test Student");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/login\?registered=1$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/my-courses$/);
  for (const path of ["/admin/files", `/admin/files/${files.tag.id}`]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  }
});
