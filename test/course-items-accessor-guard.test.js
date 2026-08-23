import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT (#958): kursets elementer hentes gjennom EN AV TO NAVNGITTE DØRER, aldri direkte.
//
// `findCourseItems` var en ufiltrert aksessor med åtte kallere og fem ulike regler: den hentet
// `archivedAt`, `activeVersionId` og `activeVersion.publishedAt` — nøyaktig feltene som avgjør
// tilgjengelighet — og filtrerte ingenting. Samme rad ga «tilgjengelig», «påkrevd», «publiserbar»
// og «slettbar» ulike svar. Det er roten til #938, #944, #945 og #992.
//
// Kuren er `findCourseItemsForParticipant` (kun det deltakeren kan bruke, med et ferdig avgjort
// `available`) og `findAllCourseItems` (alt — forfatterflater, publiseringsgaten, sletting,
// eksport). Begge bor i `courseRepository.ts`.
//
// ⚠️ Kuren holder bare så lenge ingen går utenom. En niende kaller som skriver sin egen
// `prisma.courseItem.findMany` gjenskaper nøyaktig utgangspunktet — og kan gjøre det i én linje,
// uten å røre noen av dørene. Vakta gjør det umulig i stillhet: unntak må skrives ned med en grunn.
//
// Samme form som `test/course-visibility-guard.test.js` (søsteren, #959). Unntakslista er poenget:
// den hindrer ikke drift, den gjør den synlig — og en liste som vokser er slitasje som samler seg.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Definisjonsfila. Dørene SKAL ligge her, og bare her. */
const ACCESSOR_FILE = "modules/course/courseRepository.ts";

const DOORS = ["findCourseItemsForParticipant", "findAllCourseItems"];

/**
 * Direkte lesning av CourseItem-tabellen. `findMany` er formen som returnerer hele radsett og
 * derfor kan gjenskape den ufiltrerte aksessoren. Matches over hele filteksten, ikke linje for
 * linje: `client.courseItem` med `.findMany` på neste linje er samme lesning, og formen finnes
 * allerede i kodebasen.
 */
const RAW_READ = /\.courseItem\s*\.\s*findMany\b/g;

/**
 * Kjente direkte lesninger. Hver MÅ ha en grunn.
 *
 * Felles for alle fire: de spør IKKE «hva inneholder dette kurset». De går motsatt vei (hvilke kurs
 * inneholder denne modulen/seksjonen) eller leser rader for å skrive dem tilbake. Ingen av dem har
 * en tilgjengelighetsregel å ta feil av, og ingen av dem returnerer innhold til en deltaker.
 */
const EXCEPTIONS = [
  {
    file: "modules/course/contentLifecycle.ts",
    reason:
      "findCoursesForSections — omvendt oppslag (seksjon → kurs) for «Brukt i kurs»-kolonnen i "
      + "forfatterlista. Ikke kursets innhold, og ikke en deltakerflate.",
  },
  {
    file: "modules/course/courseCommands.ts",
    reason:
      "setCourseModules leser seksjonsradene for å BEVARE dem gjennom en re-skriving av modulene. "
      + "En skriveoperasjon på rader, ikke en visning av innhold. ⚠️ Denne ruta omgår arkivvakta "
      + "i setCourseItems — kjent hull, #992, og en annen sak enn tilgjengelighetsregelen.",
  },
  {
    file: "modules/course/enrollmentService.ts",
    reason:
      "isModuleInAccessibleCourse / isSectionInAccessibleCourse — omvendt oppslag (innhold → kurs) "
      + "for objektnivå-authz. Svarer på «er brukeren privilegert nok», ikke «hva inneholder kurset».",
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function relOf(file) {
  return file.slice(SRC.length + 1).replace(/\\/g, "/");
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function scan() {
  const rawReads = [];
  const doorCalls = [];

  for (const file of walk(SRC)) {
    const rel = relOf(file);
    const text = readFileSync(file, "utf8");

    if (rel !== ACCESSOR_FILE) {
      for (const match of text.matchAll(RAW_READ)) {
        rawReads.push({ file: rel, line: lineOf(text, match.index) });
      }
      for (const door of DOORS) {
        for (const match of text.matchAll(new RegExp(`\\b${door}\\(`, "g"))) {
          doorCalls.push({ file: rel, line: lineOf(text, match.index), door });
        }
      }
    }
  }

  return { rawReads, doorCalls };
}

describe("#958: kursets elementer hentes gjennom en navngitt dør", () => {
  it("begge dørene finnes, og er definert bare i courseRepository.ts", () => {
    // ⚠️ KONTROLLASSERTION. Uten den ville testene under blitt grønne av at dørene ble omdøpt eller
    // slettet: null kallsteder, null rå lesninger, «alt i orden». Det er nøyaktig fella som ga oss
    // en falsk «47 av 47 lokalisert», målt på en tom liste.
    const accessorSource = readFileSync(join(SRC, ...ACCESSOR_FILE.split("/")), "utf8");
    for (const door of DOORS) {
      expect(accessorSource, `${door} mangler i ${ACCESSOR_FILE}`).toContain(`${door}(courseId: string)`);
    }

    // To dører med samme navn er ingen dør.
    const duplicates = walk(SRC)
      .filter((f) => relOf(f) !== ACCESSOR_FILE)
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return DOORS.some((d) => text.includes(`${d}(courseId: string)`));
      })
      .map(relOf);
    expect(duplicates, `Dørene er redefinert utenfor aksessoren:\n${duplicates.join("\n")}`).toEqual([]);
  });

  it("dørene er faktisk i bruk — vakta har noe å måle", () => {
    const { doorCalls } = scan();

    // ⚠️ KONTROLLASSERTION. En vakt som blir grønn av å telle null er verdiløs. #958 kartla åtte
    // kallere: tre i courses.ts, bevisporten, publiseringsgaten, kaskadeslettingen, forfatterlista
    // og eksporten. Færre enn åtte betyr at vakta leter feil sted, eller at en kaller har funnet
    // snikveien utenom dørene.
    expect(
      doorCalls.length,
      `fant ${doorCalls.length} kall til dørene — leter vakta i riktig katalog?`,
    ).toBeGreaterThanOrEqual(8);

    // Begge dørene må ha kallere. Står den ene ubrukt er skillet ikke lenger levende, og neste
    // kaller velger den nærmeste framfor den riktige.
    for (const door of DOORS) {
      expect(
        doorCalls.filter((c) => c.door === door).length,
        `${door} har ingen kallere — er skillet fortsatt reelt?`,
      ).toBeGreaterThan(0);
    }
  });

  it("ingen leser courseItem.findMany utenfor aksessoren", () => {
    const { rawReads } = scan();

    // ⚠️ KONTROLLASSERTION nummer to: regexen må faktisk treffe noe. Endrer Prisma-klienten navn,
    // ville vakta ellers rapportert «null udekkede lesninger» fordi den fant null lesninger.
    expect(
      rawReads.length,
      "fant ingen courseItem.findMany i det hele tatt — treffer regexen fortsatt?",
    ).toBeGreaterThanOrEqual(EXCEPTIONS.length);

    const uncovered = rawReads
      .filter((r) => !EXCEPTIONS.some((e) => e.file === r.file))
      .map((r) => `${r.file}:${r.line}`);

    expect(
      uncovered,
      "Ny direkte lesning av CourseItem utenfor courseRepository.ts.\n"
        + "Bruk findCourseItemsForParticipant (deltakerflater) eller findAllCourseItems "
        + "(forfatter/publisering/sletting/eksport), eller legg kallstedet i EXCEPTIONS med en GRUNN:\n"
        + uncovered.join("\n"),
    ).toEqual([]);
  });

  it("unntakslista er ikke foreldet", () => {
    const { rawReads } = scan();

    // Et unntak som ikke peker på noe lenger ser ut som en vurdert avgjørelse, men dekker ingenting.
    // Da har noen enten ryddet uten å fjerne unntaket, eller flyttet lesningen — og i det andre
    // tilfellet står den nå udekket uten at noen ser det.
    const stale = EXCEPTIONS.filter((e) => !rawReads.some((r) => r.file === e.file)).map((e) => e.file);
    expect(stale, `Unntak som ikke peker på noen lesning lenger:\n${stale.join("\n")}`).toEqual([]);

    for (const e of EXCEPTIONS) {
      expect(e.reason.trim().length, `Unntak uten grunn: ${e.file}`).toBeGreaterThan(30);
    }
  });
});
