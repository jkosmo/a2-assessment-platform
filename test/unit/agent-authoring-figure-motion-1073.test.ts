import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkFigureMotion } from "../../skills/a2-authoring-api/scripts/figure-motion-check.mjs";
import { checkFigureFit } from "../../skills/a2-authoring-api/scripts/figure-fit-check.mjs";
import { applySvgTextTranslations, extractSvgTexts, sanitizeSvg } from "../../src/modules/course/svgSanitizer.js";

// #1073: figurer som viser et forløp skal animeres — og animasjonen skal tåle plattformen og være
// trygg uten at leserens «redusert bevegelse» når inn i et <img>.

const svg = (body: string, rootAttrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 80" role="img" font-family="system-ui, sans-serif"${rootAttrs}>${body}</svg>`;

const threeSteps = `
  <rect class="steg s1" x="10" y="20" width="120" height="40" rx="6"/>
  <text x="70" y="45" text-anchor="middle" font-size="14">Motta sak</text>
  <line x1="130" y1="40" x2="180" y2="40" stroke="#333"/>
  <rect class="steg s2" x="180" y="20" width="120" height="40" rx="6"/>
  <text x="240" y="45" text-anchor="middle" font-size="14">Vurder</text>
  <line x1="300" y1="40" x2="350" y2="40" stroke="#333"/>
  <rect class="steg s3" x="350" y="20" width="120" height="40" rx="6"/>
  <text x="410" y="45" text-anchor="middle" font-size="14">Fatt vedtak</text>`;

const goodStyle = `<style>
  .steg { fill: #eef; stroke: #333; }
  @keyframes lys { 0%, 70% { fill: #ffd166; } 100% { fill: #eef; } }
  .steg { animation: lys 1.4s ease-in-out 1; }
  .s2 { animation-delay: 1.2s; }
  .s3 { animation-delay: 2.4s; }
  @media (prefers-reduced-motion: reduce) { .steg { animation: none; } }
</style>`;

/** The animated flow template, exactly as figure-design.md publishes it. */
function templateFromDoc(): string {
  const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
  const section = doc.split("### flow (animated)")[1];
  const match = section?.match(/```svg\r?\n([\s\S]*?)```/);
  if (!match) throw new Error("animated flow template not found in figure-design.md");
  return match[1];
}

const kinds = (figure: string) => checkFigureMotion(svg(figure)).issues.map((i) => i.kind);
const medAnimasjon = (verdi: string) => goodStyle.replace("animation: lys 1.4s ease-in-out 1;", `animation: ${verdi};`);
const medRedusert = (regel: string) => goodStyle.replace("{ .steg { animation: none; } }", `{ ${regel} }`);
const medEkstra = (regel: string) => goodStyle.replace("</style>", `${regel}</style>`);

describe("figure-motion-check (#1073)", () => {
  it("the flow template's style block, on three boxes with step classes, passes", () => {
    const r = checkFigureMotion(svg(goodStyle + threeSteps));
    expect(r.animated).toBe(true);
    expect(r.sequence).toBe(true);
    expect(r.totalSeconds).toBeCloseTo(3.8, 5);
    expect(r.issues).toEqual([]);
  });

  it("the same flow drawn still is flagged — the rule that would otherwise have to be remembered", () => {
    const r = checkFigureMotion(svg(threeSteps));
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.kind)).toEqual(["sequence_not_animated"]);
  });

  it("an explicit data-motion=\"static\" is the visible exception for a still flow", () => {
    expect(checkFigureMotion(svg(threeSteps, ' data-motion="static"')).ok).toBe(true);
  });

  it("control: a figure that is not a sequence is fine without animation", () => {
    const tree = `<rect x="150" y="10" width="100" height="40"/><text x="200" y="35">Spørsmål</text>
      <line x1="180" y1="50" x2="90" y2="140"/><line x1="220" y1="50" x2="310" y2="140"/>
      <rect x="30" y="140" width="120" height="40"/><text x="90" y="165">Ja</text>
      <rect x="250" y="140" width="120" height="40"/><text x="310" y="165">Nei</text>`;
    const r = checkFigureMotion(svg(tree));
    expect(r.sequence).toBe(false);
    expect(r.ok).toBe(true);
  });

  // ⚠️ Stilblokka ER malen (produkteiers beslutning 2026-10-04). Tre QA-runder fant til sammen
  // tjueto måter å skrive en animasjon på som slapp gjennom en sjekk som prøvde å TOLKE stilregler.
  // Lista under er de tjueto, pluss naboene deres. Ingen av dem trenger sin egen regel lenger: de er
  // ikke malen, og det er nok. Lista står her som vakt mot at tolkningen kommer tilbake.
  const ikkeMalen: Array<[string, string]> = [
    ["går i evig løkke", medAnimasjon("lys 1.4s ease-in-out infinite")],
    ["gjentas tre ganger", medAnimasjon("lys 0.5s ease-in-out 3")],
    ["antall 0 — kjører aldri", medAnimasjon("lys 1.4s ease-in-out 0")],
    ["uten varighet — kjører aldri", medAnimasjon("lys ease-in-out 1")],
    ["negativ forsinkelse som bruker opp animasjonen", medAnimasjon("lys 1s -1s ease-in-out 1")],
    ["navn uten keyframes", medAnimasjon("lyss 1.4s ease-in-out 1")],
    ["keyframes med annen bruk av store bokstaver", goodStyle.replace("@keyframes lys", "@keyframes Lys")],
    ["langform i stedet for kortform", goodStyle.replace(".steg { animation: lys 1.4s ease-in-out 1; }", ".steg { animation-name: lys; animation-duration: 1.4s; }")],
    ["langform for antall", goodStyle.replace("ease-in-out 1; }", "ease-in-out 1; animation-iteration-count: 2; }")],
    ["cubic-bezier()", medAnimasjon("lys 1.4s cubic-bezier(.1, .2, .3, 1) 1")],
    ["steps()", medAnimasjon("lys 1.4s steps(4, end) 1")],
    ["to animasjoner i én regel", medAnimasjon("lys 1s ease-in-out 1, lys 2s ease-in-out 1")],
    ["alternate", medAnimasjon("lys 1.4s ease-in-out 1 alternate")],
    ["to easing-ord — nettleseren forkaster deklarasjonen", medAnimasjon("lys 1.4s ease-in ease-out 1")],
    ["forwards-fyll", medAnimasjon("lys 1.4s ease-in-out 1 forwards")],
    ["!important på animasjonen — regelen for redusert bevegelse taper", medAnimasjon("lys 1.4s ease-in-out 1 !important")],
    ["flere verdier i animation-delay", goodStyle.replace("animation-delay: 1.2s;", "animation-delay: 1.2s, 2s;")],
    ["negativ animation-delay", goodStyle.replace("animation-delay: 1.2s;", "animation-delay: -1.2s;")],
    ["regelen for redusert bevegelse mangler", goodStyle.replace(/@media[^\n]*\n/, "")],
    ["regelen for redusert bevegelse navngir noe annet", medRedusert(".annet { animation: none; }")],
    ["regelen for redusert bevegelse bruker *", medRedusert("* { animation: none !important; }")],
    ["regelen for redusert bevegelse bruker svg *", medRedusert("svg * { animation: none !important; }")],
    ["sammensatt media-betingelse", goodStyle.replace("(prefers-reduced-motion: reduce)", "(prefers-reduced-motion: reduce) and (min-width: 9999px)")],
    ["mer inne i blokka for redusert bevegelse", medRedusert(".steg { animation: none; } .s2 { animation: lys 9s infinite; }")],
    ["en senere regel slår animasjonen av", medEkstra(".steg { animation: none; }")],
    ["en senere regel med !important overstyrer fargen animasjonen setter", medEkstra(".steg { fill: red !important; }")],
    ["animasjon i en annen @media-blokk", medEkstra("@media (min-width: 0) { .steg { animation: lys 9s infinite; } }")],
    ["animasjon i @supports", medEkstra("@supports (display: block) { .steg { animation: lys 9s infinite; } }")],
    ["innhold skjult i grunnstilen", goodStyle.replace(".steg { fill: #eef; stroke: #333; }", ".steg { fill: #eef; stroke: #333; opacity: 0; }")],
    ["display: none på et steg", goodStyle.replace(".s3 { animation-delay: 2.4s; }", ".s3 { animation-delay: 2.4s; display: none; }")],
    ["velgeren treffer ingen boks", goodStyle.replaceAll(".steg", ".step")],
    ["en ekstra regel foran malen", goodStyle.replace("<style>", "<style>text { fill: #111; }")],
    ["reglene i en annen rekkefølge", goodStyle
      .replace("  .steg { animation: lys 1.4s ease-in-out 1; }\n", "")
      .replace("  .steg { fill: #eef; stroke: #333; }\n", "  .steg { fill: #eef; stroke: #333; }\n  .steg { animation: lys 1.4s ease-in-out 1; }\n")],
    ["siste nøkkelbilde går ikke tilbake til grunnfargen", goodStyle.replace("100% { fill: #eef; }", "100% { fill: #fff; }")],
    ["fremhevingsfargen er lik grunnfargen — ingenting ses", goodStyle.replace("fill: #ffd166;", "fill: #EEF;")],
    ["varighet 0s", medAnimasjon("lys 0s ease-in-out 1")],
    // Runde 4: malen holdt, men det som FÅR variere var for romslig.
    ["en kommentar i stilblokka", goodStyle.replace("<style>", "<style>/* stegene lyser opp etter tur */")],
    ["en kommentar inne i en verdi — nettleseren leser «1» og «.4s»", medAnimasjon("lys 1/*x*/.4s ease-in-out 1")],
    ["gjennomsiktig grunnfarge — boksene forsvinner fra stillbildet", goodStyle.replaceAll("#eef", "#0000")],
    ["åttesifret farge med alfakanal", goodStyle.replaceAll("#eef", "#eeeeff00")],
    ["femsifret farge — ikke en farge", goodStyle.replaceAll("#eef", "#eeeef")],
    ["gjennomsiktig strek", goodStyle.replace("stroke: #333", "stroke: #3330")],
    ["fremhevingsfargen er grunnfargen i en annen skrivemåte", goodStyle.replace("fill: #ffd166;", "fill: #eeeeff;")],
    ["to steg med samme forsinkelse — de lyser samtidig", goodStyle.replace("2.4s", "1.2s")],
    ["forsinkelsene går baklengs — rekkefølgen spilles feil vei", goodStyle.replace("1.2s", "3s")],
    ["andre steg uten forsinkelse — det lyser sammen med første", goodStyle.replace("1.2s", "0s")],
  ];

  it.each(ikkeMalen)("not the template: %s", (_navn, stil) => {
    const r = checkFigureMotion(svg(stil + threeSteps));
    expect(r.animated).toBe(false);
    // Nøyaktig én type funn — og ikke «flyten er ikke animert» på toppen: figuren PRØVER, den gjør
    // det bare ikke slik malen gjør det.
    expect([...new Set(r.issues.map((i) => i.kind))]).toEqual(["unsupported_animation_form"]);
    expect(r.issues[0].detail).toContain("figure-design.md");
  });

  it("the message says where the block leaves the template", () => {
    const r = checkFigureMotion(svg(medAnimasjon("lys 1.4s ease-in-out infinite") + threeSteps));
    expect(r.issues[0].detail).toContain("expected `.steg { animation: lys <seconds>s ease-in-out 1; }`");
    expect(r.issues[0].detail).toContain("infinite");
    // En kommentar får sin egen forklaring: «forventet regel X, fant /* … */» sier ikke hva som er galt.
    const medKommentar = checkFigureMotion(svg(goodStyle.replace("<style>", "<style>/* stegene */") + threeSteps));
    expect(medKommentar.issues[0].detail).toContain("no comments");
    // …og like forsinkelser sier hva regelen er, og hva som ble funnet.
    const like = checkFigureMotion(svg(goodStyle.replace("2.4s", "1.2s") + threeSteps));
    expect(like.issues[0].detail).toContain("larger than the one before it");
    expect(like.issues[0].detail).toContain("1.2s, 1.2s");
  });

  it("the step classes on the boxes and the delay rules must agree, both ways", () => {
    // En regel uten boks, en boks uten regel, og en boks uten stegklasse: alle tre er «malen, men
    // ikke brukt riktig» — animasjonen ville truffet feil antall bokser.
    const typer = (figur: string) => [...new Set(kinds(figur))];
    const utenS3Regel = goodStyle.replace("  .s3 { animation-delay: 2.4s; }\n", "");
    expect(typer(utenS3Regel + threeSteps)).toEqual(["unsupported_animation_form"]);
    const medS4Regel = goodStyle.replace(".s3 { animation-delay: 2.4s; }", ".s3 { animation-delay: 2.4s; } .s4 { animation-delay: 3.6s; }");
    expect(typer(medS4Regel + threeSteps)).toEqual(["unsupported_animation_form"]);
    expect(typer(goodStyle + threeSteps.replace('class="steg s2"', 'class="steg"'))).toEqual(["unsupported_animation_form"]);
    expect(typer(goodStyle + threeSteps.replace('class="steg s3"', 'class="steg s2"'))).toEqual(["unsupported_animation_form"]);
    // Et hull i rekka (.s2, .s4) — også når boksene har de samme klassene som reglene.
    const hull = goodStyle.replace(".s3 { animation-delay", ".s4 { animation-delay");
    expect(typer(hull + threeSteps.replace('class="steg s3"', 'class="steg s4"'))).toEqual(["unsupported_animation_form"]);
    // …og når boksene er riktige (s1, s2, s3), men regelen peker på .s4: tredje boks får aldri sin forsinkelse.
    expect(checkFigureMotion(svg(hull + threeSteps)).issues.map((i) => i.detail).join(" ")).toContain("in order, without gaps");

    // Klassene skal stå på BOKSENE. På etikettene ville samme regel animert tekstfargen og latt
    // boksene stå stille — og tellingen «tre elementer med steg s1…s3» ville stemt likevel.
    const påEtikettene = threeSteps.replace(/<rect class="steg (s\d)"/g, "<rect").replace(/<text /g, () => "<text ")
      .replace('<text x="70"', '<text class="steg s1" x="70"').replace('<text x="240"', '<text class="steg s2" x="240"').replace('<text x="410"', '<text class="steg s3" x="410"');
    const r = checkFigureMotion(svg(goodStyle + påEtikettene));
    expect(r.animated).toBe(false);
    expect(r.issues.map((i) => i.detail).join(" ")).toContain("<text>");
    // …også når boksene har sine klasser i tillegg: en etikett med «steg» blir animert den også.
    expect(typer(goodStyle + threeSteps.replace('<text x="70"', '<text class="steg" x="70"'))).toEqual(["unsupported_animation_form"]);

    // HVER boks er et steg. En fjerde boks uten klassen er et steg som aldri lyser opp: figuren
    // viser fire steg og animerer tre. (Funnet av QA-porten, runde 5.)
    const fjerdeUtenKlasse = threeSteps + `<line x1="470" y1="40" x2="520" y2="40"/><rect x="520" y="20" width="120" height="40"/><text x="580" y="45">Arkiver</text>`;
    const fire = checkFigureMotion(svg(goodStyle + fjerdeUtenKlasse));
    expect(fire.animated).toBe(false);
    expect(fire.issues.map((i) => i.detail).join(" ")).toContain("every <rect> and <circle> in an animated figure is a step");
  });

  // ⚠️ HELE figuren er malen, ikke bare stilblokka (produkteiers andre beslutning 2026-10-04).
  // «Hver <rect> er et steg» slapp gjennom et fjerde steg tegnet som rombe; «stilblokka er malen»
  // slapp gjennom <style media="print">, der blokka aldri gjelder. Hver var én form til som ingen
  // hadde listet. Nå er det formene som FÅR finnes som er listet.
  const fjerdeSteg = (form: string) => threeSteps + `<line x1="470" y1="40" x2="520" y2="40"/>${form}<text x="560" y="45">Arkiver</text>`;
  const ikkeMalensFigur: Array<[string, string, string]> = [
    ["et fjerde steg tegnet som rombe", goodStyle + fjerdeSteg(`<polygon points="520,40 560,20 600,40 560,60" fill="#eef" stroke="#333"/>`), "<polygon>"],
    ["et fjerde steg tegnet som ellipse", goodStyle + fjerdeSteg(`<ellipse cx="560" cy="40" rx="40" ry="20" fill="#eef"/>`), "<ellipse>"],
    ["rombe MED stegklassen — klassen hører bare hjemme på <rect>", goodStyle.replace(".s3 { animation-delay: 2.4s; }", ".s3 { animation-delay: 2.4s; } .s4 { animation-delay: 3.6s; }") + fjerdeSteg(`<polygon class="steg s4" points="520,40 560,20 600,40 560,60"/>`), "<polygon>"],
    ["et fjerde steg tegnet som lukket path", goodStyle + fjerdeSteg(`<path d="M520 20 H640 V60 H520 Z" fill="#eef" stroke="#333"/>`), "open stroke"],
    ["en lukket path uten fyll — omrisset av en boks er også en boks", goodStyle + fjerdeSteg(`<path d="M520 20 H640 V60 H520 Z" fill="none" stroke="#333"/>`), "open stroke"],
    ["et omriss tegnet uten Z, men tilbake til start — like lukket", goodStyle + fjerdeSteg(`<path d="M520 20 H640 V60 H520 V20" fill="none" stroke="#333"/>`), "open stroke"],
    ["en polyline som ender der den begynte", goodStyle + fjerdeSteg(`<polyline points="520,20 640,20 640,60 520,60 520,20" fill="none" stroke="#333"/>`), "open stroke"],
    ["en fylt path uten Z — fortsatt en flate, ikke en strek", goodStyle + fjerdeSteg(`<path d="M520 20 H640 V60 H520" fill="#eef"/>`), "open stroke"],
    ["en polyline uten fill=\"none\" — nettleseren fyller den svart", goodStyle + threeSteps + `<polyline points="10,70 100,70 100,78"/>`, "open stroke"],
    ["stilblokka gjelder bare utskrift", goodStyle.replace("<style>", `<style media="print">`) + threeSteps, "no attributes"],
    ["stilblokka er ikke CSS for nettleseren", goodStyle.replace("<style>", `<style type="text/plain">`) + threeSteps, "no attributes"],
    ["en gruppe rundt boksene", goodStyle + `<g>${threeSteps}</g>`, "<g>"],
    ["stegbokser gjemt i <defs> — de tegnes aldri", goodStyle + `<defs>${threeSteps}</defs>`, "<defs>"],
    ["en boks forskjøvet med transform", goodStyle + threeSteps.replace('class="steg s3"', 'class="steg s3" transform="scale(0)"'), "transform"],
    ["en svg inni figuren", goodStyle + threeSteps + `<svg x="0" y="0"></svg>`, "one <svg>"],
    ["en <switch> rundt en boks", goodStyle + threeSteps.replace('<rect class="steg s3"', '<switch><rect class="steg s3"') + "</switch>", "<switch>"],
    ["varighet som ingen rekker å se", medAnimasjon("lys .001s ease-in-out 1") + threeSteps, "at least 0.3s"],
  ];

  it.each(ikkeMalensFigur)("not the template's figure: %s", (_navn, figur, forklaring) => {
    const r = checkFigureMotion(svg(figur));
    expect(r.animated).toBe(false);
    expect([...new Set(r.issues.map((i) => i.kind))]).toEqual(["unsupported_animation_form"]);
    // Forklaringen måles: meldingen skal si HVA som ikke er malen, ikke bare at noe er galt.
    expect(r.issues.map((i) => i.detail).join(" ")).toContain(forklaring);
  });

  it("control: the template's own elements in other arrangements — path and polyline connectors, tspan labels, title and desc", () => {
    const medPath = threeSteps
      .replace('<line x1="130" y1="40" x2="180" y2="40" stroke="#333"/>', '<path d="M130 40 H180" fill="none" stroke="#333"/>')
      .replace('<line x1="300" y1="40" x2="350" y2="40" stroke="#333"/>', '<polyline points="300,40 325,40 350,40" fill="none" stroke="#333"/>')
      .replace('<text x="70" y="45" text-anchor="middle" font-size="14">Motta sak</text>', '<text text-anchor="middle" font-size="14"><tspan x="70" y="40">Motta</tspan><tspan x="70" dy="14">sak</tspan></text>');
    expect(medPath).toContain("<path");
    expect(medPath).toContain("<polyline");
    expect(medPath).toContain("<tspan");
    const r = checkFigureMotion(svg(`<title>Saksgang</title><desc>Tre steg i rekkefølge</desc>${goodStyle}${medPath}`));
    expect(r.issues).toEqual([]);
    expect(r.animated).toBe(true);
    expect(r.sequence).toBe(true);
    // …og en stillestående figur er ikke bundet av malen: den kan ha grupper, sirkler og transform.
    expect(kinds(`<g transform="translate(5,5)"><circle cx="20" cy="20" r="10"/><polygon points="0,0 10,0 5,8"/></g>`)).toEqual([]);
  });

  // Funnet av gjennomgangen som ga GO (2026-10-04): ikke blokkerende, men ekte.
  it("a `>` inside an attribute value does not end the tag", () => {
    // Falsk feil: en helt vanlig aria-label med «->» foran unntaket gjorde at unntaket aldri ble lest.
    expect(checkFigureMotion(svg(threeSteps, ' aria-label="Motta sak -> Vurder -> Fatt vedtak" data-motion="static"')).ok).toBe(true);
    // Falsk godkjenning: attributter ETTER en «>» ble ikke sett.
    const skjultStil = threeSteps.replace('class="steg s1"', 'data-n=">" class="steg s1" style="fill: red !important"');
    expect(kinds(goodStyle + skjultStil)).toEqual(["unsupported_animation_form"]);
    const skjultTransform = threeSteps.replace('class="steg s3"', "data-n='>' class=\"steg s3\" transform=\"scale(0)\"");
    expect(kinds(goodStyle + skjultTransform)).toEqual(["unsupported_animation_form"]);
    // Kontroll: malen med en slik aria-label på rota er fortsatt malen.
    expect(checkFigureMotion(svg(goodStyle + threeSteps, ' aria-label="Motta sak -> Vurder"')).issues).toEqual([]);
  });

  it("spellings the platform or the browser normalises are seen: lower-case SMIL and CSS escapes", () => {
    // Plattformens rensing retter <animatemotion> til <animateMotion>, så den går i løkke der.
    const små = threeSteps + `<circle r="4"><animatemotion dur="1s" repeatCount="indefinite" path="M0,0 L100,0"/></circle>`;
    expect(kinds(små)).toContain("not_css_only");
    // CSS leser `anim\61tion` som `animation`. En «stillestående» figur med den beveger seg for alltid.
    const escapet = `<style>.a { anim\\61tion: lys 9s infinite; } @keyfr\\61mes lys { to { opacity: .5 } }</style>` + threeSteps.replace('class="steg s1"', 'class="a"');
    expect(kinds(escapet)).toEqual(["css_escape"]);
  });

  // Funnet av gjennomgangen av 2.78.2 (2026-10-04): en STILLESTÅENDE figur med en escape i stilen ble
  // avvist med en melding om malen for animerte figurer. Regelen står; meldingen var svar på et
  // annet spørsmål. Samme dag målt: en tegnreferanse staver «animation» like godt som en escape, og
  // den slapp gjennom som stillestående figur.
  describe("a character spelled without being written is refused, with its own message", () => {
    const stille = (stil: string, attributt = "") =>
      svg(`<style>${stil}</style><rect x="10" y="10" width="80" height="40" fill="#eef"/><text class="t" x="20" y="30"${attributt}>Hei</text>`);

    it("control: a still figure with ordinary CSS passes", () => {
      expect(checkFigureMotion(stille(`.t { font-family: "Segoe UI", sans-serif; }`)).issues).toEqual([]);
    });

    it.each([
      ["a CSS escape in a still figure", stille(`.t { font-family: Segoe\\ UI, sans-serif; }`)],
      ["an escape that spells animation", stille(`.t { anim\\61tion: x 9s infinite; }`)],
      ["a character reference that spells animation", stille(`.t { &#97;nimation: x 9s infinite; } @keyfr&#x61;mes x { to { opacity: .5 } }`)],
      ["a character reference that spells a backslash", stille(`.t { anim&#92;61tion: x 9s infinite; }`)],
      ["a named reference the platform knows and XML does not", stille(`.t { anim&bsol;61tion: x 9s infinite; }`)],
      ["a reference without its semicolon", stille(`.t { &#97nimation: x 9s infinite; }`)],
      ["a character reference in a style attribute", stille(`.t { fill: #111; }`, ` style="&#97;nimation: x 9s infinite"`)],
    ])("%s", (_navn, figur) => {
      const r = checkFigureMotion(figur);
      expect(r.issues.map((i) => i.kind)).toEqual(["css_escape"]);
      // Meldingen handler om det som er galt, ikke om malen for animerte figurer.
      expect(r.issues[0]?.detail).not.toMatch(/template|steg/);
      expect(r.animated).toBe(false);
    });

    // Grunnen til regelen, målt mot plattformens egen rensing og ikke antatt: det som lagres, ER en
    // animasjon (eller en escape nettleseren leser som en). Slutter plattformen å gjøre referansene
    // om, blir denne rød, og da kan regelen vurderes på nytt.
    it.each([
      [`.t { &#97;nimation: x 9s infinite; }`, "animation: x 9s infinite"],
      [`.t { &#97nimation: x 9s infinite; }`, "animation: x 9s infinite"],
      [`.t { anim&#92;61tion: x 9s infinite; }`, "anim\\61tion: x 9s infinite"],
      [`.t { anim&bsol;61tion: x 9s infinite; }`, "anim\\61tion: x 9s infinite"],
    ])("the platform stores %s as running CSS", (stil, lagret) => {
      expect(sanitizeSvg(stille(stil))).toContain(lagret);
    });
    it("the platform stores a character reference in a style attribute as running CSS", () => {
      expect(sanitizeSvg(stille(`.t { fill: #111; }`, ` style="&#97;nimation: x 9s infinite"`))).toContain(`style="animation: x 9s infinite"`);
    });

    it("`>`, `<` and `&` written the XML way are not escapes — the platform writes `>` so itself", () => {
      expect(checkFigureMotion(stille(`.a &gt; .t { fill: #111; } @media (width &lt; 600px) { .t { fill: #222; } }`)).issues).toEqual([]);
      expect(checkFigureMotion(stille(`.t::after { content: "a &amp; b"; }`)).issues).toEqual([]);
    });

    // Funnet av gjennomgangen av 2.78.3: plattformen skriver `"` som `&quot;` i en attributtverdi, så
    // en figur som besto som utkast, ble avvist etter en runde gjennom plattformen (eksport → sjekk).
    // Ingen test gikk den veien. Denne gjør det, for hver form en referanse kan komme tilbake i.
    it.each([
      ["quotes in a style attribute", stille(`.t { fill: #111; }`, ` style='font-family: "Segoe UI", sans-serif'`)],
      ["quotes, `>` and `&` in a style block", stille(`.a > .t { font-family: "Segoe UI", 'Helvetica Neue'; } .t::after { content: "a &amp; b"; }`)],
      ["a non-breaking space in a style block", stille(`.t::after { content: "§ 12"; }`)],
      ["`<` in a media query", stille(`@media (width &lt; 600px) { .t { fill: #222; } }`)],
    ])("what the platform writes back still passes: %s", (_navn, utkast) => {
      expect(checkFigureMotion(utkast).issues, "utkastet").toEqual([]);
      const lagret = sanitizeSvg(utkast);
      expect(lagret).not.toBe("");
      expect(checkFigureMotion(lagret).issues, lagret).toEqual([]);
    });

    it("control: the platform does write `&quot;` in a style attribute — the case above is real", () => {
      expect(sanitizeSvg(stille(`.t { fill: #111; }`, ` style='font-family: "Segoe UI"'`))).toContain(`style="font-family: &quot;Segoe UI&quot;"`);
    });

    it("the animated template is not disturbed, and an escape in it is reported next to what else is wrong", () => {
      expect(checkFigureMotion(svg(goodStyle + threeSteps)).issues).toEqual([]);
      const medEscape = goodStyle.replace("</style>", " .steg { font-family: Segoe\\ UI; }</style>");
      expect(kinds(medEscape + threeSteps).sort()).toEqual(["css_escape", "unsupported_animation_form"]);
    });
  });

  it("an animated figure has one <style> block and no style attributes", () => {
    expect(kinds(goodStyle + "<style>text { fill: #111; }</style>" + threeSteps)).toEqual(["unsupported_animation_form"]);
    // En style-attributt vinner over stilarket, og !important der vinner over animasjonen.
    expect(kinds(goodStyle + threeSteps.replace('class="steg s1"', 'class="steg s1" style="fill: red !important"'))).toEqual(["unsupported_animation_form"]);
    // …også når hele animasjonen ligger i attributten og stilblokka mangler.
    expect(kinds(threeSteps.replace('class="steg s1"', 'class="steg s1" style="animation: lys 1s infinite"'))).toEqual(["unsupported_animation_form"]);
  });

  it("control: what MAY differ from the template — layout, colours, duration, delays, number of steps", () => {
    const minifisert = goodStyle.replace(/\s+/g, " ").replace(/\s*([{}:;,])\s*/g, "$1").replace("<style>", "<style>\n");
    expect(kinds(minifisert + threeSteps)).toEqual([]);
    // En kommentar i MARKUPEN er fri — det er i stilblokka den ikke kan stå.
    expect(kinds(goodStyle + "<!-- stegene lyser opp etter tur -->" + threeSteps)).toEqual([]);
    const cdata = goodStyle.replace("<style>", "<style><![CDATA[").replace("</style>", "]]></style>");
    expect(kinds(cdata + threeSteps)).toEqual([]);
    const andreFarger = goodStyle.replaceAll("#eef", "#E8F0FE").replace("#333", "#1a73e8").replace("#ffd166", "#fbbc04");
    expect(kinds(andreFarger + threeSteps)).toEqual([]);
    const andreTider = medAnimasjon("lys 0.9s ease-in-out 1").replace("1.2s", "0.8s").replace("2.4s", "1.6s");
    const r = checkFigureMotion(svg(andreTider + threeSteps));
    expect(r.issues).toEqual([]);
    expect(r.totalSeconds).toBeCloseTo(2.5, 5);

    const fireSteg = goodStyle.replace(".s3 { animation-delay: 2.4s; }", ".s3 { animation-delay: 2.4s; }\n  .s4 { animation-delay: 3.6s; }");
    const fjerde = `<line x1="470" y1="40" x2="500" y2="40"/><rect class="steg s4" x="500" y="20" width="120" height="40"/><text x="560" y="45">Arkiver</text>`;
    const fire = checkFigureMotion(svg(fireSteg + threeSteps + fjerde));
    expect(fire.issues).toEqual([]);
    expect(fire.totalSeconds).toBeCloseTo(5, 5);
  });

  it("an animation longer than 5 seconds fails, and the report says how long", () => {
    const r = checkFigureMotion(svg(goodStyle.replace("2.4s", "4.5s") + threeSteps));
    expect(r.animated).toBe(true);
    expect(r.issues.map((i) => i.kind)).toEqual(["too_long"]);
    expect(r.issues[0].detail).toContain("5.9s");
  });

  it("an element switched off by an attribute is missing from the still picture", () => {
    // Verdiene LESES: mellomrom, prosent og «collapse» skjuler like godt som skrivemåten man tenker på først.
    for (const av of ['display="none"', 'display=" none "', 'visibility="hidden"', 'visibility="collapse"', 'opacity="0"', 'opacity=" 0 "', "fill-opacity='0.0'", 'fill-opacity="0%"']) {
      expect(kinds(goodStyle + threeSteps + `<text ${av} x="5" y="12">Merknad</text>`), av).toEqual(["hidden_at_rest"]);
    }
    // Kontroll: delvis gjennomsiktig er ikke skjult, og synlige verdier er synlige.
    for (const på of ['opacity="0.5"', 'fill-opacity="40%"', 'visibility="visible"', 'display="inline"']) {
      expect(kinds(goodStyle + threeSteps + `<text ${på} x="5" y="12">Merknad</text>`), på).toEqual([]);
    }
  });

  it("SMIL the platform strips is reported, even when CSS also animates", () => {
    const r = checkFigureMotion(svg(goodStyle + threeSteps.replace('rx="6"/>', 'rx="6"><animate attributeName="opacity" values="0;1" dur="1s"/></rect>')));
    expect(r.issues.map((i) => i.kind)).toContain("stripped_by_platform");
  });

  it("single-quoted attributes are read: a still flow written with ' is still a flow", () => {
    const enkle = threeSteps.replace(/"/g, "'");
    const r = checkFigureMotion(svg(enkle));
    expect(r.sequence).toBe(true);
    expect(r.issues.map((i) => i.kind)).toEqual(["sequence_not_animated"]);
    // …og unntaket leses også med enkle anførselstegn.
    expect(checkFigureMotion(svg(enkle, " data-motion='static'")).ok).toBe(true);
    // …og stegklassene: malen med enkle anførselstegn er fortsatt malen.
    expect(kinds(goodStyle + enkle)).toEqual([]);
  });
});

