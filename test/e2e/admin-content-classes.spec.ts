import { test, expect, type Page, type Route } from "@playwright/test";
import { revealRowAction } from "./admin-content-helpers.js";

// #645/CL-3: browser e2e for the classes (cohort) admin page — runs the real front-end JS against
// mocked APIs, covering the client wiring (list, create, add student via search, assign course).

async function mockBaseApis(page: Page, roles: string[] = ["SUBJECT_MATTER_OWNER"]) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles } },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }),
  );
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { roles }, consent: { accepted: true, currentVersion: "1.0" } }),
    }),
  );
}

test("classes admin: list, create, add a student via search, and assign a course", async ({ page }) => {
  await mockBaseApis(page);

  const state = {
    classes: [{ id: "cls_all_participants", name: "Alle deltakere", isSystem: true, _count: { members: 0, courseAssignments: 0 } }],
    members: [] as Array<{ userId: string; name: string; email: string; addedAt: string }>,
    // #1038: `title` på tildelinger er den FERDIG VALGTE strengen (serveren lokaliserer); kurslista
    // bærer lagringsformatet i `title` og den valgte i `displayTitle`.
    assignedCourses: [] as Array<{ courseId: string; title: string; dueAt: string | null }>,
  };
  let memberPosted = false;
  let coursePosted = false;

  await page.route("**/api/admin/content/classes", (route: Route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { name: string };
      const created = { id: "cls-new", name: body.name, isSystem: false, _count: { members: 0, courseAssignments: 0 } };
      state.classes.push(created);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ class: created }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: state.classes }) });
  });
  // #1046 nivå to: det åpnede elementet henter én klasse (GET) og lagrer navn/beskrivelse (PATCH).
  await page.route("**/api/admin/content/classes/*", (route: Route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const klass = state.classes.find((c) => c.id === id) ?? { id, name: "Ukjent", isSystem: false };
    if (route.request().method() === "PATCH") {
      Object.assign(klass, route.request().postDataJSON() as object);
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ class: { ...klass, lifecycle: "active" } }) });
  });
  await page.route("**/api/admin/content/classes/*/members", (route: Route) => {
    if (route.request().method() === "POST") {
      memberPosted = true;
      state.members.push({ userId: "u1", name: "Kari Nordmann", email: "kari@x.no", addedAt: new Date(0).toISOString() });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: state.members }) });
  });
  await page.route("**/api/admin/content/classes/*/courses", (route: Route) => {
    if (route.request().method() === "POST") {
      coursePosted = true;
      // #497: mirror the server — persist the assigned course WITH its due date so the re-rendered
      // chip can display the frist.
      const body = route.request().postDataJSON() as { courseId: string; dueAt?: string };
      state.assignedCourses.push({ courseId: body.courseId, title: "Arbeidsmiljø", dueAt: body.dueAt ?? null });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: state.assignedCourses }) });
  });
  await page.route("**/api/admin/content/users/search**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users: [{ id: "u1", name: "Kari Nordmann", email: "kari@x.no" }] }) }),
  );
  await page.route("**/api/admin/content/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          { id: "course-1", title: JSON.stringify({ nb: "Arbeidsmiljø" }), displayTitle: "Arbeidsmiljø", archivedAt: null },
          // #688: archived courses must NOT be offered for assignment.
          { id: "course-arch", title: JSON.stringify({ nb: "Gammelt kurs" }), displayTitle: "Gammelt kurs", archivedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    }),
  );

  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/deltakere/klasser");

  // List renders the system class with a real heading (no raw i18n keys).
  await expect(page.locator("h1")).toContainText(/^Klasser$|^Classes$|^Klassar$/);
  await expect(page.locator("#classesTableBody")).toContainText("Alle deltakere");

  // Create a class.
  // #1046 nivå to (1b): «Ny klasse» åpner et tomt skjema; klassen lages ved første Lagre, og man
  // står igjen i den lagrede klassen (med deltakere og kurs).
  await page.locator("#newClassBtn").click();
  await expect(page.locator("#formPageTitle")).toHaveText("Ny klasse");
  await expect(page.locator("#formSaveBtn")).toBeDisabled();
  await page.locator("#className").fill("Kull 2026");
  await expect(page.locator("#formPageTitle")).toHaveText("Kull 2026");
  await expect(page.locator("#formPageDirty")).toHaveText(/^Ulagrede endringer$|^Unsaved changes$|^Ulagra endringar$/);
  await page.locator("#formSaveBtn").click();
  await expect(page.locator("#studentSearch")).toBeVisible();
  await expect(page.locator("#formPageDirty")).toHaveText(/^Alt lagret$|^All saved$|^Alt lagra$/);
  // Tilbake til lista: den nye klassen står der, og «Åpne» fører inn igjen.
  await page.locator("#formBackLink").click();
  await expect(page.locator("#classesTableBody")).toContainText("Kull 2026");

  // Open the new class → detail view.
  await page.locator('[data-action="open"][data-id="cls-new"]').click();
  await expect(page.locator("#studentSearch")).toBeVisible();

  // Search a student and add them.
  await page.locator("#studentSearch").fill("kari");
  await expect(page.locator("#searchResults")).toContainText("Kari Nordmann");
  await page.locator('[data-add-user="u1"]').click();
  await expect.poll(() => memberPosted).toBe(true);
  await expect(page.locator("#memberChips")).toContainText("Kari Nordmann");

  // #688: the archived course must not be an assignable option; the active one must.
  await expect(page.locator('#courseSelect option[value="course-arch"]')).toHaveCount(0);
  await expect(page.locator('#courseSelect option[value="course-1"]')).toHaveCount(1);

  // #497: the due-date input carries a visible label so it is clear what the date means.
  await expect(page.locator('label[for="dueAtInput"]')).toContainText("Frist");

  // Assign a course WITH a due date.
  await page.locator("#courseSelect").selectOption("course-1");
  await page.locator("#dueAtInput").fill("2026-07-17");
  await page.locator("#assignCourseBtn").click();
  await expect.poll(() => coursePosted).toBe(true);

  // #497: the assigned-course chip shows the frist (no timezone shift). #1192: i et datofelt på raden, så den kan endres.
  await expect(page.locator("#courseChips")).toContainText("Arbeidsmiljø");
  await expect(page.locator('#courseChips [data-course-due="course-1"]')).toHaveValue("2026-07-17");
});

