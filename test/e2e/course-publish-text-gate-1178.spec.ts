import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

// #1178 skive 2 (prinsipp 4, doc/design/PLAN_1178_KURS_PUBLISERINGSPORT.md): publiseringen avvises når kursets navn eller
// beskrivelse mangler et språk (`422 course_translation_incomplete`, `details.issues`), og meldingen har «Fyll inn det som
// mangler». Knappen oversetter bare hullene, lagrer og publiserer på nytt med de samme svarene.
//
// Svarene er bygget etter serverkoden (src/modules/course/courseTextGate.ts, src/routes/adminCourses.ts): feilkroppen er
// `{ error, message, details: { issues: [{ code, field, missingLocales }] } }`; `PUT /courses/:id` krever `expectedRevision`
// og svarer 409 `course_changed` når telleren er en annen; `PUT …/draft` krever utkastets id og teller.

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const LOCALES = ["nb", "nn", "en-GB"] as const;
type Map3 = Partial<Record<(typeof LOCALES)[number], string>>;

/** Det porten på tjeneren svarer for et navn og en beskrivelse (samme regel: tom beskrivelse er komplett). */
function gateIssues(title: Map3, description: Map3 | null) {
  const missing = (map: Map3) => [...LOCALES].filter((l) => !String(map[l] ?? "").trim()).sort();
  const issues: Array<{ code: string; field: string; missingLocales: string[] }> = [];
  if (missing(title).length > 0) issues.push({ code: "translation_incomplete", field: "title", missingLocales: missing(title) });
  const hasDescription = description && Object.values(description).some((v) => String(v ?? "").trim());
  if (hasDescription && missing(description!).length > 0) {
    issues.push({ code: "translation_incomplete", field: "description", missingLocales: missing(description!) });
  }
  return issues;
}

const gateError = (issues: unknown[]) => ({
  error: "course_translation_incomplete",
  message: "The course name or description is missing in one or more languages.",
  details: { issues },
});

type Oversettingskall = { title?: string; description?: string; sourceLocale?: string; targetLocale?: string };

async function oversetter(page: Page) {
  const kall: Oversettingskall[] = [];
  await page.route("**/api/admin/content/courses/localize-copy", async (route: Route) => {
    const body = route.request().postDataJSON() as Oversettingskall;
    kall.push(body);
    await json(route, 200, {
      ...(body.title ? { title: `${body.title} [${body.targetLocale}]` } : {}),
      ...(body.description ? { description: `${body.description} [${body.targetLocale}]` } : {}),
    });
  });
  return kall;
}

async function locale(page: Page, value: string) {
  await page.addInitScript((loc) => { try { localStorage.setItem("participant.locale", loc); } catch { /* ignore */ } }, value);
}

// ── Vei 1: «Publiser» på et kurs som ikke er publisert (fra lista) ─────────────────────────────────────────────────────────

async function upublisertKurs(page: Page, { putStatus = 200 } = {}) {
  const course = {
    id: "course-1",
    title: { nb: "Arbeidsmiljø" } as Map3,
    // Beskrivelsen mangler bare engelsk. Den nynorske er skrevet for hånd og skal stå når navnet fylles inn på nynorsk.
    description: { nb: "Om arbeidsmiljø", nn: "Om arbeidsmiljø nn" } as Map3,
    certificationLevel: "basic",
    moduleCount: 1,
    updatedAt: "2026-11-13T12:00:00.000Z",
    publishedAt: null as string | null,
    archivedAt: null,
    modules: [{ moduleId: "mod-a", sortOrder: 0, moduleTitle: "Modul A" }],
    contentRevision: 3,
  };
  const state = await mockCommonApis(page, { courses: [course as never] });
  await locale(page, "nb");
  const server = state.mutableCourses.find((c) => c.id === "course-1") as unknown as typeof course;
  const calls = { publish: [] as unknown[], put: [] as Array<Record<string, unknown>> };
  await page.route("**/api/admin/content/courses/course-1/publish", async (route: Route) => {
    calls.publish.push(route.request().postDataJSON());
    const issues = gateIssues(server.title, server.description);
    if (issues.length > 0) return json(route, 422, gateError(issues));
    server.publishedAt = "2026-11-25T12:00:00.000Z";
    return json(route, 200, { course: server, publishedItems: [] });
  });
  await page.route((url) => url.pathname === "/api/admin/content/courses/course-1", async (route: Route) => {
    if (route.request().method() === "GET") return json(route, 200, { course: server });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    calls.put.push(body);
    if (putStatus !== 200) return json(route, putStatus, { error: "course_changed", message: "Someone else saved this course after you opened it.", details: {} });
    if (body.expectedRevision !== server.contentRevision) return json(route, 409, { error: "course_changed", message: "x", details: {} });
    if (body.title) server.title = body.title as Map3;
    if (body.description) server.description = body.description as Map3;
    server.contentRevision += 1;
    return json(route, 200, { course: server });
  });
  const kall = await oversetter(page);
  return { server, calls, kall };
}

