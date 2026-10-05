import { expect, test } from "@playwright/test";

test("exam and material links open files without cross-course content", async ({ page, request }) => {
  await page.goto("/courses/course-eece350");
  await expect(page.getByRole("heading", { name: "Computer Networks" })).toBeVisible();
  await page.getByRole("link", { name: "Browse Previous Exams" }).click();
  await expect(page.getByText("Final Exam 2025")).toBeVisible();
  await expect(page.getByText("Data Structures Final 2025")).toHaveCount(0);
  const exam = await request.get("/files/file-eece350-final");
  expect(exam.ok()).toBeTruthy();
  expect(exam.headers()["content-type"]).toContain("application/pdf");
  await page.getByRole("link", { name: /Back to EECE350/ }).click();
  await page.getByRole("link", { name: "Browse Course Materials" }).click();
  await expect(page.getByText("Network Models Lecture")).toBeVisible();
  await expect(page.getByText("Trees and Graphs Notes")).toHaveCount(0);
  const material = await request.get("/files/file-eece350-notes");
  expect(material.ok()).toBeTruthy();
  expect(material.headers()["content-type"]).toContain("application/pdf");
});

test("an unavailable file shows a page that links back", async ({ page }) => {
  // The seeded record whose physical file is deliberately missing belongs to MATH201.
  const missing = await page.goto("/files/file-missing");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "File unavailable" })).toBeVisible();
  await expect(page.getByText("This file isn't available right now.")).toBeVisible();
  await page.getByRole("link", { name: "Back to the course" }).click();
  await expect(page).toHaveURL(/\/courses\/course-math201$/);

  const unknown = await page.goto("/files/no-such-file");
  expect(unknown?.status()).toBe(404);
  await expect(page.getByText("no-such-file")).toHaveCount(0);
  await page.getByRole("link", { name: "Browse courses" }).click();
  await expect(page).toHaveURL(/\/$/);
});
