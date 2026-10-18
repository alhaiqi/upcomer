import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { SAMPLE_EXAMS, samplePdf } from "../../integration/fixtures/sample-exams";
import { adminSession, type LoadContext, type Scenario } from "../scenario";

// US-92 load: admins upload an exam PDF through the real upload route (Member 5). Uploading does not start the pipeline yet:
// extraction (US-14) will hook in here. Everything goes into a course made for the run, deleted afterwards.

let session: Awaited<ReturnType<typeof adminSession>> | undefined;
const ids = (ctx: LoadContext) => ({ faculty: `${ctx.stamp}-faculty`, course: `${ctx.stamp}-course` });

function multipart(fields: Record<string, string>, file: { name: string; bytes: Uint8Array }) {
  const boundary = `----upcomer-load-${randomBytes(8).toString("hex")}`;
  const parts = Object.entries(fields).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  const body = Buffer.concat([
    Buffer.from(parts.join("")),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/pdf\r\n\r\n`),
    Buffer.from(file.bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

const scenario: Scenario = {
  description: "Admins upload a sample exam PDF through /api/admin/uploads; the file is checked and stored.",
  stages: [1, 5, 10, 25, 50],
  async setup(ctx) {
    const { faculty, course } = ids(ctx);
    await ctx.db.faculty.create({ data: { id: faculty, code: ctx.stamp.toUpperCase().slice(0, 18) + "F", name: "Load Test Faculty" } });
    await ctx.db.course.create({ data: { id: course, code: ctx.stamp.toUpperCase().slice(0, 18) + "C", name: "Load Test Course", facultyId: faculty } });
    session = await adminSession(ctx.db);
    const exam = SAMPLE_EXAMS[0];
    const { body, contentType } = multipart({ category: "EXAM", courseId: course, title: "Load Exam", year: String(exam.year) }, { name: exam.fileName, bytes: samplePdf(exam) });
    return { method: "POST", path: "/api/admin/uploads", headers: { cookie: session.cookie, "content-type": contentType }, body };
  },
  async teardown(ctx) {
    const { faculty, course } = ids(ctx);
    const files = await ctx.db.courseFile.findMany({ where: { courseId: course }, select: { storageKey: true } });
    const root = path.resolve(process.env.FILE_STORAGE_ROOT || "public/uploads");
    await Promise.all(files.map(file => unlink(path.join(root, file.storageKey)).catch(() => undefined)));
    // Deleting the course deletes its files, questions, groups, and pipeline runs.
    await ctx.db.course.deleteMany({ where: { id: course } });
    await ctx.db.faculty.deleteMany({ where: { id: faculty } });
    if (session) await ctx.db.session.deleteMany({ where: { id: session.sessionId } });
    console.log(`Removed ${files.length} uploaded exams and their pipeline data.`);
  },
};

export default scenario;
