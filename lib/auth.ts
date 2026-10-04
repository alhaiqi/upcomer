import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { SESSION_COOKIE, SESSION_TTL_MS, safeNext } from "@/lib/session-cookie";

export { SESSION_COOKIE, SESSION_TTL_DAYS, SESSION_TTL_MS, safeNext } from "@/lib/session-cookie";

export const PASSWORD_MIN_LENGTH = 8;
export const BCRYPT_COST = 10;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNKNOWN_EMAIL_HASH = "$2b$10$XAS3xG9SZJMnaiT6s1GuuOuxyX0VjLRQMWqgymJEHh0SnhfARjp0.";

export type SignupError = "name_required" | "invalid_email" | "domain_not_allowed" | "weak_password" | "email_taken" | "unexpected";
export type LoginError = "invalid_credentials" | "unexpected";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const requiredDomain = () => process.env.SIGNUP_EMAIL_DOMAIN?.trim().toLowerCase() || "";
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const errorType = (error: unknown) => (error instanceof Error ? error.name : "Unknown");
const isUniqueViolation = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

export function validateCredentials({ name, email, password }: { name: string; email: string; password: string }):
  { valid: true; name: string; email: string; password: string } | { valid: false; error: SignupError } {
  const trimmedName = name.trim();
  const normalizedEmail = normalizeEmail(email);
  const domain = requiredDomain();
  if (!trimmedName) return { valid: false, error: "name_required" };
  if (!EMAIL_PATTERN.test(normalizedEmail)) return { valid: false, error: "invalid_email" };
  if (domain && !normalizedEmail.endsWith(domain)) return { valid: false, error: "domain_not_allowed" };
  if (password.length < PASSWORD_MIN_LENGTH) return { valid: false, error: "weak_password" };
  return { valid: true, name: trimmedName, email: normalizedEmail, password };
}

export async function createAccount(input: { name: string; email: string; password: string }):
  Promise<{ created: true; user: User } | { created: false; error: SignupError }> {
  const checked = validateCredentials(input);
  if (!checked.valid) return { created: false, error: checked.error };
  try {
    const user = await db.user.create({
      data: { name: checked.name, email: checked.email, passwordHash: await bcrypt.hash(checked.password, BCRYPT_COST) },
    });
    return { created: true, user };
  } catch (error) {
    if (isUniqueViolation(error)) {
      logError("signup_failed", { reason: "email_taken" });
      return { created: false, error: "email_taken" };
    }
    logError("signup_failed", { reason: "db_error", errorType: errorType(error) });
    return { created: false, error: "unexpected" };
  }
}

export async function authenticate(email: string, password: string): Promise<{ user: User } | { error: LoginError }> {
  try {
    const user = await db.user.findUnique({ where: { email: normalizeEmail(email) } });
    const matches = await bcrypt.compare(password, user?.passwordHash ?? UNKNOWN_EMAIL_HASH);
    if (!user || !matches) {
      logError("login_failed", { reason: "invalid_credentials", userId: user?.id });
      return { error: "invalid_credentials" };
    }
    return { user };
  } catch (error) {
    logError("login_failed", { reason: "db_error", errorType: errorType(error) });
    return { error: "unexpected" };
  }
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
  });
  return expiresAt;
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (!token) return;
  try {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  } catch (error) {
    logError("logout_failed", { errorType: errorType(error) });
  }
}

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (!session) {
      logError("session_validation_failed", { reason: "unknown_token" });
      return null;
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      logError("session_validation_failed", { reason: "expired", sessionId: session.id, userId: session.userId });
      await db.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    return session.user;
  } catch (error) {
    logError("session_validation_failed", { reason: "db_error", errorType: errorType(error) });
    return null;
  }
}

export async function requireUser(route: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    logError("unauthorized_access", { route, role: "anonymous" });
    redirect(`/login?next=${encodeURIComponent(safeNext(route))}`);
  }
  return user;
}

export async function getAdminUser(route: string): Promise<User | null> {
  const user = await getCurrentUser();
  if (user?.role === "ADMIN") return user;
  logError("unauthorized_access", { route, role: user?.role ?? "anonymous", userId: user?.id });
  return null;
}

export async function requireAdmin(route: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    logError("unauthorized_access", { route, role: "anonymous" });
    redirect(`/login?next=${encodeURIComponent(safeNext(route))}`);
  }
  if (user.role !== "ADMIN") {
    logError("unauthorized_access", { route, role: user.role, userId: user.id });
    notFound();
  }
  return user;
}
