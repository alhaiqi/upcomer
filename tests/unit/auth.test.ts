import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { userCreate, userFindUnique, sessionCreate, sessionFindUnique, sessionDeleteMany, logError, redirect, notFound, cookieStore } = vi.hoisted(() => ({
  userCreate: vi.fn(), userFindUnique: vi.fn(),
  sessionCreate: vi.fn(), sessionFindUnique: vi.fn(), sessionDeleteMany: vi.fn(),
  logError: vi.fn(), redirect: vi.fn(), notFound: vi.fn(),
  cookieStore: {
    jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
    get(name: string) { const entry = this.jar.get(name); return entry ? { name, value: entry.value } : undefined; },
    set(name: string, value: string, options?: Record<string, unknown>) { this.jar.set(name, { value, options }); },
    delete(name: string) { this.jar.delete(name); },
    options(name: string) { return this.jar.get(name)?.options; },
  },
}));
vi.mock("@/lib/db", () => ({ db: { user: { create: userCreate, findUnique: userFindUnique }, session: { create: sessionCreate, findUnique: sessionFindUnique, deleteMany: sessionDeleteMany } } }));
vi.mock("@/lib/logger", () => ({ logError }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({ redirect, notFound }));
import {
  SESSION_COOKIE, SESSION_TTL_MS, authenticate, createAccount, endSession, getAdminUser, getCurrentUser,
  normalizeEmail, requireAdmin, requireUser, safeNext, startSession, validateCredentials,
} from "@/lib/auth";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const student = { id: "user-1", email: "ali@mail.aub.edu", name: "Ali", role: "STUDENT" as const };
const admin = { ...student, id: "user-2", role: "ADMIN" as const };
const valid = { name: "Ali", email: "ali@mail.aub.edu", password: "password123" };
let storedHash = "";

beforeAll(async () => { storedHash = await bcrypt.hash(valid.password, 10); });

beforeEach(() => {
  for (const mock of [userCreate, userFindUnique, sessionCreate, sessionFindUnique, sessionDeleteMany, logError]) mock.mockReset();
  redirect.mockReset().mockImplementation((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); });
  notFound.mockReset().mockImplementation(() => { throw new Error("NEXT_NOT_FOUND"); });
  cookieStore.jar.clear();
  delete process.env.SIGNUP_EMAIL_DOMAIN;
});

describe("credential validation", () => {
  it("accepts a name, email and password, trimming the name and normalizing the email", () => {
    expect(validateCredentials({ name: "  Ali  ", email: " Ali@Mail.AUB.edu ", password: "password123" }))
      .toEqual({ valid: true, name: "Ali", email: "ali@mail.aub.edu", password: "password123" });
  });
  it.each([
    ["an empty name", { ...valid, name: "   " }, "name_required"],
    ["an email with no @", { ...valid, email: "ali.mail.aub.edu" }, "invalid_email"],
    ["an email with no domain dot", { ...valid, email: "ali@mail" }, "invalid_email"],
    ["an email with a space", { ...valid, email: "a li@mail.aub.edu" }, "invalid_email"],
    ["a 7-character password", { ...valid, password: "1234567" }, "weak_password"],
  ])("rejects %s", (_case, input, error) => {
    expect(validateCredentials(input)).toEqual({ valid: false, error });
  });
  it("rejects an outside domain only when SIGNUP_EMAIL_DOMAIN is set", () => {
    expect(validateCredentials({ ...valid, email: "ali@gmail.com" })).toMatchObject({ valid: true });
    process.env.SIGNUP_EMAIL_DOMAIN = "@mail.aub.edu";
    expect(validateCredentials({ ...valid, email: "ali@gmail.com" })).toEqual({ valid: false, error: "domain_not_allowed" });
    expect(validateCredentials({ ...valid, email: "ALI@MAIL.AUB.EDU" })).toMatchObject({ valid: true });
  });
  it.each([
    ["/my-courses", "/my-courses"],
    ["/courses/course-a?added=1", "/courses/course-a?added=1"],
    ["//evil.example.com", "/my-courses"],
    ["/\\evil.example.com", "/my-courses"],
    ["https://evil.example.com", "/my-courses"],
    ["evil.example.com", "/my-courses"],
    ["", "/my-courses"],
    [undefined, "/my-courses"],
  ])("keeps %j as %j so a login link cannot leave the site", (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
  it("normalizes an email the same way everywhere", () => {
    expect(normalizeEmail("  Ali@Mail.AUB.edu ")).toBe("ali@mail.aub.edu");
  });
});

describe("account creation", () => {
  it("stores the normalized email with a bcrypt hash of the password", async () => {
    userCreate.mockImplementation(async ({ data }: { data: { passwordHash: string } }) => ({ ...student, ...data }));
    const result = await createAccount({ name: " Ali ", email: " ALI@mail.aub.edu ", password: valid.password });
    expect(result).toMatchObject({ created: true });
    const data = userCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: "Ali", email: "ali@mail.aub.edu" });
    expect(data.passwordHash).not.toBe(valid.password);
    expect(await bcrypt.compare(valid.password, data.passwordHash)).toBe(true);
    expect(logError).not.toHaveBeenCalled();
  });
  it("does not reach the database when the input is invalid", async () => {
    expect(await createAccount({ ...valid, password: "short" })).toEqual({ created: false, error: "weak_password" });
    expect(userCreate).not.toHaveBeenCalled();
  });
  it("reports a duplicate account and logs it without the email", async () => {
    userCreate.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    expect(await createAccount(valid)).toEqual({ created: false, error: "email_taken" });
    expect(logError).toHaveBeenCalledWith("signup_failed", { reason: "email_taken" });
  });
  it("reports and logs a database failure without the email", async () => {
    const error = new Error("connection refused");
    error.name = "PrismaClientInitializationError";
    userCreate.mockRejectedValue(error);
    expect(await createAccount(valid)).toEqual({ created: false, error: "unexpected" });
    expect(logError).toHaveBeenCalledWith("signup_failed", { reason: "db_error", errorType: "PrismaClientInitializationError" });
  });
});

