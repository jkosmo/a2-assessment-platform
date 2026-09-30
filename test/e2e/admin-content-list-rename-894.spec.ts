import { expect, test, type Page, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #894: omdøping i lista, og hullene som gjorde at feil språk kunne passere ubemerket.
//
// ⚠️ Påstandene er på HVA som sendes og HVA raden sier — ikke på at knappen finnes. En knapp som
// åpner et felt og lagrer feil språk ville sett riktig ut på skjermen.

const MODULER = [
  // Skrevet på ett språk: lagret som ren streng, så `titleLocales` er tom → to hull.
  { id: "mod-ett", title: "Risikovurdering", titleLocales: [], status: "published", courseCount: 0 },
  // Fullt oversatt: ingen hull.
  { id: "mod-alle", title: "Sikkerhetskultur", titleLocales: ["nb", "nn", "en-GB"], status: "published", courseCount: 0 },
  // Hull, men eid av noen andre. Ligger her fordi en samlet oversetting som tok denne ville fått
  // 403 på patchen — og forfatteren ville sett et tall som lovet mer enn knappen kan gjøre.
  { id: "mod-laast", title: "Andres modul", titleLocales: [], status: "published", courseCount: 0, canManage: false },
];

async function åpneLista(page: Page) {
  await mockCommonApis(page, { libraryModules: MODULER });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/admin-content");
  await expect(page.getByText("Risikovurdering").first()).toBeVisible();
}

const rad = (page: Page, id: string) => page.locator(`tr[data-row-id="${id}"]`);

test.describe("#894 — omdøping i lista", () => {
  test("raden viser hvilke språk tittelen mangler, og «alle tre» når den er komplett", async ({ page }) => {
    await åpneLista(page);

    await expect(rad(page, "mod-ett").locator(".lang-gap")).toHaveText("nn, en mangler");
    await expect(rad(page, "mod-alle").locator(".lang-complete")).toHaveText("alle tre");
  });

  test("en rad forfatteren ikke eier telles ikke med, og har ingen «Døp om»", async ({ page }) => {
    await åpneLista(page);

    // Hullet VISES — det er sant, og andre kan trenge å se det.
    await expect(rad(page, "mod-laast").locator(".lang-gap")).toBeVisible();
    // ⚠️ Men bare mod-ett kan faktisk oversettes, og tallet skal si det.
    await expect(page.getByRole("button", { name: /Oversett det som mangler/ })).toHaveText("Oversett det som mangler (1)");
    await expect(rad(page, "mod-laast").getByRole("button", { name: "Døp om" })).toHaveCount(0);
  });

  test("«Døp om» lagrer på språket lista viser, og bare det", async ({ page }) => {
    await åpneLista(page);
    const sendt: { body: { title?: Record<string, string> } | null } = { body: null };
    await page.route("**/api/admin/content/modules/*/title", (route: Route) => {
      sendt.body = JSON.parse(route.request().postData() ?? "{}") as { title?: Record<string, string> };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ module: { id: "mod-ett" } }) });
    });

    await rad(page, "mod-ett").getByRole("button", { name: "Døp om" }).click();
    const felt = rad(page, "mod-ett").locator(".row-rename input");
    await expect(felt).toBeFocused();
    await expect(felt).toHaveValue("Risikovurdering");
    await felt.fill("Risikovurdering i praksis");
    await felt.press("Enter");

    await expect.poll(() => sendt.body?.title).toEqual({ nb: "Risikovurdering i praksis" });
  });

  test("Escape avbryter uten å lagre", async ({ page }) => {
    await åpneLista(page);
    let kalt = false;
    await page.route("**/api/admin/content/modules/*/title", (route: Route) => {
      kalt = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await rad(page, "mod-ett").getByRole("button", { name: "Døp om" }).click();
    const felt = rad(page, "mod-ett").locator(".row-rename input");
    await felt.fill("Noe annet");
    await felt.press("Escape");

    await expect(rad(page, "mod-ett").locator(".row-rename")).toHaveCount(0);
    await expect(rad(page, "mod-ett")).toContainText("Risikovurdering");
    expect(kalt).toBe(false);
  });

  test("«Oversett det som mangler» sender kildeteksten MED — ellers ville originalen forsvunnet", async ({ page }) => {
    await åpneLista(page);
    const oversett: { body: { title?: string; sourceLocale?: string; targetLocales?: string[] } | null } = { body: null };
    const patch: { body: { title?: Record<string, string> } | null } = { body: null };

    await page.route("**/api/admin/content/titles/localize", (route: Route) => {
      oversett.body = JSON.parse(route.request().postData() ?? "{}");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ title: { nn: "Risikovurdering (nn)", "en-GB": "Risk assessment" }, failedLocales: [] }),
      });
    });
    await page.route("**/api/admin/content/modules/*/title", (route: Route) => {
      patch.body = JSON.parse(route.request().postData() ?? "{}");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ module: { id: "mod-ett" } }) });
    });

    // Knappen bærer antallet elementer med hull, så forfatteren ser hva den vil gjøre.
    const knapp = page.getByRole("button", { name: /Oversett det som mangler \(1\)/ });
    await expect(knapp).toBeEnabled();
    await knapp.click();

    await expect.poll(() => oversett.body?.targetLocales).toEqual(["nn", "en-GB"]);
    expect(oversett.body?.sourceLocale).toBe("nb");
    // ⚠️ Kjernen: bokmål er med i patchen. Uten den sletter tjeneren originalen når tittelen er
    // lagret som ren streng (festet i test/m2-list-rename-894.test.ts).
    await expect.poll(() => patch.body?.title).toEqual({
      nb: "Risikovurdering",
      nn: "Risikovurdering (nn)",
      "en-GB": "Risk assessment",
    });
  });

  test("et språk som ikke kom gjennom, navngis — og fylles ikke med kildeteksten", async ({ page }) => {
    await åpneLista(page);
    const patch: { body: { title?: Record<string, string> } | null } = { body: null };
    await page.route("**/api/admin/content/titles/localize", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ title: { "en-GB": "Risk assessment" }, failedLocales: ["nn"] }),
      }),
    );
    await page.route("**/api/admin/content/modules/*/title", (route: Route) => {
      patch.body = JSON.parse(route.request().postData() ?? "{}");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ module: { id: "mod-ett" } }) });
    });

    await page.getByRole("button", { name: /Oversett det som mangler/ }).click();

    await expect.poll(() => patch.body?.title).toEqual({ nb: "Risikovurdering", "en-GB": "Risk assessment" });
    // Nynorsk er IKKE i patchen — hverken oversatt eller kopiert fra bokmål (#892).
    expect(patch.body?.title).not.toHaveProperty("nn");
    await expect(page.locator("#toastRegion")).toContainText("nn");
  });
});

