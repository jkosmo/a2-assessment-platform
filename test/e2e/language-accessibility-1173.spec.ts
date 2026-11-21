import { expect, test, type Page, type Route } from "@playwright/test";

import { buildMockModuleExport, localizedText, mockCommonApis, revealRowAction } from "./admin-content-helpers.js";

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

const NAV_NAME: Record<Locale, { content: string; participants: string }> = {
  nb: { content: "Innholdsadministrasjon", participants: "Deltakere" },
  nn: { content: "Innhaldsadministrasjon", participants: "Deltakarar" },
  "en-GB": { content: "Content administration", participants: "Participants" },
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
        // #1173 (rest): menyens eget navn for skjermleseren sto på bokmål.
        const participants = path.startsWith("/deltakere");
        await expect(page.locator(participants ? "#deltakereSubnav" : "#contentAreaNav"), `${name}: menyens navn`)
          .toHaveAttribute("aria-label", NAV_NAME[locale][participants ? "participants" : "content"]);
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

// ---------------------------------------------------------------------------------------------------------------------
// #1173 (rest): det 2.171.0 lot stå. Bekreftelser og dialoger på bokmål på engelske sider, felt i et par med samme navn,
// og eierpanelet i modulen som ikke byttet språk før noen klikket i det.
// ---------------------------------------------------------------------------------------------------------------------

/** Svarer «Avbryt» på nettleserens bekreftelse og gir tilbake teksten den viste. */
function captureConfirm(page: Page) {
  const messages: string[] = [];
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  return messages;
}

test.describe("#1173 bekreftelsene står på sidens språk", () => {
  for (const [locale, expected] of [
    ["en-GB", "Archive the class «Kull 2026»?"],
    ["nb", "Arkivere klassen «Kull 2026»?"],
  ] as const) {
    test(`arkiver klasse (${locale})`, async ({ page }) => {
      await useLocale(page, locale);
      await mockCommonApis(page, { meRoles: ["ADMINISTRATOR"] });
      await mockSectionsThemesClasses(page);
      const messages = captureConfirm(page);
      await page.goto("/deltakere/klasser");
      await (await revealRowAction(page, page.locator('[data-action="archive"][data-id="cls-1"]'))).click();
      await expect.poll(() => messages).toEqual([expected]);
    });
  }

  for (const [locale, expected] of [
    ["en-GB", "Unpublish «Used module»?\n\nThe module can no longer receive new submissions."],
    ["nn", "Avpublisere «Used module»?\n\nModulen kan ikkje lenger ta imot nye innleveringar."],
  ] as const) {
    test(`avpubliser modul fra biblioteket (${locale})`, async ({ page }) => {
      await useLocale(page, locale);
      await mockCommonApis(page, { libraryModules: [{ id: "module-1", title: "Used module", status: "published" }] });
      const messages = captureConfirm(page);
      await page.goto("/admin-content");
      await (await revealRowAction(page, page.locator('[data-action="unpublish"][data-module-id="module-1"]'))).click();
      await expect.poll(() => messages.length).toBe(1);
      expect(messages[0].startsWith(expected), messages[0]).toBe(true);
    });
  }
});

test("#1173 «Rydd upubliserte» står på engelsk på en engelsk side", async ({ page }) => {
  await useLocale(page, "en-GB");
  await mockCommonApis(page, { libraryModules: [], meRoles: ["ADMINISTRATOR"] });
  await page.route("**/api/admin/content/modules/purge-unpublished/preview", (route: Route) =>
    route.fulfill(json({ candidates: [{ id: "mod-1", title: "Draft module", reasonSkipped: null }] })));
  await page.goto("/admin-content");
  // Knappen som åpner dialogen (QA 2.176.0: sto på bokmål).
  await expect(page.locator("#purgeUnpublishedBtn")).toHaveText("Clean up unpublished");
  await page.locator("#purgeUnpublishedBtn").click();
  const dialog = page.locator("#purgeUnpublishedDialog");
  await expect(dialog.locator("#purgeDialogTitle")).toHaveText("Clean up unpublished modules");
  await expect(dialog.locator('label[for="purgeConfirmInput"]')).toHaveText("Type SLETT to confirm");
  await expect(dialog.locator("#purgeConfirmBtn")).toHaveText("Delete all");
  await expect(dialog.locator("#purgeCancelBtn")).toHaveText("Cancel");
  // Feltet har fortsatt etiketten som navn (ordet SLETT står mellom to oversatte biter).
  await expect(page.getByLabel("Type SLETT to confirm", { exact: true })).toHaveId("purgeConfirmInput");
  await expect(dialog).not.toContainText("moduler");
});

test("#1173 «Slett kurs og ubrukt innhold» står på engelsk på en engelsk side", async ({ page }) => {
  await useLocale(page, "en-GB");
  await mockCommonApis(page, {
    meRoles: ["ADMINISTRATOR"],
    courses: [{ id: "course-1", title: "Labour rights", certificationLevel: "basic", moduleCount: 1, publishedAt: null, archivedAt: "2026-04-17T12:00:00.000Z", modules: [] }],
  });
  await page.route("**/api/admin/content/courses/*/cascade-delete-preview", (route: Route) =>
    route.fulfill(json({
      courseId: "course-1", courseTitle: "Labour rights",
      deletableModules: [{ id: "m1", title: "Intro" }], deletableSections: [{ id: "s1", title: "Intro" }, { id: "s2", title: "End" }],
      sparedModules: [], sparedSections: [], blockers: [], deletable: true,
    })));
  await page.goto("/admin-content/courses");
  await page.locator('.list-filters [data-filter="all"]').click();
  const row = page.locator("#coursesTableBody tr").filter({ hasText: "Labour rights" });
  await (await revealRowAction(page, row.locator('[data-action="cascade-delete"]'))).click();
  await expect(page.locator("#cascadeDeleteTitle")).toHaveText("Delete «Labour rights» and unused content");
  await expect(page.locator("#cascadeDeleteText")).toHaveText(
    "This deletes the course, 1 module(s) and 2 section(s) used only in this course. Shared content is kept.");
  await expect(page.locator("#cascadeDeleteConfirmBtn")).toHaveText("Delete course and unused content");
  await expect(page.locator("#cascadeDeleteCancelBtn")).toHaveText("Cancel");
});

test.describe("#1173 to felt i samme rad har hvert sitt navn", () => {
  for (const [locale, from, to] of [
    ["en-GB", "Valid, from", "Valid, to"],
    ["nb", "Gyldig, fra", "Gyldig, til"],
  ] as const) {
    test(`gyldighet (${locale})`, async ({ page }) => {
      await useLocale(page, locale);
      await mockCommonApis(page, { modules: [{ id: "module-1", title: "Trade unions" }], moduleExports: { "module-1": mcqModule() } });
      await page.goto("/admin-content/module/module-1/conversation");
      await page.locator("#formTab-settings").click();
      await expect(page.getByLabel(from, { exact: true })).toHaveId("settingsValidFrom");
      await expect(page.getByLabel(to, { exact: true })).toHaveId("settingsValidTo");
    });
  }

  test("ingen to synlige felt i innstillingene har samme navn (en-GB)", async ({ page }) => {
    await useLocale(page, "en-GB");
    await mockCommonApis(page, { modules: [{ id: "module-1", title: "Trade unions" }], moduleExports: { "module-1": mcqModule() } });
    await page.goto("/admin-content/module/module-1/conversation");
    await page.locator("#formTab-settings").click();
    await expect(page.locator("#settingsValidFrom")).toBeVisible();
    const names = await page.locator("#settingsSummary").evaluate((host) =>
      Array.from(host.querySelectorAll<HTMLInputElement>("input:not([type=hidden]), select, textarea"))
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => {
          const own = el.getAttribute("aria-label");
          if (own) return own;
          const ref = el.getAttribute("aria-labelledby");
          if (ref) return ref.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ");
          return (el.labels?.[0]?.textContent ?? "").trim();
        }));
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
    expect(duplicates).toEqual([]);
  });
});

test("#1173 eierpanelet i modulen bytter språk sammen med siden", async ({ page }) => {
  await useLocale(page, "nb");
  await mockCommonApis(page, { meRoles: ["ADMINISTRATOR"], modules: [{ id: "module-1", title: "Trade unions" }], moduleExports: { "module-1": mcqModule() } });
  await mockSectionsThemesClasses(page);
  await page.goto("/admin-content/module/module-1/conversation");
  await page.locator("#formTab-settings").click();
  const panel = page.locator("#moduleOwnerPanelHost .owner-panel");
  await expect(panel.locator(".owner-compact-label")).toHaveText("Eiere");
  await page.locator("#localeSelect").selectOption("en-GB");
  // Ingen klikk i panelet: før sto det på bokmål til noen trykket «Endre eiere».
  await expect(panel.locator(".owner-compact-label")).toHaveText("Owners");
  await expect(panel.locator(".owner-edit-toggle")).toHaveText("Change owners");
});
