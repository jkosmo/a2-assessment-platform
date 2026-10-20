import { test, expect, type Page, type Route } from "@playwright/test";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// #1110 (følge per alternativ i «sjekk deg selv») og #1107 («finn parene») i deltakerens lesevisning.
// HTML-en lages av tjenerens egen tegning og rensing (renderSectionMarkdown) og går så gjennom klientens
// rensing — det deltakeren faktisk får.

const NL = String.fromCharCode(10);
const MD = [
  "En innbygger ringer og vil se dokumentene i saken om naboens byggesøknad.",
  "",
  ":::sjekk Søknaden inneholder naboens personnummer. Hva gjør du?",
  "- [ ] Avslår hele innsynet",
  "  For mye. Bare opplysningen som skal unntas, kan holdes tilbake.",
  "- [x] Sladder personnummeret og gir innsyn i resten",
  "  Riktig. Du unntar det som må unntas.",
  "",
  "Innsyn er hovedregelen.",
  ":::",
  "",
  ":::par Koble begrepet med forklaringen",
  "- Hjemmel = Lovbestemmelsen et vedtak bygger på",
  "- Merinnsyn = Innsyn selv om dokumentet kunne vært unntatt",
  "- Klagefrist = Tiden parten har til å klage på vedtaket",
  "- Journalføring = Registrering av et dokument i arkivet",
  ":::",
  "",
  "Etterpå.",
].join(NL);
const TERMS = ["Hjemmel", "Merinnsyn", "Klagefrist", "Journalføring"];
const DEFS = ["Lovbestemmelsen et vedtak bygger på", "Innsyn selv om dokumentet kunne vært unntatt", "Tiden parten har til å klage på vedtaket", "Registrering av et dokument i arkivet"];

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
  await expect(page.locator(".content-check")).toBeVisible();
  await expect(page.locator(".content-pairs[data-ready='true']")).toBeVisible();
}

const pairsBlock = (page: Page) => page.locator(".content-pairs");
const term = (page: Page, i: number) => pairsBlock(page).locator(".content-pairs-item--term").nth(i);
const def = (page: Page, i: number) => pairsBlock(page).locator(".content-pairs-item--def").filter({ hasText: DEFS[i]! });

test.describe("#1110 følge per alternativ", () => {
  test("feil valg viser følgen til det valgte, ikke de andre; forklaringen står under", async ({ page }) => {
    await openSection(page);
    const box = page.locator(".content-check");
    await expect(box.locator(".content-check-option-feedback")).toHaveCount(2);
    await expect(box.locator(".content-check-option-feedback").first()).toBeHidden();
    await box.locator(".content-check-option").nth(0).click();
    await expect(box.locator('[data-check-feedback="0"]')).toBeVisible();
    await expect(box.locator('[data-check-feedback="0"]')).toHaveText("For mye. Bare opplysningen som skal unntas, kan holdes tilbake.");
    await expect(box.locator('[data-check-feedback="1"]')).toBeHidden();
    await expect(box.locator(".content-check-explanation")).toBeVisible();
  });

  test("med tastaturet: riktig valg viser følgen til det riktige", async ({ page }) => {
    await openSection(page);
    const box = page.locator(".content-check");
    await box.locator(".content-check-option").nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(box.locator('[data-check-feedback="1"]')).toBeVisible();
    await expect(box.locator('[data-check-feedback="0"]')).toBeHidden();
    await expect(box.locator(".content-check-verdict")).toHaveText("Riktig!");
  });
});

test.describe("#1107 finn parene", () => {
  test("to kolonner: begrepene i rekkefølge, forklaringene stokket; lista står bare for skjermlesere", async ({ page }) => {
    await openSection(page);
    await expect(pairsBlock(page).locator(".content-pairs-item--term")).toHaveText(TERMS);
    const order = await pairsBlock(page).locator(".content-pairs-item--def").allTextContents();
    expect(order).not.toEqual(DEFS);
    expect([...order].sort()).toEqual([...DEFS].sort());
    // Lista er skjult for øyet (1 × 1 px), men står i dokumentet.
    const box = await pairsBlock(page).locator(".content-pairs-list").boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(1);
    await expect(pairsBlock(page).locator(".content-pairs-status")).toHaveText("0 av 4 par");
  });

  test("med mus: et feil par blir ikke stående, et riktig blir grønt og låst, og alle par gir ferdig", async ({ page }) => {
    await openSection(page);
    await term(page, 0).click();
    await def(page, 1).click();
    await expect(pairsBlock(page).locator(".content-pairs-status")).toHaveText("Ikke et par. Prøv igjen.");
    await expect(term(page, 0)).not.toHaveClass(/is-done/);
    await expect(term(page, 0)).not.toHaveAttribute("aria-disabled", "true");
    for (let i = 0; i < TERMS.length; i += 1) {
      await term(page, i).click();
      await def(page, i).click();
      await expect(term(page, i)).toHaveClass(/is-done/);
      await expect(def(page, i)).toHaveAttribute("aria-disabled", "true");
    }
    await expect(pairsBlock(page).locator(".content-pairs-status")).toHaveText("Alle 4 parene er riktige.");
  });

  test("med tastaturet: Enter på begrepet, så på forklaringen", async ({ page }) => {
    await openSection(page);
    await term(page, 2).focus();
    await page.keyboard.press("Enter");
    await expect(term(page, 2)).toHaveAttribute("aria-pressed", "true");
    await def(page, 2).focus();
    await page.keyboard.press("Enter");
    await expect(term(page, 2)).toHaveClass(/is-done/);
    await expect(pairsBlock(page).locator(".content-pairs-status")).toHaveText("1 av 4 par");
  });

  test("telefon (390 px): ingenting stikker ut av leseren, og knappene er minst 44 px høye", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSection(page);
    const m = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      // Lista for skjermlesere er klippet til 1 × 1 px (shared.css); elementene inni har full bredde i målingen,
      // men vises ikke og gir ingen rulling — sidelengs rulling måles for seg under.
      const out = [...document.querySelectorAll<HTMLElement>(".content-pairs *, .content-check *")]
        .filter((el) => !el.closest(".content-pairs-list"))
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && (r.right > width + 0.5 || r.left < -0.5); })
        .map((el) => el.className);
      const heights = [...document.querySelectorAll<HTMLElement>(".content-pairs-item")].map((el) => el.getBoundingClientRect().height);
      return { out, minHeight: Math.min(...heights), sideways: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(m.out).toEqual([]);
    expect(m.sideways).toBeLessThanOrEqual(0);
    expect(m.minHeight).toBeGreaterThanOrEqual(44);
  });
});
