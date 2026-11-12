import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { mockCommonApis } from "./admin-content-helpers.js";

// #1140 etappe 2, skive 2c: kursbyggeren lagrer et publisert kurs til utkastet (doc/design/PLAN_1140_E2.md, tabellen under
// «Skive 2c: kursbyggeren»; doc/DECISIONS.md, «Ingen bryter, og mest mulig likt moduler»). Én test (minst) per rad i tabellen.
//
// ⚠️ Svarene under er bygget etter doc/API_REFERENCE.md og serverkoden (src/routes/adminCourses.ts, «#1140 etappe 2», og
// src/modules/course/courseDraft.ts), ikke etter hva klienten forventer:
//   - kursdetaljen har `hasDraft` og `lifecycle` (`published_with_draft` når et publisert kurs har utkast)
//   - `GET …/draft` gir `{ draft: { id, revision, source, updatedById, updatedByName, updatedAt, course: {…}, items: [{ type,
//     sortOrder, moduleId, sectionId, title, discussionsEnabled, archivedAt, unpublished, missing }] } }`, der tekstfeltene i
//     `course` er lagret tekst (JSON-strengen `localizedTextCodec.serialize` gir), og 404 `course_draft_not_found` uten utkast
//   - `PUT …/draft` svarer `{ draft }` som `GET`; telleren øker med én; et nytt utkast starter på 1
//   - `DELETE …/draft?draftId=…&revision=…` svarer 204
//   - `POST …/draft/publish` svarer `{ course }` (kursraden etter økningen)
//   - feil: `{ error, message, details }` (src/middleware/errorHandling.ts)

const COURSE_URL = "/admin-content/courses/course-1";
const API = "/api/admin/content/courses/course-1";

const TITLE = { nb: "Generativ KI", nn: "Generativ KI", "en-GB": "Generative AI" };

type Item = { type: "MODULE" | "SECTION"; id: string; title: string };

const PUBLISHED_ITEMS: Item[] = [
  { type: "MODULE", id: "mod-a", title: "Modul A" },
  { type: "SECTION", id: "sec-b", title: "Seksjon B" },
];

type DraftItemFlags = { archivedAt?: string | null; unpublished?: boolean; missing?: boolean };

type ServerState = {
  course: Record<string, unknown>;
  published: Item[];
  draft: null | {
    id: string;
    revision: number;
    updatedByName: string | null;
    updatedAt: string;
    title: Record<string, string>;
    items: Array<Item & DraftItemFlags>;
  };
  requests: Array<{ method: string; path: string; search: string; body: unknown }>;
  // Svar som skal gis én gang på neste kall til ruta (status + kropp), før den vanlige oppførselen.
  failNext: Partial<Record<"saveDraft" | "publish" | "discard" | "getDraft", { status: number; body: unknown }>>;
};

function courseRow(state: ServerState, overrides: Record<string, unknown> = {}) {
  return { ...state.course, ...overrides };
}

function detail(state: ServerState) {
  const published = state.course.publishedAt != null;
  const archived = state.course.archivedAt != null;
  const hasDraft = state.draft != null;
  return {
    ...state.course,
    hasDraft,
    lifecycle: archived ? "archived" : published ? (hasDraft ? "published_with_draft" : "published") : "draft",
  };
}

function itemsBody(items: Item[]) {
  return items.map((item, index) => ({
    id: `ci-${item.id}`,
    type: item.type,
    sortOrder: index,
    moduleId: item.type === "MODULE" ? item.id : null,
    sectionId: item.type === "SECTION" ? item.id : null,
    title: item.title,
    discussionsEnabled: true,
    archivedAt: null,
  }));
}

