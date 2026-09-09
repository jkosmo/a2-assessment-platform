// Finner EKSPORTER som ingen importerer — på tvers av hele kodebasen.
//
// ⚠️ HVORFOR DETTE ER EN ANNEN ANALYSE ENN `dead-code-scan.mjs`. Den går nåbarhet INNENFOR én fil
// og behandler enhver `export` som en rotnode: den kan ikke vite om noen utenfor bruker den.
// Serverkoden er nesten bare eksporter, så den analysen ville sagt «alt er nådd».
//
// ⚠️ TO ULIKE FUNN, og forskjellen er vesentlig:
//
//   DØD          — navnet brukes ingen steder, heller ikke i sin egen fil. Koden kan fjernes.
//   OVEREKSPORT  — brukes internt (typisk en fabrikk som lager filens egen singel), men ingen
//                  utenfor importerer den. Da skal `export` bort, ikke koden.
//
// Første utgave slo dem sammen og rapporterte «1 049 linjer uten bruk». De to største var
// `createReportingRepository` (323 linjer) og `createCalibrationRepository` (122) — begge kalt på
// nest siste linje i sin egen fil for å lage den eksporterte singelen. Ingen av dem er død kode.
//
// ⚠️ FALSKE TREFF ER FORVENTET UANSETT: barrels som re-eksporterer, dynamiske importer med navn
// bygget av strenger, og typer brukt bare i type-posisjon. Verktøyet peker; mennesket verifiserer.
//
// Bruk: node scripts/dev/unused-export-scan.mjs src

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const rot = process.argv[2] ?? "src";

function alleFiler(dir) {
  const ut = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ut.push(...alleFiler(p));
    else if (/\.(ts|js|mjs)$/.test(e.name) && !e.name.endsWith(".d.ts")) ut.push(p);
  }
  return ut;
}

const filer = alleFiler(rot);
// ⚠️ Tester og skript teller som BRUK. En eksport bare en test importerer, er i bruk — ikke død.
const brukskilder = [
  ...filer,
  ...(fs.existsSync("test") ? alleFiler("test") : []),
  ...(fs.existsSync("scripts") ? alleFiler("scripts") : []),
];
const altInnhold = brukskilder.map((f) => fs.readFileSync(f, "utf8"));

const eksporter = [];
for (const fil of filer) {
  const tekst = fs.readFileSync(fil, "utf8");
  const sf = ts.createSourceFile(fil, tekst, ts.ScriptTarget.ES2022, true,
    fil.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  for (const stmt of sf.statements) {
    if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const a = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line;
    const b = sf.getLineAndCharacterOfPosition(stmt.getEnd()).line;
    const legg = (navn) => eksporter.push({ fil, navn, linjer: b - a + 1, linje: a + 1 });
    if (ts.isFunctionDeclaration(stmt) && stmt.name) legg(stmt.name.text);
    else if (ts.isClassDeclaration(stmt) && stmt.name) legg(stmt.name.text);
    else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) legg(d.name.text);
    }
    // Typer og grensesnitt utelates: de brukes i type-posisjon og telles ikke riktig her.
  }
}

const rømt = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const døde = [];
const overeksport = [];

for (const e of eksporter) {
  let utenfor = false;
  for (let i = 0; i < brukskilder.length; i++) {
    if (path.resolve(brukskilder[i]) === path.resolve(e.fil)) continue;
    if (new RegExp(`\\b${rømt(e.navn)}\\b`).test(altInnhold[i])) { utenfor = true; break; }
  }
  if (utenfor) continue;

  // Brukt i sin EGEN fil, utover selve deklarasjonen?
  const egen = fs.readFileSync(e.fil, "utf8");
  const antall = (egen.match(new RegExp(`\\b${rømt(e.navn)}\\b`, "g")) ?? []).length;
  (antall > 1 ? overeksport : døde).push(e);
}

const sum = (liste) => liste.reduce((s, e) => s + e.linjer, 0);
console.log(`${eksporter.length} eksporter i ${rot}/.\n`);
console.log(`  DOD (ingen bruk noe sted):       ${String(døde.length).padStart(3)} stk, ${sum(døde)} linjer`);
console.log(`  OVEREKSPORT (brukt kun internt): ${String(overeksport.length).padStart(3)} stk, ${sum(overeksport)} linjer — fjern export, ikke koden\n`);

console.log("DOD:");
for (const e of døde.sort((a, b) => b.linjer - a.linjer).slice(0, 25)) {
  console.log(`  ${String(e.linjer).padStart(4)} linjer  ${e.navn.padEnd(38)} ${e.fil.replace(/\\/g, "/")}:${e.linje}`);
}
console.log("\n⚠️ Peker, konkluderer ikke. Barrels, dynamiske importer og typebruk gir falske treff.");
