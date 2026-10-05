import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_SIZE, darkenLightIcon, describePresentation, readPresentation, sizeIcon } from "../../skills/a2-authoring-api/scripts/pptx-extract.mjs";
import { buildPptx, connector, group, picture, pngHeader, shape, smartArt, table, zip, type SlideSpec } from "../support/buildPptx.js";

// #1079: skillet fikk en presentasjon som løs tekst. Det som gjorde den til en presentasjon, var
// borte: at fire rammer står ved siden av hverandre, hvilket ikon som hører til hvilken ramme, hva
// som står i notatene. Da produkteier laget samme kurs i ChatGPT og Claude.ai, fikk begge tre
// figurer av samme type og ingen av kildens 25 ikoner. `pptx-extract.mjs` leser fila selv.
//
// Lysarkene under er bygget etter de tre ekte presentasjonene (samme former, samme oppbygging),
// med oppdiktet tekst. De ekte ligger utenfor repoet.

const HVITT_IKON = `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><style>.iconFill{fill:#FFFFFF}</style><path class="iconFill" d="M1 1h10v10z"/></svg>`;
const MØRKT_IKON = `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><path fill="#136A73" d="M1 1h10v10z"/></svg>`;
const FLERFARGET = `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><path fill="#FFFFFF" d="M1 1h10v10z"/><path fill="#EEEEEE" d="M2 2h3v3z"/></svg>`;
const ikon = (id: string, svg: string, n: number) => ({ [id]: { path: `media/image${n}.png`, content: pngHeader(96, 96) }, [`${id}svg`]: { path: `media/image${n}.svg`, content: svg } });

// Lysark 1: en flyt som i Rapportskriving — sirkler med ikon, piler, navn og forklaring under, og
// fargede bånd over som sier hvilken fase stegene hører til.
const flyt: SlideSpec = {
  shapes: [
    // PowerPoint gir også en vanlig tekstboks formen «rect». Uten den her ville testen ikke sett
    // forskjell på undertittelen og et fasebånd — de står begge over stegene.
    shape([40, 30, 600, 40], { textBox: true, geometry: "rect", text: [{ text: "Anbefalt arbeidsflyt", size: 28 }] }),
    shape([40, 75, 600, 24], { textBox: true, geometry: "rect", text: [{ text: "En strukturert prosess", size: 14 }] }),
    // En vanlig tekstlinje over stegene. Den har ingen farge, og er derfor ikke et fasebånd.
    shape([40, 106, 300, 18], { textBox: true, geometry: "rect", text: ["Les fra venstre mot høyre"] }),
    shape([150, 130, 190, 16], { geometry: "rect", fill: "#D9E8DD", text: ["Data"] }),
    shape([360, 130, 90, 16], { geometry: "rect", fill: "#DCE7F2", text: ["Analyse"] }),
    ...[0, 1, 2, 3].flatMap((i) => [
      shape([60 + i * 100, 150, 54, 54], { geometry: "ellipse", fill: ["#EAD9C4", "#D9E8DD", "#D9E8DD", "#DCE7F2"][i] }),
      picture([72 + i * 100, 162, 30, 30], `rI${i}`, `rI${i}svg`),
      shape([50 + i * 100, 220, 74, 20], { textBox: true, text: [{ text: ["Forstå oppdrag", "Klargjør kilder", "Lag grunnlag", "Snakk med KI"][i]!, bold: true }] }),
      shape([50 + i * 100, 250, 74, 40], { textBox: true, text: [["Mandat og krav.", "Dokumenter og data.", "Strukturer kildene.", "Still spørsmål."][i]!] }),
      ...(i < 3 ? [shape([120 + i * 100, 170, 30, 14], { geometry: "rightArrow", fill: "#8090A9" })] : []),
    ]),
    shape([40, 500, 120, 20], { textBox: true, text: ["Firma AS | 4"] }),
  ],
  media: { ...ikon("rI0", HVITT_IKON, 1), ...ikon("rI1", HVITT_IKON, 2), ...ikon("rI2", MØRKT_IKON, 3), ...ikon("rI3", FLERFARGET, 4) },
};