// #1192: fristen på et kurs klassen alt har, endres på raden. Før var eneste vei å fjerne kurset og legge det til igjen.
test("#1192: fristen endres på kursraden, lagres med knappen, og en tom dato fjerner fristen", async ({ page }) => {
  await mockBaseApis(page, ["ADMINISTRATOR"]);
  const assigned = [
    { courseId: "c-1", title: "Arbeidsrett", dueAt: "2026-07-17T00:00:00.000Z" as string | null, coursePublished: true, courseArchived: false },
    { courseId: "c-arch", title: "Gammelt kurs", dueAt: "2026-03-01T00:00:00.000Z" as string | null, coursePublished: true, courseArchived: true },
  ];
  const posts: Array<{ courseId: string; dueAt?: string | null }> = [];
  await page.route("**/api/admin/content/classes/*", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ class: { id: "cls-1", name: "Kull A", isSystem: false, archivedAt: null, lifecycle: "active" } }) }),
  );
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [{ id: "cls-1", name: "Kull A", kind: "MANUAL", isSystem: false, archivedAt: null, canManage: true, _count: { members: 0, courseAssignments: 2 } }] }) }),
  );
  await page.route("**/api/admin/content/classes/*/members", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: [] }) }),
  );
  await page.route("**/api/admin/content/classes/*/courses", (route: Route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { courseId: string; dueAt?: string | null };
      posts.push(body);
      const row = assigned.find((c) => c.courseId === body.courseId);
      if (row) row.dueAt = body.dueAt ?? null;
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: assigned }) });
  });
  await page.route("**/api/admin/content/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [] }) }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });

  await page.goto("/deltakere/klasser");
  await page.locator('[data-action="open"]').first().click();
  const due = page.locator('[data-course-due="c-1"]');
  const save = page.locator('[data-save-due="c-1"]');
  await expect(due).toHaveValue("2026-07-17");
  await expect(due).toHaveAccessibleName("Frist for Arbeidsrett");
  // Uendret dato: ingenting å lagre. Tilbake til den lagrede: knappen av igjen.
  await expect(save).toBeDisabled();
  await due.fill("2026-09-01");
  await expect(save).toBeEnabled();
  await due.fill("2026-07-17");
  await expect(save).toBeDisabled();
  expect(posts).toHaveLength(0);

  // Ny dato, lagret med knappen: én POST med datoen, og raden viser den nye fristen.
  await due.fill("2026-09-01");
  await save.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ courseId: "c-1", dueAt: "2026-09-01T00:00:00.000Z" });
  await expect(page.locator(".toast__message", { hasText: "Fristen er lagret." })).toBeVisible();
  await expect(due).toHaveValue("2026-09-01");
  await expect(save).toBeDisabled();

  // Tom dato fjerner fristen.
  await due.fill("");
  await save.click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toEqual({ courseId: "c-1", dueAt: null });
  await expect(due).toHaveValue("");

  // Et arkivert kurs: serveren nekter å tildele det, så fristen står bare som tekst.
  await expect(page.locator('[data-course-due="c-arch"]')).toHaveCount(0);
  await expect(page.locator(".form-row", { hasText: "Gammelt kurs" })).toContainText("Frist: 01.03.2026");

  // Smal skjerm: raden brytes, ingenting stikker ut av sida.
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const rowBox = await page.locator(".form-row", { hasText: "Arbeidsrett" }).boundingBox();
  const saveBox = await save.boundingBox();
  expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
  await page.screenshot({ path: "test-results/class-course-deadline-1192-390.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: "test-results/class-course-deadline-1192-1280.png", fullPage: true });
});

