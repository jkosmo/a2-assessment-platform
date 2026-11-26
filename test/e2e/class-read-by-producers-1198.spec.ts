import { test, expect, type Page, type Route } from "@playwright/test";

// #1198 (produkteier 26.11.2026, doc/DECISIONS.md): alle produsenter kan lese alle klasser. En klasse leseren ikke eier, har «Åpne»
// i lista og åpnes skrivebeskyttet: kursene med frister og deltakerne står, men ingen «Fjern», ingen fristfelt, ingen søk etter
// deltakere, ingen tildeling og ingen Lagre. Svarformen er tjenerens: `canManage` i lista og i detaljen (src/routes/adminClasses.ts).

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mock(page: Page, canManage: boolean) {
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* standardspråk */ } });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock", navigation: { items: [], workspaceItems: [] },
      identityDefaults: { contentAdmin: { userId: "smo-2", email: "smo2@x.no", name: "SMO 2", roles: ["SUBJECT_MATTER_OWNER"] } },
      calibrationWorkspace: { accessRoles: [] },
    })),
  );
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["SUBJECT_MATTER_OWNER"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  const klass = { id: "cls-1", name: "Prosjektledere Bergen", description: "Kull høsten 2026", isSystem: false, kind: "MANUAL", archivedAt: null, canManage, _count: { members: 1, courseAssignments: 1 } };
  const writes: string[] = [];
  await page.route("**/api/admin/content/classes", (route: Route) => route.fulfill(json({ classes: [klass] })));
  await page.route("**/api/admin/content/classes/*", (route: Route) => {
    if (route.request().method() !== "GET") { writes.push(`${route.request().method()} ${route.request().url()}`); return route.fulfill(json({ error: "content_ownership" }, 403)); }
    return route.fulfill(json({ class: { ...klass, lifecycle: "active" } }));
  });
  // QA 2.186.0: skrivinger mot deltakere og kurs (også /members/:userId og /courses/:courseId) fanges, ikke bare mot klassen.
  await page.route("**/api/admin/content/classes/*/members**", (route: Route) => {
    if (route.request().method() !== "GET") { writes.push(`${route.request().method()} ${route.request().url()}`); return route.fulfill(json({ error: "content_ownership" }, 403)); }
    return route.fulfill(json({ members: [{ userId: "u1", name: "Kari Nordmann", email: "kari@x.no", addedAt: "2026-11-01T00:00:00.000Z" }] }));
  });
  await page.route("**/api/admin/content/classes/*/courses**", (route: Route) => {
    if (route.request().method() !== "GET") { writes.push(`${route.request().method()} ${route.request().url()}`); return route.fulfill(json({ error: "content_ownership" }, 403)); }
    return route.fulfill(json({ courses: [{ courseId: "course-1", title: "Arbeidsmiljø", dueAt: "2027-01-15T00:00:00.000Z", coursePublished: true, courseArchived: false, courseVersionMajor: 1 }] }));
  });
  await page.route("**/api/admin/content/courses", (route: Route) =>
    route.fulfill(json({ courses: [{ id: "course-2", title: JSON.stringify({ nb: "Personvern" }), displayTitle: "Personvern", archivedAt: null }] })));
  // Feltet eierpanelet leser, er `canManage` (owner-panel.js); tjeneren avgjør det.
  await page.route("**/api/admin/content-owners/CLASS/*", (route: Route) =>
    route.fulfill(json({ owners: [{ userId: "smo-1", name: "Eier Eiersen", email: "eier@x.no" }], canManage })));
  return writes;
}

test("en klasse leseren ikke eier: «Åpne» i lista, og klassen vises skrivebeskyttet med kurs, frist og deltakere", async ({ page }) => {
  const writes = await mock(page, false);
  await page.goto("/deltakere/klasser");
  const row = page.locator("#classesTableBody tr").filter({ hasText: "Prosjektledere Bergen" });
  await expect(row.locator(".row-readonly-note")).toHaveText("Kun for eier");
  await row.locator('[data-action="open"]').click();

  await expect(page.locator("#className")).toHaveValue("Prosjektledere Bergen");
  await expect(page.locator("#className")).toBeDisabled();
  await expect(page.locator("#classDescription")).toBeDisabled();
  await expect(page.locator("[data-class-readonly-note]")).toHaveText("Du kan lese, men bare eierne kan endre.");
  // Det man kom for å se, står.
  await expect(page.locator("#memberChips")).toContainText("Kari Nordmann");
  await expect(page.locator("#memberChips")).toContainText("kari@x.no");
  await expect(page.locator("#courseChips")).toContainText("Arbeidsmiljø");
  await expect(page.locator("#courseChips")).toContainText("15.01.2027");
  // Ingenting som ville gitt 403.
  await expect(page.locator("[data-remove-member], [data-remove-course], [data-course-due], [data-save-due]")).toHaveCount(0);
  await expect(page.locator("#studentSearch")).toHaveCount(0);
  await expect(page.locator("#courseSelect")).toHaveCount(0);
  await expect(page.locator("#assignCourseBtn")).toHaveCount(0);
  await expect(page.locator("#formSaveBtn")).toHaveCount(0);
  await expect(page.locator('.form-page-actions [data-action="archive"]')).toHaveCount(0);
  // Eierne vises, men kan ikke endres herfra.
  await page.locator("#formTab-innstillinger").click();
  await expect(page.locator("#classOwnerPanelHost")).toContainText("Eier Eiersen");
  await expect(page.locator("#classOwnerPanelHost .owner-edit-toggle, #classOwnerPanelHost .owner-remove")).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("kontroll: eieren får klassen redigerbar, som før", async ({ page }) => {
  await mock(page, true);
  await page.goto("/deltakere/klasser");
  await page.locator('[data-action="open"][data-id="cls-1"]').click();
  await expect(page.locator("#className")).toBeEnabled();
  await expect(page.locator("[data-class-readonly-note]")).toHaveCount(0);
  await expect(page.locator("[data-remove-member]")).toHaveCount(1);
  await expect(page.locator("[data-course-due]")).toHaveCount(1);
  await expect(page.locator("#studentSearch")).toBeVisible();
  await expect(page.locator("#assignCourseBtn")).toBeVisible();
  await expect(page.locator("#formSaveBtn")).toBeVisible();
  await page.locator("#formTab-innstillinger").click();
  await expect(page.locator("#classOwnerPanelHost .owner-edit-toggle")).toHaveCount(1);
});
