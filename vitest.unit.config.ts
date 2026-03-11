import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "test/unit/**/*.test.ts",
      "test/unit/**/*.test.js",
      "test/module-completion-policy.test.ts",
      "test/secondary-assessment.test.ts",
      "test/process-error-handlers.test.ts",
      "test/assessment-worker-process-error.test.ts",
      "test/app-error-middleware.test.ts",
      "test/document-parsing.test.ts",
      "test/sensitive-data-masking.test.ts",
    ],
    globals: true,
    testTimeout: 20000,
  },
});
