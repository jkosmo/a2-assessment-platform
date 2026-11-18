import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.167.0 mot UTRULLET stage, i nettleseren, med EKTE oversetting (#1163, skive 2):
//
//   A. Seksjonsredigereren har ingen «Oversett»-knapp. Forfatteren endrer bare den bokmålske teksten og lagrer: nynorsk og
//      engelsk tekst oversettes fra bokmål av den ekte tjenesten, tittelen røres ikke, og lagringen er et utkast.
//   B. «Avbryt» etter ulagrede endringer skriver ingenting til tjeneren (ingen lagring, ingen oversetting).
//
// Det testen skriver: én seksjon («Stage-test 2.167.0 …»), som arkiveres og slettes. ⚠️ Tokenet leses fra den gitignorerte
// `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.167.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

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
  await page.setViewportSize({ width: 1280, height: 900 });
}

const stempel = Date.now();
const TITTEL = { nb: `Stage-test 2.167.0 seksjon ${stempel}`, nn: `Stage-test 2.167.0 seksjon ${stempel} (nn)`, "en-GB": `Stage-test 2.167.0 section ${stempel}` };
const TEKST = { nb: "Dette er den gamle teksten.", nn: "Skriven for hand på nynorsk.", "en-GB": "This is the old text." };
const NY_NB = "Prosjektet leverte rapporten to uker før fristen.";
const tilstand: { seksjon?: string } = {};
const sti = (id: string) => `/api/admin/content/sections/${id}`;
const kart = (raw: unknown): Record<string, string> => {
  if (raw && typeof raw === "object") return raw as Record<string, string>;
  try { return JSON.parse(String(raw)) as Record<string, string>; } catch { return { nb: String(raw) }; }
};

test.afterAll(async () => {
  if (!tilstand.seksjon) return;
  await api("POST", `${sti(tilstand.seksjon)}/archive`);
  const s = await api("DELETE", sti(tilstand.seksjon));
  noter("rydding: seksjon", s.status);
  expect(s.status === 204 || s.status === 404, `ryddingen feilet: ${s.status} ${s.json.error ?? ""}`).toBe(true);
});

test("versjonen er minst 2.167.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.167.0"));
});

test("A: ingen «Oversett»-knapp; lagring oversetter den endrede teksten fra bokmål, tittelen røres ikke, og det blir et utkast", async ({ page }) => {
  test.setTimeout(300_000);
  const s = await api("POST", "/api/admin/content/sections", { title: TITTEL, bodyMarkdown: TEKST });
  expect(s.status, s.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjon = s.json.section.id as string;
  expect((await api("POST", `${sti(tilstand.seksjon)}/publish`)).status).toBe(200);

  await forberedSide(page);
  const oversettinger: Array<{ kilde: string; maal: string; felt: string[] }> = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname.endsWith("/sections/localize")) {
      const b = (req.postDataJSON() ?? {}) as Record<string, string>;
      oversettinger.push({ kilde: b.sourceLocale, maal: b.targetLocale, felt: ["title", "bodyMarkdown"].filter((f) => f in b) });
    }
  });
  await page.goto(`${BASE}/admin-content/sections?id=${tilstand.seksjon}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#titleInput")).toHaveValue(TITTEL.nb, { timeout: 45_000 });
  await expect(page.locator("#translateBtn")).toHaveCount(0);

  await page.locator("#markdownInput").fill(NY_NB);
  const lagring = page.waitForRequest((req) => req.method() === "PUT" && new URL(req.url()).pathname === sti(tilstand.seksjon!), { timeout: 180_000 });
  await page.locator("#formSaveBtn").click();
  const body = (await lagring).postDataJSON() as Record<string, any>;
  await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret", { timeout: 60_000 });

  noter("A, oversettingskall", oversettinger);
  noter("A, lagringen", { sourceLocale: body.sourceLocale, tittel: body.title, tekst: body.bodyMarkdown });
  expect(oversettinger.map((k) => `${k.kilde}>${k.maal}`).sort()).toEqual(["nb>en-GB", "nb>nn"]);
  expect(oversettinger.every((k) => k.felt.join() === "bodyMarkdown"), "bare teksten oversettes; tittelen er ikke endret").toBe(true);
  expect(body.sourceLocale).toBe("nb");
  expect(kart(body.title)).toEqual(TITTEL);
  const tekst = kart(body.bodyMarkdown);
  expect(tekst.nb).toBe(NY_NB);
  for (const loc of ["nn", "en-GB"] as const) {
    expect(tekst[loc]?.trim(), `${loc} er tom`).toBeTruthy();
    expect(tekst[loc], `${loc} er ikke oversatt på nytt`).not.toBe(TEKST[loc]);
  }

  const detalj = await api("GET", sti(tilstand.seksjon));
  noter("A, detaljen etter lagring", { versjon: detalj.json.section.versionNo, publisert: detalj.json.section.publishedVersionNo, utkast: detalj.json.section.hasUnpublishedChanges });
  expect(detalj.json.section.hasUnpublishedChanges).toBe(true);
  expect(detalj.json.section.publishedVersionNo).toBe(1);
});

test("B: «Avbryt» etter ulagrede endringer skriver ingenting", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!tilstand.seksjon, "A ble ikke fullført");
  await forberedSide(page);
  const skrivinger: string[] = [];
  page.on("request", (req) => {
    const p = new URL(req.url()).pathname;
    // `POST …/sections/preview` tegner bare forhåndsvisningen; den lagrer ingenting.
    if (req.method() !== "GET" && p.startsWith("/api/admin/content/sections") && !p.endsWith("/preview")) skrivinger.push(`${req.method()} ${p}`);
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`${BASE}/admin-content/sections?id=${tilstand.seksjon}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#markdownInput")).toHaveValue(NY_NB, { timeout: 45_000 });
  await page.locator("#markdownInput").fill("Noe jeg angrer på.");
  await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer");
  await page.locator("#formCancelLink").click();
  await expect(page.locator("#markdownInput")).toHaveValue(NY_NB, { timeout: 45_000 });
  await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret");
  noter("B, skrivinger etter Avbryt", skrivinger);
  expect(skrivinger).toEqual([]);
});
