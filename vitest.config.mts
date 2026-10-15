import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests: no database required.
export default defineConfig({
  resolve: { tsconfigPaths: true, alias: { "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
