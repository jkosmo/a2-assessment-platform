import { expect, test, type Page, type Route } from "@playwright/test";

import { buildMockModuleExport, localizedText, mockCommonApis } from "./admin-content-helpers.js";

// #1173 — språk og tilgjengelighet i innholdsforvaltningen (fra konsistenssjekken #1157).
//
// Fire funn, fire grupper her:
//   1. Rammen («Hopp til hovedinnhold», den skjulte etiketten på språkvelgeren, `lang` på <html>) sto
//      på engelsk på Moduler, Seksjoner, Klasser og Tema — sidene oversatte aldri sin egen `data-i18n`.
//   2. Norsk på engelske sider: klassen, kursets plassholder, «1 kurs» i biblioteket,
//      «Modulforhåndsvisning», og eierpanelet som står på Innstillinger i alle fire redigeringssidene.
//   3. Felt uten koblet etikett: «Ny modul» (Navn, Modultype, Sertifiseringsnivå), modulens
//      innstillinger, søk og kursvelger i klassen. Målt med getByLabel — det er skjermleserens spørsmål.
//   4. Avkrysningsboksene i modulens redigeringsside hadde klikkflate under 24 px.
//
// ⚠️ På en-GB er HTML-teksten allerede engelsk, så den kolonnen sier lite alene. Det er nb og nn som
// måler rettingen; en-GB er med fordi nøklene må finnes der også.

type Locale = "nb" | "nn" | "en-GB";
const LOCALES: Locale[] = ["nb", "nn", "en-GB"];

const CHROME: Record<Locale, { skip: string; label: string }> = {
  nb: { skip: "Hopp til hovedinnhold", label: "Språk" },
  nn: { skip: "Hopp til hovudinnhald", label: "Språk" },
  "en-GB": { skip: "Skip to main content", label: "Language" },
};

async function useLocale(page: Page, locale: Locale) {
  await page.addInitScript((value) => {
    try { localStorage.setItem("participant.locale", value); } catch { /* ignore */ }
  }, locale);
}

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function mockSectionsThemesClasses(page: Page, opts: { members?: number; courses?: number } = {}) {
  await page.route("**/api/admin/content/sections", (route: Route) =>
    route.request().method() === "GET" ? route.fulfill(json({ sections: [] })) : route.fallback());
  await page.route("**/api/admin/content/themes**", (route: Route) => route.fulfill(json({ themes: [] })));
  await page.route("**/api/admin/content/classes", (route: Route) =>
    route.fulfill(json({ classes: [{ id: "cls-1", name: "Kull 2026", isSystem: false, _count: { members: 1, courseAssignments: 1 } }] })));
  await page.route("**/api/admin/content/classes/*", (route: Route) =>
    route.fulfill(json({ class: { id: "cls-1", name: "Kull 2026", isSystem: false, archivedAt: null, lifecycle: "active" } })));
  await page.route("**/api/admin/content/classes/*/members", (route: Route) =>
    route.fulfill(json({ members: Array.from({ length: opts.members ?? 1 }, (_, i) => ({ userId: `u${i}`, name: `Kari ${i}`, email: `kari${i}@x.no`, addedAt: "2026-01-01T00:00:00.000Z" })) })));
  await page.route("**/api/admin/content/classes/*/courses", (route: Route) =>
    route.fulfill(json({ courses: Array.from({ length: opts.courses ?? 1 }, (_, i) => ({ courseId: `c${i}`, title: `Kurs ${i}`, dueAt: null, coursePublished: true, courseArchived: false })) })));
  await page.route("**/api/admin/content-owners/**", (route: Route) =>
    route.fulfill(json({ owners: [{ userId: "u1", name: "Alice Owner", email: "alice@x.no", addedAt: "2026-07-19T00:00:00.000Z" }], canManage: true })));
}

const mcqModule = () =>
  buildMockModuleExport({
    id: "module-1",
    title: "Trade unions",
    moduleVersionId: "module-1-version-1",
    taskText: localizedText("Scenario"),
    mcqQuestions: [
      {
        stem: localizedText("Which duty applies?"),
        options: [localizedText("Option A"), localizedText("Option B"), localizedText("Option C")],
        correctAnswer: localizedText("Option B"),
        rationale: localizedText("B is the strongest fit"),
      },
    ],
  });

