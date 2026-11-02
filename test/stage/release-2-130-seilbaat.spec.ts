import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.130.0 mot UTRULLET stage, med ekte API og ekte klient:
//   - favicon: filene serveres, og sidene lenker til dem;
//   - #1137: et kurs i gang har seilbåten på linja, som fylles fra høyre; et fullført kurs har hel grønn
//     linje uten båt.
// Feiringen når et kurs fullføres i økta, og redusert bevegelse, er dekket av e2e
// (test/e2e/course-progress-boat-1137.spec.ts) — her måles det som avhenger av ekte data.
//
// Det testen skriver på stage: to seksjoner og ett kurs («Stage-test 2.130 …»), og ett kursbevis for
// testkontoen. Kurset arkiveres etterpå. ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller
// `.stage-service-auth.json`) og skal ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.130.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
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

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = Date.now();
const tilstand: { kursId?: string; seksjoner: string[] } = { seksjoner: [] };

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    noter("arkiver testkurs", (await api("POST", `/api/admin/content/courses/${tilstand.kursId}/archive`)).status);
  }
});

test("versjonen er 2.130.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.130.0");
});

test("favicon: filene serveres med riktig type, og sidene lenker til dem", async () => {
  for (const [fil, type] of [["favicon.svg", "image/svg+xml"], ["favicon-32.png", "image/png"], ["favicon-16.png", "image/png"], ["apple-touch-icon-180.png", "image/png"]]) {
    const svar = await fetch(`${BASE}/static/${fil}`);
    noter(`favicon ${fil}`, { status: svar.status, type: svar.headers.get("content-type") });
    expect(svar.status, fil).toBe(200);
    expect(svar.headers.get("content-type") ?? "", fil).toContain(type);
  }
  for (const side of ["/participant", "/profile", "/admin-content/courses", "/certificate"]) {
    const html = await (await fetch(`${BASE}${side}`, { headers: hoder() })).text();
    expect(html, side).toContain('rel="icon" href="/static/favicon.svg"');
    expect(html, side).toContain('rel="apple-touch-icon" href="/static/apple-touch-icon-180.png"');
  }
});

test("et kurs i gang har seilbåten, og linja fylles fra høyre; fullført er hel grønn linje uten båt", async ({ page }) => {
  test.setTimeout(240_000);
  for (const n of [1, 2]) {
    const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`Stage-test 2.130 seksjon ${n} ${stempel}`), bodyMarkdown: L("Innhold.") });
    expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
    const id = seksjon.json.section.id as string;
    tilstand.seksjoner.push(id);
    expect((await api("POST", `/api/admin/content/sections/${id}/publish`)).status).toBe(200);
  }
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.130 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  const items = tilstand.seksjoner.map((sectionId) => ({ type: "SECTION", sectionId }));
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`)).status).toBe(200);

  // Første seksjon lest: 1 av 2 steg = 50 % → kurs i gang, fullt seil.
  expect([200, 201, 204]).toContain((await api("POST", `/api/courses/${tilstand.kursId}/sections/${tilstand.seksjoner[0]}/read`)).status);

  await forberedSide(page);
  await page.goto(`${BASE}/participant`, { waitUntil: "domcontentloaded" });
  const kort = page.locator(`.course-accordion-item[data-course-id="${tilstand.kursId}"]`).first();
  await expect(kort).toBeVisible({ timeout: 45000 });
  const baat = kort.locator(".course-boat");
  await expect(baat).toHaveCount(1);
  await expect(baat).toHaveAttribute("data-boat-mood", "mett");
  await expect(kort.locator(".course-progress-bar")).toHaveAttribute("aria-valuenow", "50");
  const linje = await kort.locator(".course-progress-bar").boundingBox();
  const fylt = await kort.locator(".course-progress-fill").boundingBox();
  noter("i gang", { linje, fylt });
  expect(Math.abs((fylt!.x + fylt!.width) - (linje!.x + linje!.width))).toBeLessThan(1.5);

  // Andre seksjon lest: fullført → hel grønn linje, ingen båt.
  expect([200, 201, 204]).toContain((await api("POST", `/api/courses/${tilstand.kursId}/sections/${tilstand.seksjoner[1]}/read`)).status);
  await page.reload({ waitUntil: "domcontentloaded" });
  const ferdig = page.locator(`.course-accordion-item[data-course-id="${tilstand.kursId}"]`).first();
  await expect(ferdig).toHaveClass(/course-accordion-item--done/, { timeout: 45000 });
  await expect(ferdig.locator(".course-progress-fill")).toHaveClass(/completed/);
  await expect(ferdig.locator(".course-boat")).toHaveCount(0);
  noter("fullført", "grønn linje, ingen båt");
});
