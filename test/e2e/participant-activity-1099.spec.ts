import { test, expect, type Page, type Route } from "@playwright/test";

// #1099: «Aktivitet» under Deltakere. Den ekte participant-activity.js mot et svar i samme form som
// GET /api/reports/activity gir. Utregningen er målt i enhets- og integrasjonstesten; her måles det
// siden gjør: tegner tallene, sorterer og filtrerer lista, henter «det siste hen har gjort», og
// sender valgene videre til tjeneren.

const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function weeks(n: number) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = String(1 + i).padStart(2, "0");
    out.push({
      from: `2026-08-${day}`,
      to: `2026-08-${day}`,
      partial: i === n - 1,
      active: i,
      startedTotal: Math.min(3, i),
      counts: { read: i * 2, submitted: i, passed: i > 2 ? 1 : 0, completed: i === n - 1 ? 1 : 0 },
    });
  }
  return out;
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    period: "12",
    grain: "week",
    department: null,
    range: { from: "2026-08-01", to: "2026-08-12" },
    departments: ["IT", "Salg"],
    population: 3,
    kpis: { active7: 1, active7Prev: 0, active30: 2, started: 2, startedBefore7: 1, events7: { read: 4, submitted: 1, passed: 1, completed: 0 } },
    buckets: weeks(12),
    people: [
      { userId: "u-a", name: "Kari Aktiv", email: "kari@x.no", department: "Salg", status: "active", lastActivityAt: iso(60 * 60 * 1000), lastLoginAt: iso(30 * 60 * 1000), activeDaysByWeek: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 1], counts: { read: 7, submitted: 2, passed: 1, completed: 0 } },
      { userId: "u-b", name: "Ola Rolig", email: "ola@x.no", department: "IT", status: "quiet", lastActivityAt: iso(20 * DAY), lastLoginAt: iso(19 * DAY), activeDaysByWeek: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], counts: { read: 1, submitted: 0, passed: 0, completed: 0 } },
      { userId: "u-c", name: "Nina Ny", email: "nina@x.no", department: "IT", status: "not_started", lastActivityAt: null, lastLoginAt: iso(2 * DAY), activeDaysByWeek: new Array(12).fill(0), counts: { read: 0, submitted: 0, passed: 0, completed: 0 } },
    ],
    ...overrides,
  };
}

async function mockBase(page: Page, roles: string[], locale = "nb") {
  await page.route("**/participant/config", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authMode: "mock",
        navigation: { items: [], workspaceItems: [] },
        identityDefaults: { contentAdmin: { userId: "adm-1", email: "adm@x.no", name: "Admin", roles } },
        calibrationWorkspace: { accessRoles: [] },
      }),
    }),
  );
  await page.route("**/version", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "test" }) }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.addInitScript((loc) => {
    try { localStorage.setItem("participant.locale", loc); localStorage.removeItem("activity.view"); } catch { /* ignore */ }
  }, locale);
}

async function mockActivity(page: Page, calls: string[] = [], recentCalls: string[] = []) {
  await page.route("**/api/reports/activity?**", (route: Route) => {
    const url = new URL(route.request().url());
    calls.push(url.search);
    const grain = url.searchParams.get("grain") ?? "week";
    const period = url.searchParams.get("period") ?? "12";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report({ grain, period, department: url.searchParams.get("department") })) });
  });
  await page.route("**/api/reports/activity/users/*/recent", (route: Route) => {
    const locale = route.request().headers()["x-locale"] ?? "";
    recentCalls.push(locale);
    const nb = locale !== "en-GB";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        userId: "u-a",
        name: "Kari Aktiv",
        events: [
          { type: "passed", at: iso(60 * 60 * 1000), courseTitle: null, itemTitle: nb ? "Kravmatrise i praksis" : "Requirements matrix" },
          { type: "read", at: iso(2 * 60 * 60 * 1000), courseTitle: nb ? "Tilbudsarbeid" : "Tendering", itemTitle: nb ? "Les konkurransegrunnlaget" : "Read the tender documents" },
        ],
      }),
    });
  });
}

