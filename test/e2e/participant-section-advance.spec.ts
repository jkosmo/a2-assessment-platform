import { test, expect, type Page, type Route } from "@playwright/test";

// #924 + #923 — seksjonsleseren.
//
// #924: To knapper der den ene alltid fulgte den andre er ikke et valg. «Marker seksjon lest, og gå
//       videre» er én handling. «Videre» følger kursets ELEMENTREKKE, ikke elementtypen: er neste
//       element en modul, skal deltakeren dit — ikke forbi vurderingen som var lagt der med vilje.
//       Knappeteksten må si hvilken av delene det er.
// #923: Diskusjon finnes bare på kursnivå. Leseren har ikke lenger sitt eget board — tre nivåer
//       delte en liten samtale i tre halvdøde tråder.
//
// Alt dette lever i klientlaget og er usynlig for supertest.

async function mockBase(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] },
        },
        calibrationWorkspace: { accessRoles: [] },
        flow: {},
        output: {},
      }),
    }),
  );
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }),
  );
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } }),
    }),
  );
  await page.route("**/api/queue-counts", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 3, courseStatus: "NOT_STARTED" } }],
      }),
    }),
  );
}

// Kursrekka: seksjon → seksjon → modul. Diskusjon er påslått både på kurset og på hvert element,
// nettopp for at #923-vakten skal bevise at inngangen er fjernet og ikke bare skrudd av.
const readSections = new Set<string>();

async function mockCourse(page: Page) {
  readSections.clear();
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        course: {
          id: "c1",
          title: "Kurs",
          discussionsEnabled: true,
          items: [
            { type: "SECTION", sectionId: "s1", courseItemId: "ci1", title: "Første seksjon", read: readSections.has("s1"), discussionsEnabled: true },
            { type: "SECTION", sectionId: "s2", courseItemId: "ci2", title: "Andre seksjon", read: readSections.has("s2"), discussionsEnabled: true },
            { type: "MODULE", moduleId: "m1", courseItemId: "ci3", title: "Testen", moduleStatus: "NOT_STARTED", available: true, discussionsEnabled: true },
          ],
        },
      }),
    }),
  );
  for (const [id, title] of [["s1", "Første seksjon"], ["s2", "Andre seksjon"]]) {
    await page.route(`**/api/courses/c1/sections/${id}`, (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title, html: `<p>Tekst i ${id}</p>` }) }),
    );
    await page.route(`**/api/courses/c1/sections/${id}/read`, (route: Route) => {
      readSections.add(id);
      return route.fulfill({ status: 204, body: "" });
    });
  }
  // Modul-arbeidsflaten trenger modulen i deltakerens modul-liste.
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          { id: "m1", title: "Testen", description: null, assessmentMode: "FREETEXT_PLUS_MCQ", submissionSchema: null, assessmentPolicy: null, taskText: "Oppgave", activeVersion: { versionNo: 1 }, participantStatus: null },
        ],
      }),
    }),
  );
  await page.route("**/api/courses/c1/discussions**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ threads: [], canPost: true }) }),
  );
}

async function openCourse(page: Page) {
  await page.goto("/participant");
  await expect(page.locator(".course-accordion-item")).toHaveCount(1);
  await page.locator(".course-accordion-header").click();
  await expect(page.locator(".course-sequence")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
});

test("#924: neste element er en seksjon — én knapp som markerer lest og åpner neste", async ({ page }) => {
  await mockBase(page);
  await mockCourse(page);
  await openCourse(page);

  const first = page.locator('.course-item[data-key="ci1"]');
  await first.locator(".course-module-row").click();
  await expect(first.locator("#sectionReaderBody")).toContainText("Tekst i s1");

  // Én knapp — ikke «marker lest» pluss «gå til neste».
  await expect(first.locator(".course-inline-actions button")).toHaveCount(1);
  await expect(first.locator("#sectionReaderMarkRead")).toHaveText("Marker seksjon lest, og gå videre");

  await first.locator("#sectionReaderMarkRead").click();

  // Lesningen er registrert, OG neste element står åpent. Ett klikk, begge deler.
  await expect.poll(() => readSections.has("s1")).toBe(true);
  const second = page.locator('.course-item[data-key="ci2"]');
  await expect(second.locator("#sectionReaderBody")).toContainText("Tekst i s2");
  await expect(first.locator("#sectionReaderBody")).toHaveCount(0);
});

