// Autentiserte tester mot UTRULLET stage med REELLE data.
//
// Produkteier, 2026-08-19: *«Alt annet bør testes via Playwright, dette inkluderer å teste mot Stage
// slik at du kan teste mot reelle data.»* Dette er den halvdelen som krever innlogging.
//
// Sesjonen fanges én gang med `npm run stage:auth` (åpner en ekte nettleser, du logger inn, og
// access-tokenet lagres i den gitignorerte `.stage-auth.json`). Uten fila hopper alt under over —
// suiten skal aldri feile fordi noen ikke har logget inn, bare fortelle at den ikke kjørte.
//
// ⚠️ **Disse testene er LESENDE.** De oppretter ikke innhold, endrer ikke innhold og sletter ikke
// innhold på stage. Det er et bevisst valg: stage er et testmiljø, men det er også der produkteier
// har innhold hen faktisk tester med, og en suite som rydder «sitt eget» innhold er én feilslått
// filtrering unna å rydde noe annet. Trenger vi skrivende tester, får de opprette i en egen,
// tydelig merket sandkasse.

import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";

// ⚠️ `title` er en TEKSTKOLONNE i databasen. Et språkkart lagres som en JSON-STRENG, så
// `typeof title === "string"` er sant for BEGGE former og måler ingenting. Første versjon av
// denne suiten gjorde nettopp den feilen og rapporterte 47 av 47 seksjoner som ettspråks — et
// alarmerende tall som ikke betydde noe. Serveren gjør det samme som her, i `localizedTextCodec`.
type LocaleShape = "one-language" | "partial" | "complete" | "identical-copies";

function classifyLocalized(raw: unknown): LocaleShape {
  if (typeof raw !== "string") return "one-language";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "one-language"; // ren tekst, ikke JSON — «ett språk, ikke oversatt ennå»
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "one-language";
  const map = parsed as Record<string, unknown>;
  const locales = ["en-GB", "nb", "nn"];
  const present = locales.filter((l) => typeof map[l] === "string" && String(map[l]).trim());
  if (present.length === 0) return "one-language";
  if (present.length < locales.length) return "partial";
  // Alle tre finnes, men identiske: den gamle løgnen fra #892. Gaten ser dem som komplette.
  const values = locales.map((l) => String(map[l]));
  return new Set(values).size === 1 ? "identical-copies" : "complete";
}

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);

