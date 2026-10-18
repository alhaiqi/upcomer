import autocannon from "autocannon";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { LoadContext, Scenario } from "./scenario";

// Load test: how many users at the same time the app serves within the 1 s response target.
//   npm run load -- <scenario>      scenarios are the files in tests/load/scenarios/
// It builds and starts the production app, runs the scenario at each number of concurrent users (connections),
// and writes reports/load-<scenario>-<date>.md and .json. LOAD_SECONDS (default 10) sets how long each step lasts,
// LOAD_STAGES (for example "1,10,50") overrides the steps, and LOAD_SKIP_BUILD=1 starts the last build without rebuilding.
// It needs a migrated, seeded database and a free port 3000 (stop npm run dev first). It deletes everything it creates.

try {
  process.loadEnvFile?.(".env");
} catch {
  // No .env file; rely on the environment.
}

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TARGET_P99_MS = 1000;

type OperationStats = { operation: string; count: number; p50: number; p95: number; max: number };
type StageResult = {
  connections: number; requests: number; requestsPerSecond: number; errors: number;
  latency: { average: number; p50: number; p90: number; p99: number; max: number };
  passed: boolean; serverTimings: OperationStats[];
};

const percentile = (sorted: number[], fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0;

// The server prints one "operation_timed" JSON line per timed operation (lib/timing.ts); these are the server's own timings.
function serverTimings(logText: string): OperationStats[] {
  const byOperation = new Map<string, number[]>();
  for (const line of logText.split(/\r?\n/)) {
    if (!line.includes('"operation_timed"')) continue;
    try {
      const entry = JSON.parse(line.slice(line.indexOf("{")));
      if (entry.event === "operation_timed") byOperation.set(entry.operation, [...(byOperation.get(entry.operation) ?? []), Number(entry.durationMs)]);
    } catch {
      // Not a JSON line.
    }
  }
  return [...byOperation].map(([operation, values]) => {
    const sorted = values.sort((a, b) => a - b);
    return { operation, count: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? 0 };
  });
}

const portInUse = () => new Promise<boolean>(resolve => {
  const socket = net.connect(PORT, "127.0.0.1");
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});

function startServer(logFile: string, env: Record<string, string>) {
  const log = createWriteStream(logFile);
  const command = `${process.env.LOAD_SKIP_BUILD === "1" ? "" : "npm run build && "}npx next start --port ${PORT}`;
  // Logs are not saved to the database during the run; the timing lines still go to the server log.
  const server = spawn(command, {
    shell: true, detached: process.platform !== "win32", env: { ...process.env, LOG_PERSIST: "off", ...env }, stdio: ["ignore", "pipe", "pipe"],
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

function report(name: string, scenario: Scenario, date: string, seconds: number, stages: StageResult[]) {
  const passing = stages.findIndex(stage => !stage.passed);
  const supported = (passing === -1 ? stages : stages.slice(0, passing)).at(-1)?.connections ?? 0;
  const lines = [
    `# Load test: ${name} (${date})`, "",
    scenario.description, "",
    `- **Target:** 99% of responses within ${TARGET_P99_MS} ms, with no errors.`,
    `- **Result:** up to **${supported}** concurrent users meet the target${passing === -1 ? " (the highest step tested)" : ""}.`,
    `- **Steps:** ${stages.map(stage => stage.connections).join(", ")} concurrent users, ${seconds} s each.`, "",
    "| Users | Requests | Req/s | Avg ms | p50 ms | p90 ms | p99 ms | Max ms | Errors | Target |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...stages.map(stage => `| ${stage.connections} | ${stage.requests} | ${stage.requestsPerSecond.toFixed(1)} | ${stage.latency.average.toFixed(0)} | ${stage.latency.p50} | ${stage.latency.p90} | ${stage.latency.p99} | ${stage.latency.max} | ${stage.errors} | ${stage.passed ? "met" : "**missed**"} |`),
    "", "## Server timings from the log", "",
    "The `operation_timed` lines the server wrote during each step (lib/timing.ts).", "",
    "| Users | Operation | Count | p50 ms | p95 ms | Max ms |", "| ---: | --- | ---: | ---: | ---: | ---: |",
    ...stages.flatMap(stage => stage.serverTimings.map(item => `| ${stage.connections} | ${item.operation} | ${item.count} | ${item.p50} | ${item.p95} | ${item.max} |`)),
    "",
  ];
  return { markdown: lines.join("\n"), supported };
}

async function main() {
  const name = process.argv[2];
  if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error("Name a scenario from tests/load/scenarios, for example: npm run load -- exam-upload");
  const scenario: Scenario = (await import(`./scenarios/${name}.ts`)).default;
  if (await portInUse()) throw new Error(`Port ${PORT} is already in use. Stop the dev server (or any app on that port) and run again.`);
  const seconds = Number(process.env.LOAD_SECONDS) > 0 ? Number(process.env.LOAD_SECONDS) : 10;
  const steps = process.env.LOAD_STAGES ? process.env.LOAD_STAGES.split(",").map(Number).filter(value => value > 0) : scenario.stages;
  const date = new Date().toLocaleDateString("en-CA");
  const reportsDir = path.resolve("reports");
  await mkdir(reportsDir, { recursive: true });
  const serverLog = path.join(reportsDir, `load-${name}-${date}.server.log`);

  const db = new PrismaClient();
  const ctx: LoadContext = { db, stamp: `load${Date.now().toString(36)}`, baseUrl: BASE_URL };
  let server: ChildProcess | undefined;
  try {
    const request = await scenario.setup(ctx);
    console.log(`Building and starting the app (log: ${path.relative(process.cwd(), serverLog)})…`);
    server = startServer(serverLog, scenario.serverEnv ?? {});
    await waitForServer(server);
    // One warm-up request, so the first step does not measure compilation or cold caches.
    await fetch(`${BASE_URL}${request.path}`, { method: request.method, headers: request.headers, body: typeof request.body === "string" ? request.body : request.body && new Uint8Array(request.body), redirect: "manual" });

    const stages: StageResult[] = [];
    for (const connections of steps) {
      const logBefore = (await readFile(serverLog, "utf8")).length;
      const result = await autocannon({ url: `${BASE_URL}${request.path}`, method: request.method, headers: request.headers, body: request.body, connections, duration: seconds });
      await new Promise(resolve => setTimeout(resolve, 500));
      const logText = (await readFile(serverLog, "utf8")).slice(logBefore);
      const errors = result.errors + result.timeouts + result.non2xx;
      const stage: StageResult = {
        connections, requests: result.requests.total, requestsPerSecond: result.requests.average, errors,
        latency: { average: result.latency.average, p50: result.latency.p50, p90: result.latency.p90, p99: result.latency.p99, max: result.latency.max },
        passed: errors === 0 && result.requests.total > 0 && result.latency.p99 <= TARGET_P99_MS,
        serverTimings: serverTimings(logText),
      };
      stages.push(stage);
      console.log(`${connections} users: ${stage.requests} requests, p99 ${stage.latency.p99} ms, ${errors} errors → ${stage.passed ? "target met" : "target missed"}`);
    }
    const { markdown, supported } = report(name, scenario, date, seconds, stages);
    await writeFile(path.join(reportsDir, `load-${name}-${date}.md`), markdown);
    await writeFile(path.join(reportsDir, `load-${name}-${date}.json`), JSON.stringify({ scenario: name, date, seconds, targetP99Ms: TARGET_P99_MS, supportedUsers: supported, stages }, null, 2));
    console.log(`Supported concurrent users within ${TARGET_P99_MS} ms: ${supported}. Report: reports/load-${name}-${date}.md`);
  } finally {
    if (server) stopServer(server);
    await scenario.teardown(ctx).catch(error => console.error("Cleanup failed:", error));
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