test("#924: neste element er en MODUL — knappen sier det, og fører dit", async ({ page }) => {
  await mockBase(page);
  await mockCourse(page);
  await openCourse(page);

  // Andre seksjon: neste element i rekka er en modul, ikke en seksjon.
  const second = page.locator('.course-item[data-key="ci2"]');
  await second.locator(".course-module-row").click();
  await expect(second.locator("#sectionReaderBody")).toContainText("Tekst i s2");

  // Knappen sier det den faktisk gjør. Den generiske «gå videre» ville skjult at det som kommer
  // er en vurdering.
  await expect(second.locator("#sectionReaderMarkRead")).toHaveText("Marker seksjon lest, og gå til testen");

  await second.locator("#sectionReaderMarkRead").click();

  await expect.poll(() => readSections.has("s2")).toBe(true);
  // Modulen åpnes inline under sin egen rad — deltakeren hoppet ikke forbi den til «neste seksjon».
  const moduleItem = page.locator('.course-item[data-key="ci3"]');
  await expect(moduleItem.locator(".course-inline-panel #submissionSection")).toBeVisible();
});

test("#923: seksjonsleseren har ikke lenger sitt eget diskusjonsboard — kursnivået har det", async ({ page }) => {
  await mockBase(page);
  await mockCourse(page);
  await openCourse(page);

  const first = page.locator('.course-item[data-key="ci1"]');
  await first.locator(".course-module-row").click();
  await expect(first.locator("#sectionReaderBody")).toContainText("Tekst i s1");

  // Elementet har discussionsEnabled:true og en courseItemId — likevel skal leseren ikke ha noe
  // board. Inngangen er fjernet, ikke skrudd av: eksisterende tråder ligger urørt i basen.
  await expect(first.locator("#sectionReaderDiscussion")).toHaveCount(0);
  await expect(first.locator(".discussion-panel")).toHaveCount(0);

  // Kursnivået er den ene gjenværende diskusjonen — den skal fortsatt være der (kollapset).
  await expect(page.locator(".course-discussion-toggle")).toBeVisible();
  await page.locator(".course-discussion-toggle").click();
  await expect(page.locator(".course-discussion-body .discussion-panel")).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// #929: «Avslutt kurset» på siste element — men bare når alt annet er ferdig.
//
// Produkteier testet flyten på stage 2026-08-20 og meldte den inn som en feil: hen besto modulen,
// leste seksjonen, og det fantes ingen knapp for å fullføre. Kursbeviset BLE utstedt — stille, av
// `markFinalSectionReadSilently`, på et kort hen ikke så på.
//
// Kurset her har modulen FØRST og seksjonen SIST, som produkteiers eget. Det gjør at
// «alt annet er ferdig» avhenger av modulen, ikke av posisjon.
// ---------------------------------------------------------------------------
async function mockCourseWithTrailingSection(page: Page, moduleStatus: string) {
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        course: {
          id: "c1",
          title: "Kurs",
          discussionsEnabled: true,
          items: [
            { type: "MODULE", moduleId: "m1", courseItemId: "ci1", title: "Testen", moduleStatus, available: true, discussionsEnabled: true },
            { type: "SECTION", sectionId: "s1", courseItemId: "ci2", title: "Lesestoff", read: false, discussionsEnabled: true },
          ],
        },
      }),
    }),
  );
  await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Lesestoff", html: "<p>Tekst</p>" }) }),
  );
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [] }) }),
  );
  await page.route("**/api/courses/c1/discussions**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ threads: [], canPost: true }) }),
  );
}

test("#929: siste element med alt annet ferdig gir «Avslutt kurset»", async ({ page }) => {
  await mockBase(page);
  await mockCourseWithTrailingSection(page, "PASSED");

  let readCalled = false;
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => {
    readCalled = true;
    return route.fulfill({ status: 204, body: "" });
  });

  await openCourse(page);
  await page.locator('.course-item[data-key="ci2"] .course-module-row').click();

  await expect(page.locator("#sectionReaderFinish")).toBeVisible();
  await expect(page.locator("#sectionReaderFinish")).toHaveText(/Avslutt kurset/);
  // Ingen «gå videre»-knapp: det finnes ingenting å gå videre til.
  await expect(page.locator("#sectionReaderMarkRead")).toHaveCount(0);

  // Lesningen skal ikke være registrert før deltakeren bekrefter. Dette er hele forskjellen fra
  // den stille varianten #929 erstatter.
  expect(readCalled).toBe(false);

  await page.locator("#sectionReaderFinish").click();
  await expect.poll(() => readCalled).toBe(true);
});

