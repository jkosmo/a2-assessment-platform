import { test, expect, type Page, type Route } from "@playwright/test";

// #1155 (QA-porten 2.157.2): når spør skjemasida før ulagret arbeid går tapt?
//
//   Spurte for mye:  en lenke ut av et skjema med ulagret tekst ga sidas spørsmål, og etter OK nettleserens eget.
//   Spurte ikke:     nettleserens tilbake-knapp, bytte av menyspråk, og (klasser) å legge til eller fjerne en deltaker
//                    eller et kurs — alle forkastet ulagret tekst uten et ord.
//   Smått:           valgt fane fulgte med til neste element; en klasse som lastet ferdig etter at forfatteren hadde
//                    gått videre, ble tegnet over det som sto der; en listejobb tegnet lista over en åpen klasse.

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

/** Samler alle spørsmål nettleseren stiller (med type), og svarer det `svar()` sier akkurat da. */
function samleDialoger(page: Page, svar: () => "ok" | "avbryt") {
  const dialoger: string[] = [];
  page.on("dialog", (dialog) => {
    dialoger.push(dialog.type());
    return svar() === "ok" ? dialog.accept() : dialog.dismiss();
  });
  return dialoger;
}

/** Spør sida før man lukker fanen? Målt uten å forlate sida. */
const sporVedLukking = (page: Page) =>
  page.evaluate(() => {
    const hendelse = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(hendelse);
    return hendelse.defaultPrevented;
  });

/** Et svar testen holder tilbake til den slipper det. */
function tilbakeholdt() {
  let slipp!: () => void;
  const port = new Promise<void>((ferdig) => { slipp = ferdig; });
  return { port, slipp, kall: 0 };
}

// ───────────────────────────── Seksjoner ─────────────────────────────

const tekst = (navn: string) => ({ nb: `${navn} bokmål`, nn: `${navn} nynorsk`, "en-GB": `${navn} english` });
const SEKSJONER = { "sec-a": { title: tekst("Tittel A"), body: tekst("Tekst A") }, "sec-b": { title: tekst("Tittel B"), body: tekst("Tekst B") } } as const;
type SeksjonId = keyof typeof SEKSJONER;

async function mockSeksjoner(page: Page) {
  await mockBase(page);
  const rad = (id: SeksjonId) => ({ id, title: JSON.stringify(SEKSJONER[id].title), activeVersionId: "v1", archivedAt: null, versionNo: 1, courseCount: 0, updatedAt: "2026-10-25T08:00:00.000Z", lifecycle: "published", canManage: true, courses: [] });
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad("sec-a"), rad("sec-b")] }) }),
  );
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>forhåndsvisning</p>" }) }),
  );
  for (const id of Object.keys(SEKSJONER) as SeksjonId[]) {
    await page.route(`**/api/admin/content/sections/${id}`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ section: { id, title: JSON.stringify(SEKSJONER[id].title), bodyMarkdown: JSON.stringify(SEKSJONER[id].body), activeVersionId: "v1", archivedAt: null, hasUnpublishedChanges: false, assets: [] } }),
      }),
    );
  }
}

async function aapneSeksjon(page: Page, id: SeksjonId) {
  await page.locator(`[data-action="edit"][data-id="${id}"]`).click();
  await expect(page.locator("#titleInput")).toHaveValue(SEKSJONER[id].title.nb);
}

