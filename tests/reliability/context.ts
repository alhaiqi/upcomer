import type { PrismaClient } from "@prisma/client";
import { actionIdFor, Client } from "./client";
import type { Rng } from "./rng";

// One trial's result. A trial succeeds when the system does the right thing: accepts valid input and refuses invalid input.
export type Outcome = { input: string; expected: string; actual: string; ok: boolean; ms: number };
export type TrialType = { name: string; valid: boolean; run: (ctx: Context) => Promise<Outcome> };
export type Feature = { name: string; needsAdmin?: boolean; trials: TrialType[] };

export type Student = { id: string; email: string; password: string; client: Client };
type Actions = { signUp: string; logIn: string; logOut: string; addCourse: string; saveCourse: string; saveFaculty: string; saveProfessor: string; saveTerm: string; saveFileMetadata: string };

export const result = (input: string, expected: string, actual: string, ok: boolean, ms: number): Outcome => ({ input, expected, actual, ok, ms });

export class Context {
  actions = {} as Actions;
  admin?: Client;
  adminId?: string;
  students: Student[] = [];
  uploadedFileIds = new Set<string>();
  // Stamped CourseFile records created for the file and metadata trials.
  fixtures = { examFileId: "", materialFileId: "", missingFileId: "", unsafeFileIds: [] as string[] };
  private count = 0;

  constructor(public baseUrl: string, public db: PrismaClient, public rng: Rng, public stamp: string) {}

  next() {
    return ++this.count;
  }

  client() {
    return new Client(this.baseUrl);
  }

  // A stamped name, code, or email that cleanup will find.
  name(label: string) {
    return `${this.stamp} ${label} ${this.next()}`;
  }

  email() {
    return `${this.stamp.toLowerCase()}-${this.next()}@example.com`;
  }

  password() {
    return `pw-${this.rng.letters(this.rng.int(8, 16), "abcdefghijkmnpqrstuvwxyz23456789")}`;
  }

  async logIn(email: string, password: string) {
    const client = this.client();
    const reply = await client.postAction("/login", this.actions.logIn, { email, password });
    if (reply.location !== "/my-courses" || !client.session) throw new Error(`setup log-in failed: ${reply.status}`);
    return client;
  }

  // Signs up and logs in a new stamped student; used as a precondition, so it is not timed.
  async newStudent(): Promise<Student> {
    const email = this.email();
    const password = this.password();
    const reply = await this.client().postAction("/signup", this.actions.signUp, { name: this.name("Student"), email, password });
    if (!reply.location.startsWith("/login?registered=1")) throw new Error(`setup sign-up failed: ${reply.status}`);
    const user = await this.db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const student = { id: user.id, email, password, client: await this.logIn(email, password) };
    this.students.push(student);
    return student;
  }

  async anyStudent() {
    return this.students.length ? this.rng.pick(this.students) : this.newStudent();
  }

  // Reads every server action's ID from the real pages of this build.
  // Logs the admin in when credentials are given; the admin features are skipped otherwise.
  async discoverActions(sampleCourseId: string, admin?: { email: string; password: string }) {
    const visitor = this.client();
    this.actions.signUp = actionIdFor((await visitor.get("/signup")).body, "Create account");
    this.actions.logIn = actionIdFor((await visitor.get("/login")).body, "Log in");
    const student = await this.newStudent();
    this.actions.logOut = actionIdFor((await student.client.get("/")).body, "Log out");
    this.actions.addCourse = actionIdFor((await student.client.get(`/courses/${sampleCourseId}`)).body, "Add to My Courses");
    if (!admin) return;
    this.admin = await this.logIn(admin.email, admin.password);
    this.adminId = (await this.db.user.findUniqueOrThrow({ where: { email: admin.email.trim().toLowerCase() }, select: { id: true } })).id;
    this.actions.saveCourse = actionIdFor((await this.admin.get("/admin/catalog/courses")).body, "Add course");
    this.actions.saveFaculty = actionIdFor((await this.admin.get("/admin/catalog/faculties")).body, "Add faculty");
    this.actions.saveProfessor = actionIdFor((await this.admin.get("/admin/catalog/professors")).body, "Add professor");
    this.actions.saveTerm = actionIdFor((await this.admin.get("/admin/catalog/terms")).body, "Add term");
    this.actions.saveFileMetadata = actionIdFor((await this.admin.get(`/admin/files/${this.fixtures.examFileId}`)).body, "Save file details");
  }

  // Stamped file records: two to edit, one whose file is missing, and some whose storage keys try to leave the upload folder.
  async createFileFixtures(courseId: string) {
    const id = (label: string) => `${this.stamp.toLowerCase()}-${label}`;
    const base = { courseId, title: "", originalFileName: "fixture.pdf", mimeType: "application/pdf" };
    const records = [
      { ...base, id: id("exam"), title: `${this.stamp} exam fixture`, storageKey: `exams/${id("exam")}.pdf`, category: "EXAM" as const },
      { ...base, id: id("material"), title: `${this.stamp} material fixture`, storageKey: `materials/${id("material")}.pdf`, category: "MATERIAL" as const },
      { ...base, id: id("missing"), title: `${this.stamp} missing fixture`, storageKey: `exams/${id("missing")}.pdf`, category: "EXAM" as const },
      ...["../../.env", "../../package.json", "exams/../../../.env", "C:/Windows/win.ini", "/etc/passwd", "..\\..\\.env"].map((storageKey, index) => (
        { ...base, id: id(`unsafe${index}`), title: `${this.stamp} unsafe fixture ${index}`, storageKey, category: "EXAM" as const }
      )),
    ];
    for (const record of records) await this.db.courseFile.create({ data: record });
    this.fixtures = { examFileId: id("exam"), materialFileId: id("material"), missingFileId: id("missing"), unsafeFileIds: records.slice(3).map(record => record.id) };
  }
}

// A minimal valid PDF: the upload service checks the "%PDF-" signature, the file route serves the bytes back.
export function pdfBytes(text: string) {
  const stream = `BT /F1 12 Tf 50 750 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  return Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n` +
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n` +
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
}
