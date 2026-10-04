import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, logError } = vi.hoisted(() => {
  const model = () => ({ findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() });
  const db = {
    faculty: model(), course: model(), professor: model(), term: model(),
    courseProfessor: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, logError: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/logger", () => ({ logError }));
import {
  cleanName, getCatalogAdminData, getCourse, getFaculty, normalizeCode, saveCourse, saveFaculty, saveProfessor, saveTerm,
} from "@/lib/catalog-admin";

const uniqueViolation = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
const recordNotFound = () => Object.assign(new Error("Record to update not found"), { code: "P2025" });
const databaseDown = () => Object.assign(new Error("connection refused at postgres://secret"), { name: "PrismaClientInitializationError" });
const loggedText = () => JSON.stringify(logError.mock.calls);
const course = { code: "EECE 351", name: "  Signals   and Systems ", facultyId: "faculty-eng", professorIds: ["prof-a", "prof-b", "prof-a"] };

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of [db.faculty, db.course, db.professor, db.term]) {
    model.findFirst.mockResolvedValue(null);
    model.create.mockImplementation(async ({ data }) => ({ id: "new-id", ...data }));
    model.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
  }
  db.faculty.findUnique.mockResolvedValue({ id: "faculty-eng" });
  db.professor.count.mockImplementation(async ({ where }) => where.id.in.length);
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => unknown) => work(db));
});

describe("normalizing input", () => {
  it("removes spaces and capitalizes codes, so a code written two ways is one code", () => {
    expect(normalizeCode("eece 350")).toBe("EECE350");
    expect(normalizeCode(" EECE350 ")).toBe("EECE350");
    expect(normalizeCode("Eece\t3 50")).toBe("EECE350");
  });
  it("trims names and collapses inner spaces", () => {
    expect(cleanName("  Computer   Networks ")).toBe("Computer Networks");
  });
});

