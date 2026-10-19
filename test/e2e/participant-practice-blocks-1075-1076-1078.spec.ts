import { test, expect, type Page, type Route } from "@playwright/test";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// #1075 «Steg for steg», #1076 «Skriv selv» og #1078 «Repetisjonskort» i deltakerens lesevisning, og
// «Steg for steg» i forhåndsvisningen i seksjonsredigeringen. HTML-en lages av tjenerens egen tegning og
// rensing (renderSectionMarkdown) og går så gjennom klientens rensing — det deltakeren faktisk får.
// Blokkene gjøres interaktive av public/static/content-blocks.js etter at teksten er satt inn.

const NL = String.fromCharCode(10);

const MD = [
  "Innledning.",
  "",
  ":::steg Slik behandler du en innsynsbegjæring",
  "### Registrer begjæringen",
  "Før den inn i saksarkivet samme dag. Se [veilederen](https://example.com/veileder).",
  "",
  "### Finn dokumentene",
  "Søk i arkivet etter alt begjæringen gjelder.",
  "",
  "### Svar og begrunn",
  "Send svaret med dokumentene.",
  ":::",
  "",
  ":::skriv Skriv vedtakspunktet for at styremøtene flyttes fra tirsdag til torsdag.",
  "**Vedtak:** Styremøtene flyttes fra tirsdag til torsdag kl. 09.00.",
  "",
  "- [ ] hva som ble bestemt, med dag og klokkeslett?",
  "- [ ] fra når det gjelder?",
  ":::",
  "",
  ":::repetisjon Fagord i møtearbeid",
  "### Vedtak",
  "Det møtet bestemte, med ansvarlig og frist.",
  "",
  "### Referent",
  "Den som skriver referatet.",
  "",
  "### Habil",
  "Uten personlig interesse i saken.",
  ":::",
  "",
  "Etterpå.",
].join(NL);

async function mockParticipant(page: Page, html: string) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
        calibrationWorkspace: { accessRoles: [] },
        flow: {},
        output: {},
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ counts: {} }) }));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] }) }),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ completions: [] }) }));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "c1", title: "Kurs", items: [{ type: "SECTION", sectionId: "s1", title: "Seksjon", read: false }] } }) }),
  );
  await page.route("**/api/courses/c1/sections/s1", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ title: "Seksjon", html }) }),
  );
  await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
}

async function openSection(page: Page) {
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").click();
  await expect(page.locator(".content-steps")).toBeVisible();
}

async function open(page: Page, locale = "nb") {
  await mockParticipant(page, renderSectionMarkdown(MD, locale));
  await openSection(page);
}

