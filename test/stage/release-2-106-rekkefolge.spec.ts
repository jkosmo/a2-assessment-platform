import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.106.0 mot UTRULLET stage: #1077 leveranse 2a, «sett i riktig rekkefølge». Lagres med typen og
// elementene i riktig rekkefølge, avvises med for få elementer, eksporteres med typen, leveres stokket
// (aldri i riktig rekkefølge), rettes som rett eller galt, vises i gjennomgangen med begge rekkefølgene,
// og KI-revisjon av et slikt sett stoppes (til leveranse 2b).
//
// Det testen skriver på stage: én modul med navn som begynner på «Stage-test», slettet eller arkivert
// til slutt. Ingen språkmodell kalles.
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
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.106.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
const STEG = [L("Receive", "Motta"), L("Assess", "Vurdere"), L("Decide", "Avgjøre"), L("Archive", "Arkivere")];
const NB = ["Motta", "Vurdere", "Avgjøre", "Arkivere"];
const rekkefølge = { questionType: "order", stem: L("Put the steps in order.", "Sett stegene i rekkefølge."), options: STEG, rationale: L("Receive first.", "Motta først.") };
const tilstand: { moduleId?: string; versionId?: string } = {};

test("versjonen er 2.106.1", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.106.1");
});

test("lagres med typen; for få elementer avvises; eksporten har typen og rekkefølgen", async () => {
  test.setTimeout(120_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 1077 order ${Date.now()}`, `Stage-test 1077 rekkefølge ${Date.now()}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst).toBe(201);
  tilstand.moduleId = modul.json.module.id;

  const forFå = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [{ ...rekkefølge, options: STEG.slice(0, 2) }] });
  noter("to elementer avvises", forFå.status);
  expect(forFå.status).toBe(400);

  const sett = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/mcq-set-versions`, { title: L("Set", "Sett"), questions: [rekkefølge] });
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
  expect(spørsmål).toMatchObject({ questionType: "order", options: STEG });
});

test("leveres stokket, rettes som rett eller galt, og gjennomgangen viser begge rekkefølgene", async () => {
  test.setTimeout(180_000);
  const publisert = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/module-versions/${tilstand.versionId}/publish`, {});
  expect([200, 201]).toContain(publisert.status);

  const forsøk = async (svar: (stokket: string[]) => string[]) => {
    const innlevering = await api("POST", "/api/submissions", { moduleId: tilstand.moduleId, deliveryType: "text", responseJson: {} });
    expect(innlevering.status, innlevering.tekst).toBe(201);
    const submissionId = innlevering.json.submission.id as string;
    const start = await api("GET", `/api/modules/${tilstand.moduleId}/mcq/start?submissionId=${submissionId}&locale=nb`);
    expect(start.status, start.tekst).toBe(200);
    const q = start.json.questions[0];
    expect(q.questionType).toBe("order");
    expect([...q.options].sort()).toEqual([...NB].sort());
    expect(q.options, "aldri levert i riktig rekkefølge").not.toEqual(NB);
    const levert = await api("POST", `/api/modules/${tilstand.moduleId}/mcq/submit`, { submissionId, attemptId: start.json.attemptId, responses: [{ questionId: q.id, orderedAnswers: svar(q.options) }] });
    expect(levert.status, levert.tekst).toBe(200);
    const gjennomgang = await api("GET", `/api/submissions/${submissionId}/mcq-review?locale=nb`);
    expect(gjennomgang.status, gjennomgang.tekst).toBe(200);
    return { levert: levert.json, rad: gjennomgang.json.questions[0] };
  };

  const riktig = await forsøk(() => NB);
  noter("riktig rekkefølge", riktig.rad.isCorrect);
  expect(riktig.rad).toMatchObject({ questionType: "order", isCorrect: true, correctOrder: NB, selectedOrder: NB });

  const stokket = await forsøk((levertSom) => levertSom);
  noter("levert rekkefølge urørt gir galt", stokket.rad.isCorrect);
  expect(stokket.rad.isCorrect).toBe(false);
  expect(stokket.rad.correctOrder).toEqual(NB);
});

test("KI-revisjon av et sett med «sett i rekkefølge» stoppes med en egen kode", async () => {
  const svar = await api("POST", "/api/admin/content/generate/mcq/revise", {
    instruction: "Gjør spørsmålene vanskeligere",
    locale: "nb",
    questions: [{ questionType: "order", stem: "Sett i rekkefølge", options: NB, correctAnswer: NB[0], rationale: "Fordi." }],
  });
  noter("revisjon", `${svar.status} ${svar.json.error}`);
  expect(svar.status).toBe(400);
  expect(svar.json.error).toBe("mcq_revision_order_unsupported");
});

test.afterAll(async () => {
  if (!tilstand.moduleId) return;
  const slettet = await api("DELETE", `/api/admin/content/modules/${tilstand.moduleId}`);
  noter("slett testmodul", slettet.status);
  if (slettet.status !== 200) noter("arkiver testmodul", (await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/archive`, {})).status);
});
