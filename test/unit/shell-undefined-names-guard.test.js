import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// VAKT (13.09.2026): ingen udefinerte navn i klientfilene.
//
// Under opprydningen etter #1046 tok en sletting av en tom stub med seg funksjonen under
// (`settingsCriteriaEdited`). `node --check` var grønn, ingen feil i konsollen — skjemaet åpnet
// bare aldri, og 63 e2e-tester gikk i 30-sekunders tidsavbrudd før noen skjønte hvorfor.
// En «Cannot find name» fra tsc på fila fant det på sekunder. Derfor kjøres den her, for de
// klientfilene som er store nok til at en slik feil kan gjemme seg.
//
// ⚠️ Bare TS2304/TS2552 (navnet finnes ikke). Typeklager (TS2339 osv.) er ikke det denne vakta
// måler; de ville gjort den rød på ren JavaScript som virker.
// ─────────────────────────────────────────────────────────────────────────────

const FILES = [
  "public/static/admin-content-shell.js",
  "public/static/admin-content-settings-tab.js",
  "public/static/localized-value.js",
  "public/static/admin-content-criteria.js",
  "public/static/admin-content-publish.js",
  "public/participant.js",
  "public/static/admin-content-courses.js",
  "public/static/admin-content-sections.js",
  "public/static/admin-content-classes.js",
  "public/static/form-page.js",
  "public/static/list-page.js",
  "public/results.js",
  "public/cohort-status.js",
];

describe("klientfilene har ingen udefinerte navn", () => {
  it.each(FILES)("%s", (file) => {
    const dir = mkdtempSync(path.join(tmpdir(), "undef-guard-"));
    try {
      const config = path.join(dir, "tsconfig.json");
      writeFileSync(config, JSON.stringify({
        compilerOptions: {
          allowJs: true, checkJs: true, noEmit: true, target: "es2022", module: "esnext",
          moduleResolution: "bundler", lib: ["dom", "es2022"], noResolve: true, types: [], skipLibCheck: true,
        },
        files: [path.resolve(process.cwd(), file)],
      }));
      let out = "";
      try {
        out = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", config], {
          cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32",
        });
      } catch (err) {
        out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      }
      const undefinedNames = out.split(/\r?\n/).filter((line) => /error TS(2304|2552):/.test(line));
      expect(undefinedNames, `${file}: udefinerte navn\n${undefinedNames.join("\n")}`).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});
