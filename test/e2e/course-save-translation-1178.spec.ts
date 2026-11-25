import { test, expect, type Page, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1178 (prinsipp 3, doc/DECISIONS.md «felles prinsipper»): kurset oversettes ved «Lagre» bare for feltene som er endret, fra
// språket som ble endret, som seksjonene (#1163). Før oversatte hver lagring navn og beskrivelse til de andre språkene, også når
// ingen tekst var endret, og skrev over manuelle rettelser.

type Map3 = { nb: string; nn: string; "en-GB": string };
const navn: Map3 = { nb: "Fagforeninger", nn: "Fagforeiningar", "en-GB": "Trade unions" };
// Den engelske beskrivelsen er rettet for hånd; en ny maskinoversetting ville tatt rettelsen bort.
const beskrivelse: Map3 = { nb: "Norsk beskrivelse", nn: "Nynorsk skildring", "en-GB": "Hand-corrected English description" };

function kurs() {
  return {
    id: "course-1",
    title: { ...navn },
    description: { ...beskrivelse },
    certificationLevel: "basic",
    moduleCount: 0,
    updatedAt: "2026-04-18T10:30:00.000Z",
    modules: [],
  };
}

type Oversettingskall = { title?: string; description?: string; sourceLocale?: string; targetLocale?: string };

/** Svarer på oversettingene og husker dem. `feilFor`: målspråk som svarer 500. Registrert etter mockCommonApis, så den vinner. */
async function oversetter(page: Page, { feilFor = [] as string[] } = {}) {
  const kall: Oversettingskall[] = [];
  await page.route("**/api/admin/content/courses/localize-copy", async (route: Route) => {
    const body = route.request().postDataJSON() as Oversettingskall;
    kall.push(body);
    if (body.targetLocale && feilFor.includes(body.targetLocale)) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "translation_failed" }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...(body.title ? { title: `${body.title} [${body.targetLocale}]` } : {}),
        ...(body.description ? { description: `${body.description} [${body.targetLocale}]` } : {}),
      }),
    });
  });
  return kall;
}

async function lagreOgVent(page: Page) {
  const lagret = page.waitForResponse((res) => res.url().endsWith("/courses/course-1/content") && res.request().method() === "PUT");
  await page.locator("#formSaveBtn").click();
  return (await lagret).request().postDataJSON() as { title?: Record<string, string>; description?: Record<string, string> };
}

test.describe("#1178 — kurset oversetter bare det som er endret", () => {
  test("en lagring uten endret tekst oversetter ingenting og beholder rettelsene", async ({ page }) => {
    await mockCommonApis(page, { courses: [kurs()] });
    const kall = await oversetter(page);

    await page.goto("/admin-content/courses/course-1");
    await expect(page.locator("#title-nb")).toHaveValue("Fagforeninger");
    // En innstilling, ikke tekst.
    await page.locator("#certLevel").selectOption("intermediate");
    const sendt = await lagreOgVent(page);

    expect(kall, "ingen KI-kall når navn og beskrivelse er uendret").toEqual([]);
    expect(sendt.title).toEqual(navn);
    expect(sendt.description, "den rettede engelske beskrivelsen står").toEqual(beskrivelse);
  });

  test("bare navnet er endret: bare navnet oversettes, beskrivelsen er urørt", async ({ page }) => {
    await mockCommonApis(page, { courses: [kurs()] });
    const kall = await oversetter(page);

    await page.goto("/admin-content/courses/course-1");
    await page.locator('[data-form-locale="nb"]').click();
    await page.locator("#title-nb").fill("Fagforeninger i dag");
    const sendt = await lagreOgVent(page);

    expect(kall.map((k) => `${k.sourceLocale}>${k.targetLocale}`).sort()).toEqual(["nb>en-GB", "nb>nn"]);
    expect(kall.every((k) => k.title === "Fagforeninger i dag" && k.description === undefined), "beskrivelsen sendes ikke").toBe(true);
    expect(sendt.title).toEqual({ nb: "Fagforeninger i dag", nn: "Fagforeninger i dag [nn]", "en-GB": "Fagforeninger i dag [en-GB]" });
    expect(sendt.description).toEqual(beskrivelse);
    // Skjemaet viser det som ble lagret.
    await expect(page.locator("#title-nn")).toHaveValue("Fagforeninger i dag [nn]");
  });

  test("to språk endret i samme lagring: begge står, det tredje oversettes fra språket forfatteren står i", async ({ page }) => {
    await mockCommonApis(page, { courses: [kurs()] });
    const kall = await oversetter(page);

    await page.goto("/admin-content/courses/course-1");
    await page.locator('[data-form-locale="nb"]').click();
    await page.locator("#title-nb").fill("Fagforeninger i dag");
    await page.locator('[data-form-locale="en-GB"]').click();
    await page.locator("#title-en-GB").fill("Trade unions today");
    const sendt = await lagreOgVent(page);

    expect(kall.map((k) => `${k.sourceLocale}>${k.targetLocale}`)).toEqual(["en-GB>nn"]);
    expect(sendt.title).toEqual({ nb: "Fagforeninger i dag", nn: "Trade unions today [nn]", "en-GB": "Trade unions today" });
  });

  test("en oversetting som feiler, står tom og meldes; den gamle teksten blir ikke stående", async ({ page }) => {
    await mockCommonApis(page, { courses: [kurs()] });
    const kall = await oversetter(page, { feilFor: ["nn"] });

    await page.goto("/admin-content/courses/course-1");
    await page.locator('[data-form-locale="nb"]').click();
    await page.locator("#title-nb").fill("Fagforeninger i dag");
    const sendt = await lagreOgVent(page);

    expect(kall).toHaveLength(2);
    // Den gamle nynorsktittelen er en oversettelse av et navn som ikke står der lenger.
    expect(sendt.title).toEqual({ nb: "Fagforeninger i dag", "en-GB": "Fagforeninger i dag [en-GB]" });
    await expect(page.getByText(/oversettelsen kom ikke for: nn|translation did not arrive for: nn/i)).toBeVisible();
  });

  test("feiler oversettingen TIL bokmål, står det lagrede bokmålsnavnet, så lagringen ikke stopper", async ({ page }) => {
    await mockCommonApis(page, { courses: [kurs()] });
    await oversetter(page, { feilFor: ["nb"] });

    await page.goto("/admin-content/courses/course-1");
    await page.locator('[data-form-locale="en-GB"]').click();
    await page.locator("#title-en-GB").fill("Trade unions today");
    const sendt = await lagreOgVent(page);

    expect(sendt.title).toEqual({ nb: "Fagforeninger", nn: "Trade unions today [nn]", "en-GB": "Trade unions today" });
    await expect(page.getByText(/oversettelsen kom ikke for: nb|translation did not arrive for: nb/i)).toBeVisible();
  });
});
