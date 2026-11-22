import { test, expect, type Page, type Route } from "@playwright/test";

// #1163 skive 1: «Lagre» på en seksjon lager et utkast; «Publiser» (med en dialog som sier hvilke kurs som får den nye
// teksten) er det eneste deltakerne ser. Redigereren lagrer i ÉTT kall (`PUT …/sections/:id`) med det fanen lastet, og viser
// stripen «Deltakerne ser versjon X til utkastet er publisert».

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
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>forhåndsvisning</p>" }) }),
  );
  // #1163 skive 2: lagringen oversetter det som er endret. Oversetteren svarer `[<mål>] <kilde>`.
  await page.route("**/api/admin/content/sections/localize", (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, string>;
    const out: Record<string, string> = {};
    for (const field of ["title", "bodyMarkdown"]) if (body[field]) out[field] = `[${body.targetLocale}] ${body[field]}`;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

const tittel = JSON.stringify({ nb: "Tilbud: prompter", nn: "Tilbod: prompter", "en-GB": "Bids: prompts" });
const tekst = JSON.stringify({ nb: "Tekst", nn: "Tekst", "en-GB": "Text" });
const kurs = [{ id: "course-a", title: "Kurs A" }, { id: "course-b", title: "Kurs B" }];

/** Seksjonens detalj slik tjeneren sender den: det redigerbare og det deltakerne ser. */
function detalj(over: Record<string, unknown> = {}) {
  return {
    id: "sec-1", title: tittel, bodyMarkdown: tekst, activeVersionId: "v1", archivedAt: null, canManage: true,
    versionNo: 1, publishedVersionNo: 1, publishedTitle: tittel, hasUnpublishedChanges: false, draftSavedAt: null, courses: kurs,
    ...over,
  };
}

const rad = (over: Record<string, unknown> = {}) => ({ id: "sec-1", title: tittel, activeVersionId: "v1", archivedAt: null, versionNo: 1, latestVersionNo: 1, courseCount: 2, courses: kurs, updatedAt: "2026-11-15T08:00:00.000Z", lifecycle: "published", canManage: true, ...over });

/** Bare GET på detaljen; PUT til samme adresse er lagringen og mockes for seg. */
async function mockDetail(page: Page, hent: () => Record<string, unknown>) {
  await page.route("**/api/admin/content/sections/sec-1", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: hent() }) });
  });
}

