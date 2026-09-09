// Finner funksjoner med samme FORM på tvers av filer — kandidater for generalisering.
//
// ⚠️ HVORFOR IKKE NAVNELIKHET. En tidligere måling fant 49 funksjonsnavn som gjentas på tvers av
// de seks forfatterappene. Men flere av dem var énlinjes innpakninger (`apiErrorText`), og et
// felles navn beviser ikke felles logikk — like lite som ulike navn beviser ulik logikk.
//
// Her sammenlignes STRUKTUREN: hver funksjonskropp gjøres om til en sekvens av nodetyper, uten
// identifikatorer og literaler. To funksjoner som gjør det samme med ulike variabelnavn får da
// samme signatur.
//
// ⚠️ FALSKE TREFF ER FORVENTET. Små funksjoner ligner alltid på hverandre — en `if`-sjekk og en
// `return` er ikke et mønster. Derfor er det en nedre grense, og hvert treff må leses før noe
// slås sammen. Verktøyet peker; det konkluderer ikke.
//
// Bruk: node scripts/dev/similar-function-scan.mjs public/static/*.js

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const filer = process.argv.slice(2);
if (filer.length === 0) { console.error("Bruk: node scripts/dev/similar-function-scan.mjs <filer…>"); process.exit(1); }

const MIN_NODER = 40; // under dette ligner alt paa alt

/** Sekvens av nodetyper — formen, uten navn og verdier. */
function form(node, sf) {
  const ut = [];
  const gå = (n) => {
    // Literaler og identifikatorer utelates: det er STRUKTUREN vi sammenligner.
    if (!ts.isIdentifier(n) && !ts.isStringLiteral(n) && !ts.isNumericLiteral(n)
        && !ts.isTemplateHead(n) && !ts.isTemplateMiddle(n) && !ts.isTemplateTail(n)
        && !ts.isNoSubstitutionTemplateLiteral(n)) {
      ut.push(n.kind);
    }
    ts.forEachChild(n, gå);
  };
  ts.forEachChild(node, gå);
  return ut;
}

const funksjoner = [];
for (const fil of filer) {
  const tekst = fs.readFileSync(fil, "utf8");
  const sf = ts.createSourceFile(fil, tekst, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const besøk = (node) => {
    let navn = null;
    if (ts.isFunctionDeclaration(node) && node.name) navn = node.name.text;
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
             && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) navn = node.name.text;
    if (navn) {
      const f = form(node, sf);
      if (f.length >= MIN_NODER) {
        const a = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
        const b = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
        funksjoner.push({ fil: path.basename(fil), navn, form: f, linjer: b - a + 1, linje: a + 1 });
      }
    }
    ts.forEachChild(node, besøk);
  };
  ts.forEachChild(sf, besøk);
}

/** Andel felles av den korteste — enkel og forutsigbar. */
function likhet(a, b) {
  const n = Math.min(a.length, b.length);
  const m = Math.max(a.length, b.length);
  if (m === 0) return 0;
  let treff = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) treff++;
  return treff / m;
}

const par = [];
for (let i = 0; i < funksjoner.length; i++) {
  for (let j = i + 1; j < funksjoner.length; j++) {
    const s = likhet(funksjoner[i].form, funksjoner[j].form);
    if (s >= 0.85) par.push({ a: funksjoner[i], b: funksjoner[j], s });
  }
}
par.sort((x, y) => (y.s * (y.a.linjer + y.b.linjer)) - (x.s * (x.a.linjer + x.b.linjer)));

console.log(`${funksjoner.length} funksjoner over ${MIN_NODER} noder. ${par.length} par med >=85 % lik form.\n`);
for (const p of par.slice(0, 20)) {
  const kryss = p.a.fil !== p.b.fil ? "  [PAA TVERS AV FILER]" : "";
  console.log(`${Math.round(p.s * 100)}%  ${p.a.linjer}+${p.b.linjer} linjer${kryss}`);
  console.log(`      ${p.a.fil}:${p.a.linje}  ${p.a.navn}`);
  console.log(`      ${p.b.fil}:${p.b.linje}  ${p.b.navn}`);
}
console.log("\n⚠️ Peker, konkluderer ikke. Les hvert par for noe slaas sammen.");
