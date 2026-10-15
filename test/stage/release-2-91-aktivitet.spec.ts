import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.91.0 mot UTRULLET stage: «Aktivitet» under Deltakere (#1099), med de ekte dataene på stage.
//
// Testen skriver ingenting. Den leser rapporten, sjekker at tallene henger sammen (søylene i grafen
// og tallene i lista er to veier til samme hendelser), og åpner siden på PC og telefon.
//
// ⚠️ Rapporten inneholder navn. Funnene skriver bare tall, aldri navn eller e-post. Skjermbildene
// havner i test-results (gitignorert) og skal ikke deles.
//
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.

const lokal = process.env.STAGE_LOKAL ?? "";
const { auth, reason } = lokal ? { auth: null, reason: "" } : readAuth();
const BASE = lokal || stageBaseUrl(auth);
const LOKALE_HODER = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin", "x-user-roles": "ADMINISTRATOR" };
const hoder = (): Record<string, string> => (lokal ? LOKALE_HODER : { authorization: `Bearer ${auth!.accessToken}` });

test.skip(!lokal && !auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const VENT_MS = 45000;
const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.91 aktivitet", hva, verdi: String(verdi) })}\n`, "utf8");
};
const bilde = (page: Page, navn: string) => { fs.mkdirSync(RAPPORT, { recursive: true }); return page.screenshot({ path: path.join(RAPPORT, `${navn}.png`), fullPage: false }); };

async function api(sti: string): Promise<{ status: number; json: Record<string, any> }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, { headers: { ...hoder(), "x-locale": "nb" } });
  const tekst = await svar.text();
  let json: Record<string, any> = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json };
}

const TYPER = ["read", "submitted", "passed", "completed"] as const;
let rapport: Record<string, any> | null = null;

test("rapporten: tolv uker, og søylene og lista teller de samme hendelsene", async () => {
  const svar = await api("/api/reports/activity?period=12&grain=week");
  expect(svar.status).toBe(200);
  rapport = svar.json;
  const r = rapport!;
  // ⚠️ KONTROLL: stage har brukere. Første kjøring fant null deltakere (rollekravet, se
  // participantWhere), og alle påstandene under var da sanne uten å måle noe.
  expect(r.population, "stage skal ha deltakere").toBeGreaterThan(0);
  expect(r.kpis.started, "noen på stage har gjort noe").toBeGreaterThan(0);
  expect(r.buckets).toHaveLength(12);
  expect(r.people).toHaveLength(r.population);
  expect(r.kpis.started).toBeLessThanOrEqual(r.population);
  expect(r.kpis.active7).toBeLessThanOrEqual(r.kpis.active30);
  for (const p of r.people) {
    expect(["active", "quiet", "not_started"]).toContain(p.status);
    expect(p.activeDaysByWeek).toHaveLength(12);
    if (p.status === "not_started") expect(p.lastActivityAt).toBeNull();
  }
  // Grafen og lista er to veier til de samme hendelsene i perioden: de må gå opp.
  for (const type of TYPER) {
    const iGrafen = r.buckets.reduce((sum: number, b: any) => sum + b.counts[type], 0);
    const iLista = r.people.reduce((sum: number, p: any) => sum + p.counts[type], 0);
    expect(iGrafen, type).toBe(iLista);
  }
  // «I gang totalt» kan bare vokse, og ender på antallet som har kommet i gang.
  const kurve = r.buckets.map((b: any) => b.startedTotal);
  expect(kurve).toEqual([...kurve].sort((a: number, b: number) => a - b));
  expect(kurve.at(-1)).toBe(r.kpis.started);

  noter("deltakere", r.population);
  noter("i gang", r.kpis.started);
  noter("aktive 7 / 30 dager", `${r.kpis.active7} / ${r.kpis.active30}`);
  noter("hendelser 12 uker", TYPER.map((t) => `${t}=${r.buckets.reduce((s: number, b: any) => s + b.counts[t], 0)}`).join(" "));
  noter("avdelinger", r.departments.length);
});

test("per dag de siste 4 ukene, og hele perioden", async () => {
  const dag = await api("/api/reports/activity?period=4&grain=day");
  expect(dag.status).toBe(200);
  expect(dag.json.buckets.length).toBeGreaterThanOrEqual(22);
  expect(dag.json.buckets.length).toBeLessThanOrEqual(28);
  const alt = await api("/api/reports/activity?period=all&grain=week");
  expect(alt.status).toBe(200);
  // Hele perioden begynner mandagen i uka for den første hendelsen på stage.
  expect(alt.json.buckets.length).toBeGreaterThanOrEqual(1);
  expect(alt.json.range.from <= alt.json.buckets[0].from).toBe(true);
  noter("uker i hele perioden", alt.json.buckets.length);
  noter("første uke", alt.json.range.from);
});

test("det siste en aktiv person har gjort: nyeste først, med titler", async () => {
  const aktiv = rapport?.people.find((p: any) => p.status !== "not_started");
  test.skip(!aktiv, "ingen på stage har gjort noe");
  const svar = await api(`/api/reports/activity/users/${encodeURIComponent(aktiv.userId)}/recent`);
  expect(svar.status).toBe(200);
  const tider = svar.json.events.map((e: any) => Date.parse(e.at));
  expect(tider).toEqual([...tider].sort((a: number, b: number) => b - a));
  for (const e of svar.json.events) {
    expect(TYPER).toContain(e.type);
    expect(e.itemTitle.length).toBeGreaterThan(0);
    // Titlene er lokalisert: ikke rå JSON.
    expect(e.itemTitle.startsWith("{")).toBe(false);
  }
  noter("hendelser i «det siste»", svar.json.events.length);
});

let configCache: Record<string, unknown> | null = null;
async function forberedSide(page: Page) {
  await page.route("**/api/**", async (r: Route) => { await vent(); await r.continue({ headers: { ...r.request().headers(), ...hoder() } }); });
  configCache ??= (await (await fetch(`${BASE}/participant/config`)).json()) as Record<string, unknown>;
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...configCache, authMode: "mock" }) }),
  );
  await page.addInitScript(() => { try { localStorage.setItem("participant.locale", "nb"); localStorage.removeItem("activity.view"); } catch { /* ignore */ } });
}

for (const [bredde, navn] of [[1280, "pc"], [390, "telefon"]] as const) {
  test(`siden på ${navn}: nøkkeltall, grafer og hele lista, uten sideveis rulling`, async ({ page }) => {
    await page.setViewportSize({ width: bredde, height: 900 });
    await forberedSide(page);
    await page.goto(`${BASE}/deltakere/aktivitet`);
    await expect(page.locator("#activityKpis .activity-kpi")).toHaveCount(4, { timeout: VENT_MS });
    await expect(page.locator("#activityRows tr.person")).toHaveCount(rapport!.population, { timeout: VENT_MS });
    expect(await page.locator("#activityPeopleChart rect").count()).toBeGreaterThan(12);
    const overflyt = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflyt).toBeLessThanOrEqual(0);
    const aktivRad = page.locator("#activityRows tr.person").filter({ has: page.locator(".activity-pill.active, .activity-pill.quiet") }).first();
    if (await aktivRad.count()) {
      await aktivRad.click();
      await expect(page.locator("#activityRows tr.activity-detail .activity-log li").first()).toBeVisible({ timeout: VENT_MS });
    }
    await bilde(page, `aktivitet-${navn}`);
  });
}
