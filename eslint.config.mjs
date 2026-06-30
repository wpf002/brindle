import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Flat config shared across the monorepo. Type-aware linting is intentionally
// off for now (no `project` service) so lint stays fast and CI-cheap; typecheck
// already runs `tsc` per package for the deeper checks.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/prisma/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
