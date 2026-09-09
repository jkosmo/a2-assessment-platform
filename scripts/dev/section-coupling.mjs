// Måler koblingen MELLOM seksjonene i en stor fil, med TypeScript-parseren.
//
// ⚠️ HVORFOR. `admin-content-shell.js` har 18 navngitte seksjoner og null eksporter. Spørsmålet
// før et uttrekk er ikke «hvor store er seksjonene» — det er «hvor mye snakker de sammen».
// En seksjon på 2000 linjer som bare bruker seg selv er lett å trekke ut. En på 200 som rører
// ti andre er ikke det.
//
// Bruk: node scripts/dev/section-coupling.mjs public/static/admin-content-shell.js

import ts from "typescript";
import fs from "node:fs";

const fil = process.argv[2];
if (!fil) { console.error("Bruk: node scripts/dev/section-coupling.mjs <fil>"); process.exit(1); }

const tekst = fs.readFileSync(fil, "utf8");
const sf = ts.createSourceFile(fil, tekst, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const linjer = tekst.split("\n");

// Seksjonsbannere: en linje med mange bindestreker, så en kommentarlinje med tittelen.
const seksjoner = [];
for (let i = 0; i < linjer.length; i++) {
  if (/^\/\/ -{20,}/.test(linjer[i]) && linjer[i + 1]?.startsWith("// ") && !/^\/\/ -{20,}/.test(linjer[i + 1])) {
    seksjoner.push({ linje: i, tittel: linjer[i + 1].slice(3).trim().slice(0, 52) });
  }
}
if (seksjoner.length === 0) { console.error("Fant ingen seksjonsbannere."); process.exit(1); }

const seksjonFor = (linje) => {
  let s = seksjoner[0];
  for (const k of seksjoner) if (k.linje <= linje) s = k;
  return s.tittel;
};

// Deklarasjoner, med hvilken seksjon de bor i
const dekl = new Map();
for (const stmt of sf.statements) {
  let navn = null;
  if (ts.isFunctionDeclaration(stmt) && stmt.name) navn = stmt.name.text;
  else if (ts.isVariableStatement(stmt)) {
    const d = stmt.declarationList.declarations[0];
    if (d && ts.isIdentifier(d.name) && d.initializer &&
        (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) navn = d.name.text;
  }
  if (!navn) continue;
  const linje = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line;
  const slutt = sf.getLineAndCharacterOfPosition(stmt.getEnd()).line;
  dekl.set(navn, { node: stmt, seksjon: seksjonFor(linje), linjer: slutt - linje + 1 });
}

function referanserI(node) {
  const ut = new Set();
  const gå = (n) => {
    if (ts.isIdentifier(n)) {
      const f = n.parent;
      const egenskapsnavn =
        (ts.isPropertyAccessExpression(f) && f.name === n) ||
        (ts.isPropertyAssignment(f) && f.name === n) ||
        (ts.isParameter(f) && f.name === n) ||
        ((ts.isFunctionDeclaration(f) || ts.isFunctionExpression(f)) && f.name === n);
      if (!egenskapsnavn) ut.add(n.text);
    }
    ts.forEachChild(n, gå);
  };
  ts.forEachChild(node, gå);
  return ut;
}

// Kanter mellom seksjoner
const utKanter = new Map();
const innKanter = new Map();
const størrelse = new Map();
for (const s of seksjoner) { utKanter.set(s.tittel, new Map()); innKanter.set(s.tittel, new Map()); størrelse.set(s.tittel, 0); }

for (const [navn, info] of dekl) {
  størrelse.set(info.seksjon, (størrelse.get(info.seksjon) ?? 0) + info.linjer);
  for (const r of referanserI(info.node)) {
    const mål = dekl.get(r);
    if (!mål || r === navn || mål.seksjon === info.seksjon) continue;
    utKanter.get(info.seksjon).set(mål.seksjon, (utKanter.get(info.seksjon).get(mål.seksjon) ?? 0) + 1);
    innKanter.get(mål.seksjon).set(info.seksjon, (innKanter.get(mål.seksjon).get(info.seksjon) ?? 0) + 1);
  }
}

const rader = seksjoner.map((s) => ({
  tittel: s.tittel,
  linjer: størrelse.get(s.tittel) ?? 0,
  ut: [...utKanter.get(s.tittel).values()].reduce((a, b) => a + b, 0),
  utSeksjoner: utKanter.get(s.tittel).size,
  inn: [...innKanter.get(s.tittel).values()].reduce((a, b) => a + b, 0),
  innSeksjoner: innKanter.get(s.tittel).size,
})).filter((r) => r.linjer > 0);

rader.sort((a, b) => (a.ut + a.inn) - (b.ut + b.inn));
console.log("Sortert etter TOTAL kobling — lettest aa trekke ut forst.\n");
console.log("linjer   ut(sek)   inn(sek)   seksjon");
for (const r of rader) {
  console.log(`${String(r.linjer).padStart(6)}  ${String(r.ut).padStart(4)}(${r.utSeksjoner})  ${String(r.inn).padStart(5)}(${r.innSeksjoner})   ${r.tittel}`);
}
console.log("\nut  = kall FRA denne seksjonen til andre (maa foylge med, eller bli parametre)");
console.log("inn = kall TIL denne seksjonen fra andre (blir det offentlige grensesnittet)");
