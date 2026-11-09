import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon, sammenlignVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.147.0 mot UTRULLET stage: én samlet e-post når en deltaker får nye kurs fra en klasse (#1142, doc/design/PLAN_1142.md).
//
// To kjøringer, fordi e-posten samles et kvarter etter siste endring:
//   1. Uten flagg: sjekker versjonen og workerens jobb, lager klassen «Stage-test nye kurs …», legger til kontoen som er
//      logget inn, og tildeler to publiserte kurs kontoen ikke har påbegynt eller fullført. Klassen og kursene noteres i
//      test-results/stage-rapport/funn.jsonl, og i .tmp-stage-logs/ for ryddingen (Playwright tømmer test-results ved neste
//      kjøring). E-posten sjekkes for hånd i Outlook: den skal komme om lag 15–17 minutter etter, med begge kursene og én
//      lenke til «Mine kurs».
//   2. STAGE_1142_RYDD=1, NÅR E-POSTEN ER SETT: fjerner kursene og kontoen fra klassen, arkiverer og sletter den.
//      ⚠️ Rydder du før vinduet er ute, sendes e-posten aldri (sjekken før sending tar kursene ut). Ryddingen nekter derfor
//      klasser yngre enn 20 minutter, med mindre STAGE_1142_RYDD_NÅ=1.
//
// Integrasjonstestene dekker reglene; dette er det som bare kan ses på ekte worker og ekte e-post. Gir du `npm run
// stage:auth` (personlig konto), kommer e-posten til din egen innboks. Med stage-testkontoen kommer den til dens innboks.
// ⚠️ Tokenet skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const RYDD = process.env.STAGE_1142_RYDD === "1";
const KLASSENAVN = "Stage-test nye kurs";
/** Ryddingen venter så lenge etter at klassen ble laget: vinduet er 15 min, jobben går hvert minutt, og spredningen legger litt på. */
const MINSTE_ALDER_FØR_RYDDING_MS = 20 * 60_000;

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
// Ikke i test-results: Playwright tømmer den mappa ved neste kjøring, og da finner ikke ryddingen noe.
const LAGER = path.resolve(process.cwd(), ".tmp-stage-logs", "nye-kurs-2147.json");

const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.147.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { authorization: `Bearer ${auth!.accessToken}`, "x-locale": "nb", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: svar.status, json: await svar.json().catch(() => ({})) };
}

/**
 * Workerens adresse. Ingen egen adresse i repoet: den følger navneregelen i infra/azure/main.bicep (`…-<miljø>-app-…` og
 * `…-<miljø>-worker-…`), eller STAGE_WORKER_URL. Workeren svarer med helsesvaret på alle stier.
 */
function workerUrl(): string | null {
  if (process.env.STAGE_WORKER_URL) return process.env.STAGE_WORKER_URL.replace(/\/+$/, "");
  return BASE.includes("-app-") ? BASE.replace("-app-", "-worker-") : null;
}

/** Kontoens database-id: /api/me har den ikke, brukersøket har den. */
async function minId(): Promise<string> {
  const me = await api("GET", "/api/me");
  expect(me.status).toBe(200);
  const epost = String(me.json.user.email);
  const søk = await api("GET", `/api/admin/content/users/search?q=${encodeURIComponent(epost)}`);
  expect(søk.status, JSON.stringify(søk.json).slice(0, 300)).toBe(200);
  const id = (søk.json.users as Array<{ id: string; email: string }>).find((u) => u.email?.toLowerCase() === epost.toLowerCase())?.id ?? null;
  expect(id, "fant ikke kontoen i brukersøket").not.toBeNull();
  return id!;
}

