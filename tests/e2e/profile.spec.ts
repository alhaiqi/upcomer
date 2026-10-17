import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "./fixtures";

const expect = baseExpect.configure({ timeout: 15_000 });

// US-04. The spec makes two students and one faculty with stamped IDs and deletes them at the end. It never counts rows.
const stamp = String(Date.now()).slice(-8);
const password = "password123";
const students = {
  a: { id: `qa-profile-a-${stamp}`, email: `qa-profile-a-${stamp}@mail.aub.edu`, name: `Profile Student ${stamp}` },
  b: { id: `qa-profile-b-${stamp}`, email: `qa-profile-b-${stamp}@mail.aub.edu`, name: `Other Profile Student ${stamp}` },
};
const faculty = { id: `qa-profile-faculty-${stamp}`, code: `QP${stamp}`, name: `Profile Faculty ${stamp}` };
const db = new PrismaClient();

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(password, 10);
  await db.faculty.create({ data: faculty });
  await db.user.createMany({ data: Object.values(students).map(student => ({ ...student, passwordHash })) });
});
test.afterAll(async () => {
  try {
    const userIds = Object.values(students).map(student => student.id);
    await db.$transaction([
      db.session.deleteMany({ where: { userId: { in: userIds } } }),
      db.user.deleteMany({ where: { id: { in: userIds } } }),
      db.faculty.deleteMany({ where: { id: faculty.id } }),
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

const saved = (page: Page) => page.getByRole("status").filter({ hasText: "Profile saved." });

test("edited name, faculty, and major persist after logging out and back in (acceptance test 1)", async ({ page }) => {
  await logIn(page, students.a.email);
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible();
  await expect(page.getByText(students.a.email)).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue(students.a.name);

  await page.getByLabel("Name").fill(`  Renamed   Student ${stamp} `);
  await page.getByLabel("Faculty (optional)").selectOption(faculty.id);
  await page.getByLabel("Major (optional)").fill(`Computer Engineering ${stamp}`);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(saved(page)).toBeVisible();
  // Spacing is tidied on save.
  await expect(page.getByLabel("Name")).toHaveValue(`Renamed Student ${stamp}`);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");
  await logIn(page, students.a.email);
  await page.goto("/profile");
  await expect(page.getByLabel("Name")).toHaveValue(`Renamed Student ${stamp}`);
  await expect(page.getByLabel("Faculty (optional)")).toHaveValue(faculty.id);
  await expect(page.getByLabel("Major (optional)")).toHaveValue(`Computer Engineering ${stamp}`);
  expect(await db.user.findUniqueOrThrow({ where: { id: students.a.id }, select: { name: true, facultyId: true, major: true } }))
    .toEqual({ name: `Renamed Student ${stamp}`, facultyId: faculty.id, major: `Computer Engineering ${stamp}` });
});

test("an empty or overlong name shows the error and keeps the old saved values (acceptance test 2)", async ({ page }) => {
  await logIn(page, students.a.email);
  await page.goto("/profile");
  // Skip the browser's own required and length checks on the profile form, so the server's are tested.
  await page.evaluate(() => { document.querySelector<HTMLInputElement>('input[name="name"]')!.form!.noValidate = true; });
  await page.getByLabel("Name").fill("");
  await page.getByLabel("Major (optional)").fill(`Typed Major ${stamp}`);
  await page.getByRole("button", { name: "Save profile" }).click();
  const error = page.locator("form").getByRole("alert");
  await expect(error).toHaveText("Enter your name.");
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Name")).toHaveValue("");
  await expect(page.getByLabel("Major (optional)")).toHaveValue(`Typed Major ${stamp}`);

  await page.evaluate(() => {
    const name = document.querySelector<HTMLInputElement>('input[name="name"]')!;
    name.removeAttribute("maxlength");
    name.form!.noValidate = true;
  });
  await page.getByLabel("Name").fill("n".repeat(101));
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(error).toHaveText("Your name must be 100 characters or fewer.");

  await page.reload();
  await expect(page.getByLabel("Name")).toHaveValue(`Renamed Student ${stamp}`);
  await expect(page.getByLabel("Major (optional)")).toHaveValue(`Computer Engineering ${stamp}`);
  await expect(page.getByLabel("Faculty (optional)")).toHaveValue(faculty.id);
});

test("another student's profile cannot be opened or saved by URL or form (acceptance test 3)", async ({ page, browser }) => {
  const visitor = await browser.newContext();
  try {
    const visitorPage = await visitor.newPage();
    await visitorPage.goto("/profile");
    await expect(visitorPage).toHaveURL("/login?next=%2Fprofile");
    await visitorPage.goto(`/profile/${students.b.id}/edit`);
    await expect(visitorPage).toHaveURL(/\/login\?next=/);
  } finally {
    await visitor.close();
  }

  await logIn(page, students.a.email);
  for (const url of [`/profile/${students.b.id}`, `/profile/${students.b.id}/edit`]) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expect(page.getByText(students.b.name)).toHaveCount(0);
    await expect(page.getByText(students.b.email)).toHaveCount(0);
  }
  // The student's own ID only leads back to their own profile.
  await page.goto(`/profile/${students.a.id}/edit`);
  await expect(page).toHaveURL(/\/profile$/);

  // A form crafted to name the other student still saves the logged-in student.
  await page.evaluate(id => {
    // The profile form, not the header's Log out form.
    const form = document.querySelector<HTMLInputElement>('input[name="name"]')!.form!;
    for (const name of ["userId", "id"]) {
      const input = document.createElement("input");
      Object.assign(input, { type: "hidden", name, value: id });
      form.append(input);
    }
  }, students.b.id);
  await page.getByLabel("Name").fill(`Crafted ${stamp}`);
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(saved(page)).toBeVisible();
  expect((await db.user.findUniqueOrThrow({ where: { id: students.b.id }, select: { name: true } })).name).toBe(students.b.name);
  expect((await db.user.findUniqueOrThrow({ where: { id: students.a.id }, select: { name: true } })).name).toBe(`Crafted ${stamp}`);
});
