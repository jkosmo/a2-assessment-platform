import { expect, test, type Page, type Route } from "@playwright/test";
import { buildMockModuleExport, mockCommonApis } from "./admin-content-helpers.js";

// #934 skive 5b: moduldialogen (doc/DESIGN_934.md, «5b»). Påstandene er på HVA som sendes, ikke på at dialogen finnes.
//
// ⚠️ Det viktigste kravet: bryteren er av i alle miljøer, og forfattere må kunne publisere som før. Serveren avgjør det. Svarer
// forhåndsvisningen `409 module_versioning_not_active` eller 404, er dialogen den gamle, uendret. Begge retninger testes.

const MODULE = "module-1";
const VERSION = "module-1-version-2";

type Course = Record<string, unknown>;
const kurs = (courseId: string, overrides: Course = {}): Course => ({
  courseId,
  title: `Kurs ${courseId}`,
  published: true,
  archived: false,
  versionMajor: 3,
  versionMinor: 1,
  certificateHolders: 10,
  majorEmailRecipients: 12,
  ...overrides,
});

const preview = (courses: Course[], overrides: Record<string, unknown> = {}) => ({
  moduleId: MODULE,
  moduleVersion: { id: VERSION, versionNo: 2, versionMajor: null, versionMinor: null },
  currentMajor: 2,
  courses,
  ...overrides,
});

type Answer = { status: number; body: unknown };
const off: Answer = { status: 409, body: { error: "module_versioning_not_active", message: "x" } };
const notFound: Answer = { status: 404, body: { error: "not_found" } };
const ok: Answer = { status: 200, body: { moduleVersion: { id: VERSION, versionNo: 2, versionMajor: 2, versionMinor: 2 }, courses: [], validationWarnings: [] } };
const on = (courses: Course[], overrides: Record<string, unknown> = {}): Answer => ({ status: 200, body: preview(courses, overrides) });

/** Svarene tas i rekkefølge; det siste gjelder resten av gangene. */
async function setup(page: Page, opts: { previews: Answer[]; publishes?: Answer[]; passedCount?: number; locale?: string }) {
  const moduleExport = buildMockModuleExport({ id: MODULE, title: "Risikovurdering", moduleVersionId: VERSION });
  const current = moduleExport.selectedConfiguration.moduleVersion;
  current.versionNo = 2;
  current.publishedAt = null;
  moduleExport.versions.moduleVersions = [
    current,
    { id: "module-1-version-1", versionNo: 1, versionMajor: 2, versionMinor: 1, createdAt: "2026-09-18T09:00:00.000Z", publishedAt: "2026-09-18T10:00:00.000Z" },
  ];
  await mockCommonApis(page, { modules: [{ id: MODULE, title: "Risikovurdering" }], moduleExports: { [MODULE]: moduleExport } });
  const calls = { previews: 0, versioned: [] as Array<Record<string, unknown>>, old: [] as Array<Record<string, unknown>>, passedCount: 0 };
  await page.route("**/api/admin/content/modules/*/passed-count", (route: Route) => {
    calls.passedCount += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ passedCount: opts.passedCount ?? 0 }) });
  });
  await page.route("**/module-versions/*/publish-preview-versioned", (route: Route) => {
    const answer = opts.previews[Math.min(calls.previews, opts.previews.length - 1)];
    calls.previews += 1;
    return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  await page.route("**/module-versions/*/publish-versioned", (route: Route) => {
    const list = opts.publishes ?? [ok];
    const answer = list[Math.min(calls.versioned.length, list.length - 1)];
    calls.versioned.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  await page.route("**/module-versions/*/publish", (route: Route) => {
    calls.old.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ moduleVersion: { id: VERSION, versionNo: 2 }, validationWarnings: [] }) });
  });
  const locale = opts.locale ?? "nb";
  await page.addInitScript((value) => { try { localStorage.setItem("participant.locale", value); } catch { /* ignore */ } }, locale);
  return calls;
}

async function clickPublish(page: Page) {
  await page.goto(`/admin-content/module/${MODULE}/conversation`);
  await page.getByRole("button", { name: /^Publiser$/ }).click();
}

