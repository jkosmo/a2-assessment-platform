import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT: A-2s miljøidentifikatorer skal ikke ligge i et OFFENTLIG repo.
//
// Repoet er publisert under GPL-3 så andre kan bruke og bygge videre på plattformen. Det er en
// bevisst beslutning — men det betyr at alt som beskriver VÅRE miljøer må bli liggende lokalt.
//
// ⚠️ Ingen av verdiene er legitimasjon. En tenant-ID kan slås opp offentlig for ethvert domene, og
// en subscription-ID gir ingen tilgang uten autentisering og en RBAC-tildeling. Risikoen er
// AGGREGERINGEN: tenant + abonnement + ressursgruppenavn + produksjonsverter + navnet på
// driftskontoen beskriver målet presist nok til at en phishing-e-post leser som om den kom
// innenfra.
//
// Konsekvensen av at de ikke er hemmeligheter er verdt å si høyt: denne vakta er IKKE en
// sikkerhetsgrense. Havner en ekte nøkkel i repoet, må den ROTERES. Å fjerne den fra `main` er
// teater — verdien ligger i historikken.
//
// Verdiene bor i `doc/ENVIRONMENTS.local.md` (gitignorert), malen i `doc/ENVIRONMENTS.example.md`.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// GUID-er som er LIKE FOR HELE VERDEN og derfor skal bli liggende. Å plassholde dem ville gjort
// infrastrukturen uleselig for den som gjenbruker prosjektet — og de er ikke våre.
//
// Ny innebygd rolle i bruk? Legg den til her, med navn. At det krever en bevisst handling er
// poenget: da ser den som legger den til at lista finnes.
const WELL_KNOWN = new Map([
  ["4633458b-17de-408a-b874-0445c86b69e6", "Key Vault Secrets User (innebygd rolle)"],
  ["4633458b-17de-408a-b874-0445c86b69e0", "Key Vault Secrets User — skrivefeil i doc/design/334, beholdt for sporbarhet"],
  ["ba92f5b4-2d11-453d-a403-e96b0029c9fe", "Storage Blob Data Contributor (innebygd rolle)"],
  ["f1a07417-d97a-45cb-824c-7a7467783830", "Role Based Access Control Administrator (innebygd rolle)"],
  ["b24988ac-6180-42a0-ab88-20f7382dd24c", "Contributor (innebygd rolle)"],
  ["00000003-0000-0000-c000-000000000000", "Microsoft Graph (velkjent app-ID)"],
]);

// Rene eksempel-/testverdier. `00000000-...-0000000000NN` og liknende er åpenbart syntetiske.
const SYNTHETIC = /^0{8}-0{4}-0{4}-0{4}-0{11}[0-9a-f]$/;

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// Personidentifiserende driftskontoer. Et generisk `person@a-2.no` i et eksempel er greit.
const OPERATOR_ACCOUNTS = [/\bjko@a-2\.no\b/i, /\bjoakim\.kosmo@gmail\.com\b/i];

// Filtyper der en GUID kan være ekte konfigurasjon. Kildekode og tester er utelatt: der er GUID-er
// nesten alltid fikstureringsdata, og å skanne dem ville gitt støy uten funn.
const SCANNED = /\.(md|ya?ml|ps1|bicep|json|sh)$/i;

const SKIP = [
  "package-lock.json",
  "doc/ENVIRONMENTS.local.md", // gitignorert, men kan ligge i arbeidstreet
  "test/environment-identifier-guard.test.js", // denne fila, som nødvendigvis nevner verdiene
];

/** Kun SPOREDE filer. En lokal, ignorert fil er nettopp der verdiene skal ligge. */
function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

describe("miljøidentifikatorer lekker ikke ut i det offentlige repoet", () => {
  const files = trackedFiles().filter((f) => SCANNED.test(f) && !SKIP.includes(f));

  it("KONTROLLASSERTION: vakta finner faktisk filer å skanne", () => {
    // ⚠️ Uten denne blir forbudet under grønt av å måle NULL — feiler `git ls-files`, eller endres
    // filtypene, ville vakta bestått uten å dekke noe. Den fella har gitt oss en falsk
    // «47 av 47 er lokalisert» før.
    expect(files.length, "fant ingen sporede filer å skanne — leter vakta riktig sted?")
      .toBeGreaterThan(50);
  });

  it("ingen ukjente GUID-er i sporede filer", () => {
    const hits = [];
    for (const file of files) {
      const src = readFileSync(`${ROOT}${file}`, "utf8");
      for (const m of src.matchAll(GUID)) {
        const guid = m[0].toLowerCase();
        if (WELL_KNOWN.has(guid) || SYNTHETIC.test(guid)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        hits.push(`${file}:${line}  ${guid}`);
      }
    }

    expect(
      hits,
      `\nGUID-er som ikke er velkjente Azure-konstanter:\n${hits.join("\n")}\n\n`
      + "Er dette en av VÅRE identifikatorer: bruk en plassholder (<PROD_SUBSCRIPTION_ID> osv.) og\n"
      + "legg verdien i doc/ENVIRONMENTS.local.md.\n"
      + "Er det en innebygd Azure-rolle eller en velkjent app-ID: legg den i WELL_KNOWN over, MED navn.\n",
    ).toEqual([]);
  });

  it("ingen navngitte driftskontoer i sporede filer", () => {
    const hits = [];
    for (const file of files) {
      const src = readFileSync(`${ROOT}${file}`, "utf8");
      for (const pattern of OPERATOR_ACCOUNTS) {
        const m = pattern.exec(src);
        if (!m) continue;
        const line = src.slice(0, m.index).split("\n").length;
        hits.push(`${file}:${line}  ${m[0]}`);
      }
    }

    expect(
      hits,
      `\nDriftskontoer i sporede filer:\n${hits.join("\n")}\n\n`
      + "Bruk <PROD_ADMIN_UPN> / <STAGING_ADMIN_UPN>, eller en åpenbart generisk adresse\n"
      + "som person@example.com i et eksempel.\n",
    ).toEqual([]);
  });

  it("malen finnes, og peker på den lokale fila", () => {
    // Vakta forteller folk å legge verdier i en fil. Finnes ikke malen, er beskjeden en blindvei.
    const example = readFileSync(`${ROOT}doc/ENVIRONMENTS.example.md`, "utf8");
    expect(example).toContain("doc/ENVIRONMENTS.local.md");
    expect(example).toContain("<PROD_SUBSCRIPTION_ID>");
  });
});
