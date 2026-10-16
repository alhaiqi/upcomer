import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { logInAsAdmin } from "./fixtures";

const expect = baseExpect.configure({ timeout: 15_000 });

// The spec makes its own course with three exam papers and their questions, all pointing at a committed fixture, and
// deletes the course at the end (its papers, questions, and groups go with it).
const stamp = String(Date.now()).slice(-8);
const courseId = `qa-qbank-${stamp}`;
const code = `QB${stamp}`;
const emptyCourseId = `qa-qbank-empty-${stamp}`;
const paper = (year: number, examType: "MIDTERM" | "FINAL", termId: string) => ({
  id: `${courseId}-${year}`, courseId, title: `Exam ${year} ${stamp}`, year, examType, termId, professorId: "prof-a", category: "EXAM" as const,
  originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
});
const papers = [paper(2023, "MIDTERM", "term-fall"), paper(2024, "FINAL", "term-spring"), paper(2025, "FINAL", "term-fall")];
const questions: Array<[number, string[]]> = [
  [2023, ["Explain the TCP three-way handshake.", "Define a socket.", "What is NAT?"]],
  // The socket question twice in one paper still counts as one paper.
  [2024, ["explain the  tcp three-way handshake", "Define a socket", "Define a socket?"]],
  [2025, ["EXPLAIN THE TCP THREE-WAY HANDSHAKE!", "Explain the UDP header."]],
];

const db = new PrismaClient();
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await db.course.createMany({ data: [
    { id: courseId, code, name: `Question Bank Course ${stamp}`, facultyId: "faculty-eng" },
    { id: emptyCourseId, code: `QBE${stamp}`, name: `Empty Question Bank Course ${stamp}`, facultyId: "faculty-eng" },
  ] });
  await db.courseFile.createMany({ data: papers });
  for (const [year, texts] of questions) {
    await db.question.createMany({ data: texts.map((text, index) => ({ fileId: `${courseId}-${year}`, number: index + 1, text })) });
  }
});
test.afterAll(async () => {
  try {
    await db.course.deleteMany({ where: { id: { in: [courseId, emptyCourseId] } } });
  } finally {
    await db.$disconnect();
  }
});

const ranked = (page: Page) => page.locator("ol.question-list > li h3");

async function regroup(page: Page, distinct: number) {
  await page.goto("/admin/questions");
  await page.getByRole("button", { name: `Regroup and rank ${code}`, exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`Regrouped ${code}: ${distinct} distinct questions.`);
}

test("an admin groups the questions, and identical questions differing in spacing, punctuation or case form one group", async ({ page }) => {
  await logInAsAdmin(page);
  await page.goto("/admin/catalog");
  await page.getByRole("link", { name: "Open question bank" }).click();
  await expect(page).toHaveURL(/\/admin\/questions$/);
  await regroup(page, 4);

  const groups = await db.questionGroup.findMany({ where: { courseId }, include: { questions: { include: { file: true } } }, orderBy: { rank: "asc" } });
  expect(groups.map(group => [group.text, group.paperCount, group.rank])).toEqual([
    ["Explain the TCP three-way handshake.", 3, 1], ["Define a socket.", 2, 2], ["Explain the UDP header.", 1, 3], ["What is NAT?", 1, 4],
  ]);
  // Every source question is in its group, with the paper it came from.
  expect(groups[0].questions.map(item => item.file.year).sort()).toEqual([2023, 2024, 2025]);
  expect(groups[1].questions).toHaveLength(3);
});

test("a student searches and filters the question bank and the ranking order is kept", async ({ page }) => {
  await page.goto(`/courses/${courseId}`);
  await page.getByRole("link", { name: "Browse Question Bank" }).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${courseId}/questions$`));
  await expect(page.getByText("Questions from 3 previous exams")).toBeVisible();
  await expect(ranked(page)).toHaveText(["Explain the TCP three-way handshake.", "Define a socket.", "Explain the UDP header.", "What is NAT?"]);
  await expect(page.locator("ol.question-list > li").first()).toContainText("Appeared in 3 papers");

  await page.getByRole("searchbox", { name: "Search questions" }).fill("  SOCKET?");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(ranked(page)).toHaveText(["Define a socket."]);

  await page.getByRole("searchbox", { name: "Search questions" }).fill("explain");
  await page.getByRole("combobox", { name: "Filter by year" }).selectOption("2025");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(ranked(page)).toHaveText(["Explain the TCP three-way handshake.", "Explain the UDP header."]);
  await expect(page.getByRole("combobox", { name: "Filter by year" })).toHaveValue("2025");

  // Year and type must hold for the same paper: the 2023 paper is a midterm, so its NAT question is not a final.
  await page.getByRole("searchbox", { name: "Search questions" }).fill("");
  await page.getByRole("combobox", { name: "Filter by year" }).selectOption("2023");
  await page.getByRole("combobox", { name: "Filter by type" }).selectOption({ label: "Final" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No questions match your search.")).toBeVisible();

  await page.getByRole("combobox", { name: "Filter by year" }).selectOption("");
  await page.getByRole("combobox", { name: "Filter by term" }).selectOption({ label: "Spring" });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(ranked(page)).toHaveText(["Explain the TCP three-way handshake.", "Define a socket."]);

  await page.getByRole("link", { name: "Clear search and filters" }).click();
  await expect(ranked(page)).toHaveCount(4);
});

test("a newly processed paper changes the ranking when grouping runs again", async ({ page }) => {
  for (const year of [2026, 2027]) {
    await db.courseFile.create({ data: paper(year, "FINAL", "term-fall") });
    await db.question.create({ data: { fileId: `${courseId}-${year}`, number: 1, text: "what is NAT" } });
  }
  await logInAsAdmin(page);
  await regroup(page, 4);
  await page.goto(`/courses/${courseId}/questions`);
  // NAT is now in 3 papers like the handshake and was seen more recently, so it comes first.
  await expect(ranked(page)).toHaveText(["What is NAT?", "Explain the TCP three-way handshake.", "Define a socket.", "Explain the UDP header."]);
  await regroup(page, 4);
  await page.goto(`/courses/${courseId}/questions`);
  await expect(ranked(page)).toHaveText(["What is NAT?", "Explain the TCP three-way handshake.", "Define a socket.", "Explain the UDP header."]);
});

test("a course with no extracted questions says so", async ({ page }) => {
  await page.goto(`/courses/${emptyCourseId}/questions`);
  await expect(page.getByRole("heading", { name: "Question Bank" })).toBeVisible();
  await expect(page.getByText("No questions have been extracted for this course yet.")).toBeVisible();
});
