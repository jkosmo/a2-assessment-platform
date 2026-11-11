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
  await expect(page.locator(".course-accordion-item").first()).toBeVisible();
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

  // Grensen er NAVNGITT. En strek alene sier at noe skiller, ikke hva. 2.152.0: med antallet.
  const divider = page.locator(".course-group-divider");
  await expect(divider).toHaveCount(1);
  await expect(divider).toHaveText("Fullført · 1");
});

// 2.152.0 (produkteier 2026-11-11, doc/design/PLAN_1139.md punkt 13): de fullførte står i ETT grønt kort med tette rader og én
// felles grønn linje nederst. Kursets egen linje er skjult i kortet, og vises igjen når kurset er åpent alene.
async function fiveDone(page: Page) {
  await mockBase(page);
  const titles = ["Kost ved bruk av KI-modeller i A-2", "Repetisjon Kurs 1 – Møtearbeid", "Repetisjon Kurs 2 – Tilbudsarbeid", "Repetisjon Kurs 3 – Prosjektplanlegging", "Informasjonssikkerhetsopplæringsprogrammetsrepetisjonskurs"];
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [course("open1", "Pågår", "IN_PROGRESS"), ...titles.map((title, i) => course(`d${i}`, title, "COMPLETED"))] }),
    }),
  );
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ completions: titles.map((title, i) => ({ courseId: `d${i}`, certificateId: `cert-${i}`, completedAt: "2026-08-20T12:00:00.000Z", courseTitle: title })) }),
    }),
  );
  await page.route("**/api/courses/d1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "d1", title: titles[1], modules: [], items: [] } }) }),
  );
  await loadList(page);
}

test("2.152.0: fem fullførte kurs i ett kort, tette rader, én felles grønn linje; kursenes egne linjer er skjult", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fiveDone(page);
  const group = page.locator(".course-done-group");
  await expect(group).toHaveCount(1);
  await expect(group.locator(".course-accordion-item--done")).toHaveCount(5);
  await expect(page.locator(".course-group-divider")).toHaveText("Fullført · 5");
  // Én felles linje, synlig; kursenes egne er skjult.
  await expect(group.locator(".course-done-group-bar")).toBeVisible();
  for (let i = 0; i < 5; i++) await expect(group.locator(`[data-course-id="d${i}"] .course-progress-bar`)).toBeHidden();
  // Kontrollcase: kurset i gang har fortsatt sin linje.
  await expect(page.locator('[data-course-id="open1"] .course-progress-bar')).toBeVisible();
  // Tette rader: 32 px er minstehøyden; en rad med kort tittel blir ikke over 40 px.
  const row = await group.locator('[data-course-id="d1"] .course-done-row').boundingBox();
  expect(row!.height).toBeGreaterThanOrEqual(31);
  expect(row!.height).toBeLessThanOrEqual(40);
  // Hele kortet: fem rader og linja, lavere enn to av de gamle kortene per kurs (om lag 75 px hver).
  const box = await group.boundingBox();
  expect(box!.height).toBeLessThan(5 * 50);
});

test("2.152.0: et fullført kurs åpnet fra kortet står alene, med egen grønn linje; tilbake gir kortet igjen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fiveDone(page);
  await page.locator('[data-course-id="d1"] .course-accordion-header').click();
  await expect(page.locator("#courseBackBtn")).toBeVisible();
  await expect(page.locator('[data-course-id="d1"]')).toBeVisible();
  for (const id of ["d0", "d2", "open1"]) await expect(page.locator(`[data-course-id="${id}"]`)).toBeHidden();
  await expect(page.locator(".course-done-group-bar")).toBeHidden();
  await expect(page.locator('[data-course-id="d1"] .course-progress-bar')).toBeVisible();
  // QA-porten 2.152.0 (bør 2): åpent alene klipper ikke gruppa (lesevisningens faste hode og bredt innhold), og er ikke et rutenett.
  const groupStyle = await page.locator(".course-done-group").evaluate((el) => ({ display: getComputedStyle(el).display, overflow: getComputedStyle(el).overflow }));
  expect(groupStyle).toEqual({ display: "block", overflow: "visible" });
  // Lesevisningen: lesearket har ingen grønn ramme (`.course-reading` vinner over gruppas ramme).
  await page.locator('[data-course-id="d1"]').evaluate((el) => el.classList.add("course-reading"));
  expect(await page.locator('[data-course-id="d1"]').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe("rgba(0, 0, 0, 0)");
  await page.locator('[data-course-id="d1"]').evaluate((el) => el.classList.remove("course-reading"));
  await page.locator("#courseBackBtn").click();
  await expect(page.locator(".course-done-group-bar")).toBeVisible();
  await expect(page.locator('[data-course-id="d1"] .course-progress-bar')).toBeHidden();
  // Klikk på raden etter omtegningen virker fortsatt (lytterne følger med kortene).
  await page.locator('[data-course-id="d2"] .course-accordion-header').click();
  await expect(page.locator("#courseBackBtn")).toBeVisible();
});

for (const width of [390, 360]) {
  test(`2.152.0: på telefon (${width} px) står «Vis bevis» alene, radene er tette, og en lang tittel går ikke ut av kortet`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await fiveDone(page);
    const group = page.locator(".course-done-group");
    const link = group.locator('[data-course-id="d1"] .course-certificate-link');
    await expect(link).toHaveText(/Vis bevis/);
    await expect(link.locator(".course-certificate-link-kind")).toBeHidden();
    const row = await group.locator('[data-course-id="d1"] .course-done-row').boundingBox();
    expect(row!.height).toBeGreaterThanOrEqual(35);
    expect(row!.height).toBeLessThanOrEqual(48);
    // Den lange tittelen (ett ord) brytes inne i kortet; lenka står fortsatt innenfor.
    const groupBox = await group.boundingBox();
    const longLink = await group.locator('[data-course-id="d4"] .course-certificate-link').boundingBox();
    expect(longLink!.x + longLink!.width).toBeLessThanOrEqual(groupBox!.x + groupBox!.width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

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

test("#939 + #1137: et fullført kurs er én grønn rad — med hel grønn linje uten båt, og sertifikatlenke", async ({ page }) => {
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

  // #939 tok bort linja på fullførte kurs. #1137 (produkteier 2026-11-02) ga den tilbake som én hel GRØNN linje, uten båt.
  // Testgjennomgangen 2026-11 (avsnitt 4.1): linja og båten sjekkes i course-progress-boat-1137.spec.ts («ikke påbegynt har
  // tom linje …»), med kontrollen for et kurs i gang. Her står det som er listas eget: rad, hakemerke og lenke.

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

// Testgjennomgangen 2026-11 (avsnitt 4.1): «#939 funn A: bevis + status IN_PROGRESS er FULLFØRT — kurset som vokste beholder
// lenka» er flyttet til «fullført med 5 av 6 steg …» i course-progress-boat-1137.spec.ts, som hadde samme scenario. Raden
// (`--done`), lenka, den grønne linja og at båten mangler sjekkes der.

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
