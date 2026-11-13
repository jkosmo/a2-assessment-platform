import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.133.0 mot UTRULLET stage: #934 skive 5a-1 — deltakerlåsen, låst utstedelse, versjonen deltakeren så
// (doc/DESIGN_934.md, «5a-1»).
//   - `GET …/sections/:id` sender `sectionVersionId`, `GET /api/modules/:id` sender `activeVersion.id`;
//   - lesing og innlevering uten versjonen: 409 `client_outdated`, og ingenting er skrevet;
//   - lesing og innlevering med en eldre versjon: 409 `section_version_changed` / `module_version_changed`, og ingenting
//     er skrevet;
//   - med versjonen siden viste: 204 / 201. Siste lesing utsteder kursbeviset, og det gjelder kursets versjon;
//   - kursbevissiden svarer 200 etter utstedelsen, med ett bevis.
//
// Hva testen IKKE kan se: selve låsene og kappløpene (de krever at to transaksjoner holdes åpne). De er dekket av
// `test/m2-learner-lock-934-5a1.test.ts`. Prøv-igjen ved 503 og kladden etter en 409 er dekket av
// `test/e2e/participant-seen-version-934-5a1.spec.ts`.
//
// Det testen skriver på stage: to seksjoner, én modul og ett kurs («Stage-test 2.133 …»), to innleveringer og et kursbevis
// for testkontoen. Kurset og modulen arkiveres etterpå (beviset står; et utstedt bevis slettes aldri).
// ⚠️ Tokenet leses fra den gitignorerte `.stage-auth.json` (eller `.stage-service-auth.json`) og skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
const hoder = (): Record<string, string> => ({ authorization: `Bearer ${auth!.accessToken}` });

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.133.0", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
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
const tilstand: { kursId?: string; moduleId?: string; seksjoner: string[] } = { seksjoner: [] };

async function lagSeksjon(navn: string) {
  const seksjon = await api("POST", "/api/admin/content/sections", { title: L(`Stage-test 2.133 ${navn} ${stempel}`), bodyMarkdown: L(`Innhold ${navn}.`) });
  expect(seksjon.status, seksjon.tekst.slice(0, 300)).toBe(201);
  const id = seksjon.json.section.id as string;
  expect((await api("POST", `/api/admin/content/sections/${id}/publish`)).status).toBe(200);
  tilstand.seksjoner.push(id);
  return id;
}

async function publiserModulversjon(moduleId: string, oppgavenavn: string) {
  const sett = await api("POST", `/api/admin/content/modules/${moduleId}/mcq-set-versions`, {
    title: L("Sett"),
    questions: [{ stem: L(`Hva er riktig i ${oppgavenavn}?`), options: [L("Riktig"), L("Galt")], correctAnswer: L("Riktig"), rationale: L("Fordi.") }],
  });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await api("POST", `/api/admin/content/modules/${moduleId}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 }, mcq: { reviewAfterSubmit: true, shuffleQuestions: false } },
  });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  const publisert = await api("POST", `/api/admin/content/modules/${moduleId}/module-versions/${versjon.json.moduleVersion.id}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 300)).toContain(publisert.status);
  return versjon.json.moduleVersion.id as string;
}

test.afterAll(async () => {
  if (tilstand.kursId) {
    await api("POST", `/api/admin/content/courses/${tilstand.kursId}/unpublish`);
    noter("arkiver testkurs", (await arkiverKurs(api, tilstand.kursId)).status);
  }
  if (tilstand.moduleId) noter("arkiver testmodul", (await api("POST", `/api/admin/content/modules/${tilstand.moduleId}/archive`)).status);
});

test("versjonen er minst 2.133.0", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.133.0"));
});

