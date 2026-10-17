import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { logInAsAdmin } from "./fixtures";

const expect = baseExpect.configure({ timeout: 15_000 });

// The spec makes its own courses, papers, and questions, all pointing at a committed fixture, and deletes the courses at
// the end (their papers, questions, and groups go with them). Counts are checked against these courses only.
const stamp = String(Date.now()).slice(-8);
const courseId = `qa-exam-${stamp}`;
const code = `UX${stamp}`;
const smallCourseId = `qa-exam-small-${stamp}`;
const smallCode = `UXS${stamp}`;
const emptyCourseId = `qa-exam-empty-${stamp}`;

const paper = (course: string, year: number, termId: string, examType: "MIDTERM" | "FINAL" = "FINAL") => ({
  id: `${course}-${year}`, courseId: course, title: `Exam ${year} ${stamp}`, year, examType, termId, professorId: "prof-a", category: "EXAM" as const,
  originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
});
const SUBNET = "Consider the network below. (6 points)\n(a) Find the subnet mask.\n(b) How many hosts fit?";
// Five papers: the handshake is in 4 (very likely), the subnet question in 2 (likely), the socket and NAT questions in 1 (rare).
const questions: Array<[number, "MIDTERM" | "FINAL", string, string[]]> = [
  [2021, "MIDTERM", "term-fall", ["Q1. Explain the TCP three-way handshake.", "What is NAT?"]],
  // The handshake twice in one paper still counts as one paper.
  [2022, "FINAL", "term-spring", ["explain the  tcp three-way handshake", "EXPLAIN THE TCP THREE-WAY HANDSHAKE!", `2. ${SUBNET}`]],
  [2023, "FINAL", "term-fall", ["Explain the TCP three-way handshake?"]],
  [2024, "MIDTERM", "term-spring", ["Explain the TCP three-way handshake.", "consider the network below\n  (a)  find the subnet mask\n(b) how many hosts fit"]],
  [2025, "FINAL", "term-fall", ["Define a socket."]],
];

const db = new PrismaClient();
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await db.course.createMany({ data: [
    { id: courseId, code, name: `Upcomer Exam Course ${stamp}`, facultyId: "faculty-eng" },
    { id: smallCourseId, code: smallCode, name: `Small Upcomer Exam Course ${stamp}`, facultyId: "faculty-eng" },
    { id: emptyCourseId, code: `UXE${stamp}`, name: `Empty Upcomer Exam Course ${stamp}`, facultyId: "faculty-eng" },
  ] });
  await db.courseFile.createMany({ data: [
    ...questions.map(([year, examType, termId]) => paper(courseId, year, termId, examType)),
    paper(smallCourseId, 2024, "term-fall"), paper(smallCourseId, 2025, "term-spring"),
  ] });
  for (const [year, , , texts] of questions) {
    await db.question.createMany({ data: texts.map((text, index) => ({ fileId: `${courseId}-${year}`, number: index + 1, text })) });
  }
  await db.question.createMany({ data: [
    { fileId: `${smallCourseId}-2024`, number: 1, text: "Define a socket." },
    { fileId: `${smallCourseId}-2025`, number: 1, text: "Define a socket" },
    { fileId: `${smallCourseId}-2025`, number: 2, text: "What does ARP do?" },
  ] });
});
test.afterAll(async () => {
  try {
    await db.course.deleteMany({ where: { id: { in: [courseId, smallCourseId, emptyCourseId] } } });
  } finally {
    await db.$disconnect();
  }
});

const items = (page: Page) => page.locator("li[data-tier]");
const texts = (page: Page) => items(page).locator("p").first();
const shown = async (page: Page) => (await items(page).locator(":scope > p:first-of-type").allInnerTexts()).map(text => text.replace(/\s+/g, " ").trim());

