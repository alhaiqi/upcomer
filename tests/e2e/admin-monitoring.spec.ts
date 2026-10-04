import { expect as baseExpect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { logInAsAdmin } from "./fixtures";

const expect = baseExpect.configure({ timeout: 15_000 });

// Everything this file removes was created after this moment; older log rows are never touched.
const start = new Date();
const studentEmail = `student-${String(Date.now()).slice(-8)}@mail.aub.edu`;
const db = new PrismaClient();

test.afterAll(async () => {
  try {
    const student = await db.user.findUnique({ where: { email: studentEmail }, select: { id: true } });
    await db.logEntry.deleteMany({
      where: {
        createdAt: { gte: start },
        OR: [
          { event: "physical_file_not_found", context: { path: ["fileId"], equals: "file-missing" } },
          { event: "monitoring_alert_triggered" },
          ...(student ? [{ event: "unauthorized_access", context: { path: ["userId"], equals: student.id } }] : []),
        ],
      },
    });
    if (student) {
      await db.$transaction([
        db.session.deleteMany({ where: { userId: student.id } }),
        db.userCourse.deleteMany({ where: { userId: student.id } }),
        db.user.delete({ where: { id: student.id } }),
      ]);
    }
  } finally {
    await db.$disconnect();
  }
});

test("real errors show up on the monitoring page with an alert", async ({ page, request }) => {
  test.slow();
  // The seeded record whose file is deliberately missing: each open is a real physical_file_not_found error.
  for (let attempt = 0; attempt < 6; attempt++) expect((await request.get("/files/file-missing")).status()).toBe(404);

  // Logs are saved in the background, so wait until they are in the database.
  await expect.poll(() => db.logEntry.count({
    where: { event: "physical_file_not_found", level: "ERROR", createdAt: { gte: start }, context: { path: ["fileId"], equals: "file-missing" } },
  })).toBeGreaterThanOrEqual(1);

  await logInAsAdmin(page);
  await page.getByRole("link", { name: "Monitoring", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/monitoring$/);
  await expect(page.getByRole("heading", { name: "Monitoring", exact: true })).toBeVisible();

  await page.getByLabel("Event").selectOption("physical_file_not_found");
  await page.getByLabel("Time range").selectOption("1h");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/event=physical_file_not_found/);
  const entries = page.getByTestId("log-entries");
  await expect(entries.getByRole("row").filter({ hasText: "fileId=file-missing" }).first()).toBeVisible();
  await expect(entries.getByText("error", { exact: true }).first()).toBeVisible();

  // At least five errors within ten minutes: the banner is shown. Located by test ID, never by role, since Next's route announcer is also an alert.
  const banner = page.getByTestId("monitoring-alert");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Alert/);

  await page.goto("/admin/catalog");
  await expect(page.getByRole("link", { name: "Open monitoring" })).toHaveAttribute("href", "/admin/monitoring");
});

test("a student cannot reach monitoring and a visitor is sent to log in", async ({ page }) => {
  const response = await page.goto("/admin/monitoring");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL("/login?next=%2Fadmin%2Fmonitoring");

  await page.goto("/signup");
  await page.getByLabel("Name").fill("Test Student");
  await page.getByLabel("Email").fill(studentEmail);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/login\?registered=1$/);
  await page.getByLabel("Email").fill(studentEmail);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/my-courses$/);

  await expect(page.getByRole("link", { name: "Monitoring", exact: true })).toHaveCount(0);
  const denied = await page.goto("/admin/monitoring");
  expect(denied?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});
