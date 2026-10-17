import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { user, faculty } = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  faculty: { findUnique: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: { user, faculty } }));
import { getFacultyOptions, getProfile, saveProfile } from "@/lib/profile";
import { PROFILE_MAJOR_MAX_LENGTH, PROFILE_NAME_MAX_LENGTH, profileMessage } from "@/lib/profile-rules";

const input = { name: "Lina Haddad", facultyId: "faculty-eng", major: "Computer Engineering" };
let errors: ReturnType<typeof vi.spyOn>;
const logged = () => errors.mock.calls.map(call => JSON.parse(String(call[0])));

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  user.findUnique.mockReset();
  user.update.mockReset().mockResolvedValue({});
  faculty.findUnique.mockReset().mockResolvedValue({ id: "faculty-eng" });
  faculty.findMany.mockReset().mockResolvedValue([]);
});
afterEach(() => errors.mockRestore());

describe("saveProfile (acceptance test 1)", () => {
  it("saves the name, faculty, and major of the given user only", async () => {
    expect(await saveProfile("user-a", input)).toEqual({ ok: true, values: input });
    expect(user.update).toHaveBeenCalledWith({ where: { id: "user-a" }, data: { name: "Lina Haddad", facultyId: "faculty-eng", major: "Computer Engineering" } });
    expect(logged()).toEqual([]);
  });
  it("tidies spacing", async () => {
    const result = await saveProfile("user-a", { name: "  Lina   Haddad ", facultyId: " faculty-eng ", major: " Computer   Engineering  " });
    expect(result).toEqual({ ok: true, values: input });
  });
  it("clears an empty faculty and major", async () => {
    await saveProfile("user-a", { name: "Lina", facultyId: "", major: "   " });
    expect(user.update).toHaveBeenCalledWith({ where: { id: "user-a" }, data: { name: "Lina", facultyId: null, major: null } });
    expect(faculty.findUnique).not.toHaveBeenCalled();
  });
  it("accepts a name and major at the limit", async () => {
    expect(await saveProfile("user-a", { ...input, name: "n".repeat(PROFILE_NAME_MAX_LENGTH), major: "m".repeat(PROFILE_MAJOR_MAX_LENGTH) })).toMatchObject({ ok: true });
  });
});

describe("saveProfile refusals (acceptance test 2)", () => {
  it.each([
    ["an empty name", { name: "" }, "name_required"],
    ["a name of spaces only", { name: "   " }, "name_required"],
    ["a name over the limit", { name: "n".repeat(PROFILE_NAME_MAX_LENGTH + 1) }, "name_too_long"],
    ["a major over the limit", { major: "m".repeat(PROFILE_MAJOR_MAX_LENGTH + 1) }, "major_too_long"],
  ])("refuses %s without saving", async (_case, change, error) => {
    expect(await saveProfile("user-a", { ...input, ...change })).toEqual({ ok: false, error });
    expect(user.update).not.toHaveBeenCalled();
    expect(logged()).toEqual([expect.objectContaining({ event: "profile_save_rejected", level: "warn", userId: "user-a", reason: error })]);
  });
  it("refuses a faculty that doesn't exist", async () => {
    faculty.findUnique.mockResolvedValue(null);
    expect(await saveProfile("user-a", { ...input, facultyId: "ghost" })).toEqual({ ok: false, error: "faculty_not_found" });
    expect(user.update).not.toHaveBeenCalled();
  });
  it("refuses a faculty deleted between the check and the save", async () => {
    user.update.mockRejectedValue(Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" }));
    expect(await saveProfile("user-a", input)).toEqual({ ok: false, error: "faculty_not_found" });
  });
  it("logs a database failure by type and code, never the typed text", async () => {
    user.update.mockRejectedValue(Object.assign(new Error("Record Lina Haddad not found"), { name: "PrismaClientKnownRequestError", code: "P2025" }));
    expect(await saveProfile("user-a", input)).toEqual({ ok: false, error: "unexpected" });
    expect(logged()).toEqual([expect.objectContaining({ event: "profile_save_failed", level: "error", userId: "user-a", errorType: "PrismaClientKnownRequestError", errorCode: "P2025" })]);
    expect(JSON.stringify(logged())).not.toMatch(/Lina|Haddad|Computer/);
  });
  it("has a message for every error", () => {
    expect(profileMessage("name_required")).toBe("Enter your name.");
    expect(profileMessage("name_too_long")).toBe("Your name must be 100 characters or fewer.");
    expect(profileMessage("major_too_long")).toBe("Your major must be 100 characters or fewer.");
    expect(profileMessage("faculty_not_found")).toContain("faculty");
    expect(profileMessage("unexpected")).toBe("Your profile could not be saved. Please try again.");
  });
});

describe("reading the profile", () => {
  it("reads one user's profile and the faculties by name", async () => {
    user.findUnique.mockResolvedValue({ id: "user-a" });
    expect(await getProfile("user-a")).toEqual({ id: "user-a" });
    expect(user.findUnique).toHaveBeenCalledWith({ where: { id: "user-a" }, select: { id: true, name: true, email: true, facultyId: true, major: true } });
    await getFacultyOptions();
    expect(faculty.findMany).toHaveBeenCalledWith({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  });
  it("logs and rethrows a read failure", async () => {
    user.findUnique.mockRejectedValue(new TypeError("boom"));
    await expect(getProfile("user-a")).rejects.toThrow("boom");
    expect(logged()).toEqual([expect.objectContaining({ event: "profile_retrieval_failed", entity: "profile", userId: "user-a", errorType: "TypeError" })]);
  });
});
