import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { course, courseProfessor, term, courseFile } = vi.hoisted(() => ({
  course: { findUnique: vi.fn() }, courseProfessor: { findUnique: vi.fn() }, term: { findUnique: vi.fn(), findMany: vi.fn() },
  courseFile: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: { course, courseProfessor, term, courseFile } }));
import { checkFileMetadata, getAdminFile, getAdminFiles, getTermOptions, parseFileMetadata, saveFileMetadata } from "@/lib/file-metadata";
import { examTypeLabel, fileMetadataMessage } from "@/lib/file-metadata-rules";

const now = new Date("2026-10-05T00:00:00Z");
const form = (fields: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [name, value] of Object.entries({ courseId: "course-eece350", ...fields })) data.set(name, value);
  return data;
};
const full = { courseId: "course-eece330", professorId: "prof-b", termId: "term-fall", year: "2025", topic: "  Hashing  ", examType: "MIDTERM" };

let errors: ReturnType<typeof vi.spyOn>;
const logged = () => errors.mock.calls.map(call => JSON.parse(String(call[0])));

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  course.findUnique.mockReset().mockResolvedValue({ id: "course-eece330" });
  courseProfessor.findUnique.mockReset().mockResolvedValue({ courseId: "course-eece330" });
  term.findUnique.mockReset().mockResolvedValue({ id: "term-fall" });
  term.findMany.mockReset();
  courseFile.findUnique.mockReset().mockResolvedValue({ category: "EXAM" });
  courseFile.findMany.mockReset();
  courseFile.update.mockReset().mockResolvedValue({ id: "file-1" });
});
afterEach(() => errors.mockRestore());

describe("parsing file metadata", () => {
  it("reads every field and trims text", () => {
    expect(parseFileMetadata(form(full), "EXAM", now)).toEqual({
      ok: true,
      metadata: { courseId: "course-eece330", professorId: "prof-b", termId: "term-fall", year: 2025, topic: "Hashing", examType: "MIDTERM" },
    });
  });
  it("leaves blank optional fields undefined", () => {
    expect(parseFileMetadata(form({ professorId: "", termId: " ", year: "", topic: "  ", examType: "" }), "MATERIAL", now)).toEqual({
      ok: true, metadata: { courseId: "course-eece350", professorId: undefined, termId: undefined, year: undefined, topic: undefined, examType: undefined },
    });
  });
  it("requires a course", () => {
    expect(parseFileMetadata(form({ courseId: "" }), "EXAM", now)).toEqual({ ok: false, error: "course_required" });
    expect(parseFileMetadata(form({ courseId: "   " }), "EXAM", now)).toEqual({ ok: false, error: "course_required" });
    expect(parseFileMetadata(new FormData(), "EXAM", now)).toEqual({ ok: false, error: "course_required" });
  });
  it.each(["25", "abcd", "1949", "2028", "2025.5", "02025", "-2025"])("refuses the year %s", year => {
    expect(parseFileMetadata(form({ year }), "EXAM", now)).toEqual({ ok: false, error: "invalid_year" });
  });
  it.each(["1950", "2026", "2027"])("accepts the year %s", year => {
    expect(parseFileMetadata(form({ year }), "EXAM", now)).toMatchObject({ ok: true, metadata: { year: Number(year) } });
  });
  it("refuses a topic over 100 characters", () => {
    expect(parseFileMetadata(form({ topic: "x".repeat(101) }), "EXAM", now)).toEqual({ ok: false, error: "topic_too_long" });
    expect(parseFileMetadata(form({ topic: "x".repeat(100) }), "EXAM", now)).toMatchObject({ ok: true });
  });
  it("allows a type only on exams and only from the list", () => {
    for (const examType of ["MIDTERM", "FINAL", "QUIZ", "OTHER"]) expect(parseFileMetadata(form({ examType }), "EXAM", now)).toMatchObject({ ok: true, metadata: { examType } });
    expect(parseFileMetadata(form({ examType: "final" }), "EXAM", now)).toEqual({ ok: false, error: "invalid_type" });
    expect(parseFileMetadata(form({ examType: "Session" }), "EXAM", now)).toEqual({ ok: false, error: "invalid_type" });
    expect(parseFileMetadata(form({ examType: "FINAL" }), "MATERIAL", now)).toEqual({ ok: false, error: "type_not_allowed" });
  });
});

describe("checking file metadata references", () => {
  const metadata = { courseId: "course-eece330", professorId: "prof-b", termId: "term-fall" };
  it("accepts an existing course, a professor of that course, and an existing term", async () => {
    expect(await checkFileMetadata(metadata)).toBeNull();
    expect(courseProfessor.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { courseId_professorId: { courseId: "course-eece330", professorId: "prof-b" } } }));
  });
  it("refuses an unknown course before anything else", async () => {
    course.findUnique.mockResolvedValue(null);
    expect(await checkFileMetadata(metadata)).toBe("course_not_found");
    expect(courseProfessor.findUnique).not.toHaveBeenCalled();
  });
  it("refuses a professor who doesn't teach the selected course", async () => {
    courseProfessor.findUnique.mockResolvedValue(null);
    expect(await checkFileMetadata(metadata)).toBe("professor_not_assigned");
  });
  it("refuses an unknown term", async () => {
    term.findUnique.mockResolvedValue(null);
    expect(await checkFileMetadata(metadata)).toBe("term_not_found");
  });
  it("skips the professor and term checks when they are not set", async () => {
    expect(await checkFileMetadata({ courseId: "course-eece330" })).toBeNull();
    expect(courseProfessor.findUnique).not.toHaveBeenCalled();
    expect(term.findUnique).not.toHaveBeenCalled();
  });
});

