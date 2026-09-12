/**
 * #1046: inventar over brukerflatene — hvilke felles byggeklosser bruker hver skjerm, hvilke har
 * sin egen utgave, og hvilke mangler dem helt. Bare telling, ingen design.
 *
 *   npx tsx scripts/complexity/ui-inventory.ts            → skriver doc/UI_INVENTORY.md
 *   npx tsx scripts/complexity/ui-inventory.ts --check    → bare til terminalen
 *
 * Produkteierens diagnose (30.08.2026): variasjonen er lag i tid — hver forbedring landet der noen
 * tilfeldigvis jobbet. Da finnes den beste utgaven allerede (den nyeste), og jobben er å spre den,
 * ikke å tegne nytt. Derfor dateres alt: når fikk skjermen den felles byggeklossen, og når ble den
 * felles byggeklossen sist endret.
 *
 * Lesing av tabellen:
 *   «felles (2026-08-30)»  skjermen bruker den delte modulen; datoen er da den tok den i bruk
 *   «egen»                 skjermen løser det selv, med egen kode
 *   «begge»                bruker den delte, men har egne rester ved siden av
 *   «—»                    egenskapen finnes ikke på skjermen (kan være riktig — eller et hull)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");
const les = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Skjermene, med filen som bærer oppførselen.
const SKJERMER: Array<{ navn: string; fil: string; html: string }> = [
  { navn: "Deltaker: Mine kurs", fil: "public/participant.js", html: "public/participant.html" },
  { navn: "Deltaker: Fullførte", fil: "public/participant-completed.js", html: "public/participant-completed.html" },
  { navn: "Deltaker: Profil", fil: "public/profile.js", html: "public/profile.html" },
  { navn: "Kursbevis", fil: "public/certificate.js", html: "public/certificate.html" },
  { navn: "Sensor: køer", fil: "public/review.js", html: "public/review.html" },
  { navn: "Rapporter", fil: "public/results.js", html: "public/results.html" },
  { navn: "Kullstatus", fil: "public/cohort-status.js", html: "public/cohort-status.html" },
  { navn: "Forfatter: modul (samtale)", fil: "public/static/admin-content-shell.js", html: "public/admin-content.html" },
  { navn: "Forfatter: kurs", fil: "public/static/admin-content-courses.js", html: "public/admin-content-courses.html" },
  { navn: "Forfatter: seksjoner", fil: "public/static/admin-content-sections.js", html: "public/admin-content-sections.html" },
  { navn: "Forfatter: bibliotek", fil: "public/static/admin-content-library.js", html: "public/admin-content-library.html" },
  { navn: "Forfatter: klasser", fil: "public/static/admin-content-classes.js", html: "public/admin-content-classes.html" },
  { navn: "Forfatter: kalibrering", fil: "public/static/admin-content-calibration.js", html: "public/admin-content-calibration.html" },
  { navn: "Admin: plattform", fil: "public/admin-platform.js", html: "public/admin-platform.html" },
];

// Egenskapene. `felles` er den delte modulen; `egen` er mønstre som løser det samme på egen hånd.
type Egenskap = {
  navn: string;
  forklaring: string;
  felles: string; // modulnavn i /static/
  fellesTegn: RegExp; // hvordan bruk av den delte ser ut
  egenTegn: RegExp[]; // hvordan en egen utgave ser ut
  fellesVinner?: boolean; // når den felles brukes, er «egne» treff normale rester av bruken — ikke en egen utgave
};
const EGENSKAPER: Egenskap[] = [
  {
    navn: "Feilmelding fra serveren",
    forklaring: "Når et kall feiler: oversettes svaret via den delte tabellen, eller vises serverens tekst rått?",
    felles: "api-error.js",
    fellesTegn: /from "\/static\/api-error\.js"/,
    egenTegn: [/showToast\([^)]*\b(err|error|e)\.message\b/, /showEmpty\([^)]*\b(err|error)\.message\b/, /textContent\s*=\s*\b(err|error)\.message\b/],
  },
  {
    navn: "Tom liste / ingenting å vise",
    forklaring: "Vises tomtilstanden med den delte hjelperen, eller med egen HTML?",
    felles: "loading.js (showEmpty)",
    fellesTegn: /\bshowEmpty\(/,
    egenTegn: [/class="empty-state/, /Ingen \w+ (funnet|ennå|registrert|matcher)/, /Kunne ikke laste/],
  },
  {
    navn: "Laster…",
    forklaring: "Vises lasting med den delte hjelperen (skjelett), eller med egen tekst?",
    felles: "loading.js (showLoading)",
    fellesTegn: /\bshowLoading\(/,
    egenTegn: [/class="page-loading"/, /`[^`]*Laster…[^`]*`/],
  },
  {
    navn: "Melding nederst (toast)",
    forklaring: "Bruker skjermen den delte toasten?",
    felles: "toast.js",
    fellesTegn: /from "\/static\/toast\.js"/,
    egenTegn: [/window\.alert\(/, /function showToast\(/],
  },
  {
    navn: "Meny og profil øverst",
    forklaring: "Bygges toppmenyen av den delte modulen?",
    felles: "workspace-nav.js",
    fellesTegn: /from "\/static\/workspace-nav\.js"/,
    egenTegn: [/class="workspace-nav-link"[^`]*href=/],
  },
  {
    navn: "Språkvelger",
    forklaring: "Har skjermen språkvelger, og henter den innhold på nytt ved bytte (#1040)?",
    felles: "localized-resource.js",
    fellesTegn: /from "\/static\/localized-resource\.js"/,
    egenTegn: [/localeSelect\??\.addEventListener\("change"/],
    fellesVinner: true,
  },
  {
    navn: "Hvem er jeg (identitetsfelt)",
    forklaring: "Identitetsfeltene fra den delte modulen (#1044), eller egne?",
    felles: "identity-defaults.js",
    fellesTegn: /from "\/static\/identity-defaults\.js"/,
    egenTegn: [/x-user-id/],
    fellesVinner: true,
  },
  {
    navn: "Hva som vises ut fra rolle",
    forklaring: "Skjules/vises deler av skjermen etter rolle med den delte regelen?",
    felles: "applyRoleBasedVisibility",
    fellesTegn: /applyRoleBasedVisibility\(/,
    egenTegn: [/\.roles\.includes\("ADMINISTRATOR"\)/, /isAdministrator\s*=/],
  },
  {
    navn: "Knapp som jobber (opptatt-tilstand)",
    forklaring: "Deaktiveres knappen med den delte hjelperen mens kallet pågår?",
    felles: "busy-button.js",
    fellesTegn: /from "\/static\/busy-button\.js"/,
    egenTegn: [/btn\.disabled\s*=\s*true;[\s\S]{0,200}await apiFetch/],
  },
  {
    navn: "Tekster på ett språk (hardkodet)",
    forklaring: "Norsk tekst skrevet rett i koden i stedet for i oversettelsestabellen. Tallet er antall linjer.",
    felles: "i18n-tabellene",
    fellesTegn: /from "\/static\/i18n\//,
    egenTegn: [/(innerHTML|textContent|placeholder|title|confirm|alert)[^\n]*[æøåÆØÅ]/],
  },
];

function dato(cmd: string[]): string {
  try {
    const ut = execFileSync("git", cmd, { cwd: ROOT, encoding: "utf8" }).trim();
    return ut ? ut.slice(0, 10) : "";
  } catch {
    return "";
  }
}
/** Når fikk fila et treff på mønsteret? Første commit der linjen kom inn (git log -S på et representativt fragment). */
function førsteBruk(fil: string, fragment: string): string {
  return dato(["log", "--diff-filter=AM", "--format=%ad", "--date=short", "-S", fragment, "--", fil]).split("\n").pop()?.trim() ?? "";
}
function sistEndret(fil: string): string {
  return dato(["log", "-1", "--format=%ad", "--date=short", "--", fil]);
}

