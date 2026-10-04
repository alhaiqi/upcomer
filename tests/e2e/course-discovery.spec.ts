import { expect, test } from "@playwright/test";

test("a student browses, searches and filters courses, then opens one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Browse Courses" })).toBeVisible();
  const cards = page.locator("article");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("EECE330");
  await expect(cards.nth(1)).toContainText("EECE350");
  await expect(cards.nth(2)).toContainText("MATH201");

  await page.getByRole("searchbox", { name: "Search courses" }).fill("eece 350");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=eece\+350/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("EECE350");
  await expect(page.getByRole("searchbox", { name: "Search courses" })).toHaveValue("eece 350");

  await page.getByRole("searchbox", { name: "Search courses" }).fill("");
  await page.getByRole("combobox", { name: "Filter by faculty" }).selectOption({ label: "Faculty of Engineering" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByText("MATH201")).toHaveCount(0);

  await page.getByRole("combobox", { name: "Filter by professor" }).selectOption({ label: "Professor A" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "Filter by faculty" })).toHaveValue("faculty-eng");
  await expect(page.getByRole("combobox", { name: "Filter by professor" })).toHaveValue("prof-a");

  await cards.first().getByRole("link", { name: "Open Course" }).click();
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

test("an unknown faculty in a link says it doesn't exist", async ({ page }) => {
  await page.goto("/?facultyId=unknown");
  await expect(page.getByText("The selected faculty doesn't exist.")).toBeVisible();
  await expect(page.getByText("No courses found.")).toBeVisible();
});
