// Maskotpakken (doc/design/MASKOTPAKKE.md): alt som hører til maskoten — bilder, humørlinjer, bildetekster i e-post,
// figuren på fremdriftslinja og faviconet — ligger i ÉN mappe, `mascots/<navn>/`, beskrevet av `mascot.json`. Valget
// står i `mascot.config.json` i repoet, så app og worker (samme pakkefil i utrullingen) alltid har samme maskot.
//
// Felles for alle pakker, og derfor IKKE her: regelen for humøret (gamification/boatMood.ts), grensen på 30 % for
// figurens to tilstander (course-progress-boat.js), og at e-post bruker innebygde bilder (illustratedEmail.ts).
//
// Pakken leses én gang, første gang noen spør, og endres bare ved en ny utrulling. Lesingen sjekker det koden trenger
// for å lese pakken trygt: at alle humør, e-postsituasjoner, tekster og figurtilstander finnes på alle tre språk, og at
// filene den viser til ligger inne i pakkemappa. Mangler noe, kastes en feil som lister alt som mangler, og appen
// starter ikke. Den fulle sjekken (bildestørrelse, SVG uten skript, én sjekk over alle pakker i CI) er skive 2.
//
// ⚠️ Fila importerer bare det den må, så testserveren for e2e (scripts/test/admin-content-static-server.mjs) kan lese
// pakken på samme måte uten å laste resten av appen.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { BOAT_MOODS, type BoatMood } from "../gamification/moods.js";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../../i18n/locale.js";

/** Versjonen av formatet i `mascot.json` som denne koden leser. */
export const MASCOT_PACK_VERSION = 1;

/** Situasjonene der en e-post har et bilde øverst (#1141). Nøklene i `EMAIL_ILLUSTRATIONS`. */
export const MASCOT_EMAIL_SITUATIONS = [
  "courseNewVersion",
  "courseAssigned",
  "dueSoon",
  "overdue",
  "passed",
  "notPassed",
  "underReview",
  "appeal",
  "discussion",
] as const;
export type MascotEmailSituation = (typeof MASCOT_EMAIL_SITUATIONS)[number];

/** Hele setninger i e-postene som nevner maskoten. `{course}` og `{major}` fylles inn. */
export const MASCOT_EMAIL_TEXTS = ["courseNewVersionIntro"] as const;
export type MascotEmailText = (typeof MASCOT_EMAIL_TEXTS)[number];

/** Figurens tilstander på fremdriftslinja: flatt seil (under 30 %), fullt seil, og feiringen når kurset fullføres. */
export const MASCOT_FIGURE_STATES = ["flatt", "fullt", "feiring"] as const;
export type MascotFigureState = (typeof MASCOT_FIGURE_STATES)[number];
/** Tilstandene med fartsstriper bak figuren. */
const STRIPED_FIGURE_STATES = ["flatt", "fullt"] as const;

/** Faviconet: adressen sidene lenker til (fast, i public/*.html) → nøkkelen i `mascot.json`. */
export const MASCOT_FAVICON_URLS = {
  "favicon.svg": "svg",
  "favicon-32.png": "png32",
  "favicon-16.png": "png16",
  "apple-touch-icon-180.png": "appleTouchIcon",
} as const;
type FaviconKey = (typeof MASCOT_FAVICON_URLS)[keyof typeof MASCOT_FAVICON_URLS];

export type Localized = Record<SupportedLocale, string>;

export type MascotPack = {
  /** Mappenavnet, og navnet i bildeadressene (`/static/mascot/<id>/...`). */
  id: string;
  /** Mappa på disk. */
  dir: string;
  version: number;
  name: Localized;
  /** Bildet er et filnavn i `images/`. */
  moods: Record<BoatMood, { image: string; line: Localized }>;
  emails: Record<MascotEmailSituation, { image: string; alt: Localized }>;
  emailTexts: Record<MascotEmailText, Localized>;
  figure: {
    /** Hvilken side linja fylles fra. Bare `fromRight` (seilbåten) er bygget. */
    direction: "fromRight";
    /** Stien i pakken til SVG-en for hver tilstand. */
    states: Record<MascotFigureState, string>;
    css: string;
    /** Figurens bredde på linja. */
    widthPx: number;
    /** Fra figurens venstrekant til punktet som står på grensa mellom tomt og fylt. */
    sternPx: number;
    /** Hvor langt til høyre fra figurens venstrekant fartsstripene rekker. */
    stripeReachPx: Record<(typeof STRIPED_FIGURE_STATES)[number], number>;
    /** Hvor lenge feiringen varer (samme som animasjonen i figure.css). */
    celebrationMs: number;
  };
  favicon: Record<FaviconKey, string>;
};

const PACK_ID = /^[a-z0-9][a-z0-9-]*$/;
const IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.jpe?g$/i;

class MascotPackError extends Error {
  constructor(where: string, problems: string[]) {
    super(`Maskotpakken ${where} kan ikke leses:\n  - ${problems.join("\n  - ")}`);
    this.name = "MascotPackError";
  }
}

