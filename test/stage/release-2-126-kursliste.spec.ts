import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.126.0 mot UTRULLET stage, med ekte API og ekte klient:
//   - kurslista i innholdsforvaltningen etter tema eller alfabetisk;
//   - toppmenyen markerer «Innholdsforvaltning» også på Tema og Moduler;
//   - «Fullførte» er borte: /participant/completed videresender, og «Mine kurs» har ingen faner;
//   - en strøket modul viser resultatet og anke-knappen når den åpnes igjen inne i kurset, uten at et
//     nytt forsøk starter.
//
// Det testen skriver på stage: én modul og ett kurs med navn som begynner på «Stage-test 2.126», og én
// strøket innlevering. Kurset er publisert mens testen går. Alt arkiveres/slettes til slutt. Testen
// sender IKKE en anke — den ville havnet i ankebehandlernes kø.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`) og skal
// ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.126.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
    try {
      localStorage.setItem("participant.locale", "nb");
      localStorage.removeItem("list.coursesTableBody.view");
    } catch { /* ignore */ }
  });
}

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = Date.now();
const tilstand: { moduleId?: string; versionId?: string; kursId?: string; submissionId?: string } = {};

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    await arkiverKurs(api, tilstand.kursId);
    noter("slett testkurs", (await api("DELETE", `/api/admin/content/courses/${tilstand.kursId}`)).status);
  }
  if (tilstand.moduleId) {
    noter("arkiver testmodul", (await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/archive`)).status);
    noter("slett testmodul", (await api("DELETE", `/api/admin/content/modules/${tilstand.moduleId}`)).status);
  }
});

test("versjonen er minst 2.126.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.126.0"));
});

test("«Fullførte» er borte: adressen videresender til «Mine kurs»", async () => {
  const svar = await fetch(`${BASE}/participant/completed`, { redirect: "manual" });
  noter("videresending", { status: svar.status, til: svar.headers.get("location") });
  expect(svar.status).toBe(301);
  expect(svar.headers.get("location")).toBe("/participant");
});

test("toppmenyen markerer «Innholdsforvaltning» på Tema og Moduler, ikke bare på Kurs", async ({ page }) => {
  test.setTimeout(150_000);
  await forberedSide(page);
  for (const rute of ["/admin-content/themes", "/admin-content", "/admin-content/courses"]) {
    await page.goto(`${BASE}${rute}`, { waitUntil: "domcontentloaded" });
    const aktiv = page.locator('#workspaceNav a[aria-current="page"]');
    await expect(aktiv).toHaveCount(1, { timeout: 45000 });
    const tekst = (await aktiv.innerText()).trim();
    noter(`markert på ${rute}`, tekst);
    expect(tekst).toBe("Innholdsforvaltning");
  }
});

test("kurslista: etter tema med «Kurs uten tema» sist, alfabetisk ved valg, og ingen sidelengs rulling på telefon", async ({ page }) => {
  test.setTimeout(150_000);
  await forberedSide(page);
  for (const bredde of [1280, 390]) {
    await page.setViewportSize({ width: bredde, height: 844 });
    await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".list-table tbody tr").first()).toBeVisible({ timeout: 45000 });
    const valg = page.locator(".list-view-toggle");
    if ((await valg.count()) === 0) {
      noter("ingen kurs med tema på stage — valget vises ikke", bredde);
      continue;
    }
    await expect(page.locator('[data-list-view="group"]')).toHaveAttribute("aria-pressed", "true");
    const overskrifter = (await page.locator(".list-group-heading").allInnerTexts()).map((s) => s.trim());
    noter(`overskrifter ${bredde}`, overskrifter);
    expect(overskrifter.length).toBeGreaterThan(0);
    if (overskrifter.includes("Kurs uten tema")) expect(overskrifter.at(-1)).toBe("Kurs uten tema");
    const overflyt = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    noter(`overflyt ${bredde}`, overflyt);
    expect(overflyt).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(RAPPORT, `2126-kursliste-${bredde}.png`), fullPage: true });

    await page.locator('[data-list-view="alphabetical"]').click();
    await expect(page.locator(".list-group-heading")).toHaveCount(0);
    await page.locator('[data-list-view="group"]').click();
  }
});

test("en strøket modul viser resultatet og anke-knappen når den åpnes igjen i kurset — uten nytt forsøk", async ({ page }) => {
  test.setTimeout(240_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 2.126 anke ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst).toBe(201);
  tilstand.moduleId = modul.json.module.id;
  const sett = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/mcq-set-versions`, {
    title: L("Sett"),
    questions: [{ questionType: "fill", stem: L("Fristen for å klage er ___ uker."), options: [L("tre"), L("3")], rationale: L("Tre uker.") }],
  });
  expect(sett.status, sett.tekst).toBe(201);
  const versjon = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 } },
  });
  expect(versjon.status, versjon.tekst).toBe(201);
  tilstand.versionId = versjon.json.moduleVersion.id;
  const publisert = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/module-versions/${tilstand.versionId}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 400)).toContain(publisert.status);

  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.126 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "MODULE", moduleId: tilstand.moduleId }] })).status).toBe(204);
  const kursPublisert = await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`);
  expect(kursPublisert.status, kursPublisert.tekst.slice(0, 400)).toBe(200);

  // Et stryk, levert gjennom API-et.
  const innlevering = await api("POST", "/api/submissions", { moduleId: tilstand.moduleId, moduleVersionId: (await api("GET", `/api/modules/${tilstand.moduleId}`)).json.module?.activeVersion?.id, deliveryType: "text", responseJson: {} });
  expect(innlevering.status, innlevering.tekst).toBe(201);
  tilstand.submissionId = innlevering.json.submission.id;
  const start = await api("GET", `/api/modules/${tilstand.moduleId}/mcq/start?submissionId=${tilstand.submissionId}`);
  expect(start.status, start.tekst).toBe(200);
  const levert = await api("POST", `/api/modules/${tilstand.moduleId}/mcq/submit`, {
    submissionId: tilstand.submissionId,
    attemptId: start.json.attemptId,
    responses: start.json.questions.map((q: { id: string }) => ({ questionId: q.id, textAnswer: "feil" })),
  });
  expect(levert.status, levert.tekst).toBe(200);
  const resultat = await api("GET", `/api/submissions/${tilstand.submissionId}/result`);
  noter("strykresultat", { status: resultat.json.status, bestått: resultat.json.decision?.passFailTotal });
  expect(resultat.json.decision?.passFailTotal).toBe(false);

  // Senere, i en ny økt: deltakeren åpner kurset og modulen.
  await forberedSide(page);
  const nyeInnleveringer: string[] = [];
  page.on("request", (req) => { if (req.method() === "POST" && /\/api\/submissions$/.test(req.url())) nyeInnleveringer.push(req.url()); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/participant?courseId=${tilstand.kursId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".course-sequence")).toBeVisible({ timeout: 45000 });
  await expect(page.locator("#mineKursSubnav")).toHaveCount(0);
  await page.locator(".course-sequence .course-module-row").first().click();

  await expect(page.locator("#resultSummary")).toHaveAttribute("data-has-result", "true", { timeout: 45000 });
  await expect(page.locator("#createAppeal")).toBeEnabled();
  await page.screenshot({ path: path.join(RAPPORT, "2126-strok-anke.png"), fullPage: true });
  noter("nye innleveringer ved åpning", nyeInnleveringer.length);
  expect(nyeInnleveringer).toEqual([]);
});
