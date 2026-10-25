import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.98.1–2.99.0 mot UTRULLET stage: det som bare kan måles når den ekte tjeneren, den ekte databasen
// (etter migrasjonen for #1077) og den ekte lagringen møtes.
//
//   #1077  «velg alle som stemmer»: lagres med typen, eksporteres med de riktige, avvises i feil form,
//          leveres til deltakeren uten fasit, rettes som rett eller galt, og vises i gjennomgangen.
//   #1073  en figur som går i løkke, avvises av den ekte rensingen — også skrevet <STYLE>.
//   2.98.2 en figur med to oppsett svarer med bredden på det brede (X-Asset-Wide-Width).
//
// Det testen skriver på stage: én modul og én seksjon med navn som begynner på «Stage-test», begge
// slettes til slutt. Ekte innhold røres ikke. Ingen språkmodell kalles.
//
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.

const lokal = process.env.STAGE_LOKAL ?? "";
const { auth, reason } = lokal ? { auth: null, reason: "" } : readAuth();
const BASE = lokal || stageBaseUrl(auth);
const LOKALE_HODER = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin", "x-user-roles": "ADMINISTRATOR" };
const hoder = (): Record<string, string> => (lokal ? LOKALE_HODER : { authorization: `Bearer ${auth!.accessToken}` });

test.skip(!lokal && !auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.99.0", hva, verdi: String(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const L = (en: string, nb: string) => ({ "en-GB": en, nb, nn: nb });
const A = L("Purpose", "Formål");
const B = L("Colour", "Farge");
const C = L("Legal basis", "Behandlingsgrunnlag");
const D = L("Font", "Skrifttype");
const flere = { questionType: "multiple", stem: L("What must the record state?", "Hva må protokollen inneholde?"), options: [A, B, C, D], correctAnswers: [A, C], rationale: L("Art. 30.", "Art. 30.") };

const tilstand: { moduleId?: string; moduleIdAlle?: string; versionId?: string; sectionId?: string } = {};

test("versjonen er 2.104.0", async () => {
  const svar = await fetch(`${BASE}/version`);
  const json = await svar.json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.104.0");
});

test("#1077: et «velg alle» lagres med typen; feil form avvises", async () => {
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 1077 ${Date.now()}`, `Stage-test 1077 ${Date.now()}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst).toBe(201);
  tilstand.moduleId = modul.json.module.id;

  const ingenRiktige = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [{ ...flere, correctAnswers: [] }] });
  noter("ingen riktige avvises", ingenRiktige.status);
  expect(ingenRiktige.status).toBe(400);

  const sett = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [flere] });
  expect(sett.status, sett.tekst).toBe(201);
  const versjon = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 60 }, mcq: { reviewAfterSubmit: true } },
  });
  expect(versjon.status, versjon.tekst).toBe(201);
  tilstand.versionId = versjon.json.moduleVersion.id;

  const eksport = await api("GET", `/api/admin/content/modules/${tilstand.moduleId}/export-package`);
  expect(eksport.status, eksport.tekst).toBe(200);
  const spørsmål = eksport.json.envelope.module.activeVersion.mcqSet.questions[0];
  noter("eksportert type", spørsmål.questionType);
  expect(spørsmål).toMatchObject({ questionType: "multiple", correctAnswers: [A, C] });
});

