import { test, expect, type Page, type Route } from "@playwright/test";
import { renderSectionMarkdown } from "../../src/modules/course/sectionContent.js";

// Lesemodus (#1079). Produkteier 2026-10-06: «for lite skille mellom hva som er kursportalen, og
// kontroller i den, vs. innholdet som vises innenfor den». Innholdet lå fire rammer dypt, alle med
// samme lyse flate, tynne ramme og runde hjørner som innholdets egne kort og bokser.
//
// Valgt på prøvesiden: når en seksjon åpnes, viker kurset — bare hodet (hvor du er, spaltebredde,
// lukk) og arket med innholdet står igjen. Leseren velger «Smal» (alt på ~72 tegn) eller «Bred»
// (teksten på ~72 tegn, kort/tabeller/figurer over hele arket); valget huskes i nettleseren. På
// telefon er det én spalte og ingen velger. Kurset kommer tilbake når seksjonen lukkes.

const F = "```";
const MARKDOWN = [
  "Fire arbeidsformer står til valg, og de utfyller hverandre: chat for det raske, lerret for teksten som skal vokse, prosjekt for kildene som skal ligge fast, og grundig tenkemodus for analysen som trenger tid.",
  "",
  ":::kort",
  "### Chat (samtale)", "", "Rask hjelp, idémyldring, utkast.", "",
  "### Lerret (Canvas)", "", "Når du skal utvikle tekst stegvis over tid.", "",
  "### Prosjekt", "", "Komplekse oppgaver med mange kilder.", "",
  "### Grundig tenkemodus", "", "Krevende analyser der kvalitet går foran fart.",
  ":::",
  "",
  "> **Husk:** Jo mer du legger i kontekstvinduet, desto viktigere er det å rydde.",
  "",
  `${F}prompt`, "Du skal skrive kapittel [nummer] i en rapport.", F,
  "",
  "| Kapittel | Innhold | Hentes fra |", "|---|---|---|", "| Sammendrag | Hovedfunn | Rapporten |",
].join("\n");

const STEG = [
  { type: "SECTION", sectionId: "s1", title: "Arbeidsformer", read: false },
  { type: "SECTION", sectionId: "s2", title: "Fra kilder til analysegrunnlag", read: false },
  { type: "MODULE", moduleId: "m1", title: "Test 1: Arbeidsform, kilder og analyse", moduleStatus: "NOT_STARTED" },
];

async function åpneKurset(page: Page, bredde: number) {
  await page.setViewportSize({ width: bredde, height: 900 });
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill(json({
      authMode: "mock",
      navigation: { items: [], workspaceItems: [] },
      identityDefaults: { participant: { userId: "participant-1", email: "p@x.no", name: "P", department: "X", roles: ["PARTICIPANT"] } },
      calibrationWorkspace: { accessRoles: [] },
      flow: {},
      output: {},
    })));
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({ user: { roles: ["PARTICIPANT"] }, consent: { accepted: true, currentVersion: "1.0" } })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/courses", (route: Route) =>
    route.fulfill(json({ courses: [{ id: "c1", title: "Rapportskriving med generativ KI", description: null, moduleCount: 1, progress: { completed: 0, total: 3, courseStatus: "IN_PROGRESS" }, publishedAt: "2026-01-01T00:00:00.000Z" }] })));
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: [] })));
  await page.route("**/api/courses/c1", (route: Route) =>
    route.fulfill(json({ course: { id: "c1", title: "Rapportskriving med generativ KI", discussionsEnabled: true, items: STEG } })));
  await page.route("**/api/courses/c1/sections/*", (route: Route) => route.fulfill(json({ title: "Arbeidsformer", html: renderSectionMarkdown(MARKDOWN, "nb") })));
  await page.route("**/api/courses/c1/discussions**", (route: Route) => route.fulfill(json({ threads: [], canPost: true })));
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ } });
  await page.goto("/participant");
  await page.locator(".course-accordion-header").click();
  await expect(page.locator(".course-module-row")).toHaveCount(3);
}

async function åpneSeksjonen(page: Page) {
  await page.locator(".course-module-row").first().click();
  await expect(page.locator("#sectionReaderBody .content-cards")).toBeVisible();
}