describe("login", () => {
  it("returns the user for the right password, looked up by normalized email", async () => {
    userFindUnique.mockResolvedValue({ ...student, passwordHash: storedHash });
    expect(await authenticate(" ALI@mail.aub.edu ", valid.password)).toMatchObject({ user: { id: "user-1" } });
    expect(userFindUnique).toHaveBeenCalledWith({ where: { email: "ali@mail.aub.edu" } });
    expect(logError).not.toHaveBeenCalled();
  });
  it("gives the same answer for a wrong password and an unknown email", async () => {
    userFindUnique.mockResolvedValue({ ...student, passwordHash: storedHash });
    expect(await authenticate(student.email, "wrong-password")).toEqual({ error: "invalid_credentials" });
    userFindUnique.mockResolvedValue(null);
    expect(await authenticate("nobody@mail.aub.edu", valid.password)).toEqual({ error: "invalid_credentials" });
  });
  it("logs a failed login with the user ID only, never the email or password", async () => {
    userFindUnique.mockResolvedValue({ ...student, passwordHash: storedHash });
    await authenticate(student.email, "wrong-password");
    expect(logError).toHaveBeenCalledWith("login_failed", { reason: "invalid_credentials", userId: "user-1" });
    logError.mockReset();
    userFindUnique.mockResolvedValue(null);
    await authenticate(student.email, valid.password);
    expect(logError).toHaveBeenCalledWith("login_failed", { reason: "invalid_credentials", userId: undefined });
  });
  it("reports and logs a database failure", async () => {
    const error = new Error("timeout");
    error.name = "PrismaClientKnownRequestError";
    userFindUnique.mockRejectedValue(error);
    expect(await authenticate(student.email, valid.password)).toEqual({ error: "unexpected" });
    expect(logError).toHaveBeenCalledWith("login_failed", { reason: "db_error", errorType: "PrismaClientKnownRequestError" });
  });
});

