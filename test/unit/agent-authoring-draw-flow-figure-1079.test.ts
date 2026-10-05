import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeProblems, drawFlowFigure, type FlowDescription } from "../../skills/a2-authoring-api/scripts/draw-flow-figure.mjs";
import { checkFigureFit } from "../../skills/a2-authoring-api/scripts/figure-fit-check.mjs";
import { checkFigureMotion } from "../../skills/a2-authoring-api/scripts/figure-motion-check.mjs";
import { extractSvgTexts, sanitizeSvg } from "../../src/modules/course/svgSanitizer.js";

// #1079: en flyt tegnes i to oppsett — bredt (alle steg på én rad) og smalt (to per rad) — fordi
// en figur som vises som bilde, ikke kan brekke seg selv om når spalten blir smal. To tegninger
// laget for hånd ville sprike. Her står innholdet ÉN gang, og begge tegnes fra det.
//
// Det testen vokter, er derfor to ting: at de to tegningene sier det samme, og at det som kommer
// ut, er flytmalen — altså består de samme sjekkene som en figur tegnet for hånd må bestå.

const saksgang = (): FlowDescription => ({
  name: "saksgang",
  title: "Saksgang fra mottak til arkiv",
  desc: "Åtte steg i rekkefølge, fordelt på fasene Forbered, Vurder og Avslutt.",
  phases: {
    start: { grunn: "#ead9c4", lys: "#c79f6d" },
    forbered: { label: "Forbered", grunn: "#d9e8dd", lys: "#6fae87", tekst: "#3f7a57" },
    vurder: { label: "Vurder", grunn: "#dce7f2", lys: "#7fa3c7", tekst: "#44699a" },
    avslutt: { label: "Avslutt", grunn: "#e7e2f0", lys: "#a99bc9", tekst: "#6b5a94" },
  },
  steps: [
    { label: ["Motta", "saken"], phase: "start" },
    { label: ["Sjekk", "vedlegg"], phase: "forbered" },
    { label: ["Hent", "opplysninger"], phase: "forbered" },
    { label: ["Vurder", "vilkårene"], phase: "vurder" },
    { label: ["Drøft", "med kollega"], phase: "vurder" },
    { label: ["Skriv", "vedtaket"], phase: "avslutt" },
    { label: ["Send", "svar"], phase: "avslutt" },
    { label: ["Arkiver"], phase: "avslutt" },
  ],
});
const med = (endre: (d: FlowDescription) => void): FlowDescription => { const d = saksgang(); endre(d); return d; };

const stilblokk = (svg: string) => /<style>([\s\S]*?)<\/style>/.exec(svg)?.[1];
const viewBox = (svg: string) => /viewBox="([^"]*)"/.exec(svg)?.[1];
const antall = (svg: string, element: string) => (svg.match(new RegExp(`<${element}\\b`, "g")) ?? []).length;