test.describe("#1155 — seksjoner", () => {
  test("en lenke ut av et skjema med ulagret tekst spør ÉN gang: sidas spørsmål, ikke nettleserens etterpå", async ({ page }) => {
    await mockSeksjoner(page);
    const dialoger = samleDialoger(page, () => "ok");
    await page.goto("/admin-content/sections");
    await aapneSeksjon(page, "sec-a");
    await page.locator("#titleInput").fill("Ulagret navn");
    await page.locator("#navKurs").click();
    await expect(page).toHaveURL(/\/admin-content\/courses/);
    expect(dialoger).toEqual(["confirm"]);
  });

  test("kontroll: svarer forfatteren Avbryt, blir hen stående, og lukking av fanen spør fortsatt", async ({ page }) => {
    await mockSeksjoner(page);
    const dialoger = samleDialoger(page, () => "avbryt");
    await page.goto("/admin-content/sections");
    await aapneSeksjon(page, "sec-a");
    await page.locator("#titleInput").fill("Ulagret navn");
    await page.locator("#navKurs").click();
    expect(dialoger).toEqual(["confirm"]);
    await expect(page).toHaveURL(/\/admin-content\/sections\?id=sec-a/);
    await expect(page.locator("#titleInput")).toHaveValue("Ulagret navn");
    expect(await sporVedLukking(page)).toBe(true);
  });

  test("svaret gjelder den ene navigeringen: blir det ikke noe av den, spør lukking av fanen igjen etter et øyeblikk", async ({ page }) => {
    await mockSeksjoner(page);
    const dialoger = samleDialoger(page, () => "ok");
    await page.goto("/admin-content/sections");
    await aapneSeksjon(page, "sec-a");
    // Noe annet stopper navigeringen etter at sida har spurt (her: testen selv).
    await page.evaluate(() => {
      document.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest("#navKurs")) event.preventDefault();
      });
    });

    // Uten endringer: lenka spør ikke, og ingenting huskes. Skriver forfatteren etterpå, spør lukking som vanlig.
    await page.locator("#navKurs").click();
    expect(dialoger).toEqual([]);
    await page.locator("#titleInput").fill("Ulagret navn");
    expect(await sporVedLukking(page)).toBe(true);

    // Med endringer og OK: rett etterpå spør ikke lukking en gang til …
    await page.locator("#navKurs").click();
    expect(dialoger).toEqual(["confirm"]);
    expect(await sporVedLukking(page)).toBe(false);
    // … men forfatteren står her fortsatt, med ulagret tekst, og da spør den igjen.
    await page.waitForTimeout(2300);
    expect(await sporVedLukking(page)).toBe(true);
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
  });

  // QA-porten 2.158.1: «← Tilbake til kurset» (seksjonen er åpnet fra et kurs) forlater sida fra kode, ikke med en lenke,
  // og spurte fortsatt to ganger.
  test("«← Tilbake til kurset» fra et skjema med ulagret tekst spør ÉN gang", async ({ page }) => {
    await mockSeksjoner(page);
    const dialoger = samleDialoger(page, () => "ok");
    await page.goto("/admin-content/sections?id=sec-a&returnTo=%2Fadmin-content%2Fcourses%2Fkurs-1");
    await expect(page.locator("#titleInput")).toHaveValue(SEKSJONER["sec-a"].title.nb);
    await page.locator("#titleInput").fill("Ulagret navn");
    await page.locator("#formBackLink").click();
    await expect(page).toHaveURL(/\/admin-content\/courses\/kurs-1/);
    expect(dialoger).toEqual(["confirm"]);
  });

  test("nettleserens tilbake-knapp fra et skjema med ulagret tekst spør; Avbryt beholder skjemaet, teksten og adressen", async ({ page }) => {
    await mockSeksjoner(page);
    let svar: "ok" | "avbryt" = "avbryt";
    const dialoger = samleDialoger(page, () => svar);
    await page.goto("/admin-content/sections");
    await aapneSeksjon(page, "sec-a");
    await page.locator("#titleInput").fill("Ulagret navn");

    await page.goBack();
    await expect.poll(() => dialoger).toEqual(["confirm"]);
    await expect(page.locator("#titleInput")).toHaveValue("Ulagret navn");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    expect(new URL(page.url()).search).toBe("?id=sec-a");

    // OK: da går hen til lista, og lista spør ikke igjen.
    svar = "ok";
    await page.goBack();
    await expect(page.locator("#sectionsTableBody")).toContainText("Tittel A bokmål");
    expect(dialoger).toEqual(["confirm", "confirm"]);
    expect(new URL(page.url()).search).toBe("");
  });

  test("kontroll: tilbake-knappen fra et skjema uten endringer spør ikke", async ({ page }) => {
    await mockSeksjoner(page);
    const dialoger = samleDialoger(page, () => "avbryt");
    await page.goto("/admin-content/sections");
    await aapneSeksjon(page, "sec-a");
    await page.goBack();
    await expect(page.locator("#sectionsTableBody")).toContainText("Tittel A bokmål");
    expect(dialoger).toEqual([]);
  });

  test("bytte av menyspråk i et skjema beholder ulagret tekst og «ulagret»", async ({ page }) => {
    await mockSeksjoner(page);
    let hentinger = 0;
    await page.route("**/api/admin/content/sections/sec-a", (route: Route) => { hentinger += 1; return route.fallback(); });
    await page.goto("/admin-content/sections");
    await aapneSeksjon(page, "sec-a");
    await page.locator("#titleInput").fill("Ulagret navn");
    await page.locator("#markdownInput").fill("Ulagret tekst");
    const foer = hentinger;

    await page.locator("#localeSelect").selectOption("en-GB");
    await expect(page.locator("#formPageDirty")).toHaveText("Unsaved changes");
    await expect(page.locator("#titleInput")).toHaveValue("Ulagret navn");
    await expect(page.locator("#markdownInput")).toHaveValue("Ulagret tekst");
    await expect(page.locator("#formSaveBtn")).toBeEnabled();
    expect(hentinger).toBe(foer);
  });

  test("kontroll: språkbytte i et skjema uten endringer lar det stå som «alt lagret», på det nye språket", async ({ page }) => {
    await mockSeksjoner(page);
    await page.goto("/admin-content/sections");
    await aapneSeksjon(page, "sec-a");
    await page.locator("#localeSelect").selectOption("en-GB");
    await expect(page.locator("#formPageDirty")).toHaveText("All saved");
    await expect(page.locator("#titleInput")).toHaveValue(SEKSJONER["sec-a"].title.nb);
  });

  test("neste seksjon åpner på første fane, også når forrige ble forlatt på «Innstillinger»", async ({ page }) => {
    await mockSeksjoner(page);
    await page.route("**/api/admin/content/owners**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners: [] }) }));
    await page.goto("/admin-content/sections");
    await aapneSeksjon(page, "sec-a");
    await page.locator("#formTab-innstillinger").click();
    await expect(page.locator("#titleInput")).toBeHidden();
    await page.locator("#formBackLink").click();
    await page.locator('[data-action="edit"][data-id="sec-b"]').click();
    await expect(page.locator("#formTab-rediger")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#titleInput")).toBeVisible();
    await expect(page.locator("#titleInput")).toHaveValue(SEKSJONER["sec-b"].title.nb);
  });
});

