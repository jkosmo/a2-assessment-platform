import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.111.0 mot UTRULLET stage (inneholder 2.110.0): #1122, kriterier som ikke beskriver skalaen — varsel,
// ikke stopp. Ny rubrikkversjon og lagring i redigeringsverktøyet går gjennom, og svaret bærer funnene;
// beskrevne trinn gir ingen funn.
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
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.111.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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

const tre = (nb: string) => ({ nb, nn: nb, "en-GB": nb });
const tilstand: { moduleId?: string } = {};

test("versjonen er 2.111.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.111.0");
});

test("ny rubrikkversjon: én linje gir funn, beskrevne trinn gir ingen", async () => {
  test.setTimeout(120_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: tre(`Stage-test 1122 kriterier ${Date.now()}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst).toBe(201);
  tilstand.moduleId = modul.json.module.id;
  const svak = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/rubric-versions`, { criteria: { funn: "0-4: Komplette funn." }, scalingRule: { practical_weight: 70, max_total: 4 } });
  expect(svak.status, svak.tekst).toBe(201);
  noter("én linje: funn", svak.json.rubricWarnings);
  expect(svak.json.rubricWarnings).toEqual([{ code: "scale_not_described", criterion: "funn" }]);
  const god = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/rubric-versions`, { criteria: { funn: "0–2: 0 = ingen funn; 1 = funn uten kilde; 2 = komplette, sporbare funn" }, scalingRule: { practical_weight: 70, max_total: 2 } });
  noter("beskrevne trinn: funn", god.json.rubricWarnings);
  expect(god.json.rubricWarnings).toEqual([]);
});

test("lagring med kriteriene i samme lagring: lagres, og svaret bærer funnet", async () => {
  test.setTimeout(120_000);
  const svar = await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/versions`, {
    assessmentMode: "FREETEXT_ONLY",
    taskText: tre("Vurder restrisikoen i saken og begrunn."),
    assessorExpectedContent: tre("Nevner tiltak og gjenstående risiko."),
    rubric: { criteria: { vurdering: "0-4: God vurdering.", begrunnelse: "0–2: 0 = ingen; 1 = delvis; 2 = full begrunnelse" }, scalingRule: { practical_weight: 100, max_total: 6 } },
    promptTemplate: { systemPrompt: tre("Sys"), userPromptTemplate: tre("Eval") },
  });
  expect(svar.status, svar.tekst).toBe(201);
  noter("lagring: funn", svar.json.rubricWarnings);
  expect(svar.json.rubricWarnings).toEqual([{ code: "scale_not_described", criterion: "vurdering" }]);
});

test.afterAll(async () => {
  if (!tilstand.moduleId) return;
  const slettet = await api("DELETE", `/api/admin/content/modules/${tilstand.moduleId}`);
  noter("slett modul", slettet.status);
  if (slettet.status !== 200) noter("arkiver modul", (await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/archive`, {})).status);
});