/** Leser og sjekker pakken som er valgt i `mascot.config.json` under `root`. */
export function loadMascotPack(root: string = process.cwd()): MascotPack {
  const configPath = path.join(root, "mascot.config.json");
  const config = readJson(configPath, "mascot.config.json") as { mascot?: unknown } | null;
  const id = config?.mascot;
  if (typeof id !== "string" || !PACK_ID.test(id)) {
    throw new MascotPackError("i mascot.config.json", [`«mascot» må være navnet på en mappe i mascots/ (små bokstaver, tall og bindestrek), fant ${JSON.stringify(id)}`]);
  }
  const dir = path.join(root, "mascots", id);
  const raw = (readJson(path.join(dir, "mascot.json"), `mascots/${id}/mascot.json`) ?? {}) as Record<string, any>;
  const problems: string[] = [];

  const localized = (value: any, where: string): Localized => {
    const out = {} as Localized;
    for (const locale of SUPPORTED_LOCALES) {
      const text = value?.[locale];
      if (typeof text !== "string" || !text.trim()) problems.push(`${where}.${locale} mangler`);
      out[locale] = typeof text === "string" ? text : "";
    }
    return out;
  };
  const fileInPack = (rel: any, where: string): string => {
    if (typeof rel !== "string" || !rel) {
      problems.push(`${where} mangler`);
      return "";
    }
    const full = path.resolve(dir, rel);
    if (!full.startsWith(dir + path.sep)) problems.push(`${where} (${rel}) ligger utenfor pakkemappa`);
    else if (!existsSync(full) || !statSync(full).isFile()) problems.push(`${where} (${rel}) finnes ikke`);
    return rel;
  };
  const image = (file: any, where: string): string => {
    if (typeof file !== "string" || !IMAGE_FILE.test(file)) {
      problems.push(`${where} må være navnet på en JPEG-fil i images/, fant ${JSON.stringify(file)}`);
      return "";
    }
    fileInPack(`images/${file}`, where);
    return file;
  };
  const number = (value: any, where: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) problems.push(`${where} må være et tall`);
    return Number(value);
  };

  if (raw.version !== MASCOT_PACK_VERSION) problems.push(`version er ${JSON.stringify(raw.version)}, koden leser versjon ${MASCOT_PACK_VERSION}`);

  const moods = {} as MascotPack["moods"];
  for (const mood of BOAT_MOODS) {
    moods[mood] = { image: image(raw.moods?.[mood]?.image, `moods.${mood}.image`), line: localized(raw.moods?.[mood]?.line, `moods.${mood}.line`) };
  }
  const emails = {} as MascotPack["emails"];
  for (const situation of MASCOT_EMAIL_SITUATIONS) {
    emails[situation] = { image: image(raw.emails?.[situation]?.image, `emails.${situation}.image`), alt: localized(raw.emails?.[situation]?.alt, `emails.${situation}.alt`) };
  }
  const emailTexts = {} as MascotPack["emailTexts"];
  for (const key of MASCOT_EMAIL_TEXTS) emailTexts[key] = localized(raw.emailTexts?.[key], `emailTexts.${key}`);

  const figure = raw.figure ?? {};
  if (figure.direction !== "fromRight") problems.push(`figure.direction er ${JSON.stringify(figure.direction)}; bare "fromRight" er bygget`);
  const states = {} as MascotPack["figure"]["states"];
  for (const state of MASCOT_FIGURE_STATES) states[state] = fileInPack(figure.states?.[state], `figure.states.${state}`);
  const stripeReachPx = {} as MascotPack["figure"]["stripeReachPx"];
  for (const state of STRIPED_FIGURE_STATES) stripeReachPx[state] = number(figure.stripeReachPx?.[state], `figure.stripeReachPx.${state}`);

  const favicon = {} as MascotPack["favicon"];
  for (const key of Object.values(MASCOT_FAVICON_URLS)) favicon[key] = fileInPack(raw.favicon?.[key], `favicon.${key}`);

  const pack: MascotPack = {
    id,
    dir,
    version: raw.version,
    name: localized(raw.name, "name"),
    moods,
    emails,
    emailTexts,
    figure: {
      direction: "fromRight",
      states,
      css: fileInPack(figure.css, "figure.css"),
      widthPx: number(figure.widthPx, "figure.widthPx"),
      sternPx: number(figure.sternPx, "figure.sternPx"),
      stripeReachPx,
      celebrationMs: number(figure.celebrationMs, "figure.celebrationMs"),
    },
    favicon,
  };
  if (problems.length > 0) throw new MascotPackError(`«${id}»`, problems);
  return pack;
}

