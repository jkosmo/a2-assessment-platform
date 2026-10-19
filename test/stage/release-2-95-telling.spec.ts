import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.95.0 mot UTRULLET stage: «Fullføring per modul» teller personer, ikke forsøk.
//
// Tallene sammenlignes med deltakerdetaljene for hver modul — én rad per person, siste forsøk. Det er
// to uavhengige veier til samme svar: modulraden teller i én løkke, detaljene lister personene.
// Testen skriver ingenting, og funnene skriver bare tall.
//
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` og skal ALDRI logges eller skrives ut.

const lokal = process.env.STAGE_LOKAL ?? "";
const { auth, reason } = lokal ? { auth: null, reason: "" } : readAuth();
const BASE = lokal || stageBaseUrl(auth);
const LOKALE_HODER = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin", "x-user-roles": "ADMINISTRATOR" };
const hoder = (): Record<string, string> => (lokal ? LOKALE_HODER : { authorization: `Bearer ${auth!.accessToken}` });

test.skip(!lokal && !auth, `hopper over: ${reason}`);

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.95 telling", hva, verdi: String(verdi) })}\n`, "utf8");
};

async function api(sti: string): Promise<{ status: number; json: Record<string, any> }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, { headers: { ...hoder(), "x-locale": "nb" } });
  const tekst = await svar.text();
  let json: Record<string, any> = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json };
}

test("modulradene teller én gang per person, og stemmer med deltakerdetaljene", async () => {
  test.setTimeout(180000);
  const fullføring = await api("/api/reports/completion");
  const bestått = await api("/api/reports/pass-rates");
  expect(fullføring.status).toBe(200);
  expect(bestått.status).toBe(200);
  const rader: Array<Record<string, any>> = fullføring.json.rows ?? [];
  // ⚠️ KONTROLL: uten rader er alle påstandene under sanne uten å måle noe.
  expect(rader.length, "stage skal ha moduler med innleveringer").toBeGreaterThan(0);
  const beståttPerModul = new Map<string, Record<string, any>>((bestått.json.rows ?? []).map((r: Record<string, any>) => [r.moduleId, r]));

  let omtak = 0;
  for (const rad of rader) {
    expect(typeof rad.attempts, `${rad.moduleId}: forsøk mangler`).toBe("number");
    expect(rad.attempts).toBeGreaterThanOrEqual(rad.totalSubmissions);
    if (rad.attempts > rad.totalSubmissions) omtak += 1;

    const detaljer = await api(`/api/reports/completion/details?selectedModuleId=${encodeURIComponent(rad.moduleId)}`);
    expect(detaljer.status).toBe(200);
    const t = detaljer.json.totals;
    expect(rad.totalSubmissions, `${rad.moduleId}: deltakere`).toBe(t.learners);
    const b = beståttPerModul.get(rad.moduleId);
    expect(b, `${rad.moduleId}: mangler i bestått-rapporten`).toBeTruthy();
    expect(b!.totalSubmissions, `${rad.moduleId}: deltakere i bestått-rapporten`).toBe(t.learners);
    expect(b!.passCount, `${rad.moduleId}: bestått`).toBe(t.passed);
    expect(b!.failCount, `${rad.moduleId}: ikke bestått`).toBe(t.failed);
  }
  noter("moduler", rader.length);
  noter("moduler der noen har tatt modulen på nytt", omtak);
  noter("deltakere / forsøk totalt", `${fullføring.json.totals?.totalSubmissions} / ${fullføring.json.totals?.attempts}`);
});
