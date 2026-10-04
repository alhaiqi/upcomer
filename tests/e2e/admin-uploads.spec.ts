import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { logInAsAdmin } from "./fixtures";

const fixture = "public/uploads/eece350-final-2025.pdf";

test.beforeEach(async ({ page }) => logInAsAdmin(page));

test("an uploaded exam appears on its course and opens", async ({ page, request }) => {
  const title = `Uploaded Exam ${Date.now()}`;
  await page.goto("/admin/uploads");
  await page.getByRole("link", { name: "Upload Previous Exam" }).click();
  await page.getByLabel("Course").selectOption("course-eece350");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Professor (optional)").selectOption({ label: "Professor A" });
  await page.getByLabel("Year (optional)").fill("2025");
  await page.getByLabel("Session (optional)").fill("Final");
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
  await expect(page.getByText(title)).toBeVisible();
  await page.goto("/courses/course-eece330/exams");
  await expect(page.getByText(title)).toHaveCount(0);
  await page.goto("/courses/course-eece350/materials");
  await expect(page.getByText(title)).toHaveCount(0);
});

test("an uploaded material appears under materials only", async ({ page }) => {
  const title = `Uploaded Material ${Date.now()}`;
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
  const title = `Rejected Upload ${Date.now()}`;
  await page.goto("/admin/uploads/exams?courseId=course-eece350");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("File").setInputFiles({ name: "exam.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf") });
  await page.getByRole("button", { name: "Upload exam" }).click();
  await expect(page.getByRole("alert")).toContainText("corrupt");

  await page.getByLabel("File").setInputFiles({ name: "exam.exe", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await page.getByRole("button", { name: "Upload exam" }).click();
  await expect(page.getByRole("alert")).toContainText("Unsupported file type");

  await page.goto("/courses/course-eece350/exams");
  await expect(page.getByText(title)).toHaveCount(0);
});

test("the upload endpoint refuses a request without an admin session", async ({ request }) => {
  // The request fixture has its own cookie jar, so it is not logged in as the page is.
  const response = await request.post("/api/admin/uploads", { multipart: { category: "EXAM", courseId: "course-eece350", title: "Anonymous upload" } });
  expect(response.status()).toBe(403);
  expect((await response.json()).reason).toBe("forbidden");
});
