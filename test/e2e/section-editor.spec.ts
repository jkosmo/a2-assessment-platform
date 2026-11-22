import { test, expect, type Page, type Route } from "@playwright/test";
import { revealRowAction } from "./admin-content-helpers.js";

// Browser e2e for the section editor (U1/U2, #483/#524). Runs the REAL front-end JS in Chromium
// against mocked APIs — covering the client-layer bugs supertest/integration tests can't see:
//  - raw i18n/label keys leaking into the UI (t()/L() returning the key)
//  - the image-upload request being sent with the wrong Content-Type (FormData must be multipart,
//    not application/json — the 500 we hit in manual testing)
//  - markdown live-preview wiring

async function mockBaseApis(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: {
          contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] },
        },
        calibrationWorkspace: { accessRoles: [] },
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
      // The consent guard (#540) reads consent.accepted; without it init throws.
      body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }),
    }),
  );
}

test("section editor: no raw i18n keys, and image upload is sent as multipart", async ({ page }) => {
  await mockBaseApis(page);

  await page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ section: { id: "sec1", versionNo: 1 } }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) });
  });
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>preview-ok</p>" }) }),
  );

  let uploadContentType: string | null = null;
  await page.route("**/api/admin/content/sections/sec1/assets", (route: Route) => {
    uploadContentType = route.request().headers()["content-type"] ?? null;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ asset: { id: "a1", ref: "asset:a1", sectionId: "sec1", filename: "x.png", mimeType: "image/png", sizeBytes: 10 } }) });
  });

  // Force a deterministic locale (the test browser would otherwise default to en-GB).
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
  await page.goto("/admin-content/sections");

  // List heading must be a real label, not the raw key "heading".
  await expect(page.locator("h1")).toContainText("Seksjon");

  await page.getByRole("button", { name: /Ny seksjon/ }).click();

  // Editor controls show real labels, never the raw L() keys.
  const bodyText = await page.locator("#main-content").innerText();
  for (const rawKey of ["uploadImage", "saveFirst", "titleLabel", "courses.section"]) {
    expect(bodyText).not.toContain(rawKey);
  }

  await page.locator("#titleInput").fill("Tittel");
  await page.locator("#markdownInput").fill("# Hei");
  // Save so the section gets an id (upload requires a saved section).
  await page.getByRole("button", { name: /^Lagre$/ }).click();

  // The alt-text prompt — accept it.
  page.on("dialog", (dialog) => dialog.accept("alt-tekst"));

  await page.getByRole("button", { name: /Last opp bilde/ }).click();
  await page.locator("#imageFileInput").setInputFiles({ name: "x.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });

  await expect.poll(() => uploadContentType).not.toBeNull();
  expect(uploadContentType).toContain("multipart/form-data");
  expect(uploadContentType).not.toContain("application/json");

  // The asset reference is inserted into the markdown.
  await expect(page.locator("#markdownInput")).toHaveValue(/asset:a1/);
});

// #524 (regression guard for the #705 `tNav` bug): the sections LIST must render its rows without a
// client-side error. That bug threw ReferenceError only when a row rendered (`statusBadge` referenced
// an undefined `t`), so an EMPTY-list mock hid it and the tab stuck on «Laster…». Load a NON-empty
// list so the badge is actually invoked, and fail on any uncaught page error.
test("section list renders rows (status badge) without a client-side error", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await mockBaseApis(page);
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sections: [
          {
            id: "sec-1",
            title: JSON.stringify({ nb: "Testseksjon", "en-GB": "Test section", nn: "Testseksjon" }),
            activeVersionId: "v1",
            archivedAt: null,
            versionNo: 1,
            courseCount: 0,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  await page.goto("/admin-content/sections");

  // The row rendered — the tab is NOT stuck on «Laster…».
  await expect(page.getByText("Testseksjon")).toBeVisible();
  await expect(page.locator("#main-content")).not.toContainText("Laster");
  // The shared 3-state status badge rendered (published → «Publisert» in nb).
  await expect(page.locator(".status-badge").first()).toHaveText("Publisert");
  // No uncaught client-side error (guards the tNav/t ReferenceError class).
  expect(pageErrors).toEqual([]);
});

// #662: the markdown input must grow to match the (taller) preview pane instead of staying pinned
// at its 320px minimum, so the author isn't editing in a small box beside a tall preview.
test("section editor: full-width editor in Rediger, preview in its own tab", async ({ page }) => {
  await mockBaseApis(page);
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) }),
  );
  // A deliberately tall preview (well over the 320px min-height).
  const tallHtml = "<p>Preview line that takes vertical space.</p>".repeat(60);
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: tallHtml }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });

  await page.goto("/admin-content/sections");
  await page.getByRole("button", { name: /Ny seksjon/ }).click();
  await page.locator("#markdownInput").fill("# Hei\n\nNoe innhold.");

  // #1046 nivå to (13.09): editoren står alene i full bredde i Rediger; forhåndsvisningen er en egen
  // fane som tegnes når den åpnes. Editoren skal være romslig (ikke 320 px), og forhåndsvisningen
  // skal vise det man skrev.
  const ta = await page.locator("#markdownInput").boundingBox();
  expect(ta && ta.height > 320).toBe(true);
  await page.locator('[data-form-tab-btn="forhandsvisning"]').click();
  await expect(page.locator("#previewPane")).toBeVisible();
  await expect(page.locator("#previewPane")).toContainText("Preview line", { timeout: 5000 });
  await expect(page.locator("#markdownInput")).toBeHidden();
});

