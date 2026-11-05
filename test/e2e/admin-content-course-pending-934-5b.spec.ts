import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// #934 skive 5b: «Publiser nye versjoner» med ett valg per berørt kurs, og «Publiser kurs» som viser hit (doc/DESIGN_934.md, «5b»).
// `affectedCourses` i `pending-versions` finnes bare når bryteren er på. Uten feltet er dialogen den gamle, uendret.

const COURSE = "/admin-content/courses/course-1";

const kurs = (courseId: string, overrides: Record<string, unknown> = {}) => ({
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

const pending = (overrides: Record<string, unknown> = {}) => ({
  courseId: "course-1",
  items: [{ type: "MODULE", id: "mod-1", title: "Modul 1", versionId: "mod-1-v2", isNew: false, publishable: true, blockers: [], passedCount: 3 }],
  notOwnedItems: [],
  publishable: true,
  passedTotal: 3,
  modulesWithPasses: 1,
  course: { published: true, versionMajor: 3, versionMinor: 1, certificateHolders: 10, majorEmailRecipients: 12 },
  ...overrides,
});

const ON = (courses: unknown[]) => pending({ affectedCourses: courses });

type Answer = { status: number; body: unknown };
const OK: Answer = { status: 200, body: { publishedItems: [{ type: "MODULE", id: "mod-1" }], courses: [] } };

async function setup(page: Page, opts: { pendings: unknown[]; publishes?: Answer[] }) {
  await mockCommonApis(page, {
    courses: [{ id: "course-1", title: "Rapportskriving", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: "2026-10-11T12:00:00.000Z", archivedAt: null, modules: [] } as never],
    libraryModules: [],
  });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  const calls = { reads: 0, versioned: [] as Array<Record<string, unknown>>, old: [] as Array<Record<string, unknown>> };
  await page.route("**/api/admin/content/courses/course-1/pending-versions", (route: Route) => {
    const body = opts.pendings[Math.min(calls.reads, opts.pendings.length - 1)];
    calls.reads += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/admin/content/courses/course-1/publish-pending-versioned", (route: Route) => {
    const list = opts.publishes ?? [OK];
    const answer = list[Math.min(calls.versioned.length, list.length - 1)];
    calls.versioned.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  await page.route("**/api/admin/content/courses/course-1/publish-pending", (route: Route) => {
    calls.old.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ publishedItems: [{ type: "MODULE", id: "mod-1" }] }) });
  });
  return calls;
}

const seksjon = (page: Page, courseId: string) => page.locator(`#pendingPublishVersion [data-course-id="${courseId}"]`);