test.describe("#1075 «Steg for steg» i lesevisningen", () => {
  test("knappene: ett steg av gangen, Forrige er låst på første og Neste på siste", async ({ page }) => {
    await open(page);
    const block = page.locator(".content-steps");
    await expect(block).toHaveAttribute("data-ready", "true");
    await expect(block.locator(".content-steps-label")).toHaveText("Steg for steg");
    await expect(block.locator(".content-steps-title")).toHaveText("Slik behandler du en innsynsbegjæring");
    const steps = block.locator(".content-step");
    const prev = block.locator("[data-steps-prev]");
    const next = block.locator("[data-steps-next]");
    const count = block.locator(".content-steps-count");

    await expect(steps.nth(0)).toBeVisible();
    await expect(steps.nth(1)).toBeHidden();
    await expect(steps.nth(2)).toBeHidden();
    await expect(count).toContainText("Steg 1 av 3");
    await expect(prev).toHaveAttribute("aria-disabled", "true");
    await expect(next).toHaveAttribute("aria-disabled", "false");
    await expect(block.locator(".content-steps-dots span.is-on")).toHaveCount(1);

    await next.click();
    await expect(steps.nth(1)).toBeVisible();
    await expect(steps.nth(0)).toBeHidden();
    await expect(count).toContainText("Steg 2 av 3");
    await expect(prev).toHaveAttribute("aria-disabled", "false");
    await expect(next).toHaveAttribute("aria-disabled", "false");

    await next.click();
    await expect(steps.nth(2)).toBeVisible();
    await expect(count).toContainText("Steg 3 av 3");
    await expect(next).toHaveAttribute("aria-disabled", "true");
    // Forbi siste skjer ingenting. (force: Playwright klikker ellers ikke på en knapp med aria-disabled.)
    await next.click({ force: true });
    await expect(steps.nth(2)).toBeVisible();
    await expect(count).toContainText("Steg 3 av 3");

    await prev.click();
    await expect(steps.nth(1)).toBeVisible();
    await expect(count).toContainText("Steg 2 av 3");
  });

  test("tastaturet: piltastene blar når gjennomgangen har fokus, og byttet kunngjøres", async ({ page }) => {
    await open(page);
    const block = page.locator(".content-steps");
    const steps = block.locator(".content-step");
    const prev = block.locator("[data-steps-prev]");
    const next = block.locator("[data-steps-next]");
    const count = block.locator(".content-steps-count");
    await expect(count).toHaveAttribute("aria-live", "polite");

    await next.focus();
    await page.keyboard.press("ArrowRight");
    await expect(steps.nth(1)).toBeVisible();
    // Skjermleseren får tittelen på steget sammen med «Steg 2 av 3».
    await expect(count).toHaveText("Steg 2 av 3: Finn dokumentene");
    await page.keyboard.press("ArrowLeft");
    await expect(steps.nth(0)).toBeVisible();
    await expect(prev).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(steps.nth(0)).toBeVisible();

    // Neste med Enter, og fokus blir stående på knappen også når den låses på siste steg.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(steps.nth(2)).toBeVisible();
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeFocused();

    // Et klikk i teksten gir blokken fokus, og piltastene virker derfra.
    await steps.nth(2).locator(".content-step-body").click();
    await page.keyboard.press("ArrowLeft");
    await expect(steps.nth(1)).toBeVisible();
  });

  // QA-porten, 2.96.0: med fokus på en lenke i steget som skjules, havnet fokus på <body>, og neste
  // piltast gjorde ingenting.
  test("tastaturet: fokus på en lenke i steget — piltastene blar videre", async ({ page }) => {
    await open(page);
    const block = page.locator(".content-steps");
    const count = block.locator(".content-steps-count");
    await block.locator(".content-step").nth(0).getByRole("link", { name: "veilederen" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(count).toContainText("Steg 2 av 3");
    await expect(block).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(count).toContainText("Steg 3 av 3");
  });

  test("engelsk: etikettene følger språket", async ({ page }) => {
    await open(page, "en-GB");
    const block = page.locator(".content-steps");
    await expect(block.locator(".content-steps-label")).toHaveText("Step by step");
    await expect(block.locator(".content-steps-count")).toContainText("Step 1 of 3");
    await expect(block.locator("[data-steps-next]")).toHaveText("Next →");
    await expect(page.locator(".content-write-show")).toHaveText("Show an example answer");
    await expect(page.locator(".content-flash-count")).toContainText("Card 1 of 3");
  });

  test("redusert bevegelse: stegene tones ikke inn", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const current = page.locator(".content-step.is-current");
    expect(await current.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await current.evaluate((el) => getComputedStyle(el).animationName)).toBe("content-step-in");
  });

  test("uten skript: alle stegene står som en nummerert liste, uten knapper", async ({ page }) => {
    await page.goto("/static/shared.css");
    const origin = new URL(page.url()).origin;
    await page.setContent(`<!doctype html><link rel="stylesheet" href="${origin}/static/shared.css"><main>${renderSectionMarkdown(MD, "nb")}</main>`);
    const block = page.locator(".content-steps");
    await expect(block.locator("ol > li.content-step")).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) await expect(block.locator(".content-step").nth(i)).toBeVisible();
    await expect(block.locator("button")).toHaveCount(0);
    // Kortene står som begrep og forklaring i par; skriv selv virker som vanlige skjemaelementer.
    await expect(page.locator(".content-flash dt")).toHaveCount(3);
    await expect(page.locator(".content-flash dd").first()).toBeVisible();
    await page.locator(".content-write-show").click();
    await expect(page.locator(".content-write-example")).toBeVisible();
  });
});