// #540: the section editor must show the blocking consent dialog when consent is not yet
// accepted — not dump the raw "403 consent_required" JSON into the content area.
test("section editor: shows consent dialog (not raw 403) when consent not accepted", async ({ page }) => {
  await mockBaseApis(page);
  // Override /api/me to report consent NOT accepted.
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: false, currentVersion: "1.0" } }),
    }),
  );
  // The consent text endpoint (GET) the guard fetches to render the modal.
  await page.route("**/api/me/consent", (route: Route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: "1.0", body: "Personvern", platformName: "A2" }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) }),
  );

  await page.goto("/admin-content/sections");

  // The blocking consent modal must appear …
  await expect(page.locator("#consent-modal-overlay")).toBeVisible();
  // … and the raw error must NOT be shown anywhere.
  await expect(page.locator("#main-content")).not.toContainText("consent_required");
});

// #542: in mock mode the participant console must send the x-user-* identity headers when
// loading courses. The bug passed the header OBJECT to apiFetch (which expects a function),
// so apiFetch silently dropped the headers → backend fell back to a roleless default user → 403.
// On Entra the Bearer token hid this; only mock mode (local) exposes it.
test("participant: course load sends x-user-* identity headers in mock mode", async ({ page }) => {
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

  let coursesUserId: string | undefined;
  let coursesRoles: string | undefined;
  await page.route("**/api/courses", (route: Route) => {
    const h = route.request().headers();
    coursesUserId = h["x-user-id"];
    coursesRoles = h["x-user-roles"];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] }),
    });
  });
  await page.route("**/api/courses/completions", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }),
  );

  await page.goto("/participant");

  await expect.poll(() => coursesUserId).toBe("participant-1");
  expect(coursesRoles).toContain("PARTICIPANT");
});

// #690 regression: the Sections page top workspace nav was empty in prod because role filtering used
// identityDefaults (undefined in prod) → roles "" hid every role-gated nav item. The fix reads live
// roles from /api/me. Guards the prod shape: no identityDefaults, role-gated nav item, role via /api/me.
test("section editor: top workspace nav renders in prod-shaped config (roles from /api/me)", async ({ page }) => {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: {
          items: [
            { id: "dashboard", path: "/dashboard", labelKey: "Oversikt", requiredRoles: [] },
            { id: "review", path: "/review", labelKey: "Vurdering", requiredRoles: ["SUBJECT_MATTER_OWNER"] },
          ],
          workspaceItems: [],
        },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }),
  );
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.route("**/api/admin/content/sections**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) }),
  );
  await page.goto("/admin-content/sections");
  await expect(page.locator("#workspaceNav")).toBeVisible();
  await expect(page.locator('#workspaceNav a', { hasText: "Oversikt" })).toBeVisible();
  await expect(page.locator('#workspaceNav a', { hasText: "Vurdering" })).toBeVisible();
});

// #524 (U1): the editor is LOCKED while the LLM translates the active language into the others — the author must not
// edit/navigate mid-call — and the other locales' fields are filled. #1163 skive 2: the translation happens on «Lagre»
// (no «Oversett» button), behind the work dialog (work-dialog.js makes the page inert), and what is saved carries it.
test("section editor: «Lagre» locks the page while translating, then saves and fills the other locales", async ({ page }) => {
  await mockBaseApis(page);
  const created: Array<Record<string, unknown>> = [];
  await page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() === "POST") {
      created.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ section: { id: "sec1", versionNo: 1 } }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) });
  });
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>x</p>" }) }),
  );

  // Hold the localize response so the intermediate LOCKED state is observable.
  let releaseLocalize: () => void = () => {};
  const localizeHold = new Promise<void>((resolve) => { releaseLocalize = resolve; });
  const requestedTargets: string[] = [];
  await page.route("**/api/admin/content/sections/localize", async (route: Route) => {
    const body = route.request().postDataJSON() as { targetLocale: string };
    requestedTargets.push(body.targetLocale);
    await localizeHold;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ title: `T-${body.targetLocale}`, bodyMarkdown: `B-${body.targetLocale}` }),
    });
  });

  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content/sections");
  await page.getByRole("button", { name: /Ny seksjon/ }).click();

  // Fill the source (nb) language, then save.
  await page.locator("#titleInput").fill("Tittel");
  await page.locator("#markdownInput").fill("# Innhold");
  await expect(page.locator("#translateBtn")).toHaveCount(0);
  await page.locator("#formSaveBtn").click();

  // LOCKED: the work dialog says what is happening, and nothing is saved before the translation is back.
  await expect(page.locator(".work-dialog")).toBeVisible();
  await expect(page.locator(".work-dialog")).toContainText("Lagrer og oversetter");
  await expect(page.locator("#formSaveBtn")).toBeDisabled();
  expect(created).toEqual([]);

  // Release the translation → saved with the translations, and unlocked.
  releaseLocalize();
  await expect(page.locator(".work-dialog")).toHaveCount(0);
  await expect.poll(() => created.length).toBe(1);
  expect(created[0]).toMatchObject({ title: { nb: "Tittel", nn: "T-nn", "en-GB": "T-en-GB" }, bodyMarkdown: { nb: "# Innhold", nn: "B-nn", "en-GB": "B-en-GB" }, draft: true });

  // Both other locales were requested, and the nn tab now holds the translated title.
  await expect.poll(() => [...requestedTargets].sort()).toEqual(["en-GB", "nn"]);
  await page.locator('[data-form-locale="nn"]').click();
  await expect(page.locator("#titleInput")).toHaveValue("T-nn");
});

