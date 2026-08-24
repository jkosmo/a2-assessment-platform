// KONTRAKTSJEKK: svarer stage med de formene deltakerklienten faktisk leser?
//
// ⚠️ HVORFOR DENNE FINNES. Deltakerflaten har 50+ e2e-tester, og alle kjører mot MOCKEDE
// API-svar. De beviser at klienten gjør det riktige GITT et svar — ikke at serveren sender det.
// `doc/TEST_AND_RELEASE_PLAYBOOK.md`: *en mocket e2e kan aldri fange at mocken er feil.* Dette er
// den halvdelen som kan.
//
// ⚠️ OG FELLA ER STILLE. Alle tre predikatene i `public/participant-console-state.js` er
// PERMISSIVE når feltet mangler:
//
//     isEntryAvailable  →  entry.available !== false      mangler ⇒ TILGJENGELIG
//     isEntryRequired   →  entry.required  !== false      mangler ⇒ PÅKREVD
//     isEntryDone       →  read === true / status PASSED  mangler ⇒ IKKE FERDIG
//
// Glemmer serveren `available`, ser en utilgjengelig modul reachable ut, deltakeren klikker, og
// får en 404 — nøyaktig feilklassen #992 handlet om. Ingen typefeil, ingen 500, ingen rød test:
// bare en deltaker som står fast. Derfor sjekker denne suiten TILSTEDEVÆRELSE og TYPE, ikke
// verdi. `undefined` er svaret vi leter etter.
//
// Feltnavnene her må være de samme som predikatene leser.
// `test/participant-sequence-predicate-guard.test.js` låser klientsiden, så de to kan ikke drifte
// fra hverandre uten at én av dem blir rød.
//
// ⚠️ LESENDE, som resten av stage-suiten. Ingenting opprettes, endres eller slettes.

import { expect, test, type APIRequestContext } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);

type CourseItem = Record<string, unknown> & { type?: unknown };
type CourseRow = Record<string, unknown> & { id?: unknown; title?: unknown };
type Loaded = { courses: CourseRow[]; details: Map<string, Record<string, unknown>> };

// ⚠️ SERIELT, OG HENTET ÉN GANG. Første utkast lot hver test hente kurslista og alle ti
// detaljvisningene selv. Med `fullyParallel: true` ble det ~33 samtidige kall, og stage svarte
// 429. `retries: 1` i konfigurasjonen gjorde at andre forsøk gikk gjennom, så FULL SUITE MELDTE
// GRØNT — en suite som bare passerer på nytt forsøk, altså nøyaktig det #994 handlet om.
// Nå: elleve kall, sekvensielt, delt av alle testene i denne fila.
test.describe.configure({ mode: "serial" });

let loaded: Loaded;

async function load(request: APIRequestContext): Promise<Loaded> {
  const headers = { Authorization: `Bearer ${auth!.accessToken}` };
  const listResponse = await request.get(`${BASE}/api/courses`, { headers });
  if (!listResponse.ok()) {
    throw new Error(`/api/courses svarte ${listResponse.status()} — kontrakten kunne ikke leses`);
  }
  const courses: CourseRow[] = (await listResponse.json())?.courses ?? [];

  const details = new Map<string, Record<string, unknown>>();
  for (const course of courses) {
    const id = String(course.id);
    const detail = await request.get(`${BASE}/api/courses/${id}`, { headers });
    if (!detail.ok()) {
      throw new Error(`«${String(course.title)}» svarte ${detail.status()} på detaljvisningen`);
    }
    details.set(id, (await detail.json())?.course ?? {});
  }
  return { courses, details };
}

/** Ett avvik, formulert slik at meldingen alene sier hva som må fikses. */
type Breach = string;

function checkItem(courseTitle: string, index: number, item: CourseItem): Breach[] {
  const where = `«${courseTitle}» element ${index} (${String(item.type ?? "UTEN TYPE")})`;
  const breaches: Breach[] = [];

  const requireBoolean = (field: string) => {
    if (typeof item[field] !== "boolean") {
      breaches.push(`${where}: '${field}' er ${JSON.stringify(item[field])}, forventet boolean`);
    }
  };
  const requireString = (field: string) => {
    if (typeof item[field] !== "string" || !String(item[field]).trim()) {
      breaches.push(`${where}: '${field}' er ${JSON.stringify(item[field])}, forventet en streng`);
    }
  };

  requireString("type");
  requireString("courseItemId");
  // De to #958 flyttet til serveren. Uten dem gjetter klienten, og gjetter permissivt.
  requireBoolean("available");
  requireBoolean("required");

  if (item.type === "MODULE") {
    requireString("moduleId");
    requireString("moduleStatus");
  } else if (item.type === "SECTION") {
    requireString("sectionId");
    // `read` avgjør om seksjonen teller som ferdig. Mangler den, er den aldri lest.
    requireBoolean("read");
  } else {
    breaches.push(`${where}: ukjent elementtype — klienten kjenner bare MODULE og SECTION`);
  }

  return breaches;
}