function draftBody(state: ServerState) {
  const draft = state.draft!;
  return {
    id: draft.id,
    revision: draft.revision,
    source: "form",
    updatedById: "user-kari",
    updatedByName: draft.updatedByName,
    updatedAt: draft.updatedAt,
    course: {
      // Lagret tekst, som kursraden: localizedTextCodec.serialize gir JSON-strengen for et språkkart.
      title: JSON.stringify(draft.title),
      description: state.course.description ?? null,
      certificationLevel: state.course.certificationLevel,
      enrollmentPolicy: state.course.enrollmentPolicy,
      discussionsEnabled: state.course.discussionsEnabled,
      discussionOwnerNotifications: state.course.discussionOwnerNotifications,
      sortOrder: state.course.sortOrder ?? null,
      themeIds: [],
    },
    items: draft.items.map((item, index) => ({
      type: item.type,
      sortOrder: index,
      moduleId: item.type === "MODULE" ? item.id : null,
      sectionId: item.type === "SECTION" ? item.id : null,
      title: item.missing ? null : item.title,
      discussionsEnabled: true,
      archivedAt: item.archivedAt ?? null,
      unpublished: item.unpublished === true,
      missing: item.missing === true,
    })),
  };
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Tittelen og elementene fra en lagret kropp, slik serveren lagrer dem. */
function itemsFromBody(body: { items?: Array<{ type: "MODULE" | "SECTION"; moduleId?: string; sectionId?: string }> }, known: Item[]): Item[] {
  return (body.items ?? []).map((item) => {
    const id = (item.type === "MODULE" ? item.moduleId : item.sectionId) as string;
    return { type: item.type, id, title: known.find((k) => k.id === id)?.title ?? id };
  });
}

type Setup = {
  course?: Record<string, unknown>;
  draft?: ServerState["draft"];
  locale?: string;
  failNext?: ServerState["failNext"];
};

async function openBuilder(page: Page, setup: Setup = {}) {
  const state: ServerState = {
    course: {
      id: "course-1",
      title: TITLE,
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
      ...(setup.course ?? {}),
    },
    published: [...PUBLISHED_ITEMS],
    draft: setup.draft ?? null,
    requests: [],
    failNext: { ...(setup.failNext ?? {}) },
  };
  const known: Item[] = [...PUBLISHED_ITEMS, { type: "MODULE", id: "mod-c", title: "Modul C" }];
  await mockCommonApis(page, { courses: [detail(state) as never], libraryModules: [] });
  const locale = setup.locale ?? "nb";
  await page.addInitScript((loc) => { try { localStorage.setItem("participant.locale", loc); } catch { /* ignore */ } }, locale);

  const record = (route: Route) => {
    const url = new URL(route.request().url());
    const raw = route.request().postData();
    state.requests.push({ method: route.request().method(), path: url.pathname, search: url.search, body: raw ? JSON.parse(raw) : null });
  };

  await page.route((url) => url.pathname === API, async (route) => {
    if (route.request().method() !== "GET") {
      record(route);
      return json(route, 500, { error: "unexpected_write" });
    }
    return json(route, 200, { course: detail(state) });
  });
  await page.route((url) => url.pathname === `${API}/items`, async (route) => {
    if (route.request().method() !== "GET") {
      record(route);
      return json(route, 500, { error: "unexpected_write" });
    }
    return json(route, 200, { items: itemsBody(state.published) });
  });
  await page.route((url) => url.pathname === `${API}/content`, async (route) => {
    record(route);
    // Låsen (claimCourseRevision): med et utkast liggende avvises direkte lagring.
    if (state.draft) return json(route, 409, { error: "course_has_draft", message: "This course has a draft. Publish or discard the draft first; nothing was saved.", details: { courseId: "course-1" } });
    return json(route, 200, { course: courseRow(state) });
  });
  await page.route((url) => url.pathname === `${API}/draft`, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      const fail = state.failNext.getDraft;
      if (fail) { delete state.failNext.getDraft; return json(route, fail.status, fail.body); }
      if (!state.draft) return json(route, 404, { error: "course_draft_not_found", message: "This course has no draft." });
      return json(route, 200, { draft: draftBody(state) });
    }
    record(route);
    if (method === "PUT") {
      const fail = state.failNext.saveDraft;
      if (fail) { delete state.failNext.saveDraft; return json(route, fail.status, fail.body); }
      const body = route.request().postDataJSON() as { title?: Record<string, string>; items?: never; loaded: { draftId?: string; revision?: number; expectedRevision?: number } };
      if (state.course.publishedAt == null) return json(route, 409, { error: "course_draft_requires_published", message: "Only a published course has a draft.", details: { courseId: "course-1" } });
      if ("draftId" in body.loaded) {
        if (!state.draft || state.draft.id !== body.loaded.draftId || state.draft.revision !== body.loaded.revision) {
          return json(route, 409, { error: "course_draft_changed", message: "Someone else saved, published or discarded the draft after you opened the course. Reload the page; nothing was saved.", details: { courseId: "course-1", loadedDraftId: body.loaded.draftId, loadedRevision: body.loaded.revision, currentRevision: state.draft?.revision ?? null } });
        }
      } else {
        if (state.draft) return json(route, 409, { error: "course_draft_changed", message: "x", details: { courseId: "course-1", loadedDraftId: null, currentRevision: state.draft.revision } });
        if (state.course.contentRevision !== body.loaded.expectedRevision) {
          return json(route, 409, { error: "course_changed", message: "Someone else saved this course after you opened it.", details: { expectedRevision: body.loaded.expectedRevision, currentRevision: state.course.contentRevision } });
        }
      }
      state.draft = {
        id: state.draft?.id ?? "draft-new",
        revision: (state.draft?.revision ?? 0) + 1,
        updatedByName: "Content Owner",
        updatedAt: "2026-11-12T09:30:00.000Z",
        title: body.title ?? (state.course.title as Record<string, string>),
        items: itemsFromBody(route.request().postDataJSON(), known),
      };
      return json(route, 200, { draft: draftBody(state) });
    }
    if (method === "DELETE") {
      const fail = state.failNext.discard;
      if (fail) { delete state.failNext.discard; return json(route, fail.status, fail.body); }
      const url = new URL(route.request().url());
      if (!state.draft || state.draft.id !== url.searchParams.get("draftId") || String(state.draft.revision) !== url.searchParams.get("revision")) {
        return json(route, 409, { error: "course_draft_changed", message: "x", details: { courseId: "course-1" } });
      }
      state.draft = null;
      return route.fulfill({ status: 204, body: "" });
    }
    return json(route, 405, { error: "method_not_allowed" });
  });
  await page.route((url) => url.pathname === `${API}/draft/publish`, async (route) => {
    record(route);
    const fail = state.failNext.publish;
    if (fail) { delete state.failNext.publish; return json(route, fail.status, fail.body); }
    const body = route.request().postDataJSON() as { loaded: { draftId: string; revision: number }; version?: string };
    if (!state.draft || state.draft.id !== body.loaded.draftId || state.draft.revision !== body.loaded.revision) {
      return json(route, 409, { error: "course_draft_changed", message: "x", details: { courseId: "course-1" } });
    }
    const listChanged = state.draft.items.map((i) => i.id).join("|") !== state.published.map((i) => i.id).join("|");
    const titleChanged = JSON.stringify(state.draft.title) !== JSON.stringify(state.course.title);
    if (listChanged && Number(state.course.certificateHolders) > 0 && !body.version) {
      return json(route, 400, { error: "course_version_required", message: "x", details: { certificateHolders: state.course.certificateHolders } });
    }
    if (listChanged || titleChanged) {
      if (body.version === "major" && Number(state.course.certificateHolders) > 0) state.course = { ...state.course, versionMajor: Number(state.course.versionMajor) + 1, versionMinor: 0 };
      else state.course = { ...state.course, versionMinor: Number(state.course.versionMinor) + 1 };
    }
    state.course = { ...state.course, title: state.draft.title, contentRevision: Number(state.course.contentRevision) + 1 };
    state.published = state.draft.items.map(({ type, id, title }) => ({ type, id, title }));
    state.draft = null;
    return json(route, 200, { course: courseRow(state) });
  });

  await page.goto(COURSE_URL);
  // Ikke `#title-nb`: med engelsk meny står det engelske språkpanelet åpent.
  await expect(page.locator("#comboboxInput")).toBeVisible();
  return state;
}

