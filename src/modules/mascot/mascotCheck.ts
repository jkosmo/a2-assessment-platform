// Den fulle sjekken av en maskotpakke (doc/design/MASKOTPAKKE.md, «Sjekken»). Den kjører to steder:
//   - i CI, over ALLE pakker i mascots/ (`npm run mascot:check`, kalt fra test/unit/mascot-check.test.ts), med alle
//     feil listet på én gang, så den som lager en pakke ser alt som må rettes i én runde;
//   - ved oppstart av web og worker (index.ts), på pakken som er valgt, som sikkerhetsnett. En feil stopper oppstarten.
//
// Lesingen (mascotPack.ts) sjekker alt koden trenger for å lese pakken: nøklene, de tre språkene, at filene finnes og
// ligger i pakkemappa, og versjonen. Her kommer resten:
//   - pakken har ingen humør, e-postsituasjoner, tekster eller figurtilstander koden ikke kjenner;
//   - filene pakken viser til, ligger i pakkemappa også etter at snarveier er fulgt;
//   - bildene er JPEG, 600 × 200 og under 30 kB (bredde og høyde fra JPEG-headeren);
//   - ingen tekst har noe som ligner en adresse (`LINK_LIKE`, samme regel som e-postmalen; en bildetekst med «www.»
//     ville ellers stoppet e-posten);
//   - SVG-ene har ikke `<script>`, `on…`-attributter, `<foreignObject>` eller referanser ut av fila, og figure.css
//     henter ingenting utenfra;
//   - feiringen varer like lenge i mascot.json (`figure.celebrationMs`) som animasjonen i figure.css.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { BOAT_MOODS } from "../gamification/moods.js";
import { SUPPORTED_LOCALES } from "../../i18n/locale.js";
import { LINK_LIKE } from "../certification/linkLike.js";
import {
  activeMascot,
  MASCOT_EMAIL_SITUATIONS,
  MASCOT_EMAIL_TEXTS,
  MASCOT_FAVICON_URLS,
  MASCOT_FIGURE_STATES,
  MascotPackError,
  PACK_ID,
  readMascotPack,
  selectedMascotId,
  STRIPED_FIGURE_STATES,
  type MascotPack,
} from "./mascotPack.js";

/** Kravene til bildene: e-postmalen tegner dem i 600 × 200, og e-posten skal være lett. */
export const MASCOT_IMAGE = { width: 600, height: 200, maxBytes: 30 * 1024 } as const;

/**
 * Klassen course-progress-boat.js setter på figuren når et kurs fullføres. Animasjonen på den skal vare
 * `figure.celebrationMs`: koden fjerner figuren etter så lang tid, også om animasjonen ikke melder at den er ferdig.
 */
export const MASCOT_CELEBRATION_CLASS = "course-boat--leaving";
const CELEBRATION_SELECTOR = /\.course-boat--leaving(?![\w-])/;

/** Nøklene `mascot.json` kan ha, på toppen og i `figure`. */
const TOP_KEYS = ["version", "name", "moods", "emails", "emailTexts", "figure", "favicon"];
const FIGURE_KEYS = ["direction", "states", "css", "widthPx", "sternPx", "stripeReachPx", "celebrationMs"];

