/**
 * #1055: kompleksitetsrapport — tall vi kan følge fra release til release, skrevet på vanlig norsk.
 *
 *   npm run complexity            → skriver doc/COMPLEXITY.md og doc/complexity/latest.json,
 *                                   og legger et punkt til i doc/complexity/history.json
 *   npm run complexity -- --check → skriver ingenting, bare til terminalen
 *
 * Målene er valgt etter hva som faktisk har kostet oss, ikke etter hva som er lett å telle. Linjetall
 * og «syklomatisk kompleksitet» måler hvor mye kode som finnes; det som har kostet er regler som er
 * skrevet flere steder enn de håndheves, og filer alt må gjennom. Hver dimensjon får en skår 0–100
 * der 100 er «slik vi vil ha det», og regelen for skåren står i rapporten så hvem som helst kan
 * etterprøve den. Reglene ble kalibrert én gang, mot nullpunktet 2026-09-12, og skal deretter ligge
 * fast — ellers kan ikke tall sammenlignes over tid.
 *
 * Ingen databasetilgang, ingen nettverk: alt leses fra arbeidskatalogen og git-loggen.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");

// ─────────────────────────────────────────────────────────────────────────────
// Hjelpere
// ─────────────────────────────────────────────────────────────────────────────
function les(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}
function klem(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function walk(dir: string, ok: (p: string) => boolean): string[] {
  const out: string[] = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs)) {
    const full = join(abs, e);
    const rel = relative(ROOT, full).split(sep).join("/");
    if (statSync(full).isDirectory()) {
      if (e === "node_modules" || e === "vendor" || e === "dist") continue;
      out.push(...walk(rel, ok));
    } else if (ok(rel)) out.push(rel);
  }
  return out;
}
function linjer(rel: string): number {
  return les(rel).split("\n").length;
}
/** Summerer tallene i en `const NAVN = { "…": N, … };`-blokk. */
function sumBlokk(rel: string, navn: string): number {
  const s = les(rel);
  const start = s.indexOf(`const ${navn} = {`);
  if (start < 0) throw new Error(`${rel}: fant ikke ${navn}`);
  const slutt = s.indexOf("};", start);
  const blokk = s.slice(start, slutt);
  let sum = 0;
  for (const m of blokk.matchAll(/"[^"]+":\s*(\d+)/g)) sum += Number(m[1]);
  return sum;
}
function lesTak(rel: string): number {
  const m = /const TAK = (\d+)/.exec(les(rel));
  if (!m) throw new Error(`${rel}: fant ikke TAK`);
  return Number(m[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Regler som er skrevet flere steder enn de håndheves
//
// Vi har allerede tester som TELLER slike steder og feiler om tallet går opp. Summen av dem er det
// ærligste tallet vi har. Nye tellere legges til her når de lages.
// ─────────────────────────────────────────────────────────────────────────────
type Teller = { hva: string; steder: number; kilde: string };
function tellRegler(): Teller[] {
  return [
    {
      hva: "Skjermer som selv velger hvilket språk et lagret innhold vises på (serveren skal gjøre det)",
      steder: sumBlokk("test/client-locale-parser-guard.test.js", "BASELINE"),
      kilde: "test/client-locale-parser-guard.test.js",
    },
    {
      hva: "Steder som viser serverens rå feiltekst i stedet for en oversatt melding",
      steder:
        sumBlokk("test/raw-server-error-guard.test.js", "TOAST_BASELINE")
        + sumBlokk("test/raw-server-error-guard.test.js", "RENDER_BASELINE"),
      kilde: "test/raw-server-error-guard.test.js",
    },
    {
      hva: "Feil fra serveren uten kode (klienten kan ikke oversette dem)",
      steder: lesTak("test/unit/domain-error-codes-999.test.ts"),
      kilde: "test/unit/domain-error-codes-999.test.ts",
    },
    {
      hva: "Steder i forfatterkonsollet som bruker menyspråket (ikke innholdsspråket)",
      steder: lesTak("test/unit/admin-content-locale-roles-974.test.js"),
      kilde: "test/unit/admin-content-locale-roles-974.test.js",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Viktige regler: hvor mange uavhengige utgaver av regelen finnes i koden?
//
// Målet er én per regel. For hver regel finnes én delt funksjon; alt annet som gjør samme jobb på
// egen hånd telles som en ekstra utgave. Mønstrene under er det vi FANT da reglene ble samlet.
// ─────────────────────────────────────────────────────────────────────────────
type Regel = { hva: string; delt: string; ekstra: number; hvordan: string };
function tellUtgaver(): Regel[] {
  const kildefiler = walk("src", (p) => p.endsWith(".ts"));
  const tellMønster = (re: RegExp, ...unntakFiler: string[]) => {
    let n = 0;
    for (const f of kildefiler) {
      if (unntakFiler.some((u) => f.endsWith(u))) continue;
      for (const l of les(f).split("\n")) {
        const t = l.trim();
        if (t.startsWith("//") || t.startsWith("*")) continue;
        if (re.test(l)) n += 1;
      }
    }
    return n;
  };
  return [
    {
      hva: "Kan en modul publiseres? (knapp, kurskaskade, import)",
      delt: "evaluateModulePublishGate",
      // contentValidationService.ts definerer sjekkene; definisjonene er ikke utgaver av regelen.
      ekstra: tellMønster(/\b(validateModuleVersionForPublish|validateMcqTranslationCompleteness)\s*\(/, "modulePublishGate.ts", "contentValidationService.ts"),
      hvordan: "kall til de underliggende sjekkene utenfor den delte funksjonen",
    },
    {
      hva: "Kan deltakeren nås? (aktiv og ikke anonymisert)",
      delt: "isReachableParticipant",
      ekstra: tellMønster(/\.activeStatus\b.*\.isAnonymized\b|\.isAnonymized\b.*\.activeStatus\b/, "participantReach.ts"),
      hvordan: "linjer som sjekker begge feltene selv",
    },
    {
      hva: "Hvilket språk gjelder for denne forespørselen?",
      delt: "requestLocale",
      ekstra: tellMønster(/context\??\.locale\s*\?\?/, "requestLocale.ts"),
      hvordan: "egne reserveverdier for språk i rutene",
    },
    {
      hva: "Er innleveringen avgjort? (hvilke statuser teller som ferdig)",
      delt: "isSettledSubmission",
      ekstra: tellMønster(/status:\s*\{\s*(in|notIn):\s*\[\s*"(COMPLETED|REJECTED)"/, "submissionOutcome.ts"),
      hvordan: "spørringer som lister statusene selv",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Filer alt må gjennom
// ─────────────────────────────────────────────────────────────────────────────
type StorFil = { fil: string; linjer: number };
function finnStoreFiler(): { over1500: StorFil[]; over800: StorFil[]; mestImportert: Array<{ fil: string; importører: number }> } {
  const kode = [
    ...walk("src", (p) => p.endsWith(".ts") && !p.endsWith(".d.ts")),
    ...walk("public", (p) => p.endsWith(".js") && !p.startsWith("public/i18n/")),
  ];
  const alle = kode.map((fil) => ({ fil, linjer: linjer(fil) })).sort((a, b) => b.linjer - a.linjer);
  const over1500 = alle.filter((f) => f.linjer > 1500);
  const over800 = alle.filter((f) => f.linjer > 800 && f.linjer <= 1500);

  // Hvem importeres av flest? Teller import-linjer per mål (uten filending og sti-prefiks).
  const teller = new Map<string, number>();
  for (const f of kode) {
    for (const m of les(f).matchAll(/from\s+"([^"]+)"/g)) {
      const mål = m[1].replace(/\.js$/, "").split("/").slice(-1)[0];
      if (!m[1].startsWith(".") && !m[1].startsWith("/static")) continue;
      teller.set(mål, (teller.get(mål) ?? 0) + 1);
    }
  }
  const mestImportert = [...teller.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([fil, importører]) => ({ fil, importører }));
  return { over1500, over800, mestImportert };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Filer som alltid endres sammen (siste 90 dager)
// ─────────────────────────────────────────────────────────────────────────────
type Par = { a: string; b: string; sammen: number; andel: number };
function finnSamendring(): Par[] {
  const logg = execFileSync("git", ["log", "--since=90.days", "--format=%x00%h", "--name-only"], { cwd: ROOT, encoding: "utf8" });
  const commits = logg.split("\x00").slice(1).map((blokk) => {
    const filer = blokk.split("\n").slice(1).map((l) => l.trim()).filter((l) => l && /^(src|public)\//.test(l) && !l.startsWith("public/i18n/"));
    return [...new Set(filer)];
  }).filter((f) => f.length > 1 && f.length <= 12); // store commits sier lite om kobling
  const perFil = new Map<string, number>();
  const perPar = new Map<string, number>();
  for (const filer of commits) {
    for (const f of filer) perFil.set(f, (perFil.get(f) ?? 0) + 1);
    const s = [...filer].sort();
    for (let i = 0; i < s.length; i += 1) for (let j = i + 1; j < s.length; j += 1) {
      const k = `${s[i]}\t${s[j]}`;
      perPar.set(k, (perPar.get(k) ?? 0) + 1);
    }
  }
  const par: Par[] = [];
  for (const [k, sammen] of perPar) {
    if (sammen < 5) continue;
    const [a, b] = k.split("\t");
    const andel = sammen / Math.max(perFil.get(a) ?? 1, perFil.get(b) ?? 1);
    if (andel >= 0.6) par.push({ a, b, sammen, andel });
  }
  return par.sort((x, y) => y.sammen - x.sammen);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Størrelse (kostnad å drifte)
// ─────────────────────────────────────────────────────────────────────────────
function tellStørrelse() {
  // Ruterne heter `adminContentRouter.get(`, `coursesRouter.post(` osv. — og `app.get(` i app.ts.
  const ruter = walk("src", (p) => p.endsWith(".ts")).reduce((n, f) => n + (les(f).match(/\b(\w*Router|app)\.(get|post|put|patch|delete)\(/g)?.length ?? 0), 0);
  const tabeller = (les("prisma/schema.prisma").match(/^model /gm) ?? []).length;
  const kolonner = les("prisma/schema.prisma").split("\n").filter((l) => /^\s{2}[a-zA-Z]\w*\s+\S/.test(l) && !l.trim().startsWith("@@")).length;
  const i18nNøkler = walk("public/i18n", (p) => p.endsWith(".js")).reduce((n, f) => n + (les(f).match(/^\s*"[^"]+":\s*"/gm)?.length ?? 0), 0);
  const testfiler = walk("test", (p) => /\.(test|spec)\.(ts|js)$/.test(p)).length;
  return { ruter, tabeller, kolonner, i18nNøkler, testfiler };
}

// ─────────────────────────────────────────────────────────────────────────────
// Skårer — reglene står også i rapporten
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const regler = tellRegler();
  const utgaver = tellUtgaver();
  const store = finnStoreFiler();
  const par = finnSamendring();
  const størrelse = tellStørrelse();
  const versjon = (JSON.parse(les("package.json")) as { version: string }).version;
  const dato = new Date().toISOString().slice(0, 10);

  const sumRegler = regler.reduce((s, r) => s + r.steder, 0);
  const sumEkstra = utgaver.reduce((s, r) => s + Math.max(0, r.ekstra), 0);

  const skår = {
    reglerFlereSteder: klem(100 - 2 * sumRegler),
    utgaverAvViktigeRegler: klem(100 - 15 * sumEkstra),
    filerAltMåGjennom: klem(100 - 10 * store.over1500.length - 5 * store.over800.length),
    filerSomEndresSammen: klem(100 - 5 * par.length),
    størrelse: klem((
      klem(100 - Math.max(0, størrelse.ruter - 120) / 2)
      + klem(100 - Math.max(0, størrelse.tabeller - 30) * 2)
      + klem(100 - Math.max(0, størrelse.i18nNøkler - 3000) / 50)
    ) / 3),
  };
  const samlet = klem(Object.values(skår).reduce((a, b) => a + b, 0) / Object.values(skår).length);

  const json = { dato, versjon, samlet, skår, tall: { sumRegler, regler, utgaver, store, samendring: par, størrelse } };

  const md = `# Hvor innfløkt er løsningen nå?

*Målt ${dato}, versjon ${versjon}. Kjør \`npm run complexity\` for å oppdatere. Reglene for hvert tall står under tallet.*

## Samlet: **${samlet} / 100**

Gjennomsnittet av de fem tallene under. 100 betyr «slik vi vil ha det».

| Hva | Skår |
|---|---|
| Regler som er skrevet flere steder | **${skår.reglerFlereSteder}** |
| Viktige regler med mer enn én utgave i koden | **${skår.utgaverAvViktigeRegler}** |
| Filer alt må gjennom | **${skår.filerAltMåGjennom}** |
| Filer som alltid endres sammen | **${skår.filerSomEndresSammen}** |
| Størrelse | **${skår.størrelse}** |

## 1. Regler som er skrevet flere steder — ${skår.reglerFlereSteder}

Når en regel står flere steder i koden, kan den bli rettet ett sted og glemt et annet. Vi har tester
som teller slike steder og som feiler hvis tallet går opp. Summen nå: **${sumRegler} steder**.
*Regel: 100 minus 2 poeng per sted.*

| Hva telles | Steder | Hvor tallet kommer fra |
|---|---:|---|
${regler.map((r) => `| ${r.hva} | ${r.steder} | \`${r.kilde}\` |`).join("\n")}

## 2. Viktige regler med mer enn én utgave — ${skår.utgaverAvViktigeRegler}

For de viktigste reglene finnes én delt funksjon. Alt annet som gjør samme jobb på egen hånd er en
ekstra utgave som kan glide fra den første. Ekstra utgaver nå: **${sumEkstra}**.
*Regel: 100 minus 15 poeng per ekstra utgave.*

| Regel | Delt funksjon | Ekstra utgaver | Slik telles det |
|---|---|---:|---|
${utgaver.map((r) => `| ${r.hva} | \`${r.delt}\` | ${Math.max(0, r.ekstra)} | ${r.hvordan} |`).join("\n")}

## 3. Filer alt må gjennom — ${skår.filerAltMåGjennom}

En fil som er svært stor kan ikke endres uten å røre noe annet, og en fil som svært mange andre er
avhengige av gjør hver endring risikabel. Over 1 500 linjer: **${store.over1500.length}**. Mellom 800 og
1 500: **${store.over800.length}**.
*Regel: 100 minus 10 poeng per fil over 1 500 linjer og 5 per fil mellom 800 og 1 500. Oversettelsestabeller telles ikke.*

| Fil | Linjer |
|---|---:|
${[...store.over1500, ...store.over800].map((f) => `| \`${f.fil}\` | ${f.linjer} |`).join("\n")}

Mest brukt av andre filer (ikke med i skåren, men verdt å vite):

| Modul | Antall filer som bruker den |
|---|---:|
${store.mestImportert.map((m) => `| \`${m.fil}\` | ${m.importører} |`).join("\n")}

## 4. Filer som alltid endres sammen — ${skår.filerSomEndresSammen}

Når to filer nesten alltid endres i samme commit, henger de sammen på en måte koden ikke viser.
Fra git-historikken de siste 90 dagene: par som er endret sammen minst 5 ganger og i minst 60 % av
tilfellene der én av dem ble endret. Par nå: **${par.length}**.
*Regel: 100 minus 5 poeng per par. Commits som rører mer enn 12 filer telles ikke — de sier lite om kobling.*

${par.length === 0 ? "Ingen slike par." : `| Fil A | Fil B | Ganger sammen | Andel |\n|---|---|---:|---:|\n${par.slice(0, 15).map((p) => `| \`${p.a}\` | \`${p.b}\` | ${p.sammen} | ${Math.round(p.andel * 100)} % |`).join("\n")}`}

## 5. Størrelse — ${skår.størrelse}

Hvor mye det er å holde ved like. Ikke feil i seg selv, men alt her koster tid ved hver endring.
*Regel: gjennomsnitt av tre deltall — API-ruter (100 ned til 0 fra 120 til 320), databasetabeller (100 ned fra 30, 2 poeng per tabell) og oversettelsesnøkler (100 ned fra 3 000, 1 poeng per 50).*

| Hva | Antall |
|---|---:|
| API-ruter | ${størrelse.ruter} |
| Databasetabeller | ${størrelse.tabeller} |
| Kolonner i databasen | ${størrelse.kolonner} |
| Oversettelsesnøkler (alle språk) | ${størrelse.i18nNøkler} |
| Testfiler | ${størrelse.testfiler} |

## Historikk

${historikkTabell(json)}
`;

  if (CHECK_ONLY) {
    console.log(md);
    return;
  }
  mkdirSync(join(ROOT, "doc/complexity"), { recursive: true });
  writeFileSync(join(ROOT, "doc/complexity/latest.json"), JSON.stringify(json, null, 2) + "\n");
  writeFileSync(join(ROOT, "doc/COMPLEXITY.md"), md);
  console.log(`Samlet ${samlet}/100 — skrevet doc/COMPLEXITY.md og doc/complexity/latest.json`);
}

type Punkt = { dato: string; versjon: string; samlet: number; skår: Record<string, number> };
function historikkTabell(nå: Punkt): string {
  const sti = join(ROOT, "doc/complexity/history.json");
  const historikk: Punkt[] = existsSync(sti) ? (JSON.parse(readFileSync(sti, "utf8")) as Punkt[]) : [];
  const uten = historikk.filter((p) => p.versjon !== nå.versjon);
  const ny = [...uten, { dato: nå.dato, versjon: nå.versjon, samlet: nå.samlet, skår: nå.skår }];
  if (!CHECK_ONLY) {
    mkdirSync(join(ROOT, "doc/complexity"), { recursive: true });
    writeFileSync(sti, JSON.stringify(ny, null, 2) + "\n");
  }
  return `| Dato | Versjon | Samlet | Regler flere steder | Utgaver | Store filer | Endres sammen | Størrelse |\n|---|---|---:|---:|---:|---:|---:|---:|\n${ny
    .map((p) => `| ${p.dato} | ${p.versjon} | ${p.samlet} | ${p.skår.reglerFlereSteder} | ${p.skår.utgaverAvViktigeRegler} | ${p.skår.filerAltMåGjennom} | ${p.skår.filerSomEndresSammen} | ${p.skår.størrelse} |`)
    .join("\n")}`;
}

main();
