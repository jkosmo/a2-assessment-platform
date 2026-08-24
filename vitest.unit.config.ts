import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // #975: `test/unit/auth-redirect-safety.test.ts` importerer public/api-client.js, som nå henter
  // `setHidden` fra /static/dom-visibility.js. To ting måtte på plass, begge de samme som i
  // vitest.dom.config.ts: Vite behandler `public/` som en ren asset-mappe og nekter modulimport
  // derfra (publicDir), og nettleser-stiene `/static/…` finnes ikke på disk (alias). Testene
  // serverer ingenting, så publicDir har ingen jobb her.
  publicDir: false,
  resolve: {
    alias: [
      { find: /^\/static\/i18n\/(.*)$/, replacement: `${path.join(rootDir, "public", "i18n")}${path.sep}$1` },
      { find: /^\/static\/(.*)$/, replacement: `${path.join(rootDir, "public", "static")}${path.sep}$1` },
    ],
  },
  test: {
    environment: "node",
    env: { AUTH_MODE: "mock" },
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
      // #896-opprydding 2026-08-18: disse leser bare filer fra disk — ingen database, ingen
      // server. De lå likevel bare i den fulle `npm test`-kjøringen, som krever Postgres og
      // derfor bare kjører i CI. Resultatet var at S3c etterlot 21 røde tester i et døgn uten
      // at QA-porten før deploy (lint + test:unit + test:dom) merket noe: den kjørte dem ikke.
      // En kontrakt som bare kan brytes et sted man ikke ser, er ikke en kontrakt.
      "test/admin-content-ui-contracts.test.js",
      "test/admin-content-state-rail.test.js",
      "test/admin-content-translations.test.js",
      "test/participant-translations.test.js",
      "test/calibration-translations.test.js",
      "test/participant-completed-translations.test.js",
      "test/workspace-html-fallbacks.test.js",
      "test/workspace-help-contracts.test.js",
      "test/workspace-validation-accessibility.test.js",
      // #992 2026-08-23: og igjen. QA-porten fant at mine to nye vakter ikke kjørte i den
      // obligatoriske pre-stage-porten — og da jeg så etter, gjorde ingen av de FIRE eldre det
      // heller. Seks dekningsvakter som bare kunne bli røde i den fulle kjøringen, altså først
      // i CI, altså etter at deployen var i gang.
      //
      // ⚠️ En vakt som ikke kjører i porten den skal vokte, er ikke en vakt. Kommentaren over
      // sier nøyaktig dette om #896 S3c — jeg leste den og gikk i fella likevel. Derfor er
      // `test/unit/unit-suite-coverage-guard.test.js` lagt til: den nekter en ny `*-guard`-fil
      // i test-rota som ikke står her.
      "test/course-visibility-guard.test.js",
      "test/hidden-cascade-guard.test.js",
      "test/nynorsk-guard.test.js",
      "test/raw-server-error-guard.test.js",
      "test/course-archive-entry-guard.test.js",
      "test/participant-sequence-predicate-guard.test.js",
      "test/environment-identifier-guard.test.js",
      // #958: nekter en niende kaller som går utenom de to navngitte dørene.
      "test/course-items-accessor-guard.test.js",
      // #962: nekter en tjueførste innebygd rollesjekk.
      "test/role-set-guard.test.js",
      // #994: nekter en ny fil som laster src/-grafen inne i en testkropp uten oppvarming.
      "test/module-graph-warmup-guard.test.js",
      // #978: nekter at en bundle utleder «bestått» på egen hånd.
      "test/outcome-derivation-guard.test.js",
      // #949: nekter at en tjeneste avgjør MCQ-grensen på egen hånd.
      "test/mcq-pass-rule-guard.test.js",
    ],
    globals: true,
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/scripts/**",
        "test/**",
        "scripts/**",
      ],
    },
  },
});