describe("saving file metadata", () => {
  it("saves every value on the file", async () => {
    expect(await saveFileMetadata("file-1", form(full), now)).toEqual({ ok: true, id: "file-1", courseId: "course-eece330" });
    expect(courseFile.update).toHaveBeenCalledWith({
      where: { id: "file-1" },
      data: { courseId: "course-eece330", professorId: "prof-b", termId: "term-fall", year: 2025, topic: "Hashing", examType: "MIDTERM" },
    });
    expect(errors).not.toHaveBeenCalled();
  });
  it("clears optional values left blank", async () => {
    await saveFileMetadata("file-1", form({ courseId: "course-eece330" }), now);
    expect(courseFile.update.mock.calls[0][0].data).toEqual({ courseId: "course-eece330", professorId: null, termId: null, year: null, topic: null, examType: null });
  });
  it("refuses a missing course without writing and logs the reason only", async () => {
    expect(await saveFileMetadata("file-1", form({ ...full, courseId: "" }), now)).toEqual({ ok: false, error: "course_required" });
    expect(courseFile.update).not.toHaveBeenCalled();
    expect(logged()).toEqual([expect.objectContaining({ event: "file_metadata_rejected", fileId: "file-1", reason: "course_required" })]);
  });
  it("checks the type against the stored category", async () => {
    courseFile.findUnique.mockResolvedValue({ category: "MATERIAL" });
    expect(await saveFileMetadata("file-1", form({ examType: "FINAL" }), now)).toEqual({ ok: false, error: "type_not_allowed" });
    expect(courseFile.update).not.toHaveBeenCalled();
  });
  it.each([
    ["course_not_found", () => course.findUnique.mockResolvedValue(null)],
    ["professor_not_assigned", () => courseProfessor.findUnique.mockResolvedValue(null)],
    ["term_not_found", () => term.findUnique.mockResolvedValue(null)],
  ])("refuses %s without writing", async (error, arrange) => {
    arrange();
    expect(await saveFileMetadata("file-1", form(full), now)).toEqual({ ok: false, error });
    expect(courseFile.update).not.toHaveBeenCalled();
  });
  it("reports a missing or deleted file as not found", async () => {
    expect(await saveFileMetadata("", form(full), now)).toEqual({ ok: false, error: "not_found" });
    courseFile.findUnique.mockResolvedValue(null);
    expect(await saveFileMetadata("ghost", form(full), now)).toEqual({ ok: false, error: "not_found" });
    courseFile.findUnique.mockResolvedValue({ category: "EXAM" });
    courseFile.update.mockRejectedValue(Object.assign(new Error("Record to update not found."), { code: "P2025" }));
    expect(await saveFileMetadata("file-1", form(full), now)).toEqual({ ok: false, error: "not_found" });
  });
  it("logs and rethrows an unexpected failure without the typed text", async () => {
    courseFile.update.mockRejectedValue(new Error("database down: Hashing"));
    await expect(saveFileMetadata("file-1", form(full), now)).rejects.toThrow("database down");
    expect(logged()).toEqual([expect.objectContaining({ event: "file_metadata_save_failed", fileId: "file-1", errorType: "Error" })]);
    const text = JSON.stringify(logged());
    for (const typed of ["Hashing", "database down"]) expect(text).not.toContain(typed);
  });
  it("never logs the topic of a refused save", async () => {
    await saveFileMetadata("file-1", form({ ...full, year: "1900", topic: "Secret Topic" }), now);
    expect(JSON.stringify(logged())).not.toContain("Secret Topic");
  });
});

describe("reading files and terms", () => {
  it("lists all files or one course's files", async () => {
    courseFile.findMany.mockResolvedValue([]);
    await getAdminFiles();
    await getAdminFiles("course-eece350");
    expect(courseFile.findMany.mock.calls[0][0].where).toEqual({});
    expect(courseFile.findMany.mock.calls[1][0].where).toEqual({ courseId: "course-eece350" });
  });
  it("reads one file and the terms", async () => {
    courseFile.findUnique.mockResolvedValue({ id: "file-1" });
    term.findMany.mockResolvedValue([{ id: "term-fall", name: "Fall" }]);
    expect(await getAdminFile("file-1")).toEqual({ id: "file-1" });
    expect(await getTermOptions()).toEqual([{ id: "term-fall", name: "Fall" }]);
  });
  it("logs and rethrows retrieval failures", async () => {
    courseFile.findMany.mockRejectedValue(new Error("database down"));
    term.findMany.mockRejectedValue(new Error("database down"));
    await expect(getAdminFiles("course-eece350")).rejects.toThrow("database down");
    await expect(getTermOptions()).rejects.toThrow("database down");
    expect(logged()).toEqual([
      expect.objectContaining({ event: "file_metadata_retrieval_failed", entity: "files", courseId: "course-eece350", errorType: "Error" }),
      expect.objectContaining({ event: "file_metadata_retrieval_failed", entity: "terms", errorType: "Error" }),
    ]);
  });
});

describe("messages and labels", () => {
  it("explains every reason", () => {
    expect(fileMetadataMessage("course_required")).toBe("Choose a course.");
    expect(fileMetadataMessage("invalid_year", now)).toBe("Year must be a 4-digit year between 1950 and 2027.");
    expect(fileMetadataMessage("professor_not_assigned")).toBe("The selected professor doesn't teach the selected course.");
    expect(fileMetadataMessage("term_not_found")).toBe("The selected term doesn't exist.");
    expect(fileMetadataMessage("type_not_allowed")).toBe("Only exams have a type.");
    expect(fileMetadataMessage("something else")).toBe("Something went wrong. Please try again.");
  });
  it("labels exam types", () => {
    expect(examTypeLabel("MIDTERM")).toBe("Midterm");
    expect(examTypeLabel("OTHER")).toBe("Other");
  });
});
