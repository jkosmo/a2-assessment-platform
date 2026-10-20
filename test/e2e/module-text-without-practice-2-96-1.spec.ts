import { test, expect, type Page, type Route } from "@playwright/test";
import { renderModuleTextMarkdown, renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";
import { buildMockModuleExport, localizedText, mockCommonApis } from "./admin-content-helpers.js";

// 2.96.1 — produkteier 2026-10-20: steg for steg, skriv selv og repetisjonskort tegnes bare i seksjoner.
// I modulens oppgavetekst (det deltakeren svarer på) står de som vanlig tekst. «Tenk først» tegnes som
// før. Avgjørelsen tas på tjeneren: deltakeren får HTML fra renderModuleTextMarkdown, og forhåndsvisningen
// i modularbeidsflaten ber forhåndsvisningsruta om varianten «moduleText».

const NL = String.fromCharCode(10);
const MD = [
  "Les saken først.",
  "",
  ":::steg Slik gjør du",
  "### Les",
  "Les saken.",
  "### Skriv",
  "Skriv svaret.",
  ":::",
  "",
  ":::skriv Skriv et vedtak.",
  "Eksempelsvaret.",
  "",
  "- [ ] hva?",
  ":::",
  "",
  ":::repetisjon",
  "### Vedtak",
  "Det møtet bestemte.",
  "### Referent",
  "Den som skriver.",
  ":::",
  "",
  ":::tenk Hva tror du?",
  "Svaret.",
  ":::",
  "",
  // Ikke en ramme sist: testhjelperen legger « (EN)» på slutten av den engelske teksten.
  "Lykke til.",
].join(NL);

async function expectPlainPractice(root: ReturnType<Page["locator"]>) {
  await expect(root.locator(".content-think")).toBeVisible();
  await expect(root.locator(".content-steps, .content-write, .content-flash")).toHaveCount(0);
  await expect(root.locator("textarea")).toHaveCount(0);
  await expect(root).toContainText(":::steg Slik gjør du");
  await expect(root).toContainText(":::skriv Skriv et vedtak.");
  await expect(root).toContainText(":::repetisjon");
}

test("deltakerens modulside: øvelsene står som vanlig tekst i oppgaveteksten, «tenk først» tegnes", async ({ page }) => {
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: {},
      output: {},
    })),
  );
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [{ id: "c1", title: "Kurs", description: null, moduleCount: 1, progress: { completed: 0, total: 1, courseStatus: "NOT_STARTED" } }] })),
  );
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({ course: { id: "c1", title: "Kurs", items: [{ type: "MODULE", moduleId: "m1", title: "Modul", available: true }] } })),
  );
  await page.route("**/api/modules?includeCompleted=true", (route: Route) =>
    route.fulfill(json({
      modules: [{
        id: "m1",
        title: "Modul",
        description: null,
        taskText: MD,
        taskTextHtml: renderModuleTextMarkdown(MD, "nb"),
        candidateTaskConstraints: MD,
        candidateTaskConstraintsHtml: renderModuleTextMarkdown(MD, "nb"),
        assessmentMode: "FREETEXT_ONLY",
        submissionSchema: { fields: [] },
        assessmentPolicy: null,
        participantStatus: null,
        activeVersion: { id: "v1", assessmentMode: "FREETEXT_ONLY" },
      }],
    })),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await page.locator(".course-module-row").click();

  const brief = page.locator("#selectedModuleTaskText");
  await expect(brief).toHaveClass(/is-rendered/);
  await expectPlainPractice(brief);
  await expectPlainPractice(page.locator("#selectedModuleCandidateTaskConstraints"));
});

test("forhåndsvisningen i modularbeidsflaten: tjeneren tegner modulens tekst uten øvelsene", async ({ page }) => {
  await mockCommonApis(page, {
    modules: [{ id: "module-1", title: "Trade unions", activeVersion: { versionNo: 1 } }],
    moduleExports: {
      "module-1": buildMockModuleExport({
        id: "module-1",
        title: "Trade unions",
        moduleVersionId: "module-1-version-1",
        taskText: localizedText(MD),
      }),
    },
  });
  // Som den ekte ruta (src/routes/adminSections.ts): varianten sendes videre til tegningen.
  const variants: Array<string | undefined> = [];
  await page.route("**/api/admin/content/sections/preview", (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { markdown?: string; locale?: string; variant?: "section" | "moduleText" };
    variants.push(body.variant);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ html: renderSectionMarkdown(body.markdown ?? "", body.locale, body.variant ?? "section") }),
    });
  });

  await page.goto("/admin-content/module/module-1/conversation");
  await page.locator("#previewEditTitle").waitFor();
  await page.locator("#formTab-preview").click();

  const block = page.locator(".preview-text-block.is-rendered").filter({ hasText: "Les saken først." }).first();
  await expect(block).toBeVisible();
  await expectPlainPractice(block);
  expect(variants.length).toBeGreaterThan(0);
  expect(new Set(variants)).toEqual(new Set(["moduleText"]));
});