const writes = (state: ServerState) => state.requests;

function draftWith(items: Array<Item & DraftItemFlags>, overrides: Partial<NonNullable<ServerState["draft"]>> = {}): NonNullable<ServerState["draft"]> {
  return {
    id: "draft-1",
    revision: 2,
    updatedByName: "Kari Nordmann",
    updatedAt: "2026-11-12T08:12:00.000Z",
    title: { nb: "Generativ KI 2027", nn: "Generativ KI 2027", "en-GB": "Generative AI 2027" },
    items,
    ...overrides,
  };
}

const actions = (page: Page) => page.locator(".form-page-actions");

test.describe("#1140 skive 2c — kursbyggeren med utkast", () => {
  test("«Lagre» på et publisert kurs: PUT …/draft med feltene og loaded, ingen versjonsspørsmål, melding, og merket etter lagring", async ({ page }) => {
    // Med kursbevis og endret liste: før kom «Hva slags endring er dette?» her. Nå avgjøres versjonen når utkastet publiseres.
    const state = await openBuilder(page, { course: { certificateHolders: 42, majorEmailRecipients: 42 } });
    await expect(page.locator(".form-page-state .status-chip").first()).not.toHaveText("Nyere utkast");
    await expect(actions(page).locator('[data-action="publish-draft"]')).toHaveCount(0);

    await page.locator("#title-nb").fill("Generativ KI 2027");
    await page.locator('[data-move="down"][data-index="0"]').click();
    await page.locator("#formSaveBtn").click();

    await expect.poll(() => writes(state).length).toBe(1);
    await expect(page.locator("#courseVersionDialog")).toBeHidden();
    const sent = writes(state)[0];
    expect(sent.method).toBe("PUT");
    expect(sent.path).toBe(`${API}/draft`);
    const body = sent.body as Record<string, unknown>;
    expect(body.loaded).toEqual({ expectedRevision: 5 });
    expect((body.title as Record<string, string>).nb).toBe("Generativ KI 2027");
    expect(body).toMatchObject({ certificationLevel: "basic", enrollmentPolicy: "OPEN", discussionsEnabled: true, discussionOwnerNotifications: true, sortOrder: null });
    expect((body.items as Array<{ moduleId?: string; sectionId?: string }>).map((i) => i.moduleId ?? i.sectionId)).toEqual(["sec-b", "mod-a"]);
    // Ikke feltene som hører til direkte lagring: serveren avviser dem (skjemaet er strengt).
    expect(body).not.toHaveProperty("version");
    expect(body).not.toHaveProperty("expectedRevision");
    expect(body).not.toHaveProperty("confirmEmailRecipients");

    await expect(page.locator(".toast__message").first()).toHaveText("Utkast lagret.");
    await expect(page.locator(".toast__detail").first()).toHaveText("Deltakerne ser fortsatt versjon 3.1.");
    // Visningen er lastet på nytt: «Publisert» + «Nyere utkast», linja, og utkastets knapper.
    const status = page.locator(".form-page-state");
    await expect(status.locator(".status-badge")).toHaveText("Publisert");
    await expect(status.locator(".status-chip").first()).toHaveText("Nyere utkast");
    await expect(page.locator("[data-course-draft-line]")).toContainText("Utkast lagret av Content Owner");
    await expect(page.locator("[data-course-draft-line]")).toContainText("Deltakerne ser versjon 3.1 til utkastet er publisert.");
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
    await expect(actions(page).locator('[data-action="publish-draft"]')).toHaveText("Publiser utkastet");
    await expect(actions(page).locator('[data-action="discard-draft"]')).toHaveText("Forkast utkast");
    // Ingenting gikk til den direkte lagringen.
    expect(writes(state).filter((w) => w.path.endsWith("/content"))).toHaveLength(0);
  });

  test("et kurs som ikke er publisert, lagres direkte som før (PUT …/content), aldri til utkastet", async ({ page }) => {
    const state = await openBuilder(page, { course: { publishedAt: null } });
    await page.locator("#title-nb").fill("Generativ KI — nytt navn");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => writes(state).length).toBe(1);
    expect(writes(state)[0].path).toBe(`${API}/content`);
    expect(writes(state)[0].body).toMatchObject({ expectedRevision: 5 });
    await expect(actions(page).locator('[data-action="publish-draft"]')).toHaveCount(0);
  });

  test("åpne et kurs med utkast: skjemaet viser utkastet, linja sier hvem, og neste lagring sender utkastets id og teller", async ({ page }) => {
    const state = await openBuilder(page, {
      draft: draftWith([
        { type: "SECTION", id: "sec-b", title: "Seksjon B" },
        { type: "MODULE", id: "mod-a", title: "Modul A" },
        { type: "MODULE", id: "mod-c", title: "Modul C" },
      ]),
    });
    await expect(page.locator("#title-nb")).toHaveValue("Generativ KI 2027");
    // Overskriften følger skjemaet, altså utkastets navn, også før noen har skrevet i feltet (ikke det publiserte «Generativ KI»).
    await expect(page.locator("#formPageTitle")).toHaveText("Generativ KI 2027");
    await expect(page.locator("#moduleList .form-row-title")).toHaveText(["Seksjon B", "Modul A", "Modul C"]);
    // «Ulagrede endringer» måles mot utkastet: ingenting er endret ennå.
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
    await expect(page.locator("#formSaveBtn")).toBeDisabled();
    await expect(page.locator(".form-page-state .status-badge")).toHaveText("Publisert");
    await expect(page.locator(".form-page-state .status-chip").first()).toHaveText("Nyere utkast");
    await expect(page.locator("[data-course-draft-line]")).toContainText("Utkast lagret av Kari Nordmann");
    await expect(page.locator("[data-course-draft-line]")).toContainText("Deltakerne ser versjon 3.1 til utkastet er publisert.");

    await page.locator("#title-nb").fill("Generativ KI 2028");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    await page.locator("#formSaveBtn").click();
    await expect.poll(() => writes(state).length).toBe(1);
    expect(writes(state)[0].path).toBe(`${API}/draft`);
    expect((writes(state)[0].body as { loaded: unknown }).loaded).toEqual({ draftId: "draft-1", revision: 2 });
    await expect(page.locator(".toast__message").first()).toHaveText("Utkast lagret.");
    await expect(page.locator("#title-nb")).toHaveValue("Generativ KI 2028");
  });

  test("linja uten navn på den som lagret (updatedByName er null)", async ({ page }) => {
    await openBuilder(page, { draft: draftWith(PUBLISHED_ITEMS, { updatedByName: null }) });
    const line = page.locator("[data-course-draft-line]");
    await expect(line).toContainText("Utkast lagret ");
    await expect(line).not.toContainText(" av ");
    await expect(line).toContainText("Deltakerne ser versjon 3.1 til utkastet er publisert.");
  });

  test("«Publiser utkastet» uten spørsmål: lista er som publisert (bare navnet endret), selv med kursbevis", async ({ page }) => {
    const state = await openBuilder(page, { course: { certificateHolders: 42, majorEmailRecipients: 42 }, draft: draftWith(PUBLISHED_ITEMS) });
    await actions(page).locator('[data-action="publish-draft"]').click();
    await expect.poll(() => writes(state).length).toBe(1);
    await expect(page.locator("#courseVersionDialog")).toBeHidden();
    expect(writes(state)[0].path).toBe(`${API}/draft/publish`);
    expect(writes(state)[0].body).toEqual({ loaded: { draftId: "draft-1", revision: 2 } });
    await expect(page.locator(".toast__message").first()).toHaveText("Utkastet er publisert.");
    await expect(page.locator(".toast__detail").first()).toHaveText("Deltakerne ser nå versjon 3.2.");
    // Lastet på nytt: ikke noe utkast lenger.
    await expect(page.locator(".form-page-state .status-chip").first()).not.toHaveText("Nyere utkast");
    await expect(page.locator("[data-course-draft-line]")).toHaveCount(0);
    await expect(actions(page).locator('[data-action="publish-draft"]')).toHaveCount(0);
    await expect(page.locator("#title-nb")).toHaveValue("Generativ KI 2027");
  });

  test("«Publiser utkastet» med spørsmål: lista endret og kursbevis gir dialogen med «Publiser som …», tellingene mot den publiserte lista, og svaret i kallet", async ({ page }) => {
    const state = await openBuilder(page, {
      course: { certificateHolders: 42, majorEmailRecipients: 42 },
      draft: draftWith([
        { type: "SECTION", id: "sec-b", title: "Seksjon B" },
        { type: "MODULE", id: "mod-a", title: "Modul A" },
        { type: "MODULE", id: "mod-c", title: "Modul C" },
      ]),
    });
    await actions(page).locator('[data-action="publish-draft"]').click();
    const dialog = page.locator("#courseVersionDialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#courseVersionTitle")).toHaveText("Hva slags endring er dette?");
    await expect(page.locator("#courseVersionText")).toHaveText(
      "«Generativ KI» er publisert som versjon 3.1. 42 deltakere har kursbevis for versjon 3. Endringen: 1 lagt til, 1 flyttet.",
    );
    await expect(page.locator("#courseVersionSaveBtn")).toHaveText("Publiser som 3.2");
    await dialog.locator('input[value="major"]').check();
    await expect(page.locator("#courseVersionSaveBtn")).toHaveText("Publiser som 4.0");
    expect(writes(state)).toHaveLength(0);
    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => writes(state).length).toBe(1);
    expect(writes(state)[0].body).toEqual({ loaded: { draftId: "draft-1", revision: 2 }, version: "major", confirmEmailRecipients: 42 });
    await expect(page.locator(".toast__detail").first()).toHaveText("Deltakerne ser nå versjon 4.0.");
  });

  test("«Publiser utkastet»: Avbryt i versjonsdialogen publiserer ingenting", async ({ page }) => {
    const state = await openBuilder(page, {
      course: { certificateHolders: 3 },
      draft: draftWith([{ type: "MODULE", id: "mod-a", title: "Modul A" }]),
    });
    await actions(page).locator('[data-action="publish-draft"]').click();
    await expect(page.locator("#courseVersionText")).toContainText("Endringen: 1 tatt ut.");
    await page.locator("#courseVersionCancelBtn").click();
    await expect(page.locator("#courseVersionDialog")).toBeHidden();
    await page.waitForTimeout(200);
    expect(writes(state)).toHaveLength(0);
  });

  test("400 course_version_required fra publiseringen (noen fikk kursbevis siden): dialogen vises, og publiseringen prøves igjen med svaret", async ({ page }) => {
    const state = await openBuilder(page, {
      course: { certificateHolders: 0 },
      draft: draftWith([{ type: "SECTION", id: "sec-b", title: "Seksjon B" }, { type: "MODULE", id: "mod-a", title: "Modul A" }]),
    });
    state.failNext.publish = { status: 400, body: { error: "course_version_required", message: "x", details: { certificateHolders: 2 } } };
    await actions(page).locator('[data-action="publish-draft"]').click();
    await expect(page.locator("#courseVersionDialog")).toBeVisible();
    await expect(page.locator("#courseVersionText")).toContainText("2 deltakere har kursbevis for versjon 3.");
    await page.locator("#courseVersionSaveBtn").click();
    await expect.poll(() => writes(state).length).toBe(2);
    expect(writes(state)[0].body).toEqual({ loaded: { draftId: "draft-1", revision: 2 } });
    expect(writes(state)[1].body).toEqual({ loaded: { draftId: "draft-1", revision: 2 }, version: "minor" });
    await expect(page.locator(".toast__message").first()).toHaveText("Utkastet er publisert.");
  });

  test("ulagrede endringer lagres før publisering, og publiseringen sender det nye utkastets teller", async ({ page }) => {
    const state = await openBuilder(page, { draft: draftWith(PUBLISHED_ITEMS) });
    await page.locator("#title-nb").fill("Generativ KI 2028");
    await actions(page).locator('[data-action="publish-draft"]').click();
    await expect.poll(() => writes(state).length).toBe(2);
    expect(writes(state)[0].method).toBe("PUT");
    expect(writes(state)[0].path).toBe(`${API}/draft`);
    expect((writes(state)[0].body as { title: Record<string, string> }).title.nb).toBe("Generativ KI 2028");
    expect((writes(state)[0].body as { loaded: unknown }).loaded).toEqual({ draftId: "draft-1", revision: 2 });
    expect(writes(state)[1].path).toBe(`${API}/draft/publish`);
    expect(writes(state)[1].body).toEqual({ loaded: { draftId: "draft-1", revision: 3 } });
    await expect(page.locator(".toast__message").first()).toHaveText("Utkastet er publisert.");
    await expect(page.locator("#title-nb")).toHaveValue("Generativ KI 2028");
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
  });

  test("lagringen før publiseringen feiler: ingenting publiseres, og skjemaet beholder det som er skrevet", async ({ page }) => {
    const state = await openBuilder(page, { draft: draftWith(PUBLISHED_ITEMS) });
    state.failNext.saveDraft = { status: 409, body: { error: "course_draft_changed", message: "x", details: { courseId: "course-1", loadedDraftId: "draft-1", loadedRevision: 2, currentRevision: 3 } } };
    await page.locator("#title-nb").fill("Mitt nye navn");
    await actions(page).locator('[data-action="publish-draft"]').click();
    await expect(page.locator("#formErrorBanner")).toContainText("Noen andre har endret utkastet etter at du åpnet kurset.");
    await page.waitForTimeout(200);
    expect(writes(state).map((w) => w.path)).toEqual([`${API}/draft`]);
    await expect(page.locator("#title-nb")).toHaveValue("Mitt nye navn");
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
  });

  test("«Forkast utkast»: bekreftelsen med planens tekst, DELETE med utkastets id og teller, melding, og skjemaet viser det publiserte", async ({ page }) => {
    const state = await openBuilder(page, { draft: draftWith(PUBLISHED_ITEMS) });
    const messages: string[] = [];
    page.once("dialog", async (dialog) => { messages.push(dialog.message()); await dialog.dismiss(); });
    await actions(page).locator('[data-action="discard-draft"]').click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toBe("Forkaste utkastet? Endringene som ikke er publisert, går tapt. Kurset deltakerne ser (versjon 3.1), endres ikke.");
    await page.waitForTimeout(200);
    expect(writes(state)).toHaveLength(0);

    page.once("dialog", (dialog) => dialog.accept());
    await actions(page).locator('[data-action="discard-draft"]').click();
    await expect.poll(() => writes(state).length).toBe(1);
    expect(writes(state)[0].method).toBe("DELETE");
    expect(writes(state)[0].path).toBe(`${API}/draft`);
    const query = new URLSearchParams(writes(state)[0].search);
    expect(query.get("draftId")).toBe("draft-1");
    expect(query.get("revision")).toBe("2");
    await expect(page.locator(".toast__message").first()).toHaveText("Utkastet er forkastet.");
    await expect(page.locator("#title-nb")).toHaveValue("Generativ KI");
    await expect(actions(page).locator('[data-action="discard-draft"]')).toHaveCount(0);
  });

  test("409 course_draft_changed ved lagring: banner, skjemaet beholder teksten, og Lagre virker fortsatt", async ({ page }) => {
    const state = await openBuilder(page, { draft: draftWith(PUBLISHED_ITEMS) });
    state.failNext.saveDraft = { status: 409, body: { error: "course_draft_changed", message: "Someone else saved, published or discarded the draft after you opened the course. Reload the page; nothing was saved.", details: { courseId: "course-1", loadedDraftId: "draft-1", loadedRevision: 2, currentRevision: 3 } } };
    await page.locator("#title-nb").fill("Mitt nye navn");
    await page.locator("#formSaveBtn").click();
    const banner = page.locator("#formErrorBanner");
    await expect(banner).toHaveText("Noen andre har endret utkastet etter at du åpnet kurset. Ingenting ble lagret. Kopier det du skrev om du trenger det, last siden på nytt og gjør endringen igjen.");
    await expect(page.locator("#title-nb")).toHaveValue("Mitt nye navn");
    await expect(page.locator("#formSaveBtn")).toBeEnabled();
    await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
    expect(writes(state)).toHaveLength(1);
  });

  test("409-kodene vises på brukerens språk (engelsk)", async ({ page }) => {
    const state = await openBuilder(page, { locale: "en-GB" });
    state.failNext.saveDraft = { status: 409, body: { error: "course_draft_changed", message: "server text", details: { courseId: "course-1" } } };
    // Med engelsk meny står det engelske språkpanelet åpent.
    await page.locator("#title-en-GB").fill("My new name");
    await page.locator("#formSaveBtn").click();
    await expect(page.locator("#formErrorBanner")).toHaveText("Someone else changed the draft after you opened the course. Nothing was saved. Copy what you wrote if you need it, reload the page and make your change again.");
  });

  for (const [code, nb] of [
    ["course_has_draft", "Kurset har et utkast som ikke er publisert. Ingenting ble lagret. Publiser eller forkast utkastet i kursbyggeren først."],
    ["course_draft_requires_published", "Kurset er ikke publisert lenger, så utkastet kan ikke lagres eller publiseres."],
    ["course_changed", "Noen andre har lagret kurset etter at du åpnet det. Ingenting ble lagret."],
  ] as const) {
    test(`409 ${code} ved lagring vises i feilbanneret på bokmål, og skjemaet beholder teksten`, async ({ page }) => {
      const state = await openBuilder(page);
      state.failNext.saveDraft = { status: 409, body: { error: code, message: "server text", details: { courseId: "course-1" } } };
      await page.locator("#title-nb").fill("Mitt nye navn");
      await page.locator("#formSaveBtn").click();
      await expect(page.locator("#formErrorBanner")).toContainText(nb);
      await expect(page.locator("#title-nb")).toHaveValue("Mitt nye navn");
    });
  }

  test("409 course_draft_changed ved publisering og forkasting: banner, ingenting lastes på nytt", async ({ page }) => {
    const state = await openBuilder(page, { draft: draftWith(PUBLISHED_ITEMS) });
    state.failNext.publish = { status: 409, body: { error: "course_draft_changed", message: "x", details: { courseId: "course-1" } } };
    await actions(page).locator('[data-action="publish-draft"]').click();
    await expect(page.locator("#formErrorBanner")).toContainText("Noen andre har endret utkastet etter at du åpnet kurset.");

    state.failNext.discard = { status: 409, body: { error: "course_draft_changed", message: "x", details: { courseId: "course-1" } } };
    page.once("dialog", (dialog) => dialog.accept());
    await actions(page).locator('[data-action="discard-draft"]').click();
    await expect.poll(() => writes(state).length).toBe(2);
    await expect(page.locator("#formErrorBanner")).toContainText("Noen andre har endret utkastet etter at du åpnet kurset.");
    // Utkastet står fortsatt i skjemaet.
    await expect(page.locator("#title-nb")).toHaveValue("Generativ KI 2027");
  });

  test("published_with_draft: hodet har «Avpubliser», ikke «Publiser», og utkastets knapper kommer rett etter Lagre og Avbryt", async ({ page }) => {
    await openBuilder(page, { draft: draftWith(PUBLISHED_ITEMS) });
    const row = actions(page);
    await expect(row.locator('[data-action="unpublish"]')).toHaveCount(1);
    await expect(row.locator('[data-action="publish"]')).toHaveCount(0);
    // Rekkefølgen: Lagre, Avbryt, Publiser utkastet, Forkast utkast, så de som fantes (Eksporter …).
    const ids = await row.locator(".row-actions > button, .row-actions > details > summary").evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).id || (el as HTMLElement).dataset.action || el.textContent?.trim()));
    expect(ids).toEqual(["formSaveBtn", "formCancelLink", "publishCourseDraftBtn", "discardCourseDraftBtn", "export", "Mer"]);
  });

  test("kurslista: et kurs med utkast har «Avpubliser» (ikke «Publiser») og viser «Publisert» + «Nyere utkast»", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [
        { id: "course-1", title: TITLE, description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-11-12T08:00:00.000Z", publishedAt: "2026-10-11T12:00:00.000Z", archivedAt: null, modules: [], versionMajor: 3, versionMinor: 1, hasDraft: true, lifecycle: "published_with_draft" } as never,
        { id: "course-2", title: { nb: "Uten utkast" }, description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-11-12T08:00:00.000Z", publishedAt: null, archivedAt: null, modules: [], versionMajor: 1, versionMinor: 0, lifecycle: "draft" } as never,
      ],
      libraryModules: [],
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.goto("/admin-content/courses");
    const row = page.locator('#coursesTableBody tr[data-row-id="course-1"]');
    await expect(row).toBeVisible();
    await expect(row.locator(".status-badge")).toHaveText("Publisert");
    await expect(row.locator(".status-chip").first()).toHaveText("Nyere utkast");
    await expect(row.locator('[data-action="unpublish"]')).toHaveCount(1);
    await expect(row.locator('[data-action="publish"]')).toHaveCount(0);
    // Kontroll: kurset som ikke er publisert, har «Publiser».
    await expect(page.locator('#coursesTableBody tr[data-row-id="course-2"] [data-action="publish"]')).toHaveCount(1);
  });

  test("et element i utkastet som er arkivert, avpublisert eller slettet, merkes med grunnen; publiseringen avvises med navnene", async ({ page }) => {
    const state = await openBuilder(page, {
      draft: draftWith([
        { type: "MODULE", id: "mod-a", title: "Modul A", archivedAt: "2026-11-12T07:00:00.000Z" },
        { type: "SECTION", id: "sec-b", title: "Seksjon B", unpublished: true },
        { type: "MODULE", id: "mod-gone", title: "", missing: true },
        { type: "MODULE", id: "mod-c", title: "Modul C" },
      ]),
    });
    const rows = page.locator("#moduleList > li");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).locator("[data-item-problem]")).toHaveText("Arkivert etter at utkastet ble lagret. Ta den ut av utkastet før du publiserer.");
    await expect(rows.nth(1).locator("[data-item-problem]")).toHaveText("Ikke publisert. Publiser den, eller ta den ut av utkastet før du publiserer.");
    await expect(rows.nth(2).locator("[data-item-problem]")).toHaveText("Slettet etter at utkastet ble lagret. Ta den ut av utkastet før du publiserer.");
    await expect(rows.nth(2).locator(".form-row-title")).toHaveText("mod-gone");
    await expect(rows.nth(3).locator("[data-item-problem]")).toHaveCount(0);
    await expect(rows.nth(0)).toHaveClass(/is-blocked/);

    state.failNext.publish = {
      status: 400,
      body: {
        error: "course_draft_item_unusable",
        message: "x",
        details: { items: [
          { type: "MODULE", id: "mod-a", title: "Modul A", reason: "archived" },
          { type: "SECTION", id: "sec-b", title: "{\"nb\":\"Seksjon B\",\"en-GB\":\"Section B\"}", reason: "unpublished" },
          { type: "MODULE", id: "mod-gone", title: null, reason: "missing" },
        ] },
      },
    };
    await actions(page).locator('[data-action="publish-draft"]').click();
    const banner = page.locator("#formErrorBanner");
    await expect(banner).toContainText("Ett eller flere elementer i utkastet er arkivert, slettet eller ikke publisert.");
    await expect(banner).toContainText("Dette må rettes: «Modul A» (arkivert), «Seksjon B» (ikke publisert), «mod-gone» (slettet).");
    // Et bilde å se på ved gjennomgang (test-results/ er ikke sporet): merkede rader, banneret, linja og knappene.
    await page.screenshot({ path: "test-results/kursutkast-merkede-elementer.png", fullPage: true });
  });

  test("et avpublisert kurs med et utkast liggende igjen: banner med veien ut, «Forkast utkast» vises, «Publiser utkastet» ikke", async ({ page }) => {
    const state = await openBuilder(page, { course: { publishedAt: null }, draft: draftWith(PUBLISHED_ITEMS) });
    const notice = page.locator("[data-course-draft-notice]");
    await expect(notice).toHaveText("Kurset er ikke publisert, men det ligger et utkast igjen. Vil du fortsette på utkastet, publiserer du kurset igjen. Ellers forkaster du utkastet. Til da kan kurset ikke lagres.");
    await expect(page.locator(".form-page-state .status-badge")).toHaveText("Utkast");
    await expect(page.locator("[data-course-draft-line]")).toHaveCount(0);
    await expect(actions(page).locator('[data-action="publish-draft"]')).toHaveCount(0);
    await expect(actions(page).locator('[data-action="discard-draft"]')).toBeVisible();
    // «Publiser» (kurset) er veien tilbake til utkastet.
    await expect(actions(page).locator('[data-action="publish"]')).toHaveCount(1);

    // Lagre går som før til den direkte lagringen, som låsen stopper: feilbanneret sier hva som må gjøres.
    await page.locator("#title-nb").fill("Mitt nye navn");
    await page.locator("#formSaveBtn").click();
    await expect(page.locator("#formErrorBanner")).toContainText("Kurset har et utkast som ikke er publisert. Ingenting ble lagret.");
    expect(writes(state)[0].path).toBe(`${API}/content`);

    page.once("dialog", (dialog) => dialog.accept());
    await actions(page).locator('[data-action="discard-draft"]').click();
    await expect.poll(() => writes(state).length).toBe(2);
    expect(writes(state)[1].method).toBe("DELETE");
    await expect(page.locator(".toast__message").first()).toHaveText("Utkastet er forkastet.");
    await expect(notice).toHaveCount(0);
  });

  test("et utkast som ikke kan leses (409 course_draft_unreadable): banner, lagring stengt, og det kan forkastes med id-en og telleren fra svaret", async ({ page }) => {
    const state = await openBuilder(page, {
      draft: draftWith(PUBLISHED_ITEMS, { id: "draft-old", revision: 7 }),
      failNext: { getDraft: { status: 409, body: { error: "course_draft_unreadable", message: "x", details: { courseId: "course-1", draftId: "draft-old", revision: 7 } } } },
    });
    const banner = page.locator("#formErrorBanner");
    await expect(banner).toHaveText("Utkastet ble lagret av en eldre versjon av plattformen og kan ikke åpnes. Forkast utkastet og gjør endringene på nytt.");
    // Skjemaet viser det publiserte, og kan ikke lagres eller publisere utkastet.
    await expect(page.locator("#title-nb")).toHaveValue("Generativ KI");
    await expect(actions(page).locator('[data-action="publish-draft"]')).toHaveCount(0);
    await page.locator("#title-nb").fill("Mitt nye navn");
    await page.locator("#formSaveBtn").click();
    await expect(banner).toContainText("kan ikke åpnes");
    await page.waitForTimeout(200);
    expect(writes(state)).toHaveLength(0);

    page.once("dialog", (dialog) => dialog.accept());
    await actions(page).locator('[data-action="discard-draft"]').click();
    await expect.poll(() => writes(state).length).toBe(1);
    const query = new URLSearchParams(writes(state)[0].search);
    expect(writes(state)[0].method).toBe("DELETE");
    expect(query.get("draftId")).toBe("draft-old");
    expect(query.get("revision")).toBe("7");
    await expect(page.locator(".toast__message").first()).toHaveText("Utkastet er forkastet.");
  });

  test("utkastet er borte mellom kursdetaljen og lesingen (404): skjemaet viser kurset uten utkast", async ({ page }) => {
    await openBuilder(page, {
      draft: draftWith(PUBLISHED_ITEMS),
      failNext: { getDraft: { status: 404, body: { error: "course_draft_not_found", message: "This course has no draft." } } },
    });
    await expect(page.locator("#title-nb")).toHaveValue("Generativ KI");
    await expect(page.locator(".form-page-state .status-badge")).toHaveText("Publisert");
    await expect(page.locator(".form-page-state .status-chip").first()).not.toHaveText("Nyere utkast");
    await expect(page.locator("[data-course-draft-line]")).toHaveCount(0);
    await expect(actions(page).locator('[data-action="discard-draft"]')).toHaveCount(0);
    await expect(page.locator("#formErrorBanner")).toBeHidden();
  });

  test("et klikk på «Publiser utkastet» virker etter at hodet er tegnet på nytt", async ({ page }) => {
    const state = await openBuilder(page, { draft: draftWith(PUBLISHED_ITEMS) });
    // Hodet tegnes på nytt (refreshHeader bytter .form-page-actions ut) når en lagring stopper på et tomt bokmålsnavn mens et
    // annet språk er valgt: skjemaet bytter da til bokmål.
    const before = await actions(page).elementHandle();
    await page.locator('[data-form-locale="nn"]').click();
    await page.evaluate(() => {
      const input = document.getElementById("title-nb") as HTMLInputElement;
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#formSaveBtn").click();
    await expect(page.locator("#formErrorBanner")).toContainText("bokmål");
    const after = await actions(page).elementHandle();
    expect(await page.evaluate(([a, b]) => a === b, [before, after])).toBe(false);
    expect(writes(state)).toHaveLength(0);

    await page.locator("#title-nb").fill("Generativ KI 2027");
    await actions(page).locator('[data-action="publish-draft"]').click();
    await expect.poll(() => writes(state).length).toBe(2);
    expect(writes(state).map((w) => w.path)).toEqual([`${API}/draft`, `${API}/draft/publish`]);
  });

  test("390 px: linja om utkastet og knappene flyter ikke over", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuilder(page, { draft: draftWith(PUBLISHED_ITEMS, { updatedByName: "Kari Nordmann-Christophersen med et veldig langt navn" }) });
    await expect(page.locator("[data-course-draft-line]")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/kursutkast-390.png", fullPage: true });
  });
});

