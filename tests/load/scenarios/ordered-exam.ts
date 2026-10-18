import { rebuildQuestionBank } from "../../../lib/question-bank";
import type { LoadContext, Scenario } from "../scenario";

// US-92 load: students open the consolidated ordered exam (US-18) of a course with 20 papers of 25 questions each,
// grouped and ranked into 44 questions. The page is public. Everything is in a course made for the run and deleted after.

const PAPERS = 20;
const ids = (ctx: LoadContext) => ({ faculty: `${ctx.stamp}-faculty`, course: `${ctx.stamp}-course` });

const scenario: Scenario = {
  description: `Students open /courses/:id/exam for a course with ${PAPERS} exam papers of 25 questions each (44 ranked questions).`,
  stages: [1, 10, 25, 50, 100],
  async setup(ctx) {
    const { faculty, course } = ids(ctx);
    await ctx.db.faculty.create({ data: { id: faculty, code: ctx.stamp.toUpperCase().slice(0, 18) + "F", name: "Load Test Faculty" } });
    await ctx.db.course.create({ data: { id: course, code: ctx.stamp.toUpperCase().slice(0, 18) + "C", name: "Load Test Course", facultyId: faculty } });
    const topics = Array.from({ length: 60 }, (_, index) => `Explain networking concept number ${index} with an example.`);
    for (let paper = 0; paper < PAPERS; paper++) {
      await ctx.db.courseFile.create({
        data: {
          courseId: course, title: `Load Paper ${paper}`, category: "EXAM", year: 2005 + paper,
          originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
          questions: { create: topics.slice(paper, paper + 25).map((text, index) => ({ number: index + 1, text: `${index + 1}. ${text}` })) },
        },
      });
    }
    const result = await rebuildQuestionBank(course);
    if (!result.ok) throw new Error("Could not group the load test questions.");
    return { method: "GET", path: `/courses/${course}/exam` };
  },
  async teardown(ctx) {
    const { faculty, course } = ids(ctx);
    // Deleting the course deletes its papers, questions, and question groups.
    await ctx.db.course.deleteMany({ where: { id: course } });
    await ctx.db.faculty.deleteMany({ where: { id: faculty } });
  },
};

export default scenario;