const dialog = (page: Page) => page.locator("#modulePublishDialog");
const send = (page: Page) => page.locator("#modulePublishConfirm");
const seksjon = (page: Page, courseId: string) => page.locator(`#modulePublishCourses [data-course-id="${courseId}"]`);

test.describe("#934 skive 5b — bryteren av, eller gammel server: dialogen er den gamle", () => {
  for (const [navn, svar] of [["bryteren av (409)", off], ["gammel server (404)", notFound]] as const) {
    test(`${navn}: revisjonsspørsmålet stilles som før, og «Ja» går til det gamle endepunktet`, async ({ page }) => {
      const calls = await setup(page, { previews: [svar], passedCount: 3 });
      await clickPublish(page);
      await expect(page.locator("#dialogChoice")).toBeVisible();
      await expect(page.locator("#dialogChoiceBody")).toContainText("3");
      await expect(dialog(page)).toBeHidden();
      expect(calls.old).toEqual([]);
      await page.getByRole("button", { name: /Ja — erstatt tidligere bestått/ }).click();
      await expect.poll(() => calls.old.length).toBe(1);
      expect(calls.old[0]).toEqual({ supersedesEarlierPasses: true });
      expect(calls.versioned).toEqual([]);
    });

    test(`${navn}: ingen har bestått, så det publiseres uten spørsmål`, async ({ page }) => {
      const calls = await setup(page, { previews: [svar], passedCount: 0 });
      await clickPublish(page);
      await expect.poll(() => calls.old.length).toBe(1);
      expect(calls.old[0]).toEqual({ supersedesEarlierPasses: false });
      expect(calls.versioned).toEqual([]);
      await expect(dialog(page)).toBeHidden();
    });
  }

  test("bryteren går av mens dialogen står (409 ved sending): den gamle veien tar over, og ingen rå feilkode vises", async ({ page }) => {
    const calls = await setup(page, { previews: [on([kurs("a")])], publishes: [off], passedCount: 2 });
    await clickPublish(page);
    await expect(dialog(page)).toBeVisible();
    await send(page).click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    await expect(page.locator("#dialogChoice")).toBeVisible();
    await expect(page.locator("#dialogChoiceBody")).toContainText("2");
    await expect(page.locator("#dialogChoiceBody")).not.toContainText("module_versioning_not_active");
    await page.getByRole("button", { name: /Nei — tidligere bestått gjelder fortsatt/ }).click();
    await expect.poll(() => calls.old.length).toBe(1);
    expect(calls.old[0]).toEqual({ supersedesEarlierPasses: false });
  });

  test("gammel server ved sending (404): den gamle veien tar over", async ({ page }) => {
    const calls = await setup(page, { previews: [on([kurs("a")])], publishes: [notFound], passedCount: 0 });
    await clickPublish(page);
    await send(page).click();
    await expect.poll(() => calls.old.length).toBe(1);
    expect(calls.old[0]).toEqual({ supersedesEarlierPasses: false });
  });

  test("en annen feil på forhåndsvisningen: forfatteren får vite det, ingenting publiseres, og «prøv igjen» leser på nytt", async ({ page }) => {
    const calls = await setup(page, {
      previews: [{ status: 500, body: { error: "internal_error", message: "boom" } }, on([kurs("a")])],
      passedCount: 3,
    });
    await clickPublish(page);
    await expect(page.locator("#dialogChoice")).toBeVisible();
    await expect(page.locator("#dialogChoiceBody")).not.toContainText("internal_error");
    expect(calls.old).toEqual([]);
    expect(calls.versioned).toEqual([]);
    await page.locator("#dialogChoiceActions button").first().click();
    await expect(dialog(page)).toBeVisible();
    expect(calls.old).toEqual([]);
  });
});

