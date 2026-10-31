import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { setTopicWeakness } from "@/lib/learning-profile";
import { configureLogger } from "@/lib/logger";
import { rebuildQuestionBank } from "@/lib/question-bank";

const expect = baseExpect.configure({ timeout: 15_000 });

// US-28: personal ordering of the Upcomer Exam. The spec makes one course with five tagged exam papers and three
// students. Nothing writes a learning profile yet (that is US-24 and US-25), so the profiles are written with
// setTopicWeakness, the call those stories will make. Everything is deleted at the end; the course takes its papers,
// questions, groups, marks, and profile rows with it.
const stamp = String(Date.now()).slice(-8);
const courseId = `qa-order-${stamp}`;
const password = "password123";
const students = {
  a: { id: `qa-ord-a-${stamp}`, email: `qa-ord-a-${stamp}@mail.aub.edu`, name: "Weak In Routing" },
  b: { id: `qa-ord-b-${stamp}`, email: `qa-ord-b-${stamp}@mail.aub.edu`, name: "Weak In DNS" },
  c: { id: `qa-ord-c-${stamp}`, email: `qa-ord-c-${stamp}@mail.aub.edu`, name: "No Profile" },
};
const handshake = "Explain the TCP three-way handshake.";
const routing = "Describe link-state routing.";
const dns = "Explain how DNS resolves a host name.";
const papers: Array<[number, string, string[]]> = [
  [2021, "TCP", [handshake]], [2022, "TCP", [handshake]], [2023, "Routing", [handshake, routing]], [2024, "Routing", [routing]], [2025, "DNS", [dns]],
];

const db = new PrismaClient();
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  configureLogger({ persist: false });
  const passwordHash = await bcrypt.hash(password, 10);
  await db.user.createMany({ data: Object.values(students).map(student => ({ ...student, passwordHash })) });
  await db.course.create({ data: { id: courseId, code: `QO${stamp}`, name: `Order Course ${stamp}`, facultyId: "faculty-eng" } });
  for (const [year, topic, texts] of papers) {
    await db.courseFile.create({ data: {
      id: `${courseId}-${year}`, courseId, title: `Exam ${year} ${stamp}`, year, topic, examType: "FINAL", category: "EXAM",
      originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
      questions: { create: texts.map((text, index) => ({ number: index + 1, text })) },
    } });
  }
  expect(await rebuildQuestionBank(courseId)).toEqual({ ok: true, groupCount: 3, questionCount: 6 });
  for (const [student, weak] of [[students.a.id, "Routing"], [students.b.id, "DNS"]] as const) {
    for (const topic of ["TCP", "Routing", "DNS"]) expect(await setTopicWeakness(student, courseId, topic, topic === weak ? 1 : 0)).toEqual({ ok: true });
  }
});
test.afterAll(async () => {
  try {
    const userIds = Object.values(students).map(student => student.id);
    await db.$transaction([
      db.course.deleteMany({ where: { id: courseId } }),
      db.session.deleteMany({ where: { userId: { in: userIds } } }),
      db.user.deleteMany({ where: { id: { in: userIds } } }),
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
const exam = `/courses/${courseId}/exam`;
// The questions as shown, top to bottom.
const shown = (page: Page) => page.locator("li[data-tier] > p:first-of-type");
const frequency = [handshake, routing, dns];

test("a student with a learning profile gets the exam reordered by their priorities in personal mode (acceptance test 1)", async ({ page }) => {
  await logIn(page, students.a.email);
  await page.goto(exam);
  await expect(shown(page)).toHaveText(frequency);
  await page.getByRole("navigation", { name: "Question order" }).getByRole("link", { name: "Personal order" }).click();
  await expect(page).toHaveURL(new RegExp(`${exam}\\?order=personal$`));
  await expect(page.getByRole("heading", { name: /Your order/ })).toBeVisible();
  await expect(shown(page)).toHaveText([routing, handshake, dns]);
  // Each question keeps its number: the routing question is still question 2.
  await expect(page.locator("li[data-tier]").first()).toHaveAttribute("id", "question-2");

  // Marking a question in personal mode comes back to personal mode.
  await page.locator("#question-2").getByRole("button", { name: "Mark question 2 done" }).click();
  await expect(page).toHaveURL(new RegExp(`${exam}\\?order=personal&at=2(#question-2)?$`));
  await expect(shown(page)).toHaveText([routing, handshake, dns]);
  await expect(page.locator("#question-2")).toContainText("✓ Done");
  await expect(page.getByRole("link", { name: "Continue at question 1" })).toBeVisible();
});

test("switching back restores the original frequency order (acceptance test 2)", async ({ page }) => {
  await logIn(page, students.a.email);
  await page.goto(`${exam}?order=personal`);
  await expect(shown(page)).toHaveText([routing, handshake, dns]);
  await page.getByRole("navigation", { name: "Question order" }).getByRole("link", { name: "Frequency order" }).click();
  await expect(page).toHaveURL(new RegExp(`${exam}$`));
  await expect(shown(page)).toHaveText(frequency);
  await expect(page.getByRole("heading", { name: /Very likely/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Your order/ })).toHaveCount(0);
  // The order is the stored ranking.
  const ranked = await db.questionGroup.findMany({ where: { courseId }, orderBy: { rank: "asc" }, select: { text: true } });
  expect(ranked.map(group => group.text)).toEqual(frequency);
});

test("two students with different profiles see different orders of the same course (acceptance test 3)", async ({ browser }) => {
  const orders: string[][] = [];
  for (const student of [students.a, students.b]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await logIn(page, student.email);
    await page.goto(`${exam}?order=personal`);
    await expect(page.getByRole("heading", { name: /Your order/ })).toBeVisible();
    orders.push(await shown(page).allTextContents());
    await context.close();
  }
  expect(orders[0]).toEqual([routing, handshake, dns]);
  expect(orders[1]).toEqual([handshake, dns, routing]);
});

test("a student without a learning profile, and a visitor, get the frequency order", async ({ page }) => {
  await page.goto(`${exam}?order=personal`);
  await expect(shown(page)).toHaveText(frequency);
  await expect(page.getByRole("navigation", { name: "Question order" })).toHaveCount(0);

  await logIn(page, students.c.email);
  await page.goto(`${exam}?order=personal`);
  await expect(page.getByText("You have no learning profile for this course yet, so this is the frequency order.")).toBeVisible();
  await expect(shown(page)).toHaveText(frequency);
});
