// Finner REN logikk i en stor fil — funksjoner som ikke rører modulnivå-tilstand eller DOM.
//
// ⚠️ HVORFOR AKKURAT DETTE. `admin-content-shell.js` har seks moduler trukket ut fra før
// (`preview`, `blueprint-hash`, `shell-state`, `shared`, `localized-copy`, `external-llm`), og
// ALLE SEKS har null muterbar tilstand på modulnivå. Mønsteret er etablert: man trekker ut ren
// logikk, ikke seksjoner.
//
// Min første uttrekksplan rangerte seksjoner etter kobling. Det var feil analyse for dette
// mønsteret: en seksjon på 626 linjer der alt rører `sessionState` og `document` kan ikke trekkes
// ut, uansett hvor lite den kobler til naboene.
//
// Bruk: node scripts/dev/pure-function-scan.mjs public/static/admin-content-shell.js

import ts from "typescript";
import fs from "node:fs";

const fil = process.argv[2];
if (!fil) { console.error("Bruk: node scripts/dev/pure-function-scan.mjs <fil>"); process.exit(1); }

const tekst = fs.readFileSync(fil, "utf8");
const sf = ts.createSourceFile(fil, tekst, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const linjer = tekst.split("\n");

// Modulnivå-tilstand: `let`/`var` på toppnivå. `const` som holder en funksjon teller ikke.
const tilstand = new Set();
for (const stmt of sf.statements) {
  if (!ts.isVariableStatement(stmt)) continue;
  const flagg = stmt.declarationList.flags;
  const erKonst = (flagg & ts.NodeFlags.Const) !== 0;
  for (const d of stmt.declarationList.declarations) {
    if (!ts.isIdentifier(d.name)) continue;
    const erFunksjon = d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer));
    if (!erKonst && !erFunksjon) tilstand.add(d.name.text);
    // ⚠️ En `const` som holder et DOM-element er ogsaa binding til omverdenen.
    if (erKonst && d.initializer && /document\.(getElementById|querySelector)/.test(d.initializer.getText(sf))) {
      tilstand.add(d.name.text);
    }
  }
}

const seksjoner = [];
for (let i = 0; i < linjer.length; i++) {
  if (/^\/\/ -{20,}/.test(linjer[i]) && linjer[i + 1]?.startsWith("// ") && !/^\/\/ -{20,}/.test(linjer[i + 1])) {
    seksjoner.push({ linje: i, tittel: linjer[i + 1].slice(3).trim().slice(0, 46) });
  }
}
const seksjonFor = (l) => { let s = seksjoner[0]; for (const k of seksjoner) if (k.linje <= l) s = k; return s?.tittel ?? "(uten seksjon)"; };

const resultat = new Map();
for (const stmt of sf.statements) {
  let navn = null;
  if (ts.isFunctionDeclaration(stmt) && stmt.name) navn = stmt.name.text;
  else if (ts.isVariableStatement(stmt)) {
    const d = stmt.declarationList.declarations[0];
    if (d && ts.isIdentifier(d.name) && d.initializer &&
        (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) navn = d.name.text;
  }
  if (!navn) continue;

  const kropp = stmt.getText(sf);
  const rørerTilstand = [...tilstand].some((t) => new RegExp(`\\b${t}\\b`).test(kropp));
  const rørerDom = /\bdocument\.|\bwindow\.|\.innerHTML|\.appendChild|addEventListener/.test(kropp);
  const rørerNett = /\bapiFetch\b|\bfetch\(/.test(kropp);

  const a = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line;
  const b = sf.getLineAndCharacterOfPosition(stmt.getEnd()).line;
  const seksjon = seksjonFor(a);
  if (!resultat.has(seksjon)) resultat.set(seksjon, { ren: [], uren: 0, renLinjer: 0, urenLinjer: 0 });
  const r = resultat.get(seksjon);
  if (!rørerTilstand && !rørerDom && !rørerNett) {
    r.ren.push({ navn, linjer: b - a + 1 });
    r.renLinjer += b - a + 1;
  } else {
    r.uren += 1;
    r.urenLinjer += b - a + 1;
  }
}

console.log(`${tilstand.size} modulnivaa-bindinger (let/var + DOM-const).\n`);
console.log("renLinj  urenLinj  antRene  seksjon");
const rader = [...resultat.entries()].filter(([, r]) => r.renLinjer + r.urenLinjer > 0);
rader.sort((a, b) => b[1].renLinjer - a[1].renLinjer);
for (const [navn, r] of rader) {
  console.log(`${String(r.renLinjer).padStart(7)}  ${String(r.urenLinjer).padStart(8)}  ${String(r.ren.length).padStart(7)}  ${navn}`);
}
const sumRen = rader.reduce((s, [, r]) => s + r.renLinjer, 0);
const sumUren = rader.reduce((s, [, r]) => s + r.urenLinjer, 0);
console.log(`\nSUM ren logikk: ${sumRen} linjer av ${sumRen + sumUren} (${Math.round(100 * sumRen / (sumRen + sumUren))} %)`);
console.log("\nStorste rene funksjoner:");
const alle = rader.flatMap(([s, r]) => r.ren.map((f) => ({ ...f, s })));
alle.sort((a, b) => b.linjer - a.linjer);
for (const f of alle.slice(0, 12)) console.log(`  ${String(f.linjer).padStart(4)}  ${f.navn}`);
