import { expect, test } from "@playwright/test";
import type { Locator, Page, Route } from "@playwright/test";

import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1150 skive 2b: dialogene for «Arkiver» og «Gjenopprett» på kurs (doc/design/PLAN_1148_ARKIVERING_OG_SLETTING.md, «Forløpet
// for forfatteren» og «Gjenoppretting»). Begge knappene finnes i kurslista OG i handlingsraden i det åpnede kurset, og testene
// går gjennom begge. Tjeneren er etterlignet; svarformene er de i doc/API_REFERENCE.md (archive-preview, archive med
// `expected`, restore-preview, restore).

const API = "/api/admin/content/courses/course-1";
const LIST = "/admin-content/courses";
const DETAIL = "/admin-content/courses/course-1";

function course(overrides: Record<string, unknown> = {}) {
  return {
    id: "course-1",
    title: { "en-GB": "Arbeidsmiljø", nb: "Arbeidsmiljø", nn: "Arbeidsmiljø" },
    description: null,
    certificationLevel: "basic",
    moduleCount: 1,
    updatedAt: "2026-11-13T12:00:00.000Z",
    publishedAt: "2026-11-01T12:00:00.000Z",
    archivedAt: null,
    modules: [{ moduleId: "mod-a", sortOrder: 0, moduleTitle: "Modul A" }],
    contentRevision: 3,
    ...overrides,
  };
}

// Alt forhåndsvisningen kan si, ingen tall null. Rekkefølgen i `follows` er tjenerens.
const FULL_PREVIEW = {
  courseId: "course-1",
  courseTitle: "Arbeidsmiljø",
  archived: false,
  published: true,
  inProgressCount: 3,
  completedWithoutCertificateCount: 1,
  pendingReviewCount: 2,
  hasDraft: true,
  follows: [
    { type: "MODULE", id: "mod-a", title: "Modul A", owned: true },
    { type: "SECTION", id: "sec-b", title: "Seksjon B", owned: true },
    { type: "MODULE", id: "mod-c", title: "Modul C fra en kollega", owned: false },
  ],
  stays: [
    { type: "MODULE", id: "mod-d", title: "Delt modul", usedBy: [{ courseId: "course-2", title: "Ledelse", via: "course" }] },
    { type: "SECTION", id: "sec-e", title: "Seksjon i utkast", usedBy: [{ courseId: "course-3", title: "HMS-kurs", via: "draft" }] },
  ],
  alreadyArchived: [],
};

const ZERO_PREVIEW = {
  ...FULL_PREVIEW,
  inProgressCount: 0,
  completedWithoutCertificateCount: 0,
  pendingReviewCount: 0,
  hasDraft: false,
  follows: [],
  stays: [],
};

const RESTORE_PREVIEW = {
  courseId: "course-1",
  courseTitle: "Arbeidsmiljø",
  archived: true,
  returns: [
    { type: "MODULE", id: "mod-a", title: "Modul A", versionId: "mv-1", versionLabel: "2.1" },
    { type: "SECTION", id: "sec-b", title: "Seksjon B", versionId: null, asDraft: "version_missing" },
    { type: "MODULE", id: "mod-c", title: "Modul C", versionId: null, asDraft: "was_unpublished" },
  ],
  staysArchived: [
    { type: "SECTION", id: "sec-f", title: "Arkivert for hånd", reason: "archived_separately" },
    { type: "MODULE", id: "mod-g", title: "Fulgte et annet kurs", reason: "archived_with_other_course" },
  ],
};

async function locale(page: Page, value: string) {
  await page.addInitScript((loc) => { try { localStorage.setItem("participant.locale", loc); } catch { /* ignore */ } }, value);
}

type Calls = { posts: Array<{ path: string; body: unknown }>; previews: number };

/**
 * Tjeneren for arkivering og gjenoppretting. `previews` er svarene på archive-preview i rekkefølge (det siste gjentas);
 * `archive` svarene på POST …/archive. Et vellykket svar arkiverer kurset i mocken, så visningen som lastes på nytt, viser det.
 */
async function mockLifecycle(page: Page, state: { mutableCourses: Array<Record<string, unknown>> }, options: {
  previews?: Array<{ status: number; body: unknown }>;
  archive?: Array<{ status: number; body: unknown }>;
  restorePreview?: { status: number; body: unknown };
  restore?: { status: number; body: unknown };
} = {}): Promise<Calls> {
  const calls: Calls = { posts: [], previews: 0 };
  const setArchived = (value: string | null) => {
    const target = state.mutableCourses.find((c) => c.id === "course-1");
    if (target) { target.archivedAt = value; if (value) target.publishedAt = null; }
  };
  await page.route("**/api/admin/content/courses/*/archive-preview", async (route: Route) => {
    const list = options.previews ?? [{ status: 200, body: FULL_PREVIEW }];
    const answer = list[Math.min(calls.previews, list.length - 1)];
    calls.previews += 1;
    await route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  await page.route("**/api/admin/content/courses/*/archive", async (route: Route) => {
    const raw = route.request().postData();
    calls.posts.push({ path: "archive", body: raw ? JSON.parse(raw) : null });
    const list = options.archive ?? [{ status: 200, body: { course: { id: "course-1" }, followed: { moduleIds: ["mod-a", "mod-c"], sectionIds: ["sec-b"] }, certificatesIssued: 1, draftDiscarded: true } }];
    const answer = list[Math.min(calls.posts.filter((p) => p.path === "archive").length - 1, list.length - 1)];
    if (answer.status === 200) setArchived("2026-11-13T13:00:00.000Z");
    await route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  await page.route("**/api/admin/content/courses/*/restore-preview", async (route: Route) => {
    const answer = options.restorePreview ?? { status: 200, body: RESTORE_PREVIEW };
    await route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  await page.route("**/api/admin/content/courses/*/restore", async (route: Route) => {
    const raw = route.request().postData();
    calls.posts.push({ path: "restore", body: raw ? JSON.parse(raw) : null });
    const answer = options.restore ?? { status: 200, body: { course: { id: "course-1" }, returns: RESTORE_PREVIEW.returns, staysArchived: RESTORE_PREVIEW.staysArchived } };
    if (answer.status === 200) setArchived(null);
    await route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  return calls;
}

async function setup(page: Page, courseOverrides: Record<string, unknown> = {}, options: Parameters<typeof mockLifecycle>[2] = {}, loc = "nb") {
  const state = await mockCommonApis(page, { courses: [course(courseOverrides) as never], libraryModules: [] });
  await locale(page, loc);
  const calls = await mockLifecycle(page, state as never, options);
  return { state, calls };
}

const listRow = (page: Page) => page.locator("#coursesTableBody tr").filter({ hasText: "Arbeidsmiljø" });
const headerAction = (page: Page, action: string) => page.locator(`.form-page-actions [data-action="${action}"]`);

async function clickAction(page: Page, action: Locator) {
  await (await revealRowAction(page, action)).click();
}

async function openArchiveFromList(page: Page) {
  await page.goto(LIST);
  await clickAction(page, listRow(page).locator('[data-action="archive"]'));
  const dialog = page.locator("#courseArchiveDialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

const part = (dialog: Locator, name: string) => dialog.locator(`[data-lifecycle-part="${name}"]`);

test.describe("#1150 skive 2b — «Arkiver» med forhåndsvisning", () => {
  test("fra kurslista: dialogen viser listene og tallene, bekreft sender nøyaktig det den viste, og lista oppdateres", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const { calls } = await setup(page);
    const dialog = await openArchiveFromList(page);

    await expect(page.locator("#courseArchiveTitle")).toHaveText("Arkiver «Arbeidsmiljø»");
    await expect(part(dialog, "follows")).toContainText("Følger med inn i arkivet (3)");
    await expect(part(dialog, "follows").locator("li")).toHaveCount(3);
    // Bare elementet forfatteren ikke eier, merkes.
    await expect(part(dialog, "follows").locator("[data-not-owned]")).toHaveCount(1);
    await expect(part(dialog, "follows").locator('li[data-item-id="mod-c"] [data-not-owned]')).toHaveText("Eies av en annen forfatter");
    await expect(part(dialog, "stays")).toContainText("Blir stående, fordi de brukes andre steder (2)");
    await expect(part(dialog, "stays").locator('li[data-item-id="mod-d"]')).toContainText("Brukes i «Ledelse»");
    await expect(part(dialog, "stays").locator('li[data-item-id="sec-e"]')).toContainText("Brukes i «HMS-kurs» (lagret utkast)");
    await expect(part(dialog, "inProgress")).toContainText("Deltakere midt i kurset (3)");
    await expect(part(dialog, "inProgress")).toContainText("forsvinner fra «Mine kurs»");
    await expect(part(dialog, "pendingReview")).toContainText("Besvarelser som venter på vurdering (2)");
    await expect(part(dialog, "pendingReview")).toContainText("holdes kurset igjen fra sletting");
    await expect(part(dialog, "pendingReview")).toContainText("får kursbeviset først når kurset gjenopprettes og publiseres");
    await expect(part(dialog, "completedWithoutCertificate")).toContainText("Fullført uten kursbevis (1)");
    await expect(part(dialog, "completedWithoutCertificate")).toContainText("får kursbeviset nå");
    await expect(part(dialog, "draft")).toHaveText("Kursets lagrede utkast forkastes.");
    await dialog.screenshot({ path: "test-results/1150-arkiver-dialog-1280.png" });

    await page.locator("#courseArchiveConfirmBtn").click();
    await expect.poll(() => calls.posts.length).toBe(1);
    expect(calls.posts[0]).toEqual({
      path: "archive",
      body: { expected: { follows: { moduleIds: ["mod-a", "mod-c"], sectionIds: ["sec-b"] }, inProgressCount: 3 } },
    });
    await expect(dialog).toBeHidden();
    const toast = page.locator(".toast--success");
    await expect(toast.locator(".toast__message")).toHaveText("Kurset er arkivert, med 2 moduler og 1 seksjon.");
    await expect(toast.locator(".toast__detail")).toHaveText("Kursbevis utstedt: 1.");
    // Lista er lastet på nytt: et arkivert kurs står ikke under «Aktive».
    await expect(listRow(page)).toHaveCount(0);
  });

  test("fra det åpnede kurset: samme dialog, og etter arkiveringen står kurset sperret", async ({ page }) => {
    const { calls } = await setup(page);
    await page.goto(DETAIL);
    await expect(page.locator("#title-nb")).toBeEnabled();
    await clickAction(page, headerAction(page, "archive"));
    const dialog = page.locator("#courseArchiveDialog");
    await expect(dialog).toBeVisible();
    await expect(part(dialog, "follows").locator("li")).toHaveCount(3);
    await page.locator("#courseArchiveConfirmBtn").click();
    await expect.poll(() => calls.posts.length).toBe(1);
    expect(calls.posts[0].body).toEqual({ expected: { follows: { moduleIds: ["mod-a", "mod-c"], sectionIds: ["sec-b"] }, inProgressCount: 3 } });
    await expect(dialog).toBeHidden();
    // Visningen er lastet på nytt: arkivert, sperret, og «Gjenopprett» i stedet for «Arkiver».
    await expect(page.locator("[data-course-archived-notice]")).toBeVisible();
    await expect(page.locator("#title-nb")).toBeDisabled();
    await expect(headerAction(page, "restore")).toHaveCount(1);
  });

  test("409 course_archive_preview_changed: dialogen henter på nytt, sier fra, og ny bekreftelse sender de nye tallene", async ({ page }) => {
    const changed = {
      ...FULL_PREVIEW,
      inProgressCount: 4,
      follows: FULL_PREVIEW.follows.filter((item) => item.id !== "mod-c"),
    };
    const { calls } = await setup(page, {}, {
      previews: [{ status: 200, body: FULL_PREVIEW }, { status: 200, body: changed }],
      archive: [
        { status: 409, body: { error: "course_archive_preview_changed", message: "What archiving this course would do changed after the preview was shown. Open it again; nothing was archived.", details: { inProgressCount: 4, follows: { moduleIds: ["mod-a"], sectionIds: ["sec-b"] } } } },
        { status: 200, body: { course: { id: "course-1" }, followed: { moduleIds: ["mod-a"], sectionIds: ["sec-b"] }, certificatesIssued: 0, draftDiscarded: true } },
      ],
    });
    const dialog = await openArchiveFromList(page);
    await expect(dialog.locator("[data-lifecycle-changed]")).toHaveCount(0);
    await page.locator("#courseArchiveConfirmBtn").click();

    await expect(dialog.locator("[data-lifecycle-changed]")).toBeVisible();
    await expect(dialog.locator("[data-lifecycle-changed]")).toContainText("Ingenting ble arkivert");
    expect(calls.previews).toBe(2);
    await expect(part(dialog, "follows").locator("li")).toHaveCount(2);
    await expect(part(dialog, "inProgress")).toContainText("(4)");
    await expect(dialog).toBeVisible();

    await page.locator("#courseArchiveConfirmBtn").click();
    await expect.poll(() => calls.posts.length).toBe(2);
    expect(calls.posts[1].body).toEqual({ expected: { follows: { moduleIds: ["mod-a"], sectionIds: ["sec-b"] }, inProgressCount: 4 } });
    await expect(dialog).toBeHidden();
    // Entall på begge, og ingen kursbevis utstedt: ingen detaljlinje.
    await expect(page.locator(".toast--success .toast__message")).toHaveText("Kurset er arkivert, med 1 modul og 1 seksjon.");
    await expect(page.locator(".toast--success .toast__detail")).toHaveCount(0);
  });

  test("meldingen etter arkivering utelater delen som er 0", async ({ page }) => {
    await setup(page, {}, { archive: [{ status: 200, body: { course: { id: "course-1" }, followed: { moduleIds: ["mod-a", "mod-c", "mod-x"], sectionIds: [] }, certificatesIssued: 0, draftDiscarded: false } }] });
    await openArchiveFromList(page);
    await page.locator("#courseArchiveConfirmBtn").click();
    await expect(page.locator(".toast--success .toast__message")).toHaveText("Kurset er arkivert, med 3 moduler.");
  });

  test("Avbryt sender ingenting, og knappen virker igjen", async ({ page }) => {
    const { calls } = await setup(page);
    const dialog = await openArchiveFromList(page);
    await page.locator("#courseArchiveCancelBtn").click();
    await expect(dialog).toBeHidden();
    const button = listRow(page).locator('[data-action="archive"]');
    await expect(button).toBeEnabled();
    // Esc er også et nei.
    await clickAction(page, button);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(calls.posts).toHaveLength(0);
  });

  test("KONTROLL: med alle tall 0 og ingenting som følger med vises bare det som gjelder", async ({ page }) => {
    const { calls } = await setup(page, {}, { previews: [{ status: 200, body: ZERO_PREVIEW }], archive: [{ status: 200, body: { course: { id: "course-1" }, followed: { moduleIds: [], sectionIds: [] }, certificatesIssued: 0, draftDiscarded: false } }] });
    const dialog = await openArchiveFromList(page);
    await expect(part(dialog, "follows")).toContainText("Ingen moduler eller seksjoner følger med. Bare kurset arkiveres.");
    await expect(part(dialog, "follows").locator("li")).toHaveCount(0);
    for (const name of ["stays", "inProgress", "pendingReview", "completedWithoutCertificate", "draft"]) {
      await expect(part(dialog, name), name).toHaveCount(0);
    }
    await page.locator("#courseArchiveConfirmBtn").click();
    await expect.poll(() => calls.posts.length).toBe(1);
    expect(calls.posts[0].body).toEqual({ expected: { follows: { moduleIds: [], sectionIds: [] }, inProgressCount: 0 } });
    await expect(page.locator(".toast--success .toast__message")).toHaveText("Kurset ble arkivert.");
  });

  test("upublisert kurs: fullført uten kursbevis sier at bevis ikke utstedes", async ({ page }) => {
    await setup(page, { publishedAt: null }, { previews: [{ status: 200, body: { ...ZERO_PREVIEW, published: false, completedWithoutCertificateCount: 2 } }] });
    const dialog = await openArchiveFromList(page);
    await expect(part(dialog, "completedWithoutCertificate")).toContainText("Fullført uten kursbevis (2)");
    await expect(part(dialog, "completedWithoutCertificate")).toContainText("kursbevis utstedes ikke for et upublisert kurs");
    await expect(part(dialog, "completedWithoutCertificate")).not.toContainText("får kursbeviset nå");
  });

  test("400 course_already_archived på bekreftelsen: dialogen lukkes og lista lastes på nytt", async ({ page }) => {
    const { state, calls } = await setup(page, {}, { archive: [{ status: 400, body: { error: "course_already_archived", message: "The course is already archived." } }] });
    const dialog = await openArchiveFromList(page);
    // Noen andre arkiverte kurset mens dialogen sto.
    (state.mutableCourses as Array<Record<string, unknown>>)[0].archivedAt = "2026-11-13T13:00:00.000Z";
    await page.locator("#courseArchiveConfirmBtn").click();
    await expect.poll(() => calls.posts.length).toBe(1);
    await expect(dialog).toBeHidden();
    await expect(page.locator(".toast--warning")).toContainText("Kurset er allerede arkivert.");
    await expect(listRow(page)).toHaveCount(0);
  });

  test("forhåndsvisningen svarer 404 (gammel tjener): den enkle bekreftelsen, og arkiveringen uten kropp", async ({ page }) => {
    const { calls } = await setup(page, {}, { previews: [{ status: 404, body: { error: "not_found" } }], archive: [{ status: 200, body: { course: { id: "course-1" } } }] });
    await page.goto(LIST);
    const messages: string[] = [];
    // Første gang: nei. Ingenting sendes.
    page.once("dialog", (d) => { messages.push(d.message()); void d.dismiss(); });
    await clickAction(page, listRow(page).locator('[data-action="archive"]'));
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toBe("Arkivere kurset «Arbeidsmiljø»? Det skjules for deltakere, men beholdes med fullføringer.");
    await expect(page.locator("#courseArchiveDialog")).toBeHidden();
    await expect(listRow(page).locator('[data-action="archive"]')).toBeEnabled();
    expect(calls.posts).toHaveLength(0);
    // Andre gang: ja.
    page.once("dialog", (d) => { messages.push(d.message()); void d.accept(); });
    await clickAction(page, listRow(page).locator('[data-action="archive"]'));
    await expect.poll(() => calls.posts.length).toBe(1);
    expect(calls.posts[0].body).toBeNull();
    await expect(page.locator(".toast--success .toast__message")).toHaveText("Kurset ble arkivert.");
  });
});

test.describe("#1150 skive 2b — «Gjenopprett» med forhåndsvisning", () => {
  const ARCHIVED = { archivedAt: "2026-11-10T12:00:00.000Z", publishedAt: null };

  async function expectRestorePreview(dialog: Locator) {
    await expect(dialog.locator("#courseRestoreText")).toHaveText("Kurset kommer tilbake som utkast. Publiser det når du er klar.");
    const returns = part(dialog, "returns");
    await expect(returns).toContainText("Kommer tilbake (3)");
    await expect(returns.locator('li[data-item-id="mod-a"]')).toContainText("Publisert igjen, versjon 2.1");
    await expect(returns.locator('li[data-item-id="mod-a"] [data-version-label]')).toHaveText("v2.1");
    await expect(returns.locator('li[data-item-id="sec-b"]')).toContainText("Versjonen finnes ikke lenger. Seksjonen kommer tilbake som utkast: publiser seksjonen før kurset.");
    await expect(returns.locator('li[data-item-id="sec-b"] [data-version-label]')).toHaveCount(0);
    await expect(returns.locator('li[data-item-id="mod-c"]')).toContainText("Var et utkast, og kommer tilbake som utkast.");
    const stays = part(dialog, "staysArchived");
    await expect(stays).toContainText("Blir stående arkivert (2)");
    await expect(stays.locator('li[data-item-id="sec-f"]')).toContainText("Arkivert for seg, eller arkivert før kursarkiveringen tok innholdet med seg.");
    await expect(stays.locator('li[data-item-id="mod-g"]')).toContainText("Arkivert sammen med et annet kurs.");
    await expect(stays).toContainText("Disse må gjenopprettes hver for seg. Kurset kan ikke publiseres før det er gjort.");
  }

  // Svaret er fasiten: her nummererer gjenopprettingen modulen annerledes enn forhåndsvisningen, og seksjonen kom tilbake publisert.
  const RESTORE_RESULT = {
    course: { id: "course-1" },
    returns: [
      { type: "MODULE", id: "mod-a", title: "Modul A", versionId: "mv-1", versionLabel: "2.3" },
      { type: "SECTION", id: "sec-b", title: "Seksjon B", versionId: "sv-4", versionLabel: "4" },
      { type: "MODULE", id: "mod-c", title: "Modul C", versionId: null, asDraft: "was_unpublished" },
    ],
    staysArchived: RESTORE_PREVIEW.staysArchived,
  };

  test("fra kurslista: dialogen viser hva som kommer tilbake og hva som blir stående, og meldingen kommer fra svaret", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const { calls } = await setup(page, ARCHIVED, { restore: { status: 200, body: RESTORE_RESULT } });
    await page.goto(LIST);
    await page.locator('.list-filter-btn[data-filter="archived"]').click();
    await clickAction(page, listRow(page).locator('[data-action="restore"]'));
    const dialog = page.locator("#courseRestoreDialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#courseRestoreTitle")).toHaveText("Gjenopprett «Arbeidsmiljø»");
    await expectRestorePreview(dialog);
    await dialog.screenshot({ path: "test-results/1150-gjenopprett-dialog-1280.png" });

    await page.locator("#courseRestoreConfirmBtn").click();
    await expect.poll(() => calls.posts.length).toBe(1);
    expect(calls.posts[0]).toEqual({ path: "restore", body: null });
    await expect(dialog).toBeHidden();
    const toast = page.locator(".toast--warning");
    await expect(toast.locator(".toast__message")).toHaveText("Kurset «Arbeidsmiljø» er gjenopprettet som utkast.");
    await expect(toast.locator(".toast__detail")).toHaveText(
      "Publisert igjen: Modul A (2.3), Seksjon B (4). Tilbake som utkast, publiser dem før kurset: Modul C. Fortsatt arkivert, gjenopprett dem hver for seg: Arkivert for hånd, Fulgte et annet kurs.",
    );
  });

  test("fra det åpnede kurset: Avbryt sender ingenting; bekreft gjenoppretter og åpner skjemaet igjen", async ({ page }) => {
    const { calls } = await setup(page, ARCHIVED, {
      restore: { status: 200, body: { course: { id: "course-1" }, returns: [RESTORE_RESULT.returns[0]], staysArchived: [] } },
    });
    await page.goto(DETAIL);
    await expect(page.locator("[data-course-archived-notice]")).toBeVisible();
    await clickAction(page, headerAction(page, "restore"));
    const dialog = page.locator("#courseRestoreDialog");
    await expect(dialog).toBeVisible();
    await expectRestorePreview(dialog);
    await page.locator("#courseRestoreCancelBtn").click();
    await expect(dialog).toBeHidden();
    expect(calls.posts).toHaveLength(0);
    await expect(headerAction(page, "restore")).toBeEnabled();

    await clickAction(page, headerAction(page, "restore"));
    await expect(dialog).toBeVisible();
    await page.locator("#courseRestoreConfirmBtn").click();
    await expect.poll(() => calls.posts.length).toBe(1);
    await expect(dialog).toBeHidden();
    // Alt kom tilbake publisert: en vanlig suksessmelding.
    await expect(page.locator(".toast--success .toast__detail")).toHaveText("Publisert igjen: Modul A (2.3).");
    await expect(page.locator("[data-course-archived-notice]")).toHaveCount(0);
    await expect(page.locator("#title-nb")).toBeEnabled();
    await expect(page.locator("#formSaveBtn")).toHaveCount(1);
  });

  test("forhåndsvisningen svarer 404 (gammel tjener): gjenoppretter uten dialog, som før", async ({ page }) => {
    const { calls } = await setup(page, ARCHIVED, { restorePreview: { status: 404, body: { error: "not_found" } }, restore: { status: 200, body: { course: { id: "course-1" } } } });
    await page.goto(LIST);
    await page.locator('.list-filter-btn[data-filter="archived"]').click();
    await clickAction(page, listRow(page).locator('[data-action="restore"]'));
    await expect.poll(() => calls.posts.length).toBe(1);
    await expect(page.locator("#courseRestoreDialog")).toBeHidden();
    await expect(page.locator(".toast--success .toast__message")).toHaveText("Kurset «Arbeidsmiljø» ble gjenopprettet.");
  });
});

test.describe("#1150 skive 2b — det åpnede, arkiverte kurset", () => {
  test("skjemaet er sperret, Lagre finnes ikke, og linja sier hvorfor; eierpanelet er åpent", async ({ page }) => {
    const { state } = await setup(page, { archivedAt: "2026-11-10T12:00:00.000Z", publishedAt: null });
    const writes: string[] = [];
    page.on("request", (request) => { if (request.method() === "PUT") writes.push(request.url()); });
    await page.goto(DETAIL);
    await expect(page.locator("[data-course-archived-notice]")).toHaveText("Kurset er arkivert og kan ikke endres. Gjenopprett det for å endre det.");
    await expect(page.locator("#formSaveBtn")).toHaveCount(0);
    await expect(page.locator("#formCancelLink")).toHaveCount(0);
    await expect(page.locator("#title-nb")).toBeDisabled();
    await expect(page.locator("#certLevel")).toBeDisabled();
    await expect(page.locator("#comboboxInput")).toBeDisabled();
    await expect(page.locator('#moduleList [data-remove="0"]')).toBeDisabled();
    // Nedtrekket og søkefeltet ser sperret ut som navnefeltet (de har egen hvit bakgrunn ellers).
    const background = (selector: string) => page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundColor);
    const lockedBackground = await background("#title-nb");
    expect(await background("#certLevel")).toBe(lockedBackground);
    expect(await background("#comboboxInput")).toBe(lockedBackground);
    await page.screenshot({ path: "test-results/1150-arkivert-kurs-1280.png", fullPage: true });
    await page.locator("#formTab-innstillinger").click();
    await expect(page.locator("#enrollmentPolicy")).toBeDisabled();
    await expect(page.locator("#sortOrder")).toBeDisabled();
    // Eierpanelet står utenfor sperren (det lagrer for seg).
    await expect(page.locator("#ownerPanelHost")).not.toHaveAttribute("disabled", /.*/);
    expect(await page.locator("#ownerPanelHost").evaluate((el) => el.closest("fieldset[disabled]") === null)).toBe(true);
    await expect(page.locator("#formPageDirty")).toHaveText(/Alt lagret/);
    expect(writes).toHaveLength(0);
    expect(state.mutableCourses).toHaveLength(1);
  });

  test("KONTROLL: et aktivt kurs er ikke sperret", async ({ page }) => {
    await setup(page);
    await page.goto(DETAIL);
    await expect(page.locator("#title-nb")).toBeEnabled();
    await expect(page.locator("#formSaveBtn")).toHaveCount(1);
    await expect(page.locator("[data-course-archived-notice]")).toHaveCount(0);
    await expect(page.locator("[data-course-archived-lock]")).toHaveCount(0);
    // Sperren skal ikke endre oppsettet: dette bildet og 1150-arkivert-kurs-1280.png skal se like ut, bortsett fra sperren.
    await page.screenshot({ path: "test-results/1150-aktivt-kurs-1280.png", fullPage: true });
  });
});

test.describe("#1150 skive 2b — tekstene på tre språk", () => {
  for (const loc of ["nb", "nn", "en-GB"]) {
    test(`${loc}: ingen rå nøkler og ingen {…} i dialogene, meldingene og linja`, async ({ page }) => {
      const { calls } = await setup(page, {}, {}, loc);
      const raw = /courses\.|archiveDialog|restoreDialog|errors\.api|\{[a-zA-Z]+\}/;
      const dialog = await openArchiveFromList(page);
      const archiveText = await dialog.innerText();
      expect(archiveText).not.toMatch(raw);
      expect(archiveText).toContain("Modul C fra en kollega");
      await page.locator("#courseArchiveConfirmBtn").click();
      await expect.poll(() => calls.posts.length).toBe(1);
      const toast = page.locator(".toast--success").first();
      await expect(toast).toBeVisible();
      expect(await toast.innerText()).not.toMatch(raw);

      // Det arkiverte kurset, åpnet: linja og gjenopprett-dialogen.
      await page.goto(DETAIL);
      const notice = page.locator("[data-course-archived-notice]");
      await expect(notice).toBeVisible();
      expect(await notice.innerText()).not.toMatch(raw);
      await clickAction(page, headerAction(page, "restore"));
      const restore = page.locator("#courseRestoreDialog");
      await expect(restore).toBeVisible();
      const restoreText = await restore.innerText();
      expect(restoreText).not.toMatch(raw);
      expect(restoreText).toContain("2.1");
      await page.locator("#courseRestoreConfirmBtn").click();
      const restoreToast = page.locator(".toast--warning").first();
      await expect(restoreToast).toBeVisible();
      expect(await restoreToast.innerText()).not.toMatch(raw);
      // Hvert språk har sin egen tekst; en manglende nynorsk nøkkel faller ellers stille tilbake til engelsk (mutasjon 23).
      const heading = { nb: "Følger med inn i arkivet (3)", nn: "Følgjer med inn i arkivet (3)", "en-GB": "Archived along with the course (3)" }[loc]!;
      const restoreHeading = { nb: "Kommer tilbake (3)", nn: "Kjem tilbake (3)", "en-GB": "Coming back (3)" }[loc]!;
      expect(archiveText).toContain(heading);
      expect(restoreText).toContain(restoreHeading);
    });
  }
});

test.describe("#1150 skive 2b — 390 px", () => {
  const LONG = "Et svært langt navn på en modul som brytes over flere linjer på en liten skjerm uten mellomrom_i_slutten_av_navnet_som_ikke_kan_deles";
  const LONG_PREVIEW = {
    ...FULL_PREVIEW,
    // Et langt ord uten mellomrom i tittelen også: overskriften (h2) skal brytes som lista.
    courseTitle: "Arbeidsmiljø og sikkerhet for ledere — HMS_internkontroll_og_risikovurdering_fordypning",
    follows: [...FULL_PREVIEW.follows, { type: "MODULE", id: "mod-long", title: LONG, owned: false }],
    stays: [...FULL_PREVIEW.stays, { type: "SECTION", id: "sec-long", title: LONG, usedBy: [{ courseId: "c-9", title: LONG, via: "draft" }] }],
  };

  async function expectFits(page: Page, dialog: Locator) {
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(0);
    const dialogOverflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(dialogOverflow).toBeLessThanOrEqual(0);
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    // Hver rad står innenfor dialogen, og teksten i raden flyter ikke ut av den: et langt ord uten mellomrom brytes. Raden
    // selv er et flex-element som krymper, så boksen alene måler ikke dette; innholdet som renner over, gjør raden bredere
    // innvendig (scrollWidth), og lista får vannrett rulling.
    for (const item of await dialog.locator("li").all()) {
      const itemBox = await item.boundingBox();
      if (itemBox) expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(box!.x + box!.width);
      expect(await item.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    }
    expect(await dialog.locator(".course-lifecycle-body").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(await dialog.locator(".dialog-title").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    // Begge knappene står helt innenfor skjermen: lista ruller, ikke dialogen.
    for (const button of await dialog.locator(".dialog-actions button").all()) {
      const buttonBox = await button.boundingBox();
      expect(buttonBox).not.toBeNull();
      expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(844);
      expect(buttonBox!.y).toBeGreaterThanOrEqual(0);
    }
  }

  test("arkiver-dialogen passer i skjermen, og lange titler brytes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, {}, { previews: [{ status: 200, body: LONG_PREVIEW }] });
    const dialog = await openArchiveFromList(page);
    await expect(part(dialog, "follows").locator('li[data-item-id="mod-long"]')).toBeVisible();
    await expectFits(page, dialog);
    await page.screenshot({ path: "test-results/1150-arkiver-dialog-390.png" });
  });

  test("gjenopprett-dialogen på 390 px, fra det åpnede, arkiverte kurset", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, { archivedAt: "2026-11-10T12:00:00.000Z", publishedAt: null }, {
      restorePreview: { status: 200, body: { ...RESTORE_PREVIEW, courseTitle: LONG_PREVIEW.courseTitle, returns: [...RESTORE_PREVIEW.returns, { type: "MODULE", id: "mod-long", title: LONG, versionId: "x", versionLabel: "12.4" }] } },
    });
    await page.goto(DETAIL);
    const notice = page.locator("[data-course-archived-notice]");
    await expect(notice).toBeVisible();
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(0);
    await clickAction(page, headerAction(page, "restore"));
    const dialog = page.locator("#courseRestoreDialog");
    await expect(dialog).toBeVisible();
    await expectFits(page, dialog);
    await page.screenshot({ path: "test-results/1150-gjenopprett-dialog-390.png" });
  });
});

// QA-porten for 2b: fokus etter lukking, gamle svar som kommer etter nyere, 404 med `course_not_found`, og utkastlinja i et
// arkivert kurs.
test.describe("#1150 skive 2b — QA-porten", () => {
  /** Et svar som holdes tilbake til testen slipper det. */
  function holdBack() {
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    return { release, released };
  }

  test("fokus går tilbake til knappen som åpnet dialogen (Esc og Avbryt, begge dialogene)", async ({ page }) => {
    await setup(page);
    await openArchiveFromList(page);
    await page.keyboard.press("Escape");
    const archiveButton = listRow(page).locator('[data-action="archive"]');
    await expect(archiveButton).toBeFocused();
    await clickAction(page, archiveButton);
    await expect(page.locator("#courseArchiveDialog")).toBeVisible();
    await page.locator("#courseArchiveCancelBtn").click();
    await expect(archiveButton).toBeFocused();
  });

  test("fokus etter Avbryt i gjenopprett-dialogen, fra det åpnede kurset", async ({ page }) => {
    await setup(page, { archivedAt: "2026-11-10T12:00:00.000Z", publishedAt: null });
    await page.goto(DETAIL);
    const restoreButton = headerAction(page, "restore");
    await clickAction(page, restoreButton);
    await expect(page.locator("#courseRestoreDialog")).toBeVisible();
    await page.locator("#courseRestoreCancelBtn").click();
    await expect(restoreButton).toBeFocused();
  });

  test("to klikk mens forhåndsvisningen laster: det eldste svaret vises ikke, og bekreft arkiverer kurset som vises", async ({ page }) => {
    const state = await mockCommonApis(page, {
      courses: [course() as never, course({ id: "course-2", title: { "en-GB": "Ledelse", nb: "Ledelse", nn: "Ledelse" } }) as never],
      libraryModules: [],
    });
    await locale(page, "nb");
    await mockLifecycle(page, state as never);
    const slow = holdBack();
    let slowAnswered = false;
    await page.route("**/api/admin/content/courses/*/archive-preview", async (route: Route) => {
      const courseId = new URL(route.request().url()).pathname.split("/").slice(-2)[0];
      if (courseId === "course-1") {
        await slow.released;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FULL_PREVIEW) });
        slowAnswered = true;
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...ZERO_PREVIEW, courseId: "course-2", courseTitle: "Ledelse", follows: [{ type: "SECTION", id: "sec-z", title: "Seksjon Z", owned: true }] }) });
    });
    const archived: string[] = [];
    await page.route("**/api/admin/content/courses/*/archive", async (route: Route) => {
      archived.push(new URL(route.request().url()).pathname);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "x" }, followed: { moduleIds: [], sectionIds: ["sec-z"] }, certificatesIssued: 0, draftDiscarded: false }) });
    });

    await page.goto(LIST);
    const rowA = listRow(page);
    const rowB = page.locator("#coursesTableBody tr").filter({ hasText: "Ledelse" });
    await clickAction(page, rowA.locator('[data-action="archive"]'));
    await clickAction(page, rowB.locator('[data-action="archive"]'));
    const dialog = page.locator("#courseArchiveDialog");
    await expect(page.locator("#courseArchiveTitle")).toHaveText("Arkiver «Ledelse»");
    slow.release();
    await expect.poll(() => slowAnswered).toBe(true);
    // Litt tid for klienten til å (ikke) tegne det gamle svaret.
    await page.waitForTimeout(300);
    await expect(page.locator("#courseArchiveTitle")).toHaveText("Arkiver «Ledelse»");
    await expect(part(dialog, "follows").locator("li")).toHaveCount(1);
    // Knappen til det første kurset virker igjen.
    await expect(rowA.locator('[data-action="archive"]')).toBeEnabled();
    await page.locator("#courseArchiveConfirmBtn").click();
    await expect.poll(() => archived.length).toBe(1);
    expect(archived[0]).toBe("/api/admin/content/courses/course-2/archive");
  });

  test("to klikk på «Gjenopprett» mens forhåndsvisningen laster: det eldste svaret vises ikke", async ({ page }) => {
    const archivedAt = "2026-11-10T12:00:00.000Z";
    const state = await mockCommonApis(page, {
      courses: [course({ archivedAt, publishedAt: null }) as never, course({ id: "course-2", archivedAt, publishedAt: null, title: { "en-GB": "Ledelse", nb: "Ledelse", nn: "Ledelse" } }) as never],
      libraryModules: [],
    });
    await locale(page, "nb");
    await mockLifecycle(page, state as never);
    const slow = holdBack();
    let slowAnswered = false;
    await page.route("**/api/admin/content/courses/*/restore-preview", async (route: Route) => {
      const courseId = new URL(route.request().url()).pathname.split("/").slice(-2)[0];
      if (courseId === "course-1") {
        await slow.released;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(RESTORE_PREVIEW) });
        slowAnswered = true;
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courseId: "course-2", courseTitle: "Ledelse", archived: true, returns: [], staysArchived: [] }) });
    });
    const restored: string[] = [];
    await page.route("**/api/admin/content/courses/*/restore", async (route: Route) => {
      restored.push(new URL(route.request().url()).pathname);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ course: { id: "x" }, returns: [], staysArchived: [] }) });
    });

    await page.goto(LIST);
    await page.locator('.list-filter-btn[data-filter="archived"]').click();
    const rowA = listRow(page);
    const rowB = page.locator("#coursesTableBody tr").filter({ hasText: "Ledelse" });
    await clickAction(page, rowA.locator('[data-action="restore"]'));
    await clickAction(page, rowB.locator('[data-action="restore"]'));
    await expect(page.locator("#courseRestoreTitle")).toHaveText("Gjenopprett «Ledelse»");
    slow.release();
    await expect.poll(() => slowAnswered).toBe(true);
    await page.waitForTimeout(300);
    await expect(page.locator("#courseRestoreTitle")).toHaveText("Gjenopprett «Ledelse»");
    await expect(part(page.locator("#courseRestoreDialog"), "returns").locator("li")).toHaveCount(0);
    await expect(rowA.locator('[data-action="restore"]')).toBeEnabled();
    await page.locator("#courseRestoreConfirmBtn").click();
    await expect.poll(() => restored.length).toBe(1);
    expect(restored[0]).toBe("/api/admin/content/courses/course-2/restore");
  });

  test("Esc mens dialogen henter på nytt etter 409: den åpner seg ikke igjen", async ({ page }) => {
    const { calls } = await setup(page, {}, {
      archive: [{ status: 409, body: { error: "course_archive_preview_changed", message: "x", details: { inProgressCount: 4, follows: { moduleIds: [], sectionIds: [] } } } }],
    });
    const second = holdBack();
    let previews = 0;
    let secondAnswered = false;
    await page.route("**/api/admin/content/courses/*/archive-preview", async (route: Route) => {
      previews += 1;
      if (previews >= 2) {
        await second.released;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...FULL_PREVIEW, inProgressCount: 4 }) });
        secondAnswered = true;
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FULL_PREVIEW) });
    });
    const dialog = await openArchiveFromList(page);
    await page.locator("#courseArchiveConfirmBtn").click();
    await expect.poll(() => previews).toBe(2);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    second.release();
    await expect.poll(() => secondAnswered).toBe(true);
    await page.waitForTimeout(300);
    await expect(dialog).toBeHidden();
    expect(calls.posts).toHaveLength(1);
    await expect(listRow(page).locator('[data-action="archive"]')).toBeEnabled();
  });

  test("404 course_not_found på forhåndsvisningen er en feil, ikke en gammel tjener (begge dialogene)", async ({ page }) => {
    const notFound = { status: 404, body: { error: "course_not_found", message: "Course not found." } };
    const { calls } = await setup(page, {}, { previews: [notFound] });
    const confirms: string[] = [];
    page.on("dialog", (d) => { confirms.push(d.message()); void d.dismiss(); });
    await page.goto(LIST);
    await clickAction(page, listRow(page).locator('[data-action="archive"]'));
    await expect(page.locator(".toast--error")).toBeVisible();
    await expect(page.locator("#courseArchiveDialog")).toBeHidden();
    await expect(listRow(page).locator('[data-action="archive"]')).toBeEnabled();
    expect(confirms).toHaveLength(0);
    expect(calls.posts).toHaveLength(0);
  });

  test("404 course_not_found på gjenopprett-forhåndsvisningen: feilen vises, ingenting gjenopprettes", async ({ page }) => {
    const { calls } = await setup(page, { archivedAt: "2026-11-10T12:00:00.000Z", publishedAt: null }, { restorePreview: { status: 404, body: { error: "course_not_found", message: "Course not found." } } });
    await page.goto(LIST);
    await page.locator('.list-filter-btn[data-filter="archived"]').click();
    await clickAction(page, listRow(page).locator('[data-action="restore"]'));
    await expect(page.locator(".toast--error")).toBeVisible();
    await expect(page.locator("#courseRestoreDialog")).toBeHidden();
    await expect(listRow(page).locator('[data-action="restore"]')).toBeEnabled();
    expect(calls.posts).toHaveLength(0);
  });

  test("arkivert kurs med et gammelt lagret utkast: bare linja om arkivet, og «Forkast utkast» finnes", async ({ page }) => {
    await setup(page, { archivedAt: "2026-11-10T12:00:00.000Z", publishedAt: null, hasDraft: true });
    await page.route("**/api/admin/content/courses/course-1/draft", (route: Route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft: { id: "draft-1", revision: 2, updatedByName: "Kari Nordmann", updatedAt: "2026-11-01T08:00:00.000Z", items: [{ type: "MODULE", moduleId: "mod-a", sectionId: null, sortOrder: 0, title: "Modul A", discussionsEnabled: true, archivedAt: "2026-11-10T12:00:00.000Z" }] } }),
    }));
    await page.goto(DETAIL);
    await expect(page.locator("[data-course-archived-notice]")).toBeVisible();
    await expect(page.locator("[data-course-draft-notice]")).toHaveCount(0);
    await expect(headerAction(page, "discard-draft")).toHaveCount(1);
  });
});