// #1192 (produkteier 2026-11-25): et kurs i versjon 2 eller høyere — en ny frist krever den nye versjonen av den som har et eldre
// kursbevis. Skjermen sier det før lagring, både på raden og ved «Tildel kurs». Kurs i versjon 1: ingen merknad.
test("#1192: ny frist på et kurs i versjon 2 varsler at eldre kursbevis må ta den nye versjonen; versjon 1 varsler ikke", async ({ page }) => {
  await mockBaseApis(page, ["ADMINISTRATOR"]);
  await page.route("**/api/admin/content/classes/*", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ class: { id: "cls-1", name: "Kull A", isSystem: false, archivedAt: null, lifecycle: "active" } }) }),
  );
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [{ id: "cls-1", name: "Kull A", kind: "MANUAL", isSystem: false, archivedAt: null, canManage: true, _count: { members: 0, courseAssignments: 2 } }] }) }),
  );
  await page.route("**/api/admin/content/classes/*/members", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: [] }) }),
  );
  await page.route("**/api/admin/content/classes/*/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          { courseId: "c-v2", title: "Arbeidsrett med et ganske langt navn som bryter linja", dueAt: null, coursePublished: true, courseArchived: false, courseVersionMajor: 2 },
          { courseId: "c-v1", title: "Arbeidsmiljø", dueAt: null, coursePublished: true, courseArchived: false, courseVersionMajor: 1 },
        ],
      }),
    }),
  );
  await page.route("**/api/admin/content/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          { id: "n-v3", title: "{}", displayTitle: "Personvern", archivedAt: null, versionMajor: 3 },
          { id: "n-v1", title: "{}", displayTitle: "HMS", archivedAt: null, versionMajor: 1 },
        ],
      }),
    }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/deltakere/klasser");
  await page.locator('[data-action="open"]').first().click();

  const tekst = "Kurset er i versjon 2. Med denne fristen må de i klassen som har kursbevis for en eldre versjon, ta versjon 2.";
  const v2 = page.locator(".form-row", { hasText: "Arbeidsrett" });
  const note = v2.locator("[data-due-note]");
  await expect(note).toBeHidden();
  await v2.locator("[data-course-due]").fill("2026-12-01");
  await expect(note).toBeVisible();
  await expect(note).toHaveText(tekst);
  // Et varsel ingen ser er ikke et varsel.
  await expect(note).toHaveCSS("color", "rgb(122, 75, 0)");
  // Tom dato fjerner fristen og gjør versjonen frivillig: ingen merknad.
  await v2.locator("[data-course-due]").fill("");
  await expect(note).toBeHidden();
  // Kontroll: versjon 1 har ingen merknad, heller ikke med ny dato.
  const v1 = page.locator(".form-row", { hasText: "Arbeidsmiljø" });
  await v1.locator("[data-course-due]").fill("2026-12-01");
  await expect(v1.locator("[data-save-due]")).toBeEnabled();
  await expect(v1.locator("[data-due-note]")).toHaveCount(0);

  // «Tildel kurs» med frist: versjon 3 varsler, versjon 1 ikke, og uten dato ikke.
  const assignNote = page.locator("#assignVersionNote");
  await page.locator("#courseSelect").selectOption("n-v3");
  await expect(assignNote).toBeHidden();
  await page.locator("#dueAtInput").fill("2026-12-01");
  await expect(assignNote).toBeVisible();
  await expect(assignNote).toHaveText("Kurset er i versjon 3. Med denne fristen må de i klassen som har kursbevis for en eldre versjon, ta versjon 3.");
  await page.locator("#courseSelect").selectOption("n-v1");
  await expect(assignNote).toBeHidden();
  await page.locator("#courseSelect").selectOption("n-v3");
  await page.locator("#dueAtInput").fill("");
  await expect(assignNote).toBeHidden();
  await expect(page.locator("body")).not.toContainText("{major}");

  await v2.locator("[data-course-due]").fill("2026-12-01");
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/class-course-version-note-1192-360.png", fullPage: true });
});

