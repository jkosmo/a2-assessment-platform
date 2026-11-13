import { test, expect, type Page, type Route } from "@playwright/test";
import { revealRowAction } from "./admin-content-helpers.js";

// #1154 (QA-porten 2.157.2): seksjonslista og seksjonsskjemaet tegner i samme element og bytter uten at sida lastes.
// En jobb som blir ferdig ETTER at forfatteren har byttet visning, skrev likevel i det som da sto på skjermen:
//   - «Oversett» startet i seksjon A la nynorsk og engelsk fra A inn i seksjon B, og merket B som ulagret,
//   - et bilde lastet opp i A ble satt inn i teksten til B,
//   - første lagring av en ny seksjon tegnet skjemaet over lista når svaret kom,
//   - en jobb startet i lista («Avpubliser») tegnet lista over et skjema som var åpnet i mellomtiden.
// Hver jobb husker nå hvilken visning den startet i, og lar skjermen være hvis forfatteren har gått videre.

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
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

const tekst = (navn: string) => ({ nb: `${navn} bokmål`, nn: `${navn} nynorsk`, "en-GB": `${navn} english` });
const SEKSJONER = {
  "sec-a": { title: tekst("Tittel A"), body: tekst("Tekst A") },
  "sec-b": { title: tekst("Tittel B"), body: tekst("Tekst B") },
} as const;
type SeksjonId = keyof typeof SEKSJONER;

const rad = (id: SeksjonId) => ({
  id, title: JSON.stringify(SEKSJONER[id].title), activeVersionId: "v1", archivedAt: null, versionNo: 1, courseCount: 0,
  updatedAt: "2026-10-25T08:00:00.000Z", lifecycle: "published", canManage: true, courses: [],
});

async function mockSeksjoner(page: Page) {
  await mockBase(page);
  await page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad("sec-a"), rad("sec-b")] }) });
  });
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

/** Et svar testen holder tilbake til den slipper det. `kall` teller hvor mange forespørsler som har kommet. */
function tilbakeholdt() {
  let slipp!: () => void;
  const port = new Promise<void>((ferdig) => { slipp = ferdig; });
  return { port, slipp, kall: 0 };
}

async function aapne(page: Page, id: SeksjonId) {
  await page.locator(`[data-action="edit"][data-id="${id}"]`).click();
  await expect(page.locator("#titleInput")).toHaveValue(SEKSJONER[id].title.nb);
}

/** Seksjon B slik den skal stå når ingenting har skrevet i den: alle tre språk, og «Alt lagret». */
async function forventUroertB(page: Page) {
  await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
  await expect(page.locator("#markdownInput")).toHaveValue(SEKSJONER["sec-b"].body.nb);
  for (const [pille, sprak] of [["nn", "nn"], ["en-GB", "en-GB"]] as const) {
    await page.locator(`[data-form-locale="${pille}"]`).click();
    await expect(page.locator("#titleInput")).toHaveValue(SEKSJONER["sec-b"].title[sprak]);
    await expect(page.locator("#markdownInput")).toHaveValue(SEKSJONER["sec-b"].body[sprak]);
  }
  await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
}

