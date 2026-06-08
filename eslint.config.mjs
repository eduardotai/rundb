import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Staged cleanup: existing codebase has many `any` usages; fail CI on new hard errors only.
      "@typescript-eslint/no-explicit-any": "warn",
      // Honor the `_`-prefix convention for intentionally-unused args, vars, and caught errors
      // (e.g. legacy-compat stubs and future-API placeholders).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Generated build output (including nested copies inside worktrees).
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "next-env.d.ts",
    // Isolated worktrees and local agent/session artifacts — never source to lint.
    ".worktrees/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