type Celle = { status: "felles" | "egen" | "begge" | "—"; dato: string; egne: number };

function mål(skjerm: { fil: string }, e: Egenskap): Celle {
  const kilde = les(skjerm.fil);
  const brukerFelles = e.fellesTegn.test(kilde);
  let egne = 0;
  for (const re of e.egenTegn) egne += (kilde.match(new RegExp(re.source, "g" + (re.flags.includes("s") ? "s" : "")))?.length ?? 0);
  if (e.navn.startsWith("Tekster")) {
    // Tellingen gjelder linjer, og bare utenfor t("…")-kall.
    // Linjer med norsk tekst inne i en streng (anførselstegn eller backtick), utenfor kommentarer og
    // utenfor t()/tf()/tNav()-kall. Linjer inne i flerlinjede maler telles også (de har ingen
    // anførselstegn, men heller ingen kode). Norske variabelnavn telles ikke.
    egne = kilde.split("\n").filter((l) => {
      const t = l.trim();
      if (!/[æøåÆØÅ]/.test(l)) return false;
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import ")) return false;
      if (/\bt\(|\btf\(|\btNav\(/.test(l)) return false;
      if (/["'`][^"'`]*[æøåÆØÅ][^"'`]*["'`]/.test(l)) return true;
      // Mal-innhold: linjen har norsk tekst, men ingen tilordning, kall eller variabelbruk.
      return !/[=(;]/.test(t) && /^[<\wæøåÆØÅ ]/.test(t);
    }).length;
    return { status: egne === 0 ? "felles" : "egen", dato: "", egne };
  }
  const fragment = e.fellesTegn.source.replace(/\\\//g, "/").replace(/\\\./g, ".").replace(/[\\^$]/g, "").replace(/\(|\)/g, "");
  const når = brukerFelles ? førsteBruk(skjerm.fil, fragment.includes("from ") ? fragment.replace(/^from /, "").replace(/"/g, "") : fragment) : "";
  if (brukerFelles && e.fellesVinner) return { status: "felles", dato: når, egne: 0 };
  if (brukerFelles && egne > 0) return { status: "begge", dato: når, egne };
  if (brukerFelles) return { status: "felles", dato: når, egne: 0 };
  if (egne > 0) return { status: "egen", dato: "", egne };
  return { status: "—", dato: "", egne: 0 };
}

function main() {
  const rader = SKJERMER.map((s) => ({ skjerm: s, sist: sistEndret(s.fil), celler: EGENSKAPER.map((e) => mål(s, e)) }));
  const fellesSist = EGENSKAPER.map((e) => {
    const fil = e.felles.split(" ")[0];
    const sti = `public/static/${fil}`;
    return existsSync(join(ROOT, sti)) ? sistEndret(sti) : "";
  });

  const celleTekst = (c: Celle) => {
    if (c.status === "felles") return c.dato ? `felles (${c.dato})` : "felles";
    if (c.status === "begge") return `begge (${c.egne} egne)`;
    if (c.status === "egen") return `egen (${c.egne})`;
    return "—";
  };

  const perEgenskap = EGENSKAPER.map((e, i) => {
    const kol = rader.map((r) => r.celler[i]);
    return {
      navn: e.navn,
      felles: kol.filter((c) => c.status === "felles").length,
      begge: kol.filter((c) => c.status === "begge").length,
      egen: kol.filter((c) => c.status === "egen").length,
      mangler: kol.filter((c) => c.status === "—").length,
      egneTotalt: kol.reduce((s, c) => s + c.egne, 0),
      fellesSist: fellesSist[i],
    };
  });

  const md = `# Brukerflatene: hvem bruker hva

*Målt ${new Date().toISOString().slice(0, 10)}. Bare telling — ingen anbefaling. Kjør \`npx tsx scripts/complexity/ui-inventory.ts\` for å oppdatere.*

Hvorfor: skjermene er laget på ulike tidspunkt, og hver forbedring landet der noen jobbet akkurat da.
Den beste utgaven av hver byggekloss finnes derfor allerede — den nyeste. Tabellen viser hvilke
skjermer som har den, hvilke som har sin egen, og hvilke som mangler den.

## Per byggekloss

| Byggekloss | Bruker den felles | Felles + egne rester | Bare egen | Har den ikke | Egne utgaver i alt | Felles modul sist endret |
|---|---:|---:|---:|---:|---:|---|
${perEgenskap.map((p) => `| ${p.navn} | ${p.felles} | ${p.begge} | ${p.egen} | ${p.mangler} | ${p.egneTotalt} | ${p.fellesSist || "—"} |`).join("\n")}

${EGENSKAPER.map((e) => `- **${e.navn}** — ${e.forklaring} Felles modul: \`${e.felles}\`.`).join("\n")}

## Per skjerm

Datoen i parentes er når skjermen tok den felles byggeklossen i bruk. «egen (n)» er antall steder
med egen løsning. For «Tekster på ett språk» er tallet antall kodelinjer med norsk tekst utenfor
oversettelsestabellen.

| Skjerm | Sist endret | ${EGENSKAPER.map((e) => e.navn).join(" | ")} |
|---|---|${EGENSKAPER.map(() => "---").join("|")}|
${rader.map((r) => `| ${r.skjerm.navn} | ${r.sist} | ${r.celler.map(celleTekst).join(" | ")} |`).join("\n")}

## Slik leses det

- En kolonne med mange «egen» eller «—» er en byggekloss som ble laget etter at de fleste skjermene
  var ferdige. Det er der spredning gir mest.
- En skjerm med mange «egen» er bygget tidlig og lite rørt siden. Den bør tas som helhet.
- «begge» betyr at spredningen er halvgjort: den felles finnes, men gamle rester står igjen.
- «—» betyr at tellingen verken fant den felles eller et kjent eget mønster. Det kan være at
  skjermen ikke trenger egenskapen — eller at den løser det på en måte tellingen ikke kjenner.
  Sjekk skjermen før du konkluderer.
`;

  if (CHECK_ONLY) {
    console.log(md);
    return;
  }
  writeFileSync(join(ROOT, "doc/UI_INVENTORY.md"), md);
  console.log("skrevet doc/UI_INVENTORY.md");
}

main();