// Lysark 2: fire kort ved siden av hverandre, hvert med farget overskriftsstripe og ikon, og en
// bred stripe nederst.
const kort: SlideSpec = {
  shapes: [
    shape(null, { placeholder: "title", text: ["Når bruke hva?"] }),
    ...[0, 1, 2].flatMap((i) => [
      shape([40 + i * 290, 130, 270, 250], { geometry: "roundRect", fill: "#F4F7FB" }),
      shape([40 + i * 290, 130, 270, 34], { geometry: "round2SameRect", fill: "#36455F", text: [{ text: ["Chat", "Lerret", "Prosjekt"][i]!, bold: true }] }),
      picture([50 + i * 290, 136, 22, 22], "rIk", "rIksvg"),
      shape([50 + i * 290, 175, 250, 190], { textBox: true, text: [{ text: "Fordeler", bold: true }, { text: "Raskt og fleksibelt", bullet: true }, { text: "Lett å prøve ut", bullet: true, level: 1 }] }),
    ]),
    // En uthevet boks INNI det første kortet, som «Eksempel på instruksjon» i Rapportskriving. Den
    // hører til kortet, og er ikke en ramme for seg.
    shape([55, 300, 240, 60], { geometry: "roundRect", fill: "#FFFFFF", text: [{ text: "Eksempel", bold: true }, "«Skriv i samme stil.»"] }),
    shape([40, 400, 850, 50], { geometry: "roundRect", fill: "#EEF1F6", text: ["Husk kontekstvinduet", "Rens kilder og oppsummer jevnlig."] }),
  ],
  media: ikon("rIk", HVITT_IKON, 5),
};

// Lysark 3: tre kolonner laget av malens plassholdere (overskrift over innhold), som i Møtearbeid.
// Rammen rundt hver kolonne tegnes av malen og finnes ikke på lysarket; den ene som er uthevet, har
// en tom ramme rundt seg.
const kolonner: SlideSpec = {
  shapes: [
    shape([26, 26, 900, 70], { placeholder: "title", text: ["Møtearbeid"] }),
    shape([129, 493, 36, 28], { placeholder: "sldNum", text: ["5"] }),
    shape([34, 493, 93, 28], { placeholder: "ftr", text: ["Firma AS"] }),
    ...[0, 1, 2].flatMap((i) => [
      shape([43 + i * 312, 167, 248, 47], { placeholder: "body", text: [["Før møtet", "Under møtet", "Etter møtet"][i]!] }),
      shape([43 + i * 312, 214, 248, 234], { placeholder: true, text: [{ text: ["Forbedre agenda", "Gruppere innspill", "Strukturere notater"][i]!, bullet: true }, { text: "Eksempel" }] }),
    ]),
    shape([329, 144, 300, 329], { geometry: "roundRect", fill: null }),
  ],
};

// Lysark 4: et skjermbilde, og notater som har prompten som står i bildet.
const skjermbilde: SlideSpec = {
  shapes: [shape(null, { placeholder: "title", text: ["Før møtet"] }), picture([80, 130, 520, 220], "rIb"), picture([620, 130, 300, 220], "rIc")],
  media: { rIb: { path: "media/image9.png", content: pngHeader(1156, 455) }, rIc: { path: "media/image10.jpeg", content: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 1, 0x2c, 2, 0x58, 3, 0, 0, 0]) } },
  notes: "Prompt «Hjelp meg å forberede et møte.»",
};

const læringsmål: SlideSpec = { shapes: [shape(null, { placeholder: "title", text: ["Etter modulen skal du kunne"] }), smartArt("rIdDgm")], diagram: ["Bruke KI før møtet", "Kvalitetssikre med fire øyne"] };
const tabell: SlideSpec = { shapes: [shape(null, { placeholder: "title", text: ["Kapitteloversikt"] }), table([["Kapittel", "Formål"], ["1. Innledning", "Presentere formål & bakgrunn"]])] };
const iGruppe: SlideSpec = { shapes: [group([100, 100, 400, 200], [0, 0, 200, 100], [shape([0, 0, 100, 50], { geometry: "rect", fill: "#EEEEEE", text: ["Venstre halvdel", "linje to"] })])] };

const fil = buildPptx([flyt, kort, kolonner, skjermbilde, læringsmål, tabell, iGruppe]);

