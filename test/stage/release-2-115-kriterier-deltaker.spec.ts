import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.115.0 mot UTRULLET stage: #1124 del 1 og #1136. Deltakerens modulvisning bærer kriteriene (synlige,
// med trinn) og aldri fasiten; resultatet bærer poeng per kriterium på kriteriets egen skala, uten
// begrunnelsen for et skjult kriterium; GET /api/submissions/:id bærer verken fasiten eller KI-svaret.
//
// Det testen skriver på stage: én modul «Stage-test 1124» og én innlevering; modulen arkiveres til
// slutt. Kaller stage-appens språkmodell én gang.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.115.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { authorization: `Bearer ${auth!.accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const tre = (nb: string) => ({ nb, nn: nb, "en-GB": nb });
const FASIT = "FASIT-1124: vedtaket først, Ola innen 1. november, lokale uklart.";
const tilstand: { moduleId?: string; submissionId?: string } = {};

test("versjonen er 2.115.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.115.0");
});

test("deltakerens modul bærer de synlige kriteriene med trinn — og aldri fasiten", async () => {
  test.setTimeout(120_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: tre(`Stage-test 1124 ${Date.now()}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst).toBe(201);
  tilstand.moduleId = modul.json.module.id;
  const lagret = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/versions`, {
    assessmentMode: "FREETEXT_ONLY",
    taskText: tre("Skriv referatet fra styremøtet ut fra notatene: Kari, Ola, Siri. Budsjettet godkjent. Ola sender til revisor innen 1. november. Ikke avklart hvem som bestiller lokale."),
    assessorExpectedContent: tre(FASIT),
    rubric: {
      criteria: {
        vedtak: { label: tre("Vedtakene"), description: tre("0 = mangler; 1 = blandet med diskusjonen; 2 = først og presist"), maxScore: 2 },
        skjult: { label: tre("Skjult kriterium"), description: tre("0 = nei; 1 = delvis; 2 = ja"), maxScore: 2, candidateVisible: false },
      },
      scalingRule: { practical_weight: 100, max_total: 8 },
    },
    promptTemplate: { systemPrompt: tre("Du er sensor."), userPromptTemplate: tre("Vurder referatet.") },
    assessmentPolicy: { passRules: { totalMin: 50 } },
  });
  expect(lagret.status, lagret.tekst).toBe(201);
  const pub = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/module-versions/${lagret.json.moduleVersion.id}/publish`, {});
  expect([200, 201], pub.tekst).toContain(pub.status);

  const vist = await api("GET", `/api/modules/${tilstand.moduleId}?locale=nb`);
  expect(vist.status, vist.tekst).toBe(200);
  noter("kriterier til deltakeren", vist.json.module?.assessmentCriteria ?? vist.json.assessmentCriteria);
  const kriterier = (vist.json.module?.assessmentCriteria ?? vist.json.assessmentCriteria) as Array<{ id: string; scaleMax: number; steps: unknown[] }>;
  expect(kriterier.map((k) => k.id)).toEqual(["vedtak"]);
  expect(kriterier[0]).toMatchObject({ scaleMax: 2 });
  expect(kriterier[0]!.steps).toHaveLength(3);
  expect(vist.tekst, "fasiten nådde modulvisningen").not.toContain("FASIT-1124");
});

test("resultatet: poeng per synlig kriterium på egen skala; innleveringen bærer ikke fasiten", async () => {
  test.setTimeout(300_000);
  const innlevering = await api("POST", "/api/submissions", { moduleId: tilstand.moduleId, deliveryType: "text", responseJson: { response: "Vedtak: Budsjettet ble godkjent.\nOppfølging: Ola sender til revisor innen 1. november. Lokale: uklart.\nTil stede: Kari, Ola, Siri." } });
  expect(innlevering.status, innlevering.tekst).toBe(201);
  tilstand.submissionId = innlevering.json.submission.id;
  let kjør = await api("POST", `/api/assessments/${tilstand.submissionId}/run`, {});
  for (let i = 0; kjør.status === 429 && i < 5; i++) {
    await new Promise((r) => setTimeout(r, ((kjør.json?.details?.retryAfterSeconds ?? 30) + 2) * 1000));
    kjør = await api("POST", `/api/assessments/${tilstand.submissionId}/run`, {});
  }
  expect([200, 201, 202], kjør.tekst).toContain(kjør.status);
  let resultat: any = null;
  for (let i = 0; i < 60 && !resultat; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await api("GET", `/api/submissions/${tilstand.submissionId}/result?locale=nb`);
    if (r.status === 200 && r.json?.decision) resultat = r.json;
  }
  expect(resultat, "ingen avgjørelse innen 5 min").not.toBeNull();
  const g = resultat.participantGuidance;
  noter("poeng per kriterium", g.criterionScores);
  expect((g.criterionScores as Array<{ id: string; maxScore: number }>).map((s) => s.id)).toEqual(["vedtak"]);
  expect(g.criterionScores[0].maxScore).toBe(2);
  expect(Object.keys(g.criterionRationales ?? {})).not.toContain("skjult");
  expect(g.finalDecisionByAssessor).toBe(false);

  const egen = await api("GET", `/api/submissions/${tilstand.submissionId}`);
  expect(egen.status, egen.tekst).toBe(200);
  noter("innleveringens nøkler", Object.keys(egen.json.submission ?? {}));
  expect(egen.json.submission).not.toHaveProperty("moduleVersion");
  expect(egen.json.submission).not.toHaveProperty("llmEvaluations");
  expect(egen.tekst, "fasiten nådde innleveringen").not.toContain("FASIT-1124");
});

test.afterAll(async () => {
  if (tilstand.moduleId) noter("arkiver modul", (await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/archive`, {})).status);
});
