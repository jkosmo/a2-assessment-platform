import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.187.0–2.193.0 mot UTRULLET stage, med ekte data (#1169 og #1171: hoder, rader, merker, «Dupliser» og «Døp om» for kurs,
// meldingene, søket i kursbyggeren, «?» på tema). Det produkteier ellers ville sett over for hånd (samtalen 28.11.2026):
//
//   1. Kurslista: raden har Åpne · hovedhandling · «Mer» (Døp om · Dupliser · Eksporter · Avpubliser · Arkiver).
//   2. «Dupliser» fra lista: kopien heter « (kopi)», er begrenset og upublisert, har de samme elementene, og jeg er eier.
//   3. «Døp om» kopien (upublisert): navnet endres med en gang; meldingen nederst, ikke over knappene.
//   4. «Døp om» det publiserte kurset: navnet i utkastet, raden «Nyere utkast»; «Publiser utkastet» i hodet: bare navnet endres
//      (samme hovedversjon), og tråden på seksjonen står fortsatt på seksjonen.
//   5. Merkene: publisert kurs «Publisert · vX.Y», kopien «Utkast» uten versjon; en ny side viser ikke «Alt lagret».
//   6. Kursbyggeren: en modul uten publisert versjon matcher søket og forklares.
//   7. Tema-siden: «?» åpner hjelpen for tema.
//   8. 390 px: kursets hode og en melding fra kant til kant.
//
// Det testen skriver på stage: to kurs (originalen og kopien), én seksjon, én modul uten versjon og én diskusjonstråd, alle merket
// «Stage-test 2.193.0 …». Kursene er begrenset og ikke tildelt noen, så ingen deltakere ser dem. Ryddingen arkiverer og sletter alt.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.193.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};
const bilde = (page: Page, navn: string) => page.screenshot({ path: path.join(RAPPORT, `2193-${navn}.png`) });

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
const nettleserSpørsmål: string[] = [];
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
  page.on("dialog", (d) => { nettleserSpørsmål.push(d.message()); void d.dismiss(); });
}

type Box = { x: number; y: number; width: number; height: number };
const overlapper = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const L = (nb: string) => ({ "en-GB": `${nb} EN`, nb, nn: `${nb} NN` });
const stempel = Date.now();
const navn = `Stage-test 2.193.0 kurs ${stempel}`;
const kurssti = (id: string) => `/api/admin/content/courses/${id}`;
const tilstand = { kursId: "", kopiId: "", seksjonId: "", modulId: "", trådId: "" as string };

// Raden finnes på kursets id: under «Døp om» står tittelen i et felt, og raden har ikke lenger navnet som tekst.
const rad = (page: Page, kursId: string) => page.locator(`#coursesTableBody tr[data-row-id="${kursId}"]`).first();
async function åpneMer(page: Page, scope: ReturnType<Page["locator"]>) {
  const mer = scope.locator("details.row-more").first();
  if (!(await mer.evaluate((el) => (el as HTMLDetailsElement).open))) await mer.locator("summary").click();
  return mer;
}

