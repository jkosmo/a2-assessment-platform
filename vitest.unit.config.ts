import { defineConfig } from "vitest/config";

export default defineConfig({
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
