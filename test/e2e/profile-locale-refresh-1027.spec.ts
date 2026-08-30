import { test, expect, type Page, type Route } from "@playwright/test";

// #1027: profilsiden viste sertifiseringsnivå og kurstittel fra en cache, og re-rendret den ved
// språkbytte (#736). Det virket så lenge listene bar LAGRINGSFORMATET og klienten valgte språk.
//
// ⚠️ Da serveren begynte å bake inn språket ved henting, ble #736 sin re-rendering en no-op:
// samme rader inn, samme tekst ut. Nivåkolonnen sluttet å følge språkbyttet — uten at noe ble
// rødt, fordi renderingen fortsatt kjørte og «virket».
//
// Denne fila finnes fordi ingen test åpnet `/profile` og byttet språk.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const COURSE: Record<string, { title: string; level: string }> = {
  nb: { title: "Endringsledelse", level: "Viderekommen" },
  "en-GB": { title: "Change management", level: "Advanced" },
};

async function mockProfile(page: Page, opts: { delayFor?: string; delayMs?: number } = {}) {
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "en-GB"); } catch { /* standardspråk */ }
  });
  await page.route("**/participant/config", (r: Route) => r.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { participant: { userId: "u-1", email: "u@x.no", name: "Deltaker", roles: [] } },
    calibrationWorkspace: { accessRoles: [] },
  })));
  await page.route("**/version", (r: Route) => r.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (r: Route) => r.fulfill(json({
    user: { id: "u-1", name: "Deltaker", email: "u@x.no", roles: [] },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/queue-counts", (r: Route) => r.fulfill(json({ counts: {} })));
  await page.route("**/api/modules/completed**", (r: Route) => r.fulfill(json({ modules: [] })));

  await page.route("**/api/courses/completions**", async (r: Route) => {
    const locale = r.request().headers()["x-locale"] ?? "en-GB";
    if (opts.delayFor && locale === opts.delayFor) {
      await new Promise((res) => setTimeout(res, opts.delayMs ?? 900));
    }
    const c = COURSE[locale] ?? COURSE["en-GB"];
    // Serveren sender FERDIGE strenger — det er hele poenget med #1027.
    return r.fulfill(json({ completions: [{ courseId: "c-1", certificateId: "cert-1", completedAt: "2026-08-01T10:00:00.000Z", courseTitle: c.title, certificationLevel: c.level }] }));
  });
}

test.describe("#1027 — profilsiden henter på nytt ved språkbytte", () => {
  test("sertifiseringsnivået følger språkbyttet", async ({ page }) => {
    await mockProfile(page);
    await page.goto("/profile");
    await expect(page.locator("#coursesBody")).toContainText("Advanced");

    await page.selectOption("#localeSelect", "nb");

    // ⚠️ Påstand på NIVÅET, ikke bare på tittelen. Det var nivåkolonnen som sluttet å virke, og en
    // test som bare så på tittelen kunne vært grønn mens nivået sto fast på engelsk.
    await expect(page.locator("#coursesBody")).toContainText("Viderekommen");
    await expect(page.locator("#coursesBody")).not.toContainText("Advanced");
    await expect(page.locator("#coursesBody")).toContainText("Endringsledelse");
  });

  test("det trege svaret kan ikke overskrive språket deltakeren står i", async ({ page }) => {
    await mockProfile(page, { delayFor: "nb", delayMs: 900 });
    await page.goto("/profile");
    await expect(page.locator("#coursesBody")).toContainText("Advanced");

    await page.selectOption("#localeSelect", "nb");
    await page.selectOption("#localeSelect", "en-GB");

    await page.waitForTimeout(1400);
    await expect(page.locator("#coursesBody")).toContainText("Advanced");
    await expect(page.locator("#coursesBody")).not.toContainText("Viderekommen");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
  });
});
