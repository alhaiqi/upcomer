import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

test("a student browses, searches and filters courses, then opens one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Browse Courses" })).toBeVisible();
  const cards = page.locator("article");
  // Match a card by its code alone, since another course's name may mention the same code.
  const card = (code: string) => cards.filter({ has: page.getByText(code, { exact: true }) });
  // The catalog is paged in code order and an admin or the demo data can add many courses, so look each seeded one
  // up by code rather than expecting it on the first page.
  for (const code of ["EECE330", "EECE350", "MATH201"]) {
    await page.goto(`/?q=${code}`);
    await expect(card(code)).toHaveCount(1);
  }

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search courses" }).fill("eece 350");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=eece\+350/);
  // Other courses may match too, but an exact code match is listed first.
  await expect(cards.first().getByText("EECE350", { exact: true })).toBeVisible();
  await expect(card("EECE330")).toHaveCount(0);
  await expect(card("MATH201")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search courses" })).toHaveValue("eece 350");

  await page.getByRole("searchbox", { name: "Search courses" }).fill("");
  await page.getByRole("combobox", { name: "Filter by faculty" }).selectOption({ label: "Faculty of Engineering" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(card("EECE350")).toHaveCount(1);
  await expect(card("EECE330")).toHaveCount(1);
  await expect(card("MATH201")).toHaveCount(0);

  await page.getByRole("combobox", { name: "Filter by professor" }).selectOption({ label: "Professor A" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(card("EECE350")).toHaveCount(1);
  await expect(card("EECE330")).toHaveCount(0);
  await expect(card("MATH201")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Filter by faculty" })).toHaveValue("faculty-eng");
  await expect(page.getByRole("combobox", { name: "Filter by professor" })).toHaveValue("prof-a");

  await card("EECE350").getByRole("link", { name: "Open Course" }).click();
  await expect(page).toHaveURL(/\/courses\/course-eece350$/);
  await expect(page.getByRole("heading", { name: "Computer Networks" })).toBeVisible();
});

test("a search with no match shows a no-results message", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search courses" }).fill("eece");
  await page.getByRole("combobox", { name: "Filter by faculty" }).selectOption({ label: "Faculty of Arts and Sciences" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No courses found.")).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);
});

test.describe("search text with LIKE wildcard characters", () => {
  const stamp = String(Date.now()).slice(-8);
  const course = { id: `e2e-wildcard-${stamp}`, code: `WC${stamp}`, name: `Wildcard 100%_off ${stamp}` };
  const db = new PrismaClient();

  test.beforeAll(async () => {
    const faculty = await db.faculty.findFirstOrThrow({ select: { id: true } });
    await db.course.create({ data: { ...course, facultyId: faculty.id } });
  });
  // Remove the course this block adds so it does not pile up in the shared database.
  test.afterAll(async () => {
    try {
      await db.course.deleteMany({ where: { id: course.id } });
    } finally {
      await db.$disconnect();
    }
  });

  const search = async (page: Page, text: string) => {
    await page.goto(`/?${new URLSearchParams({ q: text })}`);
    await expect(page.getByRole("searchbox", { name: "Search courses" })).toHaveValue(text);
  };
  const card = (page: Page, code: string) => page.locator("article").filter({ has: page.getByText(code, { exact: true }) });

  for (const text of ["%", "_"]) {
    test(`searching ${JSON.stringify(text)} matches it literally`, async ({ page }) => {
      await search(page, text);
      await expect(card(page, course.code)).toHaveCount(1);
      // A seeded course without the character must not match.
      await expect(card(page, "EECE350")).toHaveCount(0);
    });
  }

  test("searching a backslash finds no courses without one", async ({ page }) => {
    await search(page, "\\");
    await expect(page.getByText("No courses found.")).toBeVisible();
    await expect(page.locator("article")).toHaveCount(0);
  });

  test("a normal search still matches by code", async ({ page }) => {
    await search(page, "EECE350");
    await expect(card(page, "EECE350")).toHaveCount(1);
    await expect(card(page, course.code)).toHaveCount(0);
  });
});

test("an unknown faculty in a link says it doesn't exist", async ({ page }) => {
  await page.goto("/?facultyId=unknown");
  await expect(page.getByText("The selected faculty doesn't exist.")).toBeVisible();
  await expect(page.getByText("No courses found.")).toBeVisible();
});
