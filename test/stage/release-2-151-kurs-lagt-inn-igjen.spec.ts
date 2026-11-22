import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon, sammenlignVersjon } from "./versjon.js";
import { vent } from "./pace.js";

// 2.151.0 mot UTRULLET stage: et kurs som fjernes fra en klasse og legges inn igjen, gir ny e-post (#1146,
// doc/design/PLAN_1146.md). Integrasjonstestene dekker reglene; dette er det som bare kan ses på ekte worker og ekte e-post.
//
// Tre kjøringer, fordi e-posten samles et kvarter etter siste endring:
//   1. Uten flagg: sjekker versjonen og jobben, lager klassen «Stage-test lagt inn igjen …», legger til kontoen som er logget
//      inn, og tildeler ett publisert kurs kontoen ikke har påbegynt, fullført eller har fra en klasse. E-post 1 («Du har fått
//      et nytt kurs») kommer om lag 15–17 minutter etter.
//   2. STAGE_1146_STEG=2, NÅR E-POST 1 ER SETT: fjerner kurset fra klassen og legger det inn igjen med frist 31. desember 2026.
//      E-post 2 skal komme om lag 15–17 minutter etter, om det samme kurset, med fristen. Nekter før klassen er 20 minutter
//      gammel (e-post 1 er ikke sendt ennå, og da blir det bare én e-post — riktig, men ikke det testen ser etter).
//   3. STAGE_1146_RYDD=1, NÅR E-POST 2 ER SETT: fjerner kurset og kontoen fra klassen, arkiverer og sletter den.
//
// `npm run stage:auth` (personlig konto) gir e-posten i din egen innboks. ⚠️ Tokenet skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const STEG2 = process.env.STAGE_1146_STEG === "2";
const RYDD = process.env.STAGE_1146_RYDD === "1";
const KLASSENAVN = "Stage-test lagt inn igjen";
const MINSTE_ALDER_MS = 20 * 60_000;
const FRIST = "2026-12-31T12:00:00.000Z";

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const LAGER = path.resolve(process.cwd(), ".tmp-stage-logs", "lagt-inn-igjen-2151.json");

const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.151.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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

function workerUrl(): string | null {
  if (process.env.STAGE_WORKER_URL) return process.env.STAGE_WORKER_URL.replace(/\/+$/, "");
  return BASE.includes("-app-") ? BASE.replace("-app-", "-worker-") : null;
}

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

const klokka = (d: Date) => d.toTimeString().slice(0, 5);
const lager = () => JSON.parse(fs.readFileSync(LAGER, "utf8")) as { klasseId: string; kursId: string; tittel: string; laget: string };

test.describe("1. oppsett (uten flagg)", () => {
  test.skip(STEG2 || RYDD, "steg 2 eller rydding denne gangen");

  test("app og worker kjører minst 2.151.0, og jobben er frisk", async () => {
    noter("versjon", await forventMinstVersjon(BASE, "2.151.0"));
    const adresse = workerUrl();
    test.skip(!adresse, "fant ikke workerens adresse: sett STAGE_WORKER_URL");
    const helse = (await (await fetch(adresse!)).json().catch(() => ({}))) as {
      version?: string;
      health?: { monitors?: Array<{ name: string; enabled: boolean; healthy: boolean; reason: string; lastSummary?: { asOf?: string; reset?: number } }> };
    };
    expect(sammenlignVersjon(helse.version ?? "0.0.0", "2.151.0"), `workeren er ${helse.version}`).toBeGreaterThanOrEqual(0);
    const jobben = helse.health?.monitors?.find((m) => m.name === "courseAssignmentEmailMonitor");
    noter("courseAssignmentEmailMonitor", jobben);
    expect(jobben?.enabled, "jobben er av").toBe(true);
    expect(jobben?.healthy, `jobben er ikke frisk: ${jobben?.reason}`).toBe(true);
  });

  test("en ny klasse med kontoen og ett kurs kontoen ikke har påbegynt, fullført eller har fra en klasse", async () => {
    const meg = await minId();
    const alle = await api("GET", "/api/admin/content/courses");
    expect(alle.status).toBe(200);
    const publiserte = (alle.json.courses as Array<{ id: string; displayTitle: string; publishedAt: string | null; archivedAt: string | null }>)
      .filter((k) => k.publishedAt && !k.archivedAt);
    const fullført = new Set(((await api("GET", "/api/courses/completions")).json.completions as Array<{ courseId: string }> ?? []).map((c) => c.courseId));
    const mine = (await api("GET", "/api/courses")).json.courses as Array<{ id: string; progress: { courseStatus: string } }> ?? [];
    const påbegynt = new Set(mine.filter((k) => k.progress?.courseStatus !== "NOT_STARTED").map((k) => k.id));
    const fraKlasse = new Set(((await api("GET", "/api/courses/enrollments")).json.enrollments as Array<{ courseId: string; source: string }> ?? [])
      .filter((e) => e.source === "CLASS").map((e) => e.courseId));
    const kandidater = publiserte.filter((k) => !fullført.has(k.id) && !påbegynt.has(k.id) && !fraKlasse.has(k.id));
    noter("kandidater", { publiserte: publiserte.length, igjen: kandidater.length });
    test.skip(kandidater.length < 1, "fant ingen publisert kurs kontoen ikke har påbegynt, fullført eller har fra en klasse");
    const kurs = kandidater[0]!;

    const ny = await api("POST", "/api/admin/content/classes", { name: `${KLASSENAVN} ${new Date().toISOString()}` });
    expect(ny.status, JSON.stringify(ny.json).slice(0, 300)).toBe(201);
    const klasseId = ny.json.class.id as string;
    fs.mkdirSync(path.dirname(LAGER), { recursive: true });
    fs.writeFileSync(LAGER, JSON.stringify({ klasseId, kursId: kurs.id, tittel: kurs.displayTitle, laget: new Date().toISOString() }));
    expect((await api("POST", `/api/admin/content/classes/${klasseId}/members`, { userId: meg })).status).toBe(201);
    expect((await api("POST", `/api/admin/content/classes/${klasseId}/courses`, { courseId: kurs.id })).status).toBe(201);

    const tidligst = new Date(Date.now() + 15 * 60_000);
    noter("manuell sjekk 1", `E-post 1 «Du har fått et nytt kurs: «${kurs.displayTitle}»» tidligst ${klokka(tidligst)}, uten frist. Kjør så STAGE_1146_STEG=2.`);
    console.log(`Klassen er laget med «${kurs.displayTitle}». E-post 1 kommer tidligst ${klokka(tidligst)}. Kjør så STAGE_1146_STEG=2.`);
  });
});