// ---------------------------------------------------------------------------
// Seksjonslista. Samme flate — men IKKE samme kontrakt på tjeneren, og det er poenget med å teste
// den for seg: seksjonenes tittel-PATCH ERSTATTER hele verdien, mens modulenes slår sammen.
// ---------------------------------------------------------------------------

const SEKSJONER = [
  // Skrevet på ett språk, lagret som ren streng.
  { id: "sec-ett", title: "Kvalitetssikring", titleLocales: ["nb"], versionNo: 2, activeVersionId: "v1", courseCount: 0, updatedAt: "2026-09-01T08:00:00.000Z" },
  // Har bokmål og nynorsk, mangler engelsk.
  {
    id: "sec-to",
    title: JSON.stringify({ nb: "Avvikshåndtering", nn: "Avvikshandtering" }),
    titleLocales: ["nb", "nn"],
    versionNo: 1,
    activeVersionId: "v2",
    courseCount: 0,
    updatedAt: "2026-09-02T08:00:00.000Z",
  },
  // Arkivert, og med hull. Ligger her for å skille «synlige» fra «alle innlastede»: lista står på
  // «Aktive», og en samlet oversetting som også tok denne ville gjort mer enn knappen sier.
  { id: "sec-arkiv", title: "Gammel rutine", titleLocales: ["nb"], versionNo: 5, activeVersionId: null, archivedAt: "2026-05-01T08:00:00.000Z", courseCount: 0, updatedAt: "2026-05-01T08:00:00.000Z" },
];

async function åpneSeksjonslista(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.route("**/participant/config", (route: Route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
      calibrationWorkspace: { accessRoles: [] },
    }),
  }));
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"version":"test"}' }));
  await page.route("**/api/me", (route: Route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }),
  }));
  await page.route("**/api/admin/content-owners**", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ owners: [] }),
  }));
  await page.route("**/api/admin/content/sections", (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ sections: SEKSJONER }),
  }));
  await page.goto("/admin-content/sections");
  await expect(page.getByText("Kvalitetssikring").first()).toBeVisible();
}