describe("sessions", () => {
  it("stores only the hash of the token it puts in a hardened cookie", async () => {
    sessionCreate.mockResolvedValue({ id: "session-1" });
    const expiresAt = await startSession("user-1");
    const token = cookieStore.get(SESSION_COOKIE)!.value;
    expect(token.length).toBeGreaterThan(32);
    expect(sessionCreate).toHaveBeenCalledWith({ data: { userId: "user-1", tokenHash: sha256(token), expiresAt } });
    expect(JSON.stringify(sessionCreate.mock.calls[0][0])).not.toContain(token);
    expect(cookieStore.options(SESSION_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", expires: expiresAt });
    expect(Math.abs(expiresAt.getTime() - Date.now() - SESSION_TTL_MS)).toBeLessThan(5000);
  });
  it("gives each session a different token", async () => {
    sessionCreate.mockResolvedValue({ id: "session-1" });
    await startSession("user-1");
    const first = cookieStore.get(SESSION_COOKIE)!.value;
    await startSession("user-1");
    expect(cookieStore.get(SESSION_COOKIE)!.value).not.toBe(first);
  });
  it("returns the user of a valid session", async () => {
    sessionFindUnique.mockResolvedValue({ id: "session-1", userId: "user-1", expiresAt: new Date(Date.now() + SESSION_TTL_MS), user: student });
    cookieStore.set(SESSION_COOKIE, "raw-token");
    expect(await getCurrentUser()).toEqual(student);
    expect(sessionFindUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256("raw-token") }, include: { user: true } });
    expect(logError).not.toHaveBeenCalled();
  });
  it("returns nobody without a cookie and does not query the database", async () => {
    expect(await getCurrentUser()).toBeNull();
    expect(sessionFindUnique).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });
  it("refuses an unknown token and logs it", async () => {
    sessionFindUnique.mockResolvedValue(null);
    cookieStore.set(SESSION_COOKIE, "stale-token");
    expect(await getCurrentUser()).toBeNull();
    expect(logError).toHaveBeenCalledWith("session_validation_failed", { reason: "unknown_token" });
  });
  it("refuses an expired session, logs it, and deletes it", async () => {
    sessionFindUnique.mockResolvedValue({ id: "session-1", userId: "user-1", expiresAt: new Date(Date.now() - 1000), user: student });
    cookieStore.set(SESSION_COOKIE, "old-token");
    expect(await getCurrentUser()).toBeNull();
    expect(logError).toHaveBeenCalledWith("session_validation_failed", { reason: "expired", sessionId: "session-1", userId: "user-1" });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { id: "session-1" } });
  });
  it("treats a database failure as logged out and logs it", async () => {
    const error = new Error("connection refused");
    error.name = "PrismaClientInitializationError";
    sessionFindUnique.mockRejectedValue(error);
    cookieStore.set(SESSION_COOKIE, "raw-token");
    expect(await getCurrentUser()).toBeNull();
    expect(logError).toHaveBeenCalledWith("session_validation_failed", { reason: "db_error", errorType: "PrismaClientInitializationError" });
  });
  it("deletes the session row and the cookie on logout", async () => {
    cookieStore.set(SESSION_COOKIE, "raw-token");
    await endSession();
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { tokenHash: sha256("raw-token") } });
    expect(cookieStore.get(SESSION_COOKIE)).toBeUndefined();
  });
  it("does nothing on logout without a cookie", async () => {
    await endSession();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });
  it("still clears the cookie and logs when deleting the session row fails", async () => {
    const error = new Error("timeout");
    error.name = "PrismaClientKnownRequestError";
    sessionDeleteMany.mockRejectedValue(error);
    cookieStore.set(SESSION_COOKIE, "raw-token");
    await expect(endSession()).resolves.toBeUndefined();
    expect(cookieStore.get(SESSION_COOKIE)).toBeUndefined();
    expect(logError).toHaveBeenCalledWith("logout_failed", { errorType: "PrismaClientKnownRequestError" });
  });
});

describe("access guards", () => {
  const validSession = (user: typeof student | typeof admin) => ({ id: "session-1", userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS), user });

  it("returns the logged-in user to a protected page", async () => {
    sessionFindUnique.mockResolvedValue(validSession(student));
    cookieStore.set(SESSION_COOKIE, "raw-token");
    expect(await requireUser("/my-courses")).toEqual(student);
    expect(redirect).not.toHaveBeenCalled();
  });
  it("sends a logged-out visitor to the login page with the page to come back to", async () => {
    await expect(requireUser("/courses/course-a")).rejects.toThrow("NEXT_REDIRECT /login?next=%2Fcourses%2Fcourse-a");
    expect(logError).toHaveBeenCalledWith("unauthorized_access", { route: "/courses/course-a", role: "anonymous" });
  });
  it("returns an admin to an admin route and refuses a student without revealing it", async () => {
    sessionFindUnique.mockResolvedValue(validSession(admin));
    cookieStore.set(SESSION_COOKIE, "raw-token");
    expect(await requireAdmin("/admin/uploads")).toEqual(admin);
    sessionFindUnique.mockResolvedValue(validSession(student));
    await expect(requireAdmin("/admin/uploads")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(logError).toHaveBeenCalledWith("unauthorized_access", { route: "/admin/uploads", role: "STUDENT", userId: "user-1" });
  });
  it("sends a logged-out visitor on an admin route to the login page", async () => {
    await expect(requireAdmin("/admin/uploads")).rejects.toThrow("NEXT_REDIRECT /login?next=%2Fadmin%2Fuploads");
  });
  it.each([
    ["an admin", admin, admin],
    ["a student", student, null],
  ])("gives route handlers %s", async (_case, user, expected) => {
    sessionFindUnique.mockResolvedValue(validSession(user));
    cookieStore.set(SESSION_COOKIE, "raw-token");
    expect(await getAdminUser("POST /api/admin/uploads")).toEqual(expected);
  });
  it("gives route handlers nobody for a logged-out request and logs the route", async () => {
    expect(await getAdminUser("POST /api/admin/uploads")).toBeNull();
    expect(logError).toHaveBeenCalledWith("unauthorized_access", { route: "POST /api/admin/uploads", role: "anonymous", userId: undefined });
  });
});
