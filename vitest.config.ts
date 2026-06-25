import { defineConfig } from "vitest/config";

export default defineConfig({
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