async function regroup(page: Page, courseCode: string) {
  await page.goto("/admin/questions");
  await page.getByRole("button", { name: `Regroup and rank ${courseCode}`, exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`Regrouped ${courseCode}:`);
}

test("an admin groups the questions of the test courses", async ({ page }) => {
  await logInAsAdmin(page);
  await regroup(page, code);
  await regroup(page, smallCode);
});

test("a student opens the Upcomer Exam: each distinct question once, in ranking order, sub-parts together (US-18)", async ({ page }) => {
  await page.goto(`/courses/${courseId}`);
  await page.getByRole("link", { name: "Open Upcomer Exam" }).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${courseId}/exam$`));
  await expect(page.getByRole("heading", { name: "Upcomer Exam", level: 1 })).toBeVisible();
  await expect(page.getByText("4 distinct questions from 5 previous exams, the most likely first.")).toBeVisible();

  // The page follows the stored ranking, and every group is shown exactly once.
  const groups = await db.questionGroup.findMany({ where: { courseId }, orderBy: { rank: "asc" }, select: { text: true } });
  expect(groups).toHaveLength(4);
  await expect(items(page)).toHaveCount(4);
  expect(await shown(page)).toEqual(groups.map(group => group.text));
  expect((await shown(page)).slice(0, 2)).toEqual([
    "Explain the TCP three-way handshake.", "Consider the network below. (a) Find the subnet mask. (b) How many hosts fit?",
  ]);
  await expect(items(page).locator(".eyebrow")).toContainText(["Question 1", "Question 2", "Question 3", "Question 4"]);

  // The sub-parts are shown with their question, each on its own line, without the number or marks.
  const subnet = items(page).nth(1).locator(":scope > p:first-of-type");
  expect(await subnet.innerText()).toBe("Consider the network below.\n(a) Find the subnet mask.\n(b) How many hosts fit?");
  await expect(texts(page)).not.toContainText("points");
});

test("each question shows \"Appeared in X of Y papers\" and its source papers on demand (US-17)", async ({ page }) => {
  await page.goto(`/courses/${courseId}/exam`);
  await expect(items(page).nth(0)).toContainText("Appeared in 4 of 5 papers");
  await expect(items(page).nth(1)).toContainText("Appeared in 2 of 5 papers");
  await expect(items(page).nth(2)).toContainText("Appeared in 1 of 5 papers");
  await expect(items(page).nth(3)).toContainText("Appeared in 1 of 5 papers");

  // X equals the number of distinct papers in the stored group.
  const handshake = await db.questionGroup.findFirstOrThrow({ where: { courseId, rank: 1 }, include: { questions: true } });
  expect(handshake.questions).toHaveLength(5);
  expect(new Set(handshake.questions.map(item => item.fileId)).size).toBe(4);

  const sources = page.getByRole("list", { name: "Source papers of question 1" });
  await expect(sources).toBeHidden();
  await items(page).nth(0).getByText("Show the 4 source papers").click();
  await expect(sources).toBeVisible();
  await expect(sources.getByRole("listitem")).toHaveText([
    `Exam 2024 ${stamp} 2024 · Spring · Midterm · Professor A`,
    `Exam 2023 ${stamp} 2023 · Fall · Final · Professor A`,
    `Exam 2022 ${stamp} 2022 · Spring · Final · Professor A`,
    `Exam 2021 ${stamp} 2021 · Fall · Midterm · Professor A`,
  ]);
  await expect(sources.getByRole("link", { name: `Exam 2024 ${stamp}` })).toHaveAttribute("href", `/files/${courseId}-2024`);
});

test("questions sit in exactly one tier, by the same share rule, and there is no low-confidence note from 5 papers (US-19)", async ({ page }) => {
  await page.goto(`/courses/${courseId}/exam`);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([/^Very likely/, /^Likely/, /^Rare/]);
  const tiers = await items(page).evaluateAll(nodes => nodes.map(node => node.getAttribute("data-tier")));
  expect(tiers).toEqual(["VERY_LIKELY", "LIKELY", "RARE", "RARE"]);
  await expect(page.getByRole("region", { name: /Very likely/ }).locator("li[data-tier]")).toHaveCount(1);
  await expect(page.getByRole("region", { name: /^Likely/ }).locator("li[data-tier]")).toHaveCount(1);
  await expect(page.getByRole("region", { name: /Rare/ }).locator("li[data-tier]")).toHaveCount(2);
  await expect(page.getByRole("note")).toHaveCount(0);
});

test("a course with fewer than 5 papers carries a low-confidence note, and a new paper updates Y", async ({ page }) => {
  await page.goto(`/courses/${smallCourseId}/exam`);
  await expect(page.getByRole("note")).toHaveText("Low confidence: these tiers are based on only 2 previous exams. They become more reliable from 5 papers.");
  await expect(items(page).nth(0)).toContainText("Define a socket.");
  await expect(items(page).nth(0)).toContainText("Appeared in 2 of 2 papers");
  // 1 of 2 papers is half the papers, so it is very likely by the same rule as the 5-paper course.
  expect(await items(page).evaluateAll(nodes => nodes.map(node => node.getAttribute("data-tier")))).toEqual(["VERY_LIKELY", "VERY_LIKELY"]);

  await db.courseFile.create({ data: paper(smallCourseId, 2026, "term-fall") });
  await db.question.create({ data: { fileId: `${smallCourseId}-2026`, number: 1, text: "Explain the UDP header." } });
  await logInAsAdmin(page);
  await regroup(page, smallCode);
  await page.goto(`/courses/${smallCourseId}/exam`);
  await expect(items(page).nth(0)).toContainText("Appeared in 2 of 3 papers");
  await expect(page.getByRole("note")).toContainText("based on only 3 previous exams");
  // 1 of 3 papers is now a third: likely.
  expect(await items(page).evaluateAll(nodes => nodes.map(node => node.getAttribute("data-tier")))).toEqual(["VERY_LIKELY", "LIKELY", "LIKELY"]);
});

test("a course with no processed papers says so instead of showing an empty list (US-18)", async ({ page }) => {
  await page.goto(`/courses/${emptyCourseId}/exam`);
  await expect(page.getByRole("heading", { name: "Upcomer Exam", level: 1 })).toBeVisible();
  await expect(page.getByText("No exam papers have been processed for this course yet.")).toBeVisible();
  await expect(items(page)).toHaveCount(0);
});

test("an unknown course shows the not found page", async ({ page }) => {
  const response = await page.goto(`/courses/qa-exam-missing-${stamp}/exam`);
  expect(response?.status()).toBe(404);
});