const PAGES: Array<{ name: string; path: string }> = [
  { name: "Moduler", path: "/admin-content" },
  { name: "Kurs", path: "/admin-content/courses" },
  { name: "Seksjoner", path: "/admin-content/sections" },
  { name: "Tema", path: "/admin-content/themes" },
  { name: "Klasser", path: "/deltakere/klasser" },
  { name: "Modulens arbeidsflate", path: "/admin-content/module/module-1/conversation" },
];

test.describe("#1173 rammen følger språket på alle sidene i innholdsforvaltningen", () => {
  for (const locale of LOCALES) {
    test(`hopp-lenke, etiketten på språkvelgeren og lang på <html> (${locale})`, async ({ page }) => {
      await useLocale(page, locale);
      await mockCommonApis(page, {
        meRoles: ["ADMINISTRATOR"],
        modules: [{ id: "module-1", title: "Trade unions" }],
        moduleExports: { "module-1": mcqModule() },
      });
      await mockSectionsThemesClasses(page);
      for (const { name, path } of PAGES) {
        await page.goto(path);
        await expect(page.locator(".skip-nav"), `${name}: hopp-lenken`).toHaveText(CHROME[locale].skip);
        await expect(page.locator('label[for="localeSelect"]'), `${name}: etiketten`).toHaveText(CHROME[locale].label);
        await expect(page.locator("html"), `${name}: lang`).toHaveAttribute("lang", locale);
        // Etiketten er koblet: språkvelgeren HAR det navnet for en skjermleser.
        await expect(page.getByLabel(CHROME[locale].label, { exact: true }), `${name}: språkvelgeren`).toHaveId("localeSelect");
      }
    });
  }

  test("bytte av språk i velgeren oversetter rammen uten ny lasting (Seksjoner, nb → en-GB → nn)", async ({ page }) => {
    await useLocale(page, "nb");
    await mockCommonApis(page, {});
    await mockSectionsThemesClasses(page);
    await page.goto("/admin-content/sections");
    await expect(page.locator(".skip-nav")).toHaveText(CHROME.nb.skip);
    await page.locator("#localeSelect").selectOption("en-GB");
    await expect(page.locator(".skip-nav")).toHaveText(CHROME["en-GB"].skip);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
    await page.locator("#localeSelect").selectOption("nn");
    await expect(page.locator(".skip-nav")).toHaveText(CHROME.nn.skip);
    await expect(page.locator('label[for="localeSelect"]')).toHaveText(CHROME.nn.label);
  });
});

const CLASS_TEXT: Record<Locale, { members: string; courses: string; deadline: string; search: string; pick: string; owners: string; editOwners: string }> = {
  nb: { members: "Deltakere (1)", courses: "Tildelte kurs (1)", deadline: "Frist (valgfri)", search: "Søk etter deltaker å legge til", pick: "Kurs som skal tildeles", owners: "Eiere", editOwners: "Endre eiere" },
  nn: { members: "Deltakarar (1)", courses: "Tildelte kurs (1)", deadline: "Frist (valfri)", search: "Søk etter deltakar å leggje til", pick: "Kurs som skal tildelast", owners: "Eigarar", editOwners: "Endre eigarar" },
  "en-GB": { members: "Participants (1)", courses: "Assigned courses (1)", deadline: "Deadline (optional)", search: "Search for a participant to add", pick: "Course to assign", owners: "Owners", editOwners: "Change owners" },
};

test.describe("#1173 klassen: overskrifter, etiketter og eierpanelet på sidens språk", () => {
  for (const locale of LOCALES) {
    test(`klassen (${locale})`, async ({ page }) => {
      await useLocale(page, locale);
      await mockCommonApis(page, { meRoles: ["ADMINISTRATOR"] });
      await mockSectionsThemesClasses(page);
      await page.goto("/deltakere/klasser");
      await page.locator('[data-action="open"][data-id="cls-1"]').click();

      const text = CLASS_TEXT[locale];
      await expect(page.locator('[data-form-tab="rediger"] h2').nth(1)).toHaveText(text.members);
      await expect(page.locator('[data-form-tab="rediger"] h2').nth(2)).toHaveText(text.courses);
      await expect(page.locator('label[for="dueAtInput"]')).toContainText(text.deadline);
      // Feltene er koblet til en etikett — ikke bare en plassholder eller et første valg i lista.
      await expect(page.getByLabel(text.search, { exact: true })).toHaveId("studentSearch");
      await expect(page.getByLabel(text.pick, { exact: true })).toHaveId("courseSelect");

      // Eierpanelet (owner-panel.js) er felles for kurs, seksjon, modul og klasse.
      await page.locator('[data-form-tab-btn="innstillinger"]').click();
      const panel = page.locator("#classOwnerPanelHost .owner-panel");
      await expect(panel.locator(".owner-compact-label")).toHaveText(text.owners);
      await expect(panel.locator(".owner-edit-toggle")).toHaveText(text.editOwners);
    });
  }
});

