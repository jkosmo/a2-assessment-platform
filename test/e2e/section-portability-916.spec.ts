import { test, expect, type Page, type Route } from "@playwright/test";

// #916 — standalone section export/import + the publish gate's author-facing wording, exercised in a
// real browser against mocked APIs.
//
// These behaviours live in the client layer, which supertest cannot see: whether the row action
// calls the right endpoint at all, whether the export button is hidden where the ownership guard
// would 403, and — the one most likely to regress — whether the gate's `field` + `missingLocales`
// become a sentence the author can act on rather than a raw "422: {…}" or a leaked English server
// message. The server's `message` is English; this page runs in three languages.

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
      body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }),
    }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

const SECTION_ROW = {
  id: "sec-916",
  title: JSON.stringify({ nb: "Portabel seksjon", "en-GB": "Portable section", nn: "Portabel seksjon" }),
  activeVersionId: "v1",
  archivedAt: null,
  versionNo: 1,
  courseCount: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
  canManage: true,
};

function mockSectionList(page: Page, sections: unknown[]) {
  return page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections }) });
  });
}

// The whole toast region, not `[role=alert]`: showToast marks errors/warnings as `alert` but
// successes as `status`, and these tests assert on both kinds.
const toastOf = (page: Page) => page.locator("#toastRegion");

test("«Eksporter» calls the export-package endpoint for that row", async ({ page }) => {
  await mockBaseApis(page);
  await mockSectionList(page, [SECTION_ROW]);

  let exportedPath: string | null = null;
  await page.route("**/api/admin/content/sections/sec-916/export-package", (route: Route) => {
    exportedPath = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        envelope: {
          exportFormat: "a2-content-export/v1",
          exportedAt: "2026-08-18T00:00:00.000Z",
          scope: "section",
          section: { title: { nb: "Portabel seksjon" }, bodyMarkdown: { nb: "# Hei" }, audit: {} },
        },
      }),
    });
  });

  await page.goto("/admin-content/sections");
  await page.getByRole("button", { name: /^Eksporter$/ }).click();

  await expect.poll(() => exportedPath).toBe("/api/admin/content/sections/sec-916/export-package");
  await expect(toastOf(page)).toContainText(/eksportert/i);
});

test("«Eksporter» is hidden on a row the viewer may not manage", async ({ page }) => {
  // The route enforces ownership regardless; hiding the button is so the author is not offered an
  // action that can only 403 (the #787 slice-5 rule, applied to the new action).
  await mockBaseApis(page);
  await mockSectionList(page, [{ ...SECTION_ROW, canManage: false }]);

  await page.goto("/admin-content/sections");

  await expect(page.getByText("Portabel seksjon")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Eksporter$/ })).toHaveCount(0);
  await expect(page.locator(".row-readonly-note")).toBeVisible();
});

test("importing a package posts the envelope and opens the new draft", async ({ page }) => {
  await mockBaseApis(page);
  await mockSectionList(page, []);

  type ImportBody = { payload?: { scope?: string }; mode?: string };
  let importBody: ImportBody | null = null;
  await page.route("**/api/admin/content/sections/import", (route: Route) => {
    importBody = route.request().postDataJSON() as ImportBody;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sectionId: "sec-new",
        sectionVersionId: "v1",
        assetCount: 0,
        published: false,
        links: { editor: "/admin-content/sections?id=sec-new" },
      }),
    });
  });
  await page.route("**/api/admin/content/sections/sec-new", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        section: {
          id: "sec-new",
          title: JSON.stringify({ nb: "Importert" }),
          bodyMarkdown: JSON.stringify({ nb: "# Importert" }),
          activeVersionId: null,
          versionNo: 1,
          archivedAt: null,
          hasUnpublishedChanges: false,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    }),
  );
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>x</p>" }) }),
  );
  await page.route("**/api/admin/content-owners/**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ owners: [] }) }),
  );

  await page.goto("/admin-content/sections");

  await page.locator("#importSectionFile").setInputFiles({
    name: "section.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        exportFormat: "a2-content-export/v1",
        exportedAt: "2026-08-18T00:00:00.000Z",
        scope: "section",
        section: { title: { nb: "Importert" }, bodyMarkdown: { nb: "# Importert" }, audit: {} },
      }),
      "utf8",
    ),
  });

  // Read through a getter: TypeScript's control-flow analysis cannot see the route callback's
  // assignment and would narrow the captured variable to `null` after the poll.
  const captured = () => importBody as ImportBody | null;
  await expect.poll(() => captured()?.payload?.scope).toBe("section");
  expect(captured()?.mode).toBe("createNew");
  // The author is told it landed as a draft — the server rule, said out loud.
  await expect(toastOf(page)).toContainText(/utkast/i);
  await expect(page).toHaveURL(/id=sec-new/);
});

