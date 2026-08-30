import { test, expect, type Page, type Route } from "@playwright/test";

// #1042/#1040: kursbevisene viser `courseTitle` og `certificationLevel`, som serveren lokaliserer
// ved HENTING (#1027). Uten ny henting ved språkbytte ble de stående på forrige språk.
//
// ⚠️ Denne flaten hadde INGENTING: verken ny henting, kappløpsvakt eller enkeltflyt. Den ble ikke
// rød av #1027 — den sluttet stille å følge språket, som #736 gjorde på profilsiden.

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const KURS: Record<string, { title: string; level: string }> = {
  nb: { title: "Endringsledelse", level: "Viderekommen" },
  "en-GB": { title: "Change management", level: "Advanced" },
};

async function mockCompleted(page: Page, opts: { delayFor?: string; delayMs?: number } = {}) {
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
    const k = KURS[locale] ?? KURS["en-GB"];
    return r.fulfill(json({
      completions: [{ courseId: "c-1", certificateId: "cert-1", completedAt: "2026-08-01T10:00:00.000Z", courseTitle: k.title, certificationLevel: k.level }],
    }));
  });
}

test.describe("#1042 — kursbevisene følger språkbyttet", () => {
  test("tittel OG nivå bytter språk uten ny knappetrykking", async ({ page }) => {
    await mockCompleted(page);
    await page.goto("/participant/completed");
    await expect(page.locator("#courseCertList")).toContainText("Change management");

    await page.selectOption("#localeSelect", "nb");

    // ⚠️ Påstand på NIVÅET også. Det var nivåkolonnen som sluttet å virke på profilsiden, og en
    // test som bare ser på tittelen kunne vært grønn mens nivået sto fast.
    await expect(page.locator("#courseCertList")).toContainText("Endringsledelse");
    await expect(page.locator("#courseCertList")).toContainText("Viderekommen");
    await expect(page.locator("#courseCertList")).not.toContainText("Change management");
  });

  test("et tregt svar i gammelt språk overskriver ikke det deltakeren står i", async ({ page }) => {
    await mockCompleted(page, { delayFor: "nb", delayMs: 900 });
    // Samler HVER tekst kursbevislista har hatt, ikke bare den siste.
    await page.addInitScript(() => {
      const w = window as unknown as { __glimt: string[] };
      w.__glimt = [];
      const start = () => {
        const el = document.getElementById("courseCertList");
        if (!el) return false;
        new MutationObserver(() => w.__glimt.push(el.textContent ?? "")).observe(el, { childList: true, subtree: true, characterData: true });
        return true;
      };
      if (!start()) document.addEventListener("DOMContentLoaded", start);
    });
    await page.goto("/participant/completed");
    await expect(page.locator("#courseCertList")).toContainText("Change management");

    await page.selectOption("#localeSelect", "nb");
    await page.selectOption("#localeSelect", "en-GB");

    // ⚠️ Å måle SLUTTILSTANDEN beviser ingenting her. Modulen serialiserer: uten kappløpsvakt
    // ville norsk blitt tegnet, og deretter engelsk over — sluttilstanden er engelsk uansett.
    // Første utgave av denne testen forble grønn da jeg fjernet vakta.
    //
    // Det brukeren ser er GLIMTET av feil språk. Derfor samles hver mellomtilstand.
    await page.waitForTimeout(1400);

    const glimt = await page.evaluate(() => (window as unknown as { __glimt: string[] }).__glimt);
    expect(glimt.some((t) => t.includes("Endringsledelse")), `så norsk tekst i ${JSON.stringify(glimt)}`).toBe(false);

    await expect(page.locator("#courseCertList")).toContainText("Change management");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
  });
});
