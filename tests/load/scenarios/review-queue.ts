import { adminSession, type LoadContext, type Scenario } from "../scenario";

// US-74 load: admins open the review queue while 200 student submissions wait in it.
// The submissions point at a seeded fixture, so no file is written. Everything is deleted afterwards.

const PENDING = 200;
let session: Awaited<ReturnType<typeof adminSession>> | undefined;
const ids = (ctx: LoadContext) => ({ faculty: `${ctx.stamp}-faculty`, course: `${ctx.stamp}-course`, student: `${ctx.stamp}-student` });

const scenario: Scenario = {
  description: `Admins open /admin/submissions with ${PENDING} pending student submissions in the queue (oldest first).`,
  stages: [1, 10, 25, 50, 100],
  async setup(ctx) {
    const { faculty, course, student } = ids(ctx);
    await ctx.db.faculty.create({ data: { id: faculty, code: ctx.stamp.toUpperCase().slice(0, 18) + "F", name: "Load Test Faculty" } });
    await ctx.db.course.create({ data: { id: course, code: ctx.stamp.toUpperCase().slice(0, 18) + "C", name: "Load Test Course", facultyId: faculty } });
    await ctx.db.user.create({ data: { id: student, email: `${ctx.stamp}@load.upcomer.test`, name: "Load Student", passwordHash: "not-a-login" } });
    const start = Date.now() - PENDING * 60_000;
    await ctx.db.courseFile.createMany({
      data: Array.from({ length: PENDING }, (_, index) => ({
        id: `${ctx.stamp}-file-${index}`, courseId: course, title: `Load Submission ${index + 1}`, category: index % 2 ? "MATERIAL" as const : "EXAM" as const,
        status: "PENDING" as const, submittedById: student, createdAt: new Date(start + index * 60_000),
        originalFileName: "eece350-final-2025.pdf", storageKey: "eece350-final-2025.pdf", mimeType: "application/pdf",
      })),
    });
    session = await adminSession(ctx.db);
    return { method: "GET", path: "/admin/submissions", headers: { cookie: session.cookie } };
  },
  async teardown(ctx) {
    const { faculty, course, student } = ids(ctx);
    await ctx.db.course.deleteMany({ where: { id: course } });
    await ctx.db.faculty.deleteMany({ where: { id: faculty } });
    await ctx.db.user.deleteMany({ where: { id: student } });
    if (session) await ctx.db.session.deleteMany({ where: { id: session.sessionId } });
  },
};

export default scenario;
