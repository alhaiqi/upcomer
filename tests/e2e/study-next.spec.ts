import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { configureLogger } from "@/lib/logger";
import { rebuildQuestionBank } from "@/lib/question-bank";

const expect = baseExpect.configure({ timeout: 15_000 });

// US-30: a student is recommended one topic to study next in a course, with the reason and a link to practise, and the
// recommendation follows recorded practice. The spec makes one course with five topic-tagged exam papers (TCP and
// Routing in two each, DNS in one) and one student. Everything is deleted at the end; the course takes its papers,
// questions, groups, and profile rows with it.
const stamp = String(Date.now()).slice(-8);
const courseId = `qa-nxt-${stamp}`;
const password = "password123";
const student = { id: `qa-nxt-a-${stamp}`, email: `qa-nxt-a-${stamp}@mail.aub.edu`, name: "Studies Next" };
const handshake = "Explain the TCP three-way handshake.";
const routing = "Describe link-state routing.";
const dns = "Explain how DNS resolves a host name.";
// The handshake question is in two TCP papers and one Routing paper, so practising it counts for TCP.
const papers: Array<[number, string, string[]]> = [
  [2021, "TCP", [handshake]], [2022, "TCP", [handshake]], [2023, "Routing", [handshake, routing]], [2024, "Routing", [routing]], [2025, "DNS", [dns]],
];

const db = new PrismaClient();
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  configureLogger({ persist: false });
  await db.user.create({ data: { ...student, passwordHash: await bcrypt.hash(password, 10) } });
  await db.course.create({ data: { id: courseId, code: `QN${stamp}`, name: `Study Next Course ${stamp}`, facultyId: "faculty-eng" } });
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
    await db.$transaction([
      db.course.deleteMany({ where: { id: courseId } }),
      db.session.deleteMany({ where: { userId: student.id } }),
      db.user.deleteMany({ where: { id: student.id } }),
    ]);
  } finally {
    await db.$disconnect();
  }
});

const topics = `/courses/${courseId}/topics`;
const practice = `/courses/${courseId}/practice`;
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
const section = (page: Page) => page.getByRole("region", { name: "Study next" });

test("a visitor is sent to log in and comes back to a recommendation with its reason and next actions", async ({ page }) => {
  await page.goto(topics);
  await expect(page).toHaveURL(/\/login\?next=/);
  await fillLogIn(page, student.email);
  await expect(page).toHaveURL(new RegExp(`${topics}$`));

  // No profile yet: TCP and Routing are level (two papers each, neutral weakness), so the name decides.
  await expect(section(page).getByRole("heading", { level: 3 })).toHaveText("Routing");
  await expect(section(page).locator("[data-reason]")).toHaveText("In 2 of this course's 5 published exam papers. Not rated and no practice recorded, so a neutral weakness is used.");
  await expect(section(page)).toContainText("It is not a guarantee of what the next exam will cover.");
  await section(page).getByText("How this is worked out").click();
  await expect(section(page).locator("details")).toContainText("Appeared in 2 of 5 published exam papers");
  await expect(section(page).locator("details")).toContainText("Historical frequency is not a guarantee of future exams.");
  await expect(section(page).getByRole("link", { name: "See the Upcomer Exam in your personal order" })).toHaveAttribute("href", `/courses/${courseId}/exam?order=personal`);
  await expect(section(page).getByRole("link", { name: "Rate your topics" })).toBeVisible();
  await expect(section(page)).not.toContainText(/mastered/i);

  await section(page).getByRole("link", { name: "Practise questions" }).click();
  await expect(page).toHaveURL(new RegExp(`${practice}$`));
  await expect(page.getByRole("heading", { name: "Question practice" })).toBeVisible();
});

test("the recommendation changes after the student records practice", async ({ page }) => {
  await logIn(page, student.email);
  await page.goto(topics);
  await expect(section(page).getByRole("heading", { level: 3 })).toHaveText("Routing");

  // One incorrect attempt on a TCP question makes TCP weaker than the untouched Routing.
  await section(page).getByRole("link", { name: "Practise questions" }).click();
  const question = page.getByRole("listitem").filter({ hasText: handshake });
  await question.getByRole("radio", { name: "Incorrect" }).check();
  await question.getByRole("button", { name: "Save practice outcome" }).click();
  await expect(page.getByRole("status")).toContainText("Practice outcome saved.");

  await page.getByRole("link", { name: "Your topics", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${topics}$`));
  await expect(section(page).getByRole("heading", { level: 3 })).toHaveText("TCP");
  await expect(section(page).locator("[data-reason]")).toHaveText("In 2 of this course's 5 published exam papers. Not rated, 0 correct and 1 incorrect.");
  await expect(section(page).getByRole("heading", { level: 3 })).toHaveCount(1);
});
