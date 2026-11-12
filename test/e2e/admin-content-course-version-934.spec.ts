import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// #934 skive 3: «Hva slags endring er dette?» Produkteier 2026-11-01 (doc/DESIGN_934.md): når innholdet i
// et publisert kurs endres, velger forfatteren mindre versjon eller hovedversjon, og grensesnittet skal gjøre
// konsekvensen tydelig. Standard er mindre — et feiltrykk skal ikke ta kursbeviset fra noen. Har ingen
// kursbevis, stilles ikke spørsmålet. Alt dette er klientlaget: dialogen, valget, og hva lagringen sender.

const COURSE = "/admin-content/courses/course-1";

const ITEMS = [
  { id: "ci-1", type: "MODULE", sortOrder: 0, moduleId: "mod-a", sectionId: null, title: "Modul A", discussionsEnabled: true, archivedAt: null },
  { id: "ci-2", type: "SECTION", sortOrder: 1, moduleId: null, sectionId: "sec-b", title: "Seksjon B", discussionsEnabled: true, archivedAt: null },
];

function course(overrides: Record<string, unknown> = {}) {
  return {
    id: "course-1",
    title: { "en-GB": "Generativ KI", nb: "Generativ KI", nn: "Generativ KI" },
    description: null,
    certificationLevel: "basic",
    moduleCount: 1,
    updatedAt: "2026-10-11T12:00:00.000Z",
    publishedAt: "2026-10-11T12:00:00.000Z",
    archivedAt: null,
    modules: [],
    versionMajor: 3,
    versionMinor: 1,
    certificateHolders: 42,
    // #934 skive 4a: telleren skjemaet sender tilbake.
    contentRevision: 5,
    ...overrides,
  };
}

// #1140 etappe 2 (skive 2c): kursbyggeren lagrer et PUBLISERT kurs til utkastet, uten spørsmål om versjon; spørsmålet stilles
// når utkastet publiseres (test/e2e/admin-content-course-draft-1140.spec.ts). Direkte lagring med spørsmålet gjelder fortsatt
// et kurs som har vært ute og er avpublisert (kursbevis finnes). Testene her bruker derfor et slikt kurs som standard.
async function openCourse(page: Page, overrides: Record<string, unknown> = {}) {
  await mockCommonApis(page, { courses: [course({ publishedAt: null, ...overrides }) as never], libraryModules: [] });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  const sentItems: Array<Record<string, unknown>> = [];
  const sentCourse: Array<Record<string, unknown>> = [];
  await page.route("**/api/admin/content/courses/*/items", async (route: Route) => {
    if (route.request().method() === "PUT") {
      sentItems.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: ITEMS }) });
  });
  await page.route("**/api/admin/content/courses/course-1", async (route: Route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sentCourse.push(body);
    // Den gamle ruta tar ikke imot innhold (den ignorerer det). Endret innhold skal til …/content.
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "course-1" } }) });
  });
  // #934 skive 3: endret innhold lagres med navnet i ett kall til det egne endepunktet.
  await page.route("**/api/admin/content/courses/course-1/content", async (route: Route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sentCourse.push(body);
    sentItems.push({ items: body.items, ...(body.version ? { version: body.version } : {}) });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "course-1" } }) });
  });
  await page.goto(COURSE);
  await expect(page.locator("#moduleList li")).toHaveCount(2);
  return { sentItems, sentCourse };
}

