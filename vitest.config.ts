import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  esbuild: { jsx: "automatic" },
  test: { environment: "node", setupFiles: ["./tests/setup.ts"], exclude: ["tests/e2e/**", "node_modules/**"] },
});
