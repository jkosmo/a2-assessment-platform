import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.162.0 mot UTRULLET stage, med ekte data (#1152 4b, slettedatoen i listene):
//
//   A. Migreringen har skrevet overgangsraden: en modul arkivert nå får `retention.deletesAt` (ikke `unknown`), og datoen er
//      seks kalendermåneder fra i dag (overgangen og arkiveringen er begge i dag eller nylig). Gamle arkiverte rader i lista
//      har også et svar, ingen `unknown`.
//   B. Punkt 7: en seksjon som bare ligger i et arkivert kurs uten kursbevis, får en dato (kursets), ikke «beholdes». Kurset
//      har samme dato. Kontroll: «Slett» på seksjonen svarer `content_in_archived_course` til kurset er slettet; deretter
//      slettes den.
//   C. I nettleseren: biblioteket viser «Slettes <dato>» under merket på den arkiverte modulen.
//
// Grunnene til å beholde er dekket av integrasjonstestene (test/m2-archived-retention-1152.test.ts); stage-kontoen kan ikke
// lage kursbevis, innleveringer eller utkast her. Det testen skriver: én modul, ett kurs, én seksjon («Stage-test 2.162.0 …»),
// alt slettes. ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.162.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
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
const stempel = Date.now();
const navn = (hva: string) => `Stage-test 2.162.0 ${hva} ${stempel}`;
const sporsmaal = { stem: L("Who receives an appeal?", "Hvem skal klagen sendes til?"), options: [L("The deciding body", "Vedtaksorganet"), L("The ombudsman", "Ombudet"), L("The county governor", "Statsforvalteren"), L("The court", "Domstolen")], correctAnswer: L("The deciding body", "Vedtaksorganet"), rationale: L("The body that made the decision.", "Organet som fattet vedtaket.") };

const tilstand: { modul?: string; kurs?: string; seksjon?: string; slettet: Set<string> } = { slettet: new Set() };
const modulsti = (id: string) => `/api/admin/content/modules/${id}`;
const seksjonssti = (id: string) => `/api/admin/content/sections/${id}`;
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;

/** Dagens dato i Oslo pluss seks kalendermåneder (siste dag i måneden når dagen ikke finnes). */
function seksMånederFraIDag(): string {
  const idag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = idag.split("-").map(Number);
  const måned = m - 1 + 6;
  const år = y + Math.floor(måned / 12);
  const mnd = (måned % 12) + 1;
  const siste = new Date(Date.UTC(år, mnd, 0)).getUTCDate();
  return `${år}-${String(mnd).padStart(2, "0")}-${String(Math.min(d, siste)).padStart(2, "0")}`;
}

async function bibliotekRad(id: string) {
  const b = await api("GET", "/api/admin/content/modules/library?locale=nb");
  expect(b.status).toBe(200);
  return { rad: (b.json.modules ?? []).find((m: { id: string }) => m.id === id), alle: b.json.modules ?? [] };
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  if (tilstand.kurs && !tilstand.slettet.has(tilstand.kurs)) {
    await arkiverKurs(api, tilstand.kurs);
    const s = await api("DELETE", kurssti(tilstand.kurs));
    noter("rydding: kurs", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`kurs ${s.status}`);
  }
  if (tilstand.seksjon && !tilstand.slettet.has(tilstand.seksjon)) {
    await api("POST", `${seksjonssti(tilstand.seksjon)}/archive`);
    const s = await api("DELETE", seksjonssti(tilstand.seksjon));
    noter("rydding: seksjon", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`seksjon ${s.status}`);
  }
  if (tilstand.modul && !tilstand.slettet.has(tilstand.modul)) {
    await api("POST", `${modulsti(tilstand.modul)}/unpublish`, {});
    await api("POST", `${modulsti(tilstand.modul)}/archive`, {});
    const s = await api("DELETE", modulsti(tilstand.modul));
    noter("rydding: modul", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`modul ${s.status}`);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.162.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.162.0"));
});

test("A: overgangsraden finnes — en modul arkivert nå får en dato seks måneder fram, og ingen arkivert rad er «ukjent»", async () => {
  test.setTimeout(180_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(navn("modul")), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  tilstand.modul = modul.json.module.id as string;
  const sett = await api("POST", `${modulsti(tilstand.modul)}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [sporsmaal] });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  expect((await api("POST", `${modulsti(tilstand.modul)}/archive`, {})).status).toBe(200);

  const { rad, alle } = await bibliotekRad(tilstand.modul);
  const arkiverte = alle.filter((m: { archivedAt?: string | null }) => m.archivedAt);
  const ukjente = arkiverte.filter((m: { retention?: { unknown?: boolean } }) => !m.retention || m.retention.unknown);
  const fordeling = arkiverte.reduce((acc: Record<string, number>, m: { retention?: { deletesAt?: string; kept?: { code: string } } }) => {
    const k = m.retention?.deletesAt ? "deletesAt" : m.retention?.kept?.code ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  noter("A, modulen", rad?.retention);
  noter("A, fordelingen i biblioteket", { arkiverte: arkiverte.length, fordeling });
  expect(rad?.retention?.deletesAt, "overgangsraden mangler eller kan ikke leses (retention.unknown)").toBe(seksMånederFraIDag());
  expect(ukjente.length, "noen arkiverte rader har ikke svar").toBe(0);
});

test("B: en seksjon som bare ligger i et arkivert kurs uten kursbevis, får kursets dato; «Slett» venter på kurset", async () => {
  test.setTimeout(300_000);
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(navn("seksjon")), bodyMarkdown: L("Text.", "Tekst.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjon = seksjon.json.section.id as string;
  expect((await api("POST", `${seksjonssti(tilstand.seksjon)}/publish`)).status).toBe(200);
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(navn("kurs")), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kurs = kurs.json.course.id as string;
  expect((await api("PUT", `${kurssti(tilstand.kurs)}/items`, { items: [{ type: "SECTION", sectionId: tilstand.seksjon }] })).status).toBe(204);
  expect((await api("POST", `${kurssti(tilstand.kurs)}/publish`)).status).toBe(200);
  const arkivert = await arkiverKurs(api, tilstand.kurs);
  expect(arkivert.status, arkivert.tekst.slice(0, 300)).toBe(200);

  const kursliste = await api("GET", "/api/admin/content/courses");
  const seksjonsliste = await api("GET", "/api/admin/content/sections");
  const kursRad = (kursliste.json.courses ?? kursliste.json ?? []).find?.((c: { id: string }) => c.id === tilstand.kurs);
  const seksjonRad = (seksjonsliste.json.sections ?? []).find((s: { id: string }) => s.id === tilstand.seksjon);
  noter("B, svarene", { kurs: kursRad?.retention, seksjon: seksjonRad?.retention });
  expect(kursRad?.retention?.deletesAt).toBe(seksMånederFraIDag());
  expect(seksjonRad?.retention?.deletesAt, "seksjonen skulle fått kursets dato (punkt 7)").toBe(kursRad?.retention?.deletesAt);

  const førKurset = await api("DELETE", seksjonssti(tilstand.seksjon));
  noter("B, slett seksjonen før kurset", { status: førKurset.status, error: førKurset.json.error });
  expect(førKurset.json.error).toBe("content_in_archived_course");
  const k = await api("DELETE", kurssti(tilstand.kurs));
  expect(k.status, k.tekst.slice(0, 300)).toBeLessThan(300);
  tilstand.slettet.add(tilstand.kurs);
  const s = await api("DELETE", seksjonssti(tilstand.seksjon));
  expect(s.status, s.tekst.slice(0, 300)).toBeLessThan(300);
  tilstand.slettet.add(tilstand.seksjon);
});

test("C: biblioteket viser «Slettes <dato>» under merket på den arkiverte modulen", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.modul, "modulen ble ikke laget");
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content`, { waitUntil: "domcontentloaded" });
  const arkivFilter = page.locator('.list-filter-btn[data-filter="archived"]');
  await expect(arkivFilter).toBeVisible({ timeout: 45_000 });
  await arkivFilter.click();
  const rad = page.locator("tr", { hasText: navn("modul") });
  await expect(rad).toBeVisible({ timeout: 45_000 });
  const [y, m, d] = seksMånederFraIDag().split("-");
  await expect(rad).toContainText(`Slettes ${d}.${m}.${y}`);
  fs.mkdirSync(RAPPORT, { recursive: true });
  await rad.screenshot({ path: path.join(RAPPORT, "2162-bibliotek-slettedato.png") });
});
