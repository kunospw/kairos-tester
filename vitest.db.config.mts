import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Integration tests: require TEST_DATABASE_URL pointing at a dedicated,
// disposable database (never your working database). See README.
export default defineConfig({
  resolve: { tsconfigPaths: true, alias: { "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)) } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    globalSetup: ["tests/db/global-setup.ts"],
    // Never call the real AI provider from tests (AI tests stub it and set their own key).
    env: { OLLAMA_API_KEY: "" },
  },
});
