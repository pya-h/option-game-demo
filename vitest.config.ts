import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: {
    environment: "node",
    setupFiles: ["tests/setup-env.ts"],
    // Playwright specs live in tests/e2e and are driven by its own runner.
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Integration specs share one Postgres; running files in parallel would interleave
    // their transactions on the same advisory lock.
    fileParallelism: false,
  },
});