test.describe("#1163 — seksjonsredigereren lagrer et utkast", () => {
  test("én lagring med det fanen lastet; meldingen sier at deltakerne ikke ser endringen; stripen; neste lagring sender den nye versjonen", async ({ page }) => {
    await mockBase(page);
    await page.route("**/api/admin/content/sections", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad()] }) }));
    await mockDetail(page, () => detalj());
    const lagringer: Array<Record<string, unknown>> = [];
    const gamleKall: string[] = [];
    await page.route("**/api/admin/content/sections/sec-1/*", (route: Route) => {
      gamleKall.push(`${route.request().method()} ${route.request().url().split("/").pop()}`);
      return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    });
    await page.route("**/api/admin/content/sections/sec-1", (route: Route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      lagringer.push(body);
      const versionNo = (body.expectedVersionNo as number) + 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ section: detalj({ versionNo, hasUnpublishedChanges: true, draftSavedAt: "2026-11-15T13:05:00.000Z", title: JSON.stringify(body.title) }), altWarnings: [] }),
      });
    });

    await page.goto("/admin-content/sections?id=sec-1");
    await expect(page.locator("[data-section-draft-line]")).toHaveCount(0);
    await page.locator("#markdownInput").fill("Ny tekst.");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => lagringer.length).toBe(1);
    expect(lagringer[0]).toMatchObject({ expectedVersionNo: 1, expectedTitle: tittel, bodyMarkdown: { nb: "Ny tekst." } });
    expect(gamleKall).toEqual([]);
    await expect(page.locator(".toast__message").last()).toContainText("Lagret som utkast. Deltakerne ser ikke endringen før den er publisert.");
    // Den røde meldingen fra før (#916) er borte.
    await expect(page.locator(".toast--error")).toHaveCount(0);
    // Stripen og merket.
    await expect(page.locator(".status-chip")).toHaveText("Nyere utkast");
    await expect(page.locator("[data-section-draft-line]")).toContainText("Deltakerne ser versjon 1 til utkastet er publisert.");

    // Revisjonen er oppdatert etter lagringen: neste lagring i samme fane sender versjon 2 og tittelen den sendte.
    await page.locator("#markdownInput").fill("Enda nyere.");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => lagringer.length).toBe(2);
    expect(lagringer[1]).toMatchObject({ expectedVersionNo: 2 });
    expect(JSON.parse(lagringer[1]!.expectedTitle as string)).toEqual(JSON.parse(tittel));
  });

  test("409 `section_changed`: meldingen sier at ingenting ble endret, og teksten står i feltet", async ({ page }) => {
    await mockBase(page);
    await page.route("**/api/admin/content/sections", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad()] }) }));
    await mockDetail(page, () => detalj());
    await page.route("**/api/admin/content/sections/sec-1", (route: Route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "section_changed", message: "The section was saved somewhere else." }) });
    });
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#markdownInput").fill("Det jeg skrev.");
    await page.locator("#formSaveBtn").click();
    await expect(page.locator(".toast__message").last()).toContainText("Seksjonen er lagret et annet sted etter at du åpnet den. Ingenting ble endret.");
    await expect(page.locator("#markdownInput")).toHaveValue("Det jeg skrev.");
  });

  test("en ny seksjon lagres som utkast (`draft: true`), og hodet sier «Utkast»", async ({ page }) => {
    await mockBase(page);
    const opprettet: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/sections", (route: Route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        opprettet.push(body);
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ section: detalj({ id: "sec-ny", activeVersionId: null, publishedVersionNo: null, publishedTitle: null, courses: [] }), altWarnings: [] }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) });
    });
    await page.goto("/admin-content/sections?new");
    await page.locator("#titleInput").fill("Ny seksjon");
    await page.locator("#markdownInput").fill("Tekst.");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => opprettet.length).toBe(1);
    expect(opprettet[0]).toMatchObject({ draft: true });
    await expect(page.locator(".status-badge").first()).toHaveText("Utkast");
  });
});

test.describe("#1163 — lista sender det den så", () => {
  test("«Døp om» sender versjonen og tittelen raden viste, og meldingen sier at navnet er et utkast", async ({ page }) => {
    await mockBase(page);
    await page.route("**/api/admin/content/sections", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad({ latestVersionNo: 3 })] }) }));
    const sendt: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/sections/sec-1/title", (route: Route) => {
      sendt.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: detalj({ versionNo: 4, hasUnpublishedChanges: true }) }) });
    });
    await page.goto("/admin-content/sections");
    const raden = page.locator('tr[data-row-id="sec-1"]');
    await raden.getByRole("button", { name: "Døp om" }).click();
    const felt = raden.locator(".row-rename input");
    await felt.fill("Tilbud: nye prompter");
    await felt.press("Enter");
    await expect.poll(() => sendt.length).toBe(1);
    expect(sendt[0]).toMatchObject({ expectedVersionNo: 3, expectedTitle: tittel, title: { nb: "Tilbud: nye prompter" } });
    await expect(page.locator(".toast__message").last()).toContainText("Navnet er lagret som utkast. Deltakerne ser det gamle navnet til seksjonen er publisert.");
  });

  test("«Oversett det som mangler» sender versjonen hver rad viste", async ({ page }) => {
    await mockBase(page);
    const bareBokmal = JSON.stringify({ nb: "Bare bokmål" });
    await page.route("**/api/admin/content/sections", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad({ title: bareBokmal, latestVersionNo: 5, titleLocales: ["nb"] })] }) }));
    await page.route("**/api/admin/content/titles/localize", (route: Route) => {
      const kropp = route.request().postDataJSON() as { title: string; targetLocales: string[] };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: Object.fromEntries(kropp.targetLocales.map((l) => [l, `${kropp.title} [${l}]`])), failedLocales: [] }) });
    });
    const sendt: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/sections/sec-1/title", (route: Route) => {
      sendt.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: detalj() }) });
    });
    await page.goto("/admin-content/sections");
    await page.getByRole("button", { name: /Oversett det som mangler/ }).click();
    await expect.poll(() => sendt.length).toBe(1);
    expect(sendt[0]).toMatchObject({ expectedVersionNo: 5, expectedTitle: bareBokmal });
  });
});

