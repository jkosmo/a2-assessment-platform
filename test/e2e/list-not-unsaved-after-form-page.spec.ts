import { test, expect, type Page, type Route } from "@playwright/test";

// Prod 2.154.2, 13.11.2026: forfatteren sto i seksjonslista, ville til «Kurs», og fikk «Du har
// ulagrede endringer. Vil du forlate sida uten å lagre?» — i en liste, uten noen Lagre-knapp.
//
// Skjemasida (form-page.js) og lista tegner i SAMME element på Seksjoner og Klasser. Skjemasidas
// lyttere blir stående på elementet etter at lista er tegnet tilbake, så
//   1) et tastetrykk i søkefeltet, et valg i kursfilteret eller et kryss i lista merket sida «ulagret», og
//   2) «ulagret» fra skjemaet levde videre når man forlot det med OK eller med nettleserens tilbake.
// «Ulagret» gjelder bare mens skjemaet faktisk vises.

async function mockBase(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

/** Spør sida før man lukker fanen? Samme spørsmål som lenkene stiller, målt uten å forlate sida. */
const sporVedLukking = (page: Page) =>
  page.evaluate(() => {
    const hendelse = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(hendelse);
    return hendelse.defaultPrevented;
  });

/** Samler alle spørsmål nettleseren stiller, og svarer `svar` på dem. */
function samleDialoger(page: Page, svar: "ok" | "avbryt") {
  const meldinger: string[] = [];
  page.on("dialog", (dialog) => {
    meldinger.push(`${dialog.type()}: ${dialog.message()}`);
    return svar === "ok" ? dialog.accept() : dialog.dismiss();
  });
  return meldinger;
}

const tittel = JSON.stringify({ nb: "Bestill og styr", nn: "Bestill og styr", "en-GB": "Order and steer" });
const seksjon = {
  id: "sec-1", title: tittel, activeVersionId: "v1", archivedAt: null, versionNo: 2, courseCount: 1,
  updatedAt: "2026-10-25T08:00:00.000Z", lifecycle: "published", canManage: true,
  courses: [{ id: "kurs-5", title: "Repetisjon Kurs 5" }],
};

async function mockSeksjoner(page: Page) {
  await mockBase(page);
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [seksjon] }) }),
  );
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>forhåndsvisning</p>" }) }),
  );
  await page.route("**/api/admin/content/sections/sec-1", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ section: { id: "sec-1", title: tittel, bodyMarkdown: JSON.stringify({ nb: "Tekst", nn: "Tekst", "en-GB": "Text" }), activeVersionId: "v1", archivedAt: null, hasUnpublishedChanges: false, assets: [] } }),
    }),
  );
}

async function aapneSeksjonFraLista(page: Page) {
  await page.goto("/admin-content/sections");
  await page.locator('[data-action="edit"][data-id="sec-1"]').click();
  await expect(page.locator("#titleInput")).toBeVisible();
}

