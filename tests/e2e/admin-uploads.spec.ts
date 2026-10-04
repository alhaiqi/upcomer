import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { logInAsAdmin } from "./fixtures";

const fixture = "public/uploads/eece350-final-2025.pdf";
const stamp = Date.now();
const titles = { exam: `Uploaded Exam ${stamp}`, material: `Uploaded Material ${stamp}`, rejected: `Rejected Upload ${stamp}` };

test.beforeEach(async ({ page }) => logInAsAdmin(page));

// Remove every record this file uploads, and its stored copy, so test uploads do not pile up in the shared database and folder.
test.afterAll(async () => {
  const db = new PrismaClient();
  try {
    const uploaded = await db.courseFile.findMany({ where: { title: { in: Object.values(titles) } }, select: { id: true, storageKey: true } });
    const root = path.resolve(process.env.FILE_STORAGE_ROOT || "public/uploads");
    for (const { storageKey } of uploaded) {
      // Only ever delete upload copies, never the committed fixtures next to them.
      const file = path.resolve(root, storageKey);
      if (!/^(exams|materials)\/[^/\\]+$/.test(storageKey) || !file.startsWith(root + path.sep)) continue;
      await unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
    await db.courseFile.deleteMany({ where: { id: { in: uploaded.map(file => file.id) } } });
  } finally {
    await db.$disconnect();
  }
});

test("an uploaded exam appears on its course and opens", async ({ page, request }) => {
  const title = titles.exam;
  await page.goto("/admin/uploads");
  await page.getByRole("link", { name: "Upload Previous Exam" }).click();
  await page.getByLabel("Course").selectOption("course-eece350");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Professor (optional)").selectOption({ label: "Professor A" });
  await page.getByLabel("Year (optional)").fill("2025");
  await page.getByLabel("Term (optional)").selectOption({ label: "Fall" });
  await page.getByLabel("Type (optional)").selectOption({ label: "Final" });
  await page.getByLabel("File").setInputFiles(fixture);
  await page.getByRole("button", { name: "Upload exam" }).click();
  await expect(page.getByRole("status")).toContainText(`Uploaded “${title}”`);

  const fileUrl = await page.getByRole("link", { name: "Open Original File" }).getAttribute("href");
  const file = await request.get(fileUrl!);
  expect(file.ok()).toBeTruthy();
  expect(file.headers()["content-type"]).toContain("application/pdf");
  expect(await file.body()).toEqual(await readFile(fixture));

  await page.getByRole("link", { name: "View course exams" }).click();
  await expect(page).toHaveURL(/\/courses\/course-eece350\/exams$/);
  const card = page.locator("article").filter({ hasText: title });
  await expect(card).toContainText("Term: Fall");
  await expect(card).toContainText("Type: Final");
  await page.goto("/courses/course-eece330/exams");
  await expect(page.getByText(title)).toHaveCount(0);
  await page.goto("/courses/course-eece350/materials");
  await expect(page.getByText(title)).toHaveCount(0);
});

test("an uploaded material appears under materials only", async ({ page }) => {
  const title = titles.material;
  await page.goto("/admin/uploads/materials?courseId=course-eece330");
  await expect(page.getByLabel("Course")).toHaveValue("course-eece330");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Topic (optional)").fill("Heaps");
  await page.getByLabel("File").setInputFiles(fixture);
  await page.getByRole("button", { name: "Upload material" }).click();
  await page.getByRole("link", { name: "View course materials" }).click();
  await expect(page.getByText(title)).toBeVisible();
  await page.goto("/courses/course-eece330/exams");
  await expect(page.getByText(title)).toHaveCount(0);
});

test("invalid and corrupt files are refused with a message", async ({ page }) => {
  const title = titles.rejected;
  await page.goto("/admin/uploads/exams?courseId=course-eece350");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("File").setInputFiles({ name: "exam.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf") });
  await page.getByRole("button", { name: "Upload exam" }).click();
  // Scoped to the upload form: a page-wide getByRole("alert") also matches Next's empty route announcer.
  const uploadError = page.locator("form").filter({ has: page.getByRole("button", { name: "Upload exam" }) }).getByRole("alert");
  await expect(uploadError).toContainText("corrupt");

  await page.getByLabel("File").setInputFiles({ name: "exam.exe", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await page.getByRole("button", { name: "Upload exam" }).click();
  await expect(uploadError).toContainText("Unsupported file type");

  await page.goto("/courses/course-eece350/exams");
  await expect(page.getByText(title)).toHaveCount(0);
});

test("the upload endpoint refuses a request without an admin session", async ({ request }) => {
  // The request fixture has its own cookie jar, so it is not logged in as the page is.
  const response = await request.post("/api/admin/uploads", { multipart: { category: "EXAM", courseId: "course-eece350", title: "Anonymous upload" } });
  expect(response.status()).toBe(403);
  expect((await response.json()).reason).toBe("forbidden");
});