test.describe("#1163 — publiseringsdialogen", () => {
  test("redigereren: dialogen lister kursene; Avbryt sender ingenting; Publiser sender versjonen forfatteren så, og stripen forsvinner", async ({ page }) => {
    await mockBase(page);
    await page.route("**/api/admin/content/sections", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad({ lifecycle: "published_with_draft", latestVersionNo: 2 })] }) }));
    let publisert = false;
    await mockDetail(page, () => detalj(publisert ? { versionNo: 2, publishedVersionNo: 2 } : { versionNo: 2, hasUnpublishedChanges: true, draftSavedAt: "2026-11-15T13:05:00.000Z" }));
    const kall: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/sections/sec-1/publish", (route: Route) => {
      kall.push(route.request().postDataJSON() as Record<string, unknown>);
      publisert = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: detalj({ versionNo: 2, activeVersionId: "v2", publishedVersionNo: 2 }) }) });
    });

    await page.goto("/admin-content/sections?id=sec-1");
    await expect(page.locator("[data-section-draft-line]")).toContainText("Deltakerne ser versjon 1");
    const dialog = page.locator("#sectionPublishDialog");

    await page.locator("#sectionPublishNewBtn").click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#sectionPublishText")).toContainText("Seksjonen står i disse kursene (2)");
    await expect(dialog.locator(".section-publish-courses li")).toHaveText(["Kurs A", "Kurs B"]);
    // Fokus på Avbryt: publiseringen når deltakerne.
    await expect(page.locator("#sectionPublishCancelBtn")).toBeFocused();
    await page.locator("#sectionPublishCancelBtn").click();
    await expect(dialog).toBeHidden();
    expect(kall).toEqual([]);

    await page.locator("#sectionPublishNewBtn").click();
    await page.locator("#sectionPublishConfirmBtn").click();
    await expect.poll(() => kall.length).toBe(1);
    expect(kall[0]).toEqual({ expectedVersionNo: 2 });
    await expect(page.locator(".toast__message").last()).toContainText("Ny versjon publisert.");
    await expect(page.locator("[data-section-draft-line]")).toHaveCount(0);
    await expect(page.locator("#sectionPublishNewBtn")).toHaveCount(0);
  });

  test("en seksjon som ikke står i noe kurs: dialogen sier det", async ({ page }) => {
    await mockBase(page);
    await page.route("**/api/admin/content/sections", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad({ lifecycle: "draft", activeVersionId: null, courses: [], courseCount: 0 })] }) }));
    await mockDetail(page, () => detalj({ activeVersionId: null, publishedVersionNo: null, publishedTitle: null, courses: [] }));
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#sectionLifecycleBtn").click();
    await expect(page.locator("#sectionPublishText")).toContainText("Seksjonen står ikke i noe kurs.");
    await expect(page.locator("#sectionPublishCourses")).toBeHidden();
  });

  test("lista: «Publiser ny versjon» åpner dialogen og sender versjonen raden viste; et 409 henter lista på nytt", async ({ page }) => {
    await mockBase(page);
    let henting = 0;
    await page.route("**/api/admin/content/sections", (route: Route) => {
      henting += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad({ lifecycle: "published_with_draft", latestVersionNo: 4 })] }) });
    });
    const kall: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/sections/sec-1/publish", (route: Route) => {
      kall.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "section_changed", message: "x" }) });
    });
    await page.goto("/admin-content/sections");
    await page.locator('[data-action="publish-new"][data-id="sec-1"]').click();
    await expect(page.locator("#sectionPublishDialog")).toBeVisible();
    const før = henting;
    await page.locator("#sectionPublishConfirmBtn").click();
    await expect.poll(() => kall).toEqual([{ expectedVersionNo: 4 }]);
    await expect(page.locator(".toast__message").last()).toContainText("Ingenting ble endret.");
    await expect.poll(() => henting).toBeGreaterThan(før);
  });
});