test("#929: gjenstår det noe, er det ingen knapp — men en forklaring", async ({ page }) => {
  await mockBase(page);
  await mockCourseWithTrailingSection(page, "NOT_STARTED");

  let readCalled = false;
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => {
    readCalled = true;
    return route.fulfill({ status: 204, body: "" });
  });

  await openCourse(page);
  await page.locator('.course-item[data-key="ci2"] .course-module-row').click();
  await expect(page.locator("#sectionReaderBody")).toContainText("Tekst");

  // Modulen er ikke bestått, så kurset kan ikke avsluttes.
  await expect(page.locator("#sectionReaderFinish")).toHaveCount(0);
  await expect(page.locator("#sectionReaderMarkRead")).toHaveCount(0);

  // ⚠️ Og deltakeren skal FÅ VITE hvorfor. En blindvei uten begrunnelse er verre enn en manglende
  // knapp: man vet ikke om det er en selv eller systemet det er noe galt med.
  await expect(page.locator(".course-inline-actions")).toContainText(/1 igjen/);

  // Og ingenting registreres i det stille bare fordi siden ble åpnet.
  expect(readCalled).toBe(false);
});

// ---------------------------------------------------------------------------
// #992: blindveien klienten selv laget.
//
// #944 ga seksjoner et ekte `available`-felt og lot serveren svare 404 på utilgjengelige. Men
// klienten hadde `const available = isSection || entry.available !== false` — skrevet den gang bare
// moduler hadde feltet — og tre andre steder med hver sin variant. Serveren filtrerte, klienten
// ikke, og deltakeren satt igjen mellom to svar.
//
// ⚠️ Dette er en REGRESJON vi innførte selv i 2.26.1. Uten disse to testene ville den bare vært
// synlig på et ekte kurs med arkivert innhold — altså først i produksjon.
// ---------------------------------------------------------------------------
async function mockCourseWithUnavailable(
  page: Page,
  items: Array<Record<string, unknown>>,
  sectionIds: string[],
) {
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ course: { id: "c1", title: "Kurs", discussionsEnabled: false, items } }),
    }),
  );
  for (const id of sectionIds) {
    await page.route(`**/api/courses/c1/sections/${id}`, (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: id, html: `<p>Tekst i ${id}</p>` }) }),
    );
  }
  await page.route("**/api/modules**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modules: [] }) }),
  );
}

test("#992: en ARKIVERT modul foran siste seksjon skal ikke blokkere «Avslutt kurset»", async ({ page }) => {
  await mockBase(page);
  // Produkteiers «Samfunnsvitere»-tilstand: en arkivert modul ligger igjen i et publisert kurs.
  // Serverens bevisport filtrerer den bort og er klar til å utstede beviset.
  //
  // ⚠️ `required: false` sto ikke her da testen ble skrevet — den mocket «arkivert» som bare
  // `available: false`, altså den sammenblandingen #996 skiller. Testen ble rød av fiksen, og det
  // var riktig: mocken beskrev en tilstand serveren aldri sender.
  await mockCourseWithUnavailable(
    page,
    [
      { type: "MODULE", moduleId: "m1", courseItemId: "ci1", title: "Arkivert test", moduleStatus: "NOT_STARTED", available: false, required: false, discussionsEnabled: false },
      { type: "SECTION", sectionId: "s1", courseItemId: "ci2", title: "Lesestoff", read: false, available: true, required: true, discussionsEnabled: false },
    ],
    ["s1"],
  );

  let readCalled = false;
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => {
    readCalled = true;
    return route.fulfill({ status: 204, body: "" });
  });

  await openCourse(page);
  await page.locator('.course-item[data-key="ci2"] .course-module-row').click();
  await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");

  // Før fiksen: «1 igjen» og ingen knapp — deltakeren kunne ikke fullføre et kurs serveren mente
  // var ferdig. Den arkiverte modulen kan hen heller ikke gjøre noe med.
  await expect(page.locator("#sectionReaderFinish")).toBeVisible();
  await expect(page.locator(".course-inline-actions")).not.toContainText(/igjen/);

  await page.locator("#sectionReaderFinish").click();
  await expect.poll(() => readCalled).toBe(true);
});