test.describe("oppsett (uten STAGE_1142_RYDD)", () => {
  test.skip(RYDD, "rydder denne gangen");

  let klasseId: string | null = null;

  test("versjonen er minst 2.147.0", async () => {
    noter("versjon", await forventMinstVersjon(BASE, "2.147.0"));
  });

  test("workeren kjører 2.147.0 eller nyere, og jobben for nye kurs er frisk", async () => {
    const adresse = workerUrl();
    test.skip(!adresse, "fant ikke workerens adresse: sett STAGE_WORKER_URL");
    let svar: Response;
    try {
      svar = await fetch(adresse!);
    } catch (feil) {
      throw new Error(`workeren svarte ikke (${adresse}): ${feil instanceof Error ? feil.message : String(feil)}. Sett STAGE_WORKER_URL hvis navnet ikke følger navneregelen.`);
    }
    const helse = (await svar.json().catch(() => ({}))) as {
      version?: string;
      startedAt?: string;
      health?: { monitors?: Array<{ name: string; enabled: boolean; healthy: boolean; reason: string; lastSummary?: { asOf?: string } }> };
    };
    noter("worker", { status: svar.status, version: helse.version, startedAt: helse.startedAt });
    // Samme versjonssjekk som appen: en ny `startedAt` alene kan være en omstart av den gamle pakken.
    expect(helse.version, "workerens helsesvar har ingen versjon").toMatch(/^\d+\.\d+\.\d+$/);
    expect(sammenlignVersjon(helse.version!, "2.147.0"), `workeren er ${helse.version}, testen krever minst 2.147.0`).toBeGreaterThanOrEqual(0);

    const jobben = helse.health?.monitors?.find((m) => m.name === "courseAssignmentEmailMonitor");
    expect(jobben, "courseAssignmentEmailMonitor mangler i workerens helsesvar").toBeTruthy();
    noter("courseAssignmentEmailMonitor", jobben);
    expect(jobben!.enabled, "jobben er av: er PARTICIPANT_NOTIFICATION_CHANNEL=disabled på workeren?").toBe(true);
    expect(jobben!.healthy, `jobben er ikke frisk: ${jobben!.reason}`).toBe(true);
    // Siste runde: jobben går hvert minutt. Rett etter oppstart kan første runde mangle (helsesjekken gir 15 min nåde).
    const asOf = jobben!.lastSummary?.asOf ? Date.parse(jobben!.lastSummary.asOf) : Number.NaN;
    expect(Number.isFinite(asOf), "jobben har ikke fullført en runde ennå; kjør testen igjen om et par minutter").toBe(true);
    expect(Date.now() - asOf, "siste runde er over fem minutter gammel").toBeLessThan(5 * 60_000);
  });

  test("en ny klasse med kontoen og to publiserte kurs kontoen ikke har påbegynt eller fullført", async () => {
    const meg = await minId();

    // Publiserte kurs som ikke er arkivert.
    const alle = await api("GET", "/api/admin/content/courses");
    expect(alle.status).toBe(200);
    const publiserte = (alle.json.courses as Array<{ id: string; displayTitle: string; publishedAt: string | null; archivedAt: string | null }>)
      .filter((k) => k.publishedAt && !k.archivedAt);

    // Ut: fullførte, påbegynte («Mine kurs» sier IN_PROGRESS eller COMPLETED), og kurs kontoen alt har fra en klasse — de
    // har en rad fra før (`baseline` eller `sent`), og gir aldri e-post igjen.
    const fullført = new Set(((await api("GET", "/api/courses/completions")).json.completions as Array<{ courseId: string }> ?? []).map((c) => c.courseId));
    const mine = (await api("GET", "/api/courses")).json.courses as Array<{ id: string; progress: { courseStatus: string } }> ?? [];
    const påbegynt = new Set(mine.filter((k) => k.progress?.courseStatus !== "NOT_STARTED").map((k) => k.id));
    const fraKlasse = new Set(((await api("GET", "/api/courses/enrollments")).json.enrollments as Array<{ courseId: string; source: string }> ?? [])
      .filter((e) => e.source === "CLASS").map((e) => e.courseId));
    const kandidater = publiserte.filter((k) => !fullført.has(k.id) && !påbegynt.has(k.id) && !fraKlasse.has(k.id));
    noter("kandidater", { publiserte: publiserte.length, fullført: fullført.size, påbegynt: påbegynt.size, fraKlasse: fraKlasse.size, igjen: kandidater.length });
    test.skip(kandidater.length < 2, `fant ${kandidater.length} publiserte kurs kontoen ikke har påbegynt, fullført eller har fra en klasse; testen trenger to`);
    const kurs = kandidater.slice(0, 2);

    const ny = await api("POST", "/api/admin/content/classes", { name: `${KLASSENAVN} ${new Date().toISOString()}` });
    expect(ny.status, JSON.stringify(ny.json).slice(0, 300)).toBe(201);
    klasseId = ny.json.class.id as string;
    fs.mkdirSync(path.dirname(LAGER), { recursive: true });
    fs.writeFileSync(LAGER, JSON.stringify({ klasseId, kursIder: kurs.map((k) => k.id), meg, laget: new Date().toISOString() }));

    const medlem = await api("POST", `/api/admin/content/classes/${klasseId}/members`, { userId: meg });
    expect(medlem.status, JSON.stringify(medlem.json).slice(0, 300)).toBe(201);
    for (const k of kurs) {
      const tildelt = await api("POST", `/api/admin/content/classes/${klasseId}/courses`, { courseId: k.id });
      expect(tildelt.status, JSON.stringify(tildelt.json).slice(0, 300)).toBe(201);
    }

    const ferdig = new Date();
    const tidligst = new Date(ferdig.getTime() + 15 * 60_000);
    noter("klasse", klasseId);
    noter("kurs", kurs.map((k) => k.displayTitle));
    noter("manuell sjekk", `Se etter én e-post «Du har fått 2 nye kurs» i innboksen til kontoen, tidligst ${tidligst.toTimeString().slice(0, 5)} (om lag et kvarter etter ${ferdig.toTimeString().slice(0, 5)}). Begge kursene skal stå der, fra klassen «${KLASSENAVN} …», og én knapp «Åpne Mine kurs». Påbegynner du et av kursene før det, er det ikke med. Rydd etterpå med STAGE_1142_RYDD=1.`);
    console.log(`Klassen er laget, og to kurs er tildelt. E-posten kommer tidligst ${tidligst.toTimeString().slice(0, 5)}. Rydd etterpå med STAGE_1142_RYDD=1.`);
  });
});