test.describe("#1076 «Skriv selv» i lesevisningen", () => {
  test("skriver, åpner eksempelsvaret, krysser av — og teksten er der etter omlasting", async ({ page }) => {
    await open(page);
    const block = page.locator(".content-write");
    const field = block.getByRole("textbox", { name: "Skriv vedtakspunktet for at styremøtene flyttes fra tirsdag til torsdag." });
    await expect(block.locator(".content-write-hint")).toHaveText("Teksten blir bare i denne nettleseren. Den sendes ikke og teller ikke.");
    await expect(block.locator(".content-write-example")).toBeHidden();

    await field.fill("Styremøtene flyttes til torsdag.");
    await block.locator(".content-write-show").click();
    await expect(block.locator(".content-write-example")).toBeVisible();
    await expect(block.locator(".content-write-example")).toContainText("Styremøtene flyttes fra tirsdag til torsdag kl. 09.00.");
    await expect(block.locator(".content-write-checklist-label")).toHaveText("Fikk du med …");
    const first = block.getByRole("checkbox", { name: "hva som ble bestemt, med dag og klokkeslett?" });
    await first.check();
    await expect(first).toBeChecked();
    await expect(block.getByRole("checkbox", { name: "fra når det gjelder?" })).not.toBeChecked();

    const stored = await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("a2.skriv.")));
    expect(stored).toHaveLength(1);

    await page.reload();
    await openSection(page);
    await expect(page.locator(".content-write-field")).toHaveValue("Styremøtene flyttes til torsdag.");

    // Tømmer deltakeren feltet, glemmes teksten.
    await page.locator(".content-write-field").fill("");
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("a2.skriv.")))).toHaveLength(0);
  });

  test("blokkert lagring (privat vindu): feltet virker, og ingen feil", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Lagringen nekter for nøklene til «skriv selv», slik et privat vindu eller en full kvote gjør.
    await page.addInitScript(() => {
      const { getItem, setItem, removeItem } = Storage.prototype;
      const guard = (key: string) => {
        if (String(key).startsWith("a2.skriv.")) throw new DOMException("blocked", "SecurityError");
      };
      Storage.prototype.getItem = function (this: Storage, key: string) { guard(key); return getItem.call(this, key); };
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) { guard(key); setItem.call(this, key, value); };
      Storage.prototype.removeItem = function (this: Storage, key: string) { guard(key); removeItem.call(this, key); };
    });
    await open(page);
    const field = page.locator(".content-write-field");
    await field.fill("Tekst");
    await expect(field).toHaveValue("Tekst");
    expect(errors).toEqual([]);
  });
});