test("lesing: uten versjon og med en eldre versjon → 409 og ikke lest; med versjonen siden viste → lest, og kursbevis", async () => {
  test.setTimeout(180_000);
  const a = await lagSeksjon("A");
  const b = await lagSeksjon("B");
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`Stage-test 2.133 kurs ${stempel}`), certificationLevel: "basic" });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  tilstand.kursId = kurs.json.course.id;
  expect((await api("PUT", `/api/admin/content/courses/${tilstand.kursId}/items`, { items: [{ type: "SECTION", sectionId: a }, { type: "SECTION", sectionId: b }] })).status).toBe(204);
  expect((await api("POST", `/api/admin/content/courses/${tilstand.kursId}/publish`)).status).toBe(200);

  const sti = (id: string) => `/api/courses/${tilstand.kursId}/sections/${id}`;
  const lestAv = async () => {
    const detalj = await api("GET", `/api/courses/${tilstand.kursId}`);
    return (detalj.json.course.items as Array<{ sectionId?: string; read?: boolean }>).filter((i) => i.read).map((i) => i.sectionId);
  };

  const vist = await api("GET", sti(a));
  expect(vist.status, vist.tekst.slice(0, 300)).toBe(200);
  const versjonNå = vist.json.sectionVersionId as string;
  noter("sectionVersionId finnes", Boolean(versjonNå));
  expect(versjonNå).toBeTruthy();

  const utenVersjon = await api("POST", `${sti(a)}/read`, {});
  noter("lesing uten versjon", { status: utenVersjon.status, error: utenVersjon.json.error });
  expect(utenVersjon.status).toBe(409);
  expect(utenVersjon.json.error).toBe("client_outdated");

  // En ny versjon av seksjonen: det den gamle siden viste, er ikke lenger aktivt.
  const ny = await api("PUT", `/api/admin/content/sections/${a}/content`, { bodyMarkdown: L("Innhold A, rettet skrivefeil.") });
  expect(ny.status, ny.tekst.slice(0, 300)).toBe(200);
  const etter = await api("GET", sti(a));
  const nyVersjon = etter.json.sectionVersionId as string;
  noter("ny versjon av seksjonen", nyVersjon !== versjonNå);

  if (nyVersjon !== versjonNå) {
    const utdatert = await api("POST", `${sti(a)}/read`, { sectionVersionId: versjonNå });
    noter("lesing med eldre versjon", { status: utdatert.status, error: utdatert.json.error });
    expect(utdatert.status).toBe(409);
    expect(utdatert.json.error).toBe("section_version_changed");
  }
  const feilId = await api("POST", `${sti(a)}/read`, { sectionVersionId: "finnes-ikke" });
  expect(feilId.status).toBe(409);
  expect(feilId.json.error).toBe("section_version_changed");
  expect(await lestAv(), "ingenting er skrevet ved 409").toEqual([]);

  expect((await api("POST", `${sti(a)}/read`, { sectionVersionId: nyVersjon })).status).toBe(204);
  const førBevis = await api("GET", "/api/courses/completions");
  expect((førBevis.json.completions as Array<{ courseId: string }>).filter((c) => c.courseId === tilstand.kursId)).toEqual([]);

  // Siste lesing utsteder beviset, i samme transaksjon.
  const b1 = await api("GET", sti(b));
  expect((await api("POST", `${sti(b)}/read`, { sectionVersionId: b1.json.sectionVersionId })).status).toBe(204);
  const bevis = await api("GET", "/api/courses/completions");
  expect(bevis.status).toBe(200);
  const egne = (bevis.json.completions as Array<{ courseId: string; versionMajor: number; current: boolean }>).filter((c) => c.courseId === tilstand.kursId);
  noter("kursbevis etter siste lesing", egne.map((c) => `${c.versionMajor}:${c.current}`));
  expect(egne).toHaveLength(1);
  expect(egne[0].current).toBe(true);

  // Kursbevissiden leser på nytt, uten å lage et nytt bevis.
  const igjen = await api("GET", "/api/courses/completions");
  expect((igjen.json.completions as Array<{ courseId: string }>).filter((c) => c.courseId === tilstand.kursId)).toHaveLength(1);
});

test("innlevering: uten versjon og med en eldre versjon → 409 og ingenting levert; med versjonen siden viste → 201", async () => {
  test.setTimeout(180_000);
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`Stage-test 2.133 modul ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  tilstand.moduleId = modul.json.module.id;
  const første = await publiserModulversjon(tilstand.moduleId!, "første");

  const vist = await api("GET", `/api/modules/${tilstand.moduleId}`);
  expect(vist.status, vist.tekst.slice(0, 300)).toBe(200);
  noter("activeVersion.id er versjonen som ble publisert", vist.json.module.activeVersion?.id === første);
  expect(vist.json.module.activeVersion?.id).toBe(første);

  const antallLevert = async () => {
    const historikk = await api("GET", "/api/submissions/history?limit=200");
    return (historikk.json.history as Array<{ moduleId?: string; module?: { id?: string } }>).filter((h) => (h.moduleId ?? h.module?.id) === tilstand.moduleId).length;
  };
  const lever = (ekstra: object) => api("POST", "/api/submissions", { moduleId: tilstand.moduleId, deliveryType: "text", responseJson: {}, ...ekstra });

  const utenVersjon = await lever({});
  noter("innlevering uten versjon", { status: utenVersjon.status, error: utenVersjon.json.error });
  expect(utenVersjon.status).toBe(409);
  expect(utenVersjon.json.error).toBe("client_outdated");

  const andre = await publiserModulversjon(tilstand.moduleId!, "andre");
  expect(andre).not.toBe(første);

  const utdatert = await lever({ moduleVersionId: første });
  noter("innlevering med eldre versjon", { status: utdatert.status, error: utdatert.json.error });
  expect(utdatert.status).toBe(409);
  expect(utdatert.json.error).toBe("module_version_changed");
  expect(await antallLevert(), "ingenting er skrevet ved 409").toBe(0);

  const riktig = await lever({ moduleVersionId: andre });
  noter("innlevering med riktig versjon", { status: riktig.status });
  expect(riktig.status, riktig.tekst.slice(0, 300)).toBe(201);
  expect(riktig.json.submission.moduleVersionId).toBe(andre);
  expect(await antallLevert()).toBe(1);
});
