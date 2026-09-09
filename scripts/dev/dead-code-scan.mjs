// Nåbarhetsanalyse for frontend-filer, bygget på TypeScript-kompilatorens parser.
//
// ⚠️ HVORFOR IKKE REGEX. Første utgave av denne analysen telte klammer med en enkel løkke. Den
// brakk på `{` inne i strenger og maler: én funksjon i `admin-content-library.js` ble målt til 761
// linjer, masken slukte filens inngangspunkt, og resultatet ble «74 av 75 funksjoner er døde» for
// en side som åpenbart virker.
//
// Tallene fra den utgaven ble kastet. Denne bruker en ekte parser.
//
// ⚠️ OG HVORFOR IKKE BARE TELLE REFERANSER. Død kode i KLYNGER refererer til seg selv og ser
// levende ut. I `admin-content-shell.js` lå seks funksjoner for modulhåndtering — arkiver, slett,
// dupliser — som pekte på hverandre som «prøv igjen»-valg. Hver av dem hadde referanser. Ingen av
// dem kunne nås.
//
// Bruk:
//   node scripts/dev/dead-code-scan.mjs public/static/admin-content-shell.js [flere filer …]
//
// ⚠️ Verktøyet FORESLÅR. Det sletter ikke, og et funn er ikke et bevis: en funksjon kan nås via
// en streng (`window[navn]`), fra HTML (`onclick`), eller fra en annen fil. Hvert forslag skal
// verifiseres for seg før noe fjernes.

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

/** Navn på toppnivådeklarasjoner: funksjoner og const-er som holder en funksjon. */
function samleDeklarasjoner(sf) {
  const ut = new Map();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      ut.set(stmt.name.text, stmt);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) {
          ut.set(d.name.text, stmt);
        }
      }
    }
  }
  return ut;
}

/**
 * Identifikatorer som er ekte REFERANSER, ikke navn på noe annet.
 *
 * ⚠️ `obj.foo` er ikke en referanse til en toppnivåfunksjon `foo`, men `{ action: foo }` er det.
 * Uten dette skillet blir alt «nådd», og analysen sier ingenting.
 */
function referanserI(node) {
  const funnet = new Set();
  const gå = (n) => {
    if (ts.isIdentifier(n)) {
      const f = n.parent;
      const erEgenskapsnavn =
        (ts.isPropertyAccessExpression(f) && f.name === n) ||
        (ts.isPropertyAssignment(f) && f.name === n) ||
        (ts.isMethodDeclaration(f) && f.name === n) ||
        (ts.isParameter(f) && f.name === n) ||
        ((ts.isFunctionDeclaration(f) || ts.isFunctionExpression(f)) && f.name === n);
      if (!erEgenskapsnavn) funnet.add(n.text);
    }
    ts.forEachChild(n, gå);
  };
  ts.forEachChild(node, gå);
  return funnet;
}

function analyser(fil) {
  const tekst = fs.readFileSync(fil, "utf8");
  const sf = ts.createSourceFile(fil, tekst, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const dekl = samleDeklarasjoner(sf);
  if (dekl.size === 0) return { fil, tomt: true };

  // Kallgraf
  const kaller = new Map();
  for (const [navn, node] of dekl) {
    kaller.set(navn, new Set([...referanserI(node)].filter((r) => dekl.has(r) && r !== navn)));
  }

  // Rotnoder: alt som IKKE er en deklarasjon — toppnivåkall, lyttere, eksporter.
  const røtter = new Set();
  for (const stmt of sf.statements) {
    const erDekl = [...dekl.values()].includes(stmt);
    const eksportert = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (erDekl && !eksportert) continue;
    if (erDekl && eksportert) {
      // Eksporterte navn brukes utenfra og er dermed røtter.
      if (ts.isFunctionDeclaration(stmt) && stmt.name) røtter.add(stmt.name.text);
      else if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) røtter.add(d.name.text);
      }
      continue;
    }
    for (const r of referanserI(stmt)) if (dekl.has(r)) røtter.add(r);
  }

  // Bredde-først
  const nådd = new Set();
  const kø = [...røtter];
  while (kø.length) {
    const n = kø.pop();
    if (nådd.has(n)) continue;
    nådd.add(n);
    for (const k of kaller.get(n) ?? []) kø.push(k);
  }

  const døde = [...dekl.keys()].filter((n) => !nådd.has(n)).sort();
  const linjerFor = (n) => {
    const node = dekl.get(n);
    const a = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const b = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
    return b - a + 1;
  };
  return {
    fil,
    antall: dekl.size,
    røtter: røtter.size,
    døde: døde.map((n) => ({ navn: n, linjer: linjerFor(n) })),
  };
}

const filer = process.argv.slice(2);
if (filer.length === 0) {
  console.error("Bruk: node scripts/dev/dead-code-scan.mjs <fil> [fil …]");
  process.exit(1);
}

let sumDøde = 0;
let sumLinjer = 0;
for (const f of filer) {
  const r = analyser(f);
  const navn = path.basename(r.fil);
  if (r.tomt) {
    console.log(`${navn.padEnd(36)} ingen toppnivadeklarasjoner`);
    continue;
  }
  const linjer = r.døde.reduce((s, d) => s + d.linjer, 0);
  sumDøde += r.døde.length;
  sumLinjer += linjer;
  console.log(`${navn.padEnd(36)} ${String(r.antall).padStart(4)} dekl, ${String(r.røtter).padStart(3)} rotnoder, ${String(r.døde.length).padStart(3)} unaadd (${linjer} linjer)`);
  for (const d of r.døde) console.log(`      ${String(d.linjer).padStart(4)} linjer  ${d.navn}`);
}
console.log(`\nTOTALT ${sumDøde} unaadde deklarasjoner, ${sumLinjer} linjer`);
console.log("⚠️ Forslag, ikke bevis. Verifiser hvert funn for seg for noe fjernes.");