test.describe("#934 skive 3 — mindre eller hovedversjon", () => {
  test("innhold endret i et kurs med kursbevis: spørsmålet, konsekvensen, og hovedversjon sendes bare når den er valgt", async ({ page }) => {
    const { sentItems, sentCourse } = await openCourse(page);
    // Versjonen står ved statusen i hodet.
    await expect(page.locator(".form-page-state .course-version-chip")).toHaveText("v3.1");

    await page.locator('[data-move="down"][data-index="0"]').click();
    await page.locator("#formSaveBtn").click();

    const dialog = page.locator("#courseVersionDialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#courseVersionTitle")).toHaveText("Hva slags endring er dette?");
    await expect(page.locator("#courseVersionText")).toHaveText(
      "«Generativ KI» er publisert som versjon 3.1. 42 deltakere har kursbevis for versjon 3. Endringen: 1 flyttet.",
    );
    // Standard er mindre, med konsekvensen skrevet ut.
    await expect(dialog.locator('input[value="minor"]')).toBeChecked();
    await expect(dialog.locator('input[value="minor"]')).toBeFocused();
    await expect(dialog).toContainText("Mindre versjon — blir 3.2");
    await expect(dialog).toContainText("Hovedversjon — blir 4.0");
    await expect(dialog.locator("[data-version-consequence]")).toHaveText(/Ingen konsekvens for deltakerne/);
    await expect(page.locator("#courseVersionSaveBtn")).toHaveText("Lagre som 3.2");

    await dialog.locator('input[value="major"]').check();
    const konsekvens = dialog.locator("[data-version-consequence]");
    await expect(konsekvens).toContainText("Dette skjer med versjon 4.0:");
    await expect(konsekvens).toContainText("De som har kursbevis for versjon 3, beholder det, men står ikke som fullført i versjon 4.0");
    await expect(konsekvens).toContainText("en seksjon som er endret siden versjon 3, leses på nytt");
    await expect(konsekvens).toContainText("«Må ta ny versjon»");
    await expect(page.locator("#courseVersionSaveBtn")).toHaveText("Lagre som 4.0");
    // Ingenting er sendt før forfatteren har svart.
    expect(sentItems).toHaveLength(0);
    expect(sentCourse).toHaveLength(0);

    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => sentItems.length).toBe(1);
    expect(sentItems[0]).toMatchObject({ version: "major" });
    expect((sentItems[0].items as Array<{ moduleId?: string; sectionId?: string }>).map((i) => i.moduleId ?? i.sectionId)).toEqual(["sec-b", "mod-a"]);
    // Navn og innhold i ÉTT kall: serveren avgjør versjonen én gang, ingen klient kan slå den av.
    expect(sentCourse).toHaveLength(1);
    expect(sentCourse[0]).toMatchObject({ title: expect.anything(), version: "major" });
    expect(sentCourse[0]).not.toHaveProperty("skipVersionBump");
    await expect(dialog).toBeHidden();
  });

  test("mindre er standard: «Lagre som 3.2» sender mindre", async ({ page }) => {
    const { sentItems } = await openCourse(page);
    await page.locator('[data-remove="1"]').click();
    await page.locator("#formSaveBtn").click();
    await expect(page.locator("#courseVersionText")).toContainText("Endringen: 1 tatt ut.");
    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => sentItems.length).toBe(1);
    expect(sentItems[0]).toMatchObject({ version: "minor" });
  });

  test("Avbryt og Esc lagrer ingenting — og skjemaet står ulagret", async ({ page }) => {
    const { sentItems, sentCourse } = await openCourse(page);
    await page.locator('[data-move="down"][data-index="0"]').click();

    await page.locator("#formSaveBtn").click();
    await expect(page.locator("#courseVersionDialog")).toBeVisible();
    await page.locator("#courseVersionCancelBtn").click();
    await expect(page.locator("#courseVersionDialog")).toBeHidden();

    await page.locator("#formSaveBtn").click();
    await expect(page.locator("#courseVersionDialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#courseVersionDialog")).toBeHidden();

    expect(sentItems).toHaveLength(0);
    expect(sentCourse).toHaveLength(0);
    await expect(page.locator("#formSaveBtn")).toBeEnabled();
  });

  test("har noen fått kursbevis siden kurset ble åpnet, sier feilen hva forfatteren skal gjøre", async ({ page }) => {
    await openCourse(page, { certificateHolders: 0 });
    await page.route("**/api/admin/content/courses/course-1/content", (route: Route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "course_version_required", message: "x", details: { certificateHolders: 1 } }) }));
    await page.locator('[data-move="down"][data-index="0"]').click();
    await page.locator("#formSaveBtn").click();
    await expect(page.locator("#formErrorBanner")).toContainText("Last kurset på nytt og velg mindre versjon eller hovedversjon");
  });

  test("ingen har kursbevis: ingen spørsmål, og ikke noe svar i kallet (tjeneren gir mindre)", async ({ page }) => {
    const { sentItems } = await openCourse(page, { certificateHolders: 0 });
    await page.locator('[data-move="down"][data-index="0"]').click();
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => sentItems.length).toBe(1);
    await expect(page.locator("#courseVersionDialog")).toBeHidden();
    expect(sentItems[0]).not.toHaveProperty("version");
  });

  test("innholdet uendret: ingen spørsmål, og navnet kan gi sin egen mindre versjon", async ({ page }) => {
    const { sentItems, sentCourse } = await openCourse(page);
    await page.locator("#title-nb").fill("Generativ KI for alle");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => sentItems.length).toBe(1);
    await expect(page.locator("#courseVersionDialog")).toBeHidden();
    expect(sentItems[0]).not.toHaveProperty("version");
    expect(sentCourse[0]).not.toHaveProperty("version");
    // #934 skive 4a: også med uendret innhold går alt i ÉTT kall til …/content, med elementene og telleren
    // skjemaet lastet. Markøren fra overgangen (versionAware) sendes ikke lenger.
    expect(sentCourse).toHaveLength(1);
    expect((sentCourse[0].items as unknown[]).length).toBe(2);
    expect(sentCourse[0]).toMatchObject({ expectedRevision: 5 });
    expect(sentCourse[0]).not.toHaveProperty("versionAware");
  });

  test("et avpublisert kurs med kursbevis spørres også — det har vært ute", async ({ page }) => {
    const { sentItems } = await openCourse(page, { publishedAt: null });
    await page.locator('[data-move="down"][data-index="0"]').click();
    await page.locator("#formSaveBtn").click();
    await expect(page.locator("#courseVersionDialog")).toBeVisible();
    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => sentItems.length).toBe(1);
    expect(sentItems[0]).toMatchObject({ version: "minor" });
  });

  test("navn og innhold lagres i ÉTT kall — aldri et eget PUT …/items for et eksisterende kurs", async ({ page }) => {
    const { sentCourse } = await openCourse(page);
    let itemsCalls = 0;
    await page.route("**/api/admin/content/courses/*/items", async (route: Route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      itemsCalls += 1;
      await route.fulfill({ status: 204, body: "" });
    });
    await page.locator("#title-nb").fill("Generativ KI — nytt navn");
    await page.locator('[data-move="down"][data-index="0"]').click();
    await page.locator("#formSaveBtn").click();
    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => sentCourse.length).toBe(1);
    expect(sentCourse[0]).toMatchObject({ version: "minor" });
    expect((sentCourse[0].title as Record<string, string>).nb).toBe("Generativ KI — nytt navn");
    expect((sentCourse[0].items as unknown[]).length).toBe(2);
    expect(itemsCalls).toBe(0);
  });

  test("kurslista viser versjonen ved statusen", async ({ page }) => {
    await mockCommonApis(page, { courses: [course() as never, course({ id: "course-2", title: "Utkast", publishedAt: null, versionMajor: 1, versionMinor: 0 }) as never], libraryModules: [] });
    await page.goto("/admin-content/courses");
    await expect(page.locator('tr[data-row-id="course-1"] .course-version-chip, [data-id="course-1"] .course-version-chip').first()).toHaveText("v3.1");
  });
});