test.describe("2. lagt inn igjen (STAGE_1146_STEG=2, når e-post 1 er sett)", () => {
  test.skip(!STEG2, "bare med STAGE_1146_STEG=2");

  test("kurset fjernes fra klassen og legges inn igjen med frist", async () => {
    const l = lager();
    const alder = Date.now() - Date.parse(l.laget);
    if (alder < MINSTE_ALDER_MS && process.env.STAGE_1146_NÅ !== "1") {
      throw new Error(`klassen er bare ${Math.round(alder / 60_000)} min gammel; e-post 1 er trolig ikke sendt. Vent, eller sett STAGE_1146_NÅ=1.`);
    }
    expect((await api("DELETE", `/api/admin/content/classes/${l.klasseId}/courses/${l.kursId}`)).status).toBeLessThan(300);
    const igjen = await api("POST", `/api/admin/content/classes/${l.klasseId}/courses`, { courseId: l.kursId, dueAt: FRIST });
    expect(igjen.status, JSON.stringify(igjen.json).slice(0, 300)).toBe(201);
    const tidligst = new Date(Date.now() + 15 * 60_000);
    noter("manuell sjekk 2", `E-post 2 om «${l.tittel}» tidligst ${klokka(tidligst)}, med frist 31. desember 2026. Rydd så med STAGE_1146_RYDD=1.`);
    console.log(`Kurset er lagt inn igjen med frist. E-post 2 kommer tidligst ${klokka(tidligst)}. Rydd så med STAGE_1146_RYDD=1.`);
  });
});

test.describe("3. rydding (STAGE_1146_RYDD=1, når e-post 2 er sett)", () => {
  test.skip(!RYDD, "bare med STAGE_1146_RYDD=1");

  test("fjerner kurs og kontoen fra klassene «Stage-test lagt inn igjen …», arkiverer og sletter dem", async () => {
    const liste = await api("GET", "/api/admin/content/classes");
    expect(liste.status).toBe(200);
    const klasser = (liste.json.classes as Array<{ id: string; name: string; canManage?: boolean }>).filter((k) => k.name.startsWith(`${KLASSENAVN} `) && k.canManage !== false);
    test.skip(klasser.length === 0, "ingen klasser å rydde");
    for (const klasse of klasser) {
      const kurs = await api("GET", `/api/admin/content/classes/${klasse.id}/courses`);
      for (const k of (kurs.json.courses ?? []) as Array<{ courseId: string }>) {
        expect((await api("DELETE", `/api/admin/content/classes/${klasse.id}/courses/${k.courseId}`)).status).toBeLessThan(300);
      }
      const medlemmer = await api("GET", `/api/admin/content/classes/${klasse.id}/members`);
      for (const m of (medlemmer.json.members ?? []) as Array<{ userId: string }>) {
        expect((await api("DELETE", `/api/admin/content/classes/${klasse.id}/members/${m.userId}`)).status).toBeLessThan(300);
      }
      expect((await api("POST", `/api/admin/content/classes/${klasse.id}/archive`)).status).toBe(200);
      expect((await api("DELETE", `/api/admin/content/classes/${klasse.id}`)).status).toBeLessThan(300);
      noter("klassen slettet", klasse.id);
    }
    fs.rmSync(LAGER, { force: true });
  });
});
