// #1095 fase B: skillets justeringsflyt, mekanisk. En kurseksport fra plattformen gjøres om til
// skillets arbeidssett (adjust-from-export), og produseres med endringslista (produce-course
// --changes). Det som står som «uendret» skal være ordrett som i eksporten — også etter rundturen
// gjennom filer per språk og bilder som filer — og `origin` skal følge med, så plattformen
// oppdaterer det samme kurset.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convertExport, slugify } from "../../skills/a2-authoring-api/scripts/adjust-from-export.mjs";
import { produceCourse } from "../../skills/a2-authoring-api/scripts/produce-course.mjs";

const tre = (nb: string, nn: string, en: string) => ({ nb, nn, "en-GB": en });
// Et 1×1 png: et «bilde», ikke en figur, så ingen etikettkontroll kommer i veien.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
// Et annet 1×1 png (annen farge), så to «image.png» kan skilles på innhold.
const PNG2 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

function eksport() {
  return {
    exportFormat: "a2-content-export/v1",
    exportedAt: "2026-10-12T18:00:00.000Z",
    exportedBy: null,
    exportedByEmail: null,
    scope: "course",
    course: {
      course: {
        title: tre("Møtearbeid", "Møtearbeid", "Meeting work"),
        description: tre("Om møter", "Om møte", "About meetings"),
        certificationLevel: "basic",
        sortOrder: null,
        origin: { courseId: "course-abc", exportedAt: "2026-10-12T18:00:00.000Z" },
        audit: { publishedAt: "2026-10-01T10:00:00.000Z", publishedBy: null, publishedByEmail: null, sourceVersionNo: null },
        items: [
          {
            type: "SECTION",
            sortOrder: 0,
            origin: { sectionId: "sec-abc", versionNo: 3 },
            section: {
              title: tre("Innledning", "Innleiing", "Introduction"),
              bodyMarkdown: tre(
                "Et møte trenger et mål.\n\n![Agendaen med målet for møtet skrevet øverst](asset:bilde-agenda)\n\nSkriv målet øverst.",
                "Eit møte treng eit mål.\n\n![Agendaen med målet for møtet skrive øvst](asset:bilde-agenda)\n\nSkriv målet øvst.",
                "A meeting needs a goal.\n\n![The agenda with the goal of the meeting at the top](asset:bilde-agenda)\n\nWrite the goal at the top.",
              ),
              audit: { publishedAt: "2026-10-01T10:00:00.000Z", publishedBy: null, publishedByEmail: null, sourceVersionNo: 3 },
              assets: [{ sourceId: "bilde-agenda", filename: "Skjermbilde_2026-10-01.PNG", mimeType: "image/png", sizeBytes: Buffer.from(PNG, "base64").length, contentBase64: PNG }],
            },
          },
          {
            // Slik eldre innhold ser ut: én streng som brødtekst (#892), tittel bare på bokmål, og to
            // innlimte skjermbilder som begge heter image.png.
            type: "SECTION",
            sortOrder: 2,
            origin: { sectionId: "sec-gammel", versionNo: 1 },
            section: {
              title: { nb: "Gammel del" },
              bodyMarkdown: "![Første](asset:img-1)\n\nTo bilder.\n\n![Andre](asset:img-2)",
              audit: { publishedAt: null, publishedBy: null, publishedByEmail: null, sourceVersionNo: 1 },
              assets: [
                { sourceId: "img-1", filename: "image.png", mimeType: "image/png", sizeBytes: Buffer.from(PNG, "base64").length, contentBase64: PNG },
                { sourceId: "img-2", filename: "image.png", mimeType: "image/png", sizeBytes: Buffer.from(PNG2, "base64").length, contentBase64: PNG2 },
              ],
            },
          },
          {
            type: "MODULE",
            sortOrder: 1,
            origin: { moduleId: "mod-abc", versionNo: 2 },
            module: {
              module: { title: tre("Test: møter", "Test: møte", "Test: meetings"), description: null, certificationLevel: "basic" },
              activeVersion: {
                assessmentMode: "MCQ_ONLY",
                taskText: null,
                assessorExpectedContent: null,
                candidateTaskConstraints: null,
                assessmentBlueprint: null,
                submissionSchema: null,
                assessmentPolicy: { passRules: { mcqMinPercent: 75 } },
                rubric: null,
                promptTemplate: null,
                mcqSet: {
                  title: tre("Spørsmål om møter", "Spørsmål om møte", "Questions on meetings"),
                  questions: [
                    { stem: tre("Hva trenger et møte?", "Kva treng eit møte?", "What does a meeting need?"), options: [tre("Et mål", "Eit mål", "A goal"), tre("Kake", "Kake", "Cake"), tre("Mange deltakere", "Mange deltakarar", "Many attendees")], correctAnswer: tre("Et mål", "Eit mål", "A goal"), rationale: tre("Målet styrer møtet.", "Målet styrer møtet.", "The goal steers the meeting.") },
                    { stem: tre("Hvor står målet?", "Kvar står målet?", "Where is the goal written?"), options: [tre("Øverst", "Øvst", "At the top"), tre("Nederst", "Nedst", "At the bottom"), tre("Ingen steder", "Ingen stad", "Nowhere")], correctAnswer: tre("Øverst", "Øvst", "At the top"), rationale: tre("Målet skal ses først.", "Målet skal sjåast først.", "The goal is seen first.") },
                    { stem: tre("Hvem eier referatet?", "Kven eig referatet?", "Who owns the minutes?"), options: [tre("Møtelederen", "Møteleiaren", "The chair"), tre("Alle deltakerne", "Alle deltakarane", "All attendees"), tre("Ingen av dem", "Ingen av dei", "None of them")], correctAnswer: tre("Møtelederen", "Møteleiaren", "The chair"), rationale: tre("Lederen har ansvaret.", "Leiaren har ansvaret.", "The chair is responsible.") },
                  ],
                },
                audit: { publishedAt: "2026-10-01T10:00:00.000Z", publishedBy: null, publishedByEmail: null, sourceVersionNo: 2 },
              },
            },
          },
        ],
      },
    },
  };
}

