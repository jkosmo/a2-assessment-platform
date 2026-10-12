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
                "Et møte trenger et mål.\n\n![Agenda](asset:bilde-agenda)\n\nSkriv målet øverst.",
                "Eit møte treng eit mål.\n\n![Agenda](asset:bilde-agenda)\n\nSkriv målet øvst.",
                "A meeting needs a goal.\n\n![Agenda](asset:bilde-agenda)\n\nWrite the goal at the top.",
              ),
              audit: { publishedAt: "2026-10-01T10:00:00.000Z", publishedBy: null, publishedByEmail: null, sourceVersionNo: 3 },
              assets: [{ sourceId: "bilde-agenda", filename: "agenda.png", mimeType: "image/png", sizeBytes: Buffer.from(PNG, "base64").length, contentBase64: PNG }],
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
    expect(result.state!.order).toEqual(["sec-01-innledning", "mod-02-test-moter"]);
    expect(result.state!.elements.every((e) => e.status === "approved")).toBe(true);
    expect(result.changes!.elements).toEqual({ "sec-01-innledning": "unchanged", "mod-02-test-moter": "unchanged" });
    // Teksten ligger som filer per språk, bildet som fil.
    expect(readFileSync(path.join(work, "sections/sec-01-innledning.nn.md"), "utf8")).toContain("Eit møte treng eit mål.");
    expect(readFileSync(path.join(work, "assets/sec-01-innledning/agenda.png")).length).toBe(Buffer.from(PNG, "base64").length);

    const produced = await produser(work, "oppdatert");
    expect(produced.ok, produced.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("\n")).toBe(true);
    expect(sjekk(produced, "changes").summary).toContain("2 unchanged");
    expect(produced.files[0]!.importAt).toContain("Oppdater dette kurset");

    const fil = JSON.parse(readFileSync(produced.files[0]!.file, "utf8"));
    expect(fil.course.course.origin).toEqual({ courseId: "course-abc" });
    const items = fil.course.course.items;
    expect(items.map((i: { origin: unknown }) => i.origin)).toEqual([{ sectionId: "sec-abc", versionNo: 3 }, { moduleId: "mod-abc", versionNo: 2 }]);
    const baseline = eksport().course.course.items;
    expect(comparable(items[0].section)).toEqual(comparable(baseline[0]!.section));
    expect(comparable(items[1].module)).toEqual(comparable(baseline[1]!.module));
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
    expect(sjekk(sann, "changes").summary).toContain("1 unchanged (word for word), 1 changed");
    const fil = JSON.parse(readFileSync(sann.files[0]!.file, "utf8"));
    expect(fil.course.course.items[0].section.bodyMarkdown.nb).toContain("med én setning");
    expect(fil.course.course.items[0].origin).toEqual({ sectionId: "sec-abc", versionNo: 3 });
  });

  it("nytt element uten origin listes som «new»; et fjernet element listes som «removed»; et glemt element stopper", async () => {
    const work = path.join(dir, "nytt");
    expect(convertExport(eksport(), { outDir: work }).ok).toBe(true);
    const pkgFil = path.join(work, "package.json");
    const pkg = JSON.parse(readFileSync(pkgFil, "utf8"));
    writeFileSync(path.join(work, "sections/sec-03-oppsummering.nb.md"), "Oppsummering av møtet.", "utf8");
    writeFileSync(path.join(work, "sections/sec-03-oppsummering.nn.md"), "Oppsummering av møtet.", "utf8");
    writeFileSync(path.join(work, "sections/sec-03-oppsummering.en-GB.md"), "Summary of the meeting.", "utf8");
    pkg.objects.splice(2, 0, { clientRef: "sec-03-oppsummering", type: "section", payload: { title: tre("Oppsummering", "Oppsummering", "Summary"), bodyFiles: { nb: "sections/sec-03-oppsummering.nb.md", nn: "sections/sec-03-oppsummering.nn.md", "en-GB": "sections/sec-03-oppsummering.en-GB.md" } } });
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
    expect(fil.course.course.items.map((i: { origin?: unknown }) => i.origin ?? null)).toEqual([{ sectionId: "sec-abc", versionNo: 3 }, { moduleId: "mod-abc", versionNo: 2 }, null]);

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
    changes.elements["sec-01-innledning"] = "removed";
    writeFileSync(changesFil, JSON.stringify(changes), "utf8");
    const fjernet = await produser(work, "fjernet");
    expect(fjernet.ok, fjernet.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.details.join(" | ")}`).join("\n")).toBe(true);
    expect(sjekk(fjernet, "changes").summary).toContain("1 removed");
  });

  it("et kurs med origin uten endringsliste produseres ikke — «uendret er uendret» må kjøres", async () => {
    const work = path.join(dir, "utenliste");
    expect(convertExport(eksport(), { outDir: work }).ok).toBe(true);
    const result = await produser(work, "x", false);
    expect(result.ok).toBe(false);
    expect(sjekk(result, "changes").summary).toContain("no --changes file");
  });
});