test("administrator: nøkkeltall, to grafer og lista — og Aktivitet er aktiv fane", async ({ page }) => {
  await mockBase(page, ["ADMINISTRATOR"]);
  await mockActivity(page);
  await page.goto("/deltakere/aktivitet");

  await expect(page.locator("h1")).toHaveText("Aktivitet");
  await expect(page.locator("#subnavActivity")).toHaveClass(/active/);
  await expect(page.locator("#subnavActivity")).toHaveText("Aktivitet");

  const kpis = page.locator("#activityKpis .activity-kpi");
  await expect(kpis).toHaveCount(4);
  await expect(kpis.nth(0)).toContainText("Aktive siste 7 dager");
  await expect(kpis.nth(0).locator(".value")).toHaveText("1");
  await expect(kpis.nth(0)).toContainText("▲ 1");
  await expect(kpis.nth(1).locator(".value")).toHaveText("2 av 3");
  await expect(kpis.nth(2)).toContainText("1 har ikke startet");
  await expect(kpis.nth(3).locator(".value")).toHaveText("6");
  await expect(kpis.nth(3)).toContainText("4 lest · 1 levert · 1 bestått · 0 fullført");

  // Personer: søyler for aktive, kurven for «i gang totalt» og streken for alle deltakere.
  await expect(page.locator("#activityPeopleChart path")).toHaveCount(2);
  await expect(page.locator("#activityPeopleChart text", { hasText: "Deltakere: 3" })).toHaveCount(1);
  // Hva de gjør: stablede søyler med typens farge.
  expect(await page.locator("#activityEventsChart rect[fill='var(--act-read)']").count()).toBeGreaterThan(5);
  await expect(page.locator("#activityPeopleSub")).toHaveText("Aktive per uke, og hvor mange som har kommet i gang totalt.");

  await expect(page.locator("#activityChips button")).toHaveText(["Alle 3", "Aktive 1", "Rolige 1", "Ikke startet 1"]);
  const rows = page.locator("#activityRows tr.person");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Kari Aktiv");
  await expect(rows.nth(0).locator(".activity-pill")).toHaveText("Aktiv");
  // Tidspunktet er «for en time siden»; rett etter midnatt er det «I går».
  await expect(rows.nth(0)).toContainText(/I dag|I går/);
  await expect(rows.nth(1).locator(".activity-pill")).toHaveText("Rolig");
  await expect(rows.nth(2).locator(".activity-pill")).toHaveText("Ikke startet");
  await expect(rows.nth(2).locator("td").nth(3)).toContainText("Aldri");
  await expect(page.locator("#activityDepartment option")).toHaveText(["Alle avdelinger", "IT", "Salg"]);
});

test("klikk på en person henter det siste hen har gjort; en som ikke har startet viser innloggingen uten å hente", async ({ page }) => {
  const recentCalls: string[] = [];
  await mockBase(page, ["ADMINISTRATOR"]);
  await mockActivity(page, [], recentCalls);
  await page.goto("/deltakere/aktivitet");

  const kari = page.locator("#activityRows tr.person", { hasText: "Kari Aktiv" });
  await kari.click();
  const detail = page.locator("#activityRows tr.activity-detail");
  await expect(detail).toContainText("Det siste Kari Aktiv har gjort, alle kurs");
  await expect(detail).toContainText("Besto «Kravmatrise i praksis»");
  await expect(detail).toContainText("Leste seksjonen «Les konkurransegrunnlaget»");
  await expect(detail).toContainText("Tilbudsarbeid");
  await expect(kari).toHaveAttribute("aria-expanded", "true");
  expect(recentCalls).toHaveLength(1);

  // Lukk med tastaturet, og åpne en som ikke har startet.
  await kari.focus();
  await page.keyboard.press("Enter");
  await expect(detail).toHaveCount(0);
  await page.locator("#activityRows tr.person", { hasText: "Nina Ny" }).click();
  await expect(page.locator("#activityRows tr.activity-detail")).toContainText("Har ikke gjort noe ennå. Sist sett");
  expect(recentCalls).toHaveLength(1);
});

