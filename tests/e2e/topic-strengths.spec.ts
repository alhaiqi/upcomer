import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { configureLogger } from "@/lib/logger";
import { rebuildQuestionBank } from "@/lib/question-bank";

const expect = baseExpect.configure({ timeout: 15_000 });

// US-26: a student sees their strongest and weakest topics in one course. The spec makes one course with five
// topic-tagged exam papers (three topics) and two students. Everything is deleted at the end; the course takes its
// papers, questions, groups, and profile rows with it.
const stamp = String(Date.now()).slice(-8);
const courseId = `qa-str-${stamp}`;
const password = "password123";
const students = {
  a: { id: `qa-str-a-${stamp}`, email: `qa-str-a-${stamp}@mail.aub.edu`, name: "Rates Topics" },
  b: { id: `qa-str-b-${stamp}`, email: `qa-str-b-${stamp}@mail.aub.edu`, name: "Skips Topics" },
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
  await db.course.create({ data: { id: courseId, code: `QS${stamp}`, name: `Strengths Course ${stamp}`, facultyId: "faculty-eng" } });
  for (const [year, topic, texts] of papers) {
    await db.courseFile.create({ data: {
      id: `${courseId}-${year}`, courseId, title: `Exam ${year} ${stamp}`, year, topic, examType: "FINAL", category: "EXAM",
      originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
      questions: { create: texts.map((text, index) => ({ number: index + 1, text })) },
    } });
  }
  expect((await rebuildQuestionBank(courseId)).ok).toBe(true);
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

const topics = `/courses/${courseId}/topics`;
const confidence = `/courses/${courseId}/confidence`;
async function fillLogIn(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}
async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await fillLogIn(page, email);
  await expect(page).toHaveURL(/\/my-courses$/);
}
const rating = (page: Page, name: string, label: string) => page.getByRole("group", { name, exact: true }).getByRole("radio", { name: label, exact: true });
const section = (page: Page) => page.getByRole("region", { name: "Strongest and weakest topics" });
const list = (page: Page, name: "strongest" | "weakest") => section(page).locator(`[data-list="${name}"]`);

test("a visitor is sent to log in and comes back to a clear no-profile message", async ({ page }) => {
  await page.goto(topics);
  await expect(page).toHaveURL(/\/login\?next=/);
  await fillLogIn(page, students.a.email);
  await expect(page).toHaveURL(new RegExp(`${topics}$`));
  await expect(page.getByRole("heading", { name: "Your topics", level: 1 })).toBeVisible();
  await expect(section(page).getByRole("note")).toContainText("You have no learning profile for this course yet, so there is nothing to compare.");
  await expect(section(page).getByRole("listitem")).toHaveCount(0);
  await expect(section(page).getByText("so far")).toHaveCount(0);

  await section(page).getByRole("link", { name: "Rate your topics" }).click();
  await expect(page).toHaveURL(new RegExp(`${confidence}$`));
  await expect(page.getByRole("heading", { name: "Rate your topics" })).toBeVisible();
});

test("a student rates their topics and sees the strongest and the weakest, each with what it rests on", async ({ page }) => {
  await logIn(page, students.a.email);
  await page.goto(confidence);
  await rating(page, "Routing", "1 · Not confident").check();
  await rating(page, "DNS", "3 · Somewhat confident").check();
  await rating(page, "TCP", "5 · Very confident").check();
  await page.getByRole("button", { name: "Save ratings" }).click();
  await expect(page.getByRole("status")).toContainText("Your ratings were saved.");

  await page.getByRole("status").getByRole("link", { name: "your strongest and weakest topics" }).click();
  await expect(page).toHaveURL(new RegExp(`${topics}$`));
  await expect(list(page, "strongest").getByRole("heading", { name: "Strongest so far" })).toBeVisible();
  await expect(list(page, "strongest").getByRole("listitem")).toHaveText(["TCPRated 5 of 5, no practice recorded"]);
  await expect(list(page, "weakest").getByRole("heading", { name: "Weakest so far" })).toBeVisible();
  await expect(list(page, "weakest").getByRole("listitem")).toHaveText(["RoutingRated 1 of 5, no practice recorded"]);
  // The middle topic is in neither list, and nothing claims mastery.
  await expect(section(page).getByText("DNS")).toHaveCount(0);
  await expect(section(page)).toContainText("It is a guide, not a measure of mastery.");
  await expect(section(page).getByRole("note")).toHaveCount(0);
});

test("the Upcomer Exam links to the topics page for a logged-in student only", async ({ page }) => {
  await page.goto(`/courses/${courseId}/exam`);
  await expect(page.getByRole("heading", { name: "Upcomer Exam" })).toBeVisible();
  await expect(page.getByRole("link", { name: "See your strongest and weakest topics" })).toHaveCount(0);

  await logIn(page, students.a.email);
  await page.goto(`/courses/${courseId}/exam`);
  await page.getByRole("link", { name: "See your strongest and weakest topics" }).click();
  await expect(page).toHaveURL(new RegExp(`${topics}$`));
  await expect(list(page, "weakest").getByRole("listitem")).toHaveCount(1);
});

test("a student who skipped every topic sees a clear message instead of a list", async ({ page }) => {
  await logIn(page, students.b.email);
  await page.goto(confidence);
  await page.getByRole("button", { name: "Save ratings" }).click();
  await expect(page.getByRole("status")).toContainText("Your ratings were saved.");
  expect(await db.learningTopic.count({ where: { userId: students.b.id, courseId } })).toBeGreaterThan(0);

  await page.goto(topics);
  await expect(section(page).getByRole("note")).toContainText("You skipped every topic and have no recorded practice, so there is nothing to compare yet.");
  await expect(section(page).getByRole("link", { name: "Rate your topics" })).toBeVisible();
  await expect(section(page).getByRole("listitem")).toHaveCount(0);
  await expect(section(page).getByText("so far")).toHaveCount(0);
});

test("an unknown course is not found", async ({ page }) => {
  await logIn(page, students.a.email);
  const response = await page.goto(`/courses/qa-str-missing-${stamp}/topics`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});
