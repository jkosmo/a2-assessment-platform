// Fjerner navngitte toppnivådeklarasjoner med TypeScript-parserens posisjoner.
//
// ⚠️ Dette er IKKE et opprydningsverktøy man slipper løs på en mappe. Det tar en eksplisitt liste
// med navn, og avbryter uten å skrive hvis det ikke finner nøyaktig alle. Rekkefølgen er bevisst:
// `dead-code-scan.mjs` FORESLÅR, et menneske VERIFISERER, dette FJERNER det som er verifisert.
//
// Verifiseringen som gjaldt da dette ble skrevet (#1046):
//   1. Ingen treff på navnet noe annet sted i repoet (`grep -r` i public/, src/, test/)
//   2. DOM-elementene funksjonene rører finnes ikke i noen HTML
//   3. Erstatningen funnet et annet sted (modulhåndtering flyttet til admin-content-library.js)
//   4. Alle fire testsuitene grønne etterpå
//
// ⚠️ Punkt 1 alene er ikke nok. Død kode i klynger refererer til seg selv, så hvert navn kan ha
// flere treff og likevel være uåpnåelig. Det var nettopp derfor referansetelling ikke fant dem.
//
// Bruk:
//   node scripts/dev/dead-code-remove.mjs <fil> <navn> [navn …]

import ts from "typescript";
import fs from "node:fs";

const [fil, ...navn] = process.argv.slice(2);
if (!fil || navn.length === 0) {
  console.error("Bruk: node scripts/dev/dead-code-remove.mjs <fil> <navn> [navn …]");
  process.exit(1);
}

const tekst = fs.readFileSync(fil, "utf8");
const sf = ts.createSourceFile(fil, tekst, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);

const spenn = [];
for (const stmt of sf.statements) {
  let n = null;
  if (ts.isFunctionDeclaration(stmt) && stmt.name) n = stmt.name.text;
  else if (ts.isVariableStatement(stmt)) {
    const d = stmt.declarationList.declarations[0];
    if (d && ts.isIdentifier(d.name)) n = d.name.text;
  }
  // `getStart(sf, true)` tar med ledende kommentarer — de hører til deklarasjonen.
  if (n && navn.includes(n)) spenn.push({ n, a: stmt.getStart(sf, true), b: stmt.getEnd() });
}

if (spenn.length !== navn.length) {
  const funnet = spenn.map((s) => s.n);
  console.error(`Fant ${spenn.length} av ${navn.length}. Mangler: ${navn.filter((n) => !funnet.includes(n)).join(", ")}`);
  console.error("Avbryter UTEN aa skrive.");
  process.exit(1);
}

// Bakfra, så tidligere posisjoner ikke forskyves.
spenn.sort((x, y) => y.a - x.a);
let ut = tekst;
for (const s of spenn) {
  let b = s.b;
  while (b < ut.length && (ut[b] === "\n" || ut[b] === "\r")) b++;
  console.log(`  ${s.n}: ${ut.slice(s.a, s.b).split("\n").length} linjer`);
  ut = ut.slice(0, s.a) + ut.slice(b);
}
fs.writeFileSync(fil, ut, "utf8");
console.log(`Skrevet ${fil}`);
