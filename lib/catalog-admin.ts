import { db } from "@/lib/db";
import { logError } from "@/lib/logger";

export type CatalogEntity = "faculty" | "course" | "professor" | "term";
export type CatalogError = "invalid_fields" | "duplicate_code" | "duplicate_name" | "not_found" | "unknown_faculty" | "unknown_professor";
export type SaveResult = { ok: true; id: string } | { ok: false; error: CatalogError; value?: string };

export const MAX_NAME_LENGTH = 120;
const CODE_PATTERN = /^[A-Z0-9]{2,20}$/;

// Codes are stored in one canonical form, so "eece 350" and "EECE350" are the same course, as in Member 2's search.
export const normalizeCode = (code: string) => code.replace(/\s+/g, "").toUpperCase();
export const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");

const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");
const errorCode = (error: unknown) => (typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined);
const validName = (name: string) => name.length > 0 && name.length <= MAX_NAME_LENGTH;
const excluding = (id?: string) => (id ? { NOT: { id } } : {});

function reject(entity: CatalogEntity, error: CatalogError, entryId?: string, value?: string): SaveResult {
  logError("catalog_entry_rejected", { entity, reason: error, entryId });
  return { ok: false, error, ...(value ? { value } : {}) };
}

async function save(entity: CatalogEntity, id: string | undefined, value: string, write: () => Promise<SaveResult>): Promise<SaveResult> {
  try {
    return await write();
  } catch (error) {
    // P2002: a concurrent save took the same code or name after the duplicate check. P2025: the entry was not found.
    if (errorCode(error) === "P2002") return reject(entity, entity === "term" ? "duplicate_name" : "duplicate_code", id, value);
    if (errorCode(error) === "P2025") return reject(entity, "not_found", id);
    logError("catalog_entry_save_failed", { entity, operation: id ? "update" : "create", entryId: id, errorType: errorType(error) });
    throw error;
  }
}

async function read<T>(entity: CatalogEntity | "catalog", entryId: string | undefined, query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    logError("catalog_admin_retrieval_failed", { entity, entryId, errorType: errorType(error) });
    throw error;
  }
}

export function getCatalogAdminData() {
  return read("catalog", undefined, async () => {
    const [faculties, courses, professors, terms] = await Promise.all([
      db.faculty.findMany({ orderBy: { code: "asc" } }),
      db.course.findMany({ include: { faculty: true, professors: { include: { professor: true } } }, orderBy: { code: "asc" } }),
      db.professor.findMany({ orderBy: { name: "asc" } }),
      db.term.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
    return { faculties, courses, professors, terms };
  });
}

export const getFaculty = (id: string) => read("faculty", id, () => db.faculty.findUnique({ where: { id } }));
export const getCourse = (id: string) => read("course", id, () => db.course.findUnique({ where: { id }, include: { professors: true } }));
export const getProfessor = (id: string) => read("professor", id, () => db.professor.findUnique({ where: { id } }));
export const getTerm = (id: string) => read("term", id, () => db.term.findUnique({ where: { id } }));

export async function saveFaculty(input: { id?: string; code: string; name: string }): Promise<SaveResult> {
  const code = normalizeCode(input.code);
  const name = cleanName(input.name);
  if (!CODE_PATTERN.test(code) || !validName(name)) return reject("faculty", "invalid_fields", input.id);
  return save("faculty", input.id, code, async () => {
    const duplicate = await db.faculty.findFirst({ where: { code: { equals: code, mode: "insensitive" }, ...excluding(input.id) }, select: { id: true } });
    if (duplicate) return reject("faculty", "duplicate_code", input.id, code);
    const faculty = input.id
      ? await db.faculty.update({ where: { id: input.id }, data: { code, name } })
      : await db.faculty.create({ data: { code, name } });
    return { ok: true, id: faculty.id };
  });
}

export async function saveCourse(input: { id?: string; code: string; name: string; facultyId: string; professorIds: string[] }): Promise<SaveResult> {
  const code = normalizeCode(input.code);
  const name = cleanName(input.name);
  const professorIds = [...new Set(input.professorIds.filter(Boolean))];
  if (!CODE_PATTERN.test(code) || !validName(name) || !input.facultyId) return reject("course", "invalid_fields", input.id);
  return save("course", input.id, code, async () => {
    const duplicate = await db.course.findFirst({ where: { code: { equals: code, mode: "insensitive" }, ...excluding(input.id) }, select: { id: true } });
    if (duplicate) return reject("course", "duplicate_code", input.id, code);
    if (!(await db.faculty.findUnique({ where: { id: input.facultyId }, select: { id: true } }))) return reject("course", "unknown_faculty", input.id);
    if (professorIds.length && (await db.professor.count({ where: { id: { in: professorIds } } })) !== professorIds.length) {
      return reject("course", "unknown_professor", input.id);
    }
    const id = await db.$transaction(async tx => {
      const data = { code, name, facultyId: input.facultyId };
      const course = input.id ? await tx.course.update({ where: { id: input.id }, data }) : await tx.course.create({ data });
      if (input.id) await tx.courseProfessor.deleteMany({ where: { courseId: course.id, professorId: { notIn: professorIds } } });
      if (professorIds.length) {
        await tx.courseProfessor.createMany({ data: professorIds.map(professorId => ({ courseId: course.id, professorId })), skipDuplicates: true });
      }
      return course.id;
    });
    return { ok: true, id };
  });
}

export async function saveProfessor(input: { id?: string; name: string }): Promise<SaveResult> {
  const name = cleanName(input.name);
  if (!validName(name)) return reject("professor", "invalid_fields", input.id);
  return save("professor", input.id, name, async () => {
    const professor = input.id
      ? await db.professor.update({ where: { id: input.id }, data: { name } })
      : await db.professor.create({ data: { name } });
    return { ok: true, id: professor.id };
  });
}

export async function saveTerm(input: { id?: string; name: string }): Promise<SaveResult> {
  const name = cleanName(input.name);
  if (!validName(name)) return reject("term", "invalid_fields", input.id);
  return save("term", input.id, name, async () => {
    const duplicate = await db.term.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...excluding(input.id) }, select: { id: true } });
    if (duplicate) return reject("term", "duplicate_name", input.id, name);
    const term = input.id
      ? await db.term.update({ where: { id: input.id }, data: { name } })
      : await db.term.create({ data: { name } });
    return { ok: true, id: term.id };
  });
}
