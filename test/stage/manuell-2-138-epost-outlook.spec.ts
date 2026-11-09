import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readAuth, stageBaseUrl } from "./stageAuth.js";
import { vent } from "./pace.js";

// Manuell kontroll mot UTRULLET stage: ekte e-poster fra 2.138.0 i en ekte innboks. Bilde, lenke og at en adresse i en tittel ikke blir
// en lenke kan bare ses i e-postklienten. Kjøres med MANUELL_EPOST=1 og tokenet til kontoen som skal få e-postene (`npm run stage:auth`).
// Stage-testkontoen (`npm run stage:auth:service`) stiller spørsmålet i diskusjonen, for en eier får ikke e-post om sitt eget.
//
// Kurset blir stående publisert til e-postene er sett. Etterpå: MANUELL_EPOST=1 RYDD=1 arkiverer det testen laget.
//
// Fra 2.147.0 (#1142) kommer e-posten om nye kurs samlet, om lag et kvarter etter tildelingen, og et kurs deltakeren alt har
// begynt på, tas ut. Testen leverer i hovedkurset med en gang, så det er påbegynt når e-posten samles. Derfor tildeles også
// et eget kurs testen aldri starter («E-posttest nytt kurs …»): e-posten «Du har fått et nytt kurs» skal nevne bare det.
// ⚠️ Rydd ikke før den er kommet: ryddingen tar kurset ut, og da sendes den aldri.
// ⚠️ Tokenene skal ALDRI logges.

const { auth, reason } = readAuth();
const BASE = stageBaseUrl(auth);
// Ikke i test-results: Playwright tømmer den mappa ved neste kjøring, og da finner ikke ryddingen noe.
const LAGER = path.resolve(process.cwd(), ".tmp-stage-logs", "epost-2138.json");

test.skip(process.env.MANUELL_EPOST !== "1", "manuell kontroll, kjøres med MANUELL_EPOST=1");
test.skip(!auth, `hopper over: ${reason}`);

function tjenestetoken(): string | null {
  try {
    return (JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".stage-service-auth.json"), "utf8")) as { accessToken?: string }).accessToken ?? null;
  } catch {
    return null;
  }
}

