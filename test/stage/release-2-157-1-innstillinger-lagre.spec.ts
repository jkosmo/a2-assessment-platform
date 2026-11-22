import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Request as SideForespørsel, type Route } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.157.1 mot UTRULLET stage: «Lagre» i hodet gjør ingenting når forfatteren har krysset av en innstilling.
//
// Feilen (sett i 2.157.0): forfatteren åpner en publisert modul (siden starter i Rediger), går til Innstillinger, krysser av
// «Vis deltakeren hvilke svar som ble feil …» (#settingsMcqReview) og trykker «Lagre» i hodet (#formSaveBtn). Ingen lagring
// sendes. Nederst i Innstillinger står «Du har et ulagret utkast i Rediger …», selv om ingenting er skrevet i Rediger. Det
// rammer moduler med et flervalgsspørsmål av typen «flere riktige», «sett i rekkefølge» eller «fyll inn».
//
// Testen gjør det forfatteren gjør, i den ekte modulsiden, med en modul laget for testen:
//   - «forfatteren …» noterer det siden faktisk gjør (teksten om utkast, #settingsSave, skrivende kall, meldinger) og tar bilde;
//   - «påstand A» er den ene påstanden som skal være rød med feilen og grønn uten: lagringen sendes, og nyeste versjon har
//     `assessmentPolicy.mcq.reviewAfterSubmit === true`.
//
// Det testen skriver på stage: én modul («Stage-test 2.157.1 …»). Den arkiveres etterpå, og testen feiler hvis ryddingen
// feiler. ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.157.1", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};
const bildesti = (navn: string) => path.join(RAPPORT, `21571-${navn}.png`);

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
    // Meldinger (toast) forsvinner av seg selv: skriv ned hver melding idet den legges inn i siden.
    const sett: string[] = [];
    (window as unknown as { __meldinger: string[] }).__meldinger = sett;
    new MutationObserver((endringer) => {
      for (const endring of endringer) {
        for (const node of endring.addedNodes) {
          if (!(node instanceof Element)) continue;
          const funnet = node.matches(".toast__message") ? [node] : [...node.querySelectorAll(".toast__message")];
          for (const el of funnet) sett.push(el.textContent ?? "");
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

const L = (en: string, nb: string) => ({ "en-GB": en, nb, nn: nb });
const stempel = Date.now();
const MODULNAVN = `Stage-test 2.157.1 innstillinger-lagre ${stempel}`;

// Tre spørsmål: ett vanlig, ett «flere riktige» og ett «fyll inn» (kravene står i adminContentSchemas.ts).
const A = L("Purpose", "Formål");
const B = L("Colour", "Farge");
const C = L("Legal basis", "Behandlingsgrunnlag");
const D = L("Font", "Skrifttype");
const vanlig = { stem: L("Who receives an appeal?", "Hvem skal klagen sendes til?"), options: [L("The deciding body", "Vedtaksorganet"), L("The ombudsman", "Ombudet"), L("The county governor", "Statsforvalteren"), L("The court", "Domstolen")], correctAnswer: L("The deciding body", "Vedtaksorganet"), rationale: L("The body that made the decision.", "Organet som fattet vedtaket.") };
const flereRiktige = { questionType: "multiple", stem: L("What must the record state?", "Hva må protokollen inneholde?"), options: [A, B, C, D], correctAnswers: [A, C], rationale: L("Art. 30.", "Art. 30.") };
const fyllInn = { questionType: "fill", stem: L("The deadline for an appeal is ___ weeks.", "Fristen for å klage er ___ uker."), options: [L("three", "tre"), L("3", "3")], rationale: L("Three weeks.", "Tre uker.") };

type Kall = { metode: string; sti: string; status: number | null };
const tilstand: {
  moduleId?: string;
  versionId?: string;
  versjonerFør?: number;
  /** Satt når nettlesertesten har gjort hele forløpet. `lagring` er det første skrivende kallet mot modulen som svarte 2xx. */
  observert?: { lagring: Kall | null; skrivendeKall: Kall[] };
} = {};
const modulsti = () => `/api/admin/content/modules/${tilstand.moduleId}`;

/** Modulen slik forfattersiden selv leser den (`GET …/export`), med versjonene nyeste først. */
async function lesModul() {
  const svar = await api("GET", `${modulsti()}/export`);
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  const bunt = svar.json.moduleExport;
  const versjoner = [...(bunt.versions?.moduleVersions ?? [])].sort((x: any, y: any) => y.versionNo - x.versionNo);
  return { bunt, versjoner, nyeste: versjoner[0] };
}

test.afterAll(async () => {
  if (!tilstand.moduleId) return;
  const mislyktes: string[] = [];
  // Arkivering avpubliserer selv (archiveModule). Svarer den likevel med feil, avpubliseres modulen først.
  let arkivert = await api("POST", `${modulsti()}/archive`, {});
  noter("arkiver testmodul", arkivert.status);
  if (arkivert.status >= 400) {
    noter("avpubliser testmodul", (await api("POST", `${modulsti()}/unpublish`, {})).status);
    arkivert = await api("POST", `${modulsti()}/archive`, {});
    noter("arkiver testmodul, andre forsøk", arkivert.status);
  }
  if (arkivert.status >= 400) mislyktes.push(`arkiver testmodul: ${arkivert.status} ${arkivert.tekst.slice(0, 200)}`);
  const etter = await api("GET", `${modulsti()}/export`);
  const modul = etter.json.moduleExport?.module;
  noter("testmodulen etter rydding", { status: etter.status, arkivert: Boolean(modul?.archivedAt), publisert: Boolean(modul?.activeVersionId) });
  if (etter.status !== 200 || !modul?.archivedAt || modul?.activeVersionId) mislyktes.push(`testmodulen er ikke arkivert og avpublisert (lesekallet svarte ${etter.status})`);
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.157.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.157.0"));
});

test("en publisert flervalgsmodul med ett vanlig spørsmål, ett «flere riktige» og ett «fyll inn» lages", async () => {
  test.setTimeout(180_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(MODULNAVN, MODULNAVN), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  tilstand.moduleId = modul.json.module.id;
  noter("testmodul", { id: tilstand.moduleId, navn: MODULNAVN });

  const sett = await api("POST", `${modulsti()}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [vanlig, flereRiktige, fyllInn] });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  // Uten `reviewAfterSubmit`: avkrysningen står tom når forfatteren åpner Innstillinger.
  const versjon = await api("POST", `${modulsti()}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 } },
  });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  tilstand.versionId = versjon.json.moduleVersion.id;
  const publisert = await api("POST", `${modulsti()}/module-versions/${tilstand.versionId}/publish`, {});
  noter("publisering", publisert.status);
  expect([200, 201], publisert.tekst.slice(0, 600)).toContain(publisert.status);

  const { bunt, versjoner, nyeste } = await lesModul();
  const typer = (bunt.selectedConfiguration?.mcqSetVersion?.questions ?? []).map((q: { questionType?: string }) => q.questionType ?? "single");
  tilstand.versjonerFør = versjoner.length;
  noter("modulen før", { publisert: bunt.module.activeVersionId === tilstand.versionId, versjoner: versjoner.length, spørsmålstyper: typer, reviewAfterSubmit: nyeste?.assessmentPolicy?.mcq?.reviewAfterSubmit ?? null });
  expect(bunt.module.activeVersionId).toBe(tilstand.versionId);
  expect(typer).toEqual(["single", "multiple", "fill"]);
  expect(nyeste?.assessmentPolicy?.mcq?.reviewAfterSubmit).toBeUndefined();
});

test("forfatteren åpner modulen i Rediger, går til Innstillinger, krysser av gjennomgangen og trykker «Lagre» i hodet", async ({ page }) => {
  test.setTimeout(240_000);
  test.skip(!tilstand.versionId, "modulen ble ikke laget");
  await forberedSide(page);

  // Alt siden sender som ikke er GET, fra første last.
  const kall = new Map<SideForespørsel, Kall>();
  const erSkrivende = (req: SideForespørsel) => req.method() !== "GET" && new URL(req.url()).pathname.startsWith("/api/");
  page.on("request", (req) => {
    if (erSkrivende(req)) kall.set(req, { metode: req.method(), sti: new URL(req.url()).pathname.replace(tilstand.moduleId!, "{id}"), status: null });
  });
  page.on("response", (res) => {
    const rad = kall.get(res.request());
    if (rad) rad.status = res.status();
  });
  // Et spørsmål fra siden (window.confirm) skrives ned og avvises, så testen ikke velger noe på forfatterens vegne.
  const dialoger: string[] = [];
  page.on("dialog", (d) => { dialoger.push(`${d.type()}: ${d.message()}`); void d.dismiss(); });

  // Slik en forfatter åpner modulen: uten `?tab=…`, så siden starter i Rediger.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/admin-content/module/${tilstand.moduleId}/conversation`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#formTab-edit")).toHaveAttribute("aria-selected", "true", { timeout: 45_000 });
  await expect(page.locator("#previewEditTitle")).toHaveValue(MODULNAVN, { timeout: 45_000 });
  await expect(page.locator("[data-preview-edit-question]")).toHaveCount(3, { timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  // Kontroll av målingen: en melding som legges inn i siden, SKAL bli skrevet ned. Uten den er «ingen melding» en antakelse.
  const KONTROLL = "kontrollmelding fra testen";
  await page.evaluate((tekst) => {
    const p = document.createElement("p");
    p.className = "toast__message";
    p.textContent = tekst;
    document.body.append(p);
    p.remove();
  }, KONTROLL);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __meldinger?: string[] }).__meldinger ?? null)).toContain(KONTROLL);
  noter("Rediger ved åpning", { hode: await page.locator("#formPageDirty").innerText(), spørsmål: await page.locator("[data-preview-edit-question]").count() });

  // Fanen Innstillinger. Ingenting er skrevet i Rediger.
  await page.locator("#formTab-settings").click();
  const panel = page.locator("#tabPanelSettings");
  await expect(panel).toBeVisible();
  await expect(page.locator("#settingsMcqReview")).toBeVisible({ timeout: 30_000 });
  const utkastTekst = await panel.getByText("Du har et ulagret utkast i Rediger").count();
  const lagreknappIPanelet = await page.locator("#settingsSave").count();
  noter("Innstillinger rett etter fanebyttet", {
    tekstenOmUlagretUtkast: utkastTekst > 0,
    settingsSaveIDom: lagreknappIPanelet > 0,
    hode: await page.locator("#formPageDirty").innerText(),
    lagreIHodetAktiv: await page.locator("#formSaveBtn").isEnabled(),
  });

  // Kryss av «Vis deltakeren hvilke svar som ble feil, med riktig svar og begrunnelse».
  await expect(page.locator("#settingsMcqReview")).not.toBeChecked();
  await page.locator("#settingsMcqReview").check();
  await expect(page.locator("#formPageDirty")).toHaveText("Ulagrede endringer", { timeout: 15_000 });
  await expect(page.locator("#formSaveBtn")).toBeEnabled();

  // «Lagre» i hodet. Et skrivende kall mot modulen som svarer 2xx innen 30 sekunder er lagringen.
  const førKlikk = kall.size;
  const lagring = page.waitForResponse((res) => {
    const sti = new URL(res.url()).pathname;
    return res.request().method() !== "GET" && sti.startsWith(`${modulsti()}/`) && res.status() >= 200 && res.status() < 300;
  }, { timeout: 30_000 }).catch(() => null);
  await page.locator("#formSaveBtn").click();

  // Bildet tas mens en eventuell melding fortsatt står: bunnen av Innstillinger-panelet.
  await page.waitForTimeout(1_500);
  fs.mkdirSync(RAPPORT, { recursive: true });
  await panel.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await page.screenshot({ path: bildesti("innstillinger-bunn") });
  await page.screenshot({ path: bildesti("innstillinger-hel"), fullPage: true });

  const svar = await lagring;
  // Ble lagringen sendt, laster siden modulen på nytt: la den bli ferdig før tilstanden leses.
  if (svar) await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  const meldinger = (await page.evaluate(() => (window as unknown as { __meldinger?: string[] }).__meldinger ?? [])).filter((m) => m !== KONTROLL);
  const alleKall = [...kall.values()];
  const etterKlikk = alleKall.slice(førKlikk);
  tilstand.observert = {
    lagring: svar ? { metode: svar.request().method(), sti: new URL(svar.url()).pathname.replace(tilstand.moduleId!, "{id}"), status: svar.status() } : null,
    skrivendeKall: alleKall,
  };
  noter("skrivende kall fra siden, hele forløpet", alleKall);
  noter("skrivende kall etter klikket på «Lagre»", etterKlikk);
  noter("lagring sendt innen 30 s", tilstand.observert.lagring ?? "nei");
  noter("meldinger (toast) siden viste", meldinger);
  noter("spørsmål (dialoger) siden viste", dialoger);
  noter("Innstillinger etter «Lagre»", {
    tekstenOmUlagretUtkast: (await panel.getByText("Du har et ulagret utkast i Rediger").count()) > 0,
    settingsSaveIDom: (await page.locator("#settingsSave").count()) > 0,
    hode: await page.locator("#formPageDirty").innerText(),
    avkrysset: await page.locator("#settingsMcqReview").isChecked().catch(() => null),
  });
  const { versjoner, nyeste } = await lesModul();
  noter("modulen etter «Lagre»", { versjonerFør: tilstand.versjonerFør, versjonerEtter: versjoner.length, reviewAfterSubmit: nyeste?.assessmentPolicy?.mcq?.reviewAfterSubmit ?? null });
  // Målingen over tas rett etter svaret, før siden har lastet modulen på nytt. Når den er ferdig, skal hodet si «Alt
  // lagret», avkrysningen stå, og siden ikke mene at det ligger et utkast. Bare når en lagring faktisk ble sendt
  // (på en versjon med feilen er det ingenting å vente på; påstand A fanger det).
  if (svar) {
    await expect(page.locator("#formPageDirty")).toHaveText("Alt lagret", { timeout: 30_000 });
    await expect(page.locator("#settingsMcqReview")).toBeChecked();
    await expect(panel.getByText("Du har et ulagret utkast i Rediger")).toHaveCount(0);
    noter("Innstillinger når siden er ferdig etter «Lagre»", { hode: await page.locator("#formPageDirty").innerText(), avkrysset: await page.locator("#settingsMcqReview").isChecked() });
  }
});

test("påstand A: «Lagre» i hodet sender lagringen, og modulens nyeste versjon har reviewAfterSubmit === true", async () => {
  test.setTimeout(120_000);
  test.skip(!tilstand.observert, "forløpet i modulsiden ble ikke gjennomført");
  expect.soft(
    tilstand.observert!.lagring,
    `ingen skrivende kall mot /api/admin/content/modules/{id}/… svarte 2xx innen 30 s etter klikket på «Lagre». Skrivende kall siden sendte: ${JSON.stringify(tilstand.observert!.skrivendeKall)}`,
  ).not.toBeNull();
  const { nyeste } = await lesModul();
  expect(nyeste?.assessmentPolicy?.mcq?.reviewAfterSubmit, "nyeste versjon har ikke assessmentPolicy.mcq.reviewAfterSubmit === true").toBe(true);
});