test("#992: «gå videre» hopper over en UTILGJENGELIG seksjon i stedet for å åpne 404-en", async ({ page }) => {
  await mockBase(page);
  await mockCourseWithUnavailable(
    page,
    [
      { type: "SECTION", sectionId: "s1", courseItemId: "ci1", title: "Første", read: false, available: true, discussionsEnabled: false },
      // Holdt tilbake av oversettelsesgaten: finnes i rekka, men serveren svarer 404 på innholdet.
      { type: "SECTION", sectionId: "s2", courseItemId: "ci2", title: "Tilbakeholdt", read: false, available: false, discussionsEnabled: false },
      { type: "SECTION", sectionId: "s3", courseItemId: "ci3", title: "Tredje", read: false, available: true, discussionsEnabled: false },
    ],
    ["s1", "s3"],
  );
  // s2 har med vilje INGEN mock: treffer klienten den, feiler testen på innholdet — ikke på en
  // assertion som kunne vært grønn ved et uhell.
  for (const id of ["s1", "s2", "s3"]) {
    await page.route(`**/api/courses/c1/sections/${id}/read`, (route: Route) => route.fulfill({ status: 204, body: "" }));
  }

  await openCourse(page);

  // Raden for den tilbakeholdte seksjonen skal ikke være klikkbar. Før fiksen var enhver seksjon det.
  const held = page.locator('.course-item[data-key="ci2"] .course-module-row');
  await expect(held).toBeDisabled();

  await page.locator('.course-item[data-key="ci1"] .course-module-row').click();
  await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");
  await page.locator("#sectionReaderMarkRead").click();

  // Landet på s3, ikke på s2. Det er hele poenget: rekka hopper over det deltakeren ikke får lese.
  const third = page.locator('.course-item[data-key="ci3"]');
  await expect(third.locator("#sectionReaderBody")).toContainText("Tekst i s3");
  await expect(page.locator('.course-item[data-key="ci2"] #sectionReaderBody')).toHaveCount(0);
});

test("#992 KONTROLLCASE: en TILGJENGELIG ikke-bestått modul blokkerer fortsatt", async ({ page }) => {
  // Uten denne kunne fiksen vært «hopp over alt» — og da ville «Avslutt kurset» dukket opp midt i
  // et halvferdig kurs. Testen over og denne må skille på nøyaktig ett felt: `available`.
  await mockBase(page);
  await mockCourseWithUnavailable(
    page,
    [
      { type: "MODULE", moduleId: "m1", courseItemId: "ci1", title: "Ekte test", moduleStatus: "NOT_STARTED", available: true, discussionsEnabled: false },
      { type: "SECTION", sectionId: "s1", courseItemId: "ci2", title: "Lesestoff", read: false, available: true, discussionsEnabled: false },
    ],
    ["s1"],
  );

  await openCourse(page);
  await page.locator('.course-item[data-key="ci2"] .course-module-row').click();
  await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");

  await expect(page.locator("#sectionReaderFinish")).toHaveCount(0);
  await expect(page.locator(".course-inline-actions")).toContainText(/1 igjen/);
});

// ---------------------------------------------------------------------------
// #992: rå JSON skal ikke stå i deltakerens toast — heller ikke i detaljfeltet.
//
// #988 flyttet Zod-dumpen fra toastens OVERSKRIFT til dens `detail`. Det var ikke nok:
// `showToast` rendrer `detail` som et synlig `<p class="toast__detail">` (toast.js:84), så
// kandidaten så fortsatt hele kroppen — bare i grått, under den lokaliserte setningen.
//
// ⚠️ Forfatterflatene BEHOLDER detaljfeltet med vilje (se section-portability-916.spec.ts). En
// forfatter kan bruke `path: ["bodyMarkdown"]` til noe; en kandidat midt i en test kan ikke.
// ---------------------------------------------------------------------------
test("#992: serverens JSON når aldri deltakerens toast", async ({ page }) => {
  await mockBase(page);
  await mockCourseWithUnavailable(
    page,
    [
      { type: "SECTION", sectionId: "s1", courseItemId: "ci1", title: "Første", read: false, available: true, discussionsEnabled: false },
      { type: "SECTION", sectionId: "s2", courseItemId: "ci2", title: "Andre", read: false, available: true, discussionsEnabled: false },
    ],
    ["s1", "s2"],
  );
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "validation_error",
        issues: [{ code: "too_small", minimum: 1, path: ["responses", 3], message: "Array must contain at least 1 element(s)" }],
      }),
    }),
  );

  await openCourse(page);
  await page.locator('.course-item[data-key="ci1"] .course-module-row').click();
  await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");
  await page.locator("#sectionReaderMarkRead").click();

  const toast = page.locator(".toast").last();
  await expect(toast).toBeVisible();
  // Lesbar prosa på deltakerens språk.
  await expect(toast).toContainText(/Noe i skjemaet mangler/);
  // Og ingenting av serverens indre liv — verken i overskriften eller i detaljfeltet.
  await expect(page.locator(".toast__detail")).toHaveCount(0);
  await expect(toast).not.toContainText("too_small");
  await expect(toast).not.toContainText("validation_error");
  await expect(toast).not.toContainText("400:");

  // ⚠️ KONTROLL: knappen må bli klikkbar igjen. En feilmelding som etterlater deltakeren med en
  // død knapp er en blindvei av samme slag som resten av denne saken.
  await expect(page.locator("#sectionReaderMarkRead")).toBeEnabled();
});