// #705-family: classes render consistently with the other lifecycle lists — Aktive/Arkiverte filter,
// a Type column (System/Manuell/Entra), an "Arkivert" status badge, and a symmetric Gjenopprett action.
test("classes admin: Aktive/Arkiverte filter, Type column, and restore action", async ({ page }) => {
  await mockBaseApis(page);
  const classes = [
    { id: "cls_all_participants", name: "Alle deltakere", isSystem: true, kind: "MANUAL", archivedAt: null, _count: { members: 3, courseAssignments: 1 } },
    { id: "cls-active", name: "Kull Aktiv", isSystem: false, kind: "MANUAL", archivedAt: null, _count: { members: 2, courseAssignments: 0 } },
    { id: "cls-entra", name: "Entra-gruppe", isSystem: false, kind: "ENTRA", archivedAt: null, _count: { members: 0, courseAssignments: 0 } },
    { id: "cls-arch", name: "Kull Arkivert", isSystem: false, kind: "MANUAL", archivedAt: "2026-01-01T00:00:00.000Z", _count: { members: 1, courseAssignments: 0 } },
  ];
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes }) }),
  );
  let restoreUrl: string | null = null;
  await page.route("**/api/admin/content/classes/*/restore", (route: Route) => {
    restoreUrl = route.request().url();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/deltakere/klasser");
  await expect(page.locator("h1")).toContainText(/^Klasser$|^Classes$|^Klassar$/);
  const body = page.locator("#classesTableBody");

  // Default "Aktive": active classes shown, archived hidden.
  await expect(body).toContainText("Kull Aktiv");
  await expect(body).toContainText("Alle deltakere");
  await expect(body).not.toContainText("Kull Arkivert");

  // Type column labels are present.
  await expect(body).toContainText("System");
  await expect(body).toContainText("Entra");
  await expect(body).toContainText(/Manuell|Manual/);

  // The system class has no archive/restore action.
  await expect(body.locator('[data-action="archive"][data-id="cls_all_participants"]')).toHaveCount(0);

  // Switch to "Arkiverte": only the archived class, with an "Arkivert" badge + a Gjenopprett action.
  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  await expect(body).toContainText("Kull Arkivert");
  await expect(body).not.toContainText("Kull Aktiv");
  await expect(body).toContainText("Arkivert");
  await expect(body.locator('[data-action="restore"][data-id="cls-arch"]')).toBeVisible();

  // Restore → POST /:classId/restore. #1168: uten spørsmål (kursets mønster), meldingen sier hvilken klasse.
  await body.locator('[data-action="restore"][data-id="cls-arch"]').click();
  await expect.poll(() => restoreUrl).toContain("/classes/cls-arch/restore");
  await expect(page.locator(".toast__message").first()).toContainText("Kull Arkivert");
});

// #765: the «Deltakere» sub-navigation (Klasser | Manuell behandling | Resultater) role-gates its tabs
// and marks the active one by pathname. A pure SUBJECT_MATTER_OWNER sees Klasser + Resultater but NOT
// Manuell behandling (reviewer-only), and lands on Klasser as the active tab.
test("deltakere sub-nav: role-gates tabs and marks the current one active", async ({ page }) => {
  await mockBaseApis(page, ["SUBJECT_MATTER_OWNER"]);
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );

  await page.goto("/deltakere/klasser");
  const subnav = page.locator("#deltakereSubnav");
  await expect(subnav).toBeVisible();

  // SMO can access Klasser + Resultater, but not Manuell behandling → that tab is removed.
  await expect(subnav.locator("#subnavKlasser")).toBeVisible();
  await expect(subnav.locator("#subnavResults")).toBeVisible();
  await expect(subnav.locator("#subnavReview")).toHaveCount(0);

  // The active tab reflects the current page.
  await expect(subnav.locator("#subnavKlasser")).toHaveClass(/active/);
  await expect(subnav).toHaveAttribute("data-roles-resolved", "true");
});

// #1046 E4: «Manuell behandling» må ikke blinke. Før ble alle lenkene tegnet og de ulovlige fjernet
// ETTER at rollene var hentet — en SMO så fanen komme og gå. Nå holdes de rollestyrte lenkene
// usynlige til svaret er der. Testen holder /api/me tilbake og ser at lenken ikke er synlig i
// mellomtiden — og at den fjernes, ikke vises, når svaret kommer.
test("deltakere sub-nav: rollestyrte faner vises ikke før rollene er kjent (ingen blinking)", async ({ page }) => {
  await mockBaseApis(page, ["SUBJECT_MATTER_OWNER"]);
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );
  let slippMe: (() => void) | null = null;
  const meHoldes = new Promise<void>((resolve) => { slippMe = resolve; });
  await page.route("**/api/me", async (route: Route) => {
    await meHoldes;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "u1", roles: ["SUBJECT_MATTER_OWNER"] }, consent: { currentVersion: "1.0", accepted: true } }) });
  });

  await page.goto("/deltakere/klasser");
  const subnav = page.locator("#deltakereSubnav");
  await expect(subnav).toHaveAttribute("data-roles-resolved", "false");
  // Lenken finnes i DOM-en, men er usynlig — det er hele poenget.
  await expect(subnav.locator("#subnavReview")).toHaveCount(1);
  await expect(subnav.locator("#subnavReview")).toBeHidden();

  slippMe!();
  await expect(subnav).toHaveAttribute("data-roles-resolved", "true");
  await expect(subnav.locator("#subnavReview")).toHaveCount(0);
  await expect(subnav.locator("#subnavKlasser")).toBeVisible();
});

