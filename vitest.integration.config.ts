import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.js"],
    exclude: [
      "test/unit/**/*.test.ts",
      "test/unit/**/*.test.js",
      "test/module-completion-policy.test.ts",
      "test/secondary-assessment.test.ts",
      "test/process-error-handlers.test.ts",
      "test/assessment-worker-process-error.test.ts",
      "test/app-error-middleware.test.ts",
      "test/document-parsing.test.ts",
      "test/sensitive-data-masking.test.ts",
      // #804: these exercise the GLOBAL audit hash chain (whole-table verify/backfill + deleteMany), so
      // they require exclusive DB access. This config runs files in PARALLEL, which would race them
      // against other audit-writing tests. CI's `npm test` (vitest.config.ts, fileParallelism:false) runs
      // them serially; run locally with `npm run test:integration:audit`.
      "test/m2-audit-chain.test.ts",
      "test/m2-audit-pii-scrub.test.ts",
    ],
    globals: true,
    testTimeout: 20000,
  },
});
