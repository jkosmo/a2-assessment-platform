import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportEnvelopeSchema, importBodySchema } from "../../src/modules/adminContent/adminContentSchemas.js";
import { MAX_ASSET_BYTES, checkAssets, readCourseState, resolvePackageAssets, resolveSectionText } from "../../skills/a2-authoring-api/scripts/package-assets.mjs";
import { formatProduction, produceCourse } from "../../skills/a2-authoring-api/scripts/produce-course.mjs";
// @ts-expect-error — .mjs skill script consumed as a library
import { formatReview, reviewRevision } from "../../skills/a2-authoring-api/scripts/course-state.mjs";

// #1079: port 6 som ÉN kommando. Kontrollene fantes fra før, men som funksjoner modellen selv måtte
// kalle i riktig rekkefølge fra egen kode — og forsiden påsto at de kunne kjøres. Da avgjør
// modellens flid hvilke kontroller et kurs faktisk har vært gjennom. Kommandoen kjører alle, i fast
// rekkefølge, og skriver importfila bare når alle går gjennom.

const EKSEMPEL = "skills/a2-authoring-api/examples/course-from-slides";
type Pakke = { locale: string; objects: Array<{ clientRef: string; type: string; payload: any }> };

/**
 * En kopi av eksempelkurset i en egen mappe. Uten `endre` står den som i skillet, med
 * seksjonstekstene i filer. Med `endre` leses tekstene inn i pakken først, så testen kan endre dem.
 */
function kopi(endre?: (pkg: Pakke, mappe: string) => void) {
  const mappe = mkdtempSync(join(tmpdir(), "produksjon-"));
  cpSync(EKSEMPEL, mappe, { recursive: true });
  if (endre) {
    const pkg = JSON.parse(readFileSync(join(mappe, "package.json"), "utf8")) as Pakke;
    for (const o of pkg.objects) {
      if (!o.payload.bodyFiles) continue;
      o.payload.bodyMarkdown = Object.fromEntries(Object.entries(o.payload.bodyFiles as Record<string, string>).map(([språk, fil]) => [språk, readFileSync(join(mappe, fil), "utf8").replaceAll("\r\n", "\n")]));
      delete o.payload.bodyFiles;
    }
    endre(pkg, mappe);
    writeFileSync(join(mappe, "package.json"), JSON.stringify(pkg), "utf8");
  }
  return {
    mappe,
    ut: join(mappe, "ut", "kurs.json"),
    kjør: (valg: Partial<Parameters<typeof produceCourse>[0]> = {}) =>
      produceCourse({
        packageFile: join(mappe, "package.json"),
        outFile: join(mappe, "ut", "kurs.json"),
        stateFile: join(mappe, "course-state.json"),
        slidesFile: join(mappe, "treatment.json"),
        ...valg,
      }),
  };
}
const objekt = (pkg: Pakke, ref: string) => pkg.objects.find((o) => o.clientRef === ref)!;
const status = (r: Awaited<ReturnType<typeof produceCourse>>) => Object.fromEntries(r.checks.map((c) => [c.name, c.status]));
const funn = (r: Awaited<ReturnType<typeof produceCourse>>, navn: string) => r.checks.find((c) => c.name === navn)!.details.join(" | ");

