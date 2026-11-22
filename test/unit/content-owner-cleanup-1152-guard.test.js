import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#1152): EIERRADENE GÅR MED INNHOLDET.
//
// `ContentOwner` peker på kurs, moduler og seksjoner uten fremmednøkkel (fire typer i én tabell), så databasen rydder ikke radene
// når innholdet slettes. Før #1152 ble de liggende etter alle tre slettingene, og etter kaskaden og masseryddingen.
//
// Vakta finner slettestedene selv: hvert kall `….course.delete(`, `….module.delete(` og `….courseSection.delete(` (også
// `deleteMany`) i src/. Funksjonen som sletter, eller den som står oppført under som ansvarlig for den, skal kalle
// `deleteContentOwnersOf(tx, "<TYPE>"` for samme type. Et nytt slettested uten opprydding er rødt til det har den.
//
// Det vakta IKKE ser: at id-ene som sendes, er de som ble slettet. Det måler rutetestene (test/m2-content-delete-1152.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = join(ROOT, "src");

const TABLES = new Map([["course", "COURSE"], ["module", "MODULE"], ["courseSection", "SECTION"]]);

// Skriveren sletter, kommandoen som kaller den rydder (i samme transaksjon). Nøkkel → hvem som rydder, og hvorfor.
const CLEANED_BY = {
  "modules/adminContent/adminContentRepository.ts#deleteModule": {
    by: "modules/adminContent/adminContentCommands.ts#deleteModuleInTx",
    why: "skriveren sletter modulen med versjonene; kommandoen holder vaktene og rydder eierradene i samme transaksjon",
  },
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.ts$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

const norm = (p) => p.split("\\").join("/");
const rel = (fileName) => norm(fileName).slice(norm(SRC).length + 1);

/** Navnet på den nærmeste navngitte funksjonen: deklarasjon, metode, eller pil/funksjon lagt i en variabel på toppnivå. */
function enclosingName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current.name.getText();
  }
  return "?";
}

/** Slettestedene og funksjonstekstene i én fil. */
function scan(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const deletes = [];
  const functions = new Map();
  const visit = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && node.body) {
      functions.set(`${file}#${node.name.getText()}`, node.getText());
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const op = node.expression.name.text;
      const target = node.expression.expression;
      if ((op === "delete" || op === "deleteMany") && ts.isPropertyAccessExpression(target) && TABLES.has(target.name.text)) {
        deletes.push({ key: `${file}#${enclosingName(node)}`, type: TABLES.get(target.name.text) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { deletes, functions };
}

function problems(deletes, functions) {
  const out = [];
  for (const { key, type } of deletes) {
    const cleaner = CLEANED_BY[key]?.by ?? key;
    const body = functions.get(cleaner);
    if (!body) {
      out.push(`${key}: fant ikke ${cleaner}`);
      continue;
    }
    if (!body.includes(`deleteContentOwnersOf(tx, "${type}"`)) {
      out.push(`${key} sletter ${type} uten at ${cleaner} kaller deleteContentOwnersOf(tx, "${type}", …)`);
    }
  }
  return out;
}

const files = walk(SRC);
const all = { deletes: [], functions: new Map() };
for (const file of files) {
  const { deletes, functions } = scan(rel(file), readFileSync(file, "utf8"));
  all.deletes.push(...deletes);
  for (const [k, v] of functions) all.functions.set(k, v);
}

describe("#1152: eierradene slettes sammen med kurs, modul og seksjon", () => {
  it("KONTROLL: vakta finner de kjente slettestedene", () => {
    const keys = [...new Set(all.deletes.map((d) => `${d.key} ${d.type}`))].sort();
    expect(keys).toEqual(expect.arrayContaining([
      "modules/adminContent/adminContentCommands.ts#purgeUnpublishedModule MODULE",
      "modules/adminContent/adminContentRepository.ts#deleteModule MODULE",
      // #1152 skive 4a-2: kaskaden sletter gjennom de indre funksjonene til «Slett», og har ingen egne slettesteder.
      "modules/course/courseCommands.ts#deleteCourseInTx COURSE",
      "modules/course/sectionCommands.ts#deleteSectionInTx SECTION",
    ]));
  });

  it("hvert slettested rydder eierradene for samme type", () => {
    const found = problems(all.deletes, all.functions);
    expect(found, `\n${found.join("\n")}\n`).toEqual([]);
  });

  it("skriveren som er unntatt, kalles bare fra kommandoen som rydder", () => {
    // `repo.deleteModule(` (skriveren) skal bare kalles der eierradene ryddes. Kommandoen med samme navn kalles uten punktum.
    const callers = [...all.functions]
      .filter(([key, body]) => !(key in CLEANED_BY) && /\.deleteModule\(/.test(body))
      .map(([key]) => key);
    expect(callers).toEqual(["modules/adminContent/adminContentCommands.ts#deleteModuleInTx"]);
    for (const entry of Object.values(CLEANED_BY)) expect(entry.why.length).toBeGreaterThan(20);
  });

  it("KONTROLLCASE: en ny sletting uten opprydding blir funnet, og en med blir det ikke", () => {
    const probe = scan("modules/probe.ts", [
      "export async function forgets(tx) {",
      "  await tx.courseSection.delete({ where: { id } });",
      "}",
      "export async function cleans(tx) {",
      "  await tx.course.delete({ where: { id } });",
      "  await deleteContentOwnersOf(tx, \"COURSE\", [id]);",
      "}",
      "export async function wrongType(tx) {",
      "  await tx.module.deleteMany({ where: { id: { in: ids } } });",
      "  await deleteContentOwnersOf(tx, \"SECTION\", ids);",
      "}",
    ].join("\n"));
    expect(probe.deletes.map((d) => `${d.key} ${d.type}`)).toEqual([
      "modules/probe.ts#forgets SECTION",
      "modules/probe.ts#cleans COURSE",
      "modules/probe.ts#wrongType MODULE",
    ]);
    expect(problems(probe.deletes, probe.functions)).toEqual([
      "modules/probe.ts#forgets sletter SECTION uten at modules/probe.ts#forgets kaller deleteContentOwnersOf(tx, \"SECTION\", …)",
      "modules/probe.ts#wrongType sletter MODULE uten at modules/probe.ts#wrongType kaller deleteContentOwnersOf(tx, \"MODULE\", …)",
    ]);
  });
});
