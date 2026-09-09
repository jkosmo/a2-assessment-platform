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
    // ⚠️ DOM-TESTENE TRENGER jsdom, OG `include` OVER FANGER DEM OGSÅ.
    //
    // `npm test` — det CI kjører som `verify` — tar HELE `test/**`, altså også `test/dom/`. De
    // testene importerer frontend-moduler som rører `document`, og under `environment: "node"`
    // faller de med «ReferenceError: document is not defined».
    //
    // ⚠️ DETTE HADDE STÅTT RØDT EN STUND UTEN AT NOEN SÅ DET. CI kjører bare på pull request og på
    // push til main; pushes til dev utløser den aldri. Forrige PR var 25. august, så feilen lå
    // usett i to uker og dukket opp først da dev → main ble åpnet.
    //
    // Miljøet følger nå fila i stedet for kommandoen, så `npm test`, `npm run test:unit` og
    // `npm run test:dom` er enige om hva en DOM-test er.
    environmentMatchGlobs: [["test/dom/**", "jsdom"]],
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