async function publiserFraLista(page: Page) {
  await page.goto("/admin-content/courses");
  const button = page.locator("#coursesTableBody tr").filter({ hasText: "Arbeidsmiljø" }).locator('[data-action="publish"]');
  await (await revealRowAction(page, button)).click();
  await expect(page.locator("#cascadePublishDialog")).toBeVisible();
  await page.locator("#cascadePublishConfirmBtn").click();
}

test.describe("#1178 — publiseringsporten for kursets navn og beskrivelse", () => {
  test("«Publiser» avvises når navnet mangler språk; «Fyll inn» oversetter bare hullene, lagrer og publiserer", async ({ page }) => {
    const { server, calls, kall } = await upublisertKurs(page);
    await publiserFraLista(page);

    const toast = page.locator(".toast").filter({ hasText: "Kan ikke publisere — kurset mangler navnet" });
    await expect(toast).toBeVisible();
    expect(calls.publish).toHaveLength(1);
    expect(kall, "ingenting oversettes før forfatteren ber om det").toEqual([]);

    await toast.getByRole("button", { name: "Fyll inn det som mangler" }).click();

    await expect(page.locator(".toast--success").filter({ hasText: "Det som manglet, er fylt inn, lagret og publisert." })).toBeVisible();
    // Bare hullene, fra bokmål: navnet til nynorsk og engelsk, beskrivelsen bare til engelsk. Den nynorske beskrivelsen sendes
    // ikke til oversetting.
    const perMål = Object.fromEntries(kall.map((k) => [`${k.sourceLocale}>${k.targetLocale}`, Object.keys(k).filter((key) => key === "title" || key === "description").sort()]));
    expect(perMål).toEqual({ "nb>nn": ["title"], "nb>en-GB": ["description", "title"] });
    expect(calls.put).toHaveLength(1);
    expect(calls.put[0]).toEqual({
      title: { nb: "Arbeidsmiljø", nn: "Arbeidsmiljø [nn]", "en-GB": "Arbeidsmiljø [en-GB]" },
      description: { nb: "Om arbeidsmiljø", nn: "Om arbeidsmiljø nn", "en-GB": "Om arbeidsmiljø [en-GB]" },
      expectedRevision: 3,
    });
    // Publisert på nytt, med det samme forfatteren svarte første gang.
    expect(calls.publish).toHaveLength(2);
    expect(calls.publish[1]).toEqual(calls.publish[0]);
    expect(server.publishedAt).not.toBeNull();
  });

  test("har noen andre lagret kurset under utfyllingen (409), publiseres ingenting", async ({ page }) => {
    const { server, calls } = await upublisertKurs(page, { putStatus: 409 });
    await publiserFraLista(page);
    const toast = page.locator(".toast").filter({ hasText: "Kan ikke publisere — kurset mangler navnet" });
    await toast.getByRole("button", { name: "Fyll inn det som mangler" }).click();

    await expect(page.locator(".toast--error").last()).toBeVisible();
    expect(calls.put).toHaveLength(1);
    expect(calls.publish, "ingen ny publisering etter en avvist lagring").toHaveLength(1);
    expect(server.publishedAt).toBeNull();
  });

  // ── Vei 3: «Publiser utkastet» ──────────────────────────────────────────────────────────────────────────────────────────

  test("«Publiser utkastet» avvises når utkastets navn mangler nynorsk; «Fyll inn» fyller bare nynorsk og publiserer utkastet", async ({ page }) => {
    const API = "/api/admin/content/courses/course-1";
    const published = {
      id: "course-1",
      title: { nb: "Generativ KI", nn: "Generativ KI", "en-GB": "Generative AI" } as Map3,
      description: null,
      certificationLevel: "basic",
      enrollmentPolicy: "OPEN",
      discussionsEnabled: true,
      discussionOwnerNotifications: true,
      slug: "generativ-ki",
      sortOrder: null,
      themeIds: [],
      moduleCount: 1,
      updatedAt: "2026-11-10T12:00:00.000Z",
      publishedAt: "2026-10-11T12:00:00.000Z",
      archivedAt: null,
      versionMajor: 3,
      versionMinor: 1,
      certificateHolders: 0,
      majorEmailRecipients: 0,
      contentRevision: 5,
      modules: [{ moduleId: "mod-a", sortOrder: 0, moduleTitle: "Modul A" }],
    };
    // Utkastet har nytt navn på bokmål og engelsk; nynorsk ble tømt da oversettingen ikke kom (skive 1).
    let draft: { id: string; revision: number; title: Map3 } | null = { id: "draft-1", revision: 2, title: { nb: "Generativ KI i dag", "en-GB": "Generative AI today" } };
    const detail = () => ({ ...published, hasDraft: draft != null, lifecycle: draft ? "published_with_draft" : "published" });
    const draftBody = () => ({
      id: draft!.id, revision: draft!.revision, source: "form", updatedById: "u", updatedByName: "Content Owner", updatedAt: "2026-11-25T09:00:00.000Z",
      course: {
        title: JSON.stringify(draft!.title), description: null, certificationLevel: "basic", enrollmentPolicy: "OPEN",
        discussionsEnabled: true, discussionOwnerNotifications: true, sortOrder: null, themeIds: [],
      },
      items: [{ type: "MODULE", sortOrder: 0, moduleId: "mod-a", sectionId: null, title: "Modul A", discussionsEnabled: true, archivedAt: null, unpublished: false, missing: false }],
    });
    await mockCommonApis(page, { courses: [detail() as never], libraryModules: [] });
    await locale(page, "nb");
    const calls = { saveDraft: [] as Array<Record<string, unknown>>, publishDraft: [] as Array<Record<string, unknown>> };
    await page.route((url) => url.pathname === API, (route) => json(route, 200, { course: detail() }));
    await page.route((url) => url.pathname === `${API}/items`, (route) =>
      json(route, 200, { items: [{ id: "ci-a", type: "MODULE", sortOrder: 0, moduleId: "mod-a", sectionId: null, title: "Modul A", discussionsEnabled: true, archivedAt: null }] }));
    await page.route((url) => url.pathname === `${API}/draft`, async (route) => {
      if (route.request().method() === "GET") return draft ? json(route, 200, { draft: draftBody() }) : json(route, 404, { error: "course_draft_not_found" });
      const body = route.request().postDataJSON() as { title?: Map3; loaded: { draftId?: string; revision?: number } };
      calls.saveDraft.push(body as Record<string, unknown>);
      if (!draft || body.loaded.draftId !== draft.id || body.loaded.revision !== draft.revision) return json(route, 409, { error: "course_draft_changed", message: "x" });
      draft = { id: draft.id, revision: draft.revision + 1, title: body.title ?? draft.title };
      return json(route, 200, { draft: draftBody() });
    });
    await page.route((url) => url.pathname === `${API}/draft/publish`, async (route) => {
      const body = route.request().postDataJSON() as { loaded: { draftId: string; revision: number } };
      calls.publishDraft.push(body as Record<string, unknown>);
      if (!draft || body.loaded.draftId !== draft.id || body.loaded.revision !== draft.revision) return json(route, 409, { error: "course_draft_changed", message: "x" });
      const issues = gateIssues(draft.title, null);
      if (issues.length > 0) return json(route, 422, gateError(issues));
      published.title = draft.title;
      draft = null;
      return json(route, 200, { course: published });
    });
    const kall = await oversetter(page);

    await page.goto("/admin-content/courses/course-1");
    await expect(page.locator("#title-nb")).toHaveValue("Generativ KI i dag");
    await page.locator("#publishCourseDraftBtn").click();
    await expect(page.locator("#cascadePublishDialog")).toBeVisible();
    await page.locator("#cascadePublishConfirmBtn").click();

    const toast = page.locator(".toast").filter({ hasText: "Kan ikke publisere — kurset mangler navnet" });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Fyll inn det som mangler" }).click();

    await expect(page.locator(".toast--success").filter({ hasText: /publisert/i }).first()).toBeVisible();
    // Bare hullet. Lagringen oversetter ikke videre fra det utfylte språket (`skipTranslation`).
    expect(kall.map((k) => `${k.sourceLocale}>${k.targetLocale}`)).toEqual(["nb>nn"]);
    expect(calls.saveDraft).toHaveLength(1);
    expect(calls.saveDraft[0]?.title).toEqual({ nb: "Generativ KI i dag", nn: "Generativ KI i dag [nn]", "en-GB": "Generative AI today" });
    expect(calls.saveDraft[0]?.loaded).toEqual({ draftId: "draft-1", revision: 2 });
    expect(calls.publishDraft).toHaveLength(2);
    expect(calls.publishDraft[1]?.loaded).toEqual({ draftId: "draft-1", revision: 3 });
    expect(published.title).toEqual({ nb: "Generativ KI i dag", nn: "Generativ KI i dag [nn]", "en-GB": "Generative AI today" });
  });
});