// #690: the "Synk brukere fra Entra" button is ADMINISTRATOR-only and triggers the Entra user sync.
test("classes admin: Entra user-sync button is admin-only and posts to the sync endpoint", async ({ page }) => {
  // SUBJECT_MATTER_OWNER must NOT see the button.
  await mockBaseApis(page, ["SUBJECT_MATTER_OWNER"]);
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );
  await page.goto("/deltakere/klasser");
  await expect(page.locator("h1")).toContainText(/^Klasser$|^Classes$|^Klassar$/);
  await expect(page.locator("#syncEntraBtn")).toHaveCount(0);
});

test("classes admin: ADMINISTRATOR sees the Entra sync button and clicking it posts", async ({ page }) => {
  await mockBaseApis(page, ["ADMINISTRATOR"]);
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );
  let syncPosted = false;
  await page.route("**/api/admin/sync/org/entra", (route: Route) => {
    syncPosted = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ importedUsers: 61, fetchedMembers: 61 }) });
  });

  await page.goto("/deltakere/klasser");
  await expect(page.locator("#syncEntraBtn")).toBeVisible();
  await page.locator("#syncEntraBtn").click();
  await expect.poll(() => syncPosted).toBe(true);
});

// #690 regression: in prod (Entra auth) `identityDefaults` is undefined — admin gating AND the
// workspace nav role filter MUST come from /api/me's live roles. Guards two prod bugs: (1) import/sync
// buttons hidden because isAdministrator read absent identityDefaults; (2) the top workspace nav never
// rendered because the whole config object was passed as navItems (→ sanitized to []) and roles were "".
test("classes admin: admin buttons + top nav render in prod-shaped config (role from /api/me)", async ({ page }) => {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      // Prod shape: mockRoleSwitch disabled → identityDefaults omitted entirely. Two nav items: one
      // open, one role-gated (only visible if the live roles include SUBJECT_MATTER_OWNER).
      body: JSON.stringify({
        authMode: "mock",
        navigation: {
          items: [
            { id: "dashboard", path: "/dashboard", labelKey: "Oversikt", requiredRoles: [] },
            { id: "review", path: "/review", labelKey: "Vurdering", requiredRoles: ["SUBJECT_MATTER_OWNER"] },
            // #705-UX(D): a REAL i18n key — the classes page must resolve it via tNav, not render
            // the raw key. (The earlier mock used display strings as labelKeys, hiding the bug.)
            { id: "adminContent", path: "/admin-content/courses", labelKey: "nav.adminContent", requiredRoles: [] },
          ],
          workspaceItems: [],
        },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }),
  );
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["ADMINISTRATOR", "SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );
  await page.goto("/deltakere/klasser");
  await expect(page.locator("#importUsersBtn")).toBeVisible();
  await expect(page.locator("#syncEntraBtn")).toBeVisible();
  // Top workspace nav renders both the open item and the role-gated one (live roles applied).
  await expect(page.locator("#workspaceNav")).toBeVisible();
  await expect(page.locator('#workspaceNav a', { hasText: "Oversikt" })).toBeVisible();
  await expect(page.locator('#workspaceNav a', { hasText: "Vurdering" })).toBeVisible();
  // #705-UX(D): the real i18n key must be resolved (translated), never rendered raw.
  await expect(page.locator("#workspaceNav")).not.toContainText("nav.adminContent");
});

// #690 fallback: ADMINISTRATOR imports users from a JSON file → POST /api/admin/sync/org/delta.
test("classes admin: importing a users file posts to the delta sync endpoint", async ({ page }) => {
  await mockBaseApis(page, ["ADMINISTRATOR"]);
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );
  let deltaBody: unknown = null;
  await page.route("**/api/admin/sync/org/delta", (route: Route) => {
    deltaBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { createdCount: 2, updatedCount: 0, failedCount: 0 } }) });
  });

  await page.goto("/deltakere/klasser");
  await expect(page.locator("#importUsersBtn")).toBeVisible();

  // Provide the file directly to the hidden input (no OS picker).
  await page.locator("#importUsersFile").setInputFiles({
    name: "entra-export.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        source: "entra_manual_export",
        users: [
          { externalId: "oid-1", email: "a@x.no", name: "A", activeStatus: true },
          { externalId: "oid-2", email: "b@x.no", name: "B", activeStatus: true },
        ],
      }),
    ),
  });

  await expect.poll(() => deltaBody).not.toBeNull();
  expect((deltaBody as { source: string }).source).toBe("entra_manual_export");
  expect((deltaBody as { users: unknown[] }).users).toHaveLength(2);
});

