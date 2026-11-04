import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// 2.127.0 mot UTRULLET stage: #934 skive 1 — kursbevis per hovedversjon. Migreringen la til versjonsfelt
// og en ny unik nøkkel ved siden av den gamle. Ingen flate er endret, så det som måles er at ingenting
// har gått i stykker med de ekte dataene:
//   - kursbevis som fantes før, listes fortsatt og kan åpnes;
//   - et nytt lesekurs som fullføres, gir nøyaktig ett bevis, og ikke et nytt ved neste fullføringssjekk.
//
// Det testen skriver på stage: én seksjon og ett kurs («Stage-test 2.127 …»), og ett kursbevis for
// testkontoen. Et kurs med kursbevis kan ikke slettes — det arkiveres. ⚠️ Tokenet leses fra den
// gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`) og skal ALDRI logges eller skrives ut.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.127.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};

async function api(metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { ...hoder(), "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = Date.now();
const tilstand: { kursId?: string; seksjonId?: string } = {};

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    noter("arkiver testkurs", (await api("POST", `/api/admin/content/courses/${tilstand.kursId}/archive`)).status);
  }
});

test("versjonen er 2.127.0", async () => {
  const json = await (await fetch(`${BASE}/version`)).json();
  noter("versjon", json.version);
  expect(json.version).toBe("2.127.0");
});

test("kursbevis som fantes før migreringen, listes og kan åpnes", async () => {
  const liste = await api("GET", "/api/courses/completions");
  expect(liste.status, liste.tekst.slice(0, 300)).toBe(200);
  const bevis = liste.json.completions as Array<{ courseId: string; certificateId: string }>;
  noter("antall bevis for testkontoen", bevis.length);
  const perKurs = new Map<string, number>();
  for (const b of bevis) perKurs.set(b.courseId, (perKurs.get(b.courseId) ?? 0) + 1);
  expect([...perKurs.values()].every((n) => n === 1), "høyst ett bevis per kurs").toBe(true);
  for (const b of bevis.slice(0, 3)) {
    const ett = await api("GET", `/api/courses/completions/${b.certificateId}`);
    expect(ett.status, ett.tekst.slice(0, 300)).toBe(200);
  }
});

test("et nytt lesekurs som fullføres, gir nøyaktig ett bevis — også etter en ny fullføringssjekk", async () => {
  test.setTimeout(150_000);
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`Stage-test 2.127 seksjon ${stempel}`), bodyMarkdown: L("Innhold.") });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  tilstand.seksjonId = seksjon.json.section.id;
  expect((await api("POST", `/api/admin/content/sections/${tilstand.seksjonId}/publish`)).status).toBe(200);
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.127 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "SECTION", sectionId: tilstand.seksjonId }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`)).status).toBe(200);

  const lest = await api("POST", `/api/courses/${tilstand.kursId}/sections/${tilstand.seksjonId}/read`, { sectionVersionId: (await api("GET", `/api/courses/${tilstand.kursId}/sections/${tilstand.seksjonId}`)).json.sectionVersionId });
  noter("marker lest", lest.status);
  expect([200, 201, 204]).toContain(lest.status);

  // To runder: listingen kjører også fullføringssjekken for alle kurs (reconcile).
  for (let i = 0; i < 2; i += 1) {
    const liste = await api("GET", "/api/courses/completions");
    const forKurset = (liste.json.completions as Array<{ courseId: string }>).filter((c) => c.courseId === tilstand.kursId);
    noter(`bevis for testkurset, runde ${i + 1}`, forKurset.length);
    expect(forKurset).toHaveLength(1);
  }
});