// ---------------------------------------------------------------------------
// #996: en AVPUBLISERT modul er ikke det samme som en ARKIVERT.
//
// QA-porten fant at #992 blandet dem. Klienten utledet «ikke påkrevd» fra `available: false`, mens
// serverens bevisport bare filtrerer på `archivedAt`. Utfallet var en STILLE blindvei: «Avslutt
// kurset» dukket opp, klikket registrerte lesningen, og så skjedde ingenting — ingen bevis, ingen
// feilmelding, ingen forklaring.
//
// ⚠️ Det er nøyaktig tilstanden #929 ble skrevet for å fjerne, gjenskapt av fiksen mot en annen
// variant av den. Derfor står disse to testene ved siden av #992-testen over: forskjellen mellom dem
// er ETT felt, og det er hele poenget.
// ---------------------------------------------------------------------------
test("#996: en AVPUBLISERT modul blokkerer «Avslutt kurset» — den teller fortsatt", async ({ page }) => {
  await mockBase(page);
  await mockCourseWithUnavailable(
    page,
    [
      // Ikke arkivert, bare uten publisert versjon. Serveren krever den fortsatt.
      { type: "MODULE", moduleId: "m1", courseItemId: "ci1", title: "Midlertidig nede", moduleStatus: "NOT_STARTED", available: false, required: true, discussionsEnabled: false },
      { type: "SECTION", sectionId: "s1", courseItemId: "ci2", title: "Lesestoff", read: false, available: true, required: true, discussionsEnabled: false },
    ],
    ["s1"],
  );

  let readCalled = false;
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => {
    readCalled = true;
    return route.fulfill({ status: 204, body: "" });
  });

  await openCourse(page);
  await page.locator('.course-item[data-key="ci2"] .course-module-row').click();
  await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");

  // Ingen knapp — og en forklaring, ikke en blindvei.
  await expect(page.locator("#sectionReaderFinish")).toHaveCount(0);
  await expect(page.locator(".course-inline-actions")).toContainText(/1 igjen/);

  // ⚠️ Kjernen: ingenting registreres. Før fiksen ble lesningen skrevet av et klikk som ikke førte
  // til noe, og deltakeren mistet den siste handlingen som kunne gitt en forklaring.
  expect(readCalled).toBe(false);

  // Raden er heller ikke klikkbar — modulen kan ikke åpnes, den kan bare vente på forfatteren.
  await expect(page.locator('.course-item[data-key="ci1"] .course-module-row')).toBeDisabled();
});

test("#996 KONTROLLCASE: en ARKIVERT modul blokkerer IKKE — den er tatt ut av kurset", async ({ page }) => {
  // Samme oppsett, ETT felt forskjellig. Uten denne ville «behandle alt utilgjengelig som påkrevd»
  // bestått testen over — og da hadde vi gjeninnført #945: en arkivert modul som blokkerer
  // fullføring for alltid.
  await mockBase(page);
  await mockCourseWithUnavailable(
    page,
    [
      { type: "MODULE", moduleId: "m1", courseItemId: "ci1", title: "Arkivert", moduleStatus: "NOT_STARTED", available: false, required: false, discussionsEnabled: false },
      { type: "SECTION", sectionId: "s1", courseItemId: "ci2", title: "Lesestoff", read: false, available: true, required: true, discussionsEnabled: false },
    ],
    ["s1"],
  );

  let readCalled = false;
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => {
    readCalled = true;
    return route.fulfill({ status: 204, body: "" });
  });

  await openCourse(page);
  await page.locator('.course-item[data-key="ci2"] .course-module-row').click();
  await expect(page.locator("#sectionReaderBody")).toContainText("Tekst i s1");

  await expect(page.locator("#sectionReaderFinish")).toBeVisible();
  await page.locator("#sectionReaderFinish").click();
  await expect.poll(() => readCalled).toBe(true);
});