// #967: en tildeling til et kurs deltakerne ikke kan åpne skjules IKKE — en skjult rad er en rad
// ingen kan fjerne — men den merkes, så fagansvarlig forstår hvorfor ingen i klassen beveger seg.
//
// ⚠️ Merket var fram til nå bare voktet av et manuelt inspeksjonsskript. Et UI-element som ingen
// automatisk test ser, kan forsvinne i en refaktorering uten at noe blir rødt.
test("#967: klasseskjermen merker tildelinger til upubliserte og arkiverte kurs", async ({ page }) => {
  await mockBaseApis(page, ["ADMINISTRATOR"]);
  await page.route("**/api/admin/content/classes/*", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ class: { id: "cls-1", name: "Kull A", isSystem: false, archivedAt: null, lifecycle: "active" } }) }),
  );
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        classes: [{ id: "cls-1", name: "Kull 2026 vår", kind: "MANUAL", isSystem: false, archivedAt: null, canManage: true, _count: { members: 2, courseAssignments: 3 } }],
      }),
    }),
  );
  await page.route("**/api/admin/content/classes/*/members", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: [] }) }),
  );
  await page.route("**/api/admin/content/classes/*/courses", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        courses: [
          { courseId: "c-ok", title: "Publisert kurs", dueAt: null, coursePublished: true, courseArchived: false },
          { courseId: "c-unpub", title: "Utkastkurs", dueAt: null, coursePublished: false, courseArchived: false },
          { courseId: "c-arch", title: "Gammelt kurs", dueAt: null, coursePublished: true, courseArchived: true },
        ],
      }),
    }),
  );
  await page.route("**/api/admin/content/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [] }) }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });

  await page.goto("/deltakere/klasser");
  await page.locator('[data-action="open"]').first().click();
  await expect(page.locator(".form-row").first()).toBeVisible();

  const warnings = page.locator(".form-row-meta--warn");
  await expect(warnings).toHaveCount(2);
  await expect(warnings.nth(0)).toContainText(/Ikke publisert/i);
  await expect(warnings.nth(1)).toContainText(/Arkivert/i);
  // Det publiserte kurset skal IKKE merkes — ellers betyr merket ingenting.
  await expect(page.locator(".form-row").first().locator(".form-row-meta--warn")).toHaveCount(0);
  // Et varsel ingen ser er ikke et varsel.
  await expect(warnings.first()).toHaveCSS("color", "rgb(122, 75, 0)");
});

// #1114: e-postadresser kobles aldri (produkteier 2026-10-25). Det importen hopper over, skal
// administrator se: hvor mange og hvorfor, og hvem — men ikke e-posten til en pseudonymisert.
test("classes admin: importen sier hvem som ble hoppet over fordi e-posten tilhører en annen bruker", async ({ page }) => {
  await mockBaseApis(page, ["ADMINISTRATOR"]);
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ classes: [] }) }),
  );
  await page.route("**/api/admin/sync/org/delta", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ run: {
        createdCount: 1, updatedCount: 2, failedCount: 0, skippedConflictCount: 1, skippedAnonymizedCount: 1,
        conflicts: [{ externalId: "oid-9", email: "kari@a-2.no" }],
      } }),
    }));
  await page.goto("/deltakere/klasser");
  await page.locator("#importUsersFile").setInputFiles({
    name: "entra-export.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ users: [{ externalId: "oid-9", email: "kari@a-2.no", name: "Kari" }] })),
  });
  const toast = page.locator(".toast").last();
  await expect(toast).toContainText("Import fullført — 1 opprettet, 2 oppdatert.");
  await expect(toast).toContainText("1 hoppet over: e-postadressen tilhører en annen bruker");
  await expect(toast).toContainText("1 hoppet over: pseudonymisert.");
  await expect(toast).toContainText("kari@a-2.no");
});

