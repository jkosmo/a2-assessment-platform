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

// ⚠️ Fiksturen er innbyrdes konsistent, som det ekte svaret: ukene, de fire siste ukene og totalene regnes
// ut av de samme listene under (totalt ≥ fire siste uker ≥ hver uke), og hver beståtte modul og hvert
// kursbevis ligger i uka den er telt i. Tallene i fanene og totalene er da like.
const PASSED_MODULES = [
  { moduleId: "m1", moduleTitle: "Risikostyring i praksis", passedAt: "2026-11-10T10:00:00.000Z", totalScore: 82 }, // uke 46
  { moduleId: "m2", moduleTitle: "Interessentanalyse", passedAt: "2026-10-21T10:00:00.000Z", totalScore: 91 }, // uke 43
  { moduleId: "m3", moduleTitle: "Phishing og sosial manipulasjon", passedAt: "2026-10-20T10:00:00.000Z", totalScore: 76 }, // uke 43
  { moduleId: "m4", moduleTitle: "Gode ledetekster", passedAt: "2026-10-14T10:00:00.000Z", totalScore: 88 }, // uke 42
  { moduleId: "m5", moduleTitle: "Kildekritikk og KI", passedAt: "2026-09-30T10:00:00.000Z", totalScore: 79 }, // uke 40
  { moduleId: "m6", moduleTitle: "Personvern i praksis", passedAt: "2026-09-09T10:00:00.000Z", totalScore: 85 }, // uke 37
];

const COMPLETIONS = [
  { courseId: "c1", certificateId: "cert-abc-123", completedAt: "2026-11-10T12:00:00.000Z", courseTitle: "Prosjektledelse grunnkurs", certificationLevel: "basic" }, // uke 46
  { courseId: "c2", certificateId: "cert-def-456", completedAt: "2026-10-22T12:00:00.000Z", courseTitle: "Sikkerhet i hverdagen", certificationLevel: "basic" }, // uke 43
  { courseId: "c3", certificateId: "cert-ghi-789", completedAt: "2026-10-01T12:00:00.000Z", courseTitle: "KI i rådgivning", certificationLevel: "advanced" }, // uke 40
];

const isoWeekIndex = (iso: string) => WEEK_FROMS.findIndex((from) => iso.slice(0, 10) >= from && iso.slice(0, 10) <= addDays(from, 6));
const countPerWeek = (dates: string[]) => WEEK_FROMS.map((_, i) => dates.filter((d) => isoWeekIndex(d) === i).length);
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

function statsFor(mood: Mood, extra: { passedModules?: typeof PASSED_MODULES } = {}) {
  const active = mood !== "ny";
  const passedModules = active ? (extra.passedModules ?? PASSED_MODULES) : [];
  // Hver seksjon er lest én gang, så totalen er summen av ukene.
  const sections = active ? [2, 0, 3, 5, 1, 4, 0, 2, 6, 3, 1, 4] : new Array(12).fill(0);
  const modules = countPerWeek(passedModules.map((m) => m.passedAt));
  const courses = countPerWeek(active ? COMPLETIONS.map((c) => c.completedAt) : []);
  const minutes = sections.map((s: number) => s * 12);
  const last4 = (list: number[]) => sum(list.slice(8));
  return {
    generatedAt: "2026-11-11T10:30:00.000Z",
    mood,
    lastActivityAt: active ? "2026-11-10T12:00:00.000Z" : null,
    weeks: WEEK_FROMS.map((from, i) => ({
      from,
      to: addDays(from, 6),
      partial: i === 11,
      sectionsRead: sections[i],
      modulesPassed: modules[i],
      coursesCompleted: courses[i],
      readingMinutes: minutes[i],
    })),
    recent: { weeks: 4, sectionsRead: last4(sections), modulesPassed: last4(modules), coursesCompleted: last4(courses), readingMinutes: last4(minutes) },
    totals: { coursesCompleted: sum(courses), modulesPassed: passedModules.length, sectionsRead: sum(sections) },
    passedModules,
  };
}