// #1046 D3 (avgjort 12.09): «Slett» er ute av seksjonslista og bor inne på den ARKIVERTE seksjonen.
// To steg som for modul, kurs og klasse: arkiver først, slett så. En aktiv seksjon har ingen
// slett-knapp, verken i lista eller i editoren.
test.describe("#1046 D3 — sletting av seksjon bor i editoren, bare for arkiverte", () => {
  const rad = (archivedAt: string | null) => ({
    id: "sec-del", title: JSON.stringify({ nb: "Slettbar", nn: "Slettbar", "en-GB": "Deletable" }), bodyMarkdown: JSON.stringify({ nb: "x", nn: "x", "en-GB": "x" }),
    activeVersionId: null, versionNo: 1, updatedAt: "2026-09-01T00:00:00.000Z", archivedAt, courseCount: 0, courses: [], canManage: true,
  });

  async function mockSection(page: Page, archivedAt: string | null) {
    await mockBaseApis(page);
    await page.route("**/api/admin/content/sections", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [rad(archivedAt)] }) }));
    await page.route("**/api/admin/content-owners/SECTION/sec-del", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners: [], canManageOwners: false }) }));
    let deleted = false;
    await page.route("**/api/admin/content/sections/sec-del", (route: Route) => {
      if (route.request().method() === "DELETE") { deleted = true; return route.fulfill({ status: 204, body: "" }); }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: rad(archivedAt) }) });
    });
    return () => deleted;
  }

  test("lista har ingen Slett; den arkiverte seksjonen har det i editoren, med bekreftelse", async ({ page }) => {
    const bleSlettet = await mockSection(page, "2026-09-02T00:00:00.000Z");
    await page.goto("/admin-content/sections");
    // Lista åpner på «Aktive»; den arkiverte raden ligger under «Arkiverte».
    await page.locator('.list-filter-btn[data-filter="archived"]').click();
    await expect(page.locator("#sectionsTableBody tr")).toHaveCount(1);
    await expect(page.locator('#sectionsTableBody [data-action="delete"]')).toHaveCount(0);

    await page.locator('[data-action="edit"][data-id="sec-del"]').click();
    // #1046 nivå to: Slett ligger i handlingsraden i hodet — under «Mer» når det er flere enn fire.
    const slett = await revealRowAction(page, page.locator("#sectionDeleteBtn"));
    await expect(slett).toBeVisible();

    // #1168: sidas dialog, ikke nettleserens spørreboks. Avbryt i bekreftelsen → ingenting sendes.
    const browserQuestions: string[] = [];
    page.on("dialog", (d) => { browserQuestions.push(d.message()); void d.dismiss(); });
    await slett.click();
    await expect(page.locator("#moduleLifecycleDialog")).toHaveAttribute("data-module-dialog", "delete");
    // Denne fila kjører på engelsk (standard i e2e).
    await expect(page.locator("#moduleLifecycleDialogTitle")).toHaveText("Delete «Deletable»");
    await expect(page.locator("#moduleLifecycleDialogText")).toHaveText("The section is deleted for good. This cannot be undone.");
    await page.locator("#moduleLifecycleDialogCancelBtn").click();
    expect(bleSlettet()).toBe(false);

    // Bekreft → DELETE går, og forfatteren står i lista igjen.
    await (await revealRowAction(page, page.locator("#sectionDeleteBtn"))).click();
    await expect(page.locator("#moduleLifecycleDialogConfirmBtn")).toHaveText("Delete the section");
    await page.locator("#moduleLifecycleDialogConfirmBtn").click();
    await expect.poll(bleSlettet).toBe(true);
    expect(browserQuestions).toEqual([]);
    await expect(page.locator("#sectionsTableBody")).toBeAttached();
  });

  test("en aktiv seksjon har ingen slett-knapp i editoren", async ({ page }) => {
    await mockSection(page, null);
    await page.goto("/admin-content/sections?id=sec-del");
    await expect(page.locator("#titleInput")).toBeVisible();
    await expect(page.locator("#sectionDeleteBtn")).toBeHidden();
  });
});