test.describe("utrullet stage — kontrakten deltakerklienten leser", () => {
  test.skip(!auth, `Hopper over: ${reason}`);

  test.beforeAll(async ({ request }) => {
    loaded = await load(request);
  });

  test("kurslista bærer feltene lista faktisk viser", async () => {
    const courses = loaded.courses;
    // KONTROLL: uten kurs måler resten av fila ingenting, og ville vært grønn av tomhet.
    expect(courses.length, "stage har ingen kurs — da er kontrakten uprøvd").toBeGreaterThan(0);

    const breaches: Breach[] = [];
    for (const course of courses) {
      const title = String(course?.title ?? course?.id ?? "?");
      if (typeof course?.id !== "string") breaches.push(`«${title}»: 'id' mangler`);
      if (typeof course?.title !== "string") breaches.push(`«${title}»: 'title' mangler`);
      if (typeof course?.moduleCount !== "number") breaches.push(`«${title}»: 'moduleCount' er ikke et tall`);
      if (course?.progress === undefined) breaches.push(`«${title}»: 'progress' mangler`);
    }
    expect(breaches, breaches.join("\n")).toEqual([]);
    console.log(`[stage] kurs i lista: ${courses.length}`);
  });

  test("hvert kurselement bærer available, required og statusfeltet for sin type", async () => {
    const breaches: Breach[] = [];
    const seen = { MODULE: 0, SECTION: 0, other: 0 };

    for (const course of loaded.courses) {
      const items = (loaded.details.get(String(course.id))?.items ?? []) as CourseItem[];
      items.forEach((item, index) => {
        if (item.type === "MODULE") seen.MODULE += 1;
        else if (item.type === "SECTION") seen.SECTION += 1;
        else seen.other += 1;
        breaches.push(...checkItem(String(course.title), index, item));
      });
    }

    console.log(`[stage] elementer sjekket — MODULE: ${seen.MODULE} · SECTION: ${seen.SECTION}`);

    // KONTROLL, to ledd. Null elementer betyr at løkka aldri kjørte. Null SEKSJONER betyr at den
    // sterkeste delen av kontrakten — `read`, som #944/#992/#996 alle handlet om — er uprøvd,
    // og da skal suiten si fra i stedet for å melde grønt.
    expect(seen.MODULE + seen.SECTION, "ingen kurselementer å sjekke").toBeGreaterThan(0);
    expect(seen.SECTION, "ingen SEKSJONER på stage — 'read'-kontrakten er uprøvd").toBeGreaterThan(0);

    expect(breaches, `${breaches.length} avvik:\n${breaches.join("\n")}`).toEqual([]);
  });

  test("framdriften kan ikke overstige antall elementer", async () => {
    // ⚠️ Ikke en formsjekk, men invarianten formen finnes FOR. Regnestykket bor på serveren nå
    // (#958), så det er her det kan verifiseres mot ekte innhold i stedet for mot en mock.
    const breaches: Breach[] = [];
    let checked = 0;

    for (const course of loaded.courses) {
      const c = loaded.details.get(String(course.id)) ?? {};
      const items = (c.items ?? []) as CourseItem[];
      if (items.length === 0) continue;
      checked += 1;

      const done = items.filter((i) =>
        i.type === "SECTION" ? i.read === true : i.moduleStatus === "PASSED",
      ).length;
      const total = items.length;

      // Framdrift kan ikke overstige antall elementer, og kan ikke være negativ. En teller som
      // sprekker her betyr at serveren og klienten teller ulike ting — #979.
      const progress = (c.progress ?? {}) as Record<string, unknown>;
      const completed = Number(progress.completed ?? progress.done ?? done);
      if (!Number.isFinite(completed) || completed < 0 || completed > total) {
        breaches.push(
          `«${course.title}»: progress.completed = ${JSON.stringify(progress)} mot ${total} elementer`,
        );
      }
    }

    expect(checked, "ingen kurs med elementer — invarianten er uprøvd").toBeGreaterThan(0);
    expect(breaches, breaches.join("\n")).toEqual([]);
    console.log(`[stage] framdriftsinvarianten sjekket på ${checked} kurs`);
  });
});
