import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// #1135: MÅLING, ikke en utgivelsestest. Samme tre svar vurderes av KI på stage FØR og ETTER at
// vurdereren får kriterienes beskrivelse. Kjøres med MAAL_1135=før eller MAAL_1135=etter; modulen fra
// første kjøring gjenbrukes (id i test-results/stage-rapport/maal-1135-modul.json), så bare prompten
// skiller de to. Resultatet skrives til test-results/stage-rapport/maal-1135-<før|etter>.json.
//
// Det testen skriver på stage: én modul «Stage-test 1135 vurdering» og seks innleveringer. Modulen
// arkiveres etter «etter»-kjøringen. Kaller stage-appens språkmodell 6 ganger per kjøring.
// ⚠️ Tokenet leses fra den gitignorerte `.stage-service-auth.json` og skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const FASE = process.env.MAAL_1135 ?? "";
test.skip(!auth || !["før", "etter", "etter2", "etter3", "temp0", "etter4"].includes(FASE), `hopper over: ${reason ?? "sett MAAL_1135=før|etter|etter2"}`);

// Utenfor test-results: Playwright tømmer den mappa ved hver kjøring, og «etter» trenger modulen fra «før».
const RAPPORT = process.env.MAAL_1135_DIR ?? path.resolve(process.cwd(), ".stage-maal");
const MODULFIL = path.join(RAPPORT, "maal-1135-modul.json");

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
const OPPGAVE = "KI har laget et utkast til referat fra styremøtet. Notatene dine sier: Til stede Kari, Ola, Siri. Budsjettet godkjent. Ola sender budsjettet til revisor innen 1. november. Ikke avklart hvem som bestiller lokale. Skriv det ferdige referatet: vedtak først, så oppfølgingspunkter med ansvarlig og frist.";
const KRITERIER = {
  vedtak: { label: tre("Vedtakene"), description: tre("0 = vedtakene mangler eller er feil; 1 = vedtakene står der, men blandet med diskusjonen; 2 = vedtakene står først, presist og hver for seg"), maxScore: 2 },
  oppfolging: { label: tre("Oppfølgingen"), description: tre("0 = ingen oppfølgingspunkter; 1 = punktene står der, men uten ansvarlig eller frist; 2 = hvert punkt har ansvarlig og frist"), maxScore: 2 },
  kontroll: { label: tre("Kontroll mot notatene"), description: tre("0 = feil fra utkastet står igjen; 1 = noen feil er rettet; 2 = alt stemmer med notatene, og det som ikke er avklart står som «uklart»"), maxScore: 2 },
};
const SVAR: Record<string, string> = {
  sterkt: "Vedtak: Budsjettet ble godkjent.\nOppfølging: Ola sender budsjettet til revisor innen 1. november. Hvem som bestiller lokale: uklart, tas opp på neste møte.\nTil stede: Kari, Ola, Siri.",
  halvt: "Vi snakket om budsjettet og ble enige om å godkjenne det. Ola sender budsjettet til revisor. Kari bestiller lokale. Til stede: Kari, Ola, Siri og Per.",
  svakt: "Møtet gikk greit. Vi diskuterte flere saker og skal følge opp senere.",
};
const GANGER = Number(process.env.MAAL_1135_GANGER ?? 2);

