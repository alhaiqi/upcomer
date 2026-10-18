import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// What a load scenario provides to tests/load/run.ts. Each scenario is one file in tests/load/scenarios/.

export type LoadContext = { db: PrismaClient; stamp: string; baseUrl: string };
export type LoadRequest = { method: "GET" | "POST"; path: string; headers?: Record<string, string>; body?: Buffer | string };

export type Scenario = {
  description: string;
  // Concurrent users (connections) for each step, lowest first.
  stages: number[];
  // Extra environment for the app under test, for example a higher rate limit.
  serverEnv?: Record<string, string>;
  // Creates the test data and returns the request every user repeats.
  setup(ctx: LoadContext): Promise<LoadRequest>;
  // Deletes everything setup and the requests created. It also runs after a failed setup.
  teardown(ctx: LoadContext): Promise<void>;
};

// A session for the seeded admin, created directly in the database the same way login does (only the token's hash is stored).
export async function adminSession(db: PrismaClient) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const admin = await db.user.findFirst({ where: email ? { email, role: "ADMIN" } : { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("No admin user. Set ADMIN_EMAIL and ADMIN_PASSWORD and run npm run db:seed.");
  const token = randomBytes(32).toString("hex");
  const session = await db.session.create({
    data: { userId: admin.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    select: { id: true },
  });
  return { adminId: admin.id, sessionId: session.id, cookie: `upcomer_session=${token}` };
}