test.describe("lista er ikke «ulagret» etter at et skjema har vært åpnet", () => {
  test("seksjoner: søk, kursfilter og avkrysning i lista merker ikke sida ulagret, og «Kurs» åpner uten spørsmål", async ({ page }) => {
    await mockSeksjoner(page);
    const dialoger = samleDialoger(page, "avbryt");
    await aapneSeksjonFraLista(page);
    await page.locator("#formBackLink").click();
    await expect(page.locator("#sectionsTableBody")).toContainText("Bestill og styr");

    await page.locator("#sectionsSearch").fill("best");
    await page.locator("#sectionCourseFilter").selectOption("kurs-5");
    await page.locator("#sectionsGapsOnly").check();
    await page.locator("#sectionsGapsOnly").uncheck();

    expect(await sporVedLukking(page)).toBe(false);
    await page.locator("#navKurs").click();
    await expect(page).toHaveURL(/\/admin-content\/courses/);
    expect(dialoger).toEqual([]);
  });

  test("seksjoner: skjemaet forlatt med ulagret tekst og OK — lista spør ikke en gang til", async ({ page }) => {
    await mockSeksjoner(page);
    const dialoger = samleDialoger(page, "ok");
    await aapneSeksjonFraLista(page);
    await page.locator("#titleInput").fill("Ny tittel");
    await page.locator("#formBackLink").click();
    await expect(page.locator("#sectionsTableBody")).toContainText("Bestill og styr");
    // Spørsmålet ble stilt én gang, på vei ut av skjemaet. Det var riktig.
    expect(dialoger).toHaveLength(1);

    expect(await sporVedLukking(page)).toBe(false);
    await page.locator("#navKurs").click();
    await expect(page).toHaveURL(/\/admin-content\/courses/);
    expect(dialoger).toHaveLength(1);
  });

  test("seksjoner: nettleserens tilbake fra et skjema med ulagret tekst — lista spør ikke", async ({ page }) => {
    await mockSeksjoner(page);
    const dialoger = samleDialoger(page, "avbryt");
    await aapneSeksjonFraLista(page);
    await page.locator("#titleInput").fill("Ny tittel");
    await page.goBack();
    await expect(page.locator("#sectionsTableBody")).toContainText("Bestill og styr");

    expect(await sporVedLukking(page)).toBe(false);
    await page.locator("#navKurs").click();
    await expect(page).toHaveURL(/\/admin-content\/courses/);
    expect(dialoger).toEqual([]);
  });

  test("kontroll, seksjoner: i skjemaet spør sida fortsatt — og etter lista og inn igjen virker det som før", async ({ page }) => {
    await mockSeksjoner(page);
    const dialoger = samleDialoger(page, "avbryt");
    await aapneSeksjonFraLista(page);
    // Lista imellom, med et tastetrykk der: skjemaet skal åpne «Alt lagret» etterpå.
    await page.locator("#formBackLink").click();
    await page.locator("#sectionsSearch").fill("best");
    await page.locator('[data-action="edit"][data-id="sec-1"]').click();
    await expect(page.locator("#titleInput")).toBeVisible();
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
    expect(await sporVedLukking(page)).toBe(false);

    await page.locator("#titleInput").fill("Ny tittel");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    expect(await sporVedLukking(page)).toBe(true);
    await page.locator("#navKurs").click();
    // Avbryt: man blir stående i skjemaet, med teksten.
    expect(dialoger.filter((m) => m.includes("ulagrede endringer"))).toHaveLength(1);
    await expect(page).toHaveURL(/\/admin-content\/sections\?id=sec-1/);
    await expect(page.locator("#titleInput")).toHaveValue("Ny tittel");
  });

  test("klasser: søk i lista etter en åpnet klasse merker ikke sida ulagret; i skjemaet spør den fortsatt", async ({ page }) => {
    await mockBase(page);
    const klasse = { id: "cls-1", name: "Kull 2026", isSystem: false, lifecycle: "active", _count: { members: 0, courseAssignments: 0 } };
    await page.route("**/api/admin/content/classes", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [klasse] }) }),
    );
    await page.route("**/api/admin/content/classes/*", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ class: klasse }) }),
    );
    await page.route("**/api/admin/content/classes/*/members", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: [] }) }),
    );
    await page.route("**/api/admin/content/classes/*/courses", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [] }) }),
    );
    await page.route("**/api/admin/content/courses", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [] }) }),
    );
    const dialoger = samleDialoger(page, "ok");

    await page.goto("/deltakere/klasser");
    await page.locator('[data-action="open"][data-id="cls-1"]').click();
    await expect(page.locator("#className")).toBeVisible();
    await page.locator("#formBackLink").click();
    await expect(page.locator("#classesTableBody")).toContainText("Kull 2026");
    await page.locator("#classesSearch").fill("kull");
    expect(await sporVedLukking(page)).toBe(false);

    // Kontroll: i skjemaet er et tastetrykk fortsatt en ulagret endring.
    await page.locator('[data-action="open"][data-id="cls-1"]').click();
    await expect(page.locator("#className")).toBeVisible();
    expect(await sporVedLukking(page)).toBe(false);
    await page.locator("#className").fill("Kull 2027");
    expect(await sporVedLukking(page)).toBe(true);

    // Ut med OK, og lista er ren igjen.
    await page.locator("#formBackLink").click();
    await expect(page.locator("#classesTableBody")).toContainText("Kull 2026");
    expect(dialoger).toHaveLength(1);
    expect(await sporVedLukking(page)).toBe(false);
  });
});
