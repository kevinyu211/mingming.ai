import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Constitution principle III: rules decide, the model only reads and phrases.
  // Nothing under lib/rules may import model code or the Anthropic SDK.
  {
    files: ["lib/rules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/model",
                "@/lib/model/*",
                "**/lib/model",
                "**/lib/model/*",
                "@anthropic-ai/sdk",
                "@anthropic-ai/sdk/*",
              ],
              message:
                "lib/rules must stay deterministic: no imports from lib/model or the Anthropic SDK (constitution III).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated test and eval output
    "tests/eval/out/**",
    "playwright-report/**",
    "test-results/**",
    "fixtures/sheets/out/**",
  ]),
]);

export default eslintConfig;
