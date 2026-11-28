import { test, expect, type Page, type Route } from "@playwright/test";
import { mockCommonApis } from "./admin-content-helpers.js";

// #1197 (produkteier 26.11.2026, doc/DECISIONS.md): «Åpent» på et kurs betyr tilgjengelig og frivillig; et kurs tildelt klassen
// «Alle deltakere» er påkrevd for alle (frist, påminnelser, e-post, utestående). Begge beholdes; skjermen skal si forskjellen, i
// kursets Innstillinger, i klassen «Alle deltakere» og i publiseringsdialogen (den siste i admin-content-course-publish-dialog-1164).

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function locale(page: Page, value: string) {
  await page.addInitScript((loc) => { try { localStorage.setItem("participant.locale", loc); } catch { /* standardspråk */ } }, value);
}

const COURSE = {
  id: "course-1",
  title: { nb: "Arbeidsmiljø", nn: "Arbeidsmiljø", "en-GB": "Working environment" },
  description: null,
  certificationLevel: "basic",
  enrollmentPolicy: "OPEN",
  moduleCount: 1,
  updatedAt: "2026-11-13T12:00:00.000Z",
  publishedAt: null,
  archivedAt: null,
  modules: [{ moduleId: "mod-a", sortOrder: 0, moduleTitle: "Modul A" }],
  contentRevision: 3,
};

for (const [loc, text] of [
  ["nb", { label: "Hvem ser kurset", open: "Åpent for alle (frivillig)", restricted: "Bare for de som er tildelt", help: /frivillig|når de vil[\s\S]*klassen «Alle deltakere»/ }],
  ["en-GB", { label: "Who sees the course", open: "Open to everyone (optional)", restricted: "Only those assigned", help: /when they like[\s\S]*class «All participants»/ }],
] as const) {
  test(`kursets Innstillinger sier frivillig og viser veien til «påkrevd for alle» (${loc})`, async ({ page }) => {
    await mockCommonApis(page, { courses: [COURSE as never] });
    await locale(page, loc);
    await page.goto("/admin-content/courses/course-1");
    await page.locator("#formTab-innstillinger").click();

    await expect(page.locator('label[for="enrollmentPolicy"]')).toHaveText(text.label);
    await expect(page.locator('#enrollmentPolicy option[value="OPEN"]')).toHaveText(text.open);
    await expect(page.locator('#enrollmentPolicy option[value="RESTRICTED"]')).toHaveText(text.restricted);
    const help = page.locator("#enrollmentPolicyHelp");
    await expect(help).toBeVisible();
    await expect(help).toHaveText(text.help);
    // Skjermlesere leser hjelpen sammen med feltet.
    await expect(page.locator("#enrollmentPolicy")).toHaveAttribute("aria-describedby", "enrollmentPolicyHelp");
  });
}

async function mockClasses(page: Page) {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock", navigation: { items: [], workspaceItems: [] },
      identityDefaults: { contentAdmin: { userId: "smo-1", email: "smo@x.no", name: "SMO", roles: ["SUBJECT_MATTER_OWNER"] } },
      calibrationWorkspace: { accessRoles: [] },
    })),
  );
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  const classes = [
    { id: "cls_all_participants", name: "Alle deltakere", isSystem: true, kind: "MANUAL", archivedAt: null, canManage: true, _count: { members: 0, courseAssignments: 1 } },
    { id: "cls-1", name: "Kull A", isSystem: false, kind: "MANUAL", archivedAt: null, canManage: true, _count: { members: 0, courseAssignments: 0 } },
  ];
  await page.route("**/api/admin/content/classes", (route: Route) => route.fulfill(json({ classes })));
  await page.route("**/api/admin/content/classes/*", (route: Route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const klass = classes.find((c) => c.id === id);
    return route.fulfill(json({ class: { ...klass, lifecycle: "active" } }));
  });
  await page.route("**/api/admin/content/classes/*/members", (route: Route) => route.fulfill(json({ members: [] })));
  await page.route("**/api/admin/content/classes/*/courses", (route: Route) => route.fulfill(json({ courses: [] })));
  await page.route("**/api/admin/content/courses", (route: Route) => route.fulfill(json({ courses: [] })));
}

test("klassen «Alle deltakere» sier at kursene der er påkrevd for alle; en vanlig klasse sier det ikke (kontroll)", async ({ page }) => {
  await mockClasses(page);
  await locale(page, "nb");
  await page.goto("/deltakere/klasser");
  await page.locator('[data-action="open"][data-id="cls_all_participants"]').click();
  const note = page.locator("[data-system-required-note]");
  await expect(note).toBeVisible();
  await expect(note).toContainText("påkrevd for alle deltakere");
  await expect(note).toContainText("«Åpent for alle»");

  await page.locator("#formBackLink").click();
  await page.locator('[data-action="open"][data-id="cls-1"]').click();
  await expect(page.locator("#className")).toHaveValue("Kull A");
  await expect(page.locator("[data-system-required-note]")).toHaveCount(0);
});