test.describe("#1078 «Repetisjonskort» i lesevisningen", () => {
  test("musa: snur, markerer, og «øv mer»-kortet kommer igjen til slutt", async ({ page }) => {
    await open(page);
    const block = page.locator(".content-flash");
    const card = block.locator("[data-flash-card]");
    const count = block.locator(".content-flash-count");
    await expect(block).toHaveAttribute("data-ready", "true");
    await expect(card).toContainText("Vedtak");
    await expect(card).toContainText("Begrep");
    await expect(count).toHaveText("Kort 1 av 3 · klikk for å snu");
    await expect(block.locator("[data-flash-known]")).toHaveCount(0);

    await card.click();
    await expect(card).toContainText("Forklaring");
    await expect(card).toContainText("Det møtet bestemte, med ansvarlig og frist.");
    await expect(count).toHaveText("Kort 1 av 3");
    await block.getByRole("button", { name: "Øv mer" }).click();

    await expect(card).toContainText("Referent");
    await card.click();
    await block.getByRole("button", { name: "Kunne det" }).click();
    await expect(card).toContainText("Habil");
    await card.click();
    await block.getByRole("button", { name: "Kunne det" }).click();

    await expect(block.locator(".content-flash-done-title")).toHaveText("Ferdig!");
    await expect(block.locator(".content-flash-score")).toHaveText("Du kunne 2 av 3.");
    await block.getByRole("button", { name: "Øv på det igjen" }).click();

    await expect(card).toContainText("Vedtak");
    await expect(count).toHaveText("Kort 1 av 1 · klikk for å snu");
    await card.click();
    await block.getByRole("button", { name: "Kunne det" }).click();
    await expect(block.locator(".content-flash-score")).toHaveText("Du kunne 3 av 3.");
    await expect(block.locator("[data-flash-repeat]")).toHaveCount(0);

    await block.getByRole("button", { name: "Begynn på nytt" }).click();
    await expect(count).toHaveText("Kort 1 av 3 · klikk for å snu");
  });

  test("tastaturet: mellomrom og Enter snur, Tab til «Øv mer», og fokus følger kortet", async ({ page }) => {
    await open(page);
    const block = page.locator(".content-flash");
    const card = block.locator("[data-flash-card]");
    await card.focus();
    await page.keyboard.press("Space");
    await expect(card).toContainText("Forklaring");
    await expect(card).toBeFocused();
    await expect(card).toHaveAccessibleName("Vedtak: Det møtet bestemte, med ansvarlig og frist.");
    await page.keyboard.press("Enter");
    await expect(card).toContainText("Begrep");
    await expect(card).toHaveAccessibleName("Vedtak. Snu kortet");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(block.getByRole("button", { name: "Øv mer" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(card).toContainText("Referent");
    await expect(card).toBeFocused();
    // To kort til med tastaturet; da står sluttskjermen, og fokus er på «Øv på det igjen».
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press("Space");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(block.getByRole("button", { name: "Kunne det" })).toBeFocused();
      await page.keyboard.press("Enter");
    }
    await expect(block.locator(".content-flash-score")).toHaveText("Du kunne 2 av 3.");
    await expect(block.getByRole("button", { name: "Øv på det igjen" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(card).toContainText("Vedtak");
    await expect(card).toBeFocused();
  });

  test("skjermlesere: begrep og forklaring står som par i en definisjonsliste", async ({ page }) => {
    await open(page);
    const list = page.locator(".content-flash-list");
    await expect(page.getByRole("term")).toHaveCount(3);
    await expect(page.getByRole("definition")).toHaveCount(3);
    await expect(page.getByRole("term").nth(1)).toHaveText("Referent");
    // Lista er skjult for øyet, ikke for skjermleseren: den har plass på 1 × 1 px.
    const box = await list.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(1);
  });
});

test.describe("telefon (390 px)", () => {
  test("alle tre blokkene får plass, og siden rulles ikke sidelengs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.locator(".content-write-show").click();
    await page.locator("[data-flash-card]").click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Forrige, telleren og Neste står på én rad.
    const prev = await page.locator("[data-steps-prev]").boundingBox();
    const next = await page.locator("[data-steps-next]").boundingBox();
    expect(prev && next && Math.abs(prev.y - next.y)).toBeLessThan(4);
    for (const selector of [".content-steps", ".content-write", ".content-flash"]) {
      const box = await page.locator(selector).boundingBox();
      expect(box!.x + box!.width, selector).toBeLessThanOrEqual(390);
    }
    // Avkrysningsboksene får ikke full bredde av sidens regel for input.
    const checkbox = await page.locator(".content-write-checklist input").first().boundingBox();
    expect(checkbox!.width).toBeLessThan(30);
  });
});

test.describe("#1075 i forhåndsvisningen i seksjonsredigeringen", () => {
  test("teksten som settes inn etter sidelast, blir en gjennomgang som kan blas i", async ({ page }) => {
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
    await page.route("**/api/admin/content/sections", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sections: [] }) }),
    );
    await page.route("**/api/admin/content/sections/preview", (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { markdown?: string; locale?: string };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ html: renderSectionMarkdown(body.markdown ?? "", body.locale) }) });
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.goto("/admin-content/sections");
    await page.getByRole("button", { name: /Ny seksjon/ }).click();
    await page.locator("#markdownInput").fill(MD);
    await page.locator('[data-form-tab-btn="forhandsvisning"]').click();

    const block = page.locator("#previewPane .content-steps");
    await expect(block).toHaveAttribute("data-ready", "true");
    await expect(block.locator(".content-steps-count")).toContainText("Steg 1 av 3");
    await block.locator("[data-steps-next]").click();
    await expect(block.locator(".content-step").nth(1)).toBeVisible();
    await expect(block.locator(".content-steps-count")).toContainText("Steg 2 av 3");
    await expect(page.locator("#previewPane .content-flash")).toHaveAttribute("data-ready", "true");
  });
});