test("vurder de tre svarene", async () => {
  test.setTimeout(2_700_000);
  fs.mkdirSync(RAPPORT, { recursive: true });
  let moduleId: string;
  // «etter» uten modulfil: finn modulen «før» laget, på tittelen (den nyeste, om det er flere).
  if (!fs.existsSync(MODULFIL) && FASE === "etter" && process.env.MAAL_1135_FINN) {
    const liste = await api("GET", "/api/admin/content/modules");
    const moduler = (liste.json.modules ?? liste.json ?? []) as Array<{ id: string; title: unknown; createdAt?: string }>;
    const tittel = (t: unknown) => (typeof t === "string" ? t : (t as { nb?: string })?.nb ?? "");
    const treff = moduler.filter((m) => tittel(m.title).startsWith("Stage-test 1135 vurdering")).sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    expect(treff.length, `fant ingen modul «Stage-test 1135 vurdering» (status ${liste.status})`).toBeGreaterThan(0);
    fs.writeFileSync(MODULFIL, JSON.stringify({ moduleId: treff[0]!.id, funnet: treff.length }), "utf8");
  }
  if (fs.existsSync(MODULFIL)) {
    moduleId = JSON.parse(fs.readFileSync(MODULFIL, "utf8")).moduleId;
  } else {
    const modul = await api("POST", "/api/admin/content/modules", { title: tre(`Stage-test 1135 vurdering ${Date.now()}`), certificationLevel: "basic" });
    expect(modul.status, modul.tekst).toBe(201);
    moduleId = modul.json.module.id;
    const lagret = await api("POST", `/api/admin/content/modules/${moduleId}/versions`, {
      assessmentMode: "FREETEXT_ONLY",
      taskText: tre(OPPGAVE),
      assessorExpectedContent: tre("Vedtaket om budsjettet først. Ola sender til revisor innen 1. november. Lokale: uklart. Til stede Kari, Ola, Siri — ikke Per."),
      rubric: { criteria: KRITERIER, scalingRule: { practical_weight: 100, max_total: 12 } },
      promptTemplate: { systemPrompt: tre("Du er sensor for et kurs i møtereferater."), userPromptTemplate: tre("Vurder referatet mot kriteriene.") },
      assessmentPolicy: { passRules: { totalMin: 50 } },
    });
    expect(lagret.status, lagret.tekst).toBe(201);
    const pub = await api("POST", `/api/admin/content/modules/${moduleId}/module-versions/${lagret.json.moduleVersion.id}/publish`, {});
    expect([200, 201], pub.tekst).toContain(pub.status);
    fs.writeFileSync(MODULFIL, JSON.stringify({ moduleId }), "utf8");
  }

  const resultater: Array<Record<string, unknown>> = [];
  for (const [navn, tekst] of Object.entries(SVAR)) {
    for (let i = 0; i < GANGER; i++) {
      const innlevering = await api("POST", "/api/submissions", { moduleId, deliveryType: "text", responseJson: { response: tekst } });
      expect(innlevering.status, innlevering.tekst).toBe(201);
      const id = innlevering.json.submission.id as string;
      // Som deltakersiden: vurderingen startes i et eget steg (participant.js, /api/assessments/:id/run).
      // Ruta har en fartsgrense (assessmentRunLimiter): ved 429 ventes det så lenge svaret sier.
      let kjør = await api("POST", `/api/assessments/${id}/run`, {});
      for (let forsøk = 0; kjør.status === 429 && forsøk < 5; forsøk++) {
        await new Promise((r) => setTimeout(r, ((kjør.json?.details?.retryAfterSeconds ?? 30) + 2) * 1000));
        kjør = await api("POST", `/api/assessments/${id}/run`, {});
      }
      expect([200, 201, 202], kjør.tekst).toContain(kjør.status);
      let resultat: any = null;
      for (let forsøk = 0; forsøk < 60; forsøk++) {
        await new Promise((r) => setTimeout(r, 5000));
        const r = await api("GET", `/api/submissions/${id}/result?locale=nb`);
        if (process.env.MAAL_1135_PROBE) console.log("PROBE", r.status, JSON.stringify(r.json).slice(0, 400));
        if (r.status === 200 && r.json?.decision) { resultat = r.json; break; }
        if (process.env.MAAL_1135_PROBE && forsøk >= 5) break;
      }
      if (process.env.MAAL_1135_PROBE) return;
      resultater.push({
        svar: navn,
        gang: i + 1,
        totalScore: resultat?.scoreComponents?.totalScore ?? null,
        practical: resultat?.scoreComponents?.practicalScaledScore ?? null,
        bestått: resultat?.decision?.passFailTotal ?? resultat?.decision?.passed ?? null,
        begrunnelser: resultat?.participantGuidance?.criterionRationales ?? null,
        rå: resultat ? undefined : "ingen avgjørelse innen 5 min",
      });
      // Skrevet etter hvert svar: en kjøring som stopper underveis, mister ikke det som er målt.
      fs.writeFileSync(path.join(RAPPORT, `maal-1135-${FASE}.json`), JSON.stringify(resultater, null, 2), "utf8");
      console.log(`MAAL ${FASE} ${navn}#${i + 1}: total=${resultater.at(-1)!.totalScore}`);
    }
  }
  fs.writeFileSync(path.join(RAPPORT, `maal-1135-${FASE}.json`), JSON.stringify(resultater, null, 2), "utf8");
  for (const r of resultater) console.log(`MAAL ${FASE} ${r.svar}#${r.gang}: total=${r.totalScore} praktisk=${r.practical} bestått=${r.bestått}`);

  if (FASE !== "før") {
    const arkivert = await api("POST", `/api/admin/content/modules/${moduleId}/archive`, {});
    console.log("arkiver modul", arkivert.status);
  }
});