test.describe("#934 skive 3 — «Publiser kurs» spør for kurset når nytt innhold går live", () => {
  async function setup(page: Page, courseInfo: Record<string, unknown>) {
    await mockCommonApis(page, { courses: [course({ publishedAt: null }) as never], libraryModules: [] });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.route("**/api/admin/content/courses/*/publish-preview", (route: Route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courseId: "course-1",
        allPublished: false,
        publishable: true,
        unpublishedItems: [{ type: "SECTION", id: "sec-1", title: "Kilder", publishable: true, blockers: [] }],
        course: courseInfo,
      }),
    }));
    const sent: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/courses/course-1/publish", async (route: Route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "course-1" }, publishedItems: [] }) });
    });
    await page.goto("/admin-content/courses");
    await page.locator('tr[data-row-id="course-1"] [data-action="publish"], #coursesTableBody tr [data-action="publish"]').first().click();
    await expect(page.locator("#cascadePublishDialog")).toBeVisible();
    return sent;
  }

  test("kursbevis finnes: samme valg som i skjemaet, mindre som standard, hovedversjon sendes når valgt", async ({ page }) => {
    const sent = await setup(page, { published: false, versionMajor: 3, versionMinor: 1, certificateHolders: 4 });
    const block = page.locator("#cascadePublishVersion");
    await expect(block).toBeVisible();
    await expect(block).toContainText("4 deltakere har kursbevis for versjon 3.");
    await expect(block.locator('input[value="minor"]')).toBeChecked();
    await block.locator('input[value="major"]').check();
    await page.locator("#cascadePublishConfirmBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ publishItems: true, courseVersion: "major" });
  });

  test("uten kursbevis: ikke noe valg, og ikke noe svar i kallet", async ({ page }) => {
    const sent = await setup(page, { published: false, versionMajor: 1, versionMinor: 0, certificateHolders: 0 });
    await expect(page.locator("#cascadePublishVersion")).toBeHidden();
    await page.locator("#cascadePublishConfirmBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ publishItems: true });
  });
});

