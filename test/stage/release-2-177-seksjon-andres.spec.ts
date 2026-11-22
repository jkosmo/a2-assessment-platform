import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.177.0 mot UTRULLET stage, med ekte data (#1180, seksjoner følger kursets og modulens eierregel):
//
//   A. Tjeneren: en seksjon stage-kontoen ikke eier (fra prod-kopien), svarer 200 med `canManage: false` i lista og detaljen,
//      og «Døp om» gir 403 `content_ownership` uten at noe endres.
//   B. I nettleseren: raden har «Åpne», og redigereren viser seksjonen skrivebeskyttet med linja, sperrede felt og bare
//      «Eksporter». Forhåndsvisningen virker.
//   C. Kontroll: en seksjon stage-kontoen selv lager, er åpen (ingen linje, feltene kan endres, Lagre finnes). Den slettes etterpå.
//
// Det testen skriver: én seksjon («Stage-test 2.177.0 …»), som arkiveres og slettes. Den andres seksjon endres ikke.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.177.0", base: new URL(BASE).host, hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};
const bildesti = (navn: string) => path.join(RAPPORT, `2177-${new URL(BASE).host.split(".")[0]}-${navn}.png`);

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  }).catch((feil: unknown) => {
    throw new Error(`${metode} ${sti.split("?")[0]} svarte ikke: ${feil instanceof Error ? feil.message : String(feil)}`);
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

let configCache: Record<string, unknown> | null = null;
async function forberedSide(page: Page) {
  await page.route("**/api/**", async (r: Route) => {
    await vent();
    await r.continue({ headers: { ...r.request().headers(), ...hoder() } });
  });
  configCache ??= (await (await fetch(`${BASE}/participant/config`)).json()) as Record<string, unknown>;
  await page.route("**/participant/config", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...configCache, authMode: "mock" }) }),
  );
  await page.addInitScript(() => {
    try { localStorage.setItem("participant.locale", "nb"); } catch { /* ignore */ }
  });
}

const L = (en: string, nb: string = en) => ({ "en-GB": en, nb, nn: nb });
const tittelNb = (raw: unknown): string => {
  const verdi = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return { nb: raw }; } })() : raw;
  return String((verdi as Record<string, string> | null)?.nb ?? "");
};
const stempel = Date.now();
const EGEN = `Stage-test 2.177.0 seksjon ${stempel}`;
const NOTICE = "Du kan lese, men bare eierne kan endre.";
const tilstand: { annen?: { id: string; tittel: string; versjon: number }; egen?: string } = {};

test.afterAll(async () => {
  if (!tilstand.egen) return;
  await api("POST", `/api/admin/content/sections/${tilstand.egen}/archive`);
  const s = await api("DELETE", `/api/admin/content/sections/${tilstand.egen}`);
  noter("rydding: egen seksjon", s.status);
  expect([200, 204, 404], `ryddingen feilet: ${s.tekst.slice(0, 200)}`).toContain(s.status);
});

test("versjonen er minst 2.177.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.177.0"));
});

test("A: en annens seksjon leses med canManage=false, og «Døp om» avvises uten å endre noe", async () => {
  const liste = await api("GET", "/api/admin/content/sections");
  expect(liste.status, liste.tekst.slice(0, 200)).toBe(200);
  const andres = (liste.json.sections as Array<Record<string, any>>).filter((s) => s.canManage === false && !s.archivedAt);
  noter("andres seksjoner (ikke arkivert)", andres.length);
  expect(andres.length, "stage har ingen seksjon stage-kontoen ikke eier; testen måler ingenting").toBeGreaterThan(0);
  const valgt = andres[0];
  const detalj = await api("GET", `/api/admin/content/sections/${valgt.id}`);
  expect(detalj.status).toBe(200);
  expect(detalj.json.section.canManage).toBe(false);
  const versjon = Number(detalj.json.section.latestVersionNo ?? detalj.json.section.versionNo ?? 1);
  tilstand.annen = { id: valgt.id, tittel: tittelNb(detalj.json.section.title), versjon };

  const forsok = await api("PATCH", `/api/admin/content/sections/${valgt.id}/title`, { title: L("Kapret 2.177.0"), expectedVersionNo: versjon });
  expect(forsok.status, forsok.tekst.slice(0, 200)).toBe(403);
  expect(forsok.json.error).toBe("content_ownership");
  const etter = await api("GET", `/api/admin/content/sections/${valgt.id}`);
  expect(tittelNb(etter.json.section.title)).toBe(tilstand.annen.tittel);
  expect(etter.json.section.updatedAt).toBe(detalj.json.section.updatedAt);
});

test("B: i nettleseren har raden «Åpne», og redigereren viser seksjonen skrivebeskyttet", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!tilstand.annen, "A fant ingen seksjon");
  const annen = tilstand.annen!;
  await forberedSide(page);
  const skriv: string[] = [];
  page.on("request", (r) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(r.method())) return;
    const sti = new URL(r.url()).pathname;
    if (sti.includes("/content-owners") || sti.includes("/intent-log") || sti.endsWith("/sections/preview")) return;
    skriv.push(`${r.method()} ${sti}`);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/sections`, { waitUntil: "domcontentloaded" });
  await page.locator("#sectionsSearch").fill(annen.id);
  const aapne = page.locator(`[data-action="edit"][data-id="${annen.id}"]`);
  await expect(aapne).toHaveText("Åpne", { timeout: 45_000 });
  await aapne.click();
  await expect(page.locator("#titleInput")).toHaveValue(annen.tittel, { timeout: 45_000 });
  await expect(page.locator("[data-section-readonly-notice]")).toHaveText(NOTICE);
  await expect(page.locator("#titleInput")).toBeDisabled();
  await expect(page.locator("#markdownInput")).toBeDisabled();
  await expect(page.locator("#formSaveBtn")).toHaveCount(0);
  await expect(page.locator("#uploadImageBtn")).toHaveCount(0);
  const handlinger = await page.locator(".form-page-actions [data-editor-action]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.editorAction));
  expect(handlinger).toEqual(["export"]);
  await page.screenshot({ path: bildesti("annens-seksjon"), fullPage: true });
  await page.locator("#formTab-forhandsvisning").click();
  await expect(page.locator("#previewPane")).not.toBeEmpty({ timeout: 30_000 });
  expect(skriv, "siden skrev noe for en annens seksjon").toEqual([]);
});

test("C (kontroll): en seksjon stage-kontoen selv lager, er åpen for endring", async ({ page }) => {
  test.setTimeout(180_000);
  const ny = await api("POST", "/api/admin/content/sections", { title: L(EGEN), bodyMarkdown: L("Text.", "Tekst.") });
  expect(ny.status, ny.tekst.slice(0, 300)).toBe(201);
  tilstand.egen = ny.json.section?.id ?? ny.json.id;
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/sections?id=${tilstand.egen}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#titleInput")).toHaveValue(EGEN, { timeout: 45_000 });
  await expect(page.locator("[data-section-readonly-notice]")).toHaveCount(0);
  await expect(page.locator("#titleInput")).toBeEnabled();
  await expect(page.locator("#markdownInput")).toBeEnabled();
  await expect(page.locator("#formSaveBtn")).toHaveCount(1);
});