test.describe("#894 — omdøping i seksjonslista", () => {
  test("raden viser hullene, og «Oversett det som mangler» teller bare de som har noen", async ({ page }) => {
    await åpneSeksjonslista(page);

    await expect(rad(page, "sec-ett").locator(".lang-gap")).toHaveText("nn, en mangler");
    await expect(rad(page, "sec-to").locator(".lang-gap")).toHaveText("en mangler");
    await expect(page.getByRole("button", { name: /Oversett det som mangler \(2\)/ })).toBeEnabled();
  });

  test("tallet følger filteret — det teller de SYNLIGE, og oppdateres når filteret byttes", async ({ page }) => {
    await åpneSeksjonslista(page);
    const knapp = page.getByRole("button", { name: /Oversett det som mangler/ });

    // «Aktive» (standard): de to aktive har hull, den arkiverte holdes utenfor.
    await expect(knapp).toHaveText("Oversett det som mangler (2)");

    // ⚠️ Et filterklikk tegner BARE tabellen. Uten kroken som oppdaterer hodet ville tallet stått
    // igjen på 2, og knappen ville oversatt et annet sett enn det den sier.
    await page.getByRole("button", { name: "Arkiverte" }).click();
    await expect(knapp).toHaveText("Oversett det som mangler (1)");
  });

  test("⚠️ samlet oversetting bærer de lagrede språkene videre — ellers ville de blitt slettet", async ({ page }) => {
    await åpneSeksjonslista(page);
    const patcher: Record<string, Record<string, string>> = {};

    await page.route("**/api/admin/content/titles/localize", (route: Route) => {
      const kropp = JSON.parse(route.request().postData() ?? "{}") as { title: string; targetLocales: string[] };
      const oversatt: Record<string, string> = {};
      for (const locale of kropp.targetLocales) oversatt[locale] = `${kropp.title} [${locale}]`;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: oversatt, failedLocales: [] }) });
    });
    await page.route("**/api/admin/content/sections/*/title", (route: Route) => {
      const id = new URL(route.request().url()).pathname.split("/").slice(-2, -1)[0];
      patcher[id] = (JSON.parse(route.request().postData() ?? "{}") as { title: Record<string, string> }).title;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id } }) });
    });

    await page.getByRole("button", { name: /Oversett det som mangler/ }).click();

    // ⚠️ Kjernen: begge patchene bærer det som ALT var lagret. Seksjonenes tittel-PATCH erstatter
    // verdien, så en patch med bare de nye språkene ville slettet originalene — og lista ville sett
    // ut som en vellykket oversetting.
    await expect.poll(() => patcher["sec-to"]).toEqual({
      nb: "Avvikshåndtering",
      nn: "Avvikshandtering",
      "en-GB": "Avvikshåndtering [en-GB]",
    });
    expect(patcher["sec-ett"]).toEqual({
      nb: "Kvalitetssikring",
      nn: "Kvalitetssikring [nn]",
      "en-GB": "Kvalitetssikring [en-GB]",
    });
    // Den arkiverte ble ikke rørt: knappen tar de synlige.
    expect(patcher["sec-arkiv"]).toBeUndefined();
  });

  test("⚠️ omdøping sender HELE språkkartet — seksjonenes patch erstatter, den slår ikke sammen", async ({ page }) => {
    await åpneSeksjonslista(page);
    const sendt: { body: { title?: Record<string, string> } | null } = { body: null };
    await page.route("**/api/admin/content/sections/*/title", (route: Route) => {
      sendt.body = JSON.parse(route.request().postData() ?? "{}");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-to" } }) });
    });

    await rad(page, "sec-to").getByRole("button", { name: "Døp om" }).click();
    const felt = rad(page, "sec-to").locator(".row-rename input");
    await expect(felt).toHaveValue("Avvikshåndtering");
    await felt.fill("Avvik og korrigering");
    await felt.press("Enter");

    // ⚠️ Nynorsk er MED, uendret. En patch med bare bokmål ville slettet den — og lista ville sett
    // ut som en vellykket omdøping.
    await expect.poll(() => sendt.body?.title).toEqual({
      nb: "Avvik og korrigering",
      nn: "Avvikshandtering",
    });
  });

  test("en tittel lagret som ren streng leses som bokmål — ikke som språket lista står i", async ({ page }) => {
    await åpneSeksjonslista(page);
    const sendt: { body: { title?: Record<string, string> } | null } = { body: null };
    await page.route("**/api/admin/content/sections/*/title", (route: Route) => {
      sendt.body = JSON.parse(route.request().postData() ?? "{}");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ section: { id: "sec-ett" } }) });
    });

    await rad(page, "sec-ett").getByRole("button", { name: "Døp om" }).click();
    const felt = rad(page, "sec-ett").locator(".row-rename input");
    // Feltet står med den lagrede teksten fordi lista vises på bokmål, og strengen ER bokmål.
    await expect(felt).toHaveValue("Kvalitetssikring");
    await felt.fill("Kvalitetsstyring");
    await felt.press("Enter");

    await expect.poll(() => sendt.body?.title).toEqual({ nb: "Kvalitetsstyring" });
  });
});
