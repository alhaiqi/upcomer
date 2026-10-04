import { expect, test, type Page } from "@playwright/test";

// Playwright does not read .env, so pick up the seeded admin's credentials from it when they are not already set.
try {
  process.loadEnvFile?.(".env");
} catch {
  // No .env file; rely on the environment.
}

export async function logInAsAdmin(page: Page) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  test.skip(!email || !password, "Set ADMIN_EMAIL and ADMIN_PASSWORD and run npm run db:seed to run admin tests.");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/my-courses$/);
}
