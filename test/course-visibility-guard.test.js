import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// DEKNINGSVAKT: hver kaller av findCourseById må avgjøre synlighet — eller stå oppført.
//
// `findCourseById` returnerer kurset uten å filtrere på noe. Regelen «hvem får se dette kurset»
// bor derfor hos kalleren, og finnes i dag i fire varianter i `enrollmentService.ts` alene.
//
// ⚠️ Dette har allerede kostet oss ett hull. Kommentaren i enrollmentService.ts:271-277:
//
//     #778/#785 — «the direct endpoints gated only on publishedAt, so an unenrolled participant
//     with a RESTRICTED course id could read its content.»
//
// Fiksen den gangen la til en FJERDE kopi av regelen i stedet for å flytte den ned i aksessoren.
// Kaller nummer ni vil gjenskape #778 nøyaktig, og ingenting stopper den.
//
// ⚠️ OPPDATERT #959, 2026-08-23: den riktige kuren ER nå gjort.
//
// `findCourseForParticipant` (enrollmentService) er den ene døra inn til «dette kurset, sett av
// denne deltakeren». Signaturen KREVER identiteten, så synligheten kan ikke lenger glemmes — og de
// tre deltakerrutene som hver hadde sin egen etterkontroll bruker den nå.
//
// Vakta har dermed byttet rolle. Den er ikke lenger en nødløsning som gjør drift synlig; den låser
// inn gevinsten: `findCourseById` er ufiltrert og hører til forfatter-, eksport- og systemflatene.
// Dukker den opp i en deltakerrute igjen, er det en regresjon.
//
// Unntakslista er fortsatt poenget for resten. Hver oppføring må ha en grunn noen har skrevet ned.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = fileURLToPath(new URL("../src", import.meta.url));

// Et kallsted er dekket hvis rutehodet bærer eierskaps-middleware, ELLER hvis kroppen kaller en
// av disse. `selfEnroll` står bevisst IKKE her: den sjekker `enrollmentPolicy !== "OPEN"`, som er
// en fjerde formulering av spørsmålet — nettopp det vakta skal gjøre synlig.
const VISIBILITY_MARKERS = ["isCourseVisibleToUser", "filterVisibleCourseIds"];
const ROUTE_GUARD = "requireContentOwnership";

