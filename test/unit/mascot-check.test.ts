import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  celebrationDurationsMs,
  checkAllMascotPacks,
  checkMascotPack,
  formatMascotCheckReport,
  jpegSize,
  MASCOT_CELEBRATION_CLASS,
  mascotCheckPassed,
} from "../../src/modules/mascot/mascotCheck.js";

// Maskotpakken, skive 2 (doc/design/MASKOTPAKKE.md, «Sjekken»): den fulle sjekken, over alle pakker i mascots/, med
// alle feil listet på én gang. Testen kjører `npm run mascot:check` (skriptet) mot repoet, så sjekken kjører i CI, og
// mot kopier av seilbåten med én feil om gangen, så hver regel er vist å slå til.

const repo = process.cwd();
const SWAP_ROOT = path.join(repo, "test", "fixtures", "mascot-swap");
const temp: string[] = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** En kopi av seilbåten i en egen rot. `change` får pakkemappa og manifestet, og kan endre begge. */
function copyWith(change: (dir: string, manifest: Record<string, any>) => void = () => {}): { root: string; dir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "mascot-check-"));
  temp.push(root);
  const dir = path.join(root, "mascots", "seilbat");
  cpSync(path.join(repo, "mascots", "seilbat"), dir, { recursive: true });
  writeFileSync(path.join(root, "mascot.config.json"), JSON.stringify({ mascot: "seilbat" }));
  const file = path.join(dir, "mascot.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
  change(dir, manifest);
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  return { root, dir };
}

function problemsWith(change: (dir: string, manifest: Record<string, any>) => void): string[] {
  return checkMascotPack(copyWith(change).root, "seilbat");
}

/** En kopi av JPEG-fila med en annen bredde og høyde i rammen (SOF). Bildedataene er de samme. */
function withJpegSize(bytes: Buffer, width: number, height: number): Buffer {
  const copy = Buffer.from(bytes);
  for (let i = 2; i < copy.length - 9; i += 1) {
    if (copy[i] === 0xff && copy[i + 1]! >= 0xc0 && copy[i + 1]! <= 0xc3) {
      copy.writeUInt16BE(height, i + 5);
      copy.writeUInt16BE(width, i + 7);
      return copy;
    }
  }
  throw new Error("fant ingen SOF-markør");
}