describe("produce-course — eksempelkurset går gjennom alt (#1079)", () => {
  it("alle kontrollene er kjørt og grønne, og fila som leveres er den som ble lest tilbake", async () => {
    const k = kopi();
    const r = await k.kjør();
    expect(status(r)).toEqual({
      package: "ok",
      pictures: "ok",
      figures: "ok",
      questions: "ok",
      languages: "ok",
      "approved text": "ok",
      slides: "ok",
      "import file": "ok",
    });
    expect(r.ok).toBe(true);
    expect(r.files).toEqual([{ file: k.ut, importAt: "Innholdsforvaltning → Kurs → «Importer kurs»" }]);
    expect(existsSync(k.ut)).toBe(true);
  });

  it("importfila godtas av plattformens EGET skjema — ikke bare av skillets kopi av det", async () => {
    const k = kopi();
    await k.kjør();
    const fil = readFileSync(k.ut, "utf8");
    const konvolutt = JSON.parse(fil);
    const eksport = exportEnvelopeSchema.safeParse(konvolutt);
    expect(eksport.success, JSON.stringify(eksport.success ? "" : eksport.error.issues.slice(0, 3))).toBe(true);
    const importen = importBodySchema.safeParse({ payload: konvolutt, mode: "createNew", autoPublish: false });
    expect(importen.success, JSON.stringify(importen.success ? "" : importen.error.issues.slice(0, 3))).toBe(true);
    // Ren ASCII: æ, ø og å tåler enhver nedlasting.
    expect(/^[\x00-\x7f]*$/.test(fil)).toBe(true);
    expect(konvolutt.provenance).toMatchObject({ producer: "agent_authoring", tool: "a2-authoring-api" });
  });

  it("bilder, ikoner og figurer er lagt ved som innhold — med hvert oppsett og hvert språk", async () => {
    const k = kopi();
    await k.kjør();
    const items = JSON.parse(readFileSync(k.ut, "utf8")).course.course.items;
    expect(items.map((i: { type: string; sortOrder: number }) => `${i.sortOrder}:${i.type}`)).toEqual(["0:SECTION", "1:SECTION", "2:MODULE"]);

    const figur = items[0].section.assets[0];
    expect(figur).toMatchObject({ sourceId: "fig-arbeidsgang", filename: "arbeidsgang.svg", mimeType: "image/svg+xml", sourceLocale: "nb" });
    expect(figur.file).toBeUndefined();
    expect(Buffer.from(figur.contentBase64, "base64").equals(readFileSync(join(k.mappe, "figures/arbeidsgang.svg")))).toBe(true);
    expect(figur.sizeBytes).toBe(readFileSync(join(k.mappe, "figures/arbeidsgang.svg")).length);
    expect(figur.localizedVariants.map((v: { locale: string }) => v.locale)).toEqual(["nn", "en-GB"]);
    expect(Buffer.from(figur.layoutVariants[0].localizedVariants[1].contentBase64, "base64").toString("utf8")).toContain("Before");

    const bilde = items[1].section.assets.find((a: { sourceId: string }) => a.sourceId === "img-innstillinger");
    expect(bilde).toMatchObject({ filename: "slide-04-1.png", mimeType: "image/png" });
    expect(Buffer.from(bilde.contentBase64, "base64").subarray(1, 4).toString("ascii")).toBe("PNG");
    for (const item of items) expect((item.section ?? item.module.activeVersion).audit).toEqual({});
  });

  it("--package-out gir pakken slik API-et tar den: ingen filpekere igjen", async () => {
    const k = kopi();
    const hel = join(k.mappe, "ut", "package.complete.json");
    await k.kjør({ packageOut: hel });
    const tekst = readFileSync(hel, "utf8");
    expect(tekst).not.toContain('"file"');
    expect(JSON.parse(tekst).objects[1].payload.assets).toHaveLength(4);
  });

  it("seksjonstekstene står i filer pakken peker på, og importfila bærer dem ordrett", async () => {
    const pkg = JSON.parse(readFileSync(`${EKSEMPEL}/package.json`, "utf8")) as Pakke;
    expect(objekt(pkg, "sec-kilder").payload.bodyMarkdown).toBeUndefined();
    expect(objekt(pkg, "sec-kilder").payload.bodyFiles).toEqual({ nb: "sections/sec-kilder.nb.md", nn: "sections/sec-kilder.nn.md", "en-GB": "sections/sec-kilder.en-GB.md" });
    const k = kopi();
    await k.kjør();
    const seksjon = JSON.parse(readFileSync(k.ut, "utf8")).course.course.items[1].section;
    expect(seksjon.bodyFiles).toBeUndefined();
    for (const språk of ["nb", "nn", "en-GB"]) {
      expect(seksjon.bodyMarkdown[språk], språk).toBe(readFileSync(`${EKSEMPEL}/sections/sec-kilder.${språk}.md`, "utf8").replaceAll("\r\n", "\n"));
    }
  });

  it("en tekstfil som mangler, stopper produksjonen med filnavnet", async () => {
    const mappe = mkdtempSync(join(tmpdir(), "produksjon-"));
    cpSync(EKSEMPEL, mappe, { recursive: true });
    const fil = join(mappe, "package.json");
    writeFileSync(fil, readFileSync(fil, "utf8").replace("sections/sec-kilder.nn.md", "sections/sec-kilder.nynorsk.md"), "utf8");
    const r = await produceCourse({ packageFile: fil, outFile: join(mappe, "ut", "kurs.json") });
    expect(status(r).pictures).toBe("fail");
    expect(funn(r, "pictures")).toContain(`sec-kilder.bodyFiles: cannot read the file "sections/sec-kilder.nynorsk.md"`);
    // Språket som mangler, meldes også der det hører hjemme.
    expect(status(r).languages).toBe("fail");
  });

  it("godkjent tekst i tilstanden kan være fila selv; en fil som mangler der, er et element uten tekst", async () => {
    const tilstand = JSON.parse(readFileSync(`${EKSEMPEL}/course-state.json`, "utf8"));
    expect(tilstand.elements[1]).toMatchObject({ contentFile: "sections/sec-kilder.nb.md" });
    expect(tilstand.elements[1].content).toBeUndefined();
    const k = kopi((_p, mappe) => {
      const fil = join(mappe, "course-state.json");
      const endret = JSON.parse(readFileSync(fil, "utf8"));
      endret.elements[1].contentFile = "sections/finnes-ikke.md";
      writeFileSync(fil, JSON.stringify(endret), "utf8");
    });
    const r = await k.kjør();
    expect(status(r)["approved text"]).toBe("fail");
    expect(funn(r, "approved text")).toContain(`element "sec-kilder" has no stored full-text content`);
  });
});