/** Alt som er galt med pakken `id` i `root/mascots/`. Tom liste: pakken kan brukes. */
export function checkMascotPack(root: string, id: string): string[] {
  let read: ReturnType<typeof readMascotPack>;
  try {
    read = readMascotPack(root, id);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const { pack, raw } = read;
  const problems = [...read.problems];

  checkKnownKeys(raw, problems);
  checkFilesStayInPack(pack, problems);
  checkImages(pack, problems);
  checkTexts(pack, problems);
  checkSvgFiles(pack.dir, problems);
  checkFigureCss(pack, problems);
  return problems;
}

export type MascotCheckReport = {
  /** Feil som ikke hører til én pakke: valget i mascot.config.json, mappenavn. */
  general: string[];
  packs: Array<{ id: string; problems: string[] }>;
};

/** Sjekker alle pakker i `root/mascots/` og valget i `mascot.config.json`. */
export function checkAllMascotPacks(root: string): MascotCheckReport {
  const general: string[] = [];
  const mascotsDir = path.join(root, "mascots");
  let entries: string[] = [];
  try {
    entries = readdirSync(mascotsDir)
      .filter((name) => statSync(path.join(mascotsDir, name)).isDirectory())
      .sort();
  } catch {
    general.push(`fant ingen mappe mascots/ i ${root}`);
  }
  const ids = entries.filter((name) => {
    if (PACK_ID.test(name)) return true;
    general.push(`mascots/${name}: mappenavnet må være små bokstaver, tall og bindestrek (det står i bildeadressene)`);
    return false;
  });
  try {
    const selected = selectedMascotId(root);
    if (!ids.includes(selected)) general.push(`mascot.config.json velger «${selected}», men mascots/${selected}/ finnes ikke`);
  } catch (error) {
    general.push(error instanceof Error ? error.message : String(error));
  }
  if (entries.length === 0 && general.length === 0) general.push("mascots/ er tom");
  return { general, packs: ids.map((id) => ({ id, problems: checkMascotPack(root, id) })) };
}

/** Rapporten som tekst: alle feil, pakke for pakke. */
export function formatMascotCheckReport(report: MascotCheckReport): string {
  const lines: string[] = [];
  for (const problem of report.general) lines.push(`✗ ${problem}`);
  for (const { id, problems } of report.packs) {
    if (problems.length === 0) {
      lines.push(`✓ ${id}`);
      continue;
    }
    lines.push(`✗ ${id}: ${problems.length} feil`);
    for (const problem of problems) lines.push(`    - ${problem.replace(/\n/g, "\n      ")}`);
  }
  return lines.join("\n");
}

export function mascotCheckPassed(report: MascotCheckReport): boolean {
  return report.general.length === 0 && report.packs.every((pack) => pack.problems.length === 0);
}

/**
 * Ved oppstart av web og worker (index.ts): pakken appen bruker, lest og sjekket. Kaster en feil som lister alt som er
 * galt, så oppstarten stopper med den. Feilen skal aldri komme i drift: CI har sjekket den samme pakken.
 */
export function assertActiveMascotPack(): MascotPack {
  const pack = activeMascot();
  const root = path.resolve(pack.dir, "..", "..");
  const problems = checkMascotPack(root, pack.id);
  if (problems.length > 0) throw new MascotPackError(`«${pack.id}»`, problems);
  return pack;
}

// ── Nøklene ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function checkKnownKeys(raw: Record<string, any>, problems: string[]) {
  const unknown = (value: unknown, known: readonly string[], where: string, what: string) => {
    if (!value || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if (!known.includes(key)) problems.push(`${where}${key} ${what} koden ikke kjenner (koden har: ${known.join(", ")})`);
    }
  };
  unknown(raw, TOP_KEYS, "", "er en nøkkel");
  unknown(raw.moods, BOAT_MOODS, "moods.", "er et humør");
  unknown(raw.emails, MASCOT_EMAIL_SITUATIONS, "emails.", "er en e-postsituasjon");
  unknown(raw.emailTexts, MASCOT_EMAIL_TEXTS, "emailTexts.", "er en e-posttekst");
  unknown(raw.figure, FIGURE_KEYS, "figure.", "er en nøkkel");
  unknown(raw.figure?.states, MASCOT_FIGURE_STATES, "figure.states.", "er en figurtilstand");
  unknown(raw.figure?.stripeReachPx, STRIPED_FIGURE_STATES, "figure.stripeReachPx.", "er en figurtilstand med fartsstriper");
  unknown(raw.favicon, Object.values(MASCOT_FAVICON_URLS), "favicon.", "er et ikon");

  const locales = (value: unknown, where: string) => unknown(value, SUPPORTED_LOCALES, `${where}.`, "er et språk");
  locales(raw.name, "name");
  for (const mood of BOAT_MOODS) locales(raw.moods?.[mood]?.line, `moods.${mood}.line`);
  for (const situation of MASCOT_EMAIL_SITUATIONS) locales(raw.emails?.[situation]?.alt, `emails.${situation}.alt`);
  for (const key of MASCOT_EMAIL_TEXTS) locales(raw.emailTexts?.[key], `emailTexts.${key}`);
}