test.afterAll(async () => {
  const mislyktes: string[] = [];
  for (const id of [tilstand.kopiId, tilstand.kursId].filter(Boolean)) {
    await arkiverKurs(api, id);
    const s = await api("DELETE", kurssti(id));
    noter(`rydding: kurs ${id === tilstand.kopiId ? "kopi" : "original"}`, s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push(`kurs ${id}`);
  }
  if (tilstand.seksjonId) {
    await api("POST", `/api/admin/content/sections/${tilstand.seksjonId}/archive`, {});
    const s = await api("DELETE", `/api/admin/content/sections/${tilstand.seksjonId}`);
    noter("rydding: seksjon", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push("seksjon");
  }
  if (tilstand.modulId) {
    await api("POST", `/api/admin/content/modules/${tilstand.modulId}/archive`, {});
    const s = await api("DELETE", `/api/admin/content/modules/${tilstand.modulId}`);
    noter("rydding: modul", s.status);
    if (s.status >= 300 && s.status !== 404) mislyktes.push("modul");
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.193.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.193.0"));
});

test("oppsett: et publisert, begrenset kurs med én seksjon, en tråd på seksjonen, og en modul uten versjon", async () => {
  test.setTimeout(240_000);
  const kurs = await api("POST", "/api/admin/content/courses", { enrollmentPolicy: "RESTRICTED", title: L(navn), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`Stage-test 2.193.0 seksjon ${stempel}`), bodyMarkdown: L("Innhold.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjonId = seksjon.json.section.id;
  const detalj = await api("GET", kurssti(tilstand.kursId));
  const lagret = await api("PUT", `${kurssti(tilstand.kursId)}/items`, {
    items: [{ type: "SECTION", sectionId: tilstand.seksjonId, discussionsEnabled: true }],
    expectedRevision: detalj.json.course.contentRevision,
  });
  expect(lagret.status, lagret.tekst.slice(0, 300)).toBe(204);
  const pub = await api("POST", `${kurssti(tilstand.kursId)}/publish`, { publishItems: true });
  expect(pub.status, pub.tekst.slice(0, 300)).toBe(200);

  // Tråden på seksjonen, skrevet av meg som eier.
  const elementer = await api("GET", `${kurssti(tilstand.kursId)}/items`);
  const element = (elementer.json.items ?? []).find((i: { sectionId?: string }) => i.sectionId === tilstand.seksjonId);
  noter("oppsett: elementet", { status: elementer.status, harId: Boolean(element?.id) });
  if (element?.id) {
    const tråd = await api("POST", `/api/courses/${tilstand.kursId}/discussions`, { kind: "DISCUSSION", title: "Stage-test 2.193.0 tråd", bodyMarkdown: "Står tråden fortsatt på seksjonen?", courseItemId: element.id });
    noter("oppsett: tråd", { status: tråd.status, error: tråd.json?.error });
    if (tråd.status === 201) tilstand.trådId = tråd.json.thread.id;
  }

  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 2.193.0 upublisert modul ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  tilstand.modulId = modul.json.module.id;
});

test("1 og 5: kurslista — raden har Åpne og «Mer» i fast rekkefølge, og merket «Publisert · v…»", async ({ page }) => {
  test.setTimeout(180_000);
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  const r = rad(page, tilstand.kursId);
  await expect(r).toBeVisible({ timeout: 60_000 });
  await expect(r.locator(".row-actions > .row-action-btn")).toHaveText(["Åpne"]);
  const mer = await åpneMer(page, r);
  await expect(mer.locator(".row-more-menu > .row-action-btn")).toHaveText(["Døp om", "Dupliser", "Eksporter", "Avpubliser", "Arkiver"]);
  await expect(r.locator(".col-status")).toContainText("Publisert");
  await expect(r.locator(".col-status")).toContainText(/v\d+\.\d+/);
  await bilde(page, "1-kurslista");
});

test("2: «Dupliser» fra lista — kopien er ny, begrenset, upublisert, med samme elementer, og jeg er eier", async ({ page }) => {
  test.setTimeout(240_000);
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  const r = rad(page, tilstand.kursId);
  await expect(r).toBeVisible({ timeout: 60_000 });
  const mer = await åpneMer(page, r);
  await mer.locator('[data-action="duplicate"]').click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toContainText("de samme modulene og seksjonene", { timeout: 30_000 });
  await bilde(page, "2-dupliser-dialog");
  await page.locator("#moduleLifecycleDialogConfirmBtn").click();
  await page.waitForURL(/\/admin-content\/courses\/(?!.*\?)[^/]+$/, { timeout: 90_000 });
  const kopiId = new URL(page.url()).pathname.split("/").pop()!;
  expect(kopiId).not.toBe(tilstand.kursId);
  tilstand.kopiId = kopiId;

  const kopi = (await api("GET", kurssti(kopiId))).json.course;
  noter("2: kopien", { enrollmentPolicy: kopi.enrollmentPolicy, publishedAt: kopi.publishedAt, canManage: kopi.canManage });
  expect(JSON.parse(kopi.title).nb).toBe(`${navn} (kopi)`);
  expect(kopi.enrollmentPolicy).toBe("RESTRICTED");
  expect(kopi.publishedAt).toBeNull();
  const elementer = (await api("GET", `${kurssti(kopiId)}/items`)).json.items ?? [];
  expect(elementer.map((i: { sectionId?: string }) => i.sectionId)).toEqual([tilstand.seksjonId]);
  // Merket: «Utkast», uten versjonsbrikke (aldri publisert).
  await expect(page.locator(".form-page-state")).toContainText("Utkast", { timeout: 30_000 });
  await expect(page.locator(".form-page-state .version-chip, .form-page-state [data-version-chip]")).toHaveCount(0);
  await bilde(page, "2-kopien");
  expect(nettleserSpørsmål).toEqual([]);
});

test("3: «Døp om» kopien i lista (upublisert) — navnet endres med en gang; meldingen nederst, ikke over knappene", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!tilstand.kopiId, "kopien ble ikke laget");
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  const r = rad(page, tilstand.kopiId);
  await expect(r).toBeVisible({ timeout: 60_000 });
  const mer = await åpneMer(page, r);
  await mer.locator('[data-action="rename"]').click();
  const felt = r.locator(".row-rename input");
  await expect(felt).toHaveValue(`${navn} (kopi)`);
  await felt.fill(`${navn} kopi med nytt navn`);
  await felt.press("Enter");
  const melding = page.locator(".toast").last();
  await expect(melding).toContainText("Navnet er lagret.", { timeout: 30_000 });
  const knapper = (await page.locator("#importCoursePackageBtn").boundingBox())!;
  const boks = (await melding.boundingBox())!;
  noter("3: meldingen", { boks, knapper });
  expect(overlapper(boks, knapper)).toBe(false);
  expect(boks.y + boks.height).toBeGreaterThan(900 - 80);
  await bilde(page, "3-dop-om-kopien");
  const kopi = (await api("GET", kurssti(tilstand.kopiId))).json.course;
  expect(JSON.parse(kopi.title).nb).toBe(`${navn} kopi med nytt navn`);
});

test("4: «Døp om» det publiserte kurset — utkast; «Publiser utkastet» endrer bare navnet, og tråden står på seksjonen", async ({ page }) => {
  test.setTimeout(300_000);
  await forberedSide(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const før = (await api("GET", kurssti(tilstand.kursId))).json.course;
  await page.goto(`${BASE}/admin-content/courses`, { waitUntil: "domcontentloaded" });
  const r = rad(page, tilstand.kursId);
  await expect(r).toBeVisible({ timeout: 60_000 });
  const mer = await åpneMer(page, r);
  await mer.locator('[data-action="rename"]').click();
  const felt = r.locator(".row-rename input");
  await felt.fill(`${navn} nytt navn`);
  await felt.press("Enter");
  await expect(page.locator(".toast").last()).toContainText("Navnet er lagret i utkastet", { timeout: 30_000 });
  // Kurset er urørt til utkastet publiseres; raden sier at noe venter.
  expect(JSON.parse((await api("GET", kurssti(tilstand.kursId))).json.course.title).nb).toBe(navn);
  await expect(rad(page, tilstand.kursId).locator(".col-status")).toContainText("Nyere utkast", { timeout: 30_000 });
  await bilde(page, "4-dop-om-publisert");

  await page.goto(`${BASE}/admin-content/courses/${tilstand.kursId}`, { waitUntil: "domcontentloaded" });
  const publiser = page.locator("#publishCourseDraftBtn");
  await expect(publiser).toBeVisible({ timeout: 60_000 });
  await expect(publiser).toHaveClass(/is-primary/);
  await publiser.click();
  // Sidas publiseringsdialog, med «hvem ser kurset» fra tjeneren (kan ta litt tid). Ingen spørsmål om hovedversjon: lista er lik.
  const dialog = page.locator("#cascadePublishDialog");
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  noter("4: dialogen", (await dialog.innerText()).slice(0, 400));
  await expect(page.locator("#cascadePublishVersion")).toBeHidden();
  await bilde(page, "4-publiser-utkastet-dialog");
  await page.locator("#cascadePublishConfirmBtn").click();
  await page.waitForTimeout(3000);
  noter("4: meldinger", await page.locator(".toast__message").allInnerTexts());
  await expect.poll(async () => JSON.parse((await api("GET", kurssti(tilstand.kursId))).json.course.title).nb, { timeout: 90_000 }).toBe(`${navn} nytt navn`);
  const etter = (await api("GET", kurssti(tilstand.kursId))).json.course;
  noter("4: versjon", { før: `${før.versionMajor}.${før.versionMinor}`, etter: `${etter.versionMajor}.${etter.versionMinor}` });
  expect(etter.versionMajor).toBe(før.versionMajor);

  if (!tilstand.trådId) {
    noter("4: tråden", "ikke laget (se oppsett) — ikke målt");
    return;
  }
  const tråd = await api("GET", `/api/courses/${tilstand.kursId}/discussions/${tilstand.trådId}`);
  const elementer = (await api("GET", `${kurssti(tilstand.kursId)}/items`)).json.items ?? [];
  const seksjonsElement = elementer.find((i: { sectionId?: string }) => i.sectionId === tilstand.seksjonId);
  const trådElement = tråd.json?.thread?.courseItemId ?? null;
  noter("4: tråden", { status: tråd.status, påSeksjonen: trådElement !== null && trådElement === seksjonsElement?.id });
  expect(trådElement, "tråden skal stå på seksjonen, ikke på kursets tavle").toBe(seksjonsElement?.id);
});

test("5: en ny kursside viser ikke «Alt lagret»", async ({ page }) => {
  test.setTimeout(120_000);
  await forberedSide(page);
  await page.goto(`${BASE}/admin-content/courses/new`, { waitUntil: "domcontentloaded" });
  await page.locator("#title-nb").waitFor({ timeout: 60_000 });
  await expect(page.locator("#formPageDirty")).not.toHaveText("Alt lagret");
  await bilde(page, "5-nytt-kurs");
});

test("6: kursbyggeren — modulen uten publisert versjon matcher søket og forklares; den kan ikke legges til", async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!tilstand.kopiId, "kopien ble ikke laget");
  await forberedSide(page);
  await page.goto(`${BASE}/admin-content/courses/${tilstand.kopiId}`, { waitUntil: "domcontentloaded" });
  const søk = page.locator("#comboboxInput");
  await søk.waitFor({ timeout: 60_000 });
  await søk.click();
  await søk.fill(`upublisert modul ${stempel}`);
  const hint = page.locator("#comboboxDropdown .combobox-hint");
  await expect(hint).toContainText("Ikke publisert, og kan ikke legges inn", { timeout: 30_000 });
  await expect(hint).toContainText(`upublisert modul ${stempel}`);
  await expect(page.locator("#addItemBtn")).toBeDisabled();
  await bilde(page, "6-sok-upublisert");
});

test("7: «?» på tema-siden åpner hjelpen for tema", async ({ page }) => {
  test.setTimeout(120_000);
  await forberedSide(page);
  await page.goto(`${BASE}/admin-content/themes`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-help-trigger").click({ timeout: 60_000 });
  await expect(page.locator("#workspaceHelpTitle")).toHaveText("Tema");
  await expect(page.locator("#workspaceHelpBody")).toContainText("Bare administrator kan endre listen.");
  await bilde(page, "7-tema-hjelp");
});

test("8: 390 px — kursets hode får plass, «Mer» åpner innenfor skjermen, og en melding går fra kant til kant nederst", async ({ page }) => {
  test.setTimeout(180_000);
  await forberedSide(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin-content/courses/${tilstand.kursId}`, { waitUntil: "domcontentloaded" });
  const hode = page.locator(".form-page-actions").first();
  await hode.waitFor({ timeout: 60_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const mer = await åpneMer(page, hode);
  const meny = (await mer.locator(".row-more-menu").boundingBox())!;
  noter("8: menyen", meny);
  expect(meny.x).toBeGreaterThanOrEqual(0);
  expect(meny.x + meny.width).toBeLessThanOrEqual(390 + 1);
  await bilde(page, "8-hode-390");
  await mer.locator("summary").click();
  await page.evaluate(async () => {
    const sti = "/static/toast.js";
    (await import(sti)).showToast("Stage-test: en melding på smal skjerm.", "success");
  });
  const boks = (await page.locator(".toast").last().boundingBox())!;
  noter("8: meldingen", boks);
  expect(boks.width).toBeGreaterThan(390 - 60);
  expect(boks.y + boks.height).toBeGreaterThan(844 - 80);
  await bilde(page, "8-melding-390");
});