const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const checkScript = path.join(repo, "src", "scripts", "mascotCheck.ts");
function runCheckScript(cwd: string) {
  const result = spawnSync(process.execPath, [tsxCli, checkScript], { cwd, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("npm run mascot:check", () => {
  it("alle pakker i mascots/ er i orden (kjører i CI)", () => {
    const { status, output } = runCheckScript(repo);
    expect(output).toContain("✓ seilbat");
    expect(status, output).toBe(0);
  });

  it("en pakke med feil gir kode 1 og ALLE feilene på én gang", () => {
    const { root } = copyWith((dir, m) => {
      m.moods.mett.line.nn = "";
      m.emails.appeal.alt.nb = "Se www.example.test";
      m.figure.celebrationMs = 4000;
      writeFileSync(path.join(dir, "figure", "flatt.svg"), readFileSync(path.join(dir, "figure", "flatt.svg"), "utf8").replace("</svg>", "<script>alert(1)</script></svg>"));
    });
    const { status, output } = runCheckScript(root);
    expect(status).toBe(1);
    expect(output).toContain("✗ seilbat: 4 feil");
    expect(output).toContain("moods.mett.line.nn mangler");
    expect(output).toContain("emails.appeal.alt.nb har noe som ligner en adresse");
    expect(output).toContain("figure.celebrationMs er 4000 ms, men animasjonen på .course-boat--leaving i figure.css varer 4200 ms");
    expect(output).toContain("figure/flatt.svg har <script>");
  });
});

describe("sjekken av alle pakker", () => {
  it("seilbåten og testpakken er i orden (kontrollcase for reglene under)", () => {
    expect(checkAllMascotPacks(repo)).toEqual({ general: [], packs: [{ id: "seilbat", problems: [] }] });
    expect(checkAllMascotPacks(SWAP_ROOT)).toEqual({ general: [], packs: [{ id: "testbat", problems: [] }] });
    expect(checkMascotPack(copyWith().root, "seilbat")).toEqual([]);
  });

  it("hver pakke i mascots/ sjekkes, ikke bare den valgte", () => {
    const { root } = copyWith();
    cpSync(path.join(root, "mascots", "seilbat"), path.join(root, "mascots", "annen"), { recursive: true });
    writeFileSync(path.join(root, "mascots", "annen", "images", "anke.jpg"), "ikke et bilde");
    const report = checkAllMascotPacks(root);
    expect(report.packs.map((p) => p.id).sort()).toEqual(["annen", "seilbat"]);
    expect(report.packs.find((p) => p.id === "seilbat")!.problems).toEqual([]);
    expect(report.packs.find((p) => p.id === "annen")!.problems).toEqual([expect.stringContaining("images/anke.jpg (emails.appeal.image) er ikke en JPEG-fil")]);
    expect(mascotCheckPassed(report)).toBe(false);
    expect(formatMascotCheckReport(report)).toMatch(/^✗ annen: 1 feil\n {4}- images\/anke\.jpg .*\n✓ seilbat$/);
  });

  it("valget i mascot.config.json må finnes, og mappenavnene må kunne stå i en adresse", () => {
    const { root } = copyWith();
    writeFileSync(path.join(root, "mascot.config.json"), JSON.stringify({ mascot: "finnes-ikke" }));
    cpSync(path.join(root, "mascots", "seilbat"), path.join(root, "mascots", "Stor Bokstav"), { recursive: true });
    expect(checkAllMascotPacks(root).general).toEqual([
      expect.stringContaining("mascots/Stor Bokstav: mappenavnet må være små bokstaver"),
      "mascot.config.json velger «finnes-ikke», men mascots/finnes-ikke/ finnes ikke",
    ]);
  });
});

describe("reglene, én om gangen", () => {
  it("humør, e-postsituasjoner, tekster og språk koden ikke kjenner", () => {
    const problems = problemsWith((_dir, m) => {
      m.moods.glad = m.moods.mett;
      m.emails.weekly = m.emails.passed;
      m.emailTexts.weeklyIntro = m.emailTexts.courseNewVersionIntro;
      m.figure.states.seiler = "figure/flatt.svg";
      m.moods.ny.line.en = "Ready";
      m.anker = {};
    });
    expect(problems).toEqual([
      expect.stringContaining("anker er en nøkkel koden ikke kjenner"),
      expect.stringContaining("moods.glad er et humør koden ikke kjenner (koden har: ny, mett, sulten, sur, dramatisk)"),
      expect.stringContaining("emails.weekly er en e-postsituasjon koden ikke kjenner"),
      expect.stringContaining("emailTexts.weeklyIntro er en e-posttekst koden ikke kjenner"),
      expect.stringContaining("figure.states.seiler er en figurtilstand koden ikke kjenner"),
      expect.stringContaining("moods.ny.line.en er et språk koden ikke kjenner"),
    ]);
  });

  it("en tekst som mangler eller er tom, på hvert språk", () => {
    const problems = problemsWith((_dir, m) => {
      m.moods.sur.line.nn = "  ";
      delete m.emails.discussion.alt["en-GB"];
      m.emailTexts.courseNewVersionIntro.nb = "";
    });
    expect(problems).toEqual([
      "moods.sur.line.nn mangler",
      "emails.discussion.alt.en-GB mangler",
      "emailTexts.courseNewVersionIntro.nb mangler",
    ]);
  });

  it("bildene: JPEG, 600 × 200, under 30 kB", () => {
    const problems = problemsWith((dir) => {
      const images = path.join(dir, "images");
      writeFileSync(path.join(images, "anke.jpg"), withJpegSize(readFileSync(path.join(images, "anke.jpg")), 600, 300));
      appendFileSync(path.join(images, "diskusjon.jpg"), Buffer.alloc(10 * 1024));
      copyFileSync(path.join(dir, "favicon-32.png"), path.join(images, "frist-snart.jpg"));
    });
    expect(problems).toEqual([
      "images/frist-snart.jpg (emails.dueSoon.image) er ikke en JPEG-fil som kan leses",
      "images/anke.jpg (emails.appeal.image) er 600 × 300; bildene skal være 600 × 200",
      expect.stringMatching(/^images\/diskusjon\.jpg \(emails\.discussion\.image\) er 31\.6 kB; bildene skal være under 30\.0 kB$/),
    ]);
  });

  it("et bilde brukt flere steder, nevnes én gang med alle stedene", () => {
    const problems = problemsWith((dir) => {
      const file = path.join(dir, "images", "frist-forfalt.jpg");
      writeFileSync(file, withJpegSize(readFileSync(file), 300, 100));
    });
    expect(problems).toEqual([
      "images/frist-forfalt.jpg (moods.sur.image, moods.dramatisk.image, emails.overdue.image) er 300 × 100; bildene skal være 600 × 200",
    ]);
  });

  it("adresser i bildetekster, humørlinjer og e-posttekster (samme regel som e-postene)", () => {
    const problems = problemsWith((_dir, m) => {
      m.emails.passed.alt["en-GB"] = "See https://example.test";
      m.moods.mett.line.nb = "Les mer på WWW.example.test";
      m.emailTexts.courseNewVersionIntro.nn = "Kurset «{course}» http:versjon {major}.";
    });
    expect(problems).toEqual([
      "moods.mett.line.nb har noe som ligner en adresse (http:, https: eller www.), og e-poster kan ikke ha det: «Les mer på WWW.example.test»",
      "emails.passed.alt.en-GB har noe som ligner en adresse (http:, https: eller www.), og e-poster kan ikke ha det: «See https://example.test»",
      "emailTexts.courseNewVersionIntro.nn har noe som ligner en adresse (http:, https: eller www.), og e-poster kan ikke ha det: «Kurset «{course}» http:versjon {major}.»",
    ]);
  });

  it("SVG-ene: skript, on…-attributter, foreignObject og referanser ut av fila, også i filer pakken ikke viser til", () => {
    const problems = problemsWith((dir) => {
      const edit = (rel: string, from: string, to: string) => {
        const file = path.join(dir, rel);
        writeFileSync(file, readFileSync(file, "utf8").replace(from, to));
      };
      edit("figure/flatt.svg", "</svg>", "<script>alert(1)</script></svg>");
      edit("figure/fullt.svg", 'focusable="false"', 'focusable="false" onload="alert(1)"');
      edit("figure/feiring.svg", "</svg>", '<image href="https://example.test/x.png"/><use xlink:href="#ok"/></svg>');
      edit("favicon.svg", 'clip-path="url(#seil)"', 'clip-path="url(https://example.test/x.svg#seil)"');
      writeFileSync(path.join(dir, "figure", "ekstra.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject></foreignObject><style>@import "x.css";</style></svg>');
    });
    expect(problems.sort()).toEqual([
      "favicon.svg henter noe utenfra: url(https://example.test/x.svg#seil)",
      "figure/ekstra.svg har <foreignObject> (HTML inne i SVG)",
      "figure/ekstra.svg henter noe utenfra: @import",
      'figure/feiring.svg henter noe utenfra: href="https://example.test/x.png"',
      "figure/flatt.svg har <script>",
      "figure/fullt.svg har et on…-attributt (kjører skript)",
    ]);
  });

  it("figure.css henter ingenting utenfra", () => {
    const problems = problemsWith((dir) => {
      appendFileSync(path.join(dir, "figure.css"), '\n.course-boat { background: url("https://example.test/bg.png"); }\n');
    });
    expect(problems).toEqual(['figure.css henter noe utenfra: url("https://example.test/bg.png")']);
  });

  it("feiringen varer like lenge i mascot.json som i figure.css", () => {
    expect(problemsWith((_dir, m) => { m.figure.celebrationMs = 4000; })).toEqual([
      "figure.celebrationMs er 4000 ms, men animasjonen på .course-boat--leaving i figure.css varer 4200 ms",
    ]);
    const withoutAnimation = problemsWith((dir) => {
      const file = path.join(dir, "figure.css");
      writeFileSync(file, readFileSync(file, "utf8").replace("animation: course-boat-leave 4.2s ease-in-out forwards;", ""));
    });
    expect(withoutAnimation).toEqual([
      "figure.css har ingen animasjon med varighet på .course-boat--leaving (feiringen); den skal vare figure.celebrationMs (4200 ms)",
    ]);
  });

  it("varigheten leses fra forkortelsen og fra animation-duration, i s og ms; uten varighet telles ikke", () => {
    expect(celebrationDurationsMs(".course-boat--leaving { animation: x 4.2s ease-in 0.5s forwards; }")).toEqual([4200]);
    expect(celebrationDurationsMs(".a, .course-boat--leaving { animation-duration: 3500ms; }")).toEqual([3500]);
    expect(celebrationDurationsMs("@media (x) { .course-boat--leaving { animation: none; } }")).toEqual([]);
    expect(celebrationDurationsMs("/* .course-boat--leaving { animation: x 1s; } */ .course-boat--leaving-not { animation: x 2s; }")).toEqual([]);
  });

  it("en eldre pakke sier hvilken versjon koden leser, og lister hver nøkkel som mangler", () => {
    const problems = problemsWith((_dir, m) => {
      m.version = 0;
      delete m.emailTexts;
    });
    expect(problems).toEqual([
      "version er 0, men koden leser versjon 1: pakken er laget for en eldre utgave av koden. Legg inn det som mangler (listet her), se mascots/seilbat/README.md, og sett version til 1",
      "emailTexts.courseNewVersionIntro.en-GB mangler",
      "emailTexts.courseNewVersionIntro.nb mangler",
      "emailTexts.courseNewVersionIntro.nn mangler",
    ]);
    expect(problemsWith((_dir, m) => { m.version = 2; })).toEqual([
      "version er 2, men koden leser versjon 1: pakken er laget for en nyere utgave av koden",
    ]);
    expect(problemsWith((_dir, m) => { delete m.version; })).toEqual([
      "version mangler eller er ikke et heltall (fant undefined); koden leser versjon 1",
    ]);
  });
});

describe("det sjekken bygger på", () => {
  it("bredde og høyde leses fra JPEG-headeren", () => {
    const bytes = readFileSync(path.join(repo, "mascots", "seilbat", "images", "anke.jpg"));
    expect(jpegSize(bytes)).toEqual({ width: 600, height: 200 });
    expect(jpegSize(withJpegSize(bytes, 1200, 400))).toEqual({ width: 1200, height: 400 });
    expect(jpegSize(readFileSync(path.join(repo, "mascots", "seilbat", "favicon-32.png")))).toBeNull();
    expect(jpegSize(bytes.subarray(0, 20))).toBeNull();
  });

  it("klassen for feiringen er den figurkoden setter", () => {
    const client = readFileSync(path.join(repo, "public", "static", "course-progress-boat.js"), "utf8");
    expect(client).toContain(`"course-boat course-boat--feirer ${MASCOT_CELEBRATION_CLASS}"`);
  });

  it("web og worker sjekker pakken først når de starter (index.ts)", () => {
    const index = readFileSync(path.join(repo, "src", "index.ts"), "utf8");
    const start = index.indexOf("async function startServer() {");
    expect(start).toBeGreaterThan(0);
    const body = index.slice(start, index.indexOf("\n}\n", start));
    expect(body.indexOf("assertActiveMascotPack()")).toBeGreaterThan(0);
    expect(body.indexOf("assertActiveMascotPack()")).toBeLessThan(body.indexOf("if (startWeb)"));
    // Begge rollene går gjennom startServer, og en feil der stopper oppstarten.
    expect(index).toMatch(/void startServer\(\)\.catch\(\(error\) => \{\s*\/\/ eslint-disable-next-line no-console\s*console\.error\("Application startup failed\.", error\);\s*gracefulShutdown\(1\);/);
  });
});
