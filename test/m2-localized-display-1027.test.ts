import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { allLocaleValues } from "../src/i18n/allLocaleValues.js";

// #1027: serveren sendte lagringsformatet, og hver klient tolket det selv. Da får vi flere
// implementasjoner av «hvilket språk viser vi», og de driver fra hverandre — akkurat som #1022
// viste, der klientens reservekjede falt tilbake på `nb` og serverens på første tilgjengelige.
//
// ⚠️ #892 gjør dette til noe som faktisk skjer: en delvis oversatt tittel er en LOVLIG tilstand.

const reportReader = {
  "x-user-id": "rep-1027",
  "x-user-email": "rep-1027@company.com",
  "x-user-name": "Rapportleser 1027",
  "x-user-roles": "REPORT_READER",
};

describe("#1027 — serveren eier hvilket språk som vises", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ⚠️ Fiksturen lages HER, med vilje. Første utgave av testen lente seg på seed-dataene og
  // sammenlignet bare nb mot en-GB. Seed-modulene har RENE STRENGER som titler — ingen
  // lokalisering i det hele tatt — så testen var grønn uten at den målte noe. Den ville vært
  // grønn med språkene byttet om, og den var grønn før fiksen.
  //
  // En test som lener seg på data den ikke lager, måler det den håper finnes.
  async function seedLocalizedModule() {
    const stamp = `${Date.now()}`;
    const title = { "en-GB": `Incident response ${stamp}`, nb: `Hendelseshåndtering ${stamp}`, nn: `Hendingshandtering ${stamp}` };
    // #1027 funn C: nivået er det SAMME lokaliserte feltet som tittelen, og gikk rått ut i
    // mcq-quality — norsk tittel og en JSON-blob i nabokolonnen.
    const level = { "en-GB": `Advanced ${stamp}`, nb: `Viderekommen ${stamp}` };
    const mod = await prisma.module.create({
      data: { title: JSON.stringify(title), certificationLevel: JSON.stringify(level), description: null },
      select: { id: true },
    });
    const version = await prisma.moduleVersion.create({
      data: { moduleId: mod.id, versionNo: 1, assessmentMode: "FREETEXT_ONLY" },
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: { externalId: `lz-${stamp}`, name: "LZ", email: `lz-${stamp}@x.test` },
      select: { id: true },
    });
    const submission = await prisma.submission.create({
      select: { id: true },
      data: {
        userId: user.id,
        moduleId: mod.id,
        moduleVersionId: version.id,
        deliveryType: "text",
        submissionStatus: "COMPLETED",
      },
    });
    return { moduleId: mod.id, userId: user.id, submissionId: submission.id, title, level };
  }

  // ⚠️ QA-porten: mcq-quality-testen min var grønn uten å måle noe. Seed-dataene har ingen
  // MCQ-svar, så raden fantes ikke, `find` ga undefined, og `if (firstTitle)` hoppet over hele
  // påstanden. Ruta som VAR feilen hadde altså ingen test som kunne bli rød.
  //
  // En betinget påstand er ikke en test. Den er en test som spør om lov.
  async function seedMcqAnswer(moduleId: string, submissionId: string, stamp: string) {
    const setVersion = await prisma.mCQSetVersion.create({
      data: { moduleId, versionNo: 1, title: `Sett ${stamp}` },
      select: { id: true },
    });
    const question = await prisma.mCQQuestion.create({
      data: {
        mcqSetVersionId: setVersion.id,
        moduleId,
        stem: `Sporsmal ${stamp}`,
        optionsJson: JSON.stringify([{ key: "a", text: "Alt A" }, { key: "b", text: "Alt B" }]),
        correctAnswer: "a",
      },
      select: { id: true },
    });
    const attempt = await prisma.mCQAttempt.create({
      data: { submissionId, mcqSetVersionId: setVersion.id, startedAt: new Date(), completedAt: new Date() },
      select: { id: true },
    });
    await prisma.mCQResponse.create({
      data: { mcqAttemptId: attempt.id, questionId: question.id, selectedAnswer: "b", isCorrect: false },
    });
  }

  async function cleanup(moduleId: string, userId: string) {
    await prisma.mCQResponse.deleteMany({ where: { question: { moduleId } } });
    await prisma.mCQAttempt.deleteMany({ where: { mcqSetVersion: { moduleId } } });
    await prisma.mCQQuestion.deleteMany({ where: { moduleId } });
    await prisma.mCQSetVersion.deleteMany({ where: { moduleId } });
    await prisma.appeal.deleteMany({ where: { submission: { moduleId } } });
    await prisma.submission.deleteMany({ where: { userId } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId } });
    await prisma.module.deleteMany({ where: { id: moduleId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  it("rapporten bruker LESERENS språk, ikke engelsk", async () => {
    const { moduleId, userId, title } = await seedLocalizedModule();

    const nb = await request(app).get("/api/reports/completion").set({ ...reportReader, "x-locale": "nb" });
    const en = await request(app).get("/api/reports/completion").set({ ...reportReader, "x-locale": "en-GB" });
    expect(nb.status).toBe(200);
    expect(en.status).toBe(200);

    const titleFor = (body: { rows: Array<{ moduleId: string; moduleTitle: string }> }) =>
      body.rows.find((r) => r.moduleId === moduleId)?.moduleTitle;

    // ⚠️ HVILKEN tekst, ikke bare «ulik». Med bare «ulik» ville testen vært grønn også med
    // språkene byttet om.
    expect(titleFor(nb.body)).toBe(title.nb);
    expect(titleFor(en.body)).toBe(title["en-GB"]);

    await cleanup(moduleId, userId);
  });

  it("CSV-eksporten har SAMME språk som skjermen", async () => {
    const { moduleId, userId, title } = await seedLocalizedModule();

    const csv = await request(app)
      .get("/api/reports/export?type=completion&format=csv")
      .set({ ...reportReader, "x-locale": "nb" });

    expect(csv.status).toBe(200);
    // ⚠️ Uten dette ville en norsk leser fått norsk rapport på skjermen og engelsk fil — verre enn
    // om begge var engelske, fordi ingen ville sett at de sprikte.
    expect(csv.text).toContain(title.nb);
    expect(csv.text).not.toContain(title["en-GB"]);

    await cleanup(moduleId, userId);
  });

  // ⚠️ QA-porten fant at jeg hadde skapt nøyaktig spriket kommentaren min fordømmer: mcq-quality
  // ga engelsk JSON og norsk CSV. Den FØRSTE utgaven av denne testen var likevel grønn — den
  // lette etter en tittel i en tom rapport og hoppet over påstanden da den ikke fant noen.
  it("mcq-quality har samme språk i JSON og CSV, og nivået er ikke en JSON-blob", async () => {
    const stamp = `${Date.now()}`;
    const { moduleId, userId, submissionId, title, level } = await seedLocalizedModule();
    await seedMcqAnswer(moduleId, submissionId, stamp);

    const json = await request(app).get("/api/reports/mcq-quality").set({ ...reportReader, "x-locale": "nb" });
    const csv = await request(app)
      .get("/api/reports/export?type=mcq-quality&format=csv")
      .set({ ...reportReader, "x-locale": "nb" });

    expect(json.status).toBe(200);
    expect(csv.status).toBe(200);

    const row = (json.body.rows as Array<{ moduleId: string; moduleTitle: string; certificationLevel: string | null }>)
      .find((r) => r.moduleId === moduleId);
    // Raden MÅ finnes. Uten dette måler testen ingenting når rapporten er tom.
    expect(row, "fiksturmodulen skal være med i mcq-quality").toBeTruthy();

    expect(row!.moduleTitle).toBe(title.nb);
    // Funn C: samme felt som `courses.ts` lokaliserer, gikk rått ut her.
    expect(row!.certificationLevel).toBe(level.nb);
    expect(String(row!.certificationLevel)).not.toContain('"en-GB"');

    // Skjerm og fil skal si det samme.
    expect(csv.text).toContain(title.nb);
    expect(csv.text).not.toContain(title["en-GB"]);
    expect(csv.text).toContain(level.nb);

    await cleanup(moduleId, userId);
  });

  // ⚠️ Første utgave løkket over klagene i køen uten å lage noen. På en fersk database er køen tom,
  // løkken kjører null ganger, og testen er grønn. Den lager nå sin egen klage.
  it("klagekøen sender ferdig tittel OG alle språkvariantene til søk", async () => {
    const { moduleId, userId, submissionId, title } = await seedLocalizedModule();
    await prisma.appeal.create({
      data: { submissionId, appealedById: userId, appealReason: "Test 1027", appealStatus: "OPEN" },
    });

    const handler = {
      "x-user-id": "app-1027",
      "x-user-email": "app-1027@company.com",
      "x-user-name": "Klagebehandler 1027",
      "x-user-roles": "APPEAL_HANDLER",
    };
    const queue = await request(app).get("/api/appeals?status=OPEN").set({ ...handler, "x-locale": "nb" });
    expect(queue.status).toBe(200);

    type QueueRow = { submission?: { module?: { id?: string; title?: unknown; titleSearch?: unknown } } };
    const mine = ((queue.body.appeals ?? []) as QueueRow[]).find((a) => a.submission?.module?.id === moduleId);
    expect(mine, "klagen vi nettopp lagde skal ligge i køen").toBeTruthy();

    const mod = mine!.submission!.module!;
    // Tittelen er en ferdig streng på leserens språk, ikke lagringsformatet.
    expect(mod.title).toBe(title.nb);
    // Og variantene følger med, så søket ikke ble smalere av at serveren lokaliserer.
    expect(mod.titleSearch).toEqual(expect.arrayContaining([title.nb, title["en-GB"], title.nn]));

    await cleanup(moduleId, userId);
  });
});

describe("#1027 — søket skal ikke bli smalere av at serveren lokaliserer", () => {
  it("alle språkvariantene følger med, slik at en behandler finner saken uansett språk", () => {
    const stored = JSON.stringify({ "en-GB": "Incident response", nb: "Hendelseshåndtering", nn: "Hendingshandtering" });
    const values = allLocaleValues(stored);

    expect(values).toHaveLength(3);
    expect(values).toContain("Incident response");
    expect(values).toContain("Hendelseshåndtering");
  });

  it("en ren streng gir seg selv, og tomt gir ingenting", () => {
    expect(allLocaleValues("Bare én tekst")).toEqual(["Bare én tekst"]);
    expect(allLocaleValues(null)).toEqual([]);
    expect(allLocaleValues("")).toEqual([]);
  });

  it("en DELVIS oversatt tittel gir bare de språkene som finnes", () => {
    // #892: dette er en lovlig tilstand, ikke en kant.
    expect(allLocaleValues(JSON.stringify({ nn: "Berre nynorsk" }))).toEqual(["Berre nynorsk"]);
  });
});