async function api(metode: string, sti: string, body?: unknown, token = auth!.accessToken): Promise<{ status: number; json: any; tekst: string }> {
  await vent();
  const svar = await fetch(`${BASE}${sti}`, {
    method: metode,
    headers: { authorization: `Bearer ${token}`, "x-locale": "nb", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tekst = await svar.text();
  let json: any = {};
  try { json = JSON.parse(tekst); } catch { /* ikke JSON */ }
  return { status: svar.status, json, tekst };
}

const L = (nb: string) => ({ "en-GB": nb, nb, nn: nb });
const stempel = new Date().toISOString().slice(0, 16).replace("T", " ");

async function flervalgsmodul(navn: string) {
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`E-posttest ${navn} ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  const moduleId = modul.json.module.id as string;
  const sett = await api("POST", `/api/admin/content/modules/${moduleId}/mcq-set-versions`, {
    title: L("Sett"),
    questions: [{ stem: L("Hva er riktig?"), options: [L("Riktig"), L("Galt")], correctAnswer: L("Riktig"), rationale: L("Fordi.") }],
  });
  expect(sett.status, sett.tekst.slice(0, 300)).toBe(201);
  const versjon = await api("POST", `/api/admin/content/modules/${moduleId}/module-versions`, {
    assessmentMode: "MCQ_ONLY",
    mcqSetVersionId: sett.json.mcqSetVersion.id,
    assessmentPolicy: { passRules: { mcqMinPercent: 50 } },
  });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  const publisert = await api("POST", `/api/admin/content/modules/${moduleId}/module-versions/${versjon.json.moduleVersion.id}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 300)).toContain(publisert.status);
  return moduleId;
}

async function fritekstmodul() {
  const modul = await api("POST", "/api/admin/content/modules", { title: L(`E-posttest sensor ${stempel}`), certificationLevel: "basic" });
  expect(modul.status, modul.tekst.slice(0, 300)).toBe(201);
  const moduleId = modul.json.module.id as string;
  // Samme form som test/stage/maal-1135-vurdering.spec.ts, som vurderes uten feil. Et kriterium som bare er en tekstlinje
  // fikk KI-en til å svare i feil format (2026-11-07), og jobben feilet om og om igjen.
  const versjon = await api("POST", `/api/admin/content/modules/${moduleId}/versions`, {
    assessmentMode: "FREETEXT_ONLY",
    taskText: L("Skriv to setninger om hvorfor referater er nyttige."),
    assessorExpectedContent: L("Referater gir felles forståelse av vedtak og gjør det mulig å etterprøve dem senere."),
    rubric: {
      criteria: { innhold: { label: L("Begrunnelsen"), description: L("0 = ingen begrunnelse; 1 = én begrunnelse; 2 = to begrunnelser"), maxScore: 2 } },
      scalingRule: { practical_weight: 100, max_total: 2 },
    },
    promptTemplate: { systemPrompt: L("Du er sensor for et kurs i møtereferater."), userPromptTemplate: L("Vurder svaret mot kriteriene.") },
    assessmentPolicy: { passRules: { totalMin: 50 }, aiInfluence: { enabled: true, shadowMode: false } },
  });
  expect(versjon.status, versjon.tekst.slice(0, 300)).toBe(201);
  const publisert = await api("POST", `/api/admin/content/modules/${moduleId}/module-versions/${versjon.json.moduleVersion.id}/publish`, {});
  expect([200, 201], publisert.tekst.slice(0, 300)).toContain(publisert.status);
  return moduleId;
}

async function leverFlervalg(moduleId: string, svar: string) {
  const versjonId = (await api("GET", `/api/modules/${moduleId}`)).json.module?.activeVersion?.id;
  const innlevering = await api("POST", "/api/submissions", { moduleId, moduleVersionId: versjonId, deliveryType: "text", responseJson: {} });
  expect(innlevering.status, innlevering.tekst.slice(0, 300)).toBe(201);
  const submissionId = innlevering.json.submission.id as string;
  const start = await api("GET", `/api/modules/${moduleId}/mcq/start?submissionId=${submissionId}`);
  expect(start.status, start.tekst.slice(0, 300)).toBe(200);
  const levert = await api("POST", `/api/modules/${moduleId}/mcq/submit`, {
    submissionId,
    attemptId: start.json.attemptId,
    responses: start.json.questions.map((q: { id: string }) => ({ questionId: q.id, selectedAnswer: svar })),
  });
  expect(levert.status, levert.tekst.slice(0, 300)).toBe(200);
  return submissionId;
}

test("sender en e-post av hver type til kontoen som er logget inn", async () => {
  test.skip(process.env.RYDD === "1" || !!process.env.FORTSETT, "rydder eller fortsetter");
  test.setTimeout(420_000);
  const meg = await api("GET", "/api/me");
  expect(meg.status).toBe(200);
  const tjeneste = tjenestetoken();
  expect(tjeneste, "kjør npm run stage:auth:service").not.toBeNull();
  expect(meg.json.user.email, "dette er stage-testkontoen, ikke en ekte innboks").not.toMatch(/stage-testkonto/i);

  const bestått = await flervalgsmodul("bestått");
  const strøket = await flervalgsmodul("ikke bestått");
  const sensor = await fritekstmodul();
  const kurs = await api("POST", "/api/admin/content/courses", { title: L(`E-posttest ${stempel} om github.com`), certificationLevel: "basic", discussionsEnabled: true });
  expect(kurs.status, kurs.tekst.slice(0, 300)).toBe(201);
  const kursId = kurs.json.course.id as string;
  const satt = await api("PUT", `/api/admin/content/courses/${kursId}/items`, { items: [bestått, strøket, sensor].map((moduleId) => ({ type: "MODULE", moduleId })) });
  expect(satt.status, satt.tekst.slice(0, 300)).toBe(204);
  const publisert = await api("POST", `/api/admin/content/courses/${kursId}/publish`);
  expect(publisert.status, publisert.tekst.slice(0, 300)).toBe(200);

  // #1142: et kurs med en egen modul som testen aldri leverer i, så det ikke er påbegynt når e-posten om nye kurs samles.
  // Modulen kan ikke deles med hovedkurset: en innlevering på en modul gjør alle kurs med modulen påbegynt.
  const urørt = await flervalgsmodul("nytt kurs");
  const nyttKurs = await api("POST", "/api/admin/content/courses", { title: L(`E-posttest nytt kurs ${stempel}`), certificationLevel: "basic" });
  expect(nyttKurs.status, nyttKurs.tekst.slice(0, 300)).toBe(201);
  const nyttKursId = nyttKurs.json.course.id as string;
  const nyttSatt = await api("PUT", `/api/admin/content/courses/${nyttKursId}/items`, { items: [{ type: "MODULE", moduleId: urørt }] });
  expect(nyttSatt.status, nyttSatt.tekst.slice(0, 300)).toBe(204);
  const nyttPublisert = await api("POST", `/api/admin/content/courses/${nyttKursId}/publish`);
  expect(nyttPublisert.status, nyttPublisert.tekst.slice(0, 300)).toBe(200);

  const klasse = await api("POST", "/api/admin/content/classes", { name: `E-posttest ${stempel}` });
  expect(klasse.status, klasse.tekst.slice(0, 300)).toBe(201);
  const classId = klasse.json.class.id as string;
  fs.mkdirSync(path.dirname(LAGER), { recursive: true });
  fs.writeFileSync(LAGER, JSON.stringify({ kursId, nyttKursId, classId, moduler: [bestått, strøket, sensor, urørt] }));

  // /api/me har ikke database-ID-en; brukersøket har den.
  const funnet = await api("GET", `/api/admin/content/users/search?q=${encodeURIComponent(meg.json.user.email)}`);
  const userId = (funnet.json.users as Array<{ id: string; email: string }>).find((u) => u.email.toLowerCase() === meg.json.user.email.toLowerCase())?.id;
  expect(userId, "fant ikke meg selv i brukersøket").toBeTruthy();
  const medlem = await api("POST", `/api/admin/content/classes/${classId}/members`, { userId });
  expect(medlem.status, medlem.tekst.slice(0, 300)).toBe(201);
  const tildelt = await api("POST", `/api/admin/content/classes/${classId}/courses`, { courseId: kursId });
  expect(tildelt.status, tildelt.tekst.slice(0, 300)).toBe(201);
  const nyttTildelt = await api("POST", `/api/admin/content/classes/${classId}/courses`, { courseId: nyttKursId });
  expect(nyttTildelt.status, nyttTildelt.tekst.slice(0, 300)).toBe(201);
  console.log(`to kurs tildelt ${new Date().toTimeString().slice(0, 5)}. E-posten om nye kurs kommer om lag et kvarter etter, med bare «E-posttest nytt kurs».`);

  await leverFlervalg(bestått, "Riktig");
  const strykId = await leverFlervalg(strøket, "Galt");
  const anke = await api("POST", `/api/submissions/${strykId}/appeals`, { appealReason: "Jeg ber om en ny vurdering. Se også github.com." });
  expect(anke.status, anke.tekst.slice(0, 300)).toBe(201);

  await diskusjon(kursId, tjeneste!);
  await tilSensor(sensor);
});

// FORTSETT=1 tar opp igjen fra diskusjonsspørsmålet med kurset fra forrige kjøring, så de fire første e-postene ikke sendes to ganger.
// FORTSETT=sensor lager en ny fritekstmodul og sender bare svaret som skal til sensor.
test("fortsetter med kurset fra forrige kjøring", async () => {
  const fortsett = process.env.FORTSETT;
  test.skip((fortsett !== "1" && fortsett !== "sensor") || process.env.RYDD === "1", "bare med FORTSETT=1 eller FORTSETT=sensor");
  test.setTimeout(420_000);
  const lagret = JSON.parse(fs.readFileSync(LAGER, "utf8")) as { kursId: string; classId: string; moduler: string[] };
  if (fortsett === "1") {
    const tjeneste = tjenestetoken();
    expect(tjeneste, "kjør npm run stage:auth:service").not.toBeNull();
    await diskusjon(lagret.kursId, tjeneste!);
    await tilSensor(lagret.moduler[2]!);
    return;
  }
  const sensor = await fritekstmodul();
  fs.writeFileSync(LAGER, JSON.stringify({ ...lagret, moduler: [...lagret.moduler, sensor] }));
  await tilSensor(sensor);
});

async function diskusjon(kursId: string, tjeneste: string) {
  const tråd = await api("POST", `/api/courses/${kursId}/discussions`, { kind: "QUESTION", title: "Hvordan tolke github.com?", bodyMarkdown: "Spørsmål fra stage-testen." }, tjeneste);
  expect(tråd.status, tråd.tekst.slice(0, 300)).toBe(201);
}

async function tilSensor(sensor: string) {
  const versjonId = (await api("GET", `/api/modules/${sensor}`)).json.module?.activeVersion?.id;
  const innlevering = await api("POST", "/api/submissions", {
    moduleId: sensor,
    moduleVersionId: versjonId,
    deliveryType: "text",
    responseJson: { response: "Referater gir alle samme forståelse av hva som ble bestemt. De gjør det mulig å etterprøve vedtak senere." },
    processSignals: { declaration: "autonomous", declarationText: "KI skrev hele svaret.", insistedAfterPrompt: true },
  });
  expect(innlevering.status, innlevering.tekst.slice(0, 300)).toBe(201);
  const sensorId = innlevering.json.submission.id as string;
  let kjør = await api("POST", `/api/assessments/${sensorId}/run`, {});
  for (let i = 0; kjør.status === 429 && i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, ((kjør.json?.details?.retryAfterSeconds ?? 30) + 2) * 1000));
    kjør = await api("POST", `/api/assessments/${sensorId}/run`, {});
  }
  expect([200, 201, 202], kjør.tekst.slice(0, 300)).toContain(kjør.status);
  let status = "";
  for (let i = 0; i < 40 && status !== "UNDER_REVIEW"; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    status = (await api("GET", `/api/submissions/${sensorId}/result?locale=nb`)).json?.status ?? "";
  }
  expect(status, "svaret gikk ikke til sensor").toBe("UNDER_REVIEW");
  console.log(`til sensor ${new Date().toTimeString().slice(0, 5)}, modul ${sensor}. E-posten kommer etter fem minutter.`);
}

test("rydder: arkiverer det testen laget, når e-postene er sett", async () => {
  test.skip(process.env.RYDD !== "1", "bare med RYDD=1");
  const { kursId, nyttKursId, classId, moduler } = JSON.parse(fs.readFileSync(LAGER, "utf8")) as { kursId: string; nyttKursId?: string; classId: string; moduler: string[] };
  for (const id of [kursId, nyttKursId].filter((id): id is string => Boolean(id))) {
    await api("POST", `/api/admin/content/courses/${id}/unpublish`);
    expect((await api("POST", `/api/admin/content/courses/${id}/archive`)).status).toBe(200);
  }
  for (const moduleId of moduler) expect((await api("POST", `/api/admin/content/modules/${moduleId}/archive`)).status).toBe(200);
  console.log(`klassen ${classId} står igjen, den har ingen arkivering her.`);
});