test.describe("#1173 norsk tekst på engelske sider", () => {
  const PLACEHOLDER: Record<Locale, string> = { nb: "Viser bokmål hvis tomt", nn: "Viser bokmål om tomt", "en-GB": "Shows Bokmål if empty" };

  for (const locale of LOCALES) {
    test(`kursets plassholder for tomme språk (${locale})`, async ({ page }) => {
      await useLocale(page, locale);
      await mockCommonApis(page, {
        courses: [{ id: "course-1", title: { nb: "Kurs" }, certificationLevel: "basic", moduleCount: 0, modules: [] }],
      });
      await page.goto("/admin-content/courses/course-1");
      // Feltene for nynorsk og engelsk står i DOM-en (én fane synlig om gangen); bokmål har ingen plassholder.
      await expect(page.locator("#title-en-GB")).toHaveAttribute("placeholder", PLACEHOLDER[locale]);
      await expect(page.locator("#desc-nn")).toHaveAttribute("placeholder", PLACEHOLDER[locale]);
      await expect(page.locator("#title-nb")).toHaveAttribute("placeholder", "");
    });
  }

  test("modulbiblioteket: antall kurs og lista over dem har engelsk navn på en engelsk side", async ({ page }) => {
    await useLocale(page, "en-GB");
    await mockCommonApis(page, {
      libraryModules: [{ id: "module-1", title: "Used module", status: "published", courseCount: 1, courses: [{ id: "c1", title: "Change management" }] }],
    });
    await page.goto("/admin-content");
    const count = page.getByRole("button", { name: "Used in courses: 1", exact: true });
    await expect(count).toBeVisible();
    await count.click();
    const popover = page.getByRole("dialog", { name: "Courses that use the module" });
    await expect(popover).toBeVisible();
    await expect(popover.locator(".courses-popover-title")).toHaveText("Used in courses");
  });

  test("modulbiblioteket på bokmål (kontroll: nøkkelen er ikke bare engelsk overalt)", async ({ page }) => {
    await useLocale(page, "nb");
    await mockCommonApis(page, {
      libraryModules: [{ id: "module-1", title: "Brukt modul", status: "published", courseCount: 2, courses: [] }],
    });
    await page.goto("/admin-content");
    await expect(page.getByRole("button", { name: "Brukt i kurs: 2", exact: true })).toBeVisible();
  });

  for (const [locale, name] of [["en-GB", "Module preview"], ["nb", "Modulforhåndsvisning"], ["nn", "Modulførehandsvising"]] as const) {
    test(`modulens forhåndsvisning har navn på sidens språk (${locale})`, async ({ page }) => {
      await useLocale(page, locale);
      await mockCommonApis(page, { modules: [{ id: "module-1", title: "Trade unions" }], moduleExports: { "module-1": mcqModule() } });
      await page.goto("/admin-content/module/module-1/conversation");
      await expect(page.locator("section.preview-pane")).toHaveAttribute("aria-label", name);
    });
  }
});