test.describe("rydding (STAGE_1142_RYDD=1, når e-posten er sett)", () => {
  test.skip(!RYDD, "bare med STAGE_1142_RYDD=1, etter at e-posten er sett");

  test("fjerner kursene og kontoen fra klassene «Stage-test nye kurs …», arkiverer og sletter dem", async () => {
    // Klassene finnes på navnet, så også en kjøring som ikke fikk skrevet lagerfila, ryddes. Tidspunktet står i navnet.
    const liste = await api("GET", "/api/admin/content/classes");
    expect(liste.status).toBe(200);
    const klasser = (liste.json.classes as Array<{ id: string; name: string; canManage?: boolean }>).filter((k) => k.name.startsWith(`${KLASSENAVN} `) && k.canManage !== false);
    noter("klasser å rydde", klasser.length);
    test.skip(klasser.length === 0, `ingen klasser «${KLASSENAVN} …» å rydde`);

    for (const klasse of klasser) {
      const laget = Date.parse(klasse.name.slice(KLASSENAVN.length + 1));
      const alder = Number.isNaN(laget) ? Number.POSITIVE_INFINITY : Date.now() - laget;
      if (alder < MINSTE_ALDER_FØR_RYDDING_MS && process.env.STAGE_1142_RYDD_NÅ !== "1") {
        throw new Error(`klassen ${klasse.id} er bare ${Math.round(alder / 60_000)} min gammel. Rydding nå stopper e-posten. Vent, eller sett STAGE_1142_RYDD_NÅ=1.`);
      }
      const kurs = await api("GET", `/api/admin/content/classes/${klasse.id}/courses`);
      expect(kurs.status).toBe(200);
      for (const k of kurs.json.courses as Array<{ courseId: string }>) {
        expect((await api("DELETE", `/api/admin/content/classes/${klasse.id}/courses/${k.courseId}`)).status).toBeLessThan(300);
      }
      const medlemmer = await api("GET", `/api/admin/content/classes/${klasse.id}/members`);
      expect(medlemmer.status).toBe(200);
      for (const m of medlemmer.json.members as Array<{ userId: string }>) {
        expect((await api("DELETE", `/api/admin/content/classes/${klasse.id}/members/${m.userId}`)).status).toBeLessThan(300);
      }
      expect((await api("POST", `/api/admin/content/classes/${klasse.id}/archive`)).status).toBe(200);
      const slett = await api("DELETE", `/api/admin/content/classes/${klasse.id}`);
      expect(slett.status, JSON.stringify(slett.json).slice(0, 300)).toBeLessThan(300);
      noter("klassen slettet", { klasse: klasse.id, status: slett.status });
    }
    fs.rmSync(LAGER, { force: true });
  });
});
