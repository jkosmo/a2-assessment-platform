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
      // they require exclusive DB access — even with fileParallelism:false, since they mutate the whole
      // table other files have already written to. Run them with `npm run test:integration:audit`.
      "test/m2-audit-chain.test.ts",
      "test/m2-audit-pii-scrub.test.ts",
    ],
    globals: true,
    testTimeout: 20000,
    // #1021: filene kjørte i PARALLELL mot én delt Postgres, og racet fra #513 var aldri løst — bare
    // omgått for de to filene over.
    //
    // ⚠️ Symptomet var en suite som feilet TILFELDIG: seks kjøringer, seks ulike tester, hver av dem
    // grønn alene. Det er verre enn en suite som feiler alltid, fordi den lærer leseren å se bort fra
    // rødt. Én av de tilfeldige feilene gjaldt dessuten regelen om at et KI-signal skal rute til
    // gjennomgang i stedet for stryk — avfeier man den som støy, kan man avfeie en ekte regresjon.
    //
    // Målt 2026-08-27 på samme ferske, seedede database: parallelt feilet 6 av 6 kjøringer med 1–4
    // tester; serielt 576/576 grønt. `npm test` (vitest.config.ts) har kjørt serielt siden #513 —
    // dette gjør den lokale kommandoen lik CI.
    //
    // Prisen er 4 minutter mot 1. En suite man ikke kan stole på er verdt mindre enn de tre.
    fileParallelism: false,
  },
});