describe("pptx-extract — leser hva som står på hvert lysark, og hvordan det er satt opp (#1079)", () => {
  const p = readPresentation(fil);
  const ark = (n: number) => p.slides[n - 1]!;

  it("leser alle lysarkene i rekkefølge, og størrelsen", () => {
    expect(p.slides.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(p.size).toEqual({ w: 960, h: 540 });
  });

  describe("en flyt", () => {
    it("stegene kommer i rekkefølge, hvert med navn, forklaring, ikon og farge", () => {
      expect(ark(1).flow!.steps).toEqual([
        { label: "Forstå oppdrag", description: "Mandat og krav.", icon: "image1.svg", colour: "#ead9c4" },
        { label: "Klargjør kilder", description: "Dokumenter og data.", icon: "image2.svg", colour: "#d9e8dd" },
        { label: "Lag grunnlag", description: "Strukturer kildene.", icon: "image3.svg", colour: "#d9e8dd" },
        { label: "Snakk med KI", description: "Still spørsmål.", icon: "image4.svg", colour: "#dce7f2" },
      ]);
    });

    it("fasene er de fargede båndene over stegene, med stegene de dekker — undertittelen er ikke en fase", () => {
      expect(ark(1).flow!.phases).toEqual([
        { name: "Data", colour: "#d9e8dd", steps: [2, 3] },
        { name: "Analyse", colour: "#dce7f2", steps: [4] },
      ]);
      expect(ark(1).subtitle).toBe("En strukturert prosess");
      // Tekstlinja uten farge står over tre av stegene, men er ikke en fase. Den er løs tekst.
      expect(ark(1).text).toEqual(["Les fra venstre mot høyre"]);
    });

    it("tittelen er tekstboksen med størst skrift øverst, når lysarket ikke har en tittelplassholder", () => {
      expect(ark(1).title).toBe("Anbefalt arbeidsflyt");
    });

    it("bunnteksten er ikke en del av noe steg, og står ikke som løs tekst", () => {
      expect(JSON.stringify(ark(1))).not.toContain("Firma AS");
    });

    it("oppsettet sies i ord", () => {
      expect(ark(1).layout).toEqual(["flow: 4 steps in a row, grouped in 2 phases, each with an icon"]);
    });
  });

  describe("kort ved siden av hverandre", () => {
    it("hver ramme har overskrift, stripens farge, ikon og linjene med punkt og nivå", () => {
      const rad = ark(2).frames[0]!;
      expect(rad.map((f) => f.heading)).toEqual(["Chat", "Lerret", "Prosjekt"]);
      expect(rad[0]).toMatchObject({ colour: "#36455f", icons: ["image5.svg"] });
      expect(rad[1]!.lines).toEqual([
        { text: "Fordeler", bullet: false, bold: true, level: 0 },
        { text: "Raskt og fleksibelt", bullet: true, bold: false, level: 0 },
        { text: "Lett å prøve ut", bullet: true, bold: false, level: 1 },
      ]);
    });

    it("en boks inni et kort hører til kortet: teksten står i kortets linjer, og boksen er ikke en ramme for seg", () => {
      expect(ark(2).frames).toHaveLength(2);
      expect(ark(2).frames[0]![0]!.lines.map((l) => l.text)).toEqual(["Fordeler", "Raskt og fleksibelt", "Lett å prøve ut", "Eksempel", "«Skriv i samme stil.»"]);
      expect(ark(2).frames.flat().map((f) => f.heading)).not.toContain("Eksempel");
    });

    it("en bred ramme alene er en stripe, med sin egen tekst", () => {
      expect(ark(2).frames[1]).toHaveLength(1);
      expect(ark(2).frames[1]![0]).toMatchObject({ heading: "Husk kontekstvinduet", lines: [{ text: "Rens kilder og oppsummer jevnlig." }] });
      expect(ark(2).layout).toEqual(["3 frames side by side, each with an icon", 'one wide strip ("Husk kontekstvinduet")']);
    });

    it("teksten i rammene står ikke en gang til som løs tekst", () => {
      expect(ark(2).text).toEqual([]);
      expect(ark(2).title).toBe("Når bruke hva?");
    });
  });

  describe("kolonner laget av malens plassholdere", () => {
    it("overskrift og innhold under hverandre er én ramme; tre på rad er tre rammer", () => {
      expect(ark(3).frames).toHaveLength(1);
      expect(ark(3).frames[0]!.map((f) => f.heading)).toEqual(["Før møtet", "Under møtet", "Etter møtet"]);
      expect(ark(3).frames[0]![1]!.lines).toEqual([{ text: "Gruppere innspill", bullet: true, bold: false, level: 0 }, { text: "Eksempel", bullet: false, bold: false, level: 0 }]);
      expect(ark(3).layout).toEqual(["3 frames side by side"]);
    });

    it("den tomme ramma rundt én kolonne sier hvilken som er uthevet — den er ikke en ramme selv", () => {
      expect(ark(3).frames[0]!.map((f) => f.highlighted === true)).toEqual([false, true, false]);
    });

    it("lysbildenummer og bunntekst er ikke innhold", () => {
      expect(ark(3).text).toEqual([]);
    });
  });

  describe("bilder", () => {
    it("hvert bilde får et filnavn etter lysarket, med størrelse i kB og piksler", () => {
      expect(ark(4).pictures.map((b) => ({ file: b.file, width: b.width, height: b.height }))).toEqual([
        { file: "slide-04-1.png", width: 1156, height: 455 },
        { file: "slide-04-2.jpeg", width: 600, height: 300 },
      ]);
      expect(p.images.map((b) => `${b.file}@${b.slide}`)).toEqual(["slide-04-1.png@4", "slide-04-2.jpeg@4"]);
      expect(p.images[0]!.bytes.equals(pngHeader(1156, 455))).toBe(true);
    });

    it("ikonene er ikke bilder: de står for seg, og ikon-PNG-en PowerPoint lagrer ved siden av, tas ikke med", () => {
      expect(ark(1).pictures).toEqual([]);
      expect(p.icons.map((i) => i.file).sort()).toEqual(["image1.svg", "image2.svg", "image3.svg", "image4.svg", "image5.svg"]);
      expect(p.icons.find((i) => i.file === "image5.svg")!.slides).toEqual([2]);
    });

    it("oppsettet sier at bildene må ses på", () => {
      expect(ark(4).layout[0]).toMatch(/^2 pictures — look at them/);
    });

    it("notatene leses — uten lysbildenummeret som står på notatsiden", () => {
      expect(ark(4).notes).toBe("Prompt «Hjelp meg å forberede et møte.»");
    });
  });

  describe("ikoner tegnet for mørk bunn", () => {
    it("et ensfarget, lyst ikon skrives mørkt", () => {
      const hvitt = p.icons.find((i) => i.file === "image1.svg")!;
      expect(hvitt.recoloured).toBe(true);
      expect(hvitt.svg).toContain("fill:#33312b");
      expect(hvitt.svg).not.toMatch(/#FFFFFF/i);
    });

    it("et mørkt ikon og et ikon med flere farger beholder fargene sine", () => {
      expect(p.icons.find((i) => i.file === "image3.svg")).toMatchObject({ recoloured: false, svg: sizeIcon(MØRKT_IKON) });
      expect(p.icons.find((i) => i.file === "image4.svg")).toMatchObject({ recoloured: false, svg: sizeIcon(FLERFARGET) });
    });

    // Et ikon uten oppgitt størrelse vises så bredt som spalten det står i: en liten tegning
    // blåst opp over hele siden. PowerPoint skriver ikonene uten størrelse.
    it("hvert ikon som hentes ut, har en oppgitt størrelse", () => {
      expect(p.icons.length).toBeGreaterThan(0);
      for (const ikon of p.icons) expect(ikon.svg, ikon.file).toMatch(new RegExp(`^<svg width="${ICON_SIZE}" height="${ICON_SIZE}" `));
    });

    it("et ikon som alt oppgir bredde eller høyde, får stå — også når bare én av dem er oppgitt", () => {
      for (const svg of [`<svg width="24" height="24" viewBox="0 0 96 96"><path d="M0 0"/></svg>`, `<svg viewBox="0 0 96 96" height="1em"><path d="M0 0"/></svg>`]) {
        expect(sizeIcon(svg)).toBe(svg);
      }
      // «stroke-width» er strekens bredde, ikke ikonets — også når den står på selve svg-elementet.
      expect(sizeIcon(`<svg viewBox="0 0 96 96" stroke-width="6"><path d="M0 0"/></svg>`)).toBe(`<svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 96 96" stroke-width="6"><path d="M0 0"/></svg>`);
    });

    it.each<[string, string, boolean]>([
      ["fyll som attributt", `<svg><path fill="#fff" d="M0 0"/></svg>`, true],
      ["strek som attributt", `<svg><path stroke="#F5F5F5" fill="none" d="M0 0"/></svg>`, true],
      ["middels grå er ikke lys nok", `<svg><path fill="#808080" d="M0 0"/></svg>`, false],
      ["uten farge i det hele tatt", `<svg><path d="M0 0"/></svg>`, false],
    ])("%s", (_navn, svg, ventet) => {
      expect(darkenLightIcon(svg).recoloured).toBe(ventet);
    });
  });

  it("SmartArt: teksten i punktene leses fra datafila, uten de tomme hjelpepunktene", () => {
    expect(ark(5).smartArt).toEqual(["Bruke KI før møtet", "Kvalitetssikre med fire øyne"]);
    expect(ark(5).layout).toEqual(["SmartArt with 2 items"]);
  });

  it("en tabell leses rad for rad, og tegn som & kommer riktig ut", () => {
    expect(ark(6).tables).toEqual([[["Kapittel", "Formål"], ["1. Innledning", "Presentere formål & bakgrunn"]]]);
    expect(ark(6).layout).toEqual(["table (2 rows × 2 columns)"]);
  });

  it("en form i en gruppe står der gruppa tegner den, ikke der den står i gruppas egne mål", () => {
    expect(ark(7).frames[0]![0]).toMatchObject({ x: 100, y: 100, w: 200, h: 100, heading: "Venstre halvdel" });
  });

  describe("teksten modellen får lese", () => {
    const tekst = describePresentation(p, { name: "prøve.pptx" });

    it("sier først at tekst i bilder ikke er med, og peker på hvert bilde", () => {
      expect(tekst.split("\n")[0]).toBe("# prøve.pptx — 7 slides");
      expect(tekst).toContain("Text inside pictures is NOT in this file");
      expect(tekst).toContain("**Picture:** images/slide-04-1.png (0 kB, 1156×455 px) — look at it");
    });

    it("har stegene, fasene, rammene, tabellen, SmartArt og notatene", () => {
      expect(tekst).toContain("1. **Forstå oppdrag** [icon: image1.svg] — Mandat og krav.");
      expect(tekst).toContain("- phase **Data** (#d9e8dd): steps 2, 3");
      expect(tekst).toContain("- **Under møtet** ← the one in focus on this slide");
      expect(tekst).toContain("    • Raskt og fleksibelt");
      expect(tekst).toContain("| 1. Innledning | Presentere formål & bakgrunn |");
      expect(tekst).toContain("**SmartArt:** Bruke KI før møtet · Kvalitetssikre med fire øyne");
      expect(tekst).toContain("**Speaker notes:** Prompt «Hjelp meg å forberede et møte.»");
    });
  });

  describe("en fil som ikke kan leses, sier hvorfor", () => {
    it.each<[string, Buffer, string]>([
      ["ikke en zip", Buffer.from("dette er ikke en presentasjon"), "not a .pptx file"],
      ["en zip uten presentasjon", zip({ "word/document.xml": "<x/>" }), "not a PowerPoint file"],
      ["en presentasjon uten lysark", buildPptx([]), "the presentation has no slides"],
    ])("%s", (_navn, buffer, melding) => {
      expect(() => readPresentation(buffer)).toThrow(melding);
    });
  });

  describe("fra kommandolinja", () => {
    const mappe = mkdtempSync(join(tmpdir(), "pptx-"));
    const kilde = join(mappe, "prøve.pptx");
    writeFileSync(kilde, fil);
    const kjør = (...args: string[]) => spawnSync(process.execPath, ["skills/a2-authoring-api/scripts/pptx-extract.mjs", ...args], { encoding: "utf8" });

    it("skriver slides.json, slides.md, bildene og ikonene — og sier at bildene må åpnes", () => {
      const ut = join(mappe, "ut");
      const k = kjør(kilde, ut);
      expect(k.status, k.stderr).toBe(0);
      expect(k.stdout).toContain("OK   7 slides · 2 pictures in images/ · 5 icons in icons/ (3 made dark)");
      expect(k.stdout).toContain("OPEN EVERY FILE under images/");
      expect(readdirSync(join(ut, "images")).sort()).toEqual(["slide-04-1.png", "slide-04-2.jpeg"]);
      expect(readdirSync(join(ut, "icons"))).toHaveLength(5);
      expect(readFileSync(join(ut, "icons", "image1.svg"), "utf8")).toContain("#33312b");
      const data = JSON.parse(readFileSync(join(ut, "slides.json"), "utf8")) as { slides: unknown[]; images: Array<Record<string, unknown>> };
      expect(data.slides).toHaveLength(7);
      // Bildenes innhold ligger i filene, ikke i JSON-en.
      expect(data.images[0]).not.toHaveProperty("bytes");
      expect(readFileSync(join(ut, "slides.md"), "utf8")).toContain("# prøve.pptx — 7 slides");
    });

    it("en fil som ikke er en presentasjon: feilkode 1, grunnen på én linje, og ingenting skrevet", () => {
      const feil = join(mappe, "feil.pptx");
      writeFileSync(feil, "ikke en zip");
      const k = kjør(feil, join(mappe, "ut2"));
      expect(k.status).toBe(1);
      expect(k.stderr).toContain("FAIL not a .pptx file");
      expect(existsSync(join(mappe, "ut2"))).toBe(false);
    });

    it("uten argumenter: bruksmåten, feilkode 2", () => {
      const k = kjør();
      expect(k.status).toBe(2);
      expect(k.stderr).toContain("usage:");
    });
  });
});