test("#1077: deltakeren får typen uten fasit; rett eller galt; gjennomgangen viser valgt og riktig", async () => {
  const publisert = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/module-versions/${tilstand.versionId}/publish`, {});
  noter("publisert", publisert.status);
  expect([200, 201]).toContain(publisert.status);

  const forsøk = async (valg: string[]) => {
    const innlevering = await api("POST", "/api/submissions", { moduleId: tilstand.moduleId, deliveryType: "text", responseJson: {} });
    expect(innlevering.status, innlevering.tekst).toBe(201);
    const submissionId = innlevering.json.submission.id as string;
    const start = await api("GET", `/api/modules/${tilstand.moduleId}/mcq/start?submissionId=${submissionId}&locale=nb`);
    expect(start.status, start.tekst).toBe(200);
    const q = start.json.questions[0];
    expect(q.questionType).toBe("multiple");
    expect(JSON.stringify(start.json)).not.toMatch(/correct/i);
    const levert = await api("POST", `/api/modules/${tilstand.moduleId}/mcq/submit`, { submissionId, attemptId: start.json.attemptId, responses: [{ questionId: q.id, selectedAnswers: valg }] });
    expect(levert.status, levert.tekst).toBe(200);
    return { submissionId, levert: levert.json };
  };

  const riktig = await forsøk(["Formål", "Behandlingsgrunnlag"]);
  const gjennomgang = await api("GET", `/api/submissions/${riktig.submissionId}/mcq-review?locale=nb`);
  expect(gjennomgang.status, gjennomgang.tekst).toBe(200);
  const rad = gjennomgang.json.questions[0];
  noter("riktig mengde gir riktig", rad.isCorrect);
  expect(rad).toMatchObject({ questionType: "multiple", isCorrect: true, selectedAnswers: ["Formål", "Behandlingsgrunnlag"], correctAnswers: ["Formål", "Behandlingsgrunnlag"] });

  const forMange = await forsøk(["Formål", "Behandlingsgrunnlag", "Farge"]);
  const galt = await api("GET", `/api/submissions/${forMange.submissionId}/mcq-review?locale=nb`);
  noter("én for mye gir galt", galt.json.questions?.[0]?.isCorrect);
  expect(galt.json.questions[0].isCorrect).toBe(false);
});

// 2.99.1 (produkteier): alle alternativene kan være riktige. Før avviste tjeneren det, og Rediger viste
// bare «noe i skjemaet mangler».
test("2.99.1: et «velg alle» der alle er riktige lagres; bare alle valgt gir riktig", async () => {
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 1077 alle ${Date.now()}`, `Stage-test 1077 alle ${Date.now()}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst).toBe(201);
  tilstand.moduleIdAlle = modul.json.module.id;
  const sett = await api("POST", `/api/admin/content/modules/${tilstand.moduleIdAlle}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [{ ...flere, correctAnswers: [A, B, C, D] }] });
  noter("alle riktige tas imot", sett.status);
  expect(sett.status, sett.tekst).toBe(201);
  const versjon = await api("POST", `/api/admin/content/modules/${tilstand.moduleIdAlle}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 60 }, mcq: { reviewAfterSubmit: true } },
  });
  expect(versjon.status, versjon.tekst).toBe(201);
  const publisert = await api("POST", `/api/admin/content/modules/${tilstand.moduleIdAlle}/module-versions/${versjon.json.moduleVersion.id}/publish`, {});
  expect([200, 201]).toContain(publisert.status);

  const riktigSvar = async (valg: string[]) => {
    const innlevering = await api("POST", "/api/submissions", { moduleId: tilstand.moduleIdAlle, deliveryType: "text", responseJson: {} });
    expect(innlevering.status, innlevering.tekst).toBe(201);
    const submissionId = innlevering.json.submission.id as string;
    const start = await api("GET", `/api/modules/${tilstand.moduleIdAlle}/mcq/start?submissionId=${submissionId}&locale=nb`);
    expect(start.status, start.tekst).toBe(200);
    const levert = await api("POST", `/api/modules/${tilstand.moduleIdAlle}/mcq/submit`, { submissionId, attemptId: start.json.attemptId, responses: [{ questionId: start.json.questions[0].id, selectedAnswers: valg }] });
    expect(levert.status, levert.tekst).toBe(200);
    const gjennomgang = await api("GET", `/api/submissions/${submissionId}/mcq-review?locale=nb`);
    expect(gjennomgang.status, gjennomgang.tekst).toBe(200);
    return gjennomgang.json.questions[0].isCorrect;
  };
  const alle = await riktigSvar(["Formål", "Farge", "Behandlingsgrunnlag", "Skrifttype"]);
  noter("alle fire valgt gir riktig", alle);
  expect(alle).toBe(true);
  const tre = await riktigSvar(["Formål", "Farge", "Behandlingsgrunnlag"]);
  noter("tre av fire gir galt", tre);
  expect(tre).toBe(false);
});

test("#1073: en figur som går i løkke, avvises av den ekte rensingen — også skrevet <STYLE>", async () => {
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`Stage-test 1073 ${Date.now()}`, `Stage-test 1073 ${Date.now()}`), bodyMarkdown: L("Test", "Test"), draft: true });
  expect(seksjon.status, seksjon.tekst).toBe(201);
  tilstand.sectionId = seksjon.json.section?.id ?? seksjon.json.sectionId;
  expect(tilstand.sectionId).toBeTruthy();

  const last = async (svg: string, navn: string) => {
    await vent();
    const skjema = new FormData();
    skjema.append("file", new Blob([svg], { type: "image/svg+xml" }), navn);
    const svar = await fetch(`${BASE}/api/admin/content/sections/${tilstand.sectionId}/assets`, { method: "POST", headers: hoder(), body: skjema });
    return { status: svar.status, tekst: await svar.text() };
  };
  for (const tag of ["style", "STYLE"]) {
    const svar = await last(`<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><${tag}>.a { animation: x 2s infinite; } @keyframes x { to { opacity: 0.5; } }</${tag}><rect class="a" width="50" height="20" fill="#eef"/></svg>`, "loekke.svg");
    noter(`løkke <${tag}> avvist`, svar.status);
    expect(svar.status).toBeGreaterThanOrEqual(400);
    expect(svar.tekst).toContain("asset_svg_motion_not_allowed");
  }
  // Kontroll: en stillestående figur tas imot.
  const stille = await last(`<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><rect width="50" height="20" fill="#eef"/></svg>`, "stille.svg");
  expect(stille.status, stille.tekst).toBe(201);
});

test("2.98.2: en kopiert figur med to oppsett svarer med bredden på det brede", async () => {
  // Bruker et ekte kurs fra prod-kopien: første seksjonsfigur som har et smalt oppsett.
  // Opptil 40 seksjoner og figurene deres, med pause mellom hvert kall (pace.js): 45 s holdt ikke
  // da stage hadde flere seksjoner uten smalt oppsett først (2026-10-25).
  test.setTimeout(240_000);
  const seksjoner = await api("GET", "/api/admin/content/sections");
  test.skip(seksjoner.status !== 200, "kunne ikke liste seksjoner");
  let funnet = false;
  for (const s of (seksjoner.json.sections ?? []).slice(0, 40)) {
    const figurer = await api("GET", `/api/admin/content/sections/${s.id}/assets`);
    for (const f of figurer.json.assets ?? []) {
      await vent();
      const svar = await fetch(`${BASE}/api/content-assets/${f.id}?layout=narrow`, { headers: hoder() });
      if ((svar.headers.get("x-asset-layouts") ?? "").includes("narrow")) {
        noter("X-Asset-Wide-Width", svar.headers.get("x-asset-wide-width"));
        expect(Number(svar.headers.get("x-asset-wide-width"))).toBeGreaterThan(0);
        expect(svar.status).toBe(200);
        funnet = true;
        break;
      }
    }
    if (funnet) break;
  }
  test.skip(!funnet, "fant ingen figur med smalt oppsett blant de første 40 seksjonene");
});

test.afterAll(async () => {
  for (const moduleId of [tilstand.moduleId, tilstand.moduleIdAlle]) {
    if (!moduleId) continue;
    // En publisert modul med innleveringer kan ikke slettes; da arkiveres den, så den ikke står i lista.
    const slettet = await api("DELETE", `/api/admin/content/modules/${moduleId}`);
    noter("slett testmodul", slettet.status);
    if (slettet.status !== 200) noter("arkiver testmodul", (await api("POST", `/api/admin/content/modules/${moduleId}/archive`, {})).status);
  }
  if (tilstand.sectionId) noter("slett testseksjon", (await api("DELETE", `/api/admin/content/sections/${tilstand.sectionId}`)).status);
});
