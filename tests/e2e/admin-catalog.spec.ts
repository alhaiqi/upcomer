import { expect as baseExpect, test, type Page } from "@playwright/test";
import { logInAsAdmin } from "./fixtures";
import { PrismaClient } from "@prisma/client";

// The dev server compiles each admin page and action on first use, which can take longer than the default 5 seconds.
const expect = baseExpect.configure({ timeout: 15_000 });

const stamp = String(Date.now()).slice(-8);
const created = {
  facultyCode: `QA${stamp}`, faculty: `Faculty of Testing ${stamp}`,
  professor: `Professor Test ${stamp}`, term: `Term ${stamp}`,
  courseCode: `QAC${stamp}`, course: `Testing Course ${stamp}`,
};

// Remove everything this file adds so test entries do not pile up in the shared database.
test.afterAll(async () => {
  const db = new PrismaClient();
  try {
    await db.course.deleteMany({ where: { code: created.courseCode } });
    await db.faculty.deleteMany({ where: { code: created.facultyCode } });
    await db.professor.deleteMany({ where: { name: { startsWith: created.professor } } });
    await db.term.deleteMany({ where: { name: { startsWith: created.term } } });
  } finally {
    await db.$disconnect();
  }
});

// Wait until the dev server has finished compiling and the page has hydrated, so a click on a form is not lost.
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function edit(page: Page, section: string, linkName: string, fields: Record<string, string>, button: string) {
  await open(page, `/admin/catalog/${section}`);
  await page.getByRole("link", { name: linkName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/catalog/${section}/[^/?]+$`));
  await page.waitForLoadState("networkidle");
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: button }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/catalog/${section}\\?saved=1$`));
}

test("an admin adds and edits catalog entries and the catalog shows them at once", async ({ page }) => {
  test.slow();
  await logInAsAdmin(page);
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/catalog$/);

  await page.getByRole("link", { name: "Manage faculties" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Code").fill(created.facultyCode.toLowerCase());
  await page.getByLabel("Name").fill(`${created.faculty} draft`);
  await page.getByRole("button", { name: "Add faculty" }).click();
  await expect(page.getByText("Saved. The catalog shows the change now.")).toBeVisible();
  await expect(page.getByText(created.facultyCode, { exact: true })).toBeVisible();
  await edit(page, "faculties", `Edit ${created.faculty} draft`, { Name: created.faculty }, "Save faculty");
  await expect(page.getByRole("heading", { name: created.faculty, exact: true })).toBeVisible();

  await open(page, "/admin/catalog/professors");
  await page.getByLabel("Name").fill(`${created.professor} draft`);
  await page.getByRole("button", { name: "Add professor" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/professors\?saved=1$/);
  await edit(page, "professors", `Edit ${created.professor} draft`, { Name: created.professor }, "Save professor");
  await expect(page.getByRole("heading", { name: created.professor, exact: true })).toBeVisible();

  await open(page, "/admin/catalog/terms");
  await page.getByLabel("Name").fill(`${created.term} draft`);
  await page.getByRole("button", { name: "Add term" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/terms\?saved=1$/);
  await edit(page, "terms", `Edit ${created.term} draft`, { Name: created.term }, "Save term");
  await expect(page.getByRole("heading", { name: created.term, exact: true })).toBeVisible();

  await open(page, "/admin/catalog/courses");
  await page.getByLabel("Code").fill(`qac ${stamp}`);
  await page.getByLabel("Name").fill("Course draft");
  await page.getByLabel("Faculty").selectOption({ label: created.faculty });
  await page.getByRole("button", { name: "Add course" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/courses\?saved=1$/);
  await expect(page.getByText(created.courseCode, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: `Edit ${created.courseCode}`, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/courses\/[^/?]+$/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Name").fill(created.course);
  await page.getByLabel(created.professor).check();
  await page.getByRole("button", { name: "Save course" }).click();
  await expect(page).toHaveURL(/\/admin\/catalog\/courses\?saved=1$/);
  await expect(page.getByRole("heading", { name: created.course, exact: true })).toBeVisible();
  await expect(page.getByText(`${created.faculty} · ${created.professor}`)).toBeVisible();

  await page.goto("/");
  await page.getByRole("combobox", { name: "Filter by professor" }).selectOption({ label: created.professor });
  await page.getByRole("button", { name: "Search" }).click();
  const cards = page.locator("article");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(created.courseCode);
  await expect(cards.first()).toContainText(created.course);
  await expect(cards.first()).toContainText(created.faculty);
  await expect(page.getByRole("combobox", { name: "Filter by faculty" }).getByRole("option", { name: created.faculty })).toHaveCount(1);
});

test("a course code that already exists is refused, however it is written", async ({ page }) => {
  await logInAsAdmin(page);
  await open(page, "/admin/catalog/courses");
  await page.getByLabel("Code").fill("eece 350");
  await page.getByLabel("Name").fill("Computer Networks Again");
  await page.getByLabel("Faculty").selectOption({ label: "Faculty of Engineering" });
  await page.getByRole("button", { name: "Add course" }).click();
  await expect(page.getByText("A course with code EECE350 already exists.")).toBeVisible();

  await page.goto("/?q=EECE350");
  // Match by the exact code, since another course's name may mention EECE350.
  await expect(page.locator("article").filter({ has: page.getByText("EECE350", { exact: true }) })).toHaveCount(1);
  await expect(page.getByText("Computer Networks Again")).toHaveCount(0);
});

test("a student cannot reach catalog management", async ({ page }) => {
  const email = `student-${Date.now()}@mail.aub.edu`;
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

  await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  for (const path of ["/admin/catalog", "/admin/catalog/courses", "/admin/catalog/courses/course-eece350"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  }
});

test("a visitor is sent to log in", async ({ page }) => {
  await open(page, "/admin/catalog/terms");
  await expect(page).toHaveURL("/login?next=%2Fadmin%2Fcatalog%2Fterms");
});