test.describe("#1140 skive 2c — kursimport inn i et kurs med utkast", () => {
  test("409 course_has_draft fra «Oppdater dette kurset» vises på brukerens språk", async ({ page }) => {
    await mockCommonApis(page, {
      courses: [{ id: "course-1", title: "Rapportskriving", description: null, certificationLevel: "basic", moduleCount: 1, updatedAt: "2026-10-11T12:00:00.000Z", publishedAt: "2026-10-11T12:00:00.000Z", archivedAt: null, modules: [], hasDraft: true, lifecycle: "published_with_draft" } as never],
      libraryModules: [],
    });
    await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
    await page.route("**/api/admin/content/courses/import", (route: Route) =>
      json(route, 409, { error: "course_has_draft", message: "This course has a draft. Publish or discard the draft first; nothing was saved.", details: { courseId: "course-1" } }));
    await page.goto("/admin-content/courses");
    await page.setInputFiles("#importCoursePackageFile", {
      name: "kurs.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        exportFormat: "a2-content-export/v1",
        exportedAt: "2026-10-12T08:00:00.000Z",
        scope: "course",
        course: { course: { title: { nb: "Rapportskriving" }, description: null, certificationLevel: null, origin: { courseId: "course-1" }, items: [] } },
      })),
    });
    await page.locator("#courseImportUpdateBtn").click();
    const toast = page.locator(".toast--error .toast__message");
    await expect(toast).toContainText("Kurs-importen feilet:");
    await expect(toast).toContainText("Kurset har et utkast som ikke er publisert. Ingenting ble lagret. Publiser eller forkast utkastet i kursbyggeren først.");
  });
});
