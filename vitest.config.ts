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
    globals: true,
    testTimeout: 20000,
    // #513: `npm test` (CI verify) runs the whole suite — unit + DB-backed integration — against a
    // SINGLE shared Postgres. With file-level parallelism, integration files that touch the same
    // seed fixtures (the seed module's calibration thresholds, the shared `participant-1`) race:
    // one file mutates state another is mid-assessment on, intermittently flipping a decision
    // (observed: assessment-policy TC-POL-YELLOW-001 COMPLETED vs UNDER_REVIEW). Running files
    // sequentially removes the cross-file DB races at the cost of some wall-clock time. The
    // unit-only config (`test:unit`) keeps parallelism for fast local pure-logic runs.
    fileParallelism: false,
  },
});
