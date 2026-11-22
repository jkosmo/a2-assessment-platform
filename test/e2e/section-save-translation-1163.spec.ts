import { test, expect, type Page, type Route } from "@playwright/test";
import { revealRowAction } from "./admin-content-helpers.js";

// #1163 skive 2 (prinsipp 3, 4 og 5, doc/DECISIONS.md «felles prinsipper»): seksjonen oversettes ved «Lagre» — bare feltene som
// er endret, fra språket som ble endret — og har ingen «Oversett»-knapp. «Avbryt» skriver ingenting. Et 409 lar fanen stå slik
// forfatteren hadde den. Figurene oversettes av tjeneren i samme lagring. «Fyll inn det som mangler» fyller hullene porten fant,
// lagrer utkastet og publiserer på nytt, i redigereren og i lista.

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
  await page.route("**/api/admin/content-owners/SECTION/*", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners: [], canManageOwners: false }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

type Map3 = { nb: string; nn: string; "en-GB": string };
const tittel: Map3 = { nb: "Tilbud", nn: "Tilbod", "en-GB": "Bids" };
const tekst: Map3 = { nb: "Gammel tekst.", nn: "Gammal tekst.", "en-GB": "Old text." };

function detalj(over: Record<string, unknown> = {}) {
  return {
    id: "sec-1", title: JSON.stringify(tittel), bodyMarkdown: JSON.stringify(tekst), activeVersionId: "v1", archivedAt: null, canManage: true,
    versionNo: 1, publishedVersionNo: 1, publishedTitle: JSON.stringify(tittel), hasUnpublishedChanges: false, draftSavedAt: null, courses: [],
    ...over,
  };
}

/** Alt redigereren sender til tjeneren, unntatt det som bare leser (GET) og forhåndsvisningen. */
function skrivinger(page: Page) {
  const kall: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    if (request.method() === "GET" || url.pathname.endsWith("/sections/preview")) return;
    kall.push(`${request.method()} ${url.pathname}`);
  });
  return kall;
}

/** Oversetteren: `[<mål>] <kilde>` for hvert felt den får. Kallene samles. */
async function mockLocalize(page: Page, svar: (body: Record<string, string>) => { status: number; body: Record<string, unknown> } | null = () => null) {
  const kall: Array<Record<string, string>> = [];
  await page.route("**/api/admin/content/sections/localize", (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, string>;
    kall.push(body);
    const egen = svar(body);
    if (egen) return route.fulfill({ status: egen.status, contentType: "application/json", body: JSON.stringify(egen.body) });
    const out: Record<string, string> = {};
    for (const field of ["title", "bodyMarkdown"]) if (body[field]) out[field] = `[${body.targetLocale}] ${body[field]}`;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
  return kall;
}

/** Detaljen (GET) og lagringen (PUT) på samme adresse. `lagre` svarer på lagringen. */
async function mockSection(page: Page, hent: () => Record<string, unknown>, lagre: (body: Record<string, any>) => { status: number; body: Record<string, unknown> }) {
  const lagringer: Array<Record<string, any>> = [];
  await page.route("**/api/admin/content/sections/sec-1", (route: Route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, any>;
      lagringer.push(body);
      const svar = lagre(body);
      return route.fulfill({ status: svar.status, contentType: "application/json", body: JSON.stringify(svar.body) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: hent() }) });
  });
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) }),
  );
  return lagringer;
}

const lagretSvar = (body: Record<string, any>, over: Record<string, unknown> = {}) => ({
  status: 200,
  body: { section: detalj({ versionNo: (body.expectedVersionNo as number) + 1, hasUnpublishedChanges: true, title: JSON.stringify(body.title), bodyMarkdown: JSON.stringify(body.bodyMarkdown) }), altWarnings: [], ...over },
});

