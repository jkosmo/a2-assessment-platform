// Kjører mot et UTRULLET miljø, ikke mot en statisk server med mockede API-er.
//
// Hvorfor dette finnes: de ~200 e2e-ene under `test/e2e/` beviser at klienten gjør riktig *gitt en
// responsform vi selv har skrevet*. De kan per konstruksjon ikke fange at det utrullede artefaktet
// er noe annet enn kildekoden, at en rute svarer annerledes i Azure enn lokalt, eller at en ny
// endepunkt-vakt ikke kom med i utrullingen.
//
// Produkteier, 2026-08-19: *«Alt annet bør testes via Playwright, dette inkluderer å teste mot Stage
// slik at du kan teste mot reelle data.»* Dette er den halvdelen som ikke trenger innlogging.
// Den autentiserte halvdelen krever en ekte Entra-sesjon (`authMode: "entra"` på stage, og
// mock-headere ignoreres der) — se `doc/pilot/STAGE_PLAYWRIGHT.md`.
//
// Kjør:  npm run test:stage
// Mot et annet miljø:  STAGE_BASE_URL=https://… npm run test:stage

import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = process.env.STAGE_BASE_URL
  ?? "https://a2-assessment-platform-stg-app-x6eyx4.azurewebsites.net";

test.describe("utrullet stage — flate og sikkerhet", () => {
  test("appen svarer, og versjonen er den vi tror", async ({ request }) => {
    const version = await request.get(`${BASE}/version`);
    expect(version.ok()).toBe(true);
    const body = await version.json();
    expect(body.app).toBe("a2-assessment-platform");
    // Ikke pinnet til et tall: da må testen redigeres ved hver utrulling, og en test man må
    // redigere for å få grønn er en test man slutter å lese. Formen er det som betyr noe.
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);

    const health = await request.get(`${BASE}/healthz`);
    expect(health.ok()).toBe(true);
    expect((await health.json()).status).toBe("ok");
  });

  // #896 S3c: Avansert er slettet. Rutene skal svare som permanente redirects, fordi de ligger i
  // bokmerker — en 404 ville strandet en forfatter som ikke har gjort noe galt.
  test("de pensjonerte Avansert-rutene redirigerer, de 404-er ikke", async ({ request }) => {
    const withModule = await request.get(`${BASE}/admin-content/module/test-module/advanced`, {
      maxRedirects: 0,
    });
    expect(withModule.status()).toBe(301);
    expect(withModule.headers().location).toContain("/admin-content/module/test-module/conversation");

    const bare = await request.get(`${BASE}/admin-content/advanced`, { maxRedirects: 0 });
    expect(bare.status()).toBe(301);
    expect(bare.headers().location).toContain("/admin-content");
  });

  // Hver ny rute i denne leveransen, uten legitimasjon. 401 er det eneste akseptable svaret —
  // #903 finnes fordi en eksportrute gikk i produksjon uten vakt og lekket andres MCQ-fasit.
  const guarded: Array<{ method: "get" | "post"; path: string }> = [
    { method: "get", path: "/api/admin/content/sections/any-id/export-package" },
    { method: "post", path: "/api/admin/content/sections/import" },
    { method: "get", path: "/api/admin/content/sections/any-id" },
    { method: "get", path: "/api/admin/content/sections/any-id/assets" },
    { method: "get", path: "/api/admin/content/modules/any-id/export-package" },
    { method: "post", path: "/api/admin/content/courses/import" },
  ];

  for (const route of guarded) {
    test(`${route.method.toUpperCase()} ${route.path} krever innlogging`, async ({ request }) => {
      const call = route.method === "get"
        ? request.get(`${BASE}${route.path}`)
        : request.post(`${BASE}${route.path}`, { data: {} });
      const response = await call;
      // 401, ikke 403 og ikke 404: uautentisert skal aldri kunne skille «finnes ikke» fra
      // «finnes, men er ikke din» — det er en oppregningskanal i seg selv.
      expect(response.status(), `${route.path} svarte ${response.status()}`).toBe(401);
    });
  }

  // Mock-identitetsheadere MÅ ignoreres i et delt Azure-miljø (CLAUDE.md). Dette er den ene
  // testen som ville fanget at noen satte AUTH_MODE=mock på stage ved et uhell.
  test("mock-identitetsheadere gir ikke tilgang", async ({ request }) => {
    const response = await request.get(`${BASE}/api/admin/content/sections/any-id`, {
      headers: {
        "x-user-id": "admin-1",
        "x-user-email": "admin@company.com",
        "x-user-roles": "ADMINISTRATOR",
      },
    });
    expect(response.status()).toBe(401);
  });

  test("kjøretidskonfigurasjonen sier entra, ikke mock", async ({ request }) => {
    const config = await (await request.get(`${BASE}/participant/config`)).json();
    expect(config.authMode).toBe("entra");
    expect(config.debugMode).toBe(false);
    expect(config.mockRoleSwitchEnabled).toBe(false);
  });
});