// ── Filene ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Filene pakken viser til, relativt til pakkemappa, med nøkkelen de står under. Tomme (manglende) er utelatt. */
function referencedFiles(pack: MascotPack): Array<{ rel: string; where: string }> {
  const files: Array<{ rel: string; where: string }> = [];
  for (const mood of BOAT_MOODS) files.push({ rel: pack.moods[mood].image && `images/${pack.moods[mood].image}`, where: `moods.${mood}.image` });
  for (const situation of MASCOT_EMAIL_SITUATIONS) {
    files.push({ rel: pack.emails[situation].image && `images/${pack.emails[situation].image}`, where: `emails.${situation}.image` });
  }
  for (const state of MASCOT_FIGURE_STATES) files.push({ rel: pack.figure.states[state], where: `figure.states.${state}` });
  files.push({ rel: pack.figure.css, where: "figure.css" });
  for (const [key, rel] of Object.entries(pack.favicon)) files.push({ rel, where: `favicon.${key}` });
  return files.filter((file) => file.rel);
}

/** Lesingen sjekker stien; her følges snarveier også, så en lenke i pakken ikke kan peke ut av den. */
function checkFilesStayInPack(pack: MascotPack, problems: string[]) {
  let realDir: string;
  try {
    realDir = realpathSync(pack.dir);
  } catch {
    return;
  }
  for (const { rel, where } of referencedFiles(pack)) {
    try {
      const real = realpathSync(path.resolve(pack.dir, rel));
      if (!real.startsWith(realDir + path.sep)) problems.push(`${where} (${rel}) peker ut av pakkemappa`);
    } catch {
      // Finnes ikke: lesingen har alt sagt fra.
    }
  }
}

// ── Bildene ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function checkImages(pack: MascotPack, problems: string[]) {
  const images = new Map<string, string[]>();
  for (const { rel, where } of referencedFiles(pack)) {
    if (!rel.startsWith("images/")) continue;
    images.set(rel, [...(images.get(rel) ?? []), where]);
  }
  for (const [rel, where] of images) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(pack.dir, rel));
    } catch {
      continue; // Finnes ikke: lesingen har alt sagt fra.
    }
    const label = `${rel} (${where.join(", ")})`;
    if (bytes.length >= MASCOT_IMAGE.maxBytes) {
      problems.push(`${label} er ${formatKb(bytes.length)}; bildene skal være under ${formatKb(MASCOT_IMAGE.maxBytes)}`);
    }
    const size = jpegSize(bytes);
    if (!size) {
      problems.push(`${label} er ikke en JPEG-fil som kan leses`);
    } else if (size.width !== MASCOT_IMAGE.width || size.height !== MASCOT_IMAGE.height) {
      problems.push(`${label} er ${size.width} × ${size.height}; bildene skal være ${MASCOT_IMAGE.width} × ${MASCOT_IMAGE.height}`);
    }
  }
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * Bredde og høyde fra JPEG-headeren: første SOF-markør (bilderammen). Null når fila ikke er en JPEG, eller headeren
 * slutter før rammen.
 */
export function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // Fyllbyte foran en markør.
      continue;
    }
    // Markører uten lengde: TEM og RST0–7.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Bildedata eller slutt før noen ramme.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = bytes.readUInt16BE(offset + 2);
    // SOF0–SOF15, unntatt DHT (C4), JPG (C8) og DAC (CC), som deler nummerområdet.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (offset + 9 > bytes.length) return null;
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

// ── Tekstene ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function checkTexts(pack: MascotPack, problems: string[]) {
  const texts: Array<[string, Record<string, string>]> = [["name", pack.name]];
  for (const mood of BOAT_MOODS) texts.push([`moods.${mood}.line`, pack.moods[mood].line]);
  for (const situation of MASCOT_EMAIL_SITUATIONS) texts.push([`emails.${situation}.alt`, pack.emails[situation].alt]);
  for (const key of MASCOT_EMAIL_TEXTS) texts.push([`emailTexts.${key}`, pack.emailTexts[key]]);
  for (const [where, localized] of texts) {
    for (const locale of SUPPORTED_LOCALES) {
      const text = localized[locale] ?? "";
      if (LINK_LIKE.test(text)) {
        problems.push(`${where}.${locale} har noe som ligner en adresse (http:, https: eller www.), og e-poster kan ikke ha det: «${text}»`);
      }
    }
  }
}