// Funnet av QA-porten 2026-10-04, andre pass: flytgjenkjenningen telte bokser og streker hver for seg.
// Det som gjør en figur til en flyt er at strekene FORBINDER boksene, i rekkefølge.
describe("what counts as a flow (#1073)", () => {
  const boks = (x: number, y: number, etikett: string) =>
    `<rect x="${x}" y="${y}" width="120" height="40"/><text x="${x + 60}" y="${y + 25}">${etikett}</text>`;
  const treIRad = boks(10, 20, "Motta sak") + boks(180, 20, "Vurder") + boks(350, 20, "Fatt vedtak");

  it("a flow joined by plain <path>s is a flow — no marker-end needed", () => {
    const r = checkFigureMotion(svg(`${treIRad}<path d="M130 40 H180"/><path d="M300 40 H350"/>`));
    expect(r.sequence).toBe(true);
    expect(r.issues.map((i) => i.kind)).toEqual(["sequence_not_animated"]);
  });

  it("relative path commands and polylines join boxes too", () => {
    expect(checkFigureMotion(svg(`${treIRad}<path d="m130 40 l50 0"/><polyline points="300,40 325,40 350,40"/>`)).sequence).toBe(true);
  });

  it("a column of joined boxes is a flow as well", () => {
    const kolonne = boks(10, 10, "Først") + boks(10, 100, "Så") + boks(10, 190, "Til slutt");
    const r = checkFigureMotion(svg(`${kolonne}<line x1="70" y1="50" x2="70" y2="100"/><line x1="70" y1="140" x2="70" y2="190"/>`));
    expect(r.sequence).toBe(true);
  });

  it("control: a hierarchy — one parent, three aligned children — is not a flow", () => {
    const tre = boks(180, 10, "Ledelse") + boks(10, 140, "Salg") + boks(180, 140, "Drift") + boks(350, 140, "HR")
      + `<line x1="240" y1="50" x2="70" y2="140"/><line x1="240" y1="50" x2="240" y2="140"/><line x1="240" y1="50" x2="410" y2="140"/>`;
    const r = checkFigureMotion(svg(tre));
    expect(r.sequence).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("control: the same hierarchy drawn as ONE path with three subpaths is still not a flow", () => {
    const tre = boks(180, 10, "Ledelse") + boks(10, 140, "Salg") + boks(180, 140, "Drift") + boks(350, 140, "HR")
      + `<path d="M240 50 L70 140 M240 50 L240 140 M240 50 L410 140"/>`;
    expect(checkFigureMotion(svg(tre)).sequence).toBe(false);
  });

  it("control: ONE continuous path child → parent → child → parent → child joins no child to the next", () => {
    const tre = boks(180, 10, "Ledelse") + boks(10, 140, "Salg") + boks(180, 140, "Drift") + boks(350, 140, "HR")
      + `<path d="M70 140 L240 50 L240 140 L240 50 L410 140"/>`;
    expect(checkFigureMotion(svg(tre)).sequence).toBe(false);
  });

  it("an elbow connector — out, across, in — still joins two boxes directly", () => {
    const vinkel = `<polyline points="130,40 155,40 155,10 180,10 180,40"/><polyline points="300,40 325,40 325,70 350,70 350,40"/>`;
    expect(checkFigureMotion(svg(treIRad + vinkel)).sequence).toBe(true);
  });

  it("labels placed by <tspan x y> count: a long label broken into lines is still a label", () => {
    const boksTspan = (x: number, y: number, etikett: string) =>
      `<rect x="${x}" y="${y}" width="120" height="40"/><text text-anchor="middle"><tspan x="${x + 60}" y="${y + 18}">${etikett}</tspan><tspan x="${x + 60}" dy="14">linje to</tspan></text>`;
    const flyt = boksTspan(10, 20, "Motta") + boksTspan(180, 20, "Vurder") + boksTspan(350, 20, "Vedta")
      + `<path d="M130 40 H180"/><path d="M300 40 H350"/>`;
    const r = checkFigureMotion(svg(flyt));
    expect(r.sequence).toBe(true);
    expect(r.issues.map((i) => i.kind)).toEqual(["sequence_not_animated"]);
  });

  it("control: one path of separate tick marks, one under each box, joins nothing", () => {
    // Tre delbaner i ÉN path. Leses de som én sammenhengende strek, går den «fra boks til boks».
    const merker = `<path d="M70 60 V70 M240 60 V70 M410 60 V70"/>`;
    expect(checkFigureMotion(svg(treIRad + merker)).sequence).toBe(false);
  });

  it("control: three boxes in a row with lines that join nothing are not a flow", () => {
    const r = checkFigureMotion(svg(`${treIRad}<line x1="10" y1="75" x2="470" y2="75"/><line x1="10" y1="78" x2="470" y2="78"/>`));
    expect(r.sequence).toBe(false);
  });

  it("control: only the first two boxes joined — a pair, not a sequence", () => {
    expect(checkFigureMotion(svg(`${treIRad}<line x1="130" y1="40" x2="180" y2="40"/><line x1="10" y1="75" x2="100" y2="75"/>`)).sequence).toBe(false);
  });

  it("<animateMotion> is rejected: it survives the sanitizer, but CSS cannot switch it off", () => {
    const medSmil = goodStyle + threeSteps.replace('<rect class="steg s1" x="10" y="20" width="120" height="40" rx="6"/>',
      '<rect class="steg s1" x="10" y="20" width="120" height="40" rx="6"><animateMotion dur="1s" repeatCount="1" path="M0,0 L100,0"/></rect>');
    expect(medSmil).toContain("<animateMotion");
    // Én melding, og den som sier hva som er galt — ikke «ukjent element» på toppen.
    expect(checkFigureMotion(svg(medSmil)).issues.map((i) => i.kind)).toEqual(["not_css_only"]);
    // …og den teller ikke som animasjon: en flyt som BARE har den, er fortsatt stillestående.
    const bare = threeSteps + `<circle r="4"><animateMotion dur="1s" path="M0,0 L100,0"/></circle>`;
    const r = checkFigureMotion(svg(bare));
    expect(r.animated).toBe(false);
    expect(r.issues.map((i) => i.kind)).toEqual(["not_css_only", "sequence_not_animated"]);
  });
});

describe("the measured platform facts the rule rests on (#1073)", () => {
  it("sanitizeSvg keeps CSS keyframes, animation and the reduced-motion rule", () => {
    const clean = sanitizeSvg(svg(goodStyle + threeSteps));
    expect(clean).toContain("@keyframes lys");
    expect(clean).toContain("animation: lys 1.4s");
    expect(clean).toContain("prefers-reduced-motion");
    expect(checkFigureMotion(clean).ok).toBe(true);
  });

  // #1073 punkt 3: en språkvariant lages ved å bytte etikettene. Stilblokka og stegklassene må stå
  // urørt — ellers ville den norske figuren bevege seg og den engelske stå stille, uten at noen så det.
  it("a locale variant keeps the motion: only the labels change", () => {
    const mal = templateFromDoc();
    // Bare etikettene tilbys for oversettelse — ikke teksten i <style>.
    expect(extractSvgTexts(mal)).toEqual(["Steg 1", "Steg 2", "Steg 3"]);

    const engelsk = applySvgTextTranslations(mal, { "Steg 1": "Step 1", "Steg 2": "Step 2", "Steg 3": "Step 3" });
    expect(engelsk).toContain("Step 2");
    expect(engelsk).not.toContain("Steg 2");
    expect(checkFigureMotion(engelsk)).toMatchObject({ ok: true, animated: true, sequence: true });
    expect(checkFigureMotion(engelsk).totalSeconds).toBe(checkFigureMotion(mal).totalSeconds);
  });

  it("sanitizeSvg strips <animate> and <set> — which is why the check rejects them", () => {
    const clean = sanitizeSvg(svg(`<circle r="5"><animate attributeName="r" values="5;10" dur="1s"/></circle><g><set attributeName="opacity" to="0"/></g>`));
    expect(clean).not.toContain("<animate ");
    expect(clean).not.toContain("<set");
  });
});

describe("the animated flow template in figure-design.md (#1073)", () => {
  it("passes the motion check, the fit check, and survives the sanitizer unchanged in substance", () => {
    const template = templateFromDoc();
    expect(checkFigureMotion(template)).toMatchObject({ ok: true, animated: true, sequence: true });
    expect(checkFigureFit(template).issues).toEqual([]);
    const clean = sanitizeSvg(template);
    expect(checkFigureMotion(clean).ok).toBe(true);
  });

  it("every skeleton in figure-design.md passes the motion check — the doc cannot teach a still flow", () => {
    const doc = readFileSync("skills/a2-authoring-api/references/figure-design.md", "utf8");
    const skeletons = [...doc.matchAll(/```svg\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
    for (const s of skeletons) expect(checkFigureMotion(s).issues).toEqual([]);
  });
});