test.describe("#934 skive 5b — «Publiser nye versjoner» med bryteren på", () => {
  test("et annet kurs deler modulen: ett valg per kurs, dette kurset først, #997-spørsmålet er borte, riktig kall", async ({ page }) => {
    const calls = await setup(page, { pendings: [ON([kurs("annet", { title: "Annet kurs" }), kurs("course-1", { title: "Rapportskriving", certificateHolders: 4, majorEmailRecipients: 4 }), kurs("tomt", { certificateHolders: 0, majorEmailRecipients: 0 })])] });
    await page.goto(`${COURSE}?publishPending=1`);
    await expect(page.locator("#pendingPublishDialog")).toBeVisible();
    await expect(page.locator("#pendingPublishRevision")).toBeHidden();
    await expect(page.locator("#pendingPublishKeepBtn")).toBeHidden();
    await expect(page.locator("#pendingPublishSupersedeBtn")).toBeHidden();
    await expect(page.locator("#pendingPublishConfirmBtn")).toBeVisible();

    await expect(page.locator("#pendingPublishVersion [data-course-id]").first()).toHaveAttribute("data-course-id", "course-1");
    await expect(seksjon(page, "course-1")).toContainText("(dette kurset)");
    await expect(seksjon(page, "course-1")).toContainText("4 deltakere har kursbevis");
    await expect(seksjon(page, "annet")).toContainText("10 deltakere har kursbevis");
    await expect(seksjon(page, "annet")).toContainText("12 deltakere får e-post ved hovedversjon");
    await expect(seksjon(page, "course-1").locator('input[value="minor"]')).toBeChecked();
    await expect(seksjon(page, "annet").locator('input[value="minor"]')).toBeChecked();
    await expect(seksjon(page, "tomt").locator("input")).toHaveCount(0);
    await expect(seksjon(page, "tomt")).toContainText("Kurset får mindre versjon");

    await seksjon(page, "annet").locator('input[value="major"]').check();
    await page.locator("#pendingPublishConfirmBtn").click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toEqual({
      versionIds: ["mod-1-v2"],
      courseVersions: { "course-1": "minor", annet: "major" },
      expectedCourseIds: ["course-1", "annet", "tomt"],
      confirmEmailRecipients: { annet: 12 },
    });
    expect(calls.old).toEqual([]);
    await expect(page.locator("#pendingPublishDialog")).toBeHidden();
  });

  test("ingen berørte kurs: ingen valg, og et tomt sett", async ({ page }) => {
    const calls = await setup(page, { pendings: [ON([])] });
    await page.goto(`${COURSE}?publishPending=1`);
    await expect(page.locator("#pendingPublishVersion")).toBeHidden();
    await page.locator("#pendingPublishConfirmBtn").click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toEqual({ versionIds: ["mod-1-v2"], expectedCourseIds: [] });
  });

  test("noe stopper: bare «Lukk», og ingen valg", async ({ page }) => {
    const blockers = [{ code: "translation_incomplete", message: "x", field: "title", missingLocales: ["nn"] }];
    const calls = await setup(page, { pendings: [pending({ affectedCourses: [kurs("course-1")], publishable: false, items: [{ type: "MODULE", id: "mod-1", title: "Modul 1", versionId: "mod-1-v2", isNew: false, publishable: false, blockers, passedCount: 0 }] })] });
    await page.goto(`${COURSE}?publishPending=1`);
    await expect(page.locator("#pendingPublishVersion")).toBeHidden();
    await expect(page.locator("#pendingPublishConfirmBtn")).toBeHidden();
    await page.locator("#pendingPublishCancelBtn").click();
    expect(calls.versioned).toEqual([]);
  });

  test("over 200: uten det ekstra «ja» sendes ingenting, og knappen virker etterpå", async ({ page }) => {
    const calls = await setup(page, { pendings: [ON([kurs("course-1", { certificateHolders: 300, majorEmailRecipients: 301 })])] });
    await page.goto(`${COURSE}?publishPending=1`);
    await seksjon(page, "course-1").locator('input[value="major"]').check();
    await page.locator("#pendingPublishConfirmBtn").click();
    await expect(page.locator("#pendingPublishDialog")).toBeVisible();
    await expect(seksjon(page, "course-1").locator("[data-email-confirm-missing]")).toBeVisible();
    await expect(page.locator("#pendingPublishConfirmBtn")).toBeEnabled();
    expect(calls.versioned).toEqual([]);
    await seksjon(page, "course-1").locator("[data-email-confirm]").check();
    await page.locator("#pendingPublishConfirmBtn").click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    expect(calls.versioned[0]).toMatchObject({ courseVersions: { "course-1": "major" }, confirmEmailRecipients: { "course-1": 301 } });
  });

  for (const [navn, svar] of [
    ["400 course_version_required", { status: 400, body: { error: "course_version_required", message: "x", details: { courses: [{ courseId: "tomt", certificateHolders: 1 }] } } }],
    ["409 affected_courses_changed", { status: 409, body: { error: "affected_courses_changed", message: "x" } }],
    ["409 major_email_confirm_required", { status: 409, body: { error: "major_email_confirm_required", message: "x", details: { majorEmailRecipients: 251 } } }],
    ["409 pending_versions_changed", { status: 409, body: { error: "pending_versions_changed", message: "x" } }],
  ] as const) {
    test(`${navn}: dialogen tegnes på nytt med ferske tall og sier fra`, async ({ page }) => {
      const calls = await setup(page, {
        pendings: [
          ON([kurs("course-1"), kurs("tomt", { certificateHolders: 0, majorEmailRecipients: 0 })]),
          ON([kurs("course-1"), kurs("tomt", { certificateHolders: 0, majorEmailRecipients: 0 })]),
          ON([kurs("course-1", { certificateHolders: 11, majorEmailRecipients: 13 }), kurs("tomt", { certificateHolders: 1, majorEmailRecipients: 1 })]),
        ],
        publishes: [svar, OK],
      });
      await page.goto(`${COURSE}?publishPending=1`);
      await seksjon(page, "course-1").locator('input[value="major"]').check();
      await page.locator("#pendingPublishConfirmBtn").click();
      await expect.poll(() => calls.versioned.length).toBe(1);
      expect(calls.versioned[0]).toEqual({ versionIds: ["mod-1-v2"], courseVersions: { "course-1": "major" }, expectedCourseIds: ["course-1", "tomt"], confirmEmailRecipients: { "course-1": 12 } });

      await expect(page.locator("#pendingPublishVersion .course-version-notice")).toContainText("Ingenting ble publisert");
      await expect(seksjon(page, "course-1")).toContainText("11 deltakere har kursbevis");
      await expect(seksjon(page, "course-1").locator('input[value="minor"]')).toBeChecked();
      await expect(page.locator("#pendingPublishConfirmBtn")).toBeEnabled();
      await page.locator("#pendingPublishConfirmBtn").click();
      await expect.poll(() => calls.versioned.length).toBe(2);
      expect(calls.versioned[1]).toEqual({ versionIds: ["mod-1-v2"], courseVersions: { "course-1": "minor", tomt: "minor" }, expectedCourseIds: ["course-1", "tomt"] });
    });
  }

  test("en annen feil: lokalisert toast, dialogen står, og knappen virker", async ({ page }) => {
    const calls = await setup(page, {
      pendings: [ON([kurs("course-1")])],
      publishes: [{ status: 409, body: { error: "module_version_number_fixed", message: "x" } }, OK],
    });
    await page.goto(`${COURSE}?publishPending=1`);
    await page.locator("#pendingPublishConfirmBtn").click();
    await expect.poll(() => calls.versioned.length).toBe(1);
    await expect(page.locator(".toast__message").first()).toContainText("publisert før");
    await expect(page.locator(".toast__message").first()).not.toContainText("module_version_number_fixed");
    await expect(page.locator("#pendingPublishDialog")).toBeVisible();
    await expect(page.locator("#pendingPublishConfirmBtn")).toBeEnabled();
  });

  for (const bredde of [390, 360]) {
    test(`${bredde} px: dialogen flyter ikke over med lange kurstitler`, async ({ page }) => {
      await page.setViewportSize({ width: bredde, height: 780 });
      const ORD = "Etsværtlangtordutenmellomromsomikkekanbrekkepåvanligmåteogsomfortsetterogfortsetter";
      await setup(page, { pendings: [ON([
        kurs("course-1", { title: "Et svært langt kursnavn som går over flere linjer på en liten skjerm og fortsetter enda litt til", certificateHolders: 1250, majorEmailRecipients: 1250 }),
        kurs("annet", { title: ORD, published: false }),
        kurs("tomt", { title: ORD, certificateHolders: 0, majorEmailRecipients: 0, archived: true }),
      ])] });
      await page.goto(`${COURSE}?publishPending=1`);
      await seksjon(page, "course-1").locator('input[value="major"]').check();
      await page.locator("#pendingPublishConfirmBtn").click();
      const el = page.locator("#pendingPublishDialog");
      await expect(seksjon(page, "course-1").locator("[data-email-confirm-missing]")).toBeVisible();
      expect(await el.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
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
      expect(box!.x + box!.width).toBeLessThanOrEqual(bredde);
    });
  }
});

test.describe("#934 skive 5b — bryteren av, eller gammel server: dialogen er den gamle", () => {
  test("uten `affectedCourses`: revisjonsspørsmålet stilles som før, og det gamle endepunktet brukes", async ({ page }) => {
    const calls = await setup(page, { pendings: [pending()] });
    await page.goto(`${COURSE}?publishPending=1`);
    await expect(page.locator("#pendingPublishRevision")).toBeVisible();
    await expect(page.locator("#pendingPublishConfirmBtn")).toBeHidden();
    await expect(page.locator('#pendingPublishVersion input[name="pendingCourseVersion"][value="minor"]')).toBeChecked();
    await page.locator("#pendingPublishSupersedeBtn").click();
    await expect.poll(() => calls.old.length).toBe(1);
    expect(calls.old[0]).toEqual({ versionIds: ["mod-1-v2"], supersedesEarlierPasses: true, courseVersion: "minor" });
    expect(calls.versioned).toEqual([]);
  });

  for (const [navn, svar] of [
    ["bryteren går av (409)", { status: 409, body: { error: "module_versioning_not_active", message: "x" } }],
    ["gammel server (404)", { status: 404, body: { error: "not_found" } }],
  ] as const) {
    test(`${navn} ved sending: den ferske lesingen gir den gamle dialogen, og publiseringen virker`, async ({ page }) => {
      const calls = await setup(page, { pendings: [ON([kurs("course-1")]), ON([kurs("course-1")]), pending()], publishes: [svar] });
      await page.goto(`${COURSE}?publishPending=1`);
      await page.locator("#pendingPublishConfirmBtn").click();
      await expect.poll(() => calls.versioned.length).toBe(1);
      await expect(page.locator("#pendingPublishRevision")).toBeVisible();
      await expect(page.locator("#pendingPublishVersion [data-course-id]")).toHaveCount(0);
      await page.locator("#pendingPublishKeepBtn").click();
      await expect.poll(() => calls.old.length).toBe(1);
      expect(calls.old[0]).toMatchObject({ versionIds: ["mod-1-v2"], supersedesEarlierPasses: false });
      expect(calls.versioned).toHaveLength(1);
    });
  }

  test("bryteren slås på mens den gamle dialogen står: serveren svarer 409, og den ferske lesingen gir valget per kurs", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [{ id: "course-1", title: "Rapportskriving", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: "2026-10-11T12:00:00.000Z", archivedAt: null, modules: [] } as never],
      libraryModules: [],
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    let reads = 0;
    await page.route("**/api/admin/content/courses/course-1/pending-versions", (route: Route) => {
      reads += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reads <= 2 ? pending() : ON([kurs("course-1")])) });
    });
    await page.route("**/api/admin/content/courses/course-1/publish-pending", (route: Route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "client_outdated", message: "x" }) }));
    await page.goto(`${COURSE}?publishPending=1`);
    await page.locator("#pendingPublishSupersedeBtn").click();
    await expect(seksjon(page, "course-1").locator('input[value="minor"]')).toBeChecked();
    await expect(page.locator("#pendingPublishSupersedeBtn")).toBeHidden();
  });
});

