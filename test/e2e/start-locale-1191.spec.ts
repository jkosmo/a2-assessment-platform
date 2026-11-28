import { expect, test, type Page, type Route } from "@playwright/test";

// #1191: klienten valgte en-GB for «no», «da», «sv» og andre ukjente nettleserspråk, og sendte det som `x-locale`. Tjeneren lagrer
// det som mottakerens språk (`preferredLocale`), så e-postene gikk ut på engelsk. Testen måler det tjeneren faktisk får: `x-locale`
// på API-kallene, med nettleserspråket satt slik en ekte nettleser gjør (Playwrights `locale`).

const ROLLER = ["ADMINISTRATOR", "SUBJECT_MATTER_OWNER", "REPORT_READER"];

async function mockOgFangSpraak(page: Page, lagret: Record<string, string>) {
  const sendt: string[] = [];
  page.on("request", (req) => {
    if (!req.url().includes("/api/")) return;
    const v = req.headers()["x-locale"];
    // Undermenyen kaller /api/me uten språk, og fetch sender da strengen «undefined». Tjeneren overser den (normalizeLocale gir
    // null og faller til Accept-Language), så den lagrer ikke noe feil språk. Kjent mangel, ikke det testen måler.
    if (v && v !== "undefined") sendt.push(v);
  });
  await page.route("**/api/**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        defaultLocale: "nb",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "u-1", email: "u@x.no", name: "U", roles: ROLLER }, userId: "u-1", email: "u@x.no", name: "U", roles: ROLLER },
        calibrationWorkspace: { accessRoles: ["ADMINISTRATOR", "SUBJECT_MATTER_OWNER"] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ROLLER }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.addInitScript((verdier) => {
    try {
      // Bare første lasting: siden skriver selv etterpå.
      if (sessionStorage.getItem("seeded") !== "1") {
        localStorage.clear();
        for (const [k, v] of Object.entries(verdier)) localStorage.setItem(k, v);
        sessionStorage.setItem("seeded", "1");
      }
    } catch { /* ignore */ }
  }, lagret);
  return sendt;
}

async function spraakSendtFra(page: Page, sti: string, lagret: Record<string, string>) {
  const sendt = await mockOgFangSpraak(page, lagret);
  await page.goto(sti);
  await expect.poll(() => sendt.length, { message: "ingen API-kall med x-locale" }).toBeGreaterThan(0);
  return [...new Set(sendt)];
}

test.describe("nettleser «no-NO»", () => {
  test.use({ locale: "no-NO" });
  test("Status sender bokmål", async ({ page }) => {
    expect(await spraakSendtFra(page, "/deltakere/status", {})).toEqual(["nb"]);
  });
  test("Vurderingskvalitet sender bokmål (hadde egen kopi av regelen)", async ({ page }) => {
    expect(await spraakSendtFra(page, "/admin-content/calibration", {})).toEqual(["nb"]);
  });
});

test.describe("nettleser «da-DK»", () => {
  test.use({ locale: "da-DK" });
  test("med kjent standardspråk sendes organisasjonens standard, ikke engelsk", async ({ page }) => {
    expect(await spraakSendtFra(page, "/deltakere/status", { "org.defaultLocale": "nb" })).toEqual(["nb"]);
  });
  test("et lagret en-GB fra den gamle reserven gjettes på nytt", async ({ page }) => {
    expect(await spraakSendtFra(page, "/deltakere/status", { "org.defaultLocale": "nb", "participant.locale": "en-GB" })).toEqual(["nb"]);
  });
  test("kontroll: engelsk valgt i språkvelgeren står", async ({ page }) => {
    const lagret = { "org.defaultLocale": "nb", "participant.locale": "en-GB", "participant.localeChosen": "en-GB" };
    expect(await spraakSendtFra(page, "/deltakere/status", lagret)).toEqual(["en-GB"]);
  });
});

test.describe("nettleser «en-US»", () => {
  test.use({ locale: "en-US" });
  test("kontroll: engelsk nettleser får engelsk", async ({ page }) => {
    expect(await spraakSendtFra(page, "/deltakere/status", { "org.defaultLocale": "nb" })).toEqual(["en-GB"]);
  });
});
