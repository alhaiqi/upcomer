import { expect, test, type Page } from "@playwright/test";

const password = "password123";
const newEmail = () => `student-${Date.now()}-${Math.floor(Math.random() * 1000)}@mail.aub.edu`;

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Test Student");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function logIn(page: Page, email: string, secret = password) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(secret);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("a student signs up, logs in, adds a course to My Courses, and logs out", async ({ page }) => {
  const email = newEmail();

  await signUp(page, email);
  await expect(page).toHaveURL(/\/login\?registered=1$/);
  await expect(page.getByText("Account created. Log in to continue.")).toBeVisible();

  await logIn(page, email, "wrong-password");
  await expect(page.getByText("Invalid email or password.")).toBeVisible();

  await logIn(page, email);
  await expect(page).toHaveURL(/\/my-courses$/);
  await expect(page.getByRole("heading", { name: "My Courses" })).toBeVisible();
  await expect(page.getByText("You haven't added any courses yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  await page.goto("/courses/course-eece350");
  await page.getByRole("button", { name: "Add to My Courses" }).click();
  await expect(page).toHaveURL(/\/courses\/course-eece350\?added=1$/);
  await expect(page.getByText("Added to My Courses.")).toBeVisible();

  await page.getByRole("button", { name: "Add to My Courses" }).click();
  await expect(page).toHaveURL(/\/courses\/course-eece350\?added=already$/);
  await expect(page.getByText("Already in My Courses.")).toBeVisible();

  await page.getByRole("link", { name: "My Courses" }).first().click();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article").first()).toContainText("EECE350");

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});

test("signing up twice with the same email says the account already exists", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await expect(page).toHaveURL(/\/login\?registered=1$/);
  await signUp(page, email);
  await expect(page).toHaveURL(/\/signup\?error=email_taken$/);
  await expect(page.getByText("An account with this email already exists.")).toBeVisible();
});

test("the same email in a different case is one account, not two", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await signUp(page, email.toUpperCase());
  await expect(page.getByText("An account with this email already exists.")).toBeVisible();
});

test("a password shorter than eight characters is refused", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Test Student");
  await page.getByLabel("Email").fill(newEmail());
  await page.getByLabel("Password").fill("short");
  await page.evaluate(() => { document.querySelector("form")!.noValidate = true; });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use a password of at least 8 characters.")).toBeVisible();
});

test("My Courses is closed to a visitor who is not logged in", async ({ page }) => {
  await page.goto("/my-courses");
  await expect(page).toHaveURL("/login?next=%2Fmy-courses");
  await expect(page.getByRole("heading", { name: "Log In" })).toBeVisible();
});

test("adding a course while logged out asks for a login and comes back to the course", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);

  await page.goto("/courses/course-math201");
  await page.getByRole("button", { name: "Add to My Courses" }).click();
  await expect(page).toHaveURL("/login?next=%2Fcourses%2Fcourse-math201");

  await logIn(page, email);
  await expect(page).toHaveURL(/\/courses\/course-math201$/);
  await page.getByRole("button", { name: "Add to My Courses" }).click();
  await expect(page.getByText("Added to My Courses.")).toBeVisible();
});

test("a login link cannot send a student off the site after logging in", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await page.goto("/login?next=//evil.example.com");
  await logIn(page, email);
  await expect(page).toHaveURL(/\/my-courses$/);
});

test("browsing and course pages stay open without a login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Browse Courses" })).toBeVisible();
  await page.goto("/courses/course-eece350");
  await expect(page.getByRole("heading", { name: "Computer Networks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});
