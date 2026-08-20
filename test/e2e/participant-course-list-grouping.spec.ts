import { test, expect, type Page, type Route } from "@playwright/test";

// #936 + #939 — «Kursa mine» skal svare på «hva gjenstår?» før den svarer på «hva har jeg gjort?».
//
// Produkteier, stage 2026-08-20:
//   #936  «I oversikten Kursa mine burde fullførte kurs være listet til slutt. Behold
//         sekundærsortering, gjerne en synlig grense. Samspill med #929: last lista på nytt, kurset
//         skal vises nå under fullført, og lista skal være skrollet slik at det er synlig.»
//   #939  «For fullførte kurs kan vi konsolidere listen slik at det er bare en linje som er grønn
//         og som viser både kursnavn og innhold, men også viser sertifikat. Progresjonslinje
//         trengs ikke.»
//
// Alt dette lever i klientlaget — partisjonering, cascade og scrollIntoView — og er usynlig for
// supertest.

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
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

function course(id: string, title: string, status: string) {
  return {
    id,
    title,
    description: null,
    moduleCount: 1,
    progress: { completed: status === "COMPLETED" ? 1 : 0, total: 1, moduleCompleted: status === "COMPLETED" ? 1 : 0, moduleTotal: 1, sectionCompleted: 0, sectionTotal: 0, courseStatus: status },
  };
}

async function loadList(page: Page) {
  await page.goto("/participant");
  const loadBtn = page.locator("#loadCoursesBtn");
  await expect(loadBtn).toBeEnabled();
  await loadBtn.click();
}

test("#936: fullførte kurs havner nederst, bak en navngitt grense — og rekkefølgen ellers er urørt", async ({ page }) => {
  await mockBase(page);
  // Backend leverer et FULLFØRT kurs FØRST. Kommer det ut nederst, er partisjoneringen vår, ikke
  // en tilfeldighet i inndata.
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          course("done1", "Alfa fullført", "COMPLETED"),
          course("open1", "Beta pågår", "IN_PROGRESS"),
          course("open2", "Gamma ikke startet", "NOT_STARTED"),
        ],
      }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );

  await loadList(page);

  const titles = page.locator(".course-accordion-title");
  await expect(titles).toHaveCount(3);
  // Det fullførte er sist. De to andre står i backendens rekkefølge — sekundærsorteringen overlever,
  // slik produkteier ba om.
  await expect(titles.nth(0)).toHaveText("Beta pågår");
  await expect(titles.nth(1)).toHaveText("Gamma ikke startet");
  await expect(titles.nth(2)).toHaveText("Alfa fullført");

  // Grensen er NAVNGITT. En strek alene sier at noe skiller, ikke hva.
  const divider = page.locator(".course-group-divider");
  await expect(divider).toHaveCount(1);
  await expect(divider).toHaveText("Fullført");
});

test("#936: grensen vises ikke når alt er fullført — da skiller den ingenting", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [course("d1", "Alt ferdig", "COMPLETED"), course("d2", "Òg ferdig", "COMPLETED")] }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );

  await loadList(page);

  await expect(page.locator(".course-accordion-title")).toHaveCount(2);
  // KONTROLLCASE til testen over: uten denne ville «vis alltid grensen» bestått begge.
  await expect(page.locator(".course-group-divider")).toHaveCount(0);
});

test("#939: et fullført kurs er én grønn rad — uten framdriftslinje, med sertifikatlenke", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [course("open1", "Pågår", "IN_PROGRESS"), course("done1", "Emilie", "COMPLETED")] }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ completions: [{ courseId: "done1", certificateId: "cert-abc-123", completedAt: "2026-08-20T12:00:00.000Z", courseTitle: "Emilie" }] }),
    }),
  );

  await loadList(page);

  const doneItem = page.locator('.course-accordion-item[data-course-id="done1"]');
  await expect(doneItem).toHaveClass(/course-accordion-item--done/);

  // Kjernen i #939: framdriftslinja er BORTE for det fullførte kurset — en linje som alltid er
  // 100 % full bærer null informasjon.
  await expect(doneItem.locator(".course-progress-bar")).toHaveCount(0);
  // ...men den står fortsatt på det pågående. Kontrollcase: uten dette ville «fjern linja overalt»
  // bestått.
  await expect(page.locator('.course-accordion-item[data-course-id="open1"] .course-progress-bar')).toHaveCount(1);

  // Hakemerket står SAMMEN med fargen: grønt alene kan ikke bære «fullført».
  await expect(doneItem.locator(".course-done-tick")).toHaveCount(1);

  const certLink = doneItem.locator(".course-certificate-link");
  await expect(certLink).toHaveCount(1);
  await expect(certLink).toHaveAttribute("href", "/certificate?id=cert-abc-123");
  // Sertifikat-ID-en er med vilje UTE av lista — 25 tegn maskintekst i en rad man skal skumme.
  await expect(doneItem).not.toContainText("cert-abc-123");

  // ⚠️ Lenka må være en ekte <a> og ligge UTENFOR knappen: <a> inni <button> er ugyldig HTML og
  // bryter tastaturnavigasjonen. Denne assertionen er hele grunnen til at raden er bygget som en
  // flex-container med søsken i stedet for én knapp.
  await expect(doneItem.locator(".course-accordion-header a")).toHaveCount(0);
});

