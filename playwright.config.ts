import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: {
    // A production build serves every page precompiled. `next dev` compiles each page on its first request, which can
    // outlast the 5-second waits after a navigation while several workers hit a fresh server.
    command: "npm run build && npx next start --port 3000",
    url: "http://127.0.0.1:3000",
    // Locally, a server already on port 3000 (for example `npm run dev`) is reused instead; CI always builds.
    reuseExistingServer: !process.env.CI,
    // Room for `next build` before the server starts answering.
    timeout: 300_000,
  },
});
