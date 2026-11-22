import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadMascotPack, MASCOT_EMAIL_SITUATIONS, mascotImagePath } from "../../src/modules/mascot/mascotPack.js";
import { BOAT_MOODS } from "../../src/modules/gamification/moods.js";

// Maskotpakken, skive 2: forhåndsvisningen (`npm run mascot:preview -- <navn>`) tegner alt pakken bidrar med til én
// HTML-fil. Testen kjører skriptet for seilbåten og ser at alle e-poster, humør og figurtilstander er med, med pakkens
// bilder og tekster. Hvordan siden ser ut, må ses på; dette passer på at skriptet ikke råtner.

const repo = process.cwd();
const out = mkdtempSync(path.join(tmpdir(), "mascot-preview-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("npm run mascot:preview", () => {
  it("tegner ni e-poster × tre språk, fem humør × tre språk og figurens tilstander for seilbåten", () => {
    const file = path.join(out, "seilbat.html");
    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
    const result = spawnSync(process.execPath, [tsxCli, path.join(repo, "src", "scripts", "mascotPreview.ts"), "seilbat", file], { cwd: repo, encoding: "utf8" });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    const html = readFileSync(file, "utf8");
    const pack = loadMascotPack(repo, "seilbat");

    // E-postene: én ramme per situasjon og språk, med pakkens bilde og bildetekst.
    for (const situation of MASCOT_EMAIL_SITUATIONS) {
      for (const locale of ["nb", "nn", "en-GB"]) expect(html).toContain(`title="${situation} ${locale}"`);
      const image = readFileSync(mascotImagePath(pack, pack.emails[situation].image)).toString("base64");
      expect(html.split(`data:image/jpeg;base64,${image}`).length - 1, situation).toBeGreaterThanOrEqual(3);
      expect(html).toContain(`alt=&quot;${pack.emails[situation].alt.nb}&quot;`);
    }
    expect(html).toContain("har vært en tur på verftet");

    // Profil: linja for hvert humør, og et ukjent humør.
    for (const mood of BOAT_MOODS) expect(html, mood).toContain(pack.moods[mood].line.nb);
    expect(html).toContain("et humør klienten ikke kjenner");

    // «Mine kurs»: flatt og fullt seil på linja, og feiringen (klassen koden setter når et kurs fullføres).
    expect(html).toContain("course-boat--sulten");
    expect(html).toContain("course-boat--mett");
    expect(html).toContain("course-boat--leaving");
    expect(html).toContain("course-boat-confetti");
    expect(html).toContain("animation: course-boat-leave 4.2s");
  }, 60_000);
});