test.describe("#1163 skive 2 — seksjonen oversettes ved lagring", () => {
  test("ingen «Oversett»-knapp; bare det endrede feltet oversettes, fra språket som ble endret; lagringen sender kildespråket", async ({ page }) => {
    await mockBase(page);
    const oversatt = await mockLocalize(page);
    const lagringer = await mockSection(page, () => detalj(), (body) => lagretSvar(body));
    await page.goto("/admin-content/sections?id=sec-1");
    await expect(page.locator("#titleInput")).toHaveValue("Tilbud");
    await expect(page.locator("#translateBtn")).toHaveCount(0);
    await expect(page.locator('[data-editor-action="translate"]')).toHaveCount(0);

    // Forfatteren skriver på engelsk denne gangen; tittelen røres ikke.
    await page.locator('[data-form-locale="en-GB"]').click();
    await page.locator("#markdownInput").fill("New text.");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => lagringer.length).toBe(1);

    expect(oversatt.map((k) => `${k.sourceLocale}>${k.targetLocale}`).sort()).toEqual(["en-GB>nb", "en-GB>nn"]);
    expect(oversatt.every((k) => k.bodyMarkdown === "New text." && !("title" in k))).toBe(true);
    expect(lagringer[0]).toMatchObject({
      title: tittel,
      bodyMarkdown: { nb: "[nb] New text.", nn: "[nn] New text.", "en-GB": "New text." },
      sourceLocale: "en-GB",
      expectedVersionNo: 1,
    });
    await expect(page.locator(".toast__message").last()).toContainText("Lagret som utkast.");
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
    await page.locator('[data-form-locale="nn"]').click();
    await expect(page.locator("#markdownInput")).toHaveValue("[nn] New text.");
    await expect(page.locator("#titleInput")).toHaveValue("Tilbod");

    // Neste lagring uten nye endringer i teksten: ingenting oversettes på nytt.
    await page.locator("#titleInput").fill("Tilbod no");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => lagringer.length).toBe(2);
    expect(oversatt.slice(2).every((k) => k.title === "Tilbod no" && !("bodyMarkdown" in k))).toBe(true);
    expect(oversatt.slice(2).map((k) => k.targetLocale).sort()).toEqual(["en-GB", "nb"]);
  });

  test("«Avbryt» skriver ingenting til tjeneren og viser det som er lagret", async ({ page }) => {
    await mockBase(page);
    const oversatt = await mockLocalize(page);
    await mockSection(page, () => detalj(), (body) => lagretSvar(body));
    const kall = skrivinger(page);
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#markdownInput").fill("Noe jeg angrer på.");
    await page.locator("#titleInput").fill("Ny tittel");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    await page.locator("#formCancelLink").click();
    await expect(page.locator("#markdownInput")).toHaveValue("Gammel tekst.");
    await expect(page.locator("#titleInput")).toHaveValue("Tilbud");
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
    expect(kall).toEqual([]);
    expect(oversatt).toEqual([]);
  });

  test("409 `section_changed`: ingenting endres i fanen — forfatterens tekst står, og de andre språkene viser ikke oversettelser som aldri ble lagret", async ({ page }) => {
    await mockBase(page);
    const oversatt = await mockLocalize(page);
    await mockSection(page, () => detalj(), () => ({ status: 409, body: { error: "section_changed", message: "x" } }));
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#markdownInput").fill("Det jeg skrev.");
    await page.locator("#formSaveBtn").click();
    await expect(page.locator(".toast__message").last()).toContainText("Ingenting ble endret.");
    expect(oversatt.length).toBe(2);
    await expect(page.locator("#markdownInput")).toHaveValue("Det jeg skrev.");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    await page.locator('[data-form-locale="nn"]').click();
    await expect(page.locator("#markdownInput")).toHaveValue("Gammal tekst.");
  });

  test("en oversetting som feiler: det som finnes, lagres; språket står tomt, og meldingen sier at publiseringen kan fylle det inn", async ({ page }) => {
    await mockBase(page);
    await mockLocalize(page, (body) => (body.targetLocale === "nn" ? { status: 500, body: { error: "internal_error" } } : null));
    const lagringer = await mockSection(page, () => detalj(), (body) => lagretSvar(body));
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#markdownInput").fill("Ny tekst.");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => lagringer.length).toBe(1);
    expect(lagringer[0]!.bodyMarkdown).toEqual({ nb: "Ny tekst.", "en-GB": "[en-GB] Ny tekst." });
    await expect(page.locator(".toast--warning .toast__detail")).toContainText("Oversettelsen til Norsk nynorsk feilet");
    await page.locator('[data-form-locale="nn"]').click();
    await expect(page.locator("#markdownInput")).toHaveValue("");
  });

  test("figurene: tjeneren oversetter dem i lagringen; kvitteringen sier hvor mange som ble oversatt, og hvor mange som feilet", async ({ page }) => {
    await mockBase(page);
    await mockLocalize(page);
    let runde = 0;
    const lagringer = await mockSection(page, () => detalj(), (body) => {
      runde += 1;
      return lagretSvar(body, { figureTranslation: runde === 1 ? { translated: 1, failed: 0 } : { translated: 0, failed: 2 } });
    });
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#markdownInput").fill("Se figuren ![Flyt](asset:fig-1)");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => lagringer.length).toBe(1);
    expect(lagringer[0]).toMatchObject({ sourceLocale: "nb" });
    await expect(page.locator(".toast__detail").last()).toContainText("SVG-tegninger oversatt");

    await page.locator("#markdownInput").fill("Se figurene ![Flyt](asset:fig-1) ![Mer](asset:fig-2)");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => lagringer.length).toBe(2);
    await expect(page.locator(".toast--warning .toast__detail").last()).toContainText("2 figur(er) kunne ikke oversettes");
  });
});