test("a module package is refused with an actionable message, never sent as a scope_mismatch", async ({ page }) => {
  await mockBaseApis(page);
  await mockSectionList(page, []);

  let importCalled = false;
  await page.route("**/api/admin/content/sections/import", (route: Route) => {
    importCalled = true;
    return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "scope_mismatch" }) });
  });

  await page.goto("/admin-content/sections");

  await page.locator("#importSectionFile").setInputFiles({
    name: "module.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ exportFormat: "a2-content-export/v1", scope: "module", module: {} }), "utf8"),
  });

  await expect(toastOf(page)).toContainText(/Moduler-siden/);
  expect(importCalled).toBe(false);
});

test("publish gate: the block names field and language instead of leaking the server message", async ({ page }) => {
  await mockBaseApis(page);
  await mockSectionList(page, [{ ...SECTION_ROW, activeVersionId: null }]);

  await page.route("**/api/admin/content/sections/sec-916/publish", (route: Route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: "publish_blocked_by_validation",
        message: "Pre-publish validation found blocking issues. See `issues` for details.",
        issues: [
          {
            severity: "blocking",
            code: "translation_incomplete",
            message: "bodyMarkdown: missing nn",
            field: "bodyMarkdown",
            missingLocales: ["nn"],
          },
        ],
      }),
    }),
  );

  await page.goto("/admin-content/sections");
  await page.getByRole("button", { name: /^Publiser$/ }).click();

  const toast = toastOf(page);
  await expect(toast).toContainText("Kan ikke publisere");
  await expect(toast).toContainText("innholdet");
  await expect(toast).not.toContainText("Pre-publish validation");
  await expect(toast).not.toContainText("bodyMarkdown");
});

test("held-back save: the author is told it was saved but not published, and how to fix it", async ({ page }) => {
  await mockBaseApis(page);
  await page.route("**/api/admin/content/sections", (route: Route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          section: {
            id: "sec1",
            versionNo: 1,
            activeVersionId: null,
            archivedAt: null,
            bodyMarkdown: null,
            hasUnpublishedChanges: false,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          translationGate: {
            heldBack: true,
            issues: [
              {
                severity: "blocking",
                code: "translation_incomplete",
                message: "title: missing en-GB, nn",
                field: "title",
                missingLocales: ["en-GB", "nn"],
              },
            ],
          },
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) });
  });
  await page.route("**/api/admin/content/sections/preview", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: "<p>x</p>" }) }),
  );

  await page.goto("/admin-content/sections");
  await page.getByRole("button", { name: /Ny seksjon/ }).click();
  await page.locator("#titleInput").fill("Bare norsk");
  await page.locator("#markdownInput").fill("# Bare norsk");
  await page.getByRole("button", { name: /Lagre ny versjon/ }).click();

  const toast = toastOf(page);
  // A plain "Seksjon lagret." here is the confusion this exists to prevent: the author would
  // believe participants can read text that is not live.
  await expect(toast).toContainText("Lagret, men ikke publisert");
  await expect(toast).toContainText("tittelen");
  await expect(toast).toContainText("Oversett fra dette språket");
});

