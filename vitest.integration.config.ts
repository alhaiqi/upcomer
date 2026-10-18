import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests: real services and a real, migrated database (DATABASE_URL); only the session is faked.
// They run apart from `npm test`, one file at a time, so the unit tests never need a database.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { environment: "node", include: ["tests/integration/**/*.test.ts"], fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000 },
});