describe("draw-flow-figure — two layouts from one description (#1079)", () => {
  it("both layouts are the flow template: they pass the motion check and the fit check", () => {
    const { wide, narrow } = drawFlowFigure(saksgang());
    for (const svg of [wide, narrow]) {
      const bevegelse = checkFigureMotion(svg);
      expect(bevegelse.issues).toEqual([]);
      expect(bevegelse.animated).toBe(true);
      expect(bevegelse.totalSeconds).toBeLessThanOrEqual(5);
      expect(checkFigureFit(svg).issues).toEqual([]);
    }
  });

  it("the two layouts say the same: same texts in the same order, same style block, same steps", () => {
    const { wide, narrow } = drawFlowFigure(saksgang());
    expect(extractSvgTexts(narrow)).toEqual(extractSvgTexts(wide));
    expect(stilblokk(narrow)).toBe(stilblokk(wide));
    expect(narrow.match(/<circle class="[^"]*"/g)).toEqual(wide.match(/<circle class="[^"]*"/g));
    // Kontroll: sammenligningen over er ikke tom mot tom.
    expect(extractSvgTexts(wide)).toContain("Hent");
    expect(antall(wide, "circle")).toBe(8);
  });

  it("wide puts every step on one row; narrow breaks to two per row and joins the rows", () => {
    const { wide, narrow } = drawFlowFigure(saksgang());
    expect(viewBox(wide)).toBe("0 0 848 116");
    expect(viewBox(narrow)).toBe("0 0 240 472");
    expect(new Set(wide.match(/<circle [^>]*cy="(\d+)"/g)?.map((c) => /cy="(\d+)"/.exec(c)?.[1])).size).toBe(1);
    expect(new Set(narrow.match(/<circle [^>]*cy="(\d+)"/g)?.map((c) => /cy="(\d+)"/.exec(c)?.[1])).size).toBe(4);
    // Radskiftet er én sammenhengende strek fra siste steg i raden til første i neste.
    expect(antall(wide, "polyline")).toBe(0);
    expect(antall(narrow, "polyline")).toBe(3);
  });

  // Det smale oppsettet er tegnet for spalten en telefon gir. Uten en egen størrelse ville bildet
  // fylt en spalte på 600 px — et nettbrett — med etiketter på 30 px. Tegningen sier derfor selv
  // hvor stor den er på det meste; et bilde krympes til spalten, men blåses ikke opp forbi det.
  it("the narrow layout states its own size, so it is never enlarged past it; the wide one fills its column", () => {
    const { wide, narrow } = drawFlowFigure(saksgang());
    const rot = (svg: string) => /<svg[^>]*>/.exec(svg)![0];
    expect(rot(narrow)).toContain(`viewBox="0 0 240 472" width="300" height="590"`);
    expect(rot(wide)).not.toMatch(/ (width|height)=/);
    // Størrelsen overlever lagringen — ellers gjelder den bare i forhåndsvisningen hos forfatteren.
    expect(rot(sanitizeSvg(narrow))).toMatch(/width="300"/);
    expect(rot(sanitizeSvg(narrow))).toMatch(/height="590"/);
  });

  // 78 px per steg i raden gir etiketter på 9 px. To steg trenger 156 px; spalten på en telefon på
  // 390 px er målt til 201 px. Tre steg ville trengt 234 px og får ikke plass.
  it("the narrow layout is narrow enough for a phone: its labels are at least 9 px in a 200 px column", () => {
    const { narrow } = drawFlowFigure(saksgang());
    const bredde = Number(/viewBox="0 0 (\d+) /.exec(narrow)![1]);
    expect((12 * 200) / bredde).toBeGreaterThanOrEqual(9);
  });

  it("a flow of two steps is one row in both layouts; three steps break in the narrow one", () => {
    const to = med((d) => { d.steps = d.steps.slice(0, 2); d.phases = { start: d.phases.start!, forbered: d.phases.forbered! }; });
    expect(antall(drawFlowFigure(to).narrow, "polyline")).toBe(0);
    expect(antall(drawFlowFigure(to).narrow, "circle")).toBe(2);
    const tre = med((d) => { d.steps = d.steps.slice(0, 3); d.phases = { start: d.phases.start!, forbered: d.phases.forbered! }; });
    const { wide, narrow } = drawFlowFigure(tre);
    expect(antall(narrow, "polyline")).toBe(1);
    expect(antall(wide, "circle")).toBe(3);
    expect(antall(narrow, "circle")).toBe(3);
  });

  it("a phase with a label gets its line over its steps; a phase without gets none", () => {
    const { wide, narrow } = drawFlowFigure(saksgang());
    // Bredt: tre faser med navn, én strek hver. «start» har ikke navn og får ingen.
    expect(wide.match(/stroke-width="3"/g)).toHaveLength(3);
    // Smalt: hver av de tre fasene står på to rader, så streken deles i to — og navnet står to ganger.
    expect(narrow.match(/stroke-width="3"/g)).toHaveLength(6);
    expect(wide).not.toContain(">start<");
  });

  it("the phase line has the colour its steps light up in", () => {
    const { wide } = drawFlowFigure(saksgang());
    expect(wide).toContain(`stroke="#6fae87" stroke-width="3"`);
    expect(wide).toContain(`.forbered { --grunn: #d9e8dd; --lys: #6fae87; }`);
  });

  it("labels are written as text, not as markup: & and < in a label survive, and nothing is injected", () => {
    const d = med((x) => { x.steps[0]!.label = ["Mål &", "<middel>"]; x.title = "A & B <c>"; });
    const { wide } = drawFlowFigure(d);
    expect(wide).toContain("Mål &amp;");
    expect(wide).toContain("&lt;middel&gt;");
    expect(extractSvgTexts(wide)).toContain("<middel>");
    expect(checkFigureMotion(wide).issues).toEqual([]);
  });

  it("what the platform stores is still the template, in both layouts", () => {
    const figurer = drawFlowFigure(saksgang());
    for (const svg of [figurer.wide, figurer.narrow]) {
      const lagret = sanitizeSvg(svg);
      expect(lagret).not.toBe("");
      expect(checkFigureMotion(lagret).issues).toEqual([]);
      expect(checkFigureFit(lagret).issues).toEqual([]);
      expect(extractSvgTexts(lagret)).toEqual(extractSvgTexts(svg));
    }
  });

  it("the description figure-design.md shows can be drawn as written — the doc cannot teach one the script refuses", () => {
    const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
    const eksempel = /```json\r?\n([\s\S]*?)```/.exec(doc)?.[1];
    expect(eksempel).toBeTruthy();
    const beskrivelse = JSON.parse(eksempel!) as FlowDescription;
    expect(describeProblems(beskrivelse)).toEqual([]);
    const { wide, narrow } = drawFlowFigure(beskrivelse);
    expect(antall(wide, "circle")).toBe(beskrivelse.steps.length);
    expect(antall(narrow, "circle")).toBe(beskrivelse.steps.length);
  });

  // Funnet av QA-gjennomgangen av 2.82.0: skillet ba agenten ta bilde av figuren i et vindu på 400 px.
  // Det smale oppsettet oppgir sin egen størrelse og vises i den, så bildet stoppet midt i figuren —
  // og agenten skulle bedømme om «ingenting er kuttet i kanten». Vinduet i anvisningen må romme den
  // høyeste figuren skriptet tegner. (`--full-page` er ingen utvei: på en SVG-fil blir kommandoen
  // aldri ferdig. Prøvd 2026-10-05.)
  it("the window figure-design.md tells the agent to screenshot in holds the tallest figure the script draws", () => {
    const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
    const kommando = /npx playwright screenshot [^`]*/.exec(doc)?.[0] ?? "";
    const vindu = /--viewport-size=(\d+),(\d+)/.exec(kommando);
    expect(vindu, "anvisningen oppgir et vindu").toBeTruthy();
    expect(kommando).not.toContain("--full-page");
    const { narrow } = drawFlowFigure(saksgang());
    // Kontroll: figuren i testen er den høyeste — åtte steg er taket.
    expect(saksgang().steps).toHaveLength(8);
    const [, bredde, høyde] = /<svg\b[^>]* width="(\d+)" height="(\d+)"/.exec(narrow)!;
    expect(Number(vindu![2])).toBeGreaterThanOrEqual(Number(høyde));
    expect(Number(vindu![1])).toBeGreaterThanOrEqual(Number(bredde));
  });

  it("drawing is repeatable: the same description gives the same figure, byte for byte", () => {
    expect(drawFlowFigure(saksgang())).toEqual(drawFlowFigure(saksgang()));
  });

  describe("a description that cannot be drawn is refused, with every problem named", () => {
    it("control: the description used in these tests has no problems", () => {
      expect(describeProblems(saksgang())).toEqual([]);
    });

    it.each<[string, (d: FlowDescription) => void, string]>([
      ["no title", (d) => { d.title = " "; }, "`title` is required"],
      ["no description", (d) => { d.desc = ""; }, "`desc` is required"],
      ["a name that is not a file name", (d) => { d.name = "Min figur"; }, "`name` is the file name"],
      ["a step in a phase that does not exist", (d) => { d.steps[1]!.phase = "finnes-ikke"; }, `step 2: phase "finnes-ikke" is not in \`phases\``],
      ["a phase no step uses", (d) => { d.phases.ekstra = { grunn: "#eee", lys: "#333" }; }, `phase(s) "ekstra" have no step`],
      ["a phase named after a step class", (d) => { d.phases.s2 = d.phases.vurder!; d.steps[3]!.phase = "s2"; }, `phase "s2": the name`],
      ["a phase named steg", (d) => { d.phases.steg = d.phases.vurder!; d.steps[3]!.phase = "steg"; }, `phase "steg": the name`],
      ["a phase name with capitals", (d) => { d.phases.Vurder = d.phases.vurder!; d.steps[3]!.phase = "Vurder"; }, `phase "Vurder": the name`],
      ["a colour that is not hex", (d) => { d.phases.vurder!.grunn = "lightblue"; }, "`grunn` is an opaque hex colour"],
      ["a colour with an alpha channel", (d) => { d.phases.vurder!.lys = "#7fa3c780"; }, "`lys` is an opaque hex colour"],
      ["a label colour that is not hex", (d) => { d.phases.vurder!.tekst = "red"; }, "`tekst` is an opaque hex colour"],
      ["an empty phase label", (d) => { d.phases.vurder!.label = " "; }, "`label` is empty"],
      ["a label of three lines", (d) => { d.steps[0]!.label = ["Motta", "saken", "nå"]; }, "step 1: `label` is one or two short lines"],
      ["a label with an empty line", (d) => { d.steps[0]!.label = ["Motta", ""]; }, "step 1: `label` is one or two short lines"],
      ["no label", (d) => { d.steps[0]!.label = []; }, "step 1: `label` is one or two short lines"],
      ["one step", (d) => { d.steps = d.steps.slice(0, 1); d.phases = { start: d.phases.start! }; }, "at least two steps"],
      ["nine steps", (d) => { d.steps.push({ label: ["Evaluer"], phase: "avslutt" }); }, "9 steps is more than one figure holds (8)"],
      ["no phases", (d) => { d.phases = {}; }, "`phases` needs at least one phase"],
    ])("%s", (_navn, endre, melding) => {
      const d = med(endre);
      expect(describeProblems(d).join("\n")).toContain(melding);
      expect(() => drawFlowFigure(d)).toThrow(melding);
    });

    it("every problem is reported at once, not only the first", () => {
      const d = med((x) => { x.title = ""; x.steps[0]!.label = []; x.phases.vurder!.grunn = "blue"; });
      expect(describeProblems(d)).toHaveLength(3);
    });

    it("a description that is not an object gives problems, not a crash", () => {
      for (const ugyldig of [null, undefined, "tekst", 7, []]) expect(describeProblems(ugyldig).length).toBeGreaterThan(0);
    });
  });

  // Beskrivelsen kan være gyldig og tegningen likevel gal: en etikett som er for lang for plassen
  // mellom to steg. Det avgjøres av de samme sjekkene som gjelder en figur tegnet for hånd, og
  // feilen kommer her — ikke som en figur som ser feil ut hos deltakeren.
  it("a label too long for the space between two steps is an error that names the label and the layout", () => {
    const d = med((x) => { x.steps[2]!.label = ["Innhent alle tilleggsopplysninger"]; });
    expect(describeProblems(d)).toEqual([]);
    expect(() => drawFlowFigure(d)).toThrow(/the wide layout does not pass the figure checks[\s\S]*labels_overlap[\s\S]*Innhent alle tilleggsopplysninger/);
  });

  describe("from the command line", () => {
    const kjør = (beskrivelse: unknown) => {
      const mappe = mkdtempSync(join(tmpdir(), "flyt-"));
      const fil = join(mappe, "beskrivelse.json");
      writeFileSync(fil, JSON.stringify(beskrivelse), "utf8");
      const ut = join(mappe, "ut");
      const kjøring = spawnSync(process.execPath, ["skills/a2-authoring-api/scripts/draw-flow-figure.mjs", fil, ut], { encoding: "utf8" });
      return { kjøring, ut };
    };

    it("writes <name>.svg and <name>.narrow.svg, identical to what the function returns", () => {
      const { kjøring, ut } = kjør(saksgang());
      expect(kjøring.status, kjøring.stderr).toBe(0);
      expect(readdirSync(ut).sort()).toEqual(["saksgang.narrow.svg", "saksgang.svg"]);
      const figurer = drawFlowFigure(saksgang());
      expect(readFileSync(join(ut, "saksgang.svg"), "utf8")).toBe(figurer.wide);
      expect(readFileSync(join(ut, "saksgang.narrow.svg"), "utf8")).toBe(figurer.narrow);
    });

    it("a description that cannot be drawn exits 1, says why, and writes nothing", () => {
      const { kjøring, ut } = kjør(med((d) => { d.steps[1]!.phase = "finnes-ikke"; }));
      expect(kjøring.status).toBe(1);
      expect(kjøring.stderr).toContain(`phase "finnes-ikke" is not in \`phases\``);
      expect(() => readdirSync(ut)).toThrow();
    });

    it("without arguments it prints how it is used and exits 2", () => {
      const kjøring = spawnSync(process.execPath, ["skills/a2-authoring-api/scripts/draw-flow-figure.mjs"], { encoding: "utf8" });
      expect(kjøring.status).toBe(2);
      expect(kjøring.stderr).toContain("usage:");
    });
  });
});
