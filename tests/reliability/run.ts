import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { Context, type Feature } from "./context";
import { cleanUp, countRows, createStamp, diffCounts, listUploadFolders } from "./data";
import { catalogFeature, metadataFeature, uploadFeature } from "./features/admin";
import { addToMyCoursesFeature, logInFeature, logOutFeature, signUpFeature } from "./features/accounts";
import { coursePageFeature, openFileFeature, resourceListsFeature, searchFeature } from "./features/browsing";
import { buildReport, type TrialRecord } from "./report";
import { createRng } from "./rng";

// npm run reliability: builds and starts the app as the e2e tests do, runs randomized trials per feature against it and
// the real database, removes everything it created, and writes reports/reliability-<date>.md and .json.

try {
  process.loadEnvFile?.(".env");
} catch {
  // No .env file; rely on the environment.
}

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FEATURES: Feature[] = [
  signUpFeature, logInFeature, logOutFeature, addToMyCoursesFeature, searchFeature, coursePageFeature,
  resourceListsFeature, openFileFeature, uploadFeature, catalogFeature, metadataFeature,
];

const runs = Number(process.env.RELIABILITY_RUNS || 50);
const seed = Number(process.env.RELIABILITY_SEED || Math.floor(Math.random() * 2 ** 31));
if (!Number.isInteger(runs) || runs < 1) throw new Error("RELIABILITY_RUNS must be a positive whole number.");
if (!Number.isInteger(seed) || seed < 0) throw new Error("RELIABILITY_SEED must be a non-negative whole number.");

const portInUse = () => new Promise<boolean>(resolve => {
  const socket = net.connect(PORT, "127.0.0.1");
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

const git = (command: string) => {
  try {
    return execSync(`git ${command}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

// The same command as Playwright's webServer. Logs are not persisted during the run, so the hundreds of logged
// refusals neither raise monitoring alerts nor trigger the 30-day log purge; they still go to the server log.
function startServer(logFile: string) {
  const log = createWriteStream(logFile);
  const server = spawn(`npm run build && npx next start --port ${PORT}`, {
    shell: true, detached: process.platform !== "win32", env: { ...process.env, LOG_PERSIST: "off" }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  return server;
}

async function waitForServer(server: ChildProcess, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`The app exited with code ${server.exitCode} before it was ready; see the server log.`);
    try {
      if ((await fetch(BASE_URL, { redirect: "manual" })).status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("The app did not start within 5 minutes; see the server log.");
}

function stopServer(server: ChildProcess) {
  if (server.exitCode !== null || !server.pid) return;
  if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
  else process.kill(-server.pid, "SIGTERM");
}

async function main() {
  if (await portInUse()) {
    console.error(`Port ${PORT} is already in use. Stop the dev server (or any app on that port) and run again.`);
    process.exitCode = 1;
    return;
  }
  const started = new Date();
  const date = started.toLocaleDateString("en-CA");
  const reportsDir = path.resolve("reports");
  await mkdir(reportsDir, { recursive: true });
  const serverLog = path.join(reportsDir, `reliability-${date}.server.log`);
  console.log(`Reliability run — seed ${seed}, ${runs} trials per feature (repeat with RELIABILITY_SEED=${seed}).`);

  const db = new PrismaClient();
  const stamp = createStamp();
  const ctx = new Context(BASE_URL, db, createRng(seed), stamp);
  const records: TrialRecord[] = [];
  const skipped: { feature: string; reason: string }[] = [];
  let aborted = false;
  process.once("SIGINT", () => { aborted = true; console.log("\nStopping after the current trial, then cleaning up…"); });

  const [{ now: since }] = await db.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  const before = await countRows(db);
  const uploadsBefore = await listUploadFolders();
  let server: ChildProcess | undefined;
  try {
    const sampleCourse = await db.course.findFirst({ orderBy: { code: "asc" }, select: { id: true } });
    if (!sampleCourse) throw new Error("The database has no courses. Run npm run db:seed first.");
    console.log(`Building and starting the app (log: ${path.relative(process.cwd(), serverLog)})…`);
    server = startServer(serverLog);
    await waitForServer(server);
    console.log(`App ready at ${BASE_URL}. Test data stamp: ${stamp}.`);

    await ctx.createFileFixtures(sampleCourse.id);
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    let adminReason = email && password ? "" : "ADMIN_EMAIL and ADMIN_PASSWORD are not set.";
    try {
      await ctx.discoverActions(sampleCourse.id, adminReason ? undefined : { email: email!, password: password! });
    } catch (error) {
      if (!ctx.actions.addCourse || ctx.admin) throw error;
      adminReason = "the seeded admin could not log in (run npm run db:seed).";
    }

    for (const feature of FEATURES) {
      if (aborted) break;
      if (feature.needsAdmin && !ctx.admin) {
        skipped.push({ feature: feature.name, reason: adminReason });
        console.log(`  ${feature.name}: skipped — ${adminReason}`);
        continue;
      }
      for (let trial = 1; trial <= runs && !aborted; trial++) {
        const type = ctx.rng.pick(feature.trials);
        try {
          records.push({ feature: feature.name, trial, type: type.name, valid: type.valid, ...(await type.run(ctx)) });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          records.push({
            feature: feature.name, trial, type: type.name, valid: type.valid, input: type.name,
            expected: type.valid ? "accepted" : "refused", actual: `error: ${message.slice(0, 200)}`, ok: false, ms: Number.NaN,
          });
        }
      }
      const done = records.filter(record => record.feature === feature.name);
      const passed = done.filter(record => record.ok).length;
      console.log(`  ${feature.name.padEnd(24)} ${passed}/${done.length} succeeded`);
    }
  } finally {
    if (server) stopServer(server);
    await cleanUp(db, stamp, { uploadedFileIds: ctx.uploadedFileIds, adminId: ctx.adminId, since });
  }

  const after = await countRows(db);
  const uploadsAfter = await listUploadFolders();
  await db.$disconnect();
  const uploadFolderChanges = [
    ...uploadsAfter.filter(file => !uploadsBefore.includes(file)).map(file => `+${file}`),
    ...uploadsBefore.filter(file => !uploadsAfter.includes(file)).map(file => `-${file}`),
  ];
  const dirty = git("status --porcelain -- . :!reports") ? " (with uncommitted changes)" : "";
  const { markdown, json, overall, restored } = buildReport({
    date, startedAt: started.toISOString(), commit: `${git("rev-parse --short HEAD") || "unknown"}${dirty}`, seed, runsPerFeature: runs,
    durationSeconds: (Date.now() - started.getTime()) / 1000, skipped, aborted,
    database: { before, after, changes: diffCounts(before, after), uploadFolderChanges },
  }, FEATURES.map(feature => feature.name).filter(name => !skipped.some(item => item.feature === name)), records);

  const reportPath = path.join(reportsDir, `reliability-${date}.md`);
  await writeFile(reportPath, markdown);
  await writeFile(reportPath.replace(/\.md$/, ".json"), json);
  console.log(`\nOverall: ${overall.successes}/${overall.trials} trials succeeded (${overall.rate.toFixed(1)}%). Report: ${path.relative(process.cwd(), reportPath)}`);
  if (restored) console.log("Database restored: every table's row count and the upload folders match the start of the run.");
  else {
    console.error(`Database NOT restored: ${[...diffCounts(before, after), ...uploadFolderChanges].join("; ")}`);
    process.exitCode = 1;
  }
  if (aborted) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
