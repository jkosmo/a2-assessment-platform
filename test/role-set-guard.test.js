import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT: «hvilke roller får gjøre dette» besvares ett sted.
//
// Spørsmålet ble besvart tjue steder. Tre hadde et navngitt sett — men hvert sitt, i hver sin
// modul. De sytten andre var `roles.includes("ADMINISTRATOR")` skrevet på stedet.
//
// ⚠️ Skaden er ikke gjentakelsen. Den er at ingen kunne LESE POLICYEN. For å svare på «hvem ser en
// deltakers revisjonsspor» måtte man finne `auditService.ts` — og for å oppdage at svaret er fem
// roller mens `/api/reports` er to, måtte man tilfeldigvis lese begge.
//
// Nå står settene ved siden av hverandre i `src/auth/roleSets.ts`, og uenigheten er lesbar.
//
// Vakta nekter nye innebygde sjekker. Den avgjør INGEN policy — den sier bare at policyen skal
// skrives der de andre står.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const ROLE_SETS = "auth/roleSets.ts";

// Rollenavnene fra Prisma-enumet. En innebygd sjekk nevner alltid minst ett av dem.
const ROLE_NAMES = [
  "PARTICIPANT",
  "SUBJECT_MATTER_OWNER",
  "ADMINISTRATOR",
  "APPEAL_HANDLER",
  "REPORT_READER",
  "REVIEWER",
];

// Mønstrene de tjue faktisk brukte. En helt ny formulering fanges ikke — ingen tekstvakt kan det —
// men dette er veiene tilbake som allerede er tråkket opp.
const INLINE_PATTERNS = [
  { re: /roles\s*\??\.\s*includes\s*\(/g, why: "roles.includes(...)" },
  { re: /roles\s*\??\.\s*some\s*\(/g, why: "roles.some(...)" },
];

// Filer som med vilje skriver rollenavn uten å være en tilgangsvakt. Hver MÅ ha en grunn.
const EXCEPTIONS = {
  "auth/roleSets.ts": "definisjonen selv",
  "config/capabilities.ts":
    "montering: hvilke roller slipper inn på et API-prefiks. Er en DEKLARASJON av policy, ikke en "
    + "innebygd sjekk — og settene her er med vilje grovere enn de per-rute.",
  "auth/authorization.ts":
    "requireAnyRole tar settet som ARGUMENT fra monteringen; den skriver ikke sitt eget. Bruker "
    + "hasAnyRole internt.",
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const relOf = (file) => file.slice(SRC.length + 1).replace(/\\/g, "/");

/** Linjer som gjør en innebygd rollesjekk — nevner et rollenavn OG bruker includes/some på roles. */
function inlineChecks() {
  const hits = [];
  for (const file of walk(SRC)) {
    const rel = relOf(file);
    if (rel in EXCEPTIONS) continue;
    const src = readFileSync(file, "utf8");
    const lines = src.split(/\r?\n/);

    lines.forEach((line, i) => {
      // Kommentarer teller ikke — de forklarer ofte nettopp denne regelen.
      const code = line.replace(/\/\/.*$/, "");
      if (!ROLE_NAMES.some((r) => code.includes(`"${r}"`) || code.includes(`AppRole.${r}`))) return;
      for (const { re, why } of INLINE_PATTERNS) {
        if (new RegExp(re.source).test(code)) {
          hits.push(`${rel}:${i + 1}  ${why}  «${code.trim().slice(0, 80)}»`);
          return;
        }
      }
    });
  }
  return hits;
}

describe("#962: rollesjekker går gjennom det delte settet", () => {
  it("KONTROLLASSERTION: settene finnes og er i bruk", () => {
    // ⚠️ Uten denne blir forbudet under grønt av å måle NULL: sletter noen roleSets.ts og all bruk,
    // forsvinner også mønstrene vakta leter etter. Den fella har gitt oss en falsk «47 av 47» før.
    const sets = readFileSync(join(SRC, "auth", "roleSets.ts"), "utf8");
    for (const name of ["ADMIN_ONLY", "CONTENT_AUTHORS", "SUBMISSION_AUDIT_READERS", "REPORT_READERS"]) {
      expect(sets, `${name} er ikke lenger eksportert`).toContain(`export const ${name}`);
    }

    const users = walk(SRC).filter((f) => readFileSync(f, "utf8").includes("hasAnyRole("));
    expect(users.length, "ingen bruker hasAnyRole — måler vakta noe i det hele tatt?")
      .toBeGreaterThanOrEqual(10);
  });

  it("ingen innebygde rollesjekker utenfor roleSets.ts", () => {
    const hits = inlineChecks();
    expect(
      hits,
      "\nInnebygde rollesjekker:\n" + hits.join("\n")
        + "\n\nBruk hasAnyRole(roles, <SETT>) fra src/auth/roleSets.ts.\n"
        + "Finnes ikke settet, legg det til DER — med en kommentar om hvem det gjelder og hvorfor.\n",
    ).toEqual([]);
  });

  it("unntakslista peker bare på filer som finnes", () => {
    // Et unntak for en slettet fil ser ut som en vurdering, men dekker ingenting.
    const all = new Set(walk(SRC).map(relOf));
    const stale = Object.keys(EXCEPTIONS).filter((f) => !all.has(f));
    expect(stale, `Unntak uten fil:\n${stale.join("\n")}`).toEqual([]);

    for (const [file, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.trim().length, `Unntak uten grunn: ${file}`).toBeGreaterThan(15);
    }
  });

  it("⚠️ dokumenterer at revisjonssporet er videre enn rapporten", () => {
    // Dette er ikke en regel — det er en PÅMINNELSE, festet i en test så den ikke forsvinner.
    //
    // SUBMISSION_AUDIT_READERS har fem roller; REPORT_READERS har to. En SMO leser enhver
    // deltakers fulle revisjonsspor med navn og e-post, men får 403 på rapporten, som viser samme
    // datakategori aggregert. Den svakeste definisjonen ligger på den mest granulære ruta.
    //
    // Settene er gjengitt UENDRET fra før #962 — å innskrenke er en produktbeslutning. Endres
    // dette, skal testen endres bevisst, ikke oppdages tilfeldig.
    const sets = readFileSync(join(SRC, "auth", "roleSets.ts"), "utf8");

    // ⚠️ Leser fra `= [` til `]`, ikke fra navnet. Første utkast brukte `NAVN[^\]]+\]`, som stoppet
    // på klammen i `readonly AppRoleType[]` og målte NULL roller — testen ble rød og fortalte meg
    // det. En assertion som kan måle null uten å si fra er verdiløs; denne sa fra.
    const setBody = (name) => {
      const m = sets.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`, "s"));
      return m ? m[1] : "";
    };
    const auditRoles = setBody("SUBMISSION_AUDIT_READERS");
    const reportRoles = setBody("REPORT_READERS");

    const count = (block) => ROLE_NAMES.filter((r) => block.includes(`AppRole.${r}`)).length;

    expect(count(auditRoles), "revisjonssporet: fem roller (uendret, se #962)").toBe(5);
    expect(count(reportRoles), "rapporten: to roller").toBe(2);
    expect(auditRoles).toContain("SUBJECT_MATTER_OWNER");
    expect(reportRoles).not.toContain("SUBJECT_MATTER_OWNER");
  });
});