test("#939: et klikk på «Vis bevis» åpner beviset — det navigerer ikke lista bak det", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [course("open1", "Pågår", "IN_PROGRESS"), course("done1", "Emilie", "COMPLETED")] }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ completions: [{ courseId: "done1", certificateId: "cert-abc-123", completedAt: "2026-08-20T12:00:00.000Z", courseTitle: "Emilie" }] }),
    }),
  );

  await loadList(page);

  // Raden har en klikkflate for å gi kurset flaten alene (sjevronen ligger utenfor knappen). Lenka
  // må slippe unna den — ellers ville ett klikk både åpnet beviset OG dratt lista inn i kurset.
  const certLink = page.locator('.course-accordion-item[data-course-id="done1"] .course-certificate-link');
  await certLink.click({ modifiers: ["Control"] }); // Ctrl-klikk: åpner i ny fane, lar denne siden stå
  await expect(page.locator("#courseAccordion")).not.toHaveClass(/course-accordion--focused/);
});

test("#939 funn A: bevis + status IN_PROGRESS er FULLFØRT — kurset som vokste beholder lenka", async ({ page }) => {
  await mockBase(page);
  // Det hverdagslige scenariet: deltakeren har bevis, så la forfatteren til én seksjon i det
  // publiserte kurset. Beviset er permanent, men `total` vokste — så status faller til IN_PROGRESS.
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          course("open1", "Pågår", "IN_PROGRESS"),
          { ...course("grown", "Kurset som vokste", "IN_PROGRESS"), progress: { completed: 5, total: 6, moduleCompleted: 1, moduleTotal: 1, sectionCompleted: 4, sectionTotal: 5, courseStatus: "IN_PROGRESS" } },
        ],
      }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ completions: [{ courseId: "grown", certificateId: "cert-grown", completedAt: "2026-08-01T10:00:00.000Z", courseTitle: "Kurset som vokste" }] }),
    }),
  );

  await loadList(page);

  const grown = page.locator('.course-accordion-item[data-course-id="grown"]');
  // ⚠️ Partisjoneringen sorterte det allerede hit. Raden MÅ være enig — ellers står kurset under
  // «Fullført» og rendres som pågående, uten sertifikatlenke i det hele tatt.
  await expect(grown).toHaveClass(/course-accordion-item--done/);
  await expect(grown.locator(".course-certificate-link")).toHaveAttribute("href", "/certificate?id=cert-grown");
  await expect(grown.locator(".course-progress-bar")).toHaveCount(0);
});

test("#939 funn B: en fullført rad er ÉN rad — ingen tom stripe under", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [course("open1", "Pågår", "IN_PROGRESS"), course("done1", "Emilie", "COMPLETED")] }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ completions: [{ courseId: "done1", certificateId: "c-1", completedAt: "2026-08-20T12:00:00.000Z", courseTitle: "Emilie" }] }),
    }),
  );

  await loadList(page);

  // MÅLT, ikke antatt: kroppen hadde padding og topplinje, og var 33px høy selv om eneste barn var
  // display:none. Fem fullførte kurs ble fem tomme, innrammede striper.
  const bodyBox = await page.locator('.course-accordion-item[data-course-id="done1"] .course-accordion-body').boundingBox();
  expect(bodyBox).toBeNull();

  // Kontrollcase: raden selv har fortsatt høyde. Uten dette ville «skjul hele kortet» bestått.
  const rowBox = await page.locator('.course-accordion-item[data-course-id="done1"] .course-done-row').boundingBox();
  expect(rowBox?.height ?? 0).toBeGreaterThan(20);
});

test("#939: skjermleseren får vite at kurset er fullført — fargen og hakemerket er ikke nok", async ({ page }) => {
  await mockBase(page);
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [course("open1", "Pågår", "IN_PROGRESS"), course("done1", "Emilie", "COMPLETED")] }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );

  await loadList(page);

  // Hakemerket er aria-hidden og gruppegrensen er utenfor tabb-rekkefølgen, så uten dette hørte en
  // NVDA-bruker «Emilie, Modular 1/1, knapp» — identisk med et uferdig kurs.
  const btn = page.locator('.course-accordion-item[data-course-id="done1"] .course-accordion-header');
  await expect(btn).toContainText("Fullført");

  // ...men den skal ikke SES. Statuspillen ble fjernet nettopp for å slippe å si det to ganger.
  await expect(btn.locator(".module-status-badge")).toHaveCount(0);
  // ⚠️ `.sr-only` er 1×1px med `clip`, IKKE display:none — Playwright regner den derfor som
  // «synlig», og `toBeHidden()` ville vært feil verktøy. Målet er at den ikke opptar plass.
  const srBox = await btn.locator(".sr-only").boundingBox();
  expect(srBox?.height ?? 0).toBeLessThanOrEqual(2);
});