// Kjente kallsteder uten synlighetssjekk. Hver MÅ ha en grunn. Vokser lista, vet man det —
// og det er signalet: en unntaksliste som vokser er slitasje som samler seg.
const EXCEPTIONS = [
  {
    file: "routes/adminCourses.ts",
    route: 'get("/:courseId"',
    reason: "Admin-lesing er uguardet mens tolv skriveruter i samme fil er guardet. Kjent hull, #943.",
  },
  {
    file: "routes/courses.ts",
    route: 'post("/:courseId/enroll"',
    reason:
      "#959: det ENESTE bevisste unntaket. Selvpåmelding må kunne SE et RESTRICTED kurs for å kunne "
      + "svare «dette krever tildeling» (400). Gjennom deltakerdøra ville svaret blitt 404, og "
      + "deltakeren fikk vite at kurset ikke finnes framfor hvordan hen får tilgang. Regelen er "
      + "flyttet til selfEnroll, ikke glemt — m2-enrollment pinner 400-en.",
  },
  {
    file: "modules/adminContent/adminContentQueries.ts",
    route: null,
    reason: "Eksportbygger, ikke en rute. Kalleren GET /:courseId/export-package har requireContentOwnership (#903).",
  },
  {
    file: "modules/course/courseCompletionService.ts",
    route: null,
    reason:
      "Serverside evaluering for en gitt userId — leser ikke ut innhold til noen. Har sin egen "
      + "publisert/arkivert-vakt, og synlighet er ikke spørsmålet her.",
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

// Nærmeste rutehode FØR kallstedet. Ved konstruksjon er det den omsluttende ruta.
const ROUTE_HEAD = /^\s*\w+Router\.(get|post|put|patch|delete)\(/;

function findCallSites() {
  const sites = [];
  for (const file of walk(SRC)) {
    const rel = relOf(file);
    if (rel.endsWith("courseRepository.ts")) continue; // definisjonen selv
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    lines.forEach((line, i) => {
      if (!line.includes("findCourseById(")) return;

      let routeLine = null;
      for (let j = i; j >= 0; j--) {
        if (ROUTE_HEAD.test(lines[j])) { routeLine = lines[j]; break; }
      }

      // Kroppen: fra kallstedet til neste rutehode, eller 40 linjer. Vaktene ligger alltid rett
      // etter oppslaget — står de lenger unna, har kurset allerede vært i bruk.
      const body = [];
      for (let j = i; j < Math.min(lines.length, i + 40); j++) {
        if (j > i && ROUTE_HEAD.test(lines[j])) break;
        body.push(lines[j]);
      }
      const bodyText = body.join("\n");

      sites.push({
        file: rel,
        line: i + 1,
        routeLine,
        guardedByRoute: Boolean(routeLine && routeLine.includes(ROUTE_GUARD)),
        guardedByBody: VISIBILITY_MARKERS.some((m) => bodyText.includes(m)),
      });
    });
  }
  return sites;
}

function isExcepted(site) {
  return EXCEPTIONS.some((e) => {
    if (e.file !== site.file) return false;
    if (e.route === null) return true;
    return Boolean(site.routeLine && site.routeLine.includes(e.route));
  });
}

describe("findCourseById: hver kaller avgjør synlighet, eller står på unntakslista", () => {
  it("ingen udekkede kallere", () => {
    const sites = findCallSites();

    // ⚠️ KONTROLLASSERTION. Endrer noen filstruktur eller navn, ville vakta ellers blitt grønn
    // ved å måle NULL kallsteder — den fella har allerede gitt oss en falsk «47 av 47 er
    // lokalisert» og en test som bestod ved å sjekke en tom liste.
    expect(sites.length, "fant ingen kallsteder — leter vakta i riktig katalog?").toBeGreaterThanOrEqual(6);

    const uncovered = sites
      .filter((s) => !s.guardedByRoute && !s.guardedByBody && !isExcepted(s))
      .map((s) => `${s.file}:${s.line}${s.routeLine ? ` (${s.routeLine.trim().slice(0, 60)})` : ""}`);

    expect(
      uncovered,
      "Nye kallere av findCourseById uten synlighetssjekk.\n"
        + "Enten kall isCourseVisibleToUser, eller legg kallstedet i EXCEPTIONS med en GRUNN:\n"
        + uncovered.join("\n"),
    ).toEqual([]);
  });

  it("#959: deltakerrutene henter kurs gjennom døra, ikke gjennom den ufiltrerte aksessoren", () => {
    // ⚠️ Dette er låsen. `findCourseForParticipant` krever hvem som spør; `findCourseById` gjør det
    // ikke. Så lenge deltakerrutene bare bruker den første, kan #778 ikke gjenskapes ved en
    // forglemmelse — man må aktivt velge feil dør.
    const sites = findCallSites().filter((s) => s.file === "routes/courses.ts");
    const notExcepted = sites.filter((s) => !isExcepted(s)).map((s) => `courses.ts:${s.line}`);

    expect(
      notExcepted,
      "findCourseById i en deltakerrute. Bruk findCourseForParticipant — den KREVER identiteten,\n"
        + "så synligheten kan ikke bli glemt. Er dette et ekte unntak (som selvpåmelding), før det\n"
        + "opp i EXCEPTIONS med en grunn.\n"
        + notExcepted.join("\n"),
    ).toEqual([]);

    // KONTROLLASSERTION: døra må faktisk være i bruk. Uten denne ville testen vært grønn hvis noen
    // slettet alle kallene — altså hvis ruta sluttet å hente kurs i det hele tatt.
    const routeSrc = readFileSync(join(SRC, "routes", "courses.ts"), "utf8");
    const uses = [...routeSrc.matchAll(/findCourseForParticipant\(/g)].length;
    expect(uses, "deltakerdøra brukes ikke i courses.ts — måler vakta noe i det hele tatt?")
      .toBeGreaterThanOrEqual(3);
  });

  it("unntakslista er ikke foreldet", () => {
    const sites = findCallSites();

    // En unntaksoppføring som ikke lenger peker på noe er verre enn ingen: den ser ut som en
    // vurdert avgjørelse, men dekker ingenting. Da har noen enten fikset kallstedet uten å rydde,
    // eller flyttet det — og i det andre tilfellet er kallstedet nå udekket uten at noen ser det.
    const stale = EXCEPTIONS.filter(
      (e) => !sites.some((s) => s.file === e.file && (e.route === null || (s.routeLine ?? "").includes(e.route))),
    ).map((e) => `${e.file}${e.route ? ` ${e.route}` : ""}`);

    expect(stale, `Unntak som ikke peker på noe kallsted lenger:\n${stale.join("\n")}`).toEqual([]);

    // Og hver oppføring må faktisk ha en grunn — en tom streng er ikke en vurdering.
    for (const e of EXCEPTIONS) {
      expect(e.reason.trim().length, `Unntak uten grunn: ${e.file}`).toBeGreaterThan(30);
    }
  });
});
