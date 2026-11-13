import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readServiceAuth, stageBaseUrl } from "./stageAuth.js";
import { forventMinstVersjon } from "./versjon.js";
import { vent } from "./pace.js";
import { arkiverKurs } from "./arkiver.js";

// 2.154.1 mot UTRULLET stage: deltakerflyten prøvd med en VANLIG DELTAKERKONTO, uten at et menneske logger inn.
//
// Stage-testkontoen er fagansvarlig, og forfattere går forbi kursporten i `POST /api/submissions` (`PARTICIPANT_COURSE_ONLY`). Med
// hodet `x-stage-test-role: PARTICIPANT` er den i stedet en egen bruker med bare deltakerrollen (src/auth/stageTestService.ts).
// Fagansvarlig-identiteten setter opp, deltakeridentiteten prøver:
//   - hvem deltakeren er: rollene er nøyaktig PARTICIPANT, administrasjonsflaten svarer 403, og en ukjent verdi i hodet gir 401;
//   - modul A (ren flervalg) i et ÅPENT publisert kurs: lesing og innlevering med kurset → 201, flervalg, bestått, og kurset viser
//     modulen som bestått;
//   - modul B publisert, men ikke i noe kurs: 403 `course_required`;
//   - modul C i et BEGRENSET publisert kurs: 403 `course_required` til fagansvarlig legger deltakeren i en klasse med kurset, så 201.
//
// Porten deler kode med #1140 etappe 1 (`findAccessibleCoursesContainingModules` i enrollmentService.ts). Den er prøvd lokalt i
// test/m2-participant-module-version-1140.test.ts og test/m2-stage-test-participant.test.ts; dette er første gang på stage.
//
// Det testen skriver på stage: tre moduler, to kurs og én klasse («Stage-test 2.154.1 …»), og to innleveringer for deltakeren.
// Alt ryddes etterpå: klassen tømmes, arkiveres og slettes; kursene avpubliseres, TØMMES og arkiveres (et kurs med påbegynte
// deltakere kan ikke arkiveres, og en modul i et kurs heller ikke); modulene arkiveres. Tildelingen av kurset til klassen kan gi
// en e-post om nytt kurs først etter et kvarter, og bare for et kurs deltakeren ikke har begynt på; her har deltakeren levert, og
// klassen er borte lenge før det. Adressen er dessuten `@stage.invalid`.
//
// ⚠️ Bruker BARE stage-testkontoen (`.stage-service-auth.json`, `npm run stage:auth:service`), også når en personlig sesjon finnes:
// hodet virker ikke på et brukertoken. Tokenet skal ALDRI logges.

const { auth, reason } = readServiceAuth();
const BASE = stageBaseUrl(auth);

test.skip(!auth, `hopper over: ${reason}`);
test.describe.configure({ mode: "serial" });

const RAPPORT = path.resolve(process.cwd(), "test-results", "stage-rapport");
const noter = (hva: string, verdi: unknown) => {
  fs.mkdirSync(RAPPORT, { recursive: true });
  fs.appendFileSync(path.join(RAPPORT, "funn.jsonl"), `${JSON.stringify({ test: "2.154.1", hva, verdi: typeof verdi === "string" ? verdi : JSON.stringify(verdi) })}\n`, "utf8");
};
const noterFunn = noter;

type Som = "fagansvarlig" | "deltaker";
const ROLLEHODE = "x-stage-test-role";