test.describe("#1154 — en jobb skriver bare i visningen den startet i", () => {
  test("«Oversett» startet i A skriver ikke i B når forfatteren har byttet seksjon før svaret kom", async ({ page }) => {
    await mockSeksjoner(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections/localize", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "OVERSATT fra A", bodyMarkdown: "OVERSATT tekst fra A" }) });
    });
    let bilder = 0;
    await page.route("**/api/admin/content/sections/*/assets/localize", (route: Route) => {
      bilder += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ localizedAssetCount: 0 }) });
    });

    await page.goto("/admin-content/sections");
    await aapne(page, "sec-a");
    await page.locator("#translateBtn").click();
    await expect.poll(() => svar.kall).toBe(1);
    // «← Tilbake» er låst mens oversettingen går; nettleserens tilbake-knapp er det ikke.
    await page.goBack();
    await aapne(page, "sec-b");

    svar.slipp();
    // Gi svaret (og et eventuelt neste kall) tid til å lande før tilstanden leses.
    await page.waitForTimeout(800);
    await forventUroertB(page);
    // Den stoppet der: ikke et kall til for neste språk, og ikke bildene (som lagres på tjeneren).
    expect(svar.kall).toBe(1);
    expect(bilder).toBe(0);
  });

  test("«Oversett» som holder på med BILDENE når forfatteren bytter seksjon, rører ikke feltene i B", async ({ page }) => {
    await mockSeksjoner(page);
    await page.route("**/api/admin/content/sections/localize", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "OVERSATT fra A", bodyMarkdown: "OVERSATT tekst fra A" }) }),
    );
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections/*/assets/localize", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ localizedAssetCount: 0 }) });
    });
    await page.goto("/admin-content/sections");
    await aapne(page, "sec-a");
    await page.locator("#translateBtn").click();
    await expect.poll(() => svar.kall).toBe(1);
    await page.goBack();
    await aapne(page, "sec-b");

    svar.slipp();
    await page.waitForTimeout(800);
    await forventUroertB(page);
  });

  test("kontroll: «Oversett» i seksjonen man står i, skriver som før og merker den ulagret", async ({ page }) => {
    await mockSeksjoner(page);
    await page.route("**/api/admin/content/sections/localize", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "OVERSATT fra A", bodyMarkdown: "OVERSATT tekst fra A" }) }),
    );
    await page.route("**/api/admin/content/sections/*/assets/localize", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ localizedAssetCount: 0 }) }),
    );
    await page.goto("/admin-content/sections");
    await aapne(page, "sec-a");
    await page.locator("#translateBtn").click();
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    await page.locator('[data-form-locale="nn"]').click();
    await expect(page.locator("#titleInput")).toHaveValue("OVERSATT fra A");
    await expect(page.locator("#markdownInput")).toHaveValue("OVERSATT tekst fra A");
  });

  test("et bilde lastet opp i A settes ikke inn i teksten til B", async ({ page }) => {
    await mockSeksjoner(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections/sec-a/assets", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ asset: { id: "asset-1", ref: "asset:asset-1" } }) });
    });
    // Alt-teksten spørres det om i en dialog; «forlat siden»-spørsmål finnes ikke her (ingenting er skrevet).
    page.on("dialog", (dialog) => void dialog.accept("Et bilde"));

    await page.goto("/admin-content/sections");
    await aapne(page, "sec-a");
    await page.locator("#imageFileInput").setInputFiles({ name: "bilde.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    await expect.poll(() => svar.kall).toBe(1);
    await page.goBack();
    await aapne(page, "sec-b");

    svar.slipp();
    await page.waitForTimeout(800);
    await forventUroertB(page);
  });

  test("første lagring av en ny seksjon tegner ikke skjemaet over lista når forfatteren har gått tilbake", async ({ page }) => {
    await mockSeksjoner(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections", async (route: Route) => {
      if (route.request().method() !== "POST") return route.fallback();
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-ny", activeVersionId: "v1", archivedAt: null, hasUnpublishedChanges: false } }) });
    });
    // Lagringen er ikke ferdig, så skjemaet er fortsatt ulagret: tilbake-knappen spør (#1155), og forfatteren svarer OK.
    page.on("dialog", (dialog) => void dialog.accept());
    // Fra lista, så nettleserens tilbake-knapp har noe å gå tilbake til.
    await page.goto("/admin-content/sections");
    await page.locator("#newSectionBtn").click();
    await page.locator("#titleInput").fill("Ny seksjon");
    await page.locator("#markdownInput").fill("Ny tekst");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => svar.kall).toBe(1);
    await page.goBack();
    // Forutsetningen for målingen: forfatteren står i lista FØR svaret kommer.
    await expect(page.locator("#sectionsTableBody")).toContainText("Tittel A bokmål");
    await expect(page.locator("#titleInput")).toHaveCount(0);

    svar.slipp();
    await page.waitForTimeout(800);
    await expect(page.locator("#sectionsTableBody")).toContainText("Tittel A bokmål");
    await expect(page.locator("#titleInput")).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("");
  });

  test("en lagring i A som blir ferdig mens forfatteren skriver i B, merker ikke B som «Alt lagret»", async ({ page }) => {
    await mockSeksjoner(page);
    await page.route("**/api/admin/content/sections/sec-a/title", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-a" } }) }),
    );
    const svar = tilbakeholdt();
    const lagret: string[] = [];
    await page.route("**/api/admin/content/sections/sec-a/content", async (route: Route) => {
      svar.kall += 1;
      lagret.push(route.request().postData() ?? "");
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-a", activeVersionId: "v2", archivedAt: null, hasUnpublishedChanges: false } }) });
    });
    // Forfatteren forlater A mens lagringen går. Skjemaet er fortsatt ulagret, så tilbake-knappen spør (#1155): OK.
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/admin-content/sections");
    await aapne(page, "sec-a");
    await page.locator("#markdownInput").fill("Ny tekst i A");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => svar.kall).toBe(1);
    await page.goBack();
    await aapne(page, "sec-b");
    await page.locator("#titleInput").fill("Ulagret navn i B");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");

    svar.slipp();
    await page.waitForTimeout(800);
    // Lagringen av A ble sendt hel. B er fortsatt ulagret, med teksten sin.
    expect(lagret.join("")).toContain("Ny tekst i A");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    await expect(page.locator("#titleInput")).toHaveValue("Ulagret navn i B");
    await expect(page.locator("#formSaveBtn")).toBeEnabled();
  });

  test("en seksjon som laster ferdig etter at forfatteren har åpnet en annen, legger ikke innholdet sitt i den", async ({ page }) => {
    await mockSeksjoner(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections/sec-a", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ section: { id: "sec-a", title: JSON.stringify(SEKSJONER["sec-a"].title), bodyMarkdown: JSON.stringify(SEKSJONER["sec-a"].body), activeVersionId: "v1", archivedAt: null, hasUnpublishedChanges: false, assets: [] } }),
      });
    });
    await page.goto("/admin-content/sections");
    await page.locator('[data-action="edit"][data-id="sec-a"]').click();
    await expect.poll(() => svar.kall).toBe(1);
    await page.goBack();
    await aapne(page, "sec-b");
    // Forfatteren har begynt å skrive i B. Svaret for A skal verken tegne B på nytt eller merke den «Alt lagret».
    await page.locator("#titleInput").fill("Ulagret navn i B");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");

    svar.slipp();
    await page.waitForTimeout(800);
    await expect(page.locator("#titleInput")).toHaveValue("Ulagret navn i B");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    await expect(page.locator("#markdownInput")).toHaveValue(SEKSJONER["sec-b"].body.nb);
    await page.locator('[data-form-locale="nn"]').click();
    await expect(page.locator("#markdownInput")).toHaveValue(SEKSJONER["sec-b"].body.nn);
    expect(new URL(page.url()).search).toBe("?id=sec-b");
  });

  test("«Oversett» som blir ferdig etter at seksjonen er hentet på nytt av «Erstatt fra fil», merker den ikke ulagret", async ({ page }) => {
    await mockSeksjoner(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections/localize", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "OVERSATT fra A", bodyMarkdown: "OVERSATT tekst fra A" }) });
    });
    await page.route("**/api/admin/content/sections/*/assets/localize", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ localizedAssetCount: 0 }) }),
    );
    let hentinger = 0;
    await page.route("**/api/admin/content/sections/sec-a", (route: Route) => {
      hentinger += 1;
      return route.fallback();
    });
    await page.route("**/api/admin/content/sections/import", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-a" } }) }),
    );
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/admin-content/sections");
    await aapne(page, "sec-a");
    await page.locator("#translateBtn").click();
    await expect.poll(() => svar.kall).toBe(1);
    // «Erstatt fra fil» er ikke låst mens oversettingen går. Den henter seksjonen på nytt: en ny visning av samme seksjon.
    await page.locator("#replaceFromFileInput").setInputFiles({ name: "seksjon.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "a2-content-export/v1", scope: "section" })) });
    await expect.poll(() => hentinger).toBe(2);
    await expect(page.locator("#titleInput")).toHaveValue(SEKSJONER["sec-a"].title.nb);
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");

    svar.slipp();
    await page.waitForTimeout(800);
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
    await page.locator('[data-form-locale="nn"]').click();
    await expect(page.locator("#titleInput")).toHaveValue(SEKSJONER["sec-a"].title.nn);
  });

  test("«Avpubliser» i A som blir ferdig etter at forfatteren har åpnet B, endrer ikke statusen i B", async ({ page }) => {
    await mockSeksjoner(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections/sec-a/unpublish", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-a", activeVersionId: null, archivedAt: null, hasUnpublishedChanges: false } }) });
    });
    await page.goto("/admin-content/sections");
    await aapne(page, "sec-a");
    await page.locator("#sectionLifecycleBtn").click();
    await expect.poll(() => svar.kall).toBe(1);
    await page.goBack();
    await aapne(page, "sec-b");
    await expect(page.locator("#sectionLifecycleBtn")).toHaveText("Avpubliser");

    svar.slipp();
    await page.waitForTimeout(800);
    // B er fortsatt publisert: knappen tilbyr å avpublisere, ikke å publisere.
    await expect(page.locator("#sectionLifecycleBtn")).toHaveText("Avpubliser");
    await expect(page.locator("#moduleFormHead, .form-page-state").locator(".status-badge--published")).toHaveCount(1);
  });

  test("en seksjon som FEILER under lasting etter at forfatteren har åpnet en annen, viser ikke feilen over den", async ({ page }) => {
    await mockSeksjoner(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections/sec-a", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error" }) });
    });
    await page.goto("/admin-content/sections");
    await page.locator('[data-action="edit"][data-id="sec-a"]').click();
    await expect.poll(() => svar.kall).toBe(1);
    await page.goBack();
    await aapne(page, "sec-b");

    svar.slipp();
    await page.waitForTimeout(800);
    await expect(page.locator("#titleInput")).toHaveValue(SEKSJONER["sec-b"].title.nb);
    await expect(page.locator(".empty-state")).toHaveCount(0);
  });

  test("«Arkiver» i A som blir ferdig etter at forfatteren har åpnet B, gjør ikke B arkivert", async ({ page }) => {
    await mockSeksjoner(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections/sec-a/archive", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-a", activeVersionId: null, archivedAt: "2026-11-13T10:00:00.000Z", hasUnpublishedChanges: false } }) });
    });
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/admin-content/sections");
    await aapne(page, "sec-a");
    const arkiver = page.locator('.form-page-actions [data-editor-action="archive"]');
    if (!(await arkiver.isVisible())) await page.locator(".form-page-actions details.row-more > summary").click();
    await arkiver.click();
    await expect.poll(() => svar.kall).toBe(1);
    await page.goBack();
    await aapne(page, "sec-b");

    svar.slipp();
    await page.waitForTimeout(800);
    await expect(page.locator(".form-page-state .status-badge--archived")).toHaveCount(0);
    await expect(page.locator("#sectionLifecycleBtn")).toHaveText("Avpubliser");
  });

  test("«Erstatt fra fil» i A som blir ferdig etter at forfatteren har gått til lista, tegner ikke A over lista", async ({ page }) => {
    await mockSeksjoner(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections/import", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-a" } }) });
    });
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/admin-content/sections");
    await aapne(page, "sec-a");
    await page.locator("#replaceFromFileInput").setInputFiles({ name: "seksjon.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "a2-content-export/v1", scope: "section" })) });
    await expect.poll(() => svar.kall).toBe(1);
    await page.goBack();
    await expect(page.locator("#sectionsTableBody")).toContainText("Tittel A bokmål");
    await expect(page.locator("#titleInput")).toHaveCount(0);

    svar.slipp();
    await page.waitForTimeout(800);
    await expect(page.locator("#sectionsTableBody")).toContainText("Tittel A bokmål");
    await expect(page.locator("#titleInput")).toHaveCount(0);
  });

  test("en jobb startet i lista tegner ikke lista over et skjema som er åpnet i mellomtiden", async ({ page }) => {
    await mockSeksjoner(page);
    const svar = tilbakeholdt();
    await page.route("**/api/admin/content/sections/sec-a/unpublish", async (route: Route) => {
      svar.kall += 1;
      await svar.port;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-a", activeVersionId: null, archivedAt: null, hasUnpublishedChanges: false } }) });
    });
    await page.goto("/admin-content/sections");
    await expect(page.locator("#sectionsTableBody")).toContainText("Tittel A bokmål");
    await (await revealRowAction(page, page.locator('[data-action="unpublish"][data-id="sec-a"]'))).click();
    await expect.poll(() => svar.kall).toBe(1);
    await aapne(page, "sec-b");
    await page.locator("#titleInput").fill("Ulagret navn");

    svar.slipp();
    await page.waitForTimeout(800);
    await expect(page.locator("#titleInput")).toHaveValue("Ulagret navn");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
  });
});