// Produkteier 2026-11-08: ingen nye deltakere eller kurs i en arkivert klasse. Siden viser ikke feltene for det, bare hvorfor,
// og etter «Gjenopprett» er de tilbake. Serveren nekter uansett (`class_archived`, test/m2-classes-archived.test.ts), og den
// meldingen vises lesbart på alle tre språk når en side som sto åpen, prøver likevel.
async function mockOneClass(page: Page, state: { archivedAt: string | null }, onMemberPost?: (route: Route) => Promise<void>) {
  await mockBaseApis(page, ["ADMINISTRATOR"]);
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ classes: [{ id: "cls-1", name: "Kull 2025", kind: "MANUAL", isSystem: false, archivedAt: state.archivedAt, canManage: true, _count: { members: 1, courseAssignments: 1 } }] }),
    }),
  );
  await page.route("**/api/admin/content/classes/*", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ class: { id: "cls-1", name: "Kull 2025", kind: "MANUAL", isSystem: false, archivedAt: state.archivedAt, lifecycle: state.archivedAt ? "archived" : "active" } }) }),
  );
  await page.route("**/api/admin/content/classes/*/members", (route: Route) => {
    if (route.request().method() === "POST" && onMemberPost) return onMemberPost(route);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ members: [{ userId: "u1", name: "Kari Nordmann", email: "kari@x.no", addedAt: new Date(0).toISOString() }] }) });
  });
  await page.route("**/api/admin/content/classes/*/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [{ courseId: "course-1", title: "Arbeidsmiljø", dueAt: null, coursePublished: true, courseArchived: false }] }) }),
  );
  await page.route("**/api/admin/content/classes/*/restore", (route: Route) => {
    state.archivedAt = null;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/admin/content/users/search**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users: [{ id: "u2", name: "Ola Nordmann", email: "ola@x.no" }] }) }),
  );
  await page.route("**/api/admin/content/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [{ id: "course-2", title: JSON.stringify({ nb: "Nytt kurs" }), displayTitle: "Nytt kurs", archivedAt: null }] }) }),
  );
}

test("arkivert klasse: ingen felt for å legge til deltakere eller tildele kurs, en forklaring, og feltene er tilbake etter «Gjenopprett»", async ({ page }) => {
  const state = { archivedAt: "2026-11-01T00:00:00.000Z" as string | null };
  await mockOneClass(page, state);
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/deltakere/klasser?id=cls-1");

  // Det som står, vises fortsatt, og kan fjernes.
  await expect(page.locator("#memberChips")).toContainText("Kari Nordmann");
  await expect(page.locator("#courseChips")).toContainText("Arbeidsmiljø");
  await expect(page.locator('[data-remove-member="u1"]')).toBeVisible();
  // Ingen vei til å legge til.
  await expect(page.locator("#studentSearch")).toHaveCount(0);
  await expect(page.locator("#courseSelect")).toHaveCount(0);
  await expect(page.locator("#assignCourseBtn")).toHaveCount(0);
  const notes = page.locator("[data-class-archived-note]");
  await expect(notes).toHaveCount(2);
  await expect(notes.first()).toHaveText("Klassen er arkivert. Gjenopprett den for å legge til deltakere eller tildele kurs.");
  await expect(notes.first()).toBeVisible();

  // #1168: gjenoppretting spør ikke.
  await page.locator('.form-page-actions [data-action="restore"]').click();
  await expect(page.locator("#studentSearch")).toBeVisible();
  await expect(page.locator("#assignCourseBtn")).toBeVisible();
  await expect(page.locator("[data-class-archived-note]")).toHaveCount(0);
});

// #1168: «Arkiver» og «Slett» på en klasse har sidas dialog (som modulene og seksjonene), ikke nettleserens spørreboks.
async function classLifecycleCalls(page: Page) {
  const calls = { archive: 0, del: 0, browserQuestions: [] as string[] };
  await page.route("**/api/admin/content/classes/*/archive", (route: Route) => {
    calls.archive += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/admin/content/classes/cls-1", (route: Route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    calls.del += 1;
    return route.fulfill({ status: 204, body: "" });
  });
  page.on("dialog", (dialog) => { calls.browserQuestions.push(dialog.message()); void dialog.dismiss(); });
  return calls;
}

test("#1168: «Arkiver» i lista: sidas dialog sier hva som skjer med kursene; Avbryt sender ingenting, bekreft arkiverer én gang", async ({ page }) => {
  await mockOneClass(page, { archivedAt: null });
  const calls = await classLifecycleCalls(page);
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/deltakere/klasser");
  const archive = async () => (await revealRowAction(page, page.locator('[data-action="archive"][data-id="cls-1"]'))).click();

  await archive();
  const dialog = page.locator("#moduleLifecycleDialog");
  await expect(dialog).toHaveAttribute("data-module-dialog", "archive");
  await expect(page.locator("#moduleLifecycleDialogTitle")).toHaveText("Arkivere «Kull 2025»?");
  await expect(page.locator("#moduleLifecycleDialogText")).toContainText("forsvinner fra Mine kurs; påbegynte og fullførte blir stående, og påminnelsene stopper");
  await expect(page.locator("#moduleLifecycleDialogConfirmBtn")).toHaveText("Arkiver klassen");
  await expect(page.locator("#moduleLifecycleDialogCancelBtn")).toBeFocused();
  await page.locator("#moduleLifecycleDialogCancelBtn").click();
  expect(calls.archive).toBe(0);

  await archive();
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  await expect.poll(() => calls.archive).toBe(1);
  expect(calls.browserQuestions).toEqual([]);
});

