import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#1142 skive 1): alle veier inn til «Mine kurs» fra en klasse er sett.
//
// Et kurs står i «Mine kurs» fra en klasse når personen er medlem (`ClassMember`), klassen har kurset
// (`CourseGroupAssignment`), kurset er publisert og ikke arkivert (`Course.publishedAt`/`archivedAt`), og klassen ikke er
// arkivert (`Class.archivedAt`, skive 0). Alt som kan gjøre én av delene sann, er en vei inn, og skal gi e-post om nye kurs
// (doc/design/PLAN_1142.md, punkt 1).
//
// Med jobben i skive 3 er en ny skriver dekket av seg selv: jobben spør databasen, ikke handlingene. Vakta er der for at
// noen skal SE den nye skriveren og ta stilling til om den skal gi e-post. Den finner skriverne i `src/`, ikke kallerne:
// veiene inn går gjennom få skrivere (planen grep etter skrivere av tabellene, 2026-11-08).
//
// En skriving med innhold vakta ikke kan lese (`data: fields`, `data`, `...rest`), står som «ukjent innhold» og må også
// stå i lista. Ikke dekket: `User.activeStatus`/`isAnonymized` (vei 4, personen kommer tilbake). Den har mange skrivere i
// synkroniseringen og følger av regelen uten egen kode.
//
// Ny skriver → rød. Legg den i `EXPECTED` med hvilken vei den er (eller hvorfor den ikke er en vei inn), og sjekk at
// regelen i `src/modules/course/courseAssignmentNotice.ts` gir riktig svar for den.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Skriverne, nøkkel → [antall, hvorfor]. Nøkkelen er «fil#funksjon hva». */
const EXPECTED = new Map([
  // Medlemskap. Eneste skriver av ClassMember.
  ["modules/course/classRepository.ts#addMember ClassMember", [1, "vei 1: nytt medlem (ruta, UI og brukerfila fra klassesiden går hit)"]],
  ["modules/course/classRepository.ts#removeMember ClassMember", [1, "fjerner: ingen vei inn. Ventende rad slettes av sjekken før sending"]],
  // Tildelinger. Eneste skriver av CourseGroupAssignment.
  ["modules/course/classRepository.ts#assignCourseToClass CourseGroupAssignment", [2, "vei 2: ny tildeling (createMany). updateMany endrer bare fristen: ikke et nytt kurs"]],
  ["modules/course/classRepository.ts#unassignCourseFromClass CourseGroupAssignment", [1, "fjerner: ingen vei inn"]],
  // Kursets publisering og arkivering.
  ["modules/course/courseCommands.ts#publishCourse Course.publishedAt", [1, "vei 3a–3d: «Publiser kurs» med og uten kaskade, importen med replaceExisting, publisert igjen — alle går hit"]],
  ["modules/course/courseCommands.ts#unpublishCourse Course.publishedAt", [1, "fjerner: avpublisering"]],
  // #1150 skive 2a-2: arkiveringen og gjenopprettingen er flyttet til courseArchive.ts (de tar innholdet med seg). Samme skrivinger.
  ["modules/course/courseArchive.ts#archiveCourse Course.publishedAt", [1, "fjerner: arkivering avpubliserer"]],
  ["modules/course/courseArchive.ts#archiveCourse Course.archivedAt", [1, "fjerner: arkivering"]],
  ["modules/course/courseArchive.ts#restoreCourse Course.archivedAt", [1, "ingen vei inn alene: kurset lander upublisert, e-post først ved publisering (3d)"]],
  ["modules/course/courseArchive.ts#restoreCourse Course.publishedAt", [1, "fjerner: gjenoppretting avpubliserer alltid (2.158.0). Det er dette som gjør raden over sann også for et kurs som var arkivert OG publisert (eldre data)"]],
  ["modules/course/courseCommands.ts#updateCourse Course (ukjent innhold)", [1, "`data: fields` er typet uten publishedAt og archivedAt (tittel, beskrivelse, nivå, tilgang, diskusjon, plassering)"]],
  ["modules/adminContent/contentImportService.ts#importCourseFromEnvelope Course.publishedAt", [1, "fjerner: importen avpubliserer et kurs med tilbakeholdt innhold (#996). Publiseringen går gjennom publishCourse"]],
  // Klassens arkivering.
  ["modules/course/classRepository.ts#archiveClass Class.archivedAt", [1, "fjerner: kurs fra arkiverte klasser gir ingen e-post (skive 0)"]],
  ["modules/course/classRepository.ts#restoreClass Class.archivedAt", [1, "vei 5: gjenopprettet klasse. Bare par uten rad gir e-post"]],
  ["modules/course/classRepository.ts#updateClass Class (ukjent innhold)", [1, "`data` er typet som navn og beskrivelse"]],
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function relative(file) {
  return file.slice(SRC.length + 1).split("\\").join("/");
}

/** Indeksen der den balanserte blokken som starter på `start` («(», «{» eller «[»), slutter. */
function closingIndex(text, start) {
  const open = text[start];
  const close = { "(": ")", "{": "}", "[": "]" }[open];
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/** Argumentteksten til hvert kall som matcher `pattern`. */
function callArguments(text, pattern) {
  const found = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[0].length - 1; // står på «(»
    found.push({ index: match.index, match, args: text.slice(start, closingIndex(text, start) + 1) });
  }
  return found;
}

/**
 * Det kallet skriver: `data`, og `create`/`update` i en upsert. `opaque` når innholdet ikke er en bokstavelig blokk
 * (`data: fields`, `data` alene, eller `...rest` inne i blokken).
 */
function payloads(args) {
  const out = [];
  for (const match of args.matchAll(/[{,]\s*(data|create|update)\s*(:|(?=[,}]))/g)) {
    if (match[2] !== ":") {
      out.push({ text: "", opaque: true });
      continue;
    }
    let i = match.index + match[0].length;
    while (/\s/.test(args[i])) i += 1;
    if (args[i] === "{" || args[i] === "[") {
      const text = args.slice(i, closingIndex(args, i) + 1);
      out.push({ text, opaque: /\.\.\.\s*[A-Za-z_$]/.test(text) });
    } else {
      out.push({ text: "", opaque: true });
    }
  }
  return out;
}

/** Navnet på funksjonen eller metoden kallet står i: den nærmeste definisjonen før det. */
function enclosingFunction(text, index) {
  const before = text.slice(0, index);
  let best = { at: -1, name: "(toppnivå)" };
  for (const match of before.matchAll(/function\s*\*?\s*([A-Za-z0-9_$]+)\s*[<(]/g)) {
    if (match.index > best.at) best = { at: match.index, name: match[1] };
  }
  for (const match of before.matchAll(/^[ \t]*(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)\n]*\)\s*(?::[^{\n]*)?\{[ \t]*$/gm)) {
    if (["if", "for", "while", "switch", "catch", "function"].includes(match[1])) continue;
    if (match.index > best.at) best = { at: match.index, name: match[1] };
  }
  return best.name;
}

const TABLE_WRITE = /\.(classMember|courseGroupAssignment)\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*\(/g;
const ROW_WRITE = /\.(course|class)\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert)\s*\(/g;
const FIELDS = { course: ["publishedAt", "archivedAt"], class: ["archivedAt"] };
const MODEL = { classMember: "ClassMember", courseGroupAssignment: "CourseGroupAssignment", course: "Course", class: "Class" };
const SQL_WRITE = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"(ClassMember|CourseGroupAssignment|Course|Class)"/gi;
const NESTED_WRITE = /\b(members|classMemberships|courseAssignments|groupAssignments)\s*:\s*\{\s*(create|createMany|connect|connectOrCreate|upsert|update|updateMany|set|delete|deleteMany)\b/g;

/** Skriverne i én fil, som nøkler «fil#funksjon hva». */
function writersIn(rel, text) {
  const keys = [];
  const add = (index, what) => keys.push(`${rel}#${enclosingFunction(text, index)} ${what}`);
  for (const call of callArguments(text, TABLE_WRITE)) add(call.index, MODEL[call.match[1]]);
  for (const call of callArguments(text, ROW_WRITE)) {
    const model = call.match[1];
    const written = payloads(call.args);
    for (const field of FIELDS[model]) {
      if (written.some((p) => new RegExp(`\\b${field}\\b`).test(p.text))) add(call.index, `${MODEL[model]}.${field}`);
    }
    if (written.some((p) => p.opaque)) add(call.index, `${MODEL[model]} (ukjent innhold)`);
  }
  for (const match of text.matchAll(SQL_WRITE)) add(match.index, `rå SQL mot ${match[2]}`);
  for (const match of text.matchAll(NESTED_WRITE)) add(match.index, `skriving gjennom relasjonen ${match[1]}`);
  return keys;
}

function count(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

function found() {
  return count(walk(SRC).flatMap((file) => writersIn(relative(file), readFileSync(file, "utf8"))));
}

describe("#1142: alle skrivere av medlemskap, tildelinger og publisering er sett (veiene inn)", () => {
  it("skriverne i src/ er nøyaktig de i lista — en ny skriver er en mulig ny vei inn til «Mine kurs» og e-posten om nye kurs", () => {
    const actual = found();
    const expected = new Map([...EXPECTED].map(([key, [n]]) => [key, n]));
    const added = [...actual].filter(([key, n]) => expected.get(key) !== n).map(([key, n]) => `${key} ×${n}`);
    const gone = [...expected].filter(([key, n]) => actual.get(key) !== n).map(([key, n]) => `${key} ×${n}`);
    expect(
      { nyeEllerEndrede: added, borteEllerEndrede: gone },
      "Skriverne har endret seg. Ta stilling til om den nye skriveren er en vei inn (doc/design/PLAN_1142.md, punkt 1), og oppdater EXPECTED med grunnen.",
    ).toEqual({ nyeEllerEndrede: [], borteEllerEndrede: [] });
  });

  it("hver skriver i lista har en grunn", () => {
    for (const [key, [n, why]] of EXPECTED) {
      expect(n, key).toBeGreaterThan(0);
      expect(why.length, key).toBeGreaterThan(10);
    }
  });

  it("KONTROLLCASE: fanger skriving over flere linjer, ukjent innhold, rå SQL og skriving gjennom relasjonen; ikke lesing eller andre felt", () => {
    const sample = [
      "export async function a() {",
      "  await tx.classMember",
      "    .createMany({ data: [{ classId, userId }] });",
      "}",
      "export async function b(data) {",
      "  await tx.course.update({ where: { id }, data: { publishedAt: new Date() }, select: { archivedAt: true } });",
      "  await tx.class.update({ where: { id }, data });",
      "  await tx.class.update({ where: { id }, data: { ...rest, name } });",
      "  await tx.course.update({ where: { id }, data: { slug }, select: { publishedAt: true } });",
      "  await tx.class.create({ data: { name }, select: { archivedAt: true } });",
      "  await prisma.courseGroupAssignment.findMany({ where: { classId } });",
      "  await prisma.$executeRaw`UPDATE \"Course\" SET \"publishedAt\" = now()`;",
      "  await prisma.user.update({ where: { id }, data: { classMemberships: { create: { classId } } } });",
      "}",
    ].join("\n");
    expect(writersIn("x.ts", sample)).toEqual([
      "x.ts#a ClassMember",
      "x.ts#b Course.publishedAt",
      "x.ts#b Class (ukjent innhold)",
      "x.ts#b Class (ukjent innhold)",
      "x.ts#b rå SQL mot Course",
      "x.ts#b skriving gjennom relasjonen classMemberships",
    ]);
  });

  it("KONTROLLCASE: en upsert skriver både create og update", () => {
    const sample = "async function c() {\n  await tx.class.upsert({ where: { id }, create: { name }, update: { archivedAt: null } });\n}";
    expect(writersIn("x.ts", sample)).toEqual(["x.ts#c Class.archivedAt"]);
  });
});
