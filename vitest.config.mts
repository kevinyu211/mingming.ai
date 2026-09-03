import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    environment: "node",
    passWithNoTests: false,
    // The product runs on phones in Hong Kong; date rules (follow-up anchoring, expiry) are
    // asserted in that zone so results do not depend on the developer machine's clock.
    env: { TZ: "Asia/Hong_Kong" },
  },
});