test("#1168: «Slett» på en arkivert klasse i hodet: sidas dialog med rød knapp; Avbryt sender ingenting, bekreft sletter", async ({ page }) => {
  await mockOneClass(page, { archivedAt: "2026-01-01T00:00:00.000Z" });
  const calls = await classLifecycleCalls(page);
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/deltakere/klasser?id=cls-1");
  const del = async () => (await revealRowAction(page, page.locator('.form-page-actions [data-action="delete"]'))).click();

  await del();
  await expect(page.locator("#moduleLifecycleDialog")).toHaveAttribute("data-module-dialog", "delete");
  await expect(page.locator("#moduleLifecycleDialogTitle")).toHaveText("Slette «Kull 2025» for godt?");
  await expect(page.locator("#moduleLifecycleDialogText")).toHaveText("Medlemslista og kurstildelingene forsvinner. Deltakernes egen fremdrift beholdes. Det kan ikke angres.");
  await expect(page.locator("#moduleLifecycleDialogConfirmBtn")).toHaveClass(/btn-danger/);
  await page.locator("#moduleLifecycleDialogCancelBtn").click();
  expect(calls.del).toBe(0);

  await del();
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  await expect.poll(() => calls.del).toBe(1);
  expect(calls.browserQuestions).toEqual([]);
});

test("#1192: i en arkivert klasse kan fristen ikke endres (serveren nekter), den står som tekst; i en aktiv kan den", async ({ page }) => {
  await mockOneClass(page, { archivedAt: "2026-01-01T00:00:00.000Z" });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/deltakere/klasser?id=cls-1");
  await expect(page.locator("#courseChips")).toContainText("Arbeidsmiljø");
  await expect(page.locator("[data-course-due], [data-save-due]")).toHaveCount(0);
  await expect(page.locator("#courseChips")).toContainText("Ingen frist");
});

test("#1192 kontroll: i en aktiv klasse har samme kursrad datofeltet", async ({ page }) => {
  await mockOneClass(page, { archivedAt: null });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/deltakere/klasser?id=cls-1");
  await expect(page.locator('[data-course-due="course-1"]')).toHaveValue("");
  await expect(page.locator('[data-save-due="course-1"]')).toBeDisabled();
});

test("#1168: «Gjenopprett» spør ikke, og et dobbeltklikk sender bare én gjenoppretting (QA 2.181.0)", async ({ page }) => {
  await mockOneClass(page, { archivedAt: "2026-01-01T00:00:00.000Z" });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let restores = 0;
  await page.route("**/api/admin/content/classes/*/restore", async (route: Route) => {
    restores += 1;
    await gate;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/deltakere/klasser");
  await page.locator('.list-filter-btn[data-filter="archived"]').click();
  const restore = await revealRowAction(page, page.locator('[data-action="restore"][data-id="cls-1"]'));
  await restore.dblclick();
  await expect.poll(() => restores).toBe(1);
  await page.waitForTimeout(300);
  expect(restores).toBe(1);
  release();
  await expect(page.locator(".toast__message").first()).toHaveText("Klassen «Kull 2025» er gjenopprettet.");
});

test("aktiv klasse: ingen forklaring om arkivering, og feltene står (kontroll)", async ({ page }) => {
  await mockOneClass(page, { archivedAt: null });
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/deltakere/klasser?id=cls-1");
  await expect(page.locator("#studentSearch")).toBeVisible();
  await expect(page.locator("#courseSelect")).toBeVisible();
  await expect(page.locator("[data-class-archived-note]")).toHaveCount(0);
});

for (const [locale, text] of [
  ["nb", "Klassen er arkivert. Gjenopprett den før du legger til deltakere eller tildeler kurs."],
  ["nn", "Klassen er arkivert. Gjenopprett han før du legg til deltakarar eller tildeler kurs."],
  ["en-GB", "The class is archived. Restore it before adding participants or assigning courses."],
] as const) {
  test(`klassen ble arkivert mens siden sto åpen: serverens class_archived vises lesbart (${locale})`, async ({ page }) => {
    await mockOneClass(page, { archivedAt: null }, (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "class_archived", message: "The class is archived. Restore it before adding participants.", details: { action: "add_member", classId: "cls-1" } }) }),
    );
    await page.addInitScript((value) => { try { localStorage.setItem("participant.locale", value); } catch { /* ignore */ } }, locale);
    await page.goto("/deltakere/klasser?id=cls-1");
    await page.locator("#studentSearch").fill("ola");
    await page.locator('[data-add-user="u2"]').click();
    const toast = page.locator(".toast").last();
    await expect(toast).toContainText(text);
    await expect(toast).not.toContainText("class_archived");
  });
}