// Produkteier 2026-08-28, med skjermbilde: «Når jeg trykker på Les, så åpner ikke seksjonen med
// starten i toppen av skjermen.»
//
// ⚠️ To ting sto galt samtidig, og hver for seg ville de vært harmløse:
//   1. `scrollIntoView({ block: "nearest" })` ruller MINST MULIG — var raden allerede så vidt
//      synlig, flyttet den seg ikke i det hele tatt.
//   2. Kallet lå FØR `await renderSectionReaderInto(...)`, altså mot et tomt panel. Nettleseren
//      regnet ut hvor den skulle rulle basert på en høyde som ennå ikke fantes.
//
// Resultatet var at deltakeren sto midt i eller nederst i en lang seksjon og måtte rulle oppover
// for å finne begynnelsen. Testen krever at radens topp faktisk lander øverst.
test("#UI: en lang seksjon åpner med starten øverst på skjermen", async ({ page }) => {
  await mockBase(page);
  await mockCourse(page);

  // Lang nok til at siden faktisk kan rulle — en kort seksjon ville vært grønn uansett.
  const longHtml = Array.from({ length: 120 }, (_, i) => `<p>Avsnitt ${i + 1} i seksjonsteksten.</p>`).join("");
  await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Første seksjon", html: longHtml }) }),
  );

  await page.setViewportSize({ width: 1280, height: 720 });
  await openCourse(page);

  const first = page.locator('.course-item[data-key="ci1"]');

  // Før klikket ligger raden et stykke nede på siden — ellers måler testen ingenting.
  const before = await first.boundingBox();
  expect(before!.y).toBeGreaterThan(60);

  await first.locator(".course-module-row").click();
  await expect(first.locator("#sectionReaderBody")).toContainText("Avsnitt 1 i seksjonsteksten.");

  // Rullingen er myk, så vent til den har stanset i stedet for å gjette på en forsinkelse.
  await expect.poll(async () => Math.round((await first.boundingBox())!.y), { timeout: 5000 })
    .toBeLessThanOrEqual(40);

  // Og det ØVERSTE av seksjonsteksten skal være synlig — ikke bare raden.
  const firstParagraph = first.locator("#sectionReaderBody p").first();
  await expect(firstParagraph).toBeInViewport();
});

// ⚠️ Motstykket, og grunnen til at `block: "start"` står der.
//
// Mutasjonstesten avslørte at testen over IKKE binder valget av `start`: en LANG seksjon er høyere
// enn skjermen, så «nearest» ruller toppen til toppen helt av seg selv. Den beviser bare
// rekkefølgen.
//
// En KORT seksjon er den eneste som skiller dem: «nearest» gjør ingenting hvis raden allerede er
// synlig, og deltakeren sitter igjen med seksjonen der den tilfeldigvis lå.
//
// Kurset får mange elementer her — ikke for realismens skyld, men fordi en kort side ikke KAN rulle
// raden helt opp. Første forsøk feilet på y=104 av nettopp den grunnen, og det var testen som var
// feil, ikke koden.
test("#UI: også en KORT seksjon åpner med starten øverst", async ({ page }) => {
  await mockBase(page);

  const items = Array.from({ length: 24 }, (_, i) => ({
    type: "SECTION",
    sectionId: `x${i}`,
    courseItemId: `cx${i}`,
    title: `Seksjon ${i + 1}`,
    read: false,
    discussionsEnabled: false,
  }));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ course: { id: "c1", title: "Kurs", discussionsEnabled: false, items } }),
    }),
  );
  await page.route("**/api/courses/c1/sections/*", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Seksjon", html: "<p>Kort tekst.</p>" }) }),
  );

  await page.setViewportSize({ width: 1280, height: 720 });
  await openCourse(page);

  // Et element midt i lista: langt nok ned til at det må rulles, langt nok fra bunnen til at det
  // FINNES rulleplass.
  const target = page.locator('.course-item[data-key="cx11"]');
  await target.scrollIntoViewIfNeeded();
  const before = await target.boundingBox();
  expect(before!.y).toBeGreaterThan(60);

  await target.locator(".course-module-row").click();
  await expect(target.locator("#sectionReaderBody")).toContainText("Kort tekst.");

  await expect.poll(async () => Math.round((await target.boundingBox())!.y), { timeout: 5000 })
    .toBeLessThanOrEqual(40);
});