// ───────────────────────────── Klasser ─────────────────────────────

const KLASSER = [
  { id: "cls-1", name: "Kull 2026", description: "Første kull", isSystem: false, lifecycle: "active", _count: { members: 0, courseAssignments: 0 } },
  { id: "cls-2", name: "Kull 2027", description: "", isSystem: false, lifecycle: "active", _count: { members: 0, courseAssignments: 0 } },
];

async function mockKlasser(page: Page) {
  await mockBase(page);
  const tildelt: Array<{ courseId: string; title: string; dueAt: string | null }> = [];
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: KLASSER }) }),
  );
  await page.route("**/api/admin/content/classes/*", (route: Route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ class: KLASSER.find((k) => k.id === id) ?? KLASSER[0] }) });
  });
  await page.route("**/api/admin/content/classes/*/members", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: [] }) }),
  );
  await page.route("**/api/admin/content/classes/*/courses", (route: Route) => {
    if (route.request().method() === "POST") {
      tildelt.push({ courseId: "course-1", title: "Arbeidsmiljø", dueAt: null });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: tildelt }) });
  });
  await page.route("**/api/admin/content/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [{ id: "course-1", title: JSON.stringify({ nb: "Arbeidsmiljø" }), displayTitle: "Arbeidsmiljø", archivedAt: null, publishedAt: "2026-01-01T00:00:00.000Z" }] }) }),
  );
  await page.route("**/api/admin/content/owners**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners: [] }) }));
}

async function aapneKlasse(page: Page, id: string) {
  await page.locator(`[data-action="open"][data-id="${id}"]`).click();
  await expect(page.locator("#className")).toHaveValue(KLASSER.find((k) => k.id === id)!.name);
}