/** `rolle` er verdien i hodet: utelatt for fagansvarlig, `PARTICIPANT` for deltakeren, eller noe annet for å prøve avslaget. */
async function kall(rolle: string | undefined, metode: string, sti: string, body?: unknown): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: {
      authorization: `Bearer ${auth!.accessToken}`,
      "x-locale": "nb",
      ...(rolle === undefined ? {} : { [ROLLEHODE]: rolle }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const api = (som: Som, metode: string, sti: string, body?: unknown) =>
  kall(som === "deltaker" ? "PARTICIPANT" : undefined, metode, sti, body);

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = Date.now();
const tilstand: {
  deltakerId?: string;
  modulA?: string; modulB?: string; modulC?: string;
  versjonA?: string; versjonB?: string; versjonC?: string;
  kursÅpent?: string; kursBegrenset?: string;
  klasseId?: string;
} = {};

async function lagModul(navn: string) {
  const modul = await api("fagansvarlig", "POST", "/api/admin/content/modules", { title: L(`Stage-test 2.154.1 ${navn} ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  return modul.json.module.id as string;
}

async function publiserModulversjon(moduleId: string, oppgavenavn: string) {
  const sett = await api("fagansvarlig", "POST", `/api/admin/content/modules/${moduleId}/mcq-set-versions`, {
    title: L("Sett"),
    questions: [{ stem: L(`Hva er riktig i ${oppgavenavn}?`), options: [L("Riktig"), L("Galt")], correctAnswer: L("Riktig"), rationale: L("Fordi.") }],
  });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await api("fagansvarlig", "POST", `/api/admin/content/modules/${moduleId}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 }, mcq: { reviewAfterSubmit: true, shuffleQuestions: false } },
  });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  const publisert = await api("fagansvarlig", "POST", `/api/admin/content/modules/${moduleId}/module-versions/${versjon.json.moduleVersion.id}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 300)).toContain(publisert.status);
  return versjon.json.moduleVersion.id as string;
}

async function lagPublisertKurs(navn: string, moduleId: string, enrollmentPolicy: "OPEN" | "RESTRICTED") {
  const kurs = await api("fagansvarlig", "POST", "/api/admin/content/courses", { title: L(`Stage-test 2.154.1 ${navn} ${stempel}`), certificationLevel: "basic", enrollmentPolicy });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  const kursId = kurs.json.course.id as string;
  expect((await api("fagansvarlig", "PUT", `/api/admin/content/courses/${kursId}/items`, { items: [{ type: "MODULE", moduleId }] })).status).toBe(204);
  const publisert = await api("fagansvarlig", "POST", `/api/admin/content/courses/${kursId}/publish`);
  expect(publisert.status, publisert.tekst.slice(0, 400)).toBe(200);
  return kursId;
}

/** Deltakeren leverer, tar flervalget og får resultatet. Gir innleveringens status tilbake, og resultatet når den ble laget. */
async function leverOgTaFlervalg(moduleId: string, moduleVersionId: string, courseId: string | undefined) {
  const levert = await api("deltaker", "POST", "/api/submissions", {
    moduleId, moduleVersionId, ...(courseId === undefined ? {} : { courseId }), deliveryType: "text", responseJson: {},
  });
  if (levert.status !== 201) return { levert, bestått: undefined as boolean | undefined };
  const submissionId = levert.json.submission.id as string;
  const start = await api("deltaker", "GET", `/api/modules/${moduleId}/mcq/start?submissionId=${submissionId}`);
  expect(start.status, start.tekst.slice(0, 300)).toBe(200);
  const svar = await api("deltaker", "POST", `/api/modules/${moduleId}/mcq/submit`, {
    submissionId,
    attemptId: start.json.attemptId,
    responses: (start.json.questions as Array<{ id: string }>).map((q) => ({ questionId: q.id, selectedAnswer: "Riktig" })),
  });
  expect(svar.status, svar.tekst.slice(0, 300)).toBe(200);
  const resultat = await api("deltaker", "GET", `/api/submissions/${submissionId}/result`);
  return { levert, bestått: resultat.json.decision?.passFailTotal as boolean | undefined };
}

test.afterAll(async () => {
  // En rydding som feiler, skal gjøre kjøringen rød: første kjøring på stage var grønn med 400 i ryddingen, og kurs og moduler
  // ble liggende igjen. Alt forsøkes først, så feiler den til slutt med lista over det som ikke gikk.
  const mislyktes: string[] = [];
  const noter = (hva: string, status: number) => {
    noterFunn(hva, status);
    if (status >= 400) mislyktes.push(`${hva}: ${status}`);
  };
  // Klassen først, så kurset ikke lenger er tildelt noen.
  if (tilstand.klasseId) {
    const k = tilstand.klasseId;
    if (tilstand.kursBegrenset) noter("fjern kurset fra klassen", (await api("fagansvarlig", "DELETE", `/api/admin/content/classes/${k}/courses/${tilstand.kursBegrenset}`)).status);
    if (tilstand.deltakerId) noter("fjern deltakeren fra klassen", (await api("fagansvarlig", "DELETE", `/api/admin/content/classes/${k}/members/${tilstand.deltakerId}`)).status);
    noter("arkiver klassen", (await api("fagansvarlig", "POST", `/api/admin/content/classes/${k}/archive`)).status);
    noter("slett klassen", (await api("fagansvarlig", "DELETE", `/api/admin/content/classes/${k}`)).status);
  }
  // Et kurs med påbegynte deltakere kan ikke arkiveres, og en modul som ligger i et kurs heller ikke: kurset tømmes først
  // (første utgave av 2.154-testen lot kurset ligge igjen med 400).
  for (const kursId of [tilstand.kursÅpent, tilstand.kursBegrenset]) {
    if (!kursId) continue;
    noter("avpubliser testkurs", (await api("fagansvarlig", "POST", `/api/admin/content/courses/${kursId}/unpublish`)).status);
    const kurs = await api("fagansvarlig", "GET", `/api/admin/content/courses/${kursId}`);
    // Deltakeren har bestått kursets eneste modul og har kursbevis: uten svar på versjonsspørsmålet gir tømmingen 400
    // `course_version_required`, og modulen blir liggende i kurset og kan ikke arkiveres. «minor» sender ingen e-post.
    noter("tøm testkurs", (await api("fagansvarlig", "PUT", `/api/admin/content/courses/${kursId}/items`, { items: [], expectedRevision: kurs.json.course?.contentRevision, version: "minor" })).status);
    noter("arkiver testkurs", (await arkiverKurs((metode, sti, body) => api("fagansvarlig", metode, sti, body), kursId)).status);
  }
  for (const id of [tilstand.modulA, tilstand.modulB, tilstand.modulC]) {
    if (id) noter("arkiver testmodul", (await api("fagansvarlig", "POST", `/api/admin/content/modules/${id}/archive`)).status);
  }
  expect(mislyktes, "ryddingen på stage feilet; se funn.jsonl og rydd for hånd").toEqual([]);
});

test("versjonen er minst 2.154.1, og kursporten er på", async () => {
  noter("versjon", await forventMinstVersjon(BASE, "2.154.1"));
  const config = (await (await fetch(`${BASE}/participant/config`)).json()) as { courseOnly?: boolean };
  noter("PARTICIPANT_COURSE_ONLY", config.courseOnly);
  // Uten porten sier `course_required`-sjekkene under ingenting.
  expect(config.courseOnly, "PARTICIPANT_COURSE_ONLY er av på stage").toBe(true);
});

test("deltakeren er en egen bruker med bare deltakerrollen, og en ukjent rolle avvises", async () => {
  test.setTimeout(120_000);
  const fagansvarlig = await api("fagansvarlig", "GET", "/api/me");
  expect(fagansvarlig.status, fagansvarlig.tekst.slice(0, 300)).toBe(200);
  noter("fagansvarlig: roller", fagansvarlig.json.user?.roles);
  expect(fagansvarlig.json.user.roles).toContain("SUBJECT_MATTER_OWNER");

  const deltaker = await api("deltaker", "GET", "/api/me");
  expect(deltaker.status, deltaker.tekst.slice(0, 300)).toBe(200);
  noter("deltaker: roller", deltaker.json.user?.roles);
  expect(deltaker.json.user.roles).toEqual(["PARTICIPANT"]);
  expect(deltaker.json.user.email).toBe("stage-testkonto-deltaker@stage.invalid");
  expect(String(deltaker.json.user.externalId)).toMatch(/^stage-test-service-participant:/);

  // En ny bruker må godta personvernerklæringen før noe annet enn /api/me svarer (consentMiddleware), som ved første innlogging.
  if (deltaker.json.consent?.accepted === false) {
    const godtatt = await api("deltaker", "POST", "/api/me/consent", { consentVersion: deltaker.json.consent.currentVersion });
    noter("deltaker: godtok personvernerklæringen", { status: godtatt.status, versjon: deltaker.json.consent.currentVersion });
    expect(godtatt.status, godtatt.tekst.slice(0, 300)).toBe(200);
  }

  const data = await api("deltaker", "GET", "/api/me/data");
  expect(data.status, data.tekst.slice(0, 300)).toBe(200);
  tilstand.deltakerId = data.json.profile?.id;
  expect(tilstand.deltakerId, "fant ikke deltakerens interne id i /api/me/data").toBeTruthy();
  const fagansvarligData = await api("fagansvarlig", "GET", "/api/me/data");
  const fagansvarligId = fagansvarligData.json.profile?.id;
  expect(fagansvarligId, "fant ikke fagansvarliges interne id i /api/me/data").toBeTruthy();
  expect(tilstand.deltakerId).not.toBe(fagansvarligId);

  // Kontroll på at det ER en deltaker: administrasjonsflaten er stengt for den, åpen for fagansvarlig.
  const adminSomDeltaker = await api("deltaker", "GET", "/api/admin/content/courses");
  const adminSomFagansvarlig = await api("fagansvarlig", "GET", "/api/admin/content/courses");
  noter("administrasjonsflaten", { deltaker: adminSomDeltaker.status, fagansvarlig: adminSomFagansvarlig.status });
  expect(adminSomDeltaker.status).toBe(403);
  expect(adminSomFagansvarlig.status).toBe(200);

  // Hvitelisten: alt annet enn nøyaktig PARTICIPANT gir 401, ikke fagansvarlig.
  for (const verdi of ["participant", "ADMINISTRATOR"]) {
    const avvist = await kall(verdi, "GET", "/api/me");
    noter(`ukjent rolle «${verdi}»`, avvist.status);
    expect(avvist.status, `verdi «${verdi}»`).toBe(401);
  }
});

test("modul A i et åpent kurs: lesing og innlevering med kurset, flervalg, bestått, og kurset viser modulen som bestått", async () => {
  test.setTimeout(300_000);
  test.skip(!tilstand.deltakerId, "deltakeridentiteten ble ikke satt opp");
  tilstand.modulA = await lagModul("modul A");
  tilstand.modulB = await lagModul("modul B");
  tilstand.modulC = await lagModul("modul C");
  tilstand.versjonA = await publiserModulversjon(tilstand.modulA, "A");
  tilstand.versjonB = await publiserModulversjon(tilstand.modulB, "B");
  tilstand.versjonC = await publiserModulversjon(tilstand.modulC, "C");
  tilstand.kursÅpent = await lagPublisertKurs("åpent kurs", tilstand.modulA, "OPEN");
  tilstand.kursBegrenset = await lagPublisertKurs("begrenset kurs", tilstand.modulC, "RESTRICTED");

  const q = `?courseId=${encodeURIComponent(tilstand.kursÅpent)}`;
  const enkel = await api("deltaker", "GET", `/api/modules/${tilstand.modulA}${q}`);
  const aktiv = await api("deltaker", "GET", `/api/modules/${tilstand.modulA}/active-version${q}`);
  noter("deltaker: lesing av modul A i kurset", { enkel: enkel.status, aktiv: aktiv.status });
  expect([enkel.status, aktiv.status]).toEqual([200, 200]);
  expect([enkel.json.module?.activeVersion?.id, aktiv.json.activeVersion?.id]).toEqual([tilstand.versjonA, tilstand.versjonA]);

  const { levert, bestått } = await leverOgTaFlervalg(tilstand.modulA, tilstand.versjonA, tilstand.kursÅpent);
  noter("deltaker: innlevering på modul A med kurset", { status: levert.status, error: levert.json.error, bestått });
  expect(levert.status, levert.tekst.slice(0, 300)).toBe(201);
  expect(levert.json.submission.moduleVersionId).toBe(tilstand.versjonA);
  expect(bestått).toBe(true);

  const detalj = await api("deltaker", "GET", `/api/courses/${tilstand.kursÅpent}`);
  expect(detalj.status, detalj.tekst.slice(0, 300)).toBe(200);
  const iKurset = (detalj.json.course.items as Array<{ moduleId?: string; moduleStatus?: string; available?: boolean }>).find((i) => i.moduleId === tilstand.modulA);
  noter("deltaker: modul A i kurset etter bestått", iKurset);
  expect(iKurset?.moduleStatus).toBe("PASSED");
});

test("modul B, publisert men ikke i noe kurs: 403 course_required", async () => {
  test.skip(!tilstand.modulB || !tilstand.versjonB, "modul B ble ikke laget");
  const nektet = await api("deltaker", "POST", "/api/submissions", { moduleId: tilstand.modulB, moduleVersionId: tilstand.versjonB, deliveryType: "text", responseJson: {} });
  noter("deltaker: innlevering på modul B uten kurs", { status: nektet.status, error: nektet.json.error });
  expect(nektet.status, nektet.tekst.slice(0, 300)).toBe(403);
  expect(nektet.json.error).toBe("course_required");
});

test("modul C i et begrenset kurs: 403 course_required, så 201 når deltakeren er lagt i en klasse med kurset", async () => {
  test.setTimeout(180_000);
  test.skip(!tilstand.modulC || !tilstand.kursBegrenset || !tilstand.deltakerId, "modul C eller kurset ble ikke laget");
  const modulC = tilstand.modulC!;
  const kursId = tilstand.kursBegrenset!;

  const før = await api("deltaker", "POST", "/api/submissions", { moduleId: modulC, moduleVersionId: tilstand.versjonC, courseId: kursId, deliveryType: "text", responseJson: {} });
  noter("deltaker: innlevering på modul C før klassen", { status: før.status, error: før.json.error });
  expect(før.status, før.tekst.slice(0, 300)).toBe(403);
  expect(før.json.error).toBe("course_required");
  // Kurset er heller ikke synlig for deltakeren ennå (404 dekker «finnes ikke» og «ikke ditt», med vilje).
  noter("deltaker: det begrensede kurset før klassen", (await api("deltaker", "GET", `/api/courses/${kursId}`)).status);

  const klasse = await api("fagansvarlig", "POST", "/api/admin/content/classes", { name: `Stage-test 2.154.1 deltaker ${stempel}` });
  expect(klasse.status, klasse.tekst.slice(0, 300)).toBe(201);
  tilstand.klasseId = klasse.json.class.id as string;
  const medlem = await api("fagansvarlig", "POST", `/api/admin/content/classes/${tilstand.klasseId}/members`, { userId: tilstand.deltakerId });
  expect(medlem.status, medlem.tekst.slice(0, 300)).toBe(201);
  const tildelt = await api("fagansvarlig", "POST", `/api/admin/content/classes/${tilstand.klasseId}/courses`, { courseId: kursId, dueAt: null });
  expect(tildelt.status, tildelt.tekst.slice(0, 300)).toBe(201);

  const { levert, bestått } = await leverOgTaFlervalg(modulC, tilstand.versjonC!, kursId);
  noter("deltaker: innlevering på modul C etter klassen", { status: levert.status, error: levert.json.error, bestått });
  expect(levert.status, levert.tekst.slice(0, 300)).toBe(201);
  expect(bestått).toBe(true);
});
