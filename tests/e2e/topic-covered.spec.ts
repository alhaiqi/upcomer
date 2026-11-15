import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { configureLogger } from "@/lib/logger";
import { rebuildQuestionBank } from "@/lib/question-bank";

const expect = baseExpect.configure({ timeout: 15_000 });

// US-32: a student marks a topic of a course as already covered. The "Study next" recommendation moves to the next
// topic, the topic keeps its place in the weakest topics with a "Covered" label, the flag survives logging out and back
// in, and undoing it restores the recommendation. The spec makes one course with five topic-tagged exam papers (TCP and
// Routing in two each, DNS in one) and one student. Everything is deleted at the end; the course and the student take
// the papers, questions, groups, profile rows, and covered flags with them.
const stamp = String(Date.now()).slice(-8);
const courseId = `qa-cov-${stamp}`;
const password = "password123";
const student = { id: `qa-cov-a-${stamp}`, email: `qa-cov-a-${stamp}@mail.aub.edu`, name: "Covers Topics" };
const papers: Array<[number, string, string]> = [
  [2021, "TCP", "Explain the TCP three-way handshake."], [2022, "TCP", "Explain TCP congestion control."],
  [2023, "Routing", "Describe link-state routing."], [2024, "Routing", "Describe distance-vector routing."],
  [2025, "DNS", "Explain how DNS resolves a host name."],
];