// ── SVG og CSS ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Det som ikke kan stå i en SVG som settes rett inn i siden. */
const SVG_FORBIDDEN: Array<{ pattern: RegExp; what: string }> = [
  { pattern: /<script\b/gi, what: "<script>" },
  { pattern: /\son[a-z]+\s*=/gi, what: "et on…-attributt (kjører skript)" },
  { pattern: /<foreignObject\b/gi, what: "<foreignObject> (HTML inne i SVG)" },
];
const HREF = /(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
const CSS_IMPORT = /@import\b/gi;

/** Referanser ut av fila: alt som ikke er `#id` i samme fil. */
function externalReferences(text: string): string[] {
  const found: string[] = [];
  for (const pattern of [HREF, CSS_URL]) {
    for (const match of text.matchAll(pattern)) {
      const target = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      if (!target.startsWith("#")) found.push(match[0]);
    }
  }
  for (const match of text.matchAll(CSS_IMPORT)) found.push(match[0]);
  return found;
}

/** Alle SVG-filer i pakkemappa, også de pakken ikke viser til: alt i mappa kan hentes fra /static/mascot/<navn>/. */
function svgFiles(dir: string, rel = ""): string[] {
  let names: string[];
  try {
    names = readdirSync(path.join(dir, rel));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const child = rel ? `${rel}/${name}` : name;
    const full = path.join(dir, child);
    if (statSync(full).isDirectory()) return svgFiles(dir, child);
    return name.toLowerCase().endsWith(".svg") ? [child] : [];
  });
}

function checkSvgFiles(dir: string, problems: string[]) {
  for (const rel of svgFiles(dir)) {
    const text = readFileSync(path.join(dir, rel), "utf8");
    for (const { pattern, what } of SVG_FORBIDDEN) {
      if (text.match(pattern)) problems.push(`${rel} har ${what}`);
    }
    for (const reference of externalReferences(text)) problems.push(`${rel} henter noe utenfra: ${reference}`);
  }
}

function checkFigureCss(pack: MascotPack, problems: string[]) {
  if (!pack.figure.css) return;
  let css: string;
  try {
    css = readFileSync(path.join(pack.dir, pack.figure.css), "utf8");
  } catch {
    return; // Finnes ikke: lesingen har alt sagt fra.
  }
  for (const reference of externalReferences(css)) problems.push(`${pack.figure.css} henter noe utenfra: ${reference}`);

  const durations = celebrationDurationsMs(css);
  const expected = pack.figure.celebrationMs;
  if (durations.length === 0) {
    problems.push(
      `${pack.figure.css} har ingen animasjon med varighet på .${MASCOT_CELEBRATION_CLASS} (feiringen); den skal vare figure.celebrationMs (${expected} ms)`,
    );
    return;
  }
  for (const ms of durations) {
    if (Number.isFinite(expected) && ms !== expected) {
      problems.push(`figure.celebrationMs er ${expected} ms, men animasjonen på .${MASCOT_CELEBRATION_CLASS} i ${pack.figure.css} varer ${ms} ms`);
    }
  }
}

/**
 * Varigheten til hver animasjon på feiringsklassen, i ms. Regler uten varighet (som `animation: none` for redusert
 * bevegelse) telles ikke. I `animation`-forkortelsen er første tid varigheten; den andre er forsinkelsen.
 */
export function celebrationDurationsMs(css: string): number[] {
  const durations: number[] = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of withoutComments.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectors = rule[1]!.split(",");
    if (!selectors.some((selector) => CELEBRATION_SELECTOR.test(selector))) continue;
    for (const declaration of rule[2]!.matchAll(/(?:^|;)\s*animation(?:-duration)?\s*:\s*([^;]+)/g)) {
      const time = /(?:^|[\s,])(\d*\.?\d+)(ms|s)(?![\w-])/i.exec(declaration[1]!);
      if (time) durations.push(Math.round(Number(time[1]) * (time[2]!.toLowerCase() === "s" ? 1000 : 1)));
    }
  }
  return durations;
}