test.describe("#1173 feltene i modulens innstillinger har en koblet etikett", () => {
  const NEW_MODULE: Record<Locale, { name: RegExp; type: string; level: string }> = {
    nb: { name: /^Navn/, type: "Modultype", level: "Sertifiseringsnivå" },
    nn: { name: /^Namn/, type: "Modultype", level: "Sertifiseringsnivå" },
    "en-GB": { name: /^Name/, type: "Module type", level: "Certification level" },
  };

  for (const locale of LOCALES) {
    test(`Ny modul: Navn, Modultype og Sertifiseringsnivå (${locale})`, async ({ page }) => {
      await useLocale(page, locale);
      await mockCommonApis(page, {});
      await page.goto("/admin-content/module/new/conversation");
      await page.locator("#formTab-settings").click();
      const text = NEW_MODULE[locale];
      // Innenfor Innstillinger: Rediger-fanen har sitt eget «Navn»-felt (tittelen), som står skjult i DOM-en.
      const settings = page.locator("#settingsSummary");
      await expect(settings.getByLabel(text.name)).toHaveId("settingsNewName");
      await expect(settings.getByLabel(text.type, { exact: true })).toHaveId("settingsModuleType");
      await expect(settings.getByLabel(text.level, { exact: true })).toHaveId("settingsCertLevel");
    });
  }

  test("en lagret modul: hvert felt i innstillingene har et navn (en-GB)", async ({ page }) => {
    await useLocale(page, "en-GB");
    await mockCommonApis(page, { modules: [{ id: "module-1", title: "Trade unions" }], moduleExports: { "module-1": mcqModule() } });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#formTab-settings").click();
    await expect(page.getByLabel("Module type", { exact: true })).toHaveId("settingsModuleType");
    await expect(page.getByLabel("Overall pass mark", { exact: true })).toHaveId("settingsTotalMin");
    // Dekningen, ikke bare tre utvalgte: ingen synlige felt i panelet uten navn.
    const unnamed = await page.locator("#settingsSummary").evaluate((host) =>
      Array.from(host.querySelectorAll<HTMLInputElement>("input:not([type=hidden]), select, textarea"))
        .filter((el) => el.getBoundingClientRect().width > 0)
        .filter((el) => !(el.labels && el.labels.length) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"))
        .map((el) => el.id || el.outerHTML.slice(0, 80)));
    expect(unnamed).toEqual([]);
  });
});

test("#1173 seksjonens tekstfelt har navnet fra overskriften over det («Innhold (Markdown)»)", async ({ page }) => {
  await useLocale(page, "nb");
  await mockCommonApis(page, {});
  await page.route("**/api/admin/content/sections/preview", (route: Route) => route.fulfill(json({ html: "<p>preview</p>" })));
  await page.route("**/api/admin/content/sections/sec-1", (route: Route) =>
    route.fulfill(json({ section: { id: "sec-1", title: { nb: "Innledning", nn: "", "en-GB": "" }, bodyMarkdown: { nb: "Tekst", nn: "", "en-GB": "" }, activeVersionId: "v1", archivedAt: null } })));
  await page.goto("/admin-content/sections?id=sec-1");
  await expect(page.getByLabel(/^Innhold \(Markdown\)/)).toHaveId("markdownInput");
});

test.describe("#1173 avkrysningsboksene i modulens redigeringsside har minst 24 × 24 px klikkflate", () => {
  // Etiketten omslutter boksen og ER klikkflaten. Vi måler den, og klikker helt øverst i den for å vise
  // at hele høyden faktisk virker — ikke bare at boksen er tegnet høyere.
  async function assertTargets(page: Page, selector: string, expected: number) {
    const labels = page.locator(selector);
    await expect(labels).toHaveCount(expected);
    for (let i = 0; i < expected; i += 1) {
      const box = await labels.nth(i).boundingBox();
      expect(box, `${selector} #${i}`).not.toBeNull();
      expect(box!.height, `${selector} #${i} høyde`).toBeGreaterThanOrEqual(24);
      expect(box!.width, `${selector} #${i} bredde`).toBeGreaterThanOrEqual(24);
    }
    const first = labels.first();
    const checkbox = first.locator('input[type="checkbox"]');
    const before = await checkbox.isChecked();
    await first.click({ position: { x: 4, y: 1 } });
    await expect(checkbox).toBeChecked({ checked: !before });
  }

  test("Rediger: «flere riktige», «rekkefølge» og «fyll inn» per spørsmål", async ({ page }) => {
    await useLocale(page, "nb");
    await mockCommonApis(page, { modules: [{ id: "module-1", title: "Trade unions" }], moduleExports: { "module-1": mcqModule() } });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#previewEditTitle").waitFor();
    await page.locator("details.preview-edit-mcq-item").first().evaluate((el) => { (el as HTMLDetailsElement).open = true; });
    await assertTargets(page, "label.preview-edit-mcq-multiple", 3);
  });

  test("Innstillinger: stokking, gjennomgang og eksempelsvar", async ({ page }) => {
    await useLocale(page, "nb");
    await mockCommonApis(page, { modules: [{ id: "module-1", title: "Trade unions" }], moduleExports: { "module-1": mcqModule() } });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#formTab-settings").click();
    await assertTargets(page, "label.settings-check", 3);
  });
});
