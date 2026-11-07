import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page, type Route } from "@playwright/test";

// #1138 og produkteier 2026-11-07: profilen har konto først, så innsatsen i tre faner (Statistikk |
// Beståtte kurs | Beståtte moduler), så rettighetene. Statistikken er bare for brukeren selv.
//
// Den ekte profile.js kjøres mot mockede svar. Tallene regnes på serveren (test/unit/my-stats-1138 og
// test/me-stats-1138); her måles det klienten gjør: fanene, båten og linja, tolv uker med en tabell for
// skjermlesere, at bare beståtte moduler står, at kursbevis-ID-en er borte, og at telefonbredde holder.
//
// Skjermbilder fra 390/360 px lagres når PROFILE_SHOTS_DIR er satt.

const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

const WEEK_FROMS = [
  "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28",
  "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09",
];
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

type Mood = "mett" | "sulten" | "sur" | "dramatisk" | "ny";

function statsFor(mood: Mood, extra: Record<string, unknown> = {}) {
  const active = mood !== "ny";
  const sections = [2, 0, 3, 5, 1, 4, 0, 2, 6, 3, 1, 4];
  const modules = [0, 0, 1, 0, 0, 1, 0, 1, 2, 0, 0, 1];
  const courses = [0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  return {
    generatedAt: "2026-11-11T10:30:00.000Z",
    mood,
    lastActivityAt: active ? "2026-11-10T08:00:00.000Z" : null,
    weeks: WEEK_FROMS.map((from, i) => ({
      from,
      to: addDays(from, 6),
      partial: i === 11,
      sectionsRead: active ? sections[i] : 0,
      modulesPassed: active ? modules[i] : 0,
      coursesCompleted: active ? courses[i] : 0,
      readingMinutes: active ? sections[i]! * 12 : 0,
    })),
    recent: active
      ? { weeks: 4, sectionsRead: 14, modulesPassed: 3, coursesCompleted: 2, readingMinutes: 168 }
      : { weeks: 4, sectionsRead: 0, modulesPassed: 0, coursesCompleted: 0, readingMinutes: 0 },
    totals: active ? { coursesCompleted: 3, modulesPassed: 2, sectionsRead: 31 } : { coursesCompleted: 0, modulesPassed: 0, sectionsRead: 0 },
    passedModules: active
      ? [
          { moduleId: "m1", moduleTitle: "Risikostyring i praksis", passedAt: "2026-11-04T10:00:00.000Z", totalScore: 82 },
          { moduleId: "m2", moduleTitle: "Interessentanalyse", passedAt: "2026-10-21T10:00:00.000Z", totalScore: 91 },
        ]
      : [],
    ...extra,
  };
}

const COMPLETIONS = [
  { courseId: "c1", certificateId: "cert-abc-123", completedAt: "2026-11-04T10:00:00.000Z", courseTitle: "Prosjektledelse grunnkurs", certificationLevel: "basic" },
];

async function mockProfile(page: Page, opts: { stats?: unknown; statsStatus?: number; completions?: unknown[]; locale?: string } = {}) {
  await page.addInitScript((locale) => {
    try { localStorage.setItem("participant.locale", locale); } catch { /* ignore */ }
  }, opts.locale ?? "nb");
  await page.route("**/participant/config", (route: Route) => route.fulfill(json({
    authMode: "mock",
    navigation: { items: [], workspaceItems: [] },
    identityDefaults: { participant: { userId: "p-1", email: "kari@example.com", name: "Kari", department: "Rådgivning", roles: ["PARTICIPANT"] } },
    calibrationWorkspace: { accessRoles: [] },
    flow: {},
    output: {},
  })));
  await page.route("**/version", (route: Route) => route.fulfill(json({ version: "test" })));
  await page.route("**/api/me", (route: Route) => route.fulfill(json({
    user: { id: "p-1", name: "Kari Nordmann", email: "kari@example.com", department: "Rådgivning", roles: ["PARTICIPANT"] },
    consent: { accepted: true, currentVersion: "1.0" },
  })));
  await page.route("**/api/queue-counts", (route: Route) => route.fulfill(json({ counts: {} })));
  await page.route("**/api/me/stats", (route: Route) =>
    route.fulfill(json(opts.stats ?? statsFor("mett"), opts.statsStatus ?? 200)));
  await page.route("**/api/courses/completions", (route: Route) => route.fulfill(json({ completions: opts.completions ?? COMPLETIONS })));
}

test.describe("Profil: konto, så tre faner, så rettighetene (#1138)", () => {
  test("rekkefølgen på siden og fanene", async ({ page }) => {
    await mockProfile(page);
    await page.goto("/profile");
    await expect(page.locator("#statsMoodLine")).toBeVisible();

    // Konto → fanene → rettighetene, i dokumentet.
    const order = await page.evaluate(() => {
      const pos = (sel: string) => Array.from(document.querySelectorAll("*")).indexOf(document.querySelector(sel)!);
      return { account: pos("#profileName"), tabs: pos("#profileTabs"), rights: pos("#viewDataBtn") };
    });
    expect(order.account).toBeLessThan(order.tabs);
    expect(order.tabs).toBeLessThan(order.rights);

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveText(["Statistikk", "Beståtte kurs (1)", "Beståtte moduler (2)"]);
    await expect(page.getByRole("tablist")).toHaveAttribute("aria-label", "Oversikten min");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#profilePanel-stats")).toBeVisible();
    await expect(page.locator("#profilePanel-courses")).toBeHidden();
    await expect(page.locator("#profilePanel-modules")).toBeHidden();
  });

  test("piltaster, Home og End flytter mellom fanene, og bare ett panel vises", async ({ page }) => {
    await mockProfile(page);
    await page.goto("/profile");
    const tab = (name: RegExp) => page.getByRole("tab", { name });
    await tab(/Statistikk/).focus();

    await page.keyboard.press("ArrowRight");
    await expect(tab(/Beståtte kurs/)).toBeFocused();
    await expect(tab(/Beståtte kurs/)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#profilePanel-courses")).toBeVisible();
    await expect(page.locator("#profilePanel-stats")).toBeHidden();

    await page.keyboard.press("End");
    await expect(tab(/Beståtte moduler/)).toBeFocused();
    await expect(page.locator("#profilePanel-modules")).toBeVisible();
    await expect(page.locator("#profilePanel-courses")).toBeHidden();

    await page.keyboard.press("ArrowRight"); // rundt til starten
    await expect(tab(/Statistikk/)).toBeFocused();
    await expect(page.locator("#profilePanel-stats")).toBeVisible();

    await page.keyboard.press("ArrowLeft"); // rundt til slutten
    await expect(tab(/Beståtte moduler/)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tab(/Statistikk/)).toHaveAttribute("aria-selected", "true");
    // Én tabstopp: de andre fanene er ute av tabrekkefølgen.
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);

    // Klikk virker også.
    await tab(/Beståtte moduler/).click();
    await expect(page.locator("#profilePanel-modules")).toBeVisible();
  });

  test("statistikken: båten, de fire siste ukene, tolv uker med tabell for skjermlesere, totalene", async ({ page }) => {
    await mockProfile(page);
    await page.goto("/profile");

    await expect(page.locator("#statsMoodLine")).toHaveText("Full fart! God bør i seilene.");
    const boat = page.locator(".stats-boat");
    await expect(boat).toHaveAttribute("src", "/static/boat/vurdering-bestatt.jpg");
    // Bildet finnes og er lastet (ikke en 404 med alt-tekst).
    await expect.poll(() => boat.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(600);

    const recent = page.locator(".stats-figures-recent .stats-figure");
    await expect(recent).toHaveCount(4);
    await expect(recent.nth(0)).toHaveText(/14\s*seksjoner lest/);
    await expect(recent.nth(3)).toHaveText(/ca\. 2 t 48 min\s*anslått lesetid/);

    await expect(page.locator(".stats-chart .stats-col")).toHaveCount(12);
    await expect(page.locator(".stats-axis .stats-axis-label")).toHaveText(["u35", "u36", "u37", "u38", "u39", "u40", "u41", "u42", "u43", "u44", "u45", "u46"]);
    // Uke 45 (indeks 10): én seksjon, ingen modul, intet kurs → én søyle, ingen prikk.
    await expect(page.locator('.stats-col[data-week="2026-11-02"] .stats-bar')).toHaveCount(1);
    await expect(page.locator('.stats-col[data-week="2026-11-09"] .stats-dot')).toHaveCount(1);
    await expect(page.locator('.stats-col[data-week="2026-08-31"] .stats-bar')).toHaveCount(0);

    const table = page.locator("table.stats-table");
    await expect(table.locator("tbody tr")).toHaveCount(12);
    await expect(table.locator("caption")).toHaveText("Per uke de siste 12 ukene");
    await expect(table.locator("tbody tr").last()).toContainText("Uke 46");
    await expect(table.locator("tbody tr").last().locator("td")).toHaveText(["4", "1", "1", "ca. 48 min"]);
    // Søylene er skjult for skjermlesere; tabellen er det de leser.
    await expect(page.locator(".stats-chart")).toHaveAttribute("aria-hidden", "true");
    expect(await table.evaluate((el) => getComputedStyle(el).display)).toBe("table");

    await expect(page.locator(".stats-figures-totals .stats-figure")).toHaveText([/3\s*kurs fullført/, /2\s*moduler bestått/, /31\s*seksjoner lest/]);
    await expect(page.locator(".stats-private")).toHaveText("Bare du ser denne oversikten.");
  });

  for (const [mood, line, image] of [
    ["mett", "Full fart! God bør i seilene.", "vurdering-bestatt.jpg"],
    ["sulten", "Flau vind her ute. En seksjon til, så fyller vi seilene.", "frist-snart.jpg"],
    ["sur", "To uker med havblikk. Jeg sier ikke noe. Jeg bare nevner det.", "vurdering-ikke-bestatt.jpg"],
    ["dramatisk", "Seilene henger slakt. Jeg har begynt å snakke med måkene.", "frist-forfalt.jpg"],
    ["ny", "Klar til å legge ut. Les din første seksjon, så setter vi seil.", "kurs-tildelt.jpg"],
  ] as const) {
    test(`humøret «${mood}» gir sin linje og sitt bilde`, async ({ page }) => {
      await mockProfile(page, { stats: statsFor(mood) });
      await page.goto("/profile");
      await expect(page.locator("#statsMoodLine")).toHaveText(line);
      await expect(page.locator(".stats-boat")).toHaveAttribute("src", `/static/boat/${image}`);
    });
  }

  test("ny bruker: vennlig tom tilstand, alle tolv ukene står tomme, og listene sier at de er tomme", async ({ page }) => {
    await mockProfile(page, { stats: statsFor("ny"), completions: [] });
    await page.goto("/profile");
    await expect(page.locator("#statsMoodLine")).toHaveText("Klar til å legge ut. Les din første seksjon, så setter vi seil.");
    await expect(page.locator(".stats-chart .stats-col")).toHaveCount(12);
    await expect(page.locator(".stats-chart .stats-bar, .stats-chart .stats-dot")).toHaveCount(0);
    await expect(page.locator(".stats-figures-recent .stats-figure").nth(3)).toHaveText(/0 min/);
    await expect(page.getByRole("tab")).toHaveText(["Statistikk", "Beståtte kurs", "Beståtte moduler"]);

    await page.getByRole("tab", { name: "Beståtte kurs" }).click();
    await expect(page.locator("#coursesBody")).toHaveText("Ingen beståtte kurs ennå.");
    await page.getByRole("tab", { name: "Beståtte moduler" }).click();
    await expect(page.locator("#modulesBody")).toHaveText("Ingen beståtte moduler ennå.");
  });

  test("Beståtte kurs: ingen kursbevis-ID, bare lenken «Vis kursbevis»", async ({ page }) => {
    await mockProfile(page);
    await page.goto("/profile");
    await page.getByRole("tab", { name: /Beståtte kurs/ }).click();

    await expect(page.locator("#profilePanel-courses thead th")).toHaveText(["Kurs", "Fullført", "Nivå", "Kursbevis"]);
    const row = page.locator("#coursesBody tr").first();
    await expect(row.locator("td")).toHaveCount(4);
    await expect(row).toContainText("Prosjektledelse grunnkurs");
    await expect(row).not.toContainText("cert-abc-123");
    const link = row.locator('a[href="/certificate?id=cert-abc-123"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveText("Vis kursbevis");
  });

  test("Beståtte moduler: bare de beståtte fra statistikken, med dato og poeng", async ({ page }) => {
    await mockProfile(page);
    await page.goto("/profile");
    await page.getByRole("tab", { name: /Beståtte moduler/ }).click();

    await expect(page.locator("#profilePanel-modules thead th")).toHaveText(["Modul", "Bestått", "Poeng"]);
    const rows = page.locator("#modulesBody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator("td")).toHaveText(["Risikostyring i praksis", "4. nov. 2026", "82"]);
    // Ingen «Ikke bestått» eller utfallskolonne lenger.
    await expect(page.locator("#modulesBody")).not.toContainText("Ikke bestått");
  });

  test("statistikken kan ikke hentes: en beskjed i fanen, og kursene virker fortsatt", async ({ page }) => {
    await mockProfile(page, { stats: { error: "boom" }, statsStatus: 500 });
    await page.goto("/profile");
    await expect(page.locator("#statsBody .stats-error")).toHaveText("Statistikken kunne ikke hentes. Last siden på nytt for å prøve igjen.");
    await page.getByRole("tab", { name: /Beståtte kurs/ }).click();
    await expect(page.locator("#coursesBody")).toContainText("Prosjektledelse grunnkurs");
    await page.getByRole("tab", { name: /Beståtte moduler/ }).click();
    await expect(page.locator("#modulesBody")).toContainText("Statistikken kunne ikke hentes.");
  });

  test("språkbytte: linja, fanene og ukene følger språket", async ({ page }) => {
    await mockProfile(page);
    await page.goto("/profile");
    await expect(page.locator("#statsMoodLine")).toHaveText("Full fart! God bør i seilene.");

    await page.selectOption("#localeSelect", "en-GB");
    await expect(page.locator("#statsMoodLine")).toHaveText("Full speed! A fine breeze in the sails.");
    await expect(page.getByRole("tab").first()).toHaveText("Statistics");
    await expect(page.locator(".stats-axis .stats-axis-label").last()).toHaveText("w46");

    await page.selectOption("#localeSelect", "nn");
    await expect(page.locator("#statsMoodLine")).toHaveText("Full fart! God bør i segla.");
    await expect(page.getByRole("tab").nth(2)).toHaveText("Beståtte modular (2)");
  });
});

// ── Telefon: 390 og 360 px ──────────────────────────────────────────────────────

const LONG_COURSE = "Grunnleggende prosjektledelse for rådgivere i offentlig sektor med vekt på gevinstrealisering og interessenthåndtering";
const LONG_MODULE = "Risikostyringogusikkerhetsanalyseiprosjektermedlangeordsomikkekanbrytesnaturlig";

for (const width of [390, 360]) {
  test(`telefon ${width} px: ingenting renner over, og lange titler brytes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const stats = statsFor("mett", {
      passedModules: [{ moduleId: "m1", moduleTitle: LONG_MODULE, passedAt: "2026-11-04T10:00:00.000Z", totalScore: 82 }],
    });
    await mockProfile(page, {
      stats,
      completions: [{ ...COMPLETIONS[0], courseTitle: LONG_COURSE, certificationLevel: "advanced" }],
    });
    await page.goto("/profile");
    await expect(page.locator("#statsMoodLine")).toBeVisible();
    await expect.poll(() => page.locator(".stats-boat").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(600);

    const shots = process.env.PROFILE_SHOTS_DIR;
    if (shots) mkdirSync(shots, { recursive: true });

    const overflow = () => page.evaluate(() => {
      const doc = document.scrollingElement!;
      const card = document.querySelector(".profile-effort")!.getBoundingClientRect();
      const offenders = Array.from(document.querySelectorAll(".profile-effort *"))
        .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest(".sr-only"))
        .map((el) => ({ el: `${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.right > card.right + 0.5 || r.left < card.left - 0.5))
        .map(({ el, r }) => `${el} ${Math.round(r.left)}–${Math.round(r.right)}`);
      return { page: doc.scrollWidth - doc.clientWidth, card: [Math.round(card.left), Math.round(card.right)], offenders };
    });

    // Statistikk
    let m = await overflow();
    expect(m.page, "vannrett rulling på siden").toBeLessThanOrEqual(0);
    expect(m.offenders, `utenfor kortet ${JSON.stringify(m.card)}`).toEqual([]);
    // Alle tolv ukene får plass og har en synlig etikett som ikke er klippet.
    const labels = await page.locator(".stats-axis-label").evaluateAll((els) => els.map((el) => el.scrollWidth <= el.clientWidth + 1));
    expect(labels).toEqual(new Array(12).fill(true));
    if (shots) await page.screenshot({ path: path.join(shots, `profil-statistikk-${width}.png`), fullPage: true });

    // Beståtte kurs: den lange tittelen brytes over flere linjer innenfor kortet.
    await page.getByRole("tab", { name: /Beståtte kurs/ }).click();
    m = await overflow();
    expect(m.page).toBeLessThanOrEqual(0);
    expect(m.offenders, `utenfor kortet ${JSON.stringify(m.card)}`).toEqual([]);
    const titleCell = page.locator("#coursesBody tr").first().locator("td").first();
    const lineHeight = await titleCell.evaluate((td) => parseFloat(getComputedStyle(td).lineHeight) || 18);
    expect((await titleCell.boundingBox())!.height).toBeGreaterThan(lineHeight * 1.5);
    await expect(page.locator("#coursesBody a")).toBeVisible();
    if (shots) await page.screenshot({ path: path.join(shots, `profil-kurs-${width}.png`), fullPage: true });

    // Beståtte moduler: et ord uten mellomrom brytes også.
    await page.getByRole("tab", { name: /Beståtte moduler/ }).click();
    m = await overflow();
    expect(m.page).toBeLessThanOrEqual(0);
    expect(m.offenders, `utenfor kortet ${JSON.stringify(m.card)}`).toEqual([]);
    if (shots) await page.screenshot({ path: path.join(shots, `profil-moduler-${width}.png`), fullPage: true });
  });
}