test.describe("#1163 skive 2 — «Fyll inn det som mangler»: fyll inn, lagre utkastet, publiser på nytt", () => {
  const gate = { error: "publish_blocked_by_validation", message: "x", issues: [{ code: "translation_incomplete", severity: "blocking", field: "bodyMarkdown", missingLocales: ["en-GB", "nn"] }] };

  test("redigereren: et eldre utkast porten holdt igjen — hullene fylles fra bokmål, utkastet lagres med versjonen forfatteren så, og publiseres", async ({ page }) => {
    await mockBase(page);
    const oversatt = await mockLocalize(page);
    let state: Record<string, unknown> = detalj({ versionNo: 2, hasUnpublishedChanges: true, bodyMarkdown: JSON.stringify({ nb: "Holdt igjen." }), draftSavedAt: "2026-11-10T10:00:00.000Z" });
    const lagringer = await mockSection(page, () => state, (body) => {
      const svar = lagretSvar(body);
      state = svar.body.section;
      return svar;
    });
    const publiseringer: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/sections/sec-1/publish", (route: Route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      publiseringer.push(body);
      if (publiseringer.length === 1) return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify(gate) });
      state = { ...state, activeVersionId: "v3", publishedVersionNo: 3, hasUnpublishedChanges: false };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: state }) });
    });

    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#sectionPublishNewBtn").click();
    await page.locator("#sectionPublishConfirmBtn").click();
    const melding = page.locator(".toast--error").last();
    await expect(melding).toContainText("Kan ikke publisere — seksjonen mangler");
    await melding.getByRole("button", { name: "Fyll inn det som mangler" }).click();

    await expect.poll(() => publiseringer.length).toBe(2);
    expect(publiseringer[0]).toEqual({ expectedVersionNo: 2 });
    expect(oversatt.map((k) => `${k.sourceLocale}>${k.targetLocale}`).sort()).toEqual(["nb>en-GB", "nb>nn"]);
    expect(oversatt.every((k) => k.bodyMarkdown === "Holdt igjen." && !("title" in k))).toBe(true);
    expect(lagringer).toHaveLength(1);
    expect(lagringer[0]).toMatchObject({
      expectedVersionNo: 2,
      expectedTitle: JSON.stringify(tittel),
      sourceLocale: "nb",
      title: tittel,
      bodyMarkdown: { nb: "Holdt igjen.", nn: "[nn] Holdt igjen.", "en-GB": "[en-GB] Holdt igjen." },
    });
    // Publisert på nytt: versjonen lagringen laget.
    expect(publiseringer[1]).toEqual({ expectedVersionNo: 3 });
    await expect(page.locator(".toast__message").last()).toContainText("Det som manglet, er fylt inn, lagret og publisert.");
    await expect(page.locator("#sectionPublishNewBtn")).toHaveCount(0);
    await page.locator('[data-form-locale="nn"]').click();
    await expect(page.locator("#markdownInput")).toHaveValue("[nn] Holdt igjen.");
  });

  test("lista: et utkast laget av agent-API-et (bare bokmål) fylles, lagres og publiseres fra raden", async ({ page }) => {
    await mockBase(page);
    const oversatt = await mockLocalize(page);
    const bareBokmal = JSON.stringify({ nb: "Fra agenten" });
    // Teksten har alt nynorsk (skrevet av forfatteren); bare engelsk mangler der. Den nynorske teksten skal stå.
    let state: Record<string, unknown> = detalj({ title: bareBokmal, bodyMarkdown: JSON.stringify({ nb: "Agentens tekst.", nn: "Skriven for hand." }), activeVersionId: null, publishedVersionNo: null, publishedTitle: null });
    const lagringer = await mockSection(page, () => state, (body) => {
      const svar = lagretSvar(body);
      state = svar.body.section;
      return svar;
    });
    await page.route("**/api/admin/content/sections", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [{ id: "sec-1", title: bareBokmal, titleLocales: ["nb"], activeVersionId: null, archivedAt: null, versionNo: null, latestVersionNo: 1, courseCount: 0, courses: [], updatedAt: "2026-11-15T08:00:00.000Z", lifecycle: "draft", canManage: true }] }) }),
    );
    const publiseringer: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/sections/sec-1/publish", (route: Route) => {
      publiseringer.push(route.request().postDataJSON() as Record<string, unknown>);
      if (publiseringer.length === 1) {
        return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ ...gate, issues: [{ code: "translation_incomplete", severity: "blocking", field: "title", missingLocales: ["en-GB", "nn"] }, { ...gate.issues[0], missingLocales: ["en-GB"] }] }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { ...state, activeVersionId: "v2" } }) });
    });

    await page.goto("/admin-content/sections");
    await (await revealRowAction(page, page.locator('[data-action="publish"][data-id="sec-1"]'))).click();
    await page.locator("#sectionPublishConfirmBtn").click();
    await page.locator(".toast--error").last().getByRole("button", { name: "Fyll inn det som mangler" }).click();

    await expect.poll(() => publiseringer.length).toBe(2);
    expect(lagringer[0]).toMatchObject({
      expectedVersionNo: 1,
      expectedTitle: bareBokmal,
      title: { nb: "Fra agenten", nn: "[nn] Fra agenten", "en-GB": "[en-GB] Fra agenten" },
      bodyMarkdown: { nb: "Agentens tekst.", nn: "Skriven for hand.", "en-GB": "[en-GB] Agentens tekst." },
    });
    // Bare hullene: kallet til nynorsk ba bare om tittelen.
    expect(oversatt.filter((k) => k.targetLocale === "nn").every((k) => !("bodyMarkdown" in k))).toBe(true);
    expect(publiseringer[1]).toEqual({ expectedVersionNo: 2 });
    await expect(page.locator(".toast__message").last()).toContainText("Det som manglet, er fylt inn, lagret og publisert.");
  });

  test("kontroll: kunne ikke alt fylles, lagres det som lyktes, og ingenting publiseres", async ({ page }) => {
    await mockBase(page);
    await mockLocalize(page, (body) => (body.targetLocale === "nn" ? { status: 500, body: { error: "internal_error" } } : null));
    let state: Record<string, unknown> = detalj({ versionNo: 2, hasUnpublishedChanges: true, bodyMarkdown: JSON.stringify({ nb: "Holdt igjen." }) });
    const lagringer = await mockSection(page, () => state, (body) => {
      const svar = lagretSvar(body);
      state = svar.body.section;
      return svar;
    });
    const publiseringer: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/sections/sec-1/publish", (route: Route) => {
      publiseringer.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify(gate) });
    });
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#sectionPublishNewBtn").click();
    await page.locator("#sectionPublishConfirmBtn").click();
    await page.locator(".toast--error").last().getByRole("button", { name: "Fyll inn det som mangler" }).click();

    await expect(page.locator(".toast--warning .toast__message").last()).toContainText("Noe av det som manglet, kunne ikke oversettes.");
    expect(lagringer).toHaveLength(1);
    expect(lagringer[0]!.bodyMarkdown).toEqual({ nb: "Holdt igjen.", "en-GB": "[en-GB] Holdt igjen." });
    expect(publiseringer).toHaveLength(1);
  });

  // QA 2.167.0: porten ser ikke på figurene, så en figur som ikke ble oversatt, ville gått ut på kildespråket.
  test("en figur som ikke ble oversatt ved utfyllingen: utkastet lagres, og ingenting publiseres", async ({ page }) => {
    await mockBase(page);
    await mockLocalize(page);
    let state: Record<string, unknown> = detalj({ versionNo: 2, hasUnpublishedChanges: true, bodyMarkdown: JSON.stringify({ nb: "Holdt igjen." }) });
    const lagringer = await mockSection(page, () => state, (body) => {
      const svar = lagretSvar(body, { figureTranslation: { translated: 0, failed: 1 } });
      state = svar.body.section;
      return svar;
    });
    const publiseringer: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/sections/sec-1/publish", (route: Route) => {
      publiseringer.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify(gate) });
    });
    await page.goto("/admin-content/sections?id=sec-1");
    await page.locator("#sectionPublishNewBtn").click();
    await page.locator("#sectionPublishConfirmBtn").click();
    await page.locator(".toast--error").last().getByRole("button", { name: "Fyll inn det som mangler" }).click();

    await expect(page.locator(".toast--warning .toast__message").last()).toContainText("Noe av det som manglet, kunne ikke oversettes.");
    expect(lagringer).toHaveLength(1);
    expect(publiseringer, "bare det første forsøket; utfyllingen publiserte ikke").toHaveLength(1);
  });
});