test.describe("#934 skive 3 — «Publiser nye versjoner» spør for kurset", () => {
  const pending = (courseInfo: Record<string, unknown>) => ({
    courseId: "course-1",
    items: [{ type: "SECTION", id: "sec-1", title: "Kilder", versionId: "sec-1-v2", isNew: false, publishable: true, blockers: [], passedCount: 0 }],
    notOwnedItems: [],
    publishable: true,
    passedTotal: 0,
    modulesWithPasses: 0,
    course: courseInfo,
  });

  async function setup(page: Page, courseInfo: Record<string, unknown>) {
    await mockCommonApis(page, { courses: [course() as never], libraryModules: [] });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.route("**/api/admin/content/courses/course-1/pending-versions", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pending(courseInfo)) }));
    const sent: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/courses/course-1/publish-pending", async (route: Route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ publishedItems: [{ type: "SECTION", id: "sec-1" }], version: null }) });
    });
    await page.goto(`${COURSE}?publishPending=1`);
    await expect(page.locator("#pendingPublishDialog")).toBeVisible();
    return sent;
  }

  test("kursbevis finnes: valget vises, mindre er standard, hovedversjon sendes når den er valgt", async ({ page }) => {
    const sent = await setup(page, { published: true, versionMajor: 3, versionMinor: 1, certificateHolders: 5 });
    const block = page.locator("#pendingPublishVersion");
    await expect(block).toBeVisible();
    await expect(block).toContainText("Hva slags endring er dette for kurset?");
    await expect(block).toContainText("5 deltakere har kursbevis for versjon 3.");
    await expect(block.locator('input[value="minor"]')).toBeChecked();
    await block.locator('input[value="major"]').check();
    await expect(block.locator("[data-version-consequence]")).toContainText("Dette skjer med versjon 4.0:");
    await page.locator("#pendingPublishConfirmBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ versionIds: ["sec-1-v2"], courseVersion: "major" });
  });

  test("ingen kursbevis: ikke noe valg, og ikke noe svar i kallet", async ({ page }) => {
    const sent = await setup(page, { published: true, versionMajor: 1, versionMinor: 0, certificateHolders: 0 });
    await expect(page.locator("#pendingPublishVersion")).toBeHidden();
    await page.locator("#pendingPublishConfirmBtn").click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ versionIds: ["sec-1-v2"] });
  });
});