describe("produce-course — hver kontroll stopper leveransen (#1079)", () => {
  it.each<[string, (pkg: Pakke) => void, string, string]>([
    ["en seksjon som ikke er plassert i kurset", (p) => void objekt(p, "kurs-motereferat").payload.items.splice(1, 1), "package", `"sec-kilder" is in the package and not in the course`],
    ["kurset peker på noe som ikke er i pakken", (p) => void (objekt(p, "kurs-motereferat").payload.items[0].ref = "sec-borte"), "package", `course item 1: "sec-borte" is not in the package`],
    ["en modul oppført som seksjon", (p) => void (objekt(p, "kurs-motereferat").payload.items[2].type = "SECTION"), "package", `"mod-referat" is a module, listed as SECTION`],
    ["kurset peker på innhold som alt finnes på plattformen", (p) => void (objekt(p, "kurs-motereferat").payload.items[2] = { type: "MODULE", moduleId: "cmr8abc" }), "package", "an import file cannot"],
    ["samme clientRef to ganger", (p) => void p.objects.push(structuredClone(p.objects[0]!)), "package", `clientRef "sec-arbeidsgang" is used twice`],
    ["et kurs uten modul", (p) => { p.objects = p.objects.filter((o) => o.type !== "module"); objekt(p, "kurs-motereferat").payload.items.pop(); }, "package", "the course has no module"],
    ["teksten åpner med seksjonens egen tittel som overskrift", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b.nn = `## Kva du gir  **KI**\n\n${b.nn}`; }, "package", `"sec-kilder" (nn): the text opens with the section's own title as a heading`],
    ["en bildefil som ikke finnes", (p) => void (objekt(p, "sec-kilder").payload.assets[3].file = "deck/images/slide-99-1.png"), "pictures", `cannot read the file "deck/images/slide-99-1.png"`],
    ["et bilde som ikke vises på nynorsk", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b.nn = b.nn.replace(/!\[[^\]]*\]\(asset:img-innstillinger\)/, ""); }, "pictures", `the picture "img-innstillinger" is not shown in the text in nn`],
    ["teksten viser et bilde seksjonen ikke har", (p) => void objekt(p, "sec-kilder").payload.assets.pop(), "pictures", "the text in nb shows asset:img-innstillinger, and the section has no such picture"],
    ["en filtype plattformen ikke tar", (p) => void (objekt(p, "sec-kilder").payload.assets[3].file = "course-state.json"), "pictures", `"course-state.json" is not a picture the platform takes`],
    ["en engelsk figur byttet ut med den norske", (p) => void (objekt(p, "sec-arbeidsgang").payload.assets[0].localizedVariants[1].file = "figures/arbeidsgang.svg"), "languages", "blind copy"],
    ["en språkvariant av figuren med et annet antall etiketter — og meldingen sier hva som telles", (p) => void (objekt(p, "sec-arbeidsgang").payload.assets[0].localizedVariants[0].file = "deck/icons/image7.svg"), "languages", "0 pieces of label text, the original has 14 — keep the same number of lines in every label"],
    ["en seksjonstittel som mangler nynorsk", (p) => void delete objekt(p, "sec-kilder").payload.title.nn, "languages", "sec-kilder"],
    ["nynorsk tekst som har mistet tabellen", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b.nn = b.nn.replace("|---|---|---|", ""); }, "languages", "sec-kilder: nn has 0 table(s), nb has 1"],
    ["engelsk tekst der prompt-boksen ble vanlig tekst", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b["en-GB"] = b["en-GB"].replaceAll("```", ""); }, "languages", "sec-kilder: en-GB has 0 prompt box(es), nb has 1"],
    ["riktig svar som er mye lengre enn de andre", (p) => { for (const q of objekt(p, "mod-referat").payload.activeVersion.mcqSet.questions) { const i = q.options.findIndex((o: { nb: string }) => o.nb === q.correctAnswer.nb); q.options[i] = { nb: `${q.correctAnswer.nb}, og dette er en lang hale som bare det riktige svaret har fått med seg`, nn: `${q.correctAnswer.nn}, og dette er ein lang hale som berre det rette svaret har fått med seg`, "en-GB": `${q.correctAnswer["en-GB"]}, and this is a long tail that only the right answer was given` }; q.correctAnswer = q.options[i]; } }, "questions", "correct_is_longest"],
    ["prompten forfatteren godkjente er kortet bort", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b.nb = b.nb.replace("Bruk bare det som står i notatene under. Skriv «uklart» der notatene ikke sier noe.", "Bruk notatene."); }, "approved text", "templates — «Bruk bare det som står i notatene under."],
    ["et kort lysarklista lovet, er borte", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; for (const s of ["nb", "nn", "en-GB"]) b[s] = b[s].replaceAll("### ", "**"); }, "slides", "slide 3: was to become cards"],
  ])("%s", async (_navn, endre, kontroll, ventet) => {
    const k = kopi(endre);
    const r = await k.kjør();
    expect(status(r)[kontroll], formatProduction(r)).toBe("fail");
    expect(funn(r, kontroll)).toContain(ventet);
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
    // Ingen fil å levere ved en feil — heller ikke en halvferdig.
    expect(existsSync(k.ut)).toBe(false);
    expect(status(r)["import file"]).toBe("skipped");
  });

  it("en åpningsoverskrift som sier noe annet enn tittelen, får stå", async () => {
    const k = kopi((p) => {
      const b = objekt(p, "sec-kilder").payload.bodyMarkdown;
      for (const s of ["nb", "nn", "en-GB"]) b[s] = `## Tre kilder\n\n${b[s]}`;
    });
    expect(status(await k.kjør()).package).toBe("ok");
  });

  it("en etikett som ikke får plass i figuren, stopper — også når den bare er i en språkvariant", async () => {
    const k = kopi((p, mappe) => {
      const trang = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><rect x="10" y="10" width="60" height="40" fill="#eef" stroke="#333"/><text x="40" y="35" text-anchor="middle" font-size="14">En altfor lang etikett for boksen</text></svg>`;
      writeFileSync(join(mappe, "figures", "trang.svg"), trang, "utf8");
      objekt(p, "sec-arbeidsgang").payload.assets[0].localizedVariants[0].file = "figures/trang.svg";
    });
    const r = await k.kjør();
    expect(status(r).figures).toBe("fail");
    expect(funn(r, "figures")).toContain("sec-arbeidsgang/fig-arbeidsgang (nn)");
  });

  it("et element som ikke er godkjent, eller ikke står i rekkefølgen, stopper produksjonen", async () => {
    const k = kopi((_p, mappe) => {
      const fil = join(mappe, "course-state.json");
      const tilstand = JSON.parse(readFileSync(fil, "utf8"));
      tilstand.order.pop();
      writeFileSync(fil, JSON.stringify(tilstand), "utf8");
    });
    const r = await k.kjør();
    expect(status(r)["approved text"]).toBe("fail");
    expect(funn(r, "approved text")).toContain(`approved element "mod-referat" is not placed in the final order`);
  });

  it("et godkjent element som mangler i pakken, stopper — gyldig og ufullstendig er en feil", async () => {
    const k = kopi((p) => {
      p.objects = p.objects.filter((o) => o.clientRef !== "sec-arbeidsgang");
      objekt(p, "kurs-motereferat").payload.items.shift();
    });
    const r = await k.kjør({ slidesFile: undefined });
    expect(status(r).package).toBe("ok");
    expect(funn(r, "approved text")).toContain("approved element(s) absent from export: sec-arbeidsgang");
  });

  it("et sitat med anførselstegn i godkjent tekst gjenfinnes — teksten leses som skrevet, ikke som JSON", async () => {
    const k = kopi((_p, mappe) => {
      const fil = join(mappe, "course-state.json");
      const tilstand = JSON.parse(readFileSync(fil, "utf8"));
      // Linjeskift og «"» ville blitt til \n og \" i en JSON-tekst, og setningen var da «borte».
      tilstand.elements[1].mandatory.templates.push("Du skal skrive et møtereferat.\nLesere: [hvem som skal lese det]");
      writeFileSync(fil, JSON.stringify(tilstand), "utf8");
    });
    expect(status(await k.kjør())["approved text"]).toBe("ok");
  });

  it("den ferdige fila sammenlignes også med det godkjente — og kursets egen beskrivelse regnes med", async () => {
    const k = kopi((_p, mappe) => {
      const fil = join(mappe, "course-state.json");
      const tilstand = JSON.parse(readFileSync(fil, "utf8"));
      tilstand.order.push("kurs-motereferat");
      tilstand.elements.push({
        clientRef: "kurs-motereferat",
        type: "course",
        title: "Møtereferat med KI",
        status: "approved",
        content: "Kort kurs i å lage møtereferat med hjelp av generativ KI.",
        mandatory: { terms: ["med hjelp av generativ KI"] },
      });
      writeFileSync(fil, JSON.stringify(tilstand), "utf8");
    });
    const med = await k.kjør();
    expect(med.ok, formatProduction(med)).toBe(true);
    expect(funn(med, "import file")).toContain("content-integrity: pass");
    // Uten tilstanden er den sammenligningen ikke gjort, og linja sier det.
    expect(funn(await k.kjør({ stateFile: undefined }), "import file")).toContain("content-integrity: not-run");
  });

  it("forvansket tekst (Ã¸) stopper i den ferdige fila, og fila blir ikke liggende", async () => {
    const k = kopi((p) => void (objekt(p, "kurs-motereferat").payload.course.description.nb = "Kort kurs i mÃ¸tereferat med hjelp av generativ KI."));
    const r = await k.kjør({ stateFile: undefined, slidesFile: undefined });
    expect(status(r)["import file"]).toBe("fail");
    expect(funn(r, "import file")).toContain("encoding-integrity: fail");
    expect(r.files).toEqual([]);
    expect(existsSync(k.ut)).toBe(false);
  });

  it("en pakke som ikke kan leses, er en feil med filnavnet i", async () => {
    const mappe = mkdtempSync(join(tmpdir(), "produksjon-"));
    writeFileSync(join(mappe, "package.json"), "{ ikke json", "utf8");
    const r = await produceCourse({ packageFile: join(mappe, "package.json") });
    expect(r.ok).toBe(false);
    expect(r.checks[0]).toMatchObject({ name: "package", status: "fail" });
    expect(r.checks[0]!.details[0]).toContain("cannot read the package");
  });
});

describe("produce-course — det som ikke ble kjørt, sies (#1079)", () => {
  it("uten --state er godkjent tekst IKKE kontrollert, og rapporten sier det med de ordene", async () => {
    const k = kopi();
    const r = await k.kjør({ stateFile: undefined });
    expect(r.ok).toBe(true);
    expect(status(r)["approved text"]).toBe("skipped");
    const rapport = formatProduction(r);
    expect(rapport).toContain("--   approved text  NOT RUN — no --state file. Say so in the report");
    expect(rapport).toContain("Not run: approved text. Name them as not run when you report.");
    expect(rapport).toContain(`DELIVER ${k.ut}  —  the author imports it at Innholdsforvaltning → Kurs → «Importer kurs»`);
  });

  it("rapporten ved feil navngir kontrollene som feilet og sier at ingenting skal leveres", async () => {
    const k = kopi((p) => void objekt(p, "sec-kilder").payload.assets.pop());
    const rapport = formatProduction(await k.kjør());
    expect(rapport).toMatch(/^OK {3}package /m);
    expect(rapport).toMatch(/^FAIL pictures /m);
    expect(rapport).toContain("--   import file    NOT WRITTEN — fix the checks above first");
    expect(rapport).toContain("DO NOT DELIVER — failed: pictures, slides. Fix what is listed and run again.");
    expect(rapport).not.toContain("DELIVER " + k.ut);
  });
});

describe("produce-course — en løs seksjon eller modul (#1079)", () => {
  it("uten kursobjekt skrives én fil per seksjon og modul, og hver sier hvor den importeres", async () => {
    const k = kopi((p) => void (p.objects = p.objects.filter((o) => o.type !== "course")));
    const ut = join(k.mappe, "ut");
    const r = await k.kjør({ outFile: ut, slidesFile: undefined });
    expect(r.ok, formatProduction(r)).toBe(true);
    expect(readdirSync(ut).sort()).toEqual(["module-mod-referat.json", "section-sec-arbeidsgang.json", "section-sec-kilder.json"]);
    expect(r.files.map((f) => f.importAt)).toEqual([
      "Innholdsforvaltning → Seksjoner → «Importer seksjon»",
      "Innholdsforvaltning → Seksjoner → «Importer seksjon»",
      "Innholdsforvaltning → Moduler → «Importer modul»",
    ]);
    const seksjon = JSON.parse(readFileSync(join(ut, "section-sec-kilder.json"), "utf8"));
    expect(seksjon.scope).toBe("section");
    expect(exportEnvelopeSchema.safeParse(seksjon).success).toBe(true);
    expect(exportEnvelopeSchema.safeParse(JSON.parse(readFileSync(join(ut, "module-mod-referat.json"), "utf8"))).success).toBe(true);
  });
});

describe("package-assets — fra filpeker til innhold (#1079)", () => {
  const pkg = (assets: unknown[], markdown: unknown = "![x](asset:a)") => ({ objects: [{ clientRef: "sec", type: "section", payload: { bodyMarkdown: markdown, assets } }] });

  it("leser fila og fyller ut navn, type, størrelse og innhold — uten å røre pakken den fikk", () => {
    const inn = pkg([{ sourceId: "a", file: "deck/images/slide-04-1.png" }]);
    const r = resolvePackageAssets(inn, { baseDir: EKSEMPEL });
    expect(r.problems).toEqual([]);
    expect(r.attached).toBe(1);
    const bytes = readFileSync(`${EKSEMPEL}/deck/images/slide-04-1.png`);
    expect(r.pkg.objects[0].payload.assets[0]).toEqual({ sourceId: "a", filename: "slide-04-1.png", mimeType: "image/png", sizeBytes: bytes.length, contentBase64: bytes.toString("base64") });
    expect(inn.objects[0]!.payload.assets[0]).toEqual({ sourceId: "a", file: "deck/images/slide-04-1.png" });
  });

  it("et oppgitt filnavn og en oppgitt type beholdes; innhold som alt er lagt ved, står urørt og får størrelsen sin", () => {
    const r = resolvePackageAssets(pkg([
      { sourceId: "a", file: "deck/icons/image7.svg", filename: "sakliste.svg" },
      { sourceId: "b", filename: "x.png", mimeType: "image/png", contentBase64: "AAAA", sizeBytes: 999 },
    ]), { baseDir: EKSEMPEL });
    expect(r.pkg.objects[0].payload.assets[0].filename).toBe("sakliste.svg");
    expect(r.pkg.objects[0].payload.assets[1]).toMatchObject({ contentBase64: "AAAA", sizeBytes: 3 });
    expect(r.attached).toBe(1);
  });

  it("en fil som mangler i et oppsett eller en språkvariant, meldes med stedet den mangler", () => {
    const r = resolvePackageAssets(pkg([{ sourceId: "a", file: "figures/arbeidsgang.svg", layoutVariants: [{ layout: "narrow", file: "figures/arbeidsgang.narrow.svg", localizedVariants: [{ locale: "nn", file: "figures/borte.svg" }] }] }]), { baseDir: EKSEMPEL });
    expect(r.problems.map((p) => p.path)).toEqual(["sec.assets[0].layoutVariants[0].localizedVariants[0]"]);
    expect(r.pkg.objects[0].payload.assets[0].layoutVariants[0].contentBase64.length).toBeGreaterThan(100);
  });

  it("samme sourceId to ganger, en ugyldig sourceId og et bilde uten innhold meldes", () => {
    const r = checkAssets(pkg([
      { sourceId: "a", filename: "a.png", mimeType: "image/png", contentBase64: "AAAA" },
      { sourceId: "a", filename: "b.png", mimeType: "image/png", contentBase64: "AAAA" },
      { sourceId: "har mellomrom", filename: "c.png", mimeType: "image/png", contentBase64: "AAAA" },
      { sourceId: "d", filename: "d.png", mimeType: "image/png" },
      { sourceId: "e", filename: "e.bmp", mimeType: "image/bmp", contentBase64: "AAAA" },
    ], "![x](asset:a) ![y](asset:d) ![z](asset:e)"));
    const meldinger = r.problems.map((p) => p.message).join(" | ");
    expect(meldinger).toContain(`sourceId "a" is used twice in this section`);
    expect(meldinger).toContain(`sourceId "har mellomrom" must be`);
    expect(meldinger).toContain("has no content");
    expect(meldinger).toContain(`media type "image/bmp" is not one the platform takes`);
    expect(r.ok).toBe(false);
  });

  it("et bilde over 5 MB meldes, akkurat 5 MB går; over 25 MB til sammen meldes", () => {
    const akkurat = Buffer.alloc(MAX_ASSET_BYTES).toString("base64");
    const over = Buffer.alloc(MAX_ASSET_BYTES + 1).toString("base64");
    const en = (innhold: string) => checkAssets(pkg([{ sourceId: "a", filename: "a.png", mimeType: "image/png", contentBase64: innhold }]));
    expect(en(akkurat).problems).toEqual([]);
    expect(en(over).problems.map((p) => p.message).join()).toContain("5.0 MB — the platform takes 5 MB per picture");
    const seks = checkAssets(pkg(
      ["a", "b", "c", "d", "e", "f"].map((id) => ({ sourceId: id, filename: `${id}.png`, mimeType: "image/png", contentBase64: akkurat })),
      "![](asset:a) ![](asset:b) ![](asset:c) ![](asset:d) ![](asset:e) ![](asset:f)",
    ));
    expect(seks.problems.map((p) => p.message)).toEqual(["30.0 MB of pictures — the platform takes 25 MB per course"]);
    expect(seks.totalBytes).toBe(6 * MAX_ASSET_BYTES);
  });

  describe("seksjonstekst i filer (bodyFiles)", () => {
    const seksjon = (payload: Record<string, unknown>) => ({ objects: [{ clientRef: "sec", type: "section", payload }] });
    const filer: Record<string, string> = { "a.nb.md": String.fromCharCode(0xfeff) + "Første linje\r\nAndre linje\r\n", "a.nn.md": "Fyrste linje\n" };
    const les = (fil: string) => {
      const navn = fil.replaceAll("\\", "/").split("/").pop()!;
      if (!(navn in filer)) throw new Error("finnes ikke");
      return Buffer.from(filer[navn]!, "utf8");
    };

    it("leses inn som teksten i fila: uten byte-rekkefølgemerke og med vanlige linjeskift", () => {
      const inn = seksjon({ bodyFiles: { nb: "a.nb.md", nn: "a.nn.md" } });
      const r = resolveSectionText(inn, { readFile: les });
      expect(r.problems).toEqual([]);
      expect(r.pkg.objects[0].payload).toEqual({ bodyMarkdown: { nb: "Første linje\nAndre linje\n", nn: "Fyrste linje\n" } });
      expect(inn.objects[0]!.payload.bodyFiles).toBeDefined();
    });

    it("tekst skrevet rett i pakken og tekst i fil kan stå side om side, språk for språk", () => {
      const r = resolveSectionText(seksjon({ bodyMarkdown: { "en-GB": "First line" }, bodyFiles: { nb: "a.nb.md" } }), { readFile: les });
      expect(r.problems).toEqual([]);
      expect(Object.keys(r.pkg.objects[0].payload.bodyMarkdown).sort()).toEqual(["en-GB", "nb"]);
    });

    it.each<[string, Record<string, unknown>, string]>([
      ["samme språk gitt to ganger", { bodyMarkdown: { nb: "x" }, bodyFiles: { nb: "a.nb.md" } }, "nb is given both in bodyMarkdown and in bodyFiles"],
      ["hele teksten gitt som streng i tillegg", { bodyMarkdown: "x", bodyFiles: { nn: "a.nn.md" } }, "the section has both bodyMarkdown and bodyFiles"],
      ["en fil som ikke finnes", { bodyFiles: { nb: "borte.md" } }, `cannot read the file "borte.md"`],
      ["en streng i stedet for én fil per språk", { bodyFiles: "a.nb.md" }, "must be an object with one file per language"],
    ])("%s meldes", (_navn, payload, ventet) => {
      const r = resolveSectionText(seksjon(payload), { readFile: les });
      expect(r.problems.map((p) => `${p.path}: ${p.message}`).join(" | ")).toContain(`sec.bodyFiles: ${ventet}`);
    });

    it("en pakke uten bodyFiles står urørt", () => {
      const inn = seksjon({ bodyMarkdown: { nb: "x" } });
      expect(resolveSectionText(inn, { readFile: les })).toEqual({ pkg: inn, problems: [] });
    });
  });

  it("språkvarianter og oppsett teller med i samlet størrelse", () => {
    const r = checkAssets(pkg([{ sourceId: "a", filename: "a.svg", mimeType: "image/svg+xml", contentBase64: "AAAA", localizedVariants: [{ locale: "nn", contentBase64: "AAAA" }], layoutVariants: [{ layout: "narrow", contentBase64: "AAAA", localizedVariants: [{ locale: "nn", contentBase64: "AAAA" }] }] }]));
    expect(r.totalBytes).toBe(12);
  });
});

describe("course-state review — kortere tekst uten tap (#1079)", () => {
  const element = readCourseState(`${EKSEMPEL}/course-state.json`).elements[1];

  it("teksten leses fra fila tilstanden peker på", () => {
    expect(element.content).toBe(readFileSync(`${EKSEMPEL}/sections/sec-kilder.nb.md`, "utf8").replaceAll("\r\n", "\n"));
    expect(element.content.length).toBeGreaterThan(500);
  });

  it("teksten som den står, går gjennom", () => {
    const r = reviewRevision(element, element.content);
    expect(r.blocks).toBe(false);
    expect(formatReview(r)).toBe("OK   sec-kilder: 0 % shorter, 4 item(s) in place, 0 moved to an attachment");
  });

  it("en kortversjon uten prompten stopper, og sier hva som ble borte og hva som kan gjøres", () => {
    const rapport = formatReview(reviewRevision(element, "## Hva du gir KI\n\nSakliste, Egne notater og Opptak."));
    expect(rapport.split("\n")).toEqual([
      "FAIL sec-kilder: 96 % shorter, 3 item(s) in place, 0 moved to an attachment",
      "  - lost (templates): «Bruk bare det som står i notatene under. Skriv «uklart» der notatene ikke sier noe.» — put it back, or move it to an attachment",
      "  - more than 20 % shorter: ask the author to approve the shortening, then run again with --reduction-approved",
    ]);
  });
});