test.describe("#934 skive 5b — bryteren på", () => {
  test("mindre er valgt fra start og sender bare det; den gamle dialogen og det gamle endepunktet brukes ikke", async ({ page }) => {
    const calls = await setup(page, { previews: [on([kurs("a"), kurs("b")])], passedCount: 3 });
    await clickPublish(page);
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('input[name="moduleVersionKind"][value="minor"]')).toBeChecked();
    await expect(page.locator("#modulePublishCoursesBlock")).toBeHidden();
    await send(page).click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toEqual({ moduleVersion: "minor" });
    expect(calls.old).toEqual([]);
    expect(calls.passedCount).toBe(0);
    await expect(dialog(page)).toBeHidden();
  });

  test("to kurs, hoved på det ene, ett uten kursbevis: riktig kall", async ({ page }) => {
    const calls = await setup(page, {
      previews: [on([
        kurs("a", { title: "Kurs A", certificateHolders: 10, majorEmailRecipients: 12 }),
        kurs("b", { title: "Kurs B", certificateHolders: 1, majorEmailRecipients: 1, published: false }),
        kurs("c", { title: "Kurs C", certificateHolders: 0, majorEmailRecipients: 0, archived: true, published: false }),
      ])],
    });
    await clickPublish(page);
    await page.locator('input[name="moduleVersionKind"][value="major"]').check();
    await expect(page.locator("#modulePublishCoursesBlock")).toBeVisible();

    // Tallene kommer fra serveren.
    await expect(seksjon(page, "a")).toContainText("10 deltakere har kursbevis");
    await expect(seksjon(page, "a")).toContainText("12 deltakere får e-post ved hovedversjon");
    await expect(seksjon(page, "b")).toContainText("1 deltaker har kursbevis");
    await expect(seksjon(page, "b")).toContainText("1 deltaker får e-post ved hovedversjon");
    await expect(seksjon(page, "b")).toContainText("Avpublisert");
    await expect(seksjon(page, "c")).toContainText("Arkivert");

    // Mindre er valgt i hvert kurs, og et kurs uten kursbevis har ingen knapper: svaret der ville ikke bety noe.
    await expect(seksjon(page, "a").locator('input[value="minor"]')).toBeChecked();
    await expect(seksjon(page, "b").locator('input[value="minor"]')).toBeChecked();
    await expect(seksjon(page, "c").locator("input")).toHaveCount(0);
    await expect(seksjon(page, "c")).toContainText("Kurset får mindre versjon");

    await seksjon(page, "a").locator('input[value="major"]').check();
    await expect(seksjon(page, "a").locator("[data-version-consequence]")).toContainText("12 deltakere får en e-post om versjon 4.0.");
    await expect(seksjon(page, "b").locator("[data-version-consequence]")).not.toContainText("e-post");

    await send(page).click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toEqual({
      moduleVersion: "major",
      courseVersions: { a: "major", b: "minor" },
      expectedCourseIds: ["a", "b", "c"],
      confirmEmailRecipients: { a: 12 },
    });
  });

  test("hoved uten kurs: sier hva som skjer, og sender et tomt sett", async ({ page }) => {
    const calls = await setup(page, { previews: [on([])] });
    await clickPublish(page);
    await page.locator('input[name="moduleVersionKind"][value="major"]').check();
    await expect(page.locator("#modulePublishCoursesIntro")).toContainText("ikke i noe kurs");
    await send(page).click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toEqual({ moduleVersion: "major", courseVersions: {}, expectedCourseIds: [] });
  });

  test("tilbake til mindre: svarene per kurs sendes ikke, og lista er skjult", async ({ page }) => {
    const calls = await setup(page, { previews: [on([kurs("a")])] });
    await clickPublish(page);
    await page.locator('input[name="moduleVersionKind"][value="major"]').check();
    await seksjon(page, "a").locator('input[value="major"]').check();
    await page.locator('input[name="moduleVersionKind"][value="minor"]').check();
    await expect(page.locator("#modulePublishCoursesBlock")).toBeHidden();
    await send(page).click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toEqual({ moduleVersion: "minor" });
  });

  test("over 200 mottakere: uten det ekstra «ja» sendes ingenting; fokus går til det første som mangler", async ({ page }) => {
    const calls = await setup(page, {
      previews: [on([
        kurs("a", { certificateHolders: 300, majorEmailRecipients: 301 }),
        kurs("b", { certificateHolders: 250, majorEmailRecipients: 250 }),
        kurs("c", { certificateHolders: 400, majorEmailRecipients: 400 }),
      ])],
    });
    await clickPublish(page);
    await page.locator('input[name="moduleVersionKind"][value="major"]').check();
    await seksjon(page, "a").locator('input[value="major"]').check();
    await seksjon(page, "b").locator('input[value="major"]').check();
    // Kurs c har over 200, men svaret er mindre. Da trengs ingen bekreftelse.
    await send(page).click();
    await expect(dialog(page)).toBeVisible();
    expect(calls.versioned).toEqual([]);
    await expect(seksjon(page, "a").locator("[data-email-confirm-missing]")).toBeVisible();
    await expect(seksjon(page, "b").locator("[data-email-confirm-missing]")).toBeVisible();
    await expect(seksjon(page, "a").locator("[data-email-confirm]")).toBeFocused();

    await seksjon(page, "a").locator("[data-email-confirm]").check();
    await send(page).click();
    await expect(dialog(page)).toBeVisible();
    expect(calls.versioned).toEqual([]);

    await seksjon(page, "b").locator("[data-email-confirm]").check();
    await send(page).click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toEqual({
      moduleVersion: "major",
      courseVersions: { a: "major", b: "major", c: "minor" },
      expectedCourseIds: ["a", "b", "c"],
      confirmEmailRecipients: { a: 301, b: 250 },
    });
  });

  test("en versjon som har nummer: ikke noe valg, den sendes som mindre", async ({ page }) => {
    const calls = await setup(page, { previews: [on([kurs("a")], { moduleVersion: { id: VERSION, versionNo: 2, versionMajor: 2, versionMinor: 1 } })] });
    await clickPublish(page);
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toEqual({ moduleVersion: "minor" });
    await expect(dialog(page)).toBeHidden();
  });

  test("ingen har bestått: ikke noe valg, den sendes som mindre", async ({ page }) => {
    const calls = await setup(page, { previews: [on([kurs("a")], { anyonePassed: false })] });
    await clickPublish(page);
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toEqual({ moduleVersion: "minor" });
    await expect(dialog(page)).toBeHidden();
  });

  test("første publisering: ikke noe valg", async ({ page }) => {
    const calls = await setup(page, { previews: [on([], { currentMajor: null })] });
    await clickPublish(page);
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toEqual({ moduleVersion: "minor" });
    await expect(dialog(page)).toBeHidden();
  });

  for (const [navn, svar] of [
    ["et kurs fikk kursbevis (400 course_version_required)", { status: 400, body: { error: "course_version_required", message: "x", details: { courses: [{ courseId: "b", certificateHolders: 1 }] } } }],
    ["settet er endret (409 affected_courses_changed)", { status: 409, body: { error: "affected_courses_changed", message: "x", details: { currentCourseIds: ["a", "b"] } } }],
    ["tallet er endret (409 major_email_confirm_required)", { status: 409, body: { error: "major_email_confirm_required", message: "x", details: { majorEmailRecipients: 251 } } }],
  ] as const) {
    test(`${navn}: dialogen vises på nytt med ferske tall, sier fra, og svarene gis på nytt`, async ({ page }) => {
      const calls = await setup(page, {
        previews: [on([kurs("a"), kurs("b", { certificateHolders: 0, majorEmailRecipients: 0 })]), on([kurs("a", { certificateHolders: 11, majorEmailRecipients: 13 }), kurs("b", { certificateHolders: 1, majorEmailRecipients: 1 })])],
        publishes: [svar, ok],
      });
      await clickPublish(page);
      await page.locator('input[name="moduleVersionKind"][value="major"]').check();
      await seksjon(page, "a").locator('input[value="major"]').check();
      await send(page).click();
      await expect.poll(() => calls.versioned.length).toBe(1);
      expect(calls.versioned[0]).toEqual({ moduleVersion: "major", courseVersions: { a: "major" }, expectedCourseIds: ["a", "b"], confirmEmailRecipients: { a: 12 } });

      await expect(dialog(page)).toBeVisible();
      await expect(page.locator("#modulePublishNotice")).toBeVisible();
      await expect(page.locator("#modulePublishNotice")).toContainText("Ingenting ble publisert");
      await expect(dialog(page)).not.toContainText(svar.body.error);
      // Hovedversjonen står, og hvert kurs er tilbake på mindre med de nye tallene.
      await expect(page.locator('input[name="moduleVersionKind"][value="major"]')).toBeChecked();
      await expect(page.locator("#modulePublishCoursesBlock")).toBeVisible();
      await expect(seksjon(page, "a")).toContainText("11 deltakere har kursbevis");
      await expect(seksjon(page, "a").locator('input[value="minor"]')).toBeChecked();
      await expect(seksjon(page, "b").locator('input[value="minor"]')).toBeChecked();

      await seksjon(page, "b").locator('input[value="major"]').check();
      await send(page).click();
      await expect.poll(() => calls.versioned.length).toBe(2);
      expect(calls.versioned[1]).toEqual({ moduleVersion: "major", courseVersions: { a: "minor", b: "major" }, expectedCourseIds: ["a", "b"], confirmEmailRecipients: { b: 1 } });
    });
  }

  test("publiseringsporten stopper (422): oversettelsesgaten vises, som før", async ({ page }) => {
    const calls = await setup(page, {
      previews: [on([kurs("a")])],
      publishes: [{ status: 422, body: { error: "publish_blocked_by_validation", issues: [{ code: "translation_incomplete", severity: "blocking", field: "title", missingLocales: ["nn"] }] } }],
    });
    await clickPublish(page);
    await send(page).click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator("#dialogChoice")).toBeVisible();
    await expect(page.locator("#dialogChoiceBody")).toContainText("nn");
    expect(calls.old).toEqual([]);
  });

  test("en versjon som ikke kan publiseres: lokalisert tekst, ikke rå kode", async ({ page }) => {
    const calls = await setup(page, {
      previews: [on([kurs("a")], { moduleVersion: { id: VERSION, versionNo: 2, versionMajor: 1, versionMinor: 3 } })],
      publishes: [{ status: 409, body: { error: "module_version_outdated", message: "x" } }],
    });
    await clickPublish(page);
    await expect.poll(() => calls.versioned.length).toBe(1);
    await expect(page.locator("#dialogChoiceBody")).toContainText("eldre hovedversjon");
    await expect(page.locator("#dialogChoiceBody")).not.toContainText("module_version_outdated");
  });

  test("Avbryt og Esc: ingenting sendes, og neste åpning starter på mindre med ett kall per klikk", async ({ page }) => {
    const calls = await setup(page, { previews: [on([kurs("a")])] });
    await clickPublish(page);
    await page.locator('input[name="moduleVersionKind"][value="major"]').check();
    await page.locator("#modulePublishCancel").click();
    await expect(dialog(page)).toBeHidden();

    await page.getByRole("button", { name: /^Publiser$/ }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('input[name="moduleVersionKind"][value="minor"]')).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    expect(calls.versioned).toEqual([]);
    expect(calls.old).toEqual([]);

    await page.getByRole("button", { name: /^Publiser$/ }).click();
    await expect(dialog(page)).toBeVisible();
    await send(page).click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    await expect(dialog(page)).toBeHidden();
    await page.waitForTimeout(150);
    expect(calls.versioned).toHaveLength(1);
  });

  test("to klikk på «Publiser» mens forhåndsvisningen er på vei: ett oppslag og én dialog", async ({ page }) => {
    await setup(page, { previews: [on([kurs("a")])] });
    let oppslag = 0;
    await page.route("**/module-versions/*/publish-preview-versioned", async (route: Route) => {
      oppslag += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(preview([kurs("a")])) });
    });
    await page.goto(`/admin-content/module/${MODULE}/conversation`);
    await page.getByRole("button", { name: /^Publiser$/ }).dblclick();
    await expect(dialog(page)).toBeVisible();
    await page.waitForTimeout(500);
    expect(oppslag).toBe(1);
  });

  test("en kurstittel med HTML vises som tekst", async ({ page }) => {
    await setup(page, { previews: [on([kurs("a", { title: '<img src=x onerror="window.__xss=1">' })])] });
    await clickPublish(page);
    await page.locator('input[name="moduleVersionKind"][value="major"]').check();
    await expect(seksjon(page, "a").locator(".course-version-course-title")).toContainText("<img src=x");
    await expect(seksjon(page, "a").locator("img")).toHaveCount(0);
  });

  for (const [locale, tittel, mindre] of [
    ["en-GB", "Publish a new version of the module", "Nobody has a course certificate"],
    ["nb", "Publiser en ny versjon av modulen", "Ingen har kursbevis"],
    ["nn", "Publiser ein ny versjon av modulen", "Ingen har kursbevis"],
  ] as const) {
    test(`teksten finnes på ${locale}, uten rå nøkler`, async ({ page }) => {
      await setup(page, { previews: [on([kurs("a", { certificateHolders: 300, majorEmailRecipients: 301 }), kurs("b", { certificateHolders: 0, majorEmailRecipients: 0 })])], locale });
      await page.goto(`/admin-content/module/${MODULE}/conversation`);
      await page.locator('[data-action-key="publish"], button').filter({ hasText: /^(Publish|Publiser)$/ }).first().click();
      await expect(page.locator("#modulePublishTitle")).toHaveText(tittel);
      await page.locator('input[name="moduleVersionKind"][value="major"]').check();
      await seksjon(page, "a").locator('input[value="major"]').check();
      await send(page).click();
      await expect(seksjon(page, "b")).toContainText(mindre);
      const tekst = await dialog(page).innerText();
      expect(tekst).not.toMatch(/courses\.version\.|shell\.publish\.|shell\.action\.|\{n\}|\{next\}/);
    });
  }
});