test.describe("#934 skive 5b — «Publiser kurs» med en modul som har vært publisert før", () => {
  async function cascade(page: Page) {
    await mockCommonApis(page, {
      courses: [{ id: "course-1", title: "Rapportskriving", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: null, archivedAt: null, modules: [] } as never],
      libraryModules: [],
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.route("**/api/admin/content/courses/*/publish-preview", (route: Route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ courseId: "course-1", allPublished: false, publishable: true, unpublishedItems: [{ type: "MODULE", id: "mod-1", title: "Modul 1", publishable: true, blockers: [] }], course: { published: false, versionMajor: 1, versionMinor: 0, certificateHolders: 0, majorEmailRecipients: 0 } }),
    }));
    await page.route("**/api/admin/content/courses/course-1/publish", (route: Route) => route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "course_publish_has_republished_modules", message: "x", details: { modules: [{ moduleId: "mod-1", title: '{"nb":"Modul 1 på bokmål","en-GB":"Module 1"}' }] } }),
    }));
    const versioned: Array<Record<string, unknown>> = [];
    await page.route("**/api/admin/content/courses/course-1/pending-versions", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ON([kurs("course-1")])) }));
    await page.route("**/api/admin/content/courses/course-1/publish-pending-versioned", (route: Route) => {
      versioned.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ publishedItems: [], courses: [] }) });
    });
    await page.goto("/admin-content/courses");
    await page.locator('#coursesTableBody tr [data-action="publish"]').first().click();
    await expect(page.locator("#cascadePublishDialog")).toBeVisible();
    return versioned;
  }

  test("forklarer hva som er galt og hvilke moduler, viser til «Publiser nye versjoner», og publiserer ingenting av seg selv", async ({ page }) => {
    const versioned = await cascade(page);
    await page.locator("#cascadePublishConfirmBtn").click();
    const toast = page.locator(".toast").first();
    await expect(toast).toContainText("Publiser nye versjoner");
    await expect(toast).toContainText("Modul 1 på bokmål");
    await expect(toast).not.toContainText("course_publish_has_republished_modules");
    await expect(page.locator("#pendingPublishDialog")).toBeVisible();
    await expect(seksjon(page, "course-1").locator('input[value="minor"]')).toBeChecked();
    expect(versioned).toEqual([]);
    // Knappen i lista virker igjen.
    await page.locator("#pendingPublishCancelBtn").click();
    await expect(page.locator('#coursesTableBody tr [data-action="publish"]').first()).toBeEnabled();
  });
});