describe("saving a course", () => {
  it("creates the course with a canonical code and assigns each professor once", async () => {
    expect(await saveCourse(course)).toEqual({ ok: true, id: "new-id" });
    expect(db.course.create).toHaveBeenCalledWith({ data: { code: "EECE351", name: "Signals and Systems", facultyId: "faculty-eng" } });
    expect(db.courseProfessor.createMany).toHaveBeenCalledWith({
      data: [{ courseId: "new-id", professorId: "prof-a" }, { courseId: "new-id", professorId: "prof-b" }], skipDuplicates: true,
    });
    expect(db.courseProfessor.deleteMany).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });
  it("refuses a code that already exists, however it is spaced or capitalized", async () => {
    db.course.findFirst.mockResolvedValue({ id: "course-eece350" });
    expect(await saveCourse({ ...course, code: "eece 350" })).toEqual({ ok: false, error: "duplicate_code", value: "EECE350" });
    expect(db.course.findFirst).toHaveBeenCalledWith({ where: { code: { equals: "EECE350", mode: "insensitive" } }, select: { id: true } });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("catalog_entry_rejected", { entity: "course", reason: "duplicate_code", entryId: undefined });
  });
  it("reports a duplicate created by a racing save as a duplicate, not a failure", async () => {
    db.$transaction.mockRejectedValue(uniqueViolation());
    expect(await saveCourse(course)).toEqual({ ok: false, error: "duplicate_code", value: "EECE351" });
    expect(logError).toHaveBeenCalledWith("catalog_entry_rejected", { entity: "course", reason: "duplicate_code", entryId: undefined });
  });
  it("lets a course keep its own code when edited, but not take another course's code", async () => {
    expect(await saveCourse({ ...course, id: "course-1", code: "EECE351" })).toEqual({ ok: true, id: "course-1" });
    expect(db.course.findFirst).toHaveBeenCalledWith({ where: { code: { equals: "EECE351", mode: "insensitive" }, NOT: { id: "course-1" } }, select: { id: true } });
    db.course.findFirst.mockResolvedValue({ id: "course-eece350" });
    expect(await saveCourse({ ...course, id: "course-1", code: "EECE350" })).toEqual({ ok: false, error: "duplicate_code", value: "EECE350" });
  });
  it("updates the course and replaces its professors", async () => {
    expect(await saveCourse({ ...course, id: "course-1", professorIds: ["prof-c"] })).toEqual({ ok: true, id: "course-1" });
    expect(db.course.update).toHaveBeenCalledWith({ where: { id: "course-1" }, data: { code: "EECE351", name: "Signals and Systems", facultyId: "faculty-eng" } });
    expect(db.courseProfessor.deleteMany).toHaveBeenCalledWith({ where: { courseId: "course-1", professorId: { notIn: ["prof-c"] } } });
    expect(db.courseProfessor.createMany).toHaveBeenCalledWith({ data: [{ courseId: "course-1", professorId: "prof-c" }], skipDuplicates: true });
  });
  it("removes every professor when none are ticked", async () => {
    await saveCourse({ ...course, id: "course-1", professorIds: [] });
    expect(db.courseProfessor.deleteMany).toHaveBeenCalledWith({ where: { courseId: "course-1", professorId: { notIn: [] } } });
    expect(db.courseProfessor.createMany).not.toHaveBeenCalled();
    expect(db.professor.count).not.toHaveBeenCalled();
  });
  it("refuses missing or malformed fields without touching the database", async () => {
    for (const input of [{ ...course, code: "" }, { ...course, code: "EECE-350" }, { ...course, code: "E" }, { ...course, name: "   " }, { ...course, name: "x".repeat(121) }, { ...course, facultyId: "" }]) {
      expect(await saveCourse(input)).toEqual({ ok: false, error: "invalid_fields" });
    }
    expect(db.course.findFirst).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("refuses an unknown faculty or professor before writing", async () => {
    db.faculty.findUnique.mockResolvedValue(null);
    expect(await saveCourse(course)).toEqual({ ok: false, error: "unknown_faculty" });
    db.faculty.findUnique.mockResolvedValue({ id: "faculty-eng" });
    db.professor.count.mockResolvedValue(1);
    expect(await saveCourse(course)).toEqual({ ok: false, error: "unknown_professor" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("reports an edited course that no longer exists", async () => {
    db.$transaction.mockRejectedValue(recordNotFound());
    expect(await saveCourse({ ...course, id: "ghost" })).toEqual({ ok: false, error: "not_found" });
  });
  it("logs and rethrows other database failures without the code, name, or error message", async () => {
    const error = databaseDown();
    db.$transaction.mockRejectedValue(error);
    await expect(saveCourse({ ...course, id: "course-1" })).rejects.toBe(error);
    expect(logError).toHaveBeenCalledWith("catalog_entry_save_failed", { entity: "course", operation: "update", entryId: "course-1", errorType: "PrismaClientInitializationError" });
    expect(loggedText()).not.toMatch(/EECE351|Signals|secret/);
  });
});

describe("saving a faculty", () => {
  it("creates and updates a faculty with a canonical code", async () => {
    expect(await saveFaculty({ code: " med ", name: "Faculty of Medicine" })).toEqual({ ok: true, id: "new-id" });
    expect(db.faculty.create).toHaveBeenCalledWith({ data: { code: "MED", name: "Faculty of Medicine" } });
    expect(await saveFaculty({ id: "faculty-eng", code: "ENG", name: "Maroun Semaan Faculty of Engineering" })).toEqual({ ok: true, id: "faculty-eng" });
    expect(db.faculty.update).toHaveBeenCalledWith({ where: { id: "faculty-eng" }, data: { code: "ENG", name: "Maroun Semaan Faculty of Engineering" } });
  });
  it("refuses a duplicate code, from the check or from the unique index", async () => {
    db.faculty.findFirst.mockResolvedValueOnce({ id: "faculty-eng" });
    expect(await saveFaculty({ code: "eng", name: "Engineering" })).toEqual({ ok: false, error: "duplicate_code", value: "ENG" });
    db.faculty.create.mockRejectedValueOnce(uniqueViolation());
    expect(await saveFaculty({ code: "MED", name: "Medicine" })).toEqual({ ok: false, error: "duplicate_code", value: "MED" });
  });
  it("refuses an empty code or name", async () => {
    expect(await saveFaculty({ code: "", name: "Medicine" })).toEqual({ ok: false, error: "invalid_fields" });
    expect(await saveFaculty({ code: "MED", name: "" })).toEqual({ ok: false, error: "invalid_fields" });
    expect(db.faculty.create).not.toHaveBeenCalled();
  });
});

describe("saving a professor", () => {
  it("creates and renames a professor, allowing two professors with the same name", async () => {
    expect(await saveProfessor({ name: " Professor   D " })).toEqual({ ok: true, id: "new-id" });
    expect(db.professor.create).toHaveBeenCalledWith({ data: { name: "Professor D" } });
    expect(await saveProfessor({ id: "prof-a", name: "Professor A. Haddad" })).toEqual({ ok: true, id: "prof-a" });
    expect(db.professor.findFirst).not.toHaveBeenCalled();
  });
  it("refuses an empty name", async () => {
    expect(await saveProfessor({ name: " " })).toEqual({ ok: false, error: "invalid_fields" });
    expect(logError).toHaveBeenCalledWith("catalog_entry_rejected", { entity: "professor", reason: "invalid_fields", entryId: undefined });
  });
  it("reports a professor that no longer exists", async () => {
    db.professor.update.mockRejectedValue(recordNotFound());
    expect(await saveProfessor({ id: "ghost", name: "Professor Z" })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("saving a term", () => {
  it("creates and renames a term", async () => {
    expect(await saveTerm({ name: "Winter" })).toEqual({ ok: true, id: "new-id" });
    expect(await saveTerm({ id: "term-fall", name: "Fall " })).toEqual({ ok: true, id: "term-fall" });
    expect(db.term.update).toHaveBeenCalledWith({ where: { id: "term-fall" }, data: { name: "Fall" } });
  });
  it("refuses a name that already exists in any capitalization", async () => {
    db.term.findFirst.mockResolvedValue({ id: "term-fall" });
    expect(await saveTerm({ name: "fall" })).toEqual({ ok: false, error: "duplicate_name", value: "fall" });
    expect(db.term.findFirst).toHaveBeenCalledWith({ where: { name: { equals: "fall", mode: "insensitive" } }, select: { id: true } });
    db.term.findFirst.mockResolvedValue(null);
    db.term.create.mockRejectedValue(uniqueViolation());
    expect(await saveTerm({ name: "Fall" })).toEqual({ ok: false, error: "duplicate_name", value: "Fall" });
  });
});

describe("reading the catalog", () => {
  it("loads faculties, courses with faculty and professors, professors, and terms", async () => {
    db.faculty.findMany.mockResolvedValue([{ id: "faculty-eng" }]);
    db.course.findMany.mockResolvedValue([{ id: "course-eece350" }]);
    db.professor.findMany.mockResolvedValue([{ id: "prof-a" }]);
    db.term.findMany.mockResolvedValue([{ id: "term-fall" }]);
    expect(await getCatalogAdminData()).toEqual({ faculties: [{ id: "faculty-eng" }], courses: [{ id: "course-eece350" }], professors: [{ id: "prof-a" }], terms: [{ id: "term-fall" }] });
    expect(db.course.findMany).toHaveBeenCalledWith({ include: { faculty: true, professors: { include: { professor: true } } }, orderBy: { code: "asc" } });
  });
  it("returns null for an unknown entry", async () => {
    db.faculty.findUnique.mockResolvedValue(null);
    expect(await getFaculty("ghost")).toBeNull();
  });
  it("logs and rethrows a failed read", async () => {
    const error = databaseDown();
    db.course.findUnique.mockRejectedValue(error);
    await expect(getCourse("course-1")).rejects.toBe(error);
    expect(logError).toHaveBeenCalledWith("catalog_admin_retrieval_failed", { entity: "course", entryId: "course-1", errorType: "PrismaClientInitializationError" });
    db.term.findMany.mockRejectedValue(error);
    await expect(getCatalogAdminData()).rejects.toBe(error);
    expect(logError).toHaveBeenCalledWith("catalog_admin_retrieval_failed", { entity: "catalog", entryId: undefined, errorType: "PrismaClientInitializationError" });
  });
});