test.describe("#1155 — klasser", () => {
  test("å tildele et kurs beholder ulagret navn og beskrivelse, og klassen står fortsatt som ulagret", async ({ page }) => {
    await mockKlasser(page);
    await page.goto("/deltakere/klasser");
    await aapneKlasse(page, "cls-1");
    await page.locator("#className").fill("Nytt navn");
    await page.locator("#classDescription").fill("Ny beskrivelse");
    await page.locator("#courseSelect").selectOption("course-1");
    await page.locator("#assignCourseBtn").click();

    // Klassen er hentet på nytt (kurset står i lista), og det ulagrede står.
    await expect(page.locator("#courseChips")).toContainText("Arbeidsmiljø");
    await expect(page.locator("#className")).toHaveValue("Nytt navn");
    await expect(page.locator("#classDescription")).toHaveValue("Ny beskrivelse");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    await expect(page.locator("#formPageTitle")).toHaveText("Nytt navn");
  });

  test("kontroll: uten ulagret tekst står klassen som «Alt lagret» etter at et kurs er tildelt", async ({ page }) => {
    await mockKlasser(page);
    await page.goto("/deltakere/klasser");
    await aapneKlasse(page, "cls-1");
    await page.locator("#courseSelect").selectOption("course-1");
    await page.locator("#assignCourseBtn").click();
    await expect(page.locator("#courseChips")).toContainText("Arbeidsmiljø");
    await expect(page.locator("#className")).toHaveValue("Kull 2026");
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
  });

  test("bytte av menyspråk med en åpen klasse lar klassen stå, med ulagret navn", async ({ page }) => {
    await mockKlasser(page);
    await page.goto("/deltakere/klasser");
    await aapneKlasse(page, "cls-1");
    await page.locator("#className").fill("Nytt navn");
    await page.locator("#localeSelect").selectOption("en-GB");
    await expect(page.locator("#formPageDirty")).toHaveText("Unsaved changes");
    await expect(page.locator("#className")).toHaveValue("Nytt navn");
    expect(new URL(page.url()).search).toBe("?id=cls-1");
  });

  // QA-porten 2.158.1 (regresjon i denne pakken): «ulagret» fra en klasse man forlot med OK, levde til neste klasse var
  // ferdig lastet. Språkbytte i det vinduet leste et navnefelt som ikke fantes, og satte tomt navn inn i den nye klassen.
  test("språkbytte mens en klasse laster, setter ikke tomt navn inn i den", async ({ page }) => {
    await mockKlasser(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/classes/cls-2", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ class: KLASSER[1] }) });
    });
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/deltakere/klasser");
    await aapneKlasse(page, "cls-1");
    await page.locator("#className").fill("Ulagret navn i klasse 1");
    await page.locator("#formBackLink").click();
    await expect(page.locator("#classesTableBody")).toContainText("Kull 2027");
    await page.locator('[data-action="open"][data-id="cls-2"]').click();
    await expect.poll(() => svar.kall).toBe(1);
    await page.locator("#localeSelect").selectOption("en-GB");

    svar.slipp();
    await expect(page.locator("#className")).toHaveValue("Kull 2027");
    await expect(page.locator("#formPageDirty")).toHaveText("All saved");
  });

  test("nettleserens tilbake-knapp fra en klasse med ulagret navn spør; Avbryt beholder klassen og navnet", async ({ page }) => {
    await mockKlasser(page);
    const dialoger = samleDialoger(page, () => "avbryt");
    await page.goto("/deltakere/klasser");
    await aapneKlasse(page, "cls-1");
    await page.locator("#className").fill("Nytt navn");
    await page.goBack();
    await expect.poll(() => dialoger).toEqual(["confirm"]);
    await expect(page.locator("#className")).toHaveValue("Nytt navn");
    expect(new URL(page.url()).search).toBe("?id=cls-1");
  });

  test("neste klasse åpner på første fane, også når forrige ble forlatt på «Innstillinger»", async ({ page }) => {
    await mockKlasser(page);
    await page.goto("/deltakere/klasser");
    await aapneKlasse(page, "cls-1");
    await page.locator("#formTab-innstillinger").click();
    await expect(page.locator("#className")).toBeHidden();
    await page.locator("#formBackLink").click();
    await page.locator('[data-action="open"][data-id="cls-2"]').click();
    await expect(page.locator("#className")).toBeVisible();
    await expect(page.locator("#className")).toHaveValue("Kull 2027");

    // Samme regel når klassen åpnes av nettleserens tilbake-knapp (ruta), ikke av «Åpne» i lista.
    await page.locator("#formTab-innstillinger").click();
    await expect(page.locator("#className")).toBeHidden();
    await page.goBack();
    await expect(page.locator("#classesTableBody")).toContainText("Kull 2026");
    await page.goBack();
    await expect(page.locator("#className")).toHaveValue("Kull 2026");
    await expect(page.locator("#className")).toBeVisible();
  });

  test("en klasse som laster ferdig etter at forfatteren har gått tilbake, tegnes ikke over lista", async ({ page }) => {
    await mockKlasser(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/classes/cls-1", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ class: KLASSER[0] }) });
    });
    await page.goto("/deltakere/klasser");
    await expect(page.locator("#classesTableBody")).toContainText("Kull 2026");
    await page.locator('[data-action="open"][data-id="cls-1"]').click();
    await expect.poll(() => svar.kall).toBe(1);
    await page.goBack();
    await expect(page.locator("#classesTableBody")).toContainText("Kull 2026");

    svar.slipp();
    await page.waitForTimeout(800);
    await expect(page.locator("#classesTableBody")).toContainText("Kull 2026");
    await expect(page.locator("#className")).toHaveCount(0);
  });

  test("en arkivering startet i lista tegner ikke lista over en klasse som er åpnet i mellomtiden", async ({ page }) => {
    await mockKlasser(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/classes/cls-1/archive", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/deltakere/klasser");
    await expect(page.locator("#classesTableBody")).toContainText("Kull 2026");
    await page.locator('[data-action="archive"][data-id="cls-1"]').click();
    await expect.poll(() => svar.kall).toBe(1);
    await aapneKlasse(page, "cls-2");
    await page.locator("#className").fill("Ulagret navn");

    svar.slipp();
    await page.waitForTimeout(800);
    await expect(page.locator("#className")).toHaveValue("Ulagret navn");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
  });
});