/** Hva som er synlig for leseren: kurset rundt, eller bare arket. */
function hvaSomVises(page: Page) {
  return page.evaluate(() => {
    const synlig = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
    const ark = document.querySelector<HTMLElement>("#sectionReaderBody")!;
    const body = ark.closest<HTMLElement>(".course-inline-panel-body")!;
    const avsnitt = ark.querySelector<HTMLElement>("p")!;
    const kort = [...ark.querySelectorAll<HTMLElement>(".content-card")].map((k) => Math.round(k.getBoundingClientRect().top));
    return {
      kurshode: synlig(".course-accordion-header"),
      andreSteg: synlig(".course-item:not(.open) .course-module-row"),
      egetStegkort: synlig(".course-item.open .course-module-row"),
      diskusjon: synlig(".course-discussion-toggle"),
      tilbakeknapp: synlig(".course-back-bar"),
      hode: synlig(".course-inline-panel-sticky"),
      posisjon: document.querySelector(".course-reading-position")?.textContent?.trim() ?? null,
      velger: synlig(".course-reading-width"),
      arkBredde: Math.round(body.getBoundingClientRect().width),
      avsnittBredde: Math.round(avsnitt.getBoundingClientRect().width),
      kortRader: new Set(kort).size,
      arkSkygge: getComputedStyle(ark).boxShadow !== "none",
      lukk: synlig(".course-inline-panel-close"),
      handling: document.querySelector("#sectionReaderMarkRead")?.textContent?.trim() ?? null,
      utenfor: [...ark.querySelectorAll<HTMLElement>("*")].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5).length,
      sidelengs: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

/** Sett LESEMODUS_BILDER til en mappe for å få skjermbilder å se på. */
const BILDER = process.env.LESEMODUS_BILDER ?? "";

test.describe("lesemodus — kurset viker når en seksjon leses (#1079)", () => {
  test("PC: bare hodet og arket står igjen; bred spalte som standard, teksten holdes lesbar, kortene får hele arket", async ({ page }) => {
    await åpneKurset(page, 1280);
    const før = await hvaSomVises(page).catch(() => null);
    expect(før).toBeNull(); // ingen leser åpen ennå: #sectionReaderBody finnes ikke

    await åpneSeksjonen(page);
    if (BILDER) await page.screenshot({ path: `${BILDER}/lesemodus-1280-bred.png`, fullPage: true });
    const m = await hvaSomVises(page);
    expect(m.kurshode, "kurskortets hode er borte").toBe(0);
    expect(m.andreSteg, "de andre stegene er borte").toBe(0);
    expect(m.egetStegkort, "stegkortet med «Les» er borte").toBe(0);
    expect(m.diskusjon, "diskusjonslinja er borte").toBe(0);
    expect(m.tilbakeknapp, "«Alle kurs» er borte").toBe(0);
    expect(m.hode, "hodet står").toBe(1);
    expect(m.posisjon).toBe("Steg 1 av 3");
    expect(m.velger, "spaltevelgeren vises på PC").toBe(1);
    expect(m.lukk).toBe(1);
    expect(m.handling).toContain("Marker seksjon lest");
    expect(m.arkSkygge, "arket har skygge").toBe(true);
    // Bred: arket bruker plassen (inntil 1100 px), teksten holdes på rundt 72 tegn, kortene står på én rad.
    expect(m.arkBredde).toBeGreaterThan(1000);
    expect(m.arkBredde).toBeLessThanOrEqual(1100);
    expect(m.avsnittBredde).toBeLessThan(800);
    expect(m.kortRader).toBe(1);
    expect(m.utenfor).toBe(0);
  });

  test("PC: «Smal» gjør hele arket smalt, valget huskes til neste gang, og «Bred» tar det tilbake", async ({ page }) => {
    await åpneKurset(page, 1280);
    await åpneSeksjonen(page);
    await page.locator('.course-reading-width [data-reader-width="narrow"]').click();
    if (BILDER) await page.screenshot({ path: `${BILDER}/lesemodus-1280-smal.png`, fullPage: true });
    let m = await hvaSomVises(page);
    expect(m.arkBredde, "smalt ark").toBeLessThan(800);
    expect(m.kortRader, "kortene brekker til flere rader i den smale spalten").toBeGreaterThan(1);
    await expect(page.locator('.course-reading-width [data-reader-width="narrow"]')).toHaveAttribute("aria-pressed", "true");

    // Huskes: ny sidelasting, samme seksjon, fortsatt smal.
    await page.reload();
    await page.locator(".course-accordion-header").click();
    await expect(page.locator(".course-module-row")).toHaveCount(3);
    await åpneSeksjonen(page);
    m = await hvaSomVises(page);
    expect(m.arkBredde, "valget er husket").toBeLessThan(800);

    await page.locator('.course-reading-width [data-reader-width="wide"]').click();
    m = await hvaSomVises(page);
    expect(m.arkBredde).toBeGreaterThan(1000);
  });

  test("lukk seksjonen: kurset kommer tilbake slik det var", async ({ page }) => {
    await åpneKurset(page, 1280);
    await åpneSeksjonen(page);
    await page.locator(".course-inline-panel-close").click();
    await expect(page.locator("#sectionReaderBody")).toHaveCount(0);
    await expect(page.locator(".course-accordion-header")).toBeVisible();
    await expect(page.locator(".course-module-row")).toHaveCount(3);
    for (const rad of await page.locator(".course-module-row").all()) await expect(rad).toBeVisible();
    await expect(page.locator(".course-discussion-toggle")).toBeVisible();
    expect(await page.locator(".course-reading").count(), "lesemodus-klassen er borte").toBe(0);
  });

  // QA-porten (2.85.0): klassen ble bare satt ved åpning. Tegnes kurset på nytt mens seksjonen er
  // åpen, sto seksjonen igjen med alle stegene synlige rundt seg.
  test("språkbytte mens seksjonen er åpen: lesemodus står", async ({ page }) => {
    await åpneKurset(page, 1280);
    await åpneSeksjonen(page);
    // Fokus settes eksplisitt: det er det omtegningen ikke skal ta (2.85.2).
    await page.locator("#localeSelect").focus();
    await page.locator("#localeSelect").selectOption("en-GB");
    await expect(page.locator("#sectionReaderBody .content-cards")).toBeVisible();
    await expect(page.locator(".course-reading-position")).toHaveText("Step 1 of 3");
    const m = await hvaSomVises(page);
    expect(m.kurshode, "kurskortets hode er fortsatt borte").toBe(0);
    expect(m.andreSteg, "de andre stegene er fortsatt borte").toBe(0);
    expect(m.arkSkygge).toBe(true);
    // 2.85.2: omtegningen tar ikke fokus fra språkvelgeren.
    expect(await page.evaluate(() => document.activeElement?.id ?? ""), "fokus står på språkvelgeren").toBe("localeSelect");
  });

  test("«gå videre» når kurslista svarer sent: neste seksjon åpner i lesemodus", async ({ page }) => {
    await åpneKurset(page, 1280);
    // Kurslista svarer ETTER kurset, slik den ofte gjør på stage.
    await page.route("**/api/courses", async (route: Route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [{ id: "c1", title: "Rapportskriving med generativ KI", description: null, moduleCount: 1, progress: { completed: 1, total: 3, courseStatus: "IN_PROGRESS" }, publishedAt: "2026-01-01T00:00:00.000Z" }] }) });
    });
    await page.route("**/api/courses/c1/sections/s1/read", (route: Route) => route.fulfill({ status: 204, body: "" }));
    await åpneSeksjonen(page);
    await page.locator("#sectionReaderMarkRead").click();
    await expect(page.locator(".course-reading-position")).toHaveText("Steg 2 av 3");
    await page.waitForTimeout(700); // la kurslista komme sist
    const m = await hvaSomVises(page);
    expect(m.posisjon).toBe("Steg 2 av 3");
    expect(m.kurshode, "kurskortets hode er borte også etter at kurslista kom").toBe(0);
    expect(m.andreSteg).toBe(0);
    // 2.85.2 (QA-porten): da kurslista kom sist, ble panelet bygget på nytt og fokus havnet på <body>.
    expect(await page.evaluate(() => document.activeElement?.className ?? ""), "fokus står i leseren").toContain("course-inline-panel-title");
  });

  for (const bredde of [390, 360]) {
    test(`${bredde} px: én spalte uten velger, hodet med «Lukk», og ingenting går ut av skjermen`, async ({ page }) => {
      await åpneKurset(page, bredde);
      await åpneSeksjonen(page);
      if (BILDER) await page.screenshot({ path: `${BILDER}/lesemodus-${bredde}.png`, fullPage: true });
      const m = await hvaSomVises(page);
      expect(m.kurshode).toBe(0);
      expect(m.andreSteg).toBe(0);
      expect(m.velger, "ingen spaltevelger på telefon").toBe(0);
      expect(m.lukk).toBe(1);
      expect(m.kortRader, "kortene står under hverandre").toBe(4);
      expect(m.arkBredde).toBeLessThanOrEqual(bredde);
      expect(m.utenfor, "ingenting går ut av skjermen").toBe(0);
      expect(m.sidelengs).toBeLessThanOrEqual(0);
      await expect(page.locator(".course-inline-panel-close")).toBeInViewport({ ratio: 1 });
    });
  }
});