test.describe("#934 skive 5b — liten skjerm", () => {
  const LANG = "Et svært langt kursnavn som går over flere linjer på en liten skjerm og fortsetter enda litt til";
  const ORD = "Etsværtlangtordutenmellomromsomikkekanbrekkepåvanligmåteogsomfortsetterogfortsetter";

  for (const bredde of [390, 360]) {
    test(`${bredde} px: dialogen flyter ikke over, med lange kurstitler og det ekstra «ja»`, async ({ page }) => {
      await page.setViewportSize({ width: bredde, height: 780 });
      const calls = await setup(page, {
        previews: [on([
          kurs("a", { title: LANG, certificateHolders: 1250, majorEmailRecipients: 1250 }),
          kurs("b", { title: ORD, certificateHolders: 3, majorEmailRecipients: 3, published: false }),
          kurs("c", { title: ORD, certificateHolders: 0, majorEmailRecipients: 0, archived: true }),
        ])],
      });
      await clickPublish(page);
      await page.locator('input[name="moduleVersionKind"][value="major"]').check();
      await seksjon(page, "a").locator('input[value="major"]').check();
      await seksjon(page, "b").locator('input[value="major"]').check();
      await send(page).click();
      await expect(seksjon(page, "a").locator("[data-email-confirm-missing]")).toBeVisible();

      const el = dialog(page);
      expect(await el.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
      // Hvert element i dialogen, ikke bare dialogen: `overflow: auto` kan skjule det som stikker ut.
      const stikkerUt = await el.evaluate((node, viewport) => {
        const box = node.getBoundingClientRect();
        return [...node.querySelectorAll("*")]
          .filter((child) => child.getClientRects().length > 0)
          .filter((child) => {
            const rect = child.getBoundingClientRect();
            return rect.right > box.right + 0.5 || rect.left < box.left - 0.5 || rect.right > viewport;
          })
          .map((child) => `${child.tagName}.${child.className}`);
      }, bredde);
      expect(stikkerUt).toEqual([]);
      const box = await el.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bredde);

      // Knappene kan nås, og «ja» kan krysses av.
      await seksjon(page, "a").locator("[data-email-confirm]").check();
      await send(page).scrollIntoViewIfNeeded();
      await send(page).click();
      await expect.poll(() => calls.versioned.length).toBe(1);
      expect(calls.versioned[0]).toMatchObject({ confirmEmailRecipients: { a: 1250, b: 3 } });
    });
  }
});
