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
/** #1125: endrer kurstilstanden i kopien — koblingene mellom spørsmål, læringsmål og seksjoner bor der. */
function tilstand(mappe: string, endre: (s: any) => void) {
  const fil = join(mappe, "course-state.json");
  const s = JSON.parse(readFileSync(fil, "utf8"));
  endre(s);
  writeFileSync(fil, JSON.stringify(s), "utf8");
}
const koblinger = (s: any) => s.elements.find((e: { clientRef: string }) => e.clientRef === "mod-referat").questions as Array<Record<string, unknown>>;

describe("produce-course — eksempelkurset går gjennom alt (#1079)", () => {
  it("alle kontrollene er kjørt og grønne, og fila som leveres er den som ble lest tilbake", async () => {
    const k = kopi();
    const r = await k.kjør();
    expect(status(r)).toEqual({
      package: "ok",
      pictures: "ok",
      figures: "ok",
      "learner text": "ok",
      questions: "ok",
      // #1120: eksempelkurset har en «finn feilene» i «sec-arbeidsgang».
      "find errors": "ok",
      // #1121: ingen øvelse besvares av teksten rett over.
      "copied answers": "ok",
      // #1122: eksempelkurset har bare flervalg — ingen kriterier å lese.
      criteria: "ok",
      // #1124 del 2: ingen fritekstmodul — ingen eksempelsvar å kreve.
      "example answers": "ok",
      // #1133: seksjonene i eksempelet er korte nok til at de ikke måles.
      "direct address": "ok",
      // #1128, #1129: bildene er beskrevet, og ingen rester fra forfatterarbeidet.
      "alt text": "ok",
      leftovers: "ok",
      // #1126: én oppsummering per seksjon; høyst én boks — utkastet over «finn feilene» er øvelsen, ikke en boks.
      summaries: "ok",
      focus: "ok",

      revision: "ok",
      languages: "ok",
      "approved text": "ok",
      // #1125: hvert spørsmål er koblet til et læringsmål og en seksjon foran testen, og begge målene testes.
      objectives: "ok",
      slides: "ok",
      // #1095: bare et kurs justert fra plattformens eksport har en endringsliste.
      changes: "skipped",
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
    // Ett bilde: ikonene i kortene kommer fra plattformens bibliotek og reiser ikke med som filer.
    expect(JSON.parse(tekst).objects[1].payload.assets).toHaveLength(1);
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

// QA-porten på det første utkastet: «lysark» alene stoppet et kurs i presentasjonsteknikk, en
// prompt-kodeblokk med innrykk ble ikke tatt bort før sjekken, og `::: Kort` (som plattformen
// godtar) ble talt som en ramme som aldri ble åpnet.
describe("produce-course — kontrollen «learner text» stopper ikke vanlig fagtekst (#1079)", () => {
  const tekst = (r: Awaited<ReturnType<typeof produceCourse>>) => r.checks.find((c) => c.name === "learner text")!;

  it("«lysark» og «presentasjonen viser» som emne, og «slide 3» i en innrykket kodeblokk, er ikke kildehenvisninger", async () => {
    const k = kopi((p) => {
      const sek = objekt(p, "sec-kilder").payload;
      sek.bodyMarkdown.nb += ["", "Hold deg til ett budskap per lysark. Når presentasjonen viser tall, sett kilden under.", "", "- Slik ber du om hjelp:", "", "    ```prompt", "    Lag notater til slide 3 i presentasjonen min.", "    ```"].join("\n");
      sek.bodyMarkdown["en-GB"] += "\n\nKeep one message per slide; a deck that shows numbers names the source.";
    });
    const r = await k.kjør();
    expect(tekst(r), tekst(r).details.join("; ")).toMatchObject({ status: "ok" });
  });

  // QA-porten, runde 2: `\s+` krysset linjeskift, så en punktliste ble lest som «lysark 2»; og «det
  // første lysbildet» er noe et kurs i presentasjonsteknikk sier om emnet sitt.
  it("en punktliste der «lysark» står sist på én linje og et tall først på neste, og «det første lysbildet» som emne, stopper ikke", async () => {
    const k = kopi((p) => {
      objekt(p, "sec-kilder").payload.bodyMarkdown.nb += ["", "Tre råd:", "", "1. Ett budskap per lysark", "2. Store tall og lite tekst", "3. Det første lysbildet skal bare ha tittel og navn, og det siste lysbildet en kontaktadresse.", "4. Bruk lysbilde 16:9-format, og slides 16:9 in English decks."].join("\n");
    });
    const r = await k.kjør();
    expect(tekst(r), tekst(r).details.join("; ")).toMatchObject({ status: "ok" });
  });

  it("en ramme skrevet «::: Kort», slik plattformen også leser den, teller som åpnet og lukket", async () => {
    const k = kopi((p) => {
      const sek = objekt(p, "sec-kilder").payload;
      for (const språk of ["nb", "nn", "en-GB"]) sek.bodyMarkdown[språk] = sek.bodyMarkdown[språk].replace(":::kort", "::: Kort");
    });
    const r = await k.kjør();
    expect(tekst(r), tekst(r).details.join("; ")).toMatchObject({ status: "ok" });
  });

  // Kontrollen til radene over (#1075, #1076, #1078): riktig skrevne rammer, på alle tre språk, slipper
  // gjennom både teksten og språkkontrollen — ellers vet vi ikke om radene målte regelen eller noe annet.
  it("steg, skriv selv og repetisjonskort skrevet etter malen, på alle tre språk, stopper ikke", async () => {
    const k = kopi((p) => {
      const b = objekt(p, "sec-kilder").payload.bodyMarkdown;
      b.nb += "\n\n:::steg Slik skriver du referatet\n### Les notatene\nFinn vedtakene.\n\n### Skriv vedtakene\nMed ansvarlig og frist.\n:::\n\n:::skriv Skriv ett vedtakspunkt.\n**Vedtak:** Møtene flyttes til torsdag.\n\n- [ ] hva som ble bestemt?\n- [ ] fra når?\n:::\n\n:::repetisjon\n### Vedtak\nDet møtet bestemte.\n\n### Referent\nDen som skriver referatet.\n:::\n";
      b.nn += "\n\n:::steg Slik skriv du referatet\n### Les notata\nFinn vedtaka.\n\n### Skriv vedtaka\nMed ansvarleg og frist.\n:::\n\n:::skriv Skriv eitt vedtakspunkt.\n**Vedtak:** Møta blir flytte til torsdag.\n\n- [ ] kva som vart bestemt?\n- [ ] frå når?\n:::\n\n:::repetisjon\n### Vedtak\nDet møtet bestemde.\n\n### Referent\nDen som skriv referatet.\n:::\n";
      b["en-GB"] += "\n\n:::steg How to write the minutes\n### Read the notes\nFind the decisions.\n\n### Write the decisions\nWith owner and deadline.\n:::\n\n:::skriv Write one decision.\n**Decision:** Meetings move to Thursday.\n\n- [ ] what was decided?\n- [ ] from when?\n:::\n\n:::repetisjon\n### Decision\nWhat the meeting decided.\n\n### Minute-taker\nThe person who writes the minutes.\n:::\n";
    });
    const r = await k.kjør();
    expect(tekst(r), tekst(r).details.join("; ")).toMatchObject({ status: "ok" });
    expect(status(r).languages, formatProduction(r)).toBe("ok");
  });

  // Kontrollen til radene for #1110 og #1107: et case med følger og en «finn parene», riktig skrevet på
  // alle tre språk, slipper gjennom både teksten og språkkontrollen.
  it("et case med følger og en «finn parene» etter malen, på alle tre språk, stopper ikke (#1110, #1107)", async () => {
    const k = kopi((p) => {
      const b = objekt(p, "sec-kilder").payload.bodyMarkdown;
      b.nb += "\n\nEn innbygger ringer.\n\n:::sjekk Hva gjør du?\n- [ ] Avslår alt\n  For mye.\n- [x] Sladder og gir innsyn\n  Riktig.\n\nInnsyn er hovedregelen.\n:::\n\n:::par Koble\n- Vedtak = Det møtet bestemte\n- Referent = Den som skriver referatet\n- Habil = Uten interesse i saken\n:::\n";
      b.nn += "\n\nEin innbyggjar ringjer.\n\n:::sjekk Kva gjer du?\n- [ ] Avslår alt\n  For mykje.\n- [x] Sladdar og gir innsyn\n  Rett.\n\nInnsyn er hovudregelen.\n:::\n\n:::par Kople\n- Vedtak = Det møtet bestemde\n- Referent = Den som skriv referatet\n- Habil = Utan interesse i saka\n:::\n";
      b["en-GB"] += "\n\nA citizen calls.\n\n:::sjekk What do you do?\n- [ ] Refuse everything\n  Too much.\n- [x] Redact and give access\n  Right.\n\nAccess is the main rule.\n:::\n\n:::par Match\n- Decision = What the meeting decided\n- Minute-taker = The person who writes the minutes\n- Impartial = No interest in the case\n:::\n";
    });
    const r = await k.kjør();
    expect(tekst(r), tekst(r).details.join("; ")).toMatchObject({ status: "ok" });
    expect(status(r).languages, formatProduction(r)).toBe("ok");
  });

  // Kontroll til 2.96.1-radene: «tenk først» i oppgaveteksten tegnes fortsatt, og stopper ikke.
  it("«tenk først» i modulens oppgavetekst stopper ikke (2.96.1)", async () => {
    const k = kopi((p) => {
      const v = objekt(p, "mod-referat").payload.activeVersion;
      v.taskText = { nb: "Oppgave.", nn: "Oppgåve.", "en-GB": "Task." }; for (const s of ["nb", "nn", "en-GB"]) v.taskText[s] += "\n\n:::tenk Hva tror du?\nSvaret.\n:::";
    });
    const r = await k.kjør();
    expect(tekst(r), tekst(r).details.join("; ")).toMatchObject({ status: "ok" });
  });

  it("rammer inne i en kodeblokk telles ikke", async () => {
    const k = kopi((p) => {
      objekt(p, "sec-kilder").payload.bodyMarkdown.nb += ["", "Slik skrives kort:", "", "```markdown", ":::kort", "### Et kort", "```"].join("\n");
    });
    const r = await k.kjør();
    expect(tekst(r), tekst(r).details.join("; ")).toMatchObject({ status: "ok" });
  });
});

// #1120: «finn feilene» er standardveien, men forfatteren kan si nei — derfor en merknad, ikke en stopp.
describe("produce-course — «finn feilene» (#1120)", () => {
  const utenOppgave = (p: Pakke) => {
    const b = objekt(p, "sec-arbeidsgang").payload.bodyMarkdown;
    for (const s of ["nb", "nn", "en-GB"]) b[s] = b[s].slice(0, b[s].search(/\n\n(?:Notatene|Notata|The notes)/));
  };

  it("et kurs uten oppgaven får en merknad — fila leveres, og rapporten ber om å si det til forfatteren", async () => {
    const r = await kopi(utenOppgave).kjør();
    expect(status(r)["find errors"], formatProduction(r)).toBe("note");
    expect(r.ok).toBe(true);
    expect(formatProduction(r)).toContain("NOTE find errors");
    expect(formatProduction(r)).toContain("Noted: find errors. The file may be delivered; tell the author what is noted.");
  });

  it.each([
    ["nynorsk", "nn", ":::skriv Finn feila i planen."],
    ["engelsk", "en-GB", ":::skriv Find the mistakes in the plan."],
  ])("oppgaven kjennes igjen på %s også", async (_navn, språk, linje) => {
    const r = await kopi((p) => {
      utenOppgave(p);
      objekt(p, "sec-kilder").payload.bodyMarkdown[språk] += `\n\n${linje}\nSvar.\n:::\n`;
    }).kjør();
    expect(status(r)["find errors"]).toBe("ok");
  });

  it("«finn» uten «feil» i oppgaven, eller en oppgave i en kodeblokk, teller ikke", async () => {
    const r = await kopi((p) => {
      utenOppgave(p);
      const b = objekt(p, "sec-kilder").payload.bodyMarkdown;
      b.nb += "\n\n:::skriv Finn tre saker som skal med i referatet.\nSvar.\n:::\n\n```\n:::skriv Finn feilene\n```\n";
    }).kjør();
    expect(status(r)["find errors"]).toBe("note");
  });

  it("en løs seksjon eller modul uten kurs: ikke kjørt", async () => {
    const r = await kopi((p) => void (p.objects = p.objects.filter((o) => o.type !== "course"))).kjør();
    expect(status(r)["find errors"]).toBe("skipped");
  });
});

// #1133: en seksjon i rapportstil gir en merknad, ikke en stopp — en referanseliste kan være upersonlig.
describe("produce-course — snakk til deltakeren (#1133)", () => {
  const rapport = "Restrisiko vurderes etter at tiltak er gjennomført. Vurderingen dokumenteres i virksomhetens system og godkjennes av ledelsen. ";
  const samtale = "Når du vurderer restrisikoen, ser du på det som står igjen etter tiltakene. Du dokumenterer vurderingen i systemet ditt. ";

  it("en lang seksjon nesten uten «du» → merknad med seksjonen og tallet; fila leveres", async () => {
    const r = await kopi((p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += `\n\n${rapport.repeat(120)}`)).kjør();
    expect(status(r)["direct address"], formatProduction(r)).toBe("note");
    expect(funn(r, "direct address")).toMatch(/^"sec-kilder": \d+ words, \d\.\d «du» per 1000/);
    expect(r.ok).toBe(true);
  });

  it("like lang, men skrevet til deltakeren → ingen merknad", async () => {
    const r = await kopi((p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += `\n\n${samtale.repeat(14)}`)).kjør();
    expect(status(r)["direct address"]).toBe("ok");
  });

  it("en kort seksjon måles ikke, og kode teller ikke som tekst", async () => {
    const r = await kopi((p) => {
      const b = objekt(p, "sec-kilder").payload.bodyMarkdown;
      b.nb = `${rapport}\n\n\`\`\`prompt\n${rapport.repeat(20)}\n\`\`\`\n`;
    }).kjør();
    expect(status(r)["direct address"]).toBe("ok");
  });
});

// #1126: seksjoner som lærer bort, ikke kataloger. Flere oppsummeringer i én seksjon er alltid feil og
// rettes ved å beholde én — en stopp. Bokser, lange lister og en seksjon som beskriver seg selv kan
// forfatteren ha grunn til å beholde — en merknad.
describe("produce-course — seksjoner som lærer bort (#1126)", () => {
  const leggTil = (p: Pakke, ref: string, tekst: { nb: string; nn: string; "en-GB": string }) => {
    const b = objekt(p, ref).payload.bodyMarkdown;
    for (const s of ["nb", "nn", "en-GB"] as const) b[s] += `\n\n${tekst[s]}\n`;
  };

  it.each([
    ["nynorsk", "nn", "## Føremål\n\nDu lærer å velje kjelde.\n\n## Samandrag\n\nBruk notata."],
    ["engelsk", "en-GB", "## Purpose\n\nYou learn to choose a source.\n\n## Key points\n\n- The notes are the source."],
    ["bokmål, med ikon, nummer og kolon", "nb", "## 1. **Nøkkelpoeng:**\n\n- Notatene er kilden.\n\n### ![](icon:list-collapse) Det viktigste fra denne seksjonen\n\nBruk notatene."],
  ])("to oppsummeringer på %s stopper også", async (_navn, språk, tekst) => {
    const r = await kopi((p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown[språk] += `\n\n${tekst}\n`)).kjør();
    expect(status(r).summaries, formatProduction(r)).toBe("fail");
    expect(funn(r, "summaries")).toMatch(new RegExp(`^"sec-kilder" \\(${språk}\\): 2 summaries`));
  });

  it("samme feil på alle tre språk er én linje som nevner språkene", async () => {
    const r = await kopi((p) => leggTil(p, "sec-kilder", { nb: "## Formål\n\nA.\n\n## Oppsummering\n\nB.", nn: "## Føremål\n\nA.\n\n## Oppsummering\n\nB.", "en-GB": "## Purpose\n\nA.\n\n## Summary\n\nB." })).kjør();
    expect(r.checks.find((c) => c.name === "summaries")!.details).toEqual([expect.stringMatching(/^"sec-kilder" \(nb, nn, en-GB\): 2 summaries — «Formål», «Oppsummering»/)]);
  });

  it("én oppsummering, og en overskrift som bare begynner med «Formål», er greit", async () => {
    const r = await kopi((p) => leggTil(p, "sec-kilder", { nb: "## Formål og målgruppe\n\nStandarden er for små virksomheter.\n\n## Sammendrag og utforsking av et dokument\n\nA.\n\n## Oppsummering\n\nB.", nn: "## Formål og målgruppe\n\nA.\n\n## Oppsummering\n\nB.", "en-GB": "## Purpose and audience\n\nA.\n\n## Summary\n\nB." })).kjør();
    expect(status(r).summaries, funn(r, "summaries")).toBe("ok");
  });

  it("to bokser i én seksjon → merknad med etikettene; fila leveres", async () => {
    const r = await kopi((p) => leggTil(p, "sec-kilder", { nb: "> **Husk:** Les notatene.\n\nTekst.\n\n> **Tips:** Start tidlig.", nn: "> **Hugs:** Les notata.\n\nTekst.\n\n> **Tips:** Start tidleg.", "en-GB": "> **Remember:** Read the notes.\n\nText.\n\n> **Tip:** Start early." })).kjør();
    expect(status(r).focus, formatProduction(r)).toBe("note");
    expect(funn(r, "focus")).toMatch(/"sec-kilder": 2 highlighted boxes in \d+ words \(«Husk», «Tips»\) — at most one per 400 words/);
    expect(r.ok).toBe(true);
    expect(formatProduction(r)).toContain("Noted: focus.");
  });

  // Produkteier 2026-10-26: grensen følger lengden.
  it("to bokser i en lang seksjon (over 800 ord) → ingen merknad om bokser", async () => {
    const lang = "Når du skriver referatet, går du gjennom notatene ett punkt om gangen og sjekker det mot utkastet. ".repeat(50);
    const r = await kopi((p) => leggTil(p, "sec-kilder", { nb: `> **Husk:** Les notatene.\n\n${lang}\n\n> **Tips:** Start tidlig.`, nn: "> **Hugs:** Les notata.\n\nTekst.\n\n> **Tips:** Start tidleg.", "en-GB": "> **Remember:** Read the notes.\n\nText.\n\n> **Tip:** Start early." })).kjør();
    expect(funn(r, "focus")).not.toContain("highlighted boxes");
  });

  it("én boks og utkastet i en «finn feilene» er ikke to bokser — men et sitat uten oppgave under er det", async () => {
    // sec-arbeidsgang har allerede «Husk» og utkastet over «finn feilene» (eksempelet over er grønt).
    const r = await kopi((p) => {
      const b = objekt(p, "sec-arbeidsgang").payload.bodyMarkdown;
      for (const s of ["nb", "nn", "en-GB"]) b[s] = b[s].replace(/\n:::skriv [^\n]*\n[\s\S]*?\n:::\n?/, "\nMer tekst.\n");
    }).kjør();
    expect(status(r).focus, formatProduction(r)).toBe("note");
    expect(funn(r, "focus")).toMatch(/"sec-arbeidsgang": 2 highlighted boxes in \d+ words \(«Husk», «Utkast fra KI»\)/);
  });

  it("en liste på ni punkter → merknad; åtte, eller ni par i en ramme, eller en liste i kode, er greit", async () => {
    const punkter = (n: number, x: string) => Array.from({ length: n }, (_, i) => `- ${x} ${i + 1}`).join("\n");
    const ni = await kopi((p) => leggTil(p, "sec-kilder", { nb: punkter(9, "punkt"), nn: punkter(9, "punkt"), "en-GB": punkter(9, "point") })).kjør();
    expect(status(ni).focus, formatProduction(ni)).toBe("note");
    expect(funn(ni, "focus")).toContain(`"sec-kilder": a list of 9 points («punkt 1» …)`);
    expect(ni.ok).toBe(true);

    const par = Array.from({ length: 9 }, (_, i) => `- Begrep ${i + 1} = Forklaring ${i + 1}`).join("\n");
    const greit = await kopi((p) => leggTil(p, "sec-kilder", {
      nb: `${punkter(8, "punkt")}\n\nTekst.\n\n1. steg\n2. steg\n\n${punkter(7, "punkt")}\n\n:::par Koble\n${par}\n:::\n\n\`\`\`\n${punkter(12, "kode")}\n\`\`\``,
      nn: `${punkter(8, "punkt")}\n\n:::par Kople\n${par}\n:::`,
      "en-GB": `${punkter(8, "point")}\n\n:::par Match\n${par}\n:::`,
    })).kjør();
    expect(status(greit).focus, funn(greit, "focus")).toBe("ok");
  });

  it("en liste med blanke linjer og innrykk mellom punktene er fortsatt én liste", async () => {
    const løs = Array.from({ length: 9 }, (_, i) => `${i + 1}. Steg ${i + 1}\n   med en forklaring`).join("\n\n");
    const r = await kopi((p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += `\n\n${løs}\n`)).kjør();
    expect(funn(r, "focus")).toContain("a list of 9 points («Steg 1» …)");
  });

  it.each([
    ["bokmål", "nb", "Denne seksjonen viser hvordan du velger kilde.", "«Denne seksjonen viser hvordan du velger kilde"],
    ["bokmål, «svarer på»", "nb", "Denne seksjonen svarer på spørsmål som ofte kommer opp.", "«Denne seksjonen svarer på spørsmål som ofte kommer opp"],
    ["nynorsk", "nn", "Denne seksjonen forklarar korleis du vel kjelde.", "«Denne seksjonen forklarar korleis du vel kjelde"],
    ["engelsk", "en-GB", "This section explains how to choose a source.", "«This section explains how to choose a source"],
  ])("en seksjon som beskriver seg selv på %s → merknad", async (_navn, språk, setning, ventet) => {
    const r = await kopi((p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown[språk] = `${setning}\n\n${objekt(p, "sec-kilder").payload.bodyMarkdown[språk]}`)).kjør();
    expect(status(r).focus, formatProduction(r)).toBe("note");
    expect(funn(r, "focus")).toContain(`"sec-kilder" (${språk}): ${ventet}`);
    expect(r.ok).toBe(true);
  });

  it("«I denne seksjonen» og «Etter denne seksjonen skal du» er ikke seksjonen som snakker", async () => {
    const r = await kopi((p) => leggTil(p, "sec-kilder", { nb: "I denne seksjonen ser du tre kilder. Etter denne seksjonen skal du kunne velge.", nn: "I denne seksjonen ser du tre kjelder.", "en-GB": "In this section you see three sources." })).kjør();
    expect(status(r).focus, funn(r, "focus")).toBe("ok");
  });
});

// #1127: et repetisjonskurs — «Repetisjon» i tittelen — starter med spørsmål. En merknad, ikke en stopp.
describe("produce-course — repetisjonskurs (#1127)", () => {
  const somRepetisjon = (p: Pakke) => void (objekt(p, "kurs-motereferat").payload.course.title.nb = "Repetisjon: møtereferat med KI");

  it("et repetisjonskurs som starter med lesestoff → merknad med første element; fila leveres", async () => {
    const r = await kopi(somRepetisjon).kjør();
    expect(status(r).revision, formatProduction(r)).toBe("note");
    expect(funn(r, "revision")).toContain('the first element ("sec-arbeidsgang") has 0 «sjekk deg selv» question(s)');
    expect(r.ok).toBe(true);
  });

  it("et repetisjonskurs som starter med fem spørsmål → godkjent", async () => {
    const spm = (n: number) => `\n\n:::sjekk Spørsmål ${n}?\n- [x] Riktig\n- [ ] Galt\n:::\n`;
    const r = await kopi((p) => {
      somRepetisjon(p);
      objekt(p, "sec-arbeidsgang").payload.bodyMarkdown.nb += [1, 2, 3, 4, 5].map(spm).join("");
    }).kjør();
    expect(status(r).revision).toBe("ok");
  });
});

describe("produce-course — spørsmål koblet til læringsmål og seksjon (#1125)", () => {
  it("et læringsmål ingen spørsmål tester → merknad med målet; fila leveres", async () => {
    const k = kopi();
    tilstand(k.mappe, (s) => void s.learningObjectives.push({ id: "mal-3", text: "Etter dette kan deltakeren dele referatet med de rette" }));
    const r = await k.kjør();
    expect(status(r).objectives, formatProduction(r)).toBe("note");
    expect(funn(r, "objectives")).toContain(`objective "mal-3" («Etter dette kan deltakeren dele referatet med de rette») is tested by no question or task`);
    expect(r.ok).toBe(true);
  });

  it("spørsmålet gjenfinnes med andre mellomrom og store bokstaver; oppgaven kobles med «task» og kan teste flere mål", async () => {
    const k = kopi((p) => {
      const v = objekt(p, "mod-referat").payload.activeVersion;
      v.assessmentMode = "FREETEXT_PLUS_MCQ";
      v.taskText = { nb: "Skriv et referat fra notatene.", nn: "Skriv eit referat frå notata.", "en-GB": "Write minutes from the notes." };
    });
    tilstand(k.mappe, (s) => {
      koblinger(s)[0]!.question = "  du har fått et utkast fra KI og skal sende referatet\nom ti minutter. Hva gjør du først? ";
      koblinger(s).push({ task: true, objective: ["mal-1", "mal-2"], section: ["sec-arbeidsgang", "sec-kilder"] });
    });
    const r = await k.kjør();
    expect(status(r).objectives, funn(r, "objectives")).toBe("ok");
    expect(r.checks.find((c) => c.name === "objectives")!.summary).toBe("5 question(s) and task(s) linked to 2 objective(s)");
  });

  it("en oppgavetekst i en ren flervalgsmodul er ingen oppgave å koble", async () => {
    const r = await kopi((p) => void (objekt(p, "mod-referat").payload.activeVersion.taskText = { nb: "Svar på spørsmålene.", nn: "Svar på spørsmåla.", "en-GB": "Answer the questions." })).kjør();
    expect(status(r).objectives, funn(r, "objectives")).toBe("ok");
  });

  it("en løs modul uten kurs: ikke kjørt", async () => {
    const r = await kopi((p) => {
      p.objects = p.objects.filter((o) => o.type === "module");
    }).kjør({ slidesFile: undefined });
    expect(status(r).objectives).toBe("skipped");
  });
});

describe("produce-course — hver kontroll stopper leveransen (#1079)", () => {
  it.each<[string, (pkg: Pakke, mappe: string) => void, string, string]>([
    ["en seksjon som ikke er plassert i kurset", (p) => void objekt(p, "kurs-motereferat").payload.items.splice(1, 1), "package", `"sec-kilder" is in the package and not in the course`],
    ["kurset peker på noe som ikke er i pakken", (p) => void (objekt(p, "kurs-motereferat").payload.items[0].ref = "sec-borte"), "package", `course item 1: "sec-borte" is not in the package`],
    ["en modul oppført som seksjon", (p) => void (objekt(p, "kurs-motereferat").payload.items[2].type = "SECTION"), "package", `"mod-referat" is a module, listed as SECTION`],
    ["kurset peker på innhold som alt finnes på plattformen", (p) => void (objekt(p, "kurs-motereferat").payload.items[2] = { type: "MODULE", moduleId: "cmr8abc" }), "package", "an import file cannot"],
    ["samme clientRef to ganger", (p) => void p.objects.push(structuredClone(p.objects[0]!)), "package", `clientRef "sec-arbeidsgang" is used twice`],
    ["et kurs uten modul", (p) => { p.objects = p.objects.filter((o) => o.type !== "module"); objekt(p, "kurs-motereferat").payload.items.pop(); }, "package", "the course has no module"],
    ["teksten åpner med seksjonens egen tittel som overskrift", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b.nn = `## Kva du gir  **KI**\n\n${b.nn}`; }, "package", `"sec-kilder" (nn): the text opens with the section's own title as a heading`],
    // Skillforbedringene etter milepæl 1: kilden holdes bak teksten, kortramma lukkes, settet dekker seksjonene.
    ["«Se lysbilder 3–5» (flertall) i deltakerteksten", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\nSe lysbilder 3–5 for detaljene."), "learner text", "«lysbilder 3» points at the source"],
    ["«See slides 3–5» i deltakerteksten", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown["en-GB"] += "\n\nSee slides 3–5 for the details."), "learner text", "«slides 3» points at the source"],
    ["«Se lysbilde 3» (ubestemt form) i deltakerteksten", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\nSe lysbilde 3 for et eksempel."), "learner text", "«lysbilde 3» points at the source"],
    ["nynorsk «Sjå lysbilete 4» (ubunden form) i deltakarteksten", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nn += "\n\nSjå lysbilete 4 for eit døme."), "learner text", "«lysbilete 4» points at the source"],
    ["nynorsk «lysbiletet 3» i deltakarteksten", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nn += "\n\nSjå lysbiletet 3 for døme."), "learner text", "«lysbiletet 3» points at the source"],
    ["«This slide shows» i deltakerteksten", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown["en-GB"] += "\n\nThis slide shows the three sources."), "learner text", "«This slide shows» points at the source"],
    ["«dette lysarket» i deltakerteksten", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\nDette lysarket oppsummerer kildene."), "learner text", "«Dette lysarket» points at the source"],
    ["en henvisning til lysarket i deltakerteksten", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\nSom vist på lysark 4 er dette viktig."), "learner text", "«lysark 4» points at the source"],
    ["en henvisning til presentasjonen på engelsk", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown["en-GB"] += "\n\nAs shown on the slide, start with the agenda."), "learner text", "points at the source"],
    ["en «tenk først»-ramme som ikke lukkes (#1072)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::tenk Hva tror du skjer?\nSvaret uten slutt."), "learner text", "opened and never closed"],
    ["en «tenk først» inni en kortramme (rammer kan ikke nøstes, #1072)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::kort\n### Kort\n\n:::tenk Hva tror du?\nSvar.\n:::\n\nMer tekst.\n:::\n"), "learner text", "is opened inside a :::kort frame"],
    ["en «sjekk deg selv» inni en kortramme (#1074)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::kort\n### Kort\n\n:::sjekk Hva stemmer?\n- [x] Ja\n- [ ] Nei\n:::\n\nMer.\n:::\n"), "learner text", "is opened inside a :::kort frame"],
    ["en «sjekk deg selv» rett under en liste (#1074, QA)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n- Et punkt\n:::sjekk Hva stemmer?\n- [x] Ja\n- [ ] Nei\n:::\n"), "learner text", "put a blank line above the frame"],
    ["en «sjekk deg selv» rett under et sitat (#1074, QA runde 2)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n> **Husk:** Et sitat\n:::sjekk Hva stemmer?\n- [x] Ja\n- [ ] Nei\n:::\n"), "learner text", "put a blank line above the frame"],
    ["en «sjekk deg selv» rett under en fortsettelseslinje i en liste (#1074, QA runde 2)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n- Et punkt som fortsetter\npå neste linje\n:::sjekk Hva stemmer?\n- [x] Ja\n- [ ] Nei\n:::\n"), "learner text", "put a blank line above the frame"],
    ["en «sjekk deg selv» uten riktig svar (#1074)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::sjekk Hva stemmer?\n- [ ] Ja\n- [ ] Nei\n:::\n"), "learner text", "needs exactly one right option"],
    ["en «sjekk deg selv» med bare ett alternativ (#1074)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::sjekk Hva stemmer?\n- [x] Ja\n:::\n"), "learner text", "needs at least two options"],
    // #1075, #1076, #1078: de nye rammene har samme regler som de gamle (blank linje over, ingen nøsting),
    // og en form plattformen krever for å tegne dem.
    ["et «steg for steg» med bare ett steg (#1075)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::steg Slik gjør du\n### Eneste steg\nTekst.\n:::\n"), "learner text", "a :::steg frame needs at least two steps — one ### heading per step (it has 1)"],
    ["et «steps» uten overskrifter (#1075)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::steps\nBare tekst.\n:::\n"), "learner text", "a :::steps frame needs at least two steps"],
    ["et «steg for steg» rett under et avsnitt (#1075)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\nSlik gjør du:\n:::steg\n### A\nen\n### B\nto\n:::\n"), "learner text", "a :::steg line has text right above it"],
    ["et «steg for steg» inni en kortramme (#1075)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::kort\n### Kort\n\n:::steg\n### A\nen\n### B\nto\n:::\n\nMer.\n:::\n"), "learner text", "a :::steg frame is opened inside a :::kort frame"],
    ["en «skriv selv» uten eksempelsvar (#1076)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::skriv Skriv vedtaket.\n- [ ] hva som ble bestemt?\n- [ ] fra når?\n:::\n"), "learner text", "a :::skriv frame needs an example answer above the checklist"],
    ["en «skriv selv» uten oppgave på åpningslinja (#1076) er ingen ramme, og ::: lukker ingenting", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::skriv\nSvaret.\n:::\n"), "learner text", "a ::: closes a frame that was never opened"],
    ["repetisjonskort med bare ett kort (#1078)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::repetisjon\n### Vedtak\nDet møtet bestemte.\n:::\n"), "learner text", "a :::repetisjon frame needs at least two cards — one ### heading per card (it has 1)"],
    ["et repetisjonskort uten bakside (#1078)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::flashcards\n### Vedtak\n\n### Referent\nDen som skriver.\n:::\n"), "learner text", "a card in a :::flashcards frame has nothing on its back: «Vedtak»"],
    ["et steg som forsvant i den engelske oversettelsen (#1075)", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b.nb += "\n\n:::steg\n### Les\nFinn.\n### Skriv\nMed frist.\n### Send\nTil alle.\n:::\n"; b.nn += "\n\n:::steg\n### Les\nFinn.\n### Skriv\nMed frist.\n### Send\nTil alle.\n:::\n"; b["en-GB"] += "\n\n:::steg\n### Read\nFind.\n### Write\nWith a deadline.\n:::\n"; }, "languages", "another number of steps, checklist points, cards or pairs, or is missing, in: en-GB (nb has steg:3)"],
    // #1107 «finn parene» og #1110 følge per alternativ.
    ["en «finn parene» med bare to par (#1107)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::par\n- Vedtak = Det som ble bestemt\n- Referent = Den som skriver\n:::\n"), "learner text", "a :::par frame needs at least three pairs (it has 2)"],
    ["en «finn parene» med en linje som ikke er et par (#1107)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::pairs Koble\n- A = a\n- B = b\n- C = c\nEn setning.\n:::\n"), "learner text", "a :::pairs frame has a line that is not a pair «- term = explanation»: «En setning.»"],
    ["en «finn parene» med samme begrep med og uten fet skrift (#1107, QA 2.98.0)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::par\n- **Vedtak** = a\n- Vedtak = b\n- C = c\n:::\n"), "learner text", "a :::par frame repeats a term or an explanation"],
    ["en «finn parene» der « = » bare står i kode (#1107, QA 2.98.0)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::par\n- `a = b`\n- B = b\n- C = c\n:::\n"), "learner text", "a :::par frame has a line that is not a pair «- term = explanation»: «- `a = b`»"],
    ["en «finn parene» med samme forklaring to ganger (#1107)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::par\n- A = samme\n- B = Samme\n- C = c\n:::\n"), "learner text", "a :::par frame repeats a term or an explanation"],
    ["en «finn parene» rett under et avsnitt (#1107)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\nKoble:\n:::par\n- A = a\n- B = b\n- C = c\n:::\n"), "learner text", "a :::par line has text right above it"],
    ["en «finn parene» i modulens oppgavetekst (#1107)", (p) => { const v = objekt(p, "mod-referat").payload.activeVersion; v.taskText = { nb: "Oppgave.\n\n:::par\n- A = a\n- B = b\n- C = c\n:::", nn: "Oppgåve.", "en-GB": "Task." }; }, "learner text", '"mod-referat" taskText (nb): a :::par frame works only in a section'],
    ["et par som forsvant i den nynorske oversettelsen (#1107)", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; const par = (x: string) => `\n\n:::par\n- A = ${x}1\n- B = ${x}2\n- C = ${x}3\n:::\n`; b.nb += par("a"); b.nn += "\n\n:::par\n- A = n1\n- B = n2\n:::\n"; b["en-GB"] += par("e"); }, "languages", "in: nn (nb has par:3)"],
    ["en følge som forsvant i den engelske oversettelsen (#1110)", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b.nb += "\n\n:::sjekk Hva gjør du?\n- [ ] Avslår\n  For mye.\n- [x] Sladder\n:::\n"; b.nn += "\n\n:::sjekk Kva gjer du?\n- [ ] Avslår\n  For mykje.\n- [x] Sladdar\n:::\n"; b["en-GB"] += "\n\n:::sjekk What do you do?\n- [ ] Refuse\n- [x] Redact\n:::\n"; }, "languages", "a feedback line under another option, or a question is missing, in: en-GB"],
    // 2.96.1 (produkteier 2026-10-20): øvelsene tegnes bare i seksjoner, ikke i modulens tekst.
    ["et «steg for steg» i modulens oppgavetekst (2.96.1)", (p) => { const v = objekt(p, "mod-referat").payload.activeVersion; v.taskText = { nb: "Oppgave.\n\n:::steg\n### A\nen\n### B\nto\n:::", nn: "Oppgåve.", "en-GB": "Task." }; }, "learner text", '"mod-referat" taskText (nb): a :::steg frame works only in a section'],
    ["en «skriv selv» i modulens veiledning (2.96.1)", (p) => { const v = objekt(p, "mod-referat").payload.activeVersion; v.candidateTaskConstraints = "Maks 300 ord.\n\n:::write Skriv et vedtak.\nSvaret.\n:::"; }, "learner text", '"mod-referat" candidateTaskConstraints: a :::write frame works only in a section'],
    ["en repetisjonsramme som ikke lukkes (#1078)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::repetisjon\n### Vedtak\nDet møtet bestemte.\n### Referent\nDen som skriver."), "learner text", "a :::repetisjon frame is opened and never closed"],
    ["en kortramme som ikke lukkes", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb = objekt(p, "sec-kilder").payload.bodyMarkdown.nb.replace("\n:::\n", "\n")), "learner text", "opened and never closed"],
    ["en modul med færre spørsmål enn tre", (p) => void objekt(p, "mod-referat").payload.activeVersion.mcqSet.questions.splice(2), "questions", "at least one question per section and at least 3"],
    ["et ikonnavn plattformen ikke kjenner", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n:::kort\n### ![](icon:ikke-et-ikon) Kort\n\nTekst.\n:::\n"), "pictures", "icon:ikke-et-ikon, and the platform's icon library has no icon with that name"],
    ["et skjermbilde på 700 kB", (p, mappe) => { writeFileSync(join(mappe, "deck", "images", "tung.png"), Buffer.alloc(700 * 1024)); const sek = objekt(p, "sec-kilder").payload; sek.assets.push({ sourceId: "tung", file: "deck/images/tung.png" }); for (const språk of ["nb", "nn", "en-GB"]) sek.bodyMarkdown[språk] += "\n\n![Et tungt skjermbilde](asset:tung)"; }, "pictures", "700 kB — a picture this heavy slows the section on a phone"],
    ["en bildefil som ikke finnes", (p) => void (objekt(p, "sec-kilder").payload.assets[0].file = "deck/images/slide-99-1.png"), "pictures", `cannot read the file "deck/images/slide-99-1.png"`],
    ["et bilde som ikke vises på nynorsk", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b.nn = b.nn.replace(/!\[[^\]]*\]\(asset:img-innstillinger\)/, ""); }, "pictures", `the picture "img-innstillinger" is not shown in the text in nn`],
    ["teksten viser et bilde seksjonen ikke har", (p) => void objekt(p, "sec-kilder").payload.assets.pop(), "pictures", "the text in nb shows asset:img-innstillinger, and the section has no such picture"],
    ["en filtype plattformen ikke tar", (p) => void (objekt(p, "sec-kilder").payload.assets[0].file = "course-state.json"), "pictures", `"course-state.json" is not a picture the platform takes`],
    ["en engelsk figur byttet ut med den norske", (p) => void (objekt(p, "sec-arbeidsgang").payload.assets[0].localizedVariants[1].file = "figures/arbeidsgang.svg"), "languages", "blind copy"],
    ["en språkvariant av figuren med et annet antall etiketter — og meldingen sier hva som telles", (p) => void (objekt(p, "sec-arbeidsgang").payload.assets[0].localizedVariants[0].file = "deck/icons/image7.svg"), "languages", "0 pieces of label text, the original has 14 — keep the same number of lines in every label"],
    ["en seksjonstittel som mangler nynorsk", (p) => void delete objekt(p, "sec-kilder").payload.title.nn, "languages", "sec-kilder"],
    ["nynorsk tekst som har mistet tabellen", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b.nn = b.nn.replace("|---|---|---|", ""); }, "languages", "sec-kilder: nn has 0 table(s), nb has 1"],
    ["engelsk tekst der prompt-boksen ble vanlig tekst", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b["en-GB"] = b["en-GB"].replaceAll("```", ""); }, "languages", "sec-kilder: en-GB has 0 prompt box(es), nb has 1"],
    ["riktig svar som er mye lengre enn de andre", (p) => { for (const q of objekt(p, "mod-referat").payload.activeVersion.mcqSet.questions) { const i = q.options.findIndex((o: { nb: string }) => o.nb === q.correctAnswer.nb); q.options[i] = { nb: `${q.correctAnswer.nb}, og dette er en lang hale som bare det riktige svaret har fått med seg`, nn: `${q.correctAnswer.nn}, og dette er ein lang hale som berre det rette svaret har fått med seg`, "en-GB": `${q.correctAnswer["en-GB"]}, and this is a long tail that only the right answer was given` }; q.correctAnswer = q.options[i]; } }, "questions", "correct_is_longest"],
    // #1119: lesestoffet før testen følger med inn i kontrollen — uten det kan ekko-regelen ikke slå til.
    ["riktig svar som gjentar seksjonen ordrett (#1119)", (p) => {
      const setning = { nb: "Referatet skal alltid sendes til alle deltakerne innen to arbeidsdager etter møtet", nn: "Referatet skal alltid sendast til alle deltakarane innan to arbeidsdagar etter møtet", "en-GB": "The minutes must always be sent to every participant within two working days of the meeting" };
      const b = objekt(p, "sec-kilder").payload.bodyMarkdown;
      for (const s of ["nb", "nn", "en-GB"] as const) b[s] += `\n\n${setning[s]}.\n`;
      const q = objekt(p, "mod-referat").payload.activeVersion.mcqSet.questions[0];
      const i = q.options.findIndex((o: { nb: string }) => o.nb === q.correctAnswer.nb);
      q.options[i] = setning;
      q.correctAnswer = setning;
    }, "questions", "answer_echoes_text"],
    // #1121: «finn feilene»-øvelsens eksempelsvar byttet ut med utkastet rett over — en kopiøvelse.
    ["et eksempelsvar som står ordrett i teksten over (#1121)", (p) => {
      const b = objekt(p, "sec-arbeidsgang").payload.bodyMarkdown;
      b.nb = b.nb.replace("1. **Fristen er feil:**", "Ola sender budsjettet til revisor innen 15. november. Kari bestiller lokale. Til stede: Kari, Ola, Siri og Per.\n\n1. **Fristen er feil:**");
      b.nb = b.nb.replace(/\n1\. \*\*Fristen[\s\S]*?(?=\n\n- \[ \])/, "\n");
    }, "copied answers", `"sec-arbeidsgang" line`],
    // #1122: et kriterium med én linje for hele skalaen.
    ["et vurderingskriterium uten beskrevne trinn (#1122)", (p) => void (objekt(p, "mod-referat").payload.activeVersion.rubric = { criteria: { struktur: "0–4: Referatet har god struktur." }, scalingRule: { practical_weight: 100, max_total: 4 } }), "criteria", "«struktur» has one line for 0–4"],
    // #1128: alt-tekst som bare er en tittel — også når det bare gjelder ett språk.
    ["en alt-tekst som bare er en tittel, på nynorsk (#1128)", (p) => { const b = objekt(p, "sec-kilder").payload.bodyMarkdown; b.nn = b.nn.replace(/!\[[^\]]*\]\(asset:img-innstillinger\)/, "![Innstillingar](asset:img-innstillinger)"); }, "alt text", `"sec-kilder" (nn): «Innstillingar» is a title`],
    // #1129: rester fra forfatterarbeidet.
    ["et arbeidsnotat igjen i teksten (#1129)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n[Avklaring: sjekk tallene før kurset publiseres.]\n"), "leftovers", "a working note for the author"],
    ["en seksjon omtalt med nummer (#1129)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\nDette behandles i seksjon 3.\n"), "leftovers", "refer to a section by its title"],
    ["figurer nummerert i feil rekkefølge (#1129)", (p) => {
      objekt(p, "sec-arbeidsgang").payload.bodyMarkdown.nb += "\n\n*Figur 2. Arbeidsgangen.*\n";
      objekt(p, "sec-kilder").payload.bodyMarkdown.nb += "\n\n*Figur 1. Innstillingene.*\n";
    }, "leftovers", "figures (nb) are numbered 2, 1"],
    // #1126: «Formål», «Nøkkelpoeng» og «Kort oppsummering» i samme seksjon (16 seksjoner på stage).
    ["tre oppsummeringer i én seksjon (#1126)", (p) => void (objekt(p, "sec-kilder").payload.bodyMarkdown.nb = `## Formål\n\nDu lærer å velge kilde.\n\n${objekt(p, "sec-kilder").payload.bodyMarkdown.nb}\n\n## Nøkkelpoeng\n\n- Notatene er kilden.\n\n## Kort oppsummering\n\nBruk notatene.\n`), "summaries", `"sec-kilder" (nb): 3 summaries — «Formål», «Nøkkelpoeng», «Kort oppsummering». Keep one`],
    // #1125: koblingene mellom spørsmål, læringsmål og seksjoner — kurstilstanden er forfatterens godkjente plan.
    ["et spørsmål uten kobling til læringsmål og seksjon (#1125)", (_p, m) => tilstand(m, (s) => void koblinger(s).splice(1, 1)), "objectives", "question 2 («Møtet fulgte en fast plan, og du rakk ikke å notere. Hvil…») is not linked"],
    ["en kobling til et læringsmål kurset ikke har (#1125)", (_p, m) => tilstand(m, (s) => void (koblinger(s)[0]!.objective = "mal-9")), "objectives", `points at objective "mal-9", which is not among the course's learningObjectives (mal-1, mal-2)`],
    ["en kobling uten læringsmål (#1125)", (_p, m) => tilstand(m, (s) => void delete koblinger(s)[0]!.objective), "objectives", "no objective — name the one it tests"],
    ["en kobling uten seksjon (#1125)", (_p, m) => tilstand(m, (s) => void delete koblinger(s)[0]!.section), "objectives", "no section — name the section that teaches what it asks"],
    ["en kobling til noe som ikke er en seksjon (#1125)", (_p, m) => tilstand(m, (s) => void (koblinger(s)[0]!.section = "mod-referat")), "objectives", `points at "mod-referat", which is not a section in the course`],
    ["et spørsmål om noe en seksjon ETTER testen lærer bort (#1125)", (p) => { const items = objekt(p, "kurs-motereferat").payload.items; items.push(items.splice(1, 1)[0]); }, "objectives", `is taught in "sec-kilder", which comes after the test`],
    ["en kobling til et spørsmål modulen ikke har lenger (#1125)", (_p, m) => tilstand(m, (s) => void koblinger(s).push({ question: "Hvem skriver referatet?", objective: "mal-1", section: "sec-arbeidsgang" })), "objectives", "the course state links «Hvem skriver referatet?», which is not a question in the module"],
    // #1124 del 2: en fritekstmodul uten eksempelsvar stopper et nytt kurs.
    ["en fritekstmodul uten eksempelsvar (#1124)", (p) => { const v = objekt(p, "mod-referat").payload.activeVersion; v.assessmentMode = "FREETEXT_PLUS_MCQ"; v.taskText = { nb: "Skriv et referat fra notatene.", nn: "Skriv eit referat frå notata.", "en-GB": "Write minutes from the notes." }; }, "example answers", '"mod-referat": write `modelAnswer`'],
    ["en fritekstoppgave uten kobling (#1125)", (p) => { const v = objekt(p, "mod-referat").payload.activeVersion; v.assessmentMode = "FREETEXT_PLUS_MCQ"; v.taskText = { nb: "Skriv et referat fra notatene.", nn: "Skriv eit referat frå notata.", "en-GB": "Write minutes from the notes." }; }, "objectives", "the free-text task is not linked"],
    ["en kurstilstand uten læringsmål (#1125)", (_p, m) => tilstand(m, (s) => void delete s.learningObjectives), "objectives", "the course state has no learningObjectives"],
    ["et læringsmål uten id (#1125)", (_p, m) => tilstand(m, (s) => void delete s.learningObjectives[1].id), "objectives", `learningObjectives[1] needs an "id" and a "text"`],
    ["samme id på to læringsmål (#1125)", (_p, m) => tilstand(m, (s) => void (s.learningObjectives[1].id = "mal-1")), "objectives", `the id "mal-1" is used twice`],
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
    expect(status(r).objectives).toBe("skipped");
    expect(rapport).toContain("--   objectives     NOT RUN — no --state file: the links between questions, objectives and sections are not checked. Say so in the report");
    expect(rapport).toContain("Not run: approved text, objectives, changes. Name them as not run when you report.");
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
    // Figurer (SVG) har ingen vektgrense under 5 MB; rasterbilder har en egen (testen under).
    const en = (innhold: string) => checkAssets(pkg([{ sourceId: "a", filename: "a.svg", mimeType: "image/svg+xml", contentBase64: innhold }]));
    expect(en(akkurat).problems).toEqual([]);
    expect(en(over).problems.map((p) => p.message).join()).toContain("5.0 MB — the platform takes 5 MB per picture");
    const seks = checkAssets(pkg(
      ["a", "b", "c", "d", "e", "f"].map((id) => ({ sourceId: id, filename: `${id}.svg`, mimeType: "image/svg+xml", contentBase64: akkurat })),
      "![](asset:a) ![](asset:b) ![](asset:c) ![](asset:d) ![](asset:e) ![](asset:f)",
    ));
    expect(seks.problems.map((p) => p.message)).toEqual(["30.0 MB of pictures — the platform takes 25 MB per course"]);
    expect(seks.totalBytes).toBe(6 * MAX_ASSET_BYTES);
  });

  // Milepæl 1 i prod (Tilbudsarbeid): to skjermbilder på 444 og 785 kB. Over 600 kB stopper; 300–600 kB listes som verdt å beskjære.
  it("et rasterbilde over 600 kB meldes, 300–600 kB listes som verdt å beskjære, en figur på samme størrelse går", () => {
    const kb = (n: number) => Buffer.alloc(n * 1024).toString("base64");
    const med = (filename: string, mimeType: string, innhold: string) => checkAssets(pkg([{ sourceId: "a", filename, mimeType, contentBase64: innhold }]));
    const tung = med("a.png", "image/png", kb(700));
    expect(tung.problems.map((p) => p.message).join()).toContain("700 kB — a picture this heavy slows the section on a phone");
    const stor = med("a.png", "image/png", kb(400));
    expect(stor.problems).toEqual([]);
    expect(stor.large).toEqual(["a (400 kB)"]);
    expect(med("a.png", "image/png", kb(200)).large).toEqual([]);
    expect(med("a.svg", "image/svg+xml", kb(700)).problems).toEqual([]);
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