const db = new PrismaClient();
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  configureLogger({ persist: false });
  await db.user.create({ data: { ...student, passwordHash: await bcrypt.hash(password, 10) } });
  await db.course.create({ data: { id: courseId, code: `QC${stamp}`, name: `Covered Topics Course ${stamp}`, facultyId: "faculty-eng" } });
  for (const [year, topic, text] of papers) {
    await db.courseFile.create({ data: {
      id: `${courseId}-${year}`, courseId, title: `Exam ${year} ${stamp}`, year, topic, examType: "FINAL", category: "EXAM",
      originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
      questions: { create: [{ number: 1, text }] },
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
    expect(await db.coveredTopic.count({ where: { OR: [{ courseId }, { userId: student.id }] } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});

const topics = `/courses/${courseId}/topics`;
async function logIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(student.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/my-courses$/);
}
const rating = (page: Page, name: string, label: string) => page.getByRole("group", { name, exact: true }).getByRole("radio", { name: label, exact: true });
const studyNext = (page: Page) => page.getByRole("region", { name: "Study next" });
const recommended = (page: Page) => studyNext(page).getByRole("heading", { level: 3 });
const weakest = (page: Page) => page.getByRole("region", { name: "Strongest and weakest topics" }).locator('[data-list="weakest"]').getByRole("listitem");
const strongest = (page: Page) => page.getByRole("region", { name: "Strongest and weakest topics" }).locator('[data-list="strongest"]').getByRole("listitem");
const covered = (page: Page) => page.getByRole("region", { name: "Covered topics" });
const row = (page: Page, topicKey: string) => covered(page).locator(`li[data-topic="${topicKey}"]`);
// Next's route announcer is an alert too, so notices are read inside <main>.
const status = (page: Page) => page.locator("main").getByRole("status");
// The questions of the Upcomer Exam, in the order shown.
const examOrder = async (page: Page) => {
  await page.goto(`/courses/${courseId}/exam?order=personal`);
  await expect(page.getByRole("heading", { name: /Your order/ })).toBeVisible();
  return page.locator("li[data-tier] > p:first-of-type").allTextContents();
};
// What covered must never change: the student's profile rows in this course, and their events.
const evidence = async () => ({
  topics: await db.learningTopic.findMany({ where: { userId: student.id, courseId }, orderBy: { topicKey: "asc" } }),
  events: await db.learningEvent.count({ where: { userId: student.id } }),
});
const flags = async () => (await db.coveredTopic.findMany({ where: { userId: student.id }, orderBy: { topicKey: "asc" } })).map(flag => `${flag.courseId}:${flag.topicKey}`);

test("a student marks the recommended topic as covered: the recommendation moves on and the topic is labelled, not promoted", async ({ page }) => {
  await logIn(page);
  await page.goto(`/courses/${courseId}/confidence`);
  await rating(page, "Routing", "1 · Not confident").check();
  await rating(page, "DNS", "3 · Somewhat confident").check();
  await rating(page, "TCP", "5 · Very confident").check();
  await page.getByRole("button", { name: "Save ratings" }).click();
  await expect(page.getByRole("status")).toContainText("Your ratings were saved.");

  // Routing is the weakest topic and in two of five papers, so it is recommended.
  await page.goto(topics);
  await expect(recommended(page)).toHaveText("Routing");
  await expect(weakest(page)).toHaveText(["RoutingRated 1 of 5, no practice recorded"]);
  await expect(strongest(page)).toHaveText(["TCPRated 5 of 5, no practice recorded"]);
  await expect(covered(page).getByRole("listitem")).toHaveText([/^DNSNot covered/, /^RoutingNot covered/, /^TCPNot covered/]);
  await expect(covered(page)).toContainText("it does not mean you have mastered the topic");
  await expect(studyNext(page).getByText(/left out/)).toHaveCount(0);
  const before = await evidence();
  expect(before.topics).toHaveLength(3);
  const order = await examOrder(page);
  expect(order).toHaveLength(5);

  await page.goto(topics);
  await studyNext(page).getByRole("button", { name: "Mark as covered: Routing" }).click();
  await expect(page).toHaveURL(new RegExp(`${topics}\\?covered=1$`));
  await expect(status(page)).toHaveText("Marked as covered. It is left out of Study next.");

  // TCP (rated 5, two papers) and DNS (rated 3, one paper) are level; TCP is in more papers.
  await expect(recommended(page)).toHaveText("TCP");
  await expect(studyNext(page)).toContainText("1 topic you marked as covered is left out.");
  // Routing is still the weakest topic, now labelled; it is not among the strongest.
  await expect(weakest(page)).toHaveText(["RoutingCoveredRated 1 of 5, no practice recorded"]);
  await expect(strongest(page)).toHaveText(["TCPRated 5 of 5, no practice recorded"]);
  await expect(row(page, "routing")).toHaveAttribute("data-state", "covered");
  await expect(row(page, "routing").getByRole("button")).toHaveText("Undo covered");
  await expect(row(page, "tcp").getByRole("button")).toHaveText("Mark as covered");
  // Mastery is only ever mentioned to say that covered is not mastery.
  await expect(studyNext(page)).not.toContainText(/master/i);
  await expect(status(page)).not.toContainText(/master/i);

  // Nothing but the flag was saved: the ratings, weakness, practice counts, and the personal order are as before.
  expect(await evidence()).toEqual(before);
  expect(await flags()).toEqual([`${courseId}:routing`]);
  expect(await examOrder(page)).toEqual(order);
  await page.goto(`/courses/${courseId}/confidence`);
  await expect(rating(page, "Routing", "1 · Not confident")).toBeChecked();
});

test("the covered topic is still covered after logging out and back in, and undo restores the recommendation", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await logIn(page);
  await page.goto(topics);
  await expect(recommended(page)).toHaveText("TCP");
  await expect(weakest(page)).toHaveText(["RoutingCoveredRated 1 of 5, no practice recorded"]);
  await expect(row(page, "routing")).toHaveAttribute("data-state", "covered");
  await expect(status(page)).toHaveCount(0);
  const before = await evidence();

  await covered(page).getByRole("button", { name: "Undo covered: Routing" }).click();
  await expect(page).toHaveURL(new RegExp(`${topics}\\?covered=0$`));
  await expect(status(page)).toHaveText("No longer marked as covered.");
  await expect(recommended(page)).toHaveText("Routing");
  await expect(weakest(page)).toHaveText(["RoutingRated 1 of 5, no practice recorded"]);
  await expect(studyNext(page).getByText(/left out/)).toHaveCount(0);
  await expect(row(page, "routing")).toHaveAttribute("data-state", "not-covered");
  await expect(covered(page).getByRole("button", { name: /^Undo covered/ })).toHaveCount(0);
  expect(await evidence()).toEqual(before);
  expect(await flags()).toEqual([]);
});

test("with every topic covered the page says so instead of recommending one, and a tampered form saves nothing", async ({ page }) => {
  await logIn(page);
  await page.goto(topics);
  for (const name of ["DNS", "Routing", "TCP"]) {
    await covered(page).getByRole("button", { name: `Mark as covered: ${name}` }).click();
    await expect(covered(page).getByRole("button", { name: `Undo covered: ${name}` })).toBeVisible();
  }
  await expect(studyNext(page).getByRole("note")).toHaveText("You marked every topic of this course as covered, so there is no topic to recommend. Undo one below to get a recommendation again.");
  await expect(recommended(page)).toHaveCount(0);
  // The weakest and strongest topics are the same ones, each labelled.
  await expect(weakest(page)).toHaveText(["RoutingCoveredRated 1 of 5, no practice recorded"]);
  await expect(strongest(page)).toHaveText(["TCPCoveredRated 5 of 5, no practice recorded"]);

  await covered(page).getByRole("button", { name: "Undo covered: DNS" }).click();
  await expect(status(page)).toHaveText("No longer marked as covered.");
  await expect(recommended(page)).toHaveText("DNS");
  await expect(studyNext(page)).toContainText("2 topics you marked as covered are left out.");

  // A form changed to a topic the course does not have is refused with a message, and nothing is saved.
  const saved = await flags();
  await row(page, "dns").locator("form").evaluate(form => {
    (form.querySelector('input[name="topicKey"]') as HTMLInputElement).value = "not a topic of this course";
  });
  await row(page, "dns").getByRole("button").click();
  await expect(page).toHaveURL(new RegExp(`${topics}\\?error=unknown_topic$`));
  await expect(page.locator("main").getByRole("alert")).toHaveText("That topic isn't part of this course. Reload the page and try again.");
  await expect(recommended(page)).toHaveText("DNS");
  expect(await flags()).toEqual(saved);
});
