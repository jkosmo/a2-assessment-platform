import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

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
//
// Testgjennomgangen 2026-11 (avsnitt 5.1): to endringer.
//   - Én `tsc`-kjøring for alle filene, ikke én per fil (27 s lokalt ble ett par sekunder).
//     `moduleDetection: "force"` gjør hver fil til en modul, så et navn på toppnivå i én fil ikke
//     kan dekke over et udefinert navn i en annen nå som de står i samme program.
//   - Vakta var blind for en fil som manglet: `tsc` ga TS6053 («File not found»), og testen talte
//     bare TS2304/TS2552. Nå må hver fil finnes, og `tsc` må ha tatt den med i programmet
//     (`--listFiles`). Det siste viser også at `tsc` faktisk kjørte.
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

// Windows skriver stasjonsbokstaven ulikt fra gang til gang; sammenlign uten store og små bokstaver der.
const key = (file) => {
  const resolved = path.resolve(process.cwd(), file.trim());
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

let tsc;

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "undef-guard-"));
  try {
    const config = path.join(dir, "tsconfig.json");
    writeFileSync(config, JSON.stringify({
      compilerOptions: {
        allowJs: true, checkJs: true, noEmit: true, target: "es2022", module: "esnext",
        moduleResolution: "bundler", moduleDetection: "force", lib: ["dom", "es2022"], noResolve: true,
        types: [], skipLibCheck: true,
      },
      files: FILES.map((file) => path.resolve(process.cwd(), file)),
    }));
    const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    let out = "";
    try {
      out = execFileSync(process.execPath, [tscBin, "-p", config, "--listFiles", "--pretty", "false"], {
        cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      // tsc avslutter med feilkode så snart én fil har en klage (også de vi ikke teller, som TS2307).
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    const lines = out.split(/\r?\n/);
    const errors = lines.flatMap((line) => {
      const match = line.match(/^(.+?)\(\d+,\d+\): error (TS\d+):/);
      return match ? [{ file: key(match[1]), code: match[2], line }] : [];
    });
    // Feil uten fil foran, for eksempel TS6053 («File not found») og feil i konfigurasjonen.
    const global = lines.filter((line) => /^error TS\d+:/.test(line));
    const listed = new Set(lines.filter((line) => /\.js$/.test(line.trim()) && !/error TS/.test(line)).map(key));
    tsc = { out, errors, global, listed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120000);

describe("klientfilene har ingen udefinerte navn", () => {
  it.each(FILES)("%s", (file) => {
    expect(existsSync(path.resolve(process.cwd(), file)), `${file} finnes ikke — rett lista`).toBe(true);
    expect(tsc.listed.has(key(file)), `${file} er ikke med i tsc-programmet. Utdata:\n${tsc.out.slice(0, 2000)}`).toBe(true);
    const undefinedNames = tsc.errors
      .filter((error) => error.file === key(file) && /^TS(2304|2552)$/.test(error.code))
      .map((error) => error.line);
    expect(undefinedNames, `${file}: udefinerte navn\n${undefinedNames.join("\n")}`).toEqual([]);
  });

  it("tsc kjørte uten feil i selve oppsettet (for eksempel en fil den ikke fant)", () => {
    expect(tsc.global).toEqual([]);
  });
});