test.describe("utrullet stage — artefaktet stemmer med kilden", () => {
  async function fetchText(request: APIRequestContext, path: string): Promise<string> {
    const response = await request.get(`${BASE}${path}`);
    expect(response.ok(), `${path} svarte ${response.status()}`).toBe(true);
    return response.text();
  }

  // Det som faktisk ble rullet ut, ikke det som ligger i git. En feilslått build som serverer et
  // gammelt bundle ser identisk ut i kildekoden.
  test("arbeidsflaten er utrullet med oppryddingen fra #896 S3c", async ({ request }) => {
    const html = await fetchText(request, "/admin-content/module/x/conversation");

    expect(html).toContain('id="tabPreview"');
    expect(html).toContain('id="tabEdit"');
    expect(html).toContain('id="tabSettings"');
    expect(html).toContain('id="workspaceActions"');

    // Slettet i S3c — en knapp uten klikkhåndterer, med en gal forklaring over seg.
    expect(html).not.toContain('id="settingsOpenAdvanced"');
    // Slettet i S3c sammen med siden.
    expect(html).not.toContain("admin-content-advanced");
  });

  // QA 2026-08-18/19: begge disse var ekte feil, og begge er usynlige i en mocket e2e fordi
  // `toBeVisible()` er sann for både `block` og `flex`.
  test("layout ligger i klasser, ikke i inline style som setHidden nullstiller", async ({ request }) => {
    const html = await fetchText(request, "/admin-content/module/x/conversation");

    // Personvernvarselet: `display:flex` MÅ ligge i klassen. Lå det inline, satte
    // `setHidden(el, false)` det til "" og boksen ble tegnet som `block`.
    expect(html).toContain(".privacy-notice");
    expect(html).toContain('class="privacy-notice"');
    expect(html).not.toMatch(/id="privacyNotice"[^>]*style="[^"]*display:\s*flex/);

    // Handlingslinja: `[hidden]` taper mot en klasse som setter display, så den skal styres av
    // inline `display:none` — ikke av attributtet.
    expect(html).not.toMatch(/id="workspaceActions"[^>]*\shidden[\s>]/);
    expect(html).toMatch(/id="workspaceActions"[^>]*style="display:none"/);
  });

  test("fanemerkingen fra #926 er med i utrullet CSS", async ({ request }) => {
    const html = await fetchText(request, "/admin-content/module/x/conversation");
    expect(html).toContain('.module-tab[data-attention="1"]::after');
  });

  // Én rå i18n-nøkkel nådde brukeren i denne leveransen (`shell.module.importReloadFailed`).
  // Dette fanger klassen på det utrullede bundlet: at nøkler shell-en slår opp faktisk finnes.
  test("i18n-bundlet er utrullet og har nøklene shell-en slår opp", async ({ request }) => {
    const i18n = await fetchText(request, "/static/i18n/admin-content-translations.js");

    for (const key of [
      "shell.module.importReloadFailed",
      "shell.proposal.title",
      "shell.proposal.use",
      "shell.proposal.discard",
      "shell.tab.attention.suffix",
      "shell.settings.needsMissing",
    ]) {
      expect(i18n, `mangler ${key} i utrullet bundle`).toContain(key);
    }

    // Slettet i oppryddingen — står de igjen, er et gammelt bundle utrullet.
    expect(i18n).not.toContain("shell.settings.openAdvanced");
  });

  test("shell-en er utrullet med §6-porten", async ({ request }) => {
    const js = await fetchText(request, "/static/admin-content-shell.js");
    expect(js).toContain("commitOrProposeGenerated");
    expect(js).toContain("markTabAttention");
    // Slettet 2026-08-19 — maskinen bak «kopier teksten inn i alle tre språk».
    expect(js).not.toContain("function translateLocalizedText");
  });
});