test("fiksturen er innbyrdes konsistent: totalt ≥ fire siste uker ≥ hver uke", () => {
  const s = statsFor("mett");
  for (const key of ["sectionsRead", "modulesPassed", "coursesCompleted"] as const) {
    expect(s.totals[key]).toBeGreaterThanOrEqual(s.recent[key]);
    for (const week of s.weeks.slice(8)) expect(s.recent[key]).toBeGreaterThanOrEqual(week[key]);
  }
  expect(s.totals).toEqual({ coursesCompleted: 3, modulesPassed: 6, sectionsRead: 31 });
  expect(s.recent).toEqual({ weeks: 4, sectionsRead: 14, modulesPassed: 3, coursesCompleted: 2, readingMinutes: 168 });
});

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
    await expect(tabs.nth(0)).toHaveAccessibleName("Statistikk");
    await expect(tabs.nth(1)).toHaveAccessibleName("Beståtte kurs (3)");
    await expect(tabs.nth(2)).toHaveAccessibleName("Beståtte moduler (6)");
    await expect(page.locator(".profile-tab-long:visible")).toHaveText(["Statistikk", "Beståtte kurs (3)", "Beståtte moduler (6)"]);
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

  // Skjermbildet på 390 px viste understreken under to faner. Årsaken var overgangen på border-color for
  // knapper i shared.css (0,15 s): den forrige fanen tonet ut etter klikket. Målt i den BEREGNEDE stilen,
  // bilde for bilde de første 300 ms etter hvert klikk, ikke bare aria-selected — og med musa over en fane
  // som ikke er valgt, så heller ikke hover ligner valgt fane.
  test("bare én fane har understreken, også rett etter et klikk og med musa over en annen fane", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockProfile(page);
    await page.goto("/profile");
    await expect(page.locator("#statsMoodLine")).toBeVisible();

    const sample = () => page.evaluate(() => new Promise<string[]>((resolve) => {
      const problems: string[] = [];
      const start = performance.now();
      const step = () => {
        const tabs = Array.from(document.querySelectorAll("[role=tab]")) as HTMLElement[];
        const underlined = tabs.filter((b) => {
          const c = getComputedStyle(b).borderBottomColor;
          return !/rgba\(0, 0, 0, 0\)|transparent/.test(c);
        });
        const selected = tabs.filter((b) => b.getAttribute("aria-selected") === "true");
        if (underlined.length !== 1 || selected.length !== 1 || underlined[0] !== selected[0]) {
          problems.push(`${Math.round(performance.now() - start)} ms: understreket ${underlined.map((b) => b.textContent).join(" + ")}; valgt ${selected.map((b) => b.textContent).join(" + ")}`);
        }
        if (performance.now() - start < 300) requestAnimationFrame(step);
        else resolve(problems);
      };
      step();
    }));

    for (const name of [/Beståtte kurs/, /Beståtte moduler/, /Statistikk/, /Beståtte moduler/]) {
      await page.getByRole("tab", { name }).click();
      expect(await sample(), `etter klikk på ${name}`).toEqual([]);
    }
    // Musa over en fane som ikke er valgt.
    await page.getByRole("tab", { name: /Beståtte kurs/ }).hover();
    expect(await sample(), "med musa over «Beståtte kurs»").toEqual([]);
  });

  test("statistikken: båten, de fire siste ukene, tolv uker med tabell for skjermlesere, totalene", async ({ page }) => {
    await mockProfile(page);
    await page.goto("/profile");

    await expect(page.locator("#statsMoodLine")).toHaveText("Full fart! God bør i seilene.");
    const boat = page.locator(".stats-boat");
    // Bildet kommer fra maskotpakken, med pakkenavnet i adressen (doc/design/MASKOTPAKKE.md).
    await expect(boat).toHaveAttribute("src", "/static/mascot/seilbat/images/vurdering-bestatt.jpg");
    // Bildet finnes og er lastet (ikke en 404 med alt-tekst).
    await expect.poll(() => boat.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(600);

    const recent = page.locator(".stats-figures-recent .stats-figure");
    await expect(recent).toHaveCount(4);
    await expect(recent.nth(0)).toHaveText(/14\s*seksjoner lest/);
    // Uten «ca.» i det store tallet: etiketten sier «anslått», og «ca. 2 t 48 min» brakk på 360 px.
    await expect(recent.nth(3)).toHaveText(/^2 t 48 min\s*anslått lesetid$/);

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

    await expect(page.locator(".stats-figures-totals .stats-figure")).toHaveText([/3\s*kurs fullført/, /6\s*moduler bestått/, /31\s*seksjoner lest/]);
    await expect(page.locator(".stats-private")).toHaveText("Bare du ser denne oversikten.");
  });

  for (const [mood, line, image] of [
    ["mett", "Full fart! God bør i seilene.", "vurdering-bestatt.jpg"],
    // Eget bilde fra 2.143.0 (produkteier 2026-11-08): slakt seil, stekende sol, 2-eren fisker, måke i baugen.
    ["sulten", "Flau vind her ute. En seksjon til, så fyller vi seilene.", "flau-vind.jpg"],
    ["sur", "Vi ligger i dødvannet. Jeg sier ikke noe. Jeg bare nevner det.", "frist-forfalt.jpg"],
    ["dramatisk", "Jeg begynner å føle meg akterutseilt. Måkene er hyggelige, da.", "frist-forfalt.jpg"],
    ["ny", "Klar til å kaste loss. Les din første seksjon, så setter vi kursen.", "kurs-tildelt.jpg"],
  ] as const) {
    test(`humøret «${mood}» gir sin linje og sitt bilde`, async ({ page }) => {
      await mockProfile(page, { stats: statsFor(mood) });
      await page.goto("/profile");
      await expect(page.locator("#statsMoodLine")).toHaveText(line);
      await expect(page.locator(".stats-boat")).toHaveAttribute("src", `/static/mascot/seilbat/images/${image}`);
    });
  }

  test("ny bruker: vennlig tom tilstand, alle tolv ukene står tomme, og listene sier at de er tomme", async ({ page }) => {
    await mockProfile(page, { stats: statsFor("ny"), completions: [] });
    await page.goto("/profile");
    await expect(page.locator("#statsMoodLine")).toHaveText("Klar til å kaste loss. Les din første seksjon, så setter vi kursen.");
    await expect(page.locator(".stats-chart .stats-col")).toHaveCount(12);
    await expect(page.locator(".stats-chart .stats-bar, .stats-chart .stats-dot")).toHaveCount(0);
    await expect(page.locator(".stats-figures-recent .stats-figure").nth(3)).toHaveText(/0 min/);
    await expect(page.locator(".profile-tab-long:visible")).toHaveText(["Statistikk", "Beståtte kurs", "Beståtte moduler"]);

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
    // Fra profile-certificate-link.spec.ts (testgjennomgangen 2026-11, avsnitt 4.1): kursbeviset åpnes i en ny fane. Den
    // engelske teksten, «View certificate», sjekkes i profile-locale-switch.spec.ts.
    await expect(link).toHaveAttribute("target", "_blank");
  });

  test("Beståtte moduler: bare de beståtte fra statistikken, med dato og poeng", async ({ page }) => {
    await mockProfile(page);
    await page.goto("/profile");
    await page.getByRole("tab", { name: /Beståtte moduler/ }).click();

    await expect(page.locator("#profilePanel-modules thead th")).toHaveText(["Modul", "Bestått", "Poeng"]);
    const rows = page.locator("#modulesBody tr");
    await expect(rows).toHaveCount(6);
    await expect(rows.first().locator("td")).toHaveText(["Risikostyring i praksis", "10. nov. 2026", "82"]);
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
    await expect(page.getByRole("tab").first()).toHaveAccessibleName("Statistics");
    await expect(page.locator(".stats-axis .stats-axis-label").last()).toHaveText("w46");

    await page.selectOption("#localeSelect", "nn");
    await expect(page.locator("#statsMoodLine")).toHaveText("Full fart! God bør i segla.");
    await expect(page.getByRole("tab").nth(2)).toHaveAccessibleName("Beståtte modular (6)");
  });
});

