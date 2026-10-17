import { cleanName } from "@/lib/catalog-admin";
import { db } from "@/lib/db";
import { errorCode, logError } from "@/lib/logger";
import { PROFILE_MAJOR_MAX_LENGTH, PROFILE_NAME_MAX_LENGTH, type ProfileError, type ProfileValues } from "@/lib/profile-rules";

// The student's own profile (US-04). Every function takes the user ID from the caller, which is always the session user
// (requireUser in lib/auth.ts); nothing here reads an ID from a URL or a form.

export type ProfileResult = { ok: true; values: ProfileValues } | { ok: false; error: ProfileError };

const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");

async function read<T>(context: Record<string, string | undefined>, query: () => Promise<T>) {
  try {
    return await query();
  } catch (error) {
    logError("profile_retrieval_failed", { ...context, errorType: errorType(error) });
    throw error;
  }
}

export const getProfile = (userId: string) => read({ entity: "profile", userId }, () => db.user.findUnique({
  where: { id: userId }, select: { id: true, name: true, email: true, facultyId: true, major: true },
}));

export const getFacultyOptions = () => read({ entity: "faculties" }, () => db.faculty.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }));

function reject(userId: string, error: ProfileError): ProfileResult {
  logError("profile_save_rejected", { userId, reason: error });
  return { ok: false, error };
}

// Saves the name, faculty, and major of the given user. An empty faculty or major clears it.
export async function saveProfile(userId: string, input: ProfileValues): Promise<ProfileResult> {
  const name = cleanName(input.name);
  const major = cleanName(input.major);
  const facultyId = input.facultyId.trim();
  if (!name) return reject(userId, "name_required");
  if (name.length > PROFILE_NAME_MAX_LENGTH) return reject(userId, "name_too_long");
  if (major.length > PROFILE_MAJOR_MAX_LENGTH) return reject(userId, "major_too_long");
  try {
    if (facultyId && !(await db.faculty.findUnique({ where: { id: facultyId }, select: { id: true } }))) return reject(userId, "faculty_not_found");
    await db.user.update({ where: { id: userId }, data: { name, facultyId: facultyId || null, major: major || null } });
    return { ok: true, values: { name, facultyId, major } };
  } catch (error) {
    // P2003: the faculty was deleted between the check and the save. P2025: the account no longer exists.
    if (errorCode(error) === "P2003") return reject(userId, "faculty_not_found");
    logError("profile_save_failed", { userId, errorType: errorType(error), errorCode: errorCode(error) });
    return { ok: false, error: "unexpected" };
  }
}
