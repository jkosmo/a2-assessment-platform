import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // #975: se vitest.unit.config.ts — public/api-client.js importerer /static/dom-visibility.js.
  // Vite nekter modulimport fra publicDir, og nettleser-stien `/static/…` finnes ikke på disk.
  publicDir: false,
  resolve: {
    alias: [
      { find: /^\/static\/i18n\/(.*)$/, replacement: `${path.join(rootDir, "public", "i18n")}${path.sep}$1` },
      { find: /^\/static\/(.*)$/, replacement: `${path.join(rootDir, "public", "static")}${path.sep}$1` },
    ],
  },
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