test("filter, søk og sortering i lista", async ({ page }) => {
  await mockBase(page, ["ADMINISTRATOR"]);
  await mockActivity(page);
  await page.goto("/deltakere/aktivitet");
  const rows = page.locator("#activityRows tr.person");
  await expect(rows).toHaveCount(3);

  await page.locator("#activityChips button", { hasText: "Ikke startet" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Nina Ny");
  await page.locator("#activityChips button", { hasText: "Alle" }).click();

  await page.locator("#activitySearch").fill("ola");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Ola Rolig");
  await page.locator("#activitySearch").fill("nina@");
  await expect(rows.first()).toContainText("Nina Ny");
  await page.locator("#activitySearch").fill("");

  // Navn stigende, så synkende.
  await page.locator(".activity-table th button[data-k='name']").click();
  await expect(rows.locator(".who > span")).toHaveText([/^Kari Aktiv/, /^Nina Ny/, /^Ola Rolig/]);
  await expect(page.locator(".activity-table th:has(button[data-k='name'])")).toHaveAttribute("aria-sort", "ascending");
  await page.locator(".activity-table th button[data-k='name']").click();
  await expect(rows.locator(".who > span")).toHaveText([/^Ola Rolig/, /^Nina Ny/, /^Kari Aktiv/]);
  // Lest, flest først.
  await page.locator(".activity-table th button[data-k='read']").click();
  await expect(rows.first()).toContainText("Kari Aktiv");
});

test("periode, telling og avdeling sendes til tjeneren; hele perioden per dag blir per uke", async ({ page }) => {
  const calls: string[] = [];
  await mockBase(page, ["ADMINISTRATOR"]);
  await mockActivity(page, calls);
  await page.goto("/deltakere/aktivitet");
  await expect(page.locator("#activityRows tr.person")).toHaveCount(3);
  expect(calls.at(-1)).toBe("?period=12&grain=week");

  await page.locator("#activityPeriod button[data-v='4']").click();
  await expect.poll(() => calls.at(-1)).toBe("?period=4&grain=week");
  await page.locator("#activityGrain button[data-v='day']").click();
  await expect.poll(() => calls.at(-1)).toBe("?period=4&grain=day");
  await expect(page.locator("#activityPeopleSub")).toHaveText("Aktive per dag, og hvor mange som har kommet i gang totalt.");

  await page.locator("#activityPeriod button[data-v='all']").click();
  await expect.poll(() => calls.at(-1)).toBe("?period=all&grain=week");
  await expect(page.locator("#activityGrain button[data-v='week']")).toHaveAttribute("aria-pressed", "true");

  await page.locator("#activityDepartment").selectOption("IT");
  await expect.poll(() => calls.at(-1)).toBe("?period=all&grain=week&department=IT");
  await expect(page.locator("#activityDepartment")).toHaveValue("IT");
});

test("språkbytte: tekstene skifter, og det siste personen har gjort hentes på nytt på det nye språket", async ({ page }) => {
  const recentCalls: string[] = [];
  await mockBase(page, ["ADMINISTRATOR"]);
  await mockActivity(page, [], recentCalls);
  await page.goto("/deltakere/aktivitet");
  await page.locator("#activityRows tr.person", { hasText: "Kari Aktiv" }).click();
  await expect(page.locator("#activityRows tr.activity-detail")).toContainText("Kravmatrise i praksis");

  await page.locator("#localeSelect").selectOption("en-GB");
  await expect(page.locator("h1")).toHaveText("Activity");
  await expect(page.locator("#subnavActivity")).toHaveText("Activity");
  await expect(page.locator("#activityKpis .activity-kpi").nth(0)).toContainText("Active in the last 7 days");
  await expect(page.locator("#activityRows tr.activity-detail")).toContainText("Passed «Requirements matrix»");
  expect(recentCalls).toEqual(["nb", "en-GB"]);

  await page.locator("#localeSelect").selectOption("nn");
  await expect(page.locator("#activityChips button").nth(2)).toHaveText("Rolege 1");
});

test("språkbytte: en person som åpnes igjen etterpå, vises på det nye språket — ikke fra et gammelt mellomlager", async ({ page }) => {
  const recentCalls: string[] = [];
  await mockBase(page, ["ADMINISTRATOR"]);
  await mockActivity(page, [], recentCalls);
  await page.goto("/deltakere/aktivitet");
  const kari = page.locator("#activityRows tr.person", { hasText: "Kari Aktiv" });
  await kari.click();
  await expect(page.locator("#activityRows tr.activity-detail")).toContainText("Kravmatrise i praksis");
  await kari.click(); // lukk
  await expect(page.locator("#activityRows tr.activity-detail")).toHaveCount(0);

  await page.locator("#localeSelect").selectOption("en-GB");
  await expect(page.locator("h1")).toHaveText("Activity");
  await page.locator("#activityRows tr.person", { hasText: "Kari Aktiv" }).click();
  await expect(page.locator("#activityRows tr.activity-detail")).toContainText("Passed «Requirements matrix»");
  expect(recentCalls).toEqual(["nb", "en-GB"]);
});

test("fanen vises for administrator og rapportleser, ikke for fagansvarlig", async ({ page }) => {
  await mockBase(page, ["SUBJECT_MATTER_OWNER"]);
  await page.route("**/api/cohort-status/courses", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ courses: [] }) }),
  );
  await page.goto("/deltakere/status");
  await expect(page.locator("#deltakereSubnav")).toHaveAttribute("data-roles-resolved", "true");
  await expect(page.locator("#subnavStatus")).toBeVisible();
  await expect(page.locator("#subnavActivity")).toHaveCount(0);
});