// ————————————————————————————————————————————————————————————————————————————————————————————
// #937 — klienthalvdelen. Produkteier løftet ett kurselement ut av en kurspakke og fikk rå
// Zod-utdata. To ting endret seg i klienten, og ingen av dem var dekket:
//   1. vakten kortsluttet på fil UTEN `scope`, så den slapp forbi uten å bli stoppet lokalt
//   2. toasten viste `"400: {…}"` i stedet for en setning
// ————————————————————————————————————————————————————————————————————————————————————————————

test("#937: en fil uten scope stoppes IKKE lokalt — den skal nå serveren, som kan pakke den inn", async ({ page }) => {
  await mockBaseApis(page);
  await mockSectionList(page, []);

  let importCalled = false;
  await page.route("**/api/admin/content/sections/import", (route: Route) => {
    importCalled = true;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sectionId: "sec-new", published: false }) });
  });

  await page.goto("/admin-content/sections");

  // Kurselementet produkteier faktisk hadde: ingen `scope`, ingen `exportFormat`.
  await page.locator("#importSectionFile").setInputFiles({
    name: "loftet-element.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ type: "SECTION", sortOrder: 18, section: { title: { nb: "Løftet" }, bodyMarkdown: { nb: "# Løftet" } } }),
      "utf8",
    ),
  });

  // ⚠️ Kjernen: vakten sto som `payload?.scope && payload.scope !== "section"` og kortsluttet på
  // manglende `scope`. Det var riktig oppførsel ved et uhell — men uten denne testen ville en
  // «opprydding» til `payload?.scope !== "section"` blokkert nøyaktig fila #937 handler om,
  // lokalt, uten at noen backend-test merket det.
  await expect.poll(() => importCalled).toBe(true);
});

test("#937: en fil som ikke er en seksjon gir en setning i toasten — ikke «400: {…}»", async ({ page }) => {
  await mockBaseApis(page);
  await mockSectionList(page, []);

  await page.route("**/api/admin/content/sections/import", (route: Route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "not_an_export_envelope",
        message: "This does not look like a section package. Use Export on a section to produce a valid file.",
      }),
    }),
  );

  await page.goto("/admin-content/sections");
  await page.locator("#importSectionFile").setInputFiles({
    name: "package.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ name: "a2-assessment-platform", version: "2.24.0" }), "utf8"),
  });

  const toast = toastOf(page);
  // Teksten kommer fra klientens egen LABELS-tabell, slått opp på feilKODEN. Serverens setning er
  // engelsk; konsollet her står på nb. Viser toasten norsk, leser den koden — ikke `message`.
  await expect(toast).toContainText(/seksjonspakke/i);
  await expect(toast).not.toContainText(/400:/);
  await expect(toast).not.toContainText(/exportFormat.*invalid_literal/);
});

test("#937 kontroll: Zod-dumpen havner i detaljfeltet, ikke i overskriften", async ({ page }) => {
  await mockBaseApis(page);
  await mockSectionList(page, []);

  await page.route("**/api/admin/content/sections/import", (route: Route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "validation_error",
        issues: [{ code: "invalid_type", expected: "string", path: ["payload", "section", "bodyMarkdown"] }],
      }),
    }),
  );

  await page.goto("/admin-content/sections");
  await page.locator("#importSectionFile").setInputFiles({
    name: "halv.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ title: { nb: "T" }, bodyMarkdown: 42 }), "utf8"),
  });

  // Overskriften er lesbar prosa. Detaljene finnes fortsatt — i .toast__detail, som har
  // `white-space: pre-wrap` og derfor ikke klippes ved høyre kant slik overskriften gjør.
  await expect(toastOf(page)).toContainText(/seksjonspakke/i);
  await expect(page.locator(".toast__detail")).toContainText("bodyMarkdown");
});