const comparable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === "audit" || key === "sortOrder") continue;
      out[key] = comparable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
};

describe("#1095 fase B — skillets justeringsflyt", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "a2-adjust-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const produser = (work: string, navn: string, medChanges = true) =>
    produceCourse({
      packageFile: path.join(work, "package.json"),
      outFile: path.join(work, `${navn}.json`),
      stateFile: path.join(work, "course-state.json"),
      ...(medChanges ? { changesFile: path.join(work, "changes.json") } : {}),
    });
  const sjekk = (result: Awaited<ReturnType<typeof produceCourse>>, navn: string) => result.checks.find((c) => c.name === navn)!;

  it("clientRef-er lages av titlene: a–z, 0–9 og bindestrek", () => {
    expect(slugify("Hva du gir KI — og hvorfor?")).toBe("hva-du-gir-ki-og-hvorfor");
    expect(slugify("Ærlig økonomi på Åsen")).toBe("aerlig-okonomi-pa-asen");
    expect(slugify("")).toBe("element");
  });

  it("uten origin er fila ikke en plattformeksport — konverteringen stopper", () => {
    const uten = eksport();
    delete (uten.course.course as { origin?: unknown }).origin;
    const result = convertExport(uten, { outDir: path.join(dir, "uten"), write: () => undefined });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("no `origin`");
  });

  it("rundturen: eksport → arbeidssett → produksjon med alt uendret gir en fil der hvert element er ordrett som i eksporten, med origin", async () => {
    const work = path.join(dir, "rundtur");
    const result = convertExport(eksport(), { outDir: work });
    expect(result.ok, result.problems.join("; ")).toBe(true);
    expect(result.state!.order).toEqual(["sec-01-innledning", "mod-02-test-moter", "sec-03-gammel-del"]);
    expect(result.state!.elements.every((e) => e.status === "approved")).toBe(true);
    expect(result.changes!.elements).toEqual({ "sec-01-innledning": "unchanged", "mod-02-test-moter": "unchanged", "sec-03-gammel-del": "unchanged" });
    expect(result.changes!.course).toBe("unchanged");
    expect((result.changes as { order?: string }).order).toBe("unchanged");
    expect(result.changes!.refs).toEqual({ "sec-01-innledning": { type: "SECTION", id: "sec-abc" }, "mod-02-test-moter": { type: "MODULE", id: "mod-abc" }, "sec-03-gammel-del": { type: "SECTION", id: "sec-gammel" } });
    // Teksten ligger som filer per språk; bildene som filer med entydige navn, men plattformens filnavn beholdes i pakka.
    expect(readFileSync(path.join(work, "sections/sec-01-innledning.nn.md"), "utf8")).toContain("Eit møte treng eit mål.");
    expect(readFileSync(path.join(work, "assets/sec-01-innledning/01-skjermbilde-2026-10-01.png")).length).toBe(Buffer.from(PNG, "base64").length);
    const pkgObjs = (result.pkg as { objects: Array<{ clientRef: string; payload: { assets?: Array<{ file: string; filename: string }>; bodyMarkdown?: unknown } }> }).objects;
    expect(pkgObjs[0]!.payload.assets![0]).toMatchObject({ file: "assets/sec-01-innledning/01-skjermbilde-2026-10-01.png", filename: "Skjermbilde_2026-10-01.PNG", mimeType: "image/png" });
    // To «image.png» får hver sin fil på disk, med hvert sitt innhold; og strengen forblir en streng.
    expect(pkgObjs[2]!.payload.assets!.map((a) => a.file)).toEqual(["assets/sec-03-gammel-del/01-image.png", "assets/sec-03-gammel-del/02-image.png"]);
    expect(readFileSync(path.join(work, "assets/sec-03-gammel-del/02-image.png")).equals(Buffer.from(PNG2, "base64"))).toBe(true);
    expect(pkgObjs[2]!.payload.bodyMarkdown).toBe("![Første](asset:img-1)\n\nTo bilder.\n\n![Andre](asset:img-2)");

    const produced = await produser(work, "oppdatert");
    expect(produced.ok, produced.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("\n")).toBe(true);
    expect(sjekk(produced, "changes").summary).toContain("3 unchanged");
    expect(produced.files[0]!.importAt).toContain("Oppdater dette kurset");

    const fil = JSON.parse(readFileSync(produced.files[0]!.file, "utf8"));
    expect(fil.course.course.origin).toEqual({ courseId: "course-abc" });
    const items = fil.course.course.items;
    expect(items.map((i: { origin: unknown }) => i.origin)).toEqual([{ sectionId: "sec-abc", versionNo: 3 }, { moduleId: "mod-abc", versionNo: 2 }, { sectionId: "sec-gammel", versionNo: 1 }]);
    const baseline = [...eksport().course.course.items].sort((x, y) => x.sortOrder - y.sortOrder);
    expect(comparable(items[0].section)).toEqual(comparable(baseline[0]!.section));
    expect(comparable(items[1].module)).toEqual(comparable(baseline[1]!.module));
    // Den gamle delen — delvis tittel, ren streng, to like filnavn — er også ordrett, og stoppet ikke språkkontrollen.
    expect(comparable(items[2].section)).toEqual(comparable(baseline[2]!.section));
    expect(sjekk(produced, "languages").status).toBe("ok");
    // #1120: en justering endrer bare det forfatteren ber om — ingen merknad om «finn feilene».
    expect(sjekk(produced, "find errors").status).toBe("skipped");
    // Ingen publiseringshistorikk i fila: plattformen publiserer ingenting.
    expect(items[0].section.audit).toEqual({});
    expect(items[1].module.activeVersion.audit).toEqual({});
    expect(fil.provenance?.producer).toBe("agent_authoring");
  });

  it("«uendret» som likevel er endret stopper produksjonen; «endret» som er ordrett stopper den også", async () => {
    const work = path.join(dir, "endret");
    expect(convertExport(eksport(), { outDir: work }).ok).toBe(true);
    const nbFil = path.join(work, "sections/sec-01-innledning.nb.md");
    writeFileSync(nbFil, readFileSync(nbFil, "utf8").replace("Skriv målet øverst.", "Skriv målet øverst, med én setning."), "utf8");

    const stille = await produser(work, "stille");
    expect(stille.ok).toBe(false);
    expect(sjekk(stille, "changes").status).toBe("fail");
    expect(sjekk(stille, "changes").details.join(" ")).toContain("listed as unchanged, but it differs");

    const changesFil = path.join(work, "changes.json");
    const changes = JSON.parse(readFileSync(changesFil, "utf8"));
    changes.elements["sec-01-innledning"] = "changed";
    changes.elements["mod-02-test-moter"] = "changed"; // men modulen er ordrett
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const usann = await produser(work, "usann");
    expect(usann.ok).toBe(false);
    expect(sjekk(usann, "changes").details.join(" ")).toContain("listed as changed, but it is word for word");

    changes.elements["mod-02-test-moter"] = "unchanged";
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const sann = await produser(work, "sann");
    expect(sann.ok, sann.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("\n")).toBe(true);
    expect(sjekk(sann, "changes").summary).toContain("2 unchanged (word for word), 1 changed");
    const fil = JSON.parse(readFileSync(sann.files[0]!.file, "utf8"));
    expect(fil.course.course.items[0].section.bodyMarkdown.nb).toContain("med én setning");
    expect(fil.course.course.items[0].origin).toEqual({ sectionId: "sec-abc", versionNo: 3 });

    // Bildet tegnes om fra png til svg: fila på disk er sannheten, så importfila sier svg — ikke png over svg-bytes.
    const pkgFil = path.join(work, "package.json");
    const pkg = JSON.parse(readFileSync(pkgFil, "utf8"));
    writeFileSync(path.join(work, "assets/sec-01-innledning/agenda.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect x="5" y="5" width="90" height="30" fill="#eee"/></svg>', "utf8");
    pkg.objects[0].payload.assets[0].file = "assets/sec-01-innledning/agenda.svg";
    writeFileSync(pkgFil, JSON.stringify(pkg), "utf8");
    const omtegnet = await produser(work, "omtegnet");
    expect(omtegnet.ok, omtegnet.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("; ")).toBe(true);
    const fil2 = JSON.parse(readFileSync(omtegnet.files[0]!.file, "utf8"));
    expect(fil2.course.course.items[0].section.assets[0]).toMatchObject({ sourceId: "bilde-agenda", filename: "agenda.svg", mimeType: "image/svg+xml" });
  });

  it("spørsmålsregelen teller hele kurset: en ny test etter fire uendrede seksjoner trenger fire spørsmål", async () => {
    const work = path.join(dir, "sporsmal");
    const fire = eksport();
    // Tre seksjoner til, uendret, foran testen.
    for (let n = 0; n < 3; n += 1) {
      fire.course.course.items.push({ type: "SECTION", sortOrder: 3 + n, origin: { sectionId: `sec-x${n}`, versionNo: 1 }, section: { title: tre(`Del ${n}`, `Del ${n}`, `Part ${n}`), bodyMarkdown: tre(`Tekst ${n}.`, `Tekst ${n}.`, `Text ${n}.`), audit: { publishedAt: null, publishedBy: null, publishedByEmail: null, sourceVersionNo: 1 } } } as never);
    }
    expect(convertExport(fire, { outDir: work }).ok).toBe(true);
    const pkgFil = path.join(work, "package.json");
    const pkg = JSON.parse(readFileSync(pkgFil, "utf8"));
    const course = pkg.objects.find((o: { type: string }) => o.type === "course");
    const mal = pkg.objects.find((o: { clientRef: string }) => o.clientRef === "mod-02-test-moter");
    const nyTest = JSON.parse(JSON.stringify(mal));
    delete nyTest.origin;
    nyTest.clientRef = "mod-07-ny-test";
    nyTest.payload.module.title = tre("Ny test", "Ny test", "New test");
    // Riktig svar på ulike plasser, så cue-kontrollen (posisjonsskjevhet) ikke er det som stopper.
    for (const [i, q] of (nyTest.payload.activeVersion.mcqSet.questions as Array<{ options: unknown[]; correctAnswer: unknown }>).entries()) {
      const riktig = q.options.find((o) => JSON.stringify(o) === JSON.stringify(q.correctAnswer))!;
      const andre = q.options.filter((o) => o !== riktig);
      andre.splice((i + 1) % 3, 0, riktig);
      q.options = andre;
    }
    pkg.objects.splice(pkg.objects.indexOf(course), 0, nyTest);
    course.payload.items.push({ type: "MODULE", ref: "mod-07-ny-test" });
    writeFileSync(pkgFil, JSON.stringify(pkg), "utf8");
    const changesFil = path.join(work, "changes.json");
    const changes = JSON.parse(readFileSync(changesFil, "utf8"));
    changes.elements["mod-07-ny-test"] = "new";
    changes.order = "changed"; // et nytt element på slutten endrer ikke rekkefølgen til de gamle — men lista sier det eksplisitt
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");

    // Fire uendrede seksjoner foran (sec-03 og tre til), tre spørsmål: for få — og det sies, selv om seksjonene er uendret.
    const forFaa = await produser(work, "forfaa");
    expect(forFaa.ok).toBe(false);
    expect(sjekk(forFaa, "questions").details.join(" ")).toContain('"mod-07-ny-test": 3 question(s) after 4 section(s)');
    // Den uendrede testen (mod-02) rapporteres ikke, selv om den har tre spørsmål etter én seksjon (som er greit uansett).
    expect(sjekk(forFaa, "questions").details.join(" ")).not.toContain("mod-02-test-moter");
    changes.order = "unchanged";
    nyTest.payload.activeVersion.mcqSet.questions.push({ stem: tre("Hva avslutter et møte?", "Kva avsluttar eit møte?", "What ends a meeting?"), options: [tre("En oppsummering", "Ei oppsummering", "A summary"), tre("Et nytt møte", "Eit nytt møte", "Another meeting"), tre("Ingen avslutning", "Inga avslutning", "No ending")], correctAnswer: tre("En oppsummering", "Ei oppsummering", "A summary"), rationale: tre("Oppsummeringen samler.", "Oppsummeringa samlar.", "The summary gathers.") });
    writeFileSync(pkgFil, JSON.stringify(pkg), "utf8");
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const nok = await produser(work, "nok");
    expect(nok.ok, nok.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("; ")).toBe(true);

    // En ENDRET test som alt hadde tre spørsmål i eksporten, flyttet bak fire seksjoner (en skrivefeil
    // rettes): den tvinges ikke til å vokse — kravet går ikke over det eksporten hadde.
    // Rekkefølge nå: sec-01, sec-03, tre uendrede, mod-02 (endret, 3 spørsmål, hadde 3), mod-07 (ny, etter 0 seksjoner).
    course.payload.items = course.payload.items.filter((i: { ref: string }) => i.ref !== "mod-02-test-moter" && i.ref !== "mod-07-ny-test");
    course.payload.items.push({ type: "MODULE", ref: "mod-02-test-moter" }, { type: "MODULE", ref: "mod-07-ny-test" });
    mal.payload.activeVersion.mcqSet.questions[0].rationale = tre("Målet styrer møtet — alltid.", "Målet styrer møtet — alltid.", "The goal steers the meeting — always.");
    writeFileSync(pkgFil, JSON.stringify(pkg), "utf8");
    changes.elements["mod-02-test-moter"] = "changed";
    changes.order = "changed";
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const liten = await produser(work, "liten");
    expect(liten.ok, liten.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("; ")).toBe(true);
  });

  it("rekkefølgen har sin egen linje: flyttede elementer uten «order: changed» stopper", async () => {
    const work = path.join(dir, "rekkefolge");
    expect(convertExport(eksport(), { outDir: work }).ok).toBe(true);
    const pkgFil = path.join(work, "package.json");
    const pkg = JSON.parse(readFileSync(pkgFil, "utf8"));
    const course = pkg.objects.find((o: { type: string }) => o.type === "course");
    course.payload.items = [course.payload.items[1], course.payload.items[0], course.payload.items[2]];
    writeFileSync(pkgFil, JSON.stringify(pkg), "utf8");
    const stille = await produser(work, "stille");
    expect(stille.ok).toBe(false);
    expect(sjekk(stille, "changes").details.join(" ")).toContain("order: listed as unchanged, but the elements stand in another order");
    const changesFil = path.join(work, "changes.json");
    const changes = JSON.parse(readFileSync(changesFil, "utf8"));
    changes.order = "changed";
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const sagt = await produser(work, "sagt");
    expect(sagt.ok, sagt.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("; ")).toBe(true);
    expect(sjekk(sagt, "changes").summary).toContain("3 unchanged");
  });

  // #1126: en uendret seksjon med «Formål», «Nøkkelpoeng» og «Kort oppsummering» er kurset slik det står —
  // justeringen stopper ikke på den. Først når forfatteren ber om å endre seksjonen, gjelder regelen.
  it("tre oppsummeringer i en uendret seksjon stopper ikke en justering; i en endret seksjon gjør de det (#1126)", async () => {
    const work = path.join(dir, "oppsummeringer");
    const tre3 = eksport();
    const seksjon = tre3.course.course.items[0]!.section as unknown as { bodyMarkdown: { nb: string; nn: string; "en-GB": string } };
    seksjon.bodyMarkdown = tre(
      `## Formål\n\nA.\n\n${seksjon.bodyMarkdown.nb}\n\n## Nøkkelpoeng\n\n- B.\n\n## Kort oppsummering\n\nC.`,
      `## Føremål\n\nA.\n\n${seksjon.bodyMarkdown.nn}\n\n## Nøkkelpoeng\n\n- B.\n\n## Kort oppsummering\n\nC.`,
      `## Purpose\n\nA.\n\n${seksjon.bodyMarkdown["en-GB"]}\n\n## Key points\n\n- B.\n\n## Brief summary\n\nC.`,
    );
    expect(convertExport(tre3, { outDir: work }).ok).toBe(true);
    const uendret = await produser(work, "uendret");
    expect(uendret.ok, uendret.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("; ")).toBe(true);
    expect(sjekk(uendret, "summaries").status).toBe("ok");

    const nbFil = path.join(work, "sections/sec-01-innledning.nb.md");
    writeFileSync(nbFil, readFileSync(nbFil, "utf8").replace("Skriv målet øverst.", "Skriv målet øverst, med én setning."), "utf8");
    const changesFil = path.join(work, "changes.json");
    const changes = JSON.parse(readFileSync(changesFil, "utf8"));
    changes.elements["sec-01-innledning"] = "changed";
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const endret = await produser(work, "endret");
    expect(sjekk(endret, "summaries").status).toBe("fail");
    expect(sjekk(endret, "summaries").details.join(" ")).toContain('"sec-01-innledning" (nb, nn, en-GB): 3 summaries');
  });

  it("nytt element uten origin listes som «new»; et fjernet element listes som «removed»; et glemt element stopper", async () => {
    const work = path.join(dir, "nytt");
    expect(convertExport(eksport(), { outDir: work }).ok).toBe(true);
    const pkgFil = path.join(work, "package.json");
    const pkg = JSON.parse(readFileSync(pkgFil, "utf8"));
    writeFileSync(path.join(work, "sections/sec-03-oppsummering.nb.md"), "Oppsummering av møtet.", "utf8");
    writeFileSync(path.join(work, "sections/sec-03-oppsummering.nn.md"), "Oppsummering av møtet.", "utf8");
    writeFileSync(path.join(work, "sections/sec-03-oppsummering.en-GB.md"), "Summary of the meeting.", "utf8");
    pkg.objects.splice(3, 0, { clientRef: "sec-03-oppsummering", type: "section", payload: { title: tre("Oppsummering", "Oppsummering", "Summary"), bodyFiles: { nb: "sections/sec-03-oppsummering.nb.md", nn: "sections/sec-03-oppsummering.nn.md", "en-GB": "sections/sec-03-oppsummering.en-GB.md" } } });
    const course = pkg.objects.find((o: { type: string }) => o.type === "course");
    course.payload.items.push({ type: "SECTION", ref: "sec-03-oppsummering" });
    writeFileSync(pkgFil, JSON.stringify(pkg), "utf8");
    const changesFil = path.join(work, "changes.json");
    const changes = JSON.parse(readFileSync(changesFil, "utf8"));

    // Glemt i endringslista → stopp.
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const glemt = await produser(work, "glemt");
    expect(glemt.ok).toBe(false);
    expect(sjekk(glemt, "changes").details.join(" ")).toContain("not in the change list");

    changes.elements["sec-03-oppsummering"] = "new";
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const ny = await produser(work, "ny");
    expect(ny.ok, ny.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("\n")).toBe(true);
    const fil = JSON.parse(readFileSync(ny.files[0]!.file, "utf8"));
    expect(fil.course.course.items.map((i: { origin?: unknown }) => i.origin ?? null)).toEqual([{ sectionId: "sec-abc", versionNo: 3 }, { moduleId: "mod-abc", versionNo: 2 }, { sectionId: "sec-gammel", versionNo: 1 }, null]);

    // Ta ut innledningen: ut av pakka, av rekkefølgen og av kurstilstanden (status removed), og listet som removed.
    pkg.objects = pkg.objects.filter((o: { clientRef: string }) => o.clientRef !== "sec-01-innledning");
    course.payload.items = course.payload.items.filter((i: { ref: string }) => i.ref !== "sec-01-innledning");
    writeFileSync(pkgFil, JSON.stringify(pkg), "utf8");
    const stateFil = path.join(work, "course-state.json");
    const state = JSON.parse(readFileSync(stateFil, "utf8"));
    state.order = state.order.filter((ref: string) => ref !== "sec-01-innledning");
    for (const el of state.elements) if (el.clientRef === "sec-01-innledning") el.status = "removed";
    writeFileSync(stateFil, JSON.stringify(state), "utf8");
    const uten = await produser(work, "uten");
    expect(uten.ok).toBe(false);
    expect(sjekk(uten, "changes").details.join(" ")).toContain("does not say \"removed\"");
    // Feil element listet som removed (modulen står fortsatt i pakka): innledningen mangler likevel uten forklaring.
    changes.elements["mod-02-test-moter"] = "removed";
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const feilRef = await produser(work, "feilref");
    expect(feilRef.ok).toBe(false);
    expect(sjekk(feilRef, "changes").details.join(" ")).toContain("still in the package");
    expect(sjekk(feilRef, "changes").details.join(" ")).toContain('does not say "removed" for it');
    changes.elements["mod-02-test-moter"] = "unchanged";
    changes.elements["sec-01-innledning"] = "removed";
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const fjernet = await produser(work, "fjernet");
    expect(fjernet.ok, fjernet.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("\n")).toBe(true);
    expect(sjekk(fjernet, "changes").summary).toContain("1 removed");
  });

  it("kursets egne felt har sin egen linje: endret tittel uten «course: changed» stopper", async () => {
    const work = path.join(dir, "kursfelt");
    expect(convertExport(eksport(), { outDir: work }).ok).toBe(true);
    const pkgFil = path.join(work, "package.json");
    const pkg = JSON.parse(readFileSync(pkgFil, "utf8"));
    pkg.objects.find((o: { type: string }) => o.type === "course").payload.course.title = tre("Møtearbeid 2", "Møtearbeid 2", "Meeting work 2");
    writeFileSync(pkgFil, JSON.stringify(pkg), "utf8");
    const stille = await produser(work, "stille");
    expect(stille.ok).toBe(false);
    expect(sjekk(stille, "changes").details.join(" ")).toContain("course: listed as unchanged, but its title");
    const changesFil = path.join(work, "changes.json");
    const changes = JSON.parse(readFileSync(changesFil, "utf8"));
    changes.course = "changed";
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const sagt = await produser(work, "sagt");
    expect(sagt.ok, sagt.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("; ")).toBe(true);
  });

  it("et kurs med origin uten endringsliste produseres ikke — «uendret er uendret» må kjøres", async () => {
    const work = path.join(dir, "utenliste");
    expect(convertExport(eksport(), { outDir: work }).ok).toBe(true);
    const result = await produser(work, "x", false);
    expect(result.ok).toBe(false);
    expect(sjekk(result, "changes").summary).toContain("no --changes file");
  });
});
