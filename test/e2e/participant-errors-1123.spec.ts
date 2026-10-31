import { test, expect, type Page, type Route } from "@playwright/test";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// #1123 «Finn feilene» i deltakerens lesevisning. HTML-en lages av tjenerens egen tegning og rensing
// (renderSectionMarkdown) og går så gjennom klientens rensing — det deltakeren faktisk får. Det som måles:
// setningene markeres med trykk (og tastatur), «Sjekk» viser funnet / oversett / riktig-men-markert med
// forklaringen, markeringen låses til «Prøv igjen», og blokken holder seg innenfor en telefonskjerm.

const NL = String.fromCharCode(10);
const MD = [
  "Notatene: frist 1.11. Lokale ikke avklart. Neste møte 28.11.",
  "",
  ":::feil Finn de tre feilene i referatet",
  "- [ ] Styremøte 24. oktober. Til stede: Kari, Ola og Siri.",
  "- [x] Ola sender budsjettet til revisor innen 15. november.",
  "  Fristen i notatene er 1. november. Kontroll: sammenlign hver frist med notatene.",
  "- [x] Kari bestiller lokale til julebordet.",
  "  Notatene sier at det ikke er avklart. Kontroll: det som ikke er avklart, står som «uklart».",
  "- [ ] Siri ble valgt som ny nestleder.",
  "  Det står i notatene.",
  "- [x] Neste møte er 21. november kl. 18.",
  "  Notatene sier 28. november.",
  ":::",
  "",
  "Etterpå.",
].join(NL);

async function mockParticipant(page: Page, html: string) {
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: {},
      output: {},
    })),
  );
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] })),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({ course: { id: "c1", title: "Kurs", items: [{ type: "SECTION", sectionId: "s1", title: "Seksjon", read: false }] } })),
  );
  await page.route("**/api/courses/c1/sections/s1", (route: Route) => route.fulfill(json({ title: "Seksjon", html })));
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => route.fulfill(json({ ok: true })));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

async function openSection(page: Page) {
  await mockParticipant(page, renderSectionMarkdown(MD, "nb"));
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").click();
  await expect(page.locator(".content-errors")).toBeVisible();
}

const block = (page: Page) => page.locator(".content-errors");
const sentence = (page: Page, text: string) => block(page).getByRole("button", { name: text });

test.describe("#1123 finn feilene", () => {
  test("markering, «Sjekk» med funnet / oversett / riktig-men-markert, og «Prøv igjen»", async ({ page }) => {
    await openSection(page);
    await expect(block(page).getByRole("group", { name: "Finn feilene: Finn de tre feilene i referatet" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Finn feilene: Finn de tre feilene i referatet" })).toBeVisible();
    // Ingen tilbakemelding og ingen «Prøv igjen» før «Sjekk».
    await expect(block(page).locator("[data-errors-feedback]").first()).toBeHidden();
    await expect(block(page).getByRole("button", { name: "Prøv igjen" })).toBeHidden();

    // To feil og én setning som stemmer markeres; én feil overses.
    await sentence(page, "Ola sender budsjettet til revisor innen 15. november.").click();
    await sentence(page, "Kari bestiller lokale til julebordet.").click();
    await sentence(page, "Siri ble valgt som ny nestleder.").click();
    await expect(sentence(page, "Siri ble valgt som ny nestleder.")).toHaveAttribute("aria-pressed", "true");
    // Et nytt trykk fjerner markeringen, og et til setter den igjen.
    await sentence(page, "Siri ble valgt som ny nestleder.").click();
    await expect(sentence(page, "Siri ble valgt som ny nestleder.")).toHaveAttribute("aria-pressed", "false");
    await sentence(page, "Siri ble valgt som ny nestleder.").click();

    await block(page).getByRole("button", { name: "Sjekk" }).click();
    await expect(block(page).getByRole("status")).toHaveText("Du fant 2 av 3 feil.");
    const rowOf = (text: string) => block(page).locator(".content-errors-row", { hasText: text });
    await expect(rowOf("revisor").locator("[data-errors-feedback]")).toBeVisible();
    await expect(rowOf("revisor").locator(".content-errors-verdict")).toHaveText("Du fant denne.");
    await expect(rowOf("revisor")).toContainText("Fristen i notatene er 1. november. Kontroll: sammenlign hver frist med notatene.");
    await expect(rowOf("Neste møte").locator(".content-errors-verdict")).toHaveText("Denne gikk deg hus forbi.");
    await expect(rowOf("Neste møte")).toContainText("Notatene sier 28. november.");
    await expect(rowOf("nestleder").locator(".content-errors-verdict")).toHaveText("Denne stemmer.");
    // En setning som stemmer og ikke ble markert, får ingen tilbakemelding.
    await expect(rowOf("Styremøte").locator("[data-errors-feedback]")).toBeHidden();
    // Etter «Sjekk» er markeringen låst, «Sjekk» er borte og «Prøv igjen» har fokus.
    await expect(block(page).getByRole("button", { name: "Prøv igjen" })).toBeFocused();
    // Låst: knappen er aria-disabled. Et klikk som likevel kommer fram, skal ikke endre noe.
    await expect(sentence(page, "Styremøte 24. oktober. Til stede: Kari, Ola og Siri.")).toHaveAttribute("aria-disabled", "true");
    await sentence(page, "Styremøte 24. oktober. Til stede: Kari, Ola og Siri.").click({ force: true });
    await expect(sentence(page, "Styremøte 24. oktober. Til stede: Kari, Ola og Siri.")).toHaveAttribute("aria-pressed", "false");
    await expect(block(page).getByRole("button", { name: "Sjekk" })).toBeHidden();

    await block(page).getByRole("button", { name: "Prøv igjen" }).click();
    await expect(block(page).locator("[aria-pressed='true']")).toHaveCount(0);
    await expect(block(page).locator("[data-errors-feedback]:visible")).toHaveCount(0);
    await expect(block(page).getByRole("button", { name: "Sjekk" })).toBeVisible();
    await expect(block(page).locator(".content-errors-status")).toHaveText("");
  });

  test("med tastaturet: Tab til en setning, mellomrom markerer", async ({ page }) => {
    await openSection(page);
    await sentence(page, "Kari bestiller lokale til julebordet.").focus();
    await page.keyboard.press("Space");
    await expect(sentence(page, "Kari bestiller lokale til julebordet.")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(sentence(page, "Kari bestiller lokale til julebordet.")).toHaveAttribute("aria-pressed", "false");
  });

  test("på telefon: setningene er store nok å treffe, og ingenting går utenfor skjermen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openSection(page);
    for (const box of await block(page).locator("[data-errors-item]").all()) {
      expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await sentence(page, "Kari bestiller lokale til julebordet.").click();
    await block(page).getByRole("button", { name: "Sjekk" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    if (process.env.SKJERMBILDE_DIR) await block(page).screenshot({ path: `${process.env.SKJERMBILDE_DIR}/finn-feilene-360.png` });
  });
});