// ── Telefon: 390 og 360 px ──────────────────────────────────────────────────────

const LONG_COURSE = "Grunnleggende prosjektledelse for rådgivere i offentlig sektor med vekt på gevinstrealisering og interessenthåndtering";
const LONG_MODULE = "Risikostyringogusikkerhetsanalyseiprosjektermedlangeordsomikkekanbrytesnaturlig";

for (const width of [390, 360]) {
  test(`telefon ${width} px: ingenting renner over, og lange titler brytes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    // Samme fikstur som over, med lange titler på den nyeste raden i hver liste.
    const stats = statsFor("mett", {
      passedModules: [{ ...PASSED_MODULES[0]!, moduleTitle: LONG_MODULE }, ...PASSED_MODULES.slice(1)],
    });
    await mockProfile(page, {
      stats,
      completions: [{ ...COMPLETIONS[0]!, courseTitle: LONG_COURSE, certificationLevel: "advanced" }, ...COMPLETIONS.slice(1)],
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

    // En ramme som er høyere enn innholdet sitt: et tomt, innrammet felt under det siste kortet. Måles som
    // avstanden fra innerkanten nederst i rammen til det nederste barnet. Marg på det siste barnet teller
    // som tomt — det var nettopp den som laget feltet (2.141.0, skjermbildet på 390 px).
    const emptyFramedBands = () => page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll(".profile-effort .profile-panel *"))) {
        const h = el as HTMLElement;
        if (h.offsetParent === null || h.closest(".sr-only")) continue;
        const s = getComputedStyle(h);
        const framed = parseFloat(s.borderBottomWidth) > 0 || parseFloat(s.borderTopWidth) > 0;
        const kids = Array.from(h.children).filter((k) => (k as HTMLElement).offsetParent !== null && k.getBoundingClientRect().height > 0);
        if (!framed || kids.length === 0) continue;
        const inner = h.getBoundingClientRect().bottom - parseFloat(s.borderBottomWidth) - parseFloat(s.paddingBottom);
        const band = inner - Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
        if (band > 2) out.push(`${h.tagName.toLowerCase()}.${h.className}: ${Math.round(band)} px tomt nederst`);
      }
      return out;
    });

    // Visuell inspeksjon 2026-11-07 (produkteier): fanelinja brakk over to linjer, og kontoens verdikolonne var for smal.
    // Fanene: alle tre på samme linje, med antallet, og det fulle navnet for skjermleser.
    const tabTops = await page.getByRole("tab").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tabTops).size, `fanene står på ${new Set(tabTops).size} linjer`).toBe(1);
    await expect(page.locator(".profile-tab-short:visible")).toHaveText(["Statistikk", "Kurs (3)", "Moduler (6)"]);
    await expect(page.getByRole("tab").nth(2)).toHaveAccessibleName("Beståtte moduler (6)");
    // Konto: ledeteksten over verdien, og verdien har hele bredden (ikke en smal kolonne til høyre).
    const account = await page.evaluate(() => {
      const dl = document.querySelector(".profile-dl")!.getBoundingClientRect();
      const email = document.getElementById("profileEmail")!.getBoundingClientRect();
      const label = document.querySelector(".profile-dl dt:nth-of-type(2)")!.getBoundingClientRect();
      return { dlWidth: dl.width, emailLeft: email.left - dl.left, emailBelowLabel: email.top >= label.bottom - 1 };
    });
    expect(account.emailLeft, "e-posten starter i venstre kant").toBeLessThanOrEqual(1);
    expect(account.emailBelowLabel, "e-posten står under ledeteksten").toBe(true);
    // Rollen med navn, ikke nøkkelen «PARTICIPANT».
    await expect(page.locator("#profileRoles")).toHaveText("Deltaker");
    // Tallene i statistikken står på én linje (lesetida brakk: «ca. 2 t 48» / «min»).
    const figureLines = await page.locator(".stats-figure-value").evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || 24))));
    expect(figureLines.every((n) => n <= 1), `tall over flere linjer: ${JSON.stringify(figureLines)}`).toBe(true);
    // Totalt: tre tall på én rad.
    const totalTops = await page.locator(".stats-figures-totals .stats-figure").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(totalTops).size, "totalene står på én rad").toBe(1);

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
    // Tittelen står som overskrift i hele kortets bredde, ikke i en smal høyrekolonne (seks linjer på 360 px).
    // Målt på selve teksten, ikke cellen: cellen er alltid like bred som kortet, også når teksten står i en smal kolonne.
    const titleText = await titleCell.evaluate((td) => {
      const node = Array.from(td.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())!;
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = range.getBoundingClientRect();
      const cell = td.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(td).paddingLeft) || 0;
      return { offset: text.left - cell.left - padding, share: text.width / (cell.width - 2 * padding) };
    });
    expect(titleText.offset, "tittelen starter i venstre kant").toBeLessThanOrEqual(2);
    expect(titleText.share, "tittelen bruker bredden").toBeGreaterThan(0.8);
    // «Vis kursbevis» i portalens lenkefarge, ikke nettleserens blå.
    const linkColor = await page.locator("#coursesBody a").first().evaluate((a) => getComputedStyle(a).color);
    expect(linkColor, "lenkefarge").not.toBe("rgb(0, 0, 238)");
    await expect(page.locator("#coursesBody a")).toHaveCount(3);
    await expect(page.locator("#coursesBody a").first()).toBeVisible();
    expect(await emptyFramedBands(), "tomme rammer i «Beståtte kurs»").toEqual([]);
    if (shots) await page.screenshot({ path: path.join(shots, `profil-kurs-${width}.png`), fullPage: true });

    // Beståtte moduler: et ord uten mellomrom brytes også.
    await page.getByRole("tab", { name: /Beståtte moduler/ }).click();
    m = await overflow();
    expect(m.page).toBeLessThanOrEqual(0);
    expect(m.offenders, `utenfor kortet ${JSON.stringify(m.card)}`).toEqual([]);
    expect(await emptyFramedBands(), "tomme rammer i «Beståtte moduler»").toEqual([]);
    if (shots) await page.screenshot({ path: path.join(shots, `profil-moduler-${width}.png`), fullPage: true });
  });
}