function readJson(file: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new MascotPackError(label, ["fila finnes ikke"]);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new MascotPackError(label, [`ikke gyldig JSON: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

let activePack: MascotPack | null = null;

/** Pakken appen bruker: valgt i `mascot.config.json`, lest én gang. */
export function activeMascot(): MascotPack {
  activePack ??= loadMascotPack();
  return activePack;
}

/** Stien til et bilde i pakken (`images/`). */
export function mascotImagePath(pack: MascotPack, file: string): string {
  return path.join(pack.dir, "images", file);
}

/** En hel setning fra pakken, på mottakerens språk. */
export function mascotEmailText(key: MascotEmailText, locale: SupportedLocale): string {
  return activeMascot().emailTexts[key][locale];
}

// ── Det nettleseren får ──────────────────────────────────────────────────────────────────────────────────────────────
//
// Bildeadressene har pakkenavnet i seg (`/static/mascot/seilbat/...`), så en nettleser aldri viser et bilde fra
// forrige pakke. `/static/boat/` står som alias (skive 1), så en åpen, gammel fane ikke får ødelagte bilder.
//
// To ting lages av pakken, og har derfor faste adresser: humørene for profilen (JSON, med linjene på alle tre språk,
// så et språkbytte gir riktig linje uten ny henting) og figuren for «Mine kurs» (en JS-modul, så tegningen er synkron).

export const MASCOT_MOODS_URL = "/static/mascot/moods.json";
export const MASCOT_FIGURE_MODULE_URL = "/static/mascot/figure.js";
export const MASCOT_FIGURE_CSS_URL = "/static/mascot/figure.css";

/** Adressen til en fil i pakken. */
export function mascotFileUrl(pack: MascotPack, rel: string): string {
  return `/static/mascot/${pack.id}/${rel}`;
}

/** Humørene for profilen: bildet (adresse) og linja på alle tre språk. */
export function mascotMoodsJson(pack: MascotPack): string {
  const moods = Object.fromEntries(
    BOAT_MOODS.map((mood) => [mood, { image: mascotFileUrl(pack, `images/${pack.moods[mood].image}`), line: pack.moods[mood].line }]),
  );
  return `${JSON.stringify({ mascot: pack.id, moods })}\n`;
}

/** Figuren for fremdriftslinja som en JS-modul: SVG-en for hver tilstand og målene. */
export function mascotFigureModule(pack: MascotPack): string {
  const svg = Object.fromEntries(
    MASCOT_FIGURE_STATES.map((state) => [state, readFileSync(path.join(pack.dir, pack.figure.states[state]), "utf8").replace(/\r\n/g, "\n").trim()]),
  );
  const { direction, widthPx, sternPx, stripeReachPx, celebrationMs } = pack.figure;
  const figure = { mascot: pack.id, direction, widthPx, sternPx, stripeReachPx, celebrationMs, svg };
  return `// Laget av serveren fra maskotpakken «${pack.id}» (mascots/${pack.id}/mascot.json).\nexport const FIGURE = ${JSON.stringify(figure)};\n`;
}

const generatedByPack = new WeakMap<MascotPack, { moods: string; figure: string }>();

/** De to lages én gang per pakke: pakken endres bare ved en ny utrulling. */
function generated(pack: MascotPack) {
  let bodies = generatedByPack.get(pack);
  if (!bodies) {
    bodies = { moods: mascotMoodsJson(pack), figure: mascotFigureModule(pack) };
    generatedByPack.set(pack, bodies);
  }
  return bodies;
}

export type MascotResponse =
  | { kind: "body"; contentType: string; body: string }
  | { kind: "file"; file: string };

/**
 * Hva en adresse under `/static` gir fra pakken, eller null når den ikke hører til pakken. Brukes av appen
 * (routes/mascot.ts) og av testserveren for e2e, så begge svarer likt.
 */
export function resolveMascotRequest(pack: MascotPack, requestPath: string): MascotResponse | null {
  if (requestPath === MASCOT_MOODS_URL) return { kind: "body", contentType: "application/json; charset=utf-8", body: generated(pack).moods };
  if (requestPath === MASCOT_FIGURE_MODULE_URL) return { kind: "body", contentType: "text/javascript; charset=utf-8", body: generated(pack).figure };
  if (requestPath === MASCOT_FIGURE_CSS_URL) return { kind: "file", file: path.join(pack.dir, pack.figure.css) };

  const favicon = requestPath.startsWith("/static/") ? MASCOT_FAVICON_URLS[requestPath.slice("/static/".length) as keyof typeof MASCOT_FAVICON_URLS] : undefined;
  if (favicon) return { kind: "file", file: path.join(pack.dir, pack.favicon[favicon]) };

  const packPrefix = `/static/mascot/${pack.id}/`;
  if (requestPath.startsWith(packPrefix)) return fileUnder(pack.dir, requestPath.slice(packPrefix.length));
  if (requestPath.startsWith("/static/boat/")) return fileUnder(path.join(pack.dir, "images"), requestPath.slice("/static/boat/".length));
  return null;
}

/** En fil under `base`, bare når hver del av stien er et vanlig navn (ikke `..`, ikke skjult) og fila finnes. */
function fileUnder(base: string, rest: string): MascotResponse | null {
  let parts: string[];
  try {
    parts = rest.split("/").map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  if (parts.some((part) => !part || part.startsWith(".") || /[\\/\0]/.test(part))) return null;
  const file = path.join(base, ...parts);
  if (!file.startsWith(base + path.sep) || !existsSync(file) || !statSync(file).isFile()) return null;
  return { kind: "file", file };
}
