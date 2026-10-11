// Ikonbiblioteket plattformen serverer selv (Lucide, ISC). Et ikon i seksjonstekst skrives
// `![](icon:<navn>)`; navnene er Lucides egne. Biblioteket er sjekket inn som én fil
// (public/static/icons/lucide-icons.json, laget av scripts/icons/vendor-lucide.mjs), så verken
// utrullingen eller skillet avhenger av node_modules.
//
// Produkteier valgte ett bibliotek som standard for alle kurs — ikke bare der kilden tilfeldigvis
// har ikoner — av samme grunn som kortene i plattformens stil: ett uttrykk på tvers av kurs, og det
// virker også når kurset ikke kommer fra en presentasjon.
import { readFileSync } from "node:fs";
import path from "node:path";

type IconBundle = { name: string; version: string; license: string; icons: Record<string, string> };

/** Lucides navn: små bokstaver og tall, med bindestrek mellom. Alt annet er ikke et navn. */
export const ICON_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Fargen ikonene tegnes i: plattformens tekstfarge (`--color-text`), så de står som skrift. */
export const ICON_STROKE = "#33312b";

const BUNDLE_PATH = path.resolve(process.cwd(), "public", "static", "icons", "lucide-icons.json");

let bundle: IconBundle | null = null;
function load(): IconBundle {
  if (!bundle) bundle = JSON.parse(readFileSync(BUNDLE_PATH, "utf8")) as IconBundle;
  return bundle;
}

/** Finnes ikonet? Bare gyldige navn slås opp, så en vilkårlig streng aldri når oppslaget. */
export function hasIcon(name: string): boolean {
  return ICON_NAME_RE.test(name) && Object.hasOwn(load().icons, name);
}

/** Alle navnene, sortert — til kataloger og feilmeldinger. */
export function listIconNames(): string[] {
  return Object.keys(load().icons).sort();
}

/** Bibliotekets navn, versjon og lisens, slik de står i pakken. */
export function iconLibraryInfo(): { name: string; version: string; license: string; count: number } {
  const { name, version, license, icons } = load();
  return { name, version, license, count: Object.keys(icons).length };
}

/**
 * Hele SVG-en for ett ikon, slik ruta serverer den: 24 × 24 i egen ramme, tegnet med strek i
 * plattformens tekstfarge. `null` når ikonet ikke finnes.
 */
export function iconSvg(name: string): string | null {
  if (!hasIcon(name)) return null;
  const inner = load().icons[name]!;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${ICON_STROKE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
  );
}

/** Adressen et ikon serveres på. */
export function iconUrl(name: string): string {
  return `/static/icons/${name}.svg`;
}