test("rapportleser ser fanen på Resultater", async ({ page }) => {
  await mockBase(page, ["REPORT_READER"]);
  await page.route("**/api/**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/api/me", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { roles: ["REPORT_READER"] }, consent: { accepted: true, currentVersion: "1.0" } }) }),
  );
  await page.goto("/results");
  await expect(page.locator("#deltakereSubnav")).toHaveAttribute("data-roles-resolved", "true");
  await expect(page.locator("#subnavActivity")).toBeVisible();
});

for (const width of [390, 360]) {
  test(`telefon (${width} px): ingen sideveis rulling, og grafteksten er lesbar`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockBase(page, ["ADMINISTRATOR"]);
    await mockActivity(page);
    await page.goto("/deltakere/aktivitet");
    await expect(page.locator("#activityRows tr.person")).toHaveCount(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Grafen tegnes i elementets egen bredde, så 11 px tekst blir 11 px — ikke krympet til det halve.
    const scale = await page.locator("#activityPeopleChart").evaluate((svg) => {
      const box = (svg as SVGSVGElement).viewBox.baseVal;
      return svg.getBoundingClientRect().width / box.width;
    });
    expect(scale).toBeGreaterThan(0.9);
  });
}

test("en feil i «det siste hen har gjort» hentes på nytt neste gang raden åpnes", async ({ page }) => {
  await mockBase(page, ["ADMINISTRATOR"]);
  await mockActivity(page);
  let feil = true;
  await page.route("**/api/reports/activity/users/*/recent", (route: Route) => {
    if (feil) { feil = false; return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error" }) }); }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: "u-a", name: "Kari Aktiv", events: [{ type: "read", at: iso(60000), courseTitle: "Tilbudsarbeid", itemTitle: "Kravmatrisen" }] }) });
  });
  await page.goto("/deltakere/aktivitet");
  const kari = page.locator("#activityRows tr.person", { hasText: "Kari Aktiv" });
  await kari.click();
  await expect(page.locator("#activityRows tr.activity-detail")).toContainText("Kunne ikke hente");
  await kari.click();
  await kari.click();
  await expect(page.locator("#activityRows tr.activity-detail")).toContainText("Leste seksjonen «Kravmatrisen»");
});

test("feiler et nytt valg, viser knappene valget tallene faktisk gjelder", async ({ page }) => {
  await mockBase(page, ["ADMINISTRATOR"]);
  await page.route("**/api/reports/activity?**", (route: Route) => {
    const period = new URL(route.request().url()).searchParams.get("period");
    if (period === "4") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report({ period: "12" })) });
  });
  await page.goto("/deltakere/aktivitet");
  await expect(page.locator("#activityRows tr.person")).toHaveCount(3);
  await page.locator("#activityPeriod button[data-v='4']").click();
  await expect(page.locator("#activityPeriod button[data-v='12']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#activityPeriod button[data-v='4']")).toHaveAttribute("aria-pressed", "false");
});

test("feiler et avdelingsvalg, viser velgeren avdelingen tallene faktisk gjelder", async ({ page }) => {
  await mockBase(page, ["ADMINISTRATOR"]);
  await page.route("**/api/reports/activity?**", (route: Route) => {
    if (new URL(route.request().url()).searchParams.get("department") === "IT") {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report()) });
  });
  await page.goto("/deltakere/aktivitet");
  await expect(page.locator("#activityRows tr.person")).toHaveCount(3);
  await page.locator("#activityDepartment").selectOption("IT");
  await expect(page.locator("#activityDepartment")).toHaveValue("");
});

test("feil fra tjeneren gir en melding, ikke en tom side uten forklaring", async ({ page }) => {
  await mockBase(page, ["ADMINISTRATOR"]);
  await page.route("**/api/reports/activity?**", (route: Route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error", message: "boom" }) }),
  );
  await page.goto("/deltakere/aktivitet");
  await expect(page.locator(".toast, [role='alert'], [role='status']").filter({ hasText: /.+/ }).first()).toBeVisible();
});

test("et sent svar på et eldre valg skriver ikke over det nyere", async ({ page }) => {
  await mockBase(page, ["ADMINISTRATOR"]);
  let first = true;
  await page.route("**/api/reports/activity?**", async (route: Route) => {
    const period = new URL(route.request().url()).searchParams.get("period");
    if (first) {
      // Det første kallet (12 uker) kommer sist tilbake.
      first = false;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report({ population: 12 })) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(report({ period, population: 4 })) });
  });
  await page.goto("/deltakere/aktivitet");
  await page.locator("#activityPeriod button[data-v='4']").click();
  await expect(page.locator("#activityKpis .activity-kpi").nth(1).locator(".value")).toHaveText("2 av 4");
  await page.waitForTimeout(2000);
  await expect(page.locator("#activityKpis .activity-kpi").nth(1).locator(".value")).toHaveText("2 av 4");
});