test.describe("utrullet stage — reelle data", () => {
  test.skip(!auth, `Hopper over: ${reason}`);

  const headers = () => ({ Authorization: `Bearer ${auth!.accessToken}` });

  test("sesjonen er den vi tror, og har forfatterrettigheter", async ({ request }) => {
    const me = await request.get(`${BASE}/api/me`, { headers: headers() });
    expect(me.ok()).toBe(true);
    const body = await me.json();
    const roles: string[] = body?.roles ?? body?.user?.roles ?? [];
    // Uten en av disse er resten av suiten meningsløs — den ville målt 403 og kalt det en test.
    expect(
      roles.some((r) => r === "SUBJECT_MATTER_OWNER" || r === "ADMINISTRATOR"),
      `sesjonen har rollene ${roles.join(", ") || "(ingen)"} — trenger SMO eller ADMINISTRATOR`,
    ).toBe(true);
  });

  // ── Det som ikke kan mockes: hvordan gaten leser innhold som faktisk finnes ────────────────
  //
  // Publiseringsgaten gjelder nå seksjoner (#916), og stage har innhold skrevet før gaten fantes.
  // Spørsmålet er ikke om gaten virker — det er dekket av integrasjonstester — men hvor mange
  // forfattere den låser ute fra innhold som virket i går. Det kan bare ekte data svare på.
  test("kartlegger hvor mye eksisterende innhold den nye seksjonsgaten ville blokkere", async ({ request }) => {
    const response = await request.get(`${BASE}/api/admin/content/sections`, { headers: headers() });
    expect(response.ok(), `sections svarte ${response.status()}`).toBe(true);

    const sections: Array<{ id: string; title: unknown; activeVersionId?: string | null }> =
      (await response.json()).sections ?? [];

    const tally = { "one-language": 0, partial: 0, complete: 0, "identical-copies": 0 };
    for (const s of sections) tally[classifyLocalized(s.title)] += 1;

    // Bare seksjoner som er UPUBLISERTE kan låse et kurs — en live gammel seksjon slipper gjennom
    // kaskaden (`evaluateSection` kortslutter på `if (!unpublished)`). Skill dem, ellers ser tallet
    // verre ut enn virkeligheten.
    const blockingShape = sections.filter((s) => ["one-language", "partial"].includes(classifyLocalized(s.title)));
    const unpublishedAndBlocking = blockingShape.filter((s) => !s.activeVersionId);

    // Ingen terskel — dette er en MÅLING, ikke en grense. Tallet er svaret #932 trenger, og å
    // feile på det ville bare skjult det.
    console.log(
      `[stage] seksjoner: ${sections.length}`
      + ` · ettspråks: ${tally["one-language"]}`
      + ` · delvis: ${tally.partial}`
      + ` · komplett: ${tally.complete}`
      + ` · tre identiske kopier: ${tally["identical-copies"]}`
      + ` — av disse UPUBLISERTE med hull (kan låse et kurs): ${unpublishedAndBlocking.length}`,
    );

    expect(Array.isArray(sections)).toBe(true);
  });

  test("kartlegger det samme for moduler", async ({ request }) => {
    const response = await request.get(`${BASE}/api/admin/content/modules`, { headers: headers() });
    expect(response.ok(), `modules svarte ${response.status()}`).toBe(true);

    const modules: Array<{ id: string; title: unknown }> = (await response.json()).modules ?? [];

    const tally = { "one-language": 0, partial: 0, complete: 0, "identical-copies": 0 };
    for (const m of modules) tally[classifyLocalized(m.title)] += 1;

    // `identical-copies` er den gamle løgnen fra #892: tre kopier av samme tekst PASSERER gaten,
    // men er ikke oversatt. Gaten kan ikke se dem — vi kan telle dem her.
    console.log(
      `[stage] moduler: ${modules.length}`
      + ` · ettspråks: ${tally["one-language"]}`
      + ` · delvis: ${tally.partial}`
      + ` · komplett: ${tally.complete}`
      + ` · tre identiske kopier (#892-arv, usynlig for gaten): ${tally["identical-copies"]}`,
    );

    expect(Array.isArray(modules)).toBe(true);
  });

  // ── Formen på ekte svar, ikke formen vi mocket ────────────────────────────────────────────
  //
  // Modultype-funnet fra stage var nettopp dette: e2e-en er grønn fordi mocken bygger en modul som
  // har alt. Her ser vi hva serveren faktisk sender for en ekte modul.
  test("bundlen bærer versjonshistorikken Innstillinger trenger for modultype", async ({ request }) => {
    const list = await request.get(`${BASE}/api/admin/content/modules`, { headers: headers() });
    const modules: Array<{ id: string }> = (await list.json()).modules ?? [];
    test.skip(modules.length === 0, "ingen moduler på stage å inspisere");

    const bundle = await request.get(
      `${BASE}/api/admin/content/modules/${modules[0].id}/export`,
      { headers: headers() },
    );
    expect(bundle.ok(), `modules/:id/export svarte ${bundle.status()}`).toBe(true);

    const payload = await bundle.json();
    const body = payload.moduleExport ?? payload;
    // `renderSettingsPanel` leser tilgjengelige modultyper ut av HISTORIKKEN, ikke ut av gjeldende
    // versjons pekere. Mangler disse i det ekte svaret, er hvert valg deaktivert uansett hva
    // modulen inneholder — og det er akkurat det produkteier så.
    expect(body.versions, "bundlen mangler `versions`").toBeTruthy();
    for (const key of ["moduleVersions", "rubricVersions", "promptTemplateVersions", "mcqSetVersions"]) {
      expect(Array.isArray(body.versions?.[key]), `versions.${key} er ikke en liste`).toBe(true);
    }
  });

  // ── Eierskap, mot ekte roller ─────────────────────────────────────────────────────────────
  //
  // #903 finnes fordi en eksportrute gikk i produksjon uten eierskapssjekk. Her er de nye rutene
  // fra #916, mot en ekte innlogget bruker.
  // ── Det avgjørende spørsmålet før prod ────────────────────────────────────────────────────
  //
  // Publiseringsgaten gjelder nå seksjoner (#916), og 12 av de 47 seksjonene på stage er
  // upubliserte med et språkhull. Spørsmålet er ikke om gaten fyrer — det er dekket av
  // integrasjonstester — men **hva forfatteren faktisk får se**, og om det finnes en vei videre.
  //
  // `publish-preview` er en GET som bare beregner. Ingenting publiseres, ingenting endres. Det er
  // også nøyaktig det arbeidsflaten kaller før den viser dialogen, så vi ser det forfatteren ser.
  test("en blokkert kurspublisering navngir felt og språk, ikke bare «det gikk ikke»", async ({ request }) => {
    const list = await request.get(`${BASE}/api/admin/content/courses`, { headers: headers() });
    expect(list.ok(), `courses svarte ${list.status()}`).toBe(true);
    const courses: Array<{ id: string; title?: unknown }> = (await list.json()).courses ?? [];
    test.skip(courses.length === 0, "ingen kurs på stage");

    const previews: Array<{ id: string; publishable: boolean; items: unknown[] }> = [];
    for (const course of courses) {
      const response = await request.get(
        `${BASE}/api/admin/content/courses/${course.id}/publish-preview`,
        { headers: headers() },
      );
      if (!response.ok()) continue;
      const body = await response.json();
      previews.push({
        id: course.id,
        publishable: Boolean(body.publishable),
        items: body.unpublishedItems ?? [],
      });
    }

    const blocked = previews.filter((p) => !p.publishable);
    console.log(
      `[stage] kurs: ${courses.length} · publiserbare: ${previews.length - blocked.length}`
      + ` · blokkert av gaten: ${blocked.length}`,
    );

    test.skip(blocked.length === 0, "ingen kurs er blokkert — ingenting å inspisere");

    // Hent ut blokkeringene for det første blokkerte kurset og se på FORMEN. Det er den som
    // avgjør om klienten kan skrive en lesbar melding på forfatterens språk, eller må falle
    // tilbake på serverens engelske `message` — som er #914.
    const sample = blocked[0];
    type Blocker = Record<string, unknown> & { itemType?: string };
    const blockers: Blocker[] = (sample.items as Array<{ type?: string; blockers?: Array<Record<string, unknown>> }>)
      .flatMap((item) => (item.blockers ?? []).map((b): Blocker => ({ itemType: item.type, ...b })));

    console.log(`[stage] blokkeringer på første blokkerte kurs: ${JSON.stringify(blockers, null, 2)}`);

    expect(blockers.length, "kurset er blokkert, men uten en eneste blokkeringsgrunn").toBeGreaterThan(0);

    // Oversettelseshull MÅ bære strukturerte data. Uten `field` + `missingLocales` kan klienten
    // ikke bygge «Tittel — mangler nn» på forfatterens språk, og forfatteren får serverens
    // engelske setning midt i et norsk UI.
    const translationGaps = blockers.filter((b) => b.code === "translation_incomplete");
    for (const gap of translationGaps) {
      expect(gap.field, `translation_incomplete uten felt: ${JSON.stringify(gap)}`).toBeTruthy();
      expect(
        Array.isArray(gap.missingLocales) && (gap.missingLocales as unknown[]).length > 0,
        `translation_incomplete uten missingLocales: ${JSON.stringify(gap)}`,
      ).toBe(true);
    }
  });

  // ── Prioritet 0, tidskritisk: #923-tellingen ──────────────────────────────────────────────
  //
  // #923 skjuler diskusjon per element uten å slette noe. Produkteier ville verifisere at
  // funksjonen ikke er i aktiv bruk før den skjules.
  //
  // ⚠️ Vinduet lukker seg: `replaceCourseItems` gjør `deleteMany` + `createMany` ved HVER lagring
  // av en kurssekvens, og `DiscussionThread.courseItem` er `onDelete: SetNull`. Tråder på
  // elementnivå slettes ikke — de forfremmes til KURSNIVÅ neste gang en SMO lagrer et kurs, og da
  // er de ikke lenger tellbare som elementtråder. Tallet må tas før noen lagrer et kurs.
  test("teller diskusjonstråder på elementnivå før de blir utellelige", async ({ request }) => {
    const courses: Array<{ id: string; title?: unknown }> =
      (await (await request.get(`${BASE}/api/admin/content/courses`, { headers: headers() })).json()).courses ?? [];
    test.skip(courses.length === 0, "ingen kurs på stage");

    let courseLevel = 0;
    let itemLevel = 0;
    const itemLevelCourses: string[] = [];

    for (const course of courses) {
      // Kursnivå: `itemId` utelatt.
      const atCourse = await request.get(
        `${BASE}/api/courses/${course.id}/discussions`,
        { headers: headers() },
      );
      if (atCourse.ok()) courseLevel += ((await atCourse.json()).threads ?? []).length;

      // Elementnivå: én forespørsel per element i sekvensen.
      const detail = await request.get(`${BASE}/api/courses/${course.id}`, { headers: headers() });
      if (!detail.ok()) continue;
      const items: Array<{ courseItemId?: string }> = (await detail.json()).course?.items ?? [];
      for (const item of items) {
        if (!item.courseItemId) continue;
        const atItem = await request.get(
          `${BASE}/api/courses/${course.id}/discussions?itemId=${encodeURIComponent(item.courseItemId)}`,
          { headers: headers() },
        );
        if (!atItem.ok()) continue;
        const count = ((await atItem.json()).threads ?? []).length;
        if (count > 0) {
          itemLevel += count;
          if (!itemLevelCourses.includes(course.id)) itemLevelCourses.push(course.id);
        }
      }
    }

    console.log(
      `[stage] diskusjonstråder — kursnivå: ${courseLevel} · ELEMENTNIVÅ: ${itemLevel}`
      + (itemLevel > 0 ? ` (i kursene: ${itemLevelCourses.join(", ")})` : " — ingen i aktiv bruk"),
    );

    // Ingen grense: dette er tallet #932 ber om, ikke en test som skal feile. Å feile på det
    // ville skjult svaret bak en rød kjøring.
    expect(itemLevel).toBeGreaterThanOrEqual(0);
  });

  // ── Prioritet 1.2, delvis: får deltakeren en blank seksjon? ────────────────────────────────
  //
  // Blokker 1 i QA var at et kurs kunne publiseres rundt en seksjon uten aktiv versjon —
  // deltakeren fikk 200 med tom `html`. Det er rettet i koden, men spørsmålet her er om det
  // allerede FINNES slike seksjoner på stage fra før rettelsen.
  test("ingen publisert seksjon serverer en tom side til deltakeren", async ({ request }) => {
    const courses: Array<{ id: string }> =
      (await (await request.get(`${BASE}/api/courses`, { headers: headers() })).json()).courses ?? [];
    test.skip(courses.length === 0, "ingen publiserte kurs synlige");

    const blank: string[] = [];
    let checked = 0;

    for (const course of courses) {
      const detail = await request.get(`${BASE}/api/courses/${course.id}`, { headers: headers() });
      if (!detail.ok()) continue;
      // Formen er `course.items[]` med `sectionId` / `moduleId` flatt på elementet — ikke et
      // nøstet `section`-objekt. Første versjon leste `item.section.id`, fant ingenting, og
      // «bestod» ved å sjekke null seksjoner. En test som består fordi den ikke fant noe å
      // sjekke, er en test som lyver.
      const items: Array<{ type?: string; sectionId?: string }> =
        (await detail.json()).course?.items ?? [];
      for (const item of items) {
        const sectionId = item.sectionId;
        if (item.type !== "SECTION" || !sectionId) continue;
        const view = await request.get(
          `${BASE}/api/courses/${course.id}/sections/${sectionId}`,
          { headers: headers() },
        );
        if (!view.ok()) continue;
        checked += 1;
        const html = String((await view.json()).html ?? "");
        // 200 med tom kropp er den nøyaktige signaturen på blokker 1: siden lastes, deltakeren ser
        // ingenting, og «marker lest» teller den likevel mot kursbeviset.
        if (!html.trim()) blank.push(`${course.id}/${sectionId}`);
      }
    }

    console.log(`[stage] deltakersynlige seksjoner sjekket: ${checked} · tomme: ${blank.length}`);
    // Vakt mot en tom bestått test: fant vi ingen seksjoner i det hele tatt, har vi ikke målt
    // noe — og det skal ikke se ut som et grønt resultat.
    expect(checked, "fant ingen deltakersynlige seksjoner å sjekke — testen målte ingenting").toBeGreaterThan(0);
    expect(blank, `disse serverer en tom side: ${blank.join(", ")}`).toEqual([]);
  });

  test("seksjonseksport svarer for egne seksjoner og 404/403 for tull", async ({ request }) => {
    const bogus = await request.get(
      `${BASE}/api/admin/content/sections/not-a-real-section-id/export-package`,
      { headers: headers() },
    );
    // Enten «finnes ikke» eller «ikke din» — men aldri 200, og aldri 500.
    expect([403, 404]).toContain(bogus.status());
  });
});
