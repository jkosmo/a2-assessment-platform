import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { runContentWrite, runLearnerWrite, type ContentWriteTx, type LearnerTx } from "../src/db/contentLock.js";
import { createAssessmentDecision, createMcqOnlyDecision } from "../src/modules/assessment/decisionService.js";
import { deliverOutboxEvent, OUTBOX_EVENT_TYPES } from "../src/modules/outbox/outboxService.js";
import { readSection, seenModuleVersionId } from "./support/participantFlow.js";

// #934 skive 5a-1 (doc/DESIGN_934.md, «5a-1»): deltakerlåsen, utstedelse under låsene, og versjonen deltakeren så.
//   - Et kursbevis måles og skrives i én transaksjon som holder innholdslåsen delt og deltakerlåsen, fra alle tre veiene
//     inn: workeren, lesingen og kursbevissiden.
//   - Innlevering og lesing sender versjonen siden viste. Utdatert → 409, mangler → 409, og ingenting er skrevet.
//   - Vedtakene tar deltakerlåsen, ikke innholdslåsen.
// Testene går gjennom rutene (supertest), med feltene klienten sender. Låsene holdes av testen selv, og åpnes UTENFOR
// callbacken: en forespørsel startet inne i den, ville arvet transaksjonens kontekst og blitt stoppet som nøstet.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const ADMIN = { "x-user-id": `lock-5a1-admin-${RUN}`, "x-user-email": `lock.5a1.admin.${RUN}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
const REVIEWER = { "x-user-id": `lock-5a1-reviewer-${RUN}`, "x-user-email": `lock.5a1.reviewer.${RUN}@x.test`, "x-user-name": "Sensor", "x-user-roles": "REVIEWER", "x-locale": "nb" };
const HANDLER = { "x-user-id": `lock-5a1-handler-${RUN}`, "x-user-email": `lock.5a1.handler.${RUN}@x.test`, "x-user-name": "Behandler", "x-user-roles": "APPEAL_HANDLER", "x-locale": "nb" };

let seq = 0;
const tag = (name: string) => `5a1 ${name} ${RUN}-${seq++}`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(async () => {
  await prisma.$disconnect();
});

async function learner() {
  const suffix = `${RUN}-${seq++}`;
  const headers = {
    "x-user-id": `lock-5a1-p-${suffix}`,
    "x-user-email": `lock.5a1.p.${suffix}@x.test`,
    "x-user-name": "Deltaker",
    "x-user-department": "Learning",
    "x-user-roles": "PARTICIPANT",
    "x-locale": "nb",
  };
  const user = await prisma.user.create({
    data: { externalId: headers["x-user-id"], email: headers["x-user-email"], name: headers["x-user-name"], department: headers["x-user-department"] },
    select: { id: true },
  });
  return { headers, userId: user.id };
}

async function createModule(title: string) {
  const source = await prisma.moduleVersion.findFirstOrThrow({
    where: { module: { activeVersionId: { not: null } } },
    select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    orderBy: { createdAt: "asc" },
  });
  const module = await prisma.module.create({ data: { title: JSON.stringify(L(title)) }, select: { id: true } });
  const version = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      taskText: JSON.stringify(L(`${title} oppgave`)),
      assessorExpectedContent: JSON.stringify(L(`${title} fasit`)),
      rubricVersionId: source.rubricVersionId,
      promptTemplateVersionId: source.promptTemplateVersionId,
      mcqSetVersionId: source.mcqSetVersionId,
      publishedAt: new Date(),
    },
    select: { id: true, rubricVersionId: true, promptTemplateVersionId: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version.id } });
  return { moduleId: module.id, versionId: version.id, version };
}

/** En ny versjon blir aktiv, slik en publisering gjør det. */
async function publishNewModuleVersion(client: Pick<typeof prisma, "moduleVersion" | "module">, moduleId: string, versionNo = 2) {
  const old = await client.moduleVersion.findFirstOrThrow({ where: { moduleId }, orderBy: { versionNo: "desc" } });
  const next = await client.moduleVersion.create({
    data: {
      moduleId,
      versionNo,
      taskText: JSON.stringify(L("Ny oppgave")),
      assessorExpectedContent: old.assessorExpectedContent,
      rubricVersionId: old.rubricVersionId,
      promptTemplateVersionId: old.promptTemplateVersionId,
      mcqSetVersionId: old.mcqSetVersionId,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  await client.module.update({ where: { id: moduleId }, data: { activeVersionId: next.id } });
  return next.id;
}

async function createSection(title: string) {
  const section = await prisma.courseSection.create({ data: { title: JSON.stringify(L(title)) }, select: { id: true } });
  const version = await prisma.courseSectionVersion.create({
    data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Tekst.")), publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
  return { sectionId: section.id, versionId: version.id };
}

async function publishNewSectionVersion(client: Pick<typeof prisma, "courseSectionVersion" | "courseSection">, sectionId: string) {
  const next = await client.courseSectionVersion.create({
    data: { sectionId, versionNo: 2, bodyMarkdown: JSON.stringify(L("Ny tekst.")), publishedAt: new Date() },
    select: { id: true },
  });
  await client.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: next.id } });
  return next.id;
}

/** Publisert kurs med en modul og en seksjon. */
async function createCourse(name: string) {
  const module = await createModule(tag(`${name} modul`));
  const section = await createSection(tag(`${name} seksjon`));
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(L(tag(name))),
      certificationLevel: "basic",
      publishedAt: new Date(),
      slug: `lock-5a1-${RUN}-${seq++}`,
      items: {
        create: [
          { itemType: "MODULE", moduleId: module.moduleId, sortOrder: 0 },
          { itemType: "SECTION", sectionId: section.sectionId, sortOrder: 1 },
        ],
      },
    },
    select: { id: true },
  });
  return { courseId: course.id, module, section };
}

async function pass(userId: string, module: Awaited<ReturnType<typeof createModule>>) {
  const submission = await prisma.submission.create({
    data: { userId, moduleId: module.moduleId, moduleVersionId: module.versionId, deliveryType: "text", responseJson: "{}", submissionStatus: "COMPLETED" },
    select: { id: true },
  });
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id,
      moduleVersionId: module.versionId,
      rubricVersionId: module.version.rubricVersionId,
      promptTemplateVersionId: module.version.promptTemplateVersionId,
      mcqScaledScore: 80,
      practicalScaledScore: 10,
      totalScore: 90,
      redFlagsJson: "[]",
      passFailTotal: true,
      decisionType: "AUTOMATIC",
      decisionReason: "Bestått.",
      finalisedById: userId,
    },
    select: { id: true },
  });
  await prisma.certificationStatus.create({
    data: { userId, moduleId: module.moduleId, latestDecisionId: decision.id, status: "ACTIVE", passedAt: new Date() },
  });
  return { submissionId: submission.id, decisionId: decision.id };
}

/** Deltakeren har bestått modulen og lest seksjonen: alt er klart for kursbevis. */
async function ready(course: Awaited<ReturnType<typeof createCourse>>, userId: string) {
  await pass(userId, course.module);
  await prisma.courseSectionRead.create({ data: { userId, courseId: course.courseId, sectionId: course.section.sectionId } });
}

const certificates = (userId: string, courseId: string) => prisma.courseCompletion.findMany({ where: { userId, courseId } });
const fromWorker = (userId: string, moduleId: string) =>
  deliverOutboxEvent({ type: OUTBOX_EVENT_TYPES.courseCompletionCheck, payloadJson: JSON.stringify({ userId, moduleId }) });

/**
 * Holder en lås til testen slipper den. `release(fn)` kjører `fn` i transaksjonen før commit: det en samtidig endring gjør.
 * Forespørsler startes utenfor callbacken (se øverst).
 */
function hold<TX>(open: (callback: (tx: TX) => Promise<void>) => Promise<void>) {
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => { markHeld = resolve; });
  let release!: (fn?: (tx: TX) => Promise<unknown>) => void;
  const released = new Promise<((tx: TX) => Promise<unknown>) | undefined>((resolve) => { release = resolve; });
  const done = open(async (tx) => {
    markHeld();
    const fn = await released;
    if (fn) await fn(tx);
  });
  return { held, release, done };
}
const holdContent = () => hold<ContentWriteTx>((cb) => runContentWrite(cb, { timeout: 15_000 }));
const holdLearner = (userId: string) => hold<LearnerTx>((cb) => runLearnerWrite(userId, cb, { timeout: 15_000 }));

/** Har løftet ikke kommet ennå? (Det står og venter på en lås.) */
async function stillWaiting(promise: Promise<unknown>, ms = 400) {
  let settled = false;
  const tracked = promise.then(() => { settled = true; }, () => { settled = true; });
  await Promise.race([tracked, pause(ms)]);
  return !settled;
}

describe("#934 5a-1: innleveringen sender versjonen deltakeren så", () => {
  async function submit(headers: Record<string, string>, moduleId: string, moduleVersionId?: string) {
    return request(app).post("/api/submissions").set(headers).send({
      moduleId,
      ...(moduleVersionId === undefined ? {} : { moduleVersionId }),
      deliveryType: "text",
      responseJson: { response: "Svaret mitt.", reflection: "Refleksjon.", promptExcerpt: "Utdrag." },
    });
  }
  const submissions = (userId: string, moduleId: string) => prisma.submission.findMany({ where: { userId, moduleId } });

  it("versjonen siden viste, registreres", async () => {
    const { headers, userId } = await learner();
    const module = await createModule(tag("riktig"));
    const seen = await seenModuleVersionId(app, headers, module.moduleId);
    expect(seen).toBe(module.versionId);
    const response = await submit(headers, module.moduleId, seen);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(201);
    expect((await submissions(userId, module.moduleId)).map((s) => s.moduleVersionId)).toEqual([module.versionId]);
  });

  it("versjonen er ikke lenger aktiv: 409 module_version_changed, og ingenting er skrevet", async () => {
    const { headers, userId } = await learner();
    const module = await createModule(tag("utdatert"));
    const seen = await seenModuleVersionId(app, headers, module.moduleId);
    const newest = await publishNewModuleVersion(prisma, module.moduleId);
    const response = await submit(headers, module.moduleId, seen);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("module_version_changed");
    expect(await submissions(userId, module.moduleId)).toEqual([]);
    // Etter at siden er lastet på nytt, går det.
    expect(await seenModuleVersionId(app, headers, module.moduleId)).toBe(newest);
    expect((await submit(headers, module.moduleId, newest)).status).toBe(201);
  });

  it("versjonen mangler (en fane fra før utrullingen): 409 client_outdated, og ingenting er skrevet", async () => {
    const { headers, userId } = await learner();
    const module = await createModule(tag("mangler"));
    const response = await submit(headers, module.moduleId);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("client_outdated");
    expect(await submissions(userId, module.moduleId)).toEqual([]);
  });

  it("en publisering som holder låsen idet innleveringen kommer: den venter, ser den nye versjonen, og svarer 409", async () => {
    const { headers, userId } = await learner();
    const module = await createModule(tag("kappløp"));
    const seen = await seenModuleVersionId(app, headers, module.moduleId);
    const lock = holdContent();
    await lock.held;
    const pending = submit(headers, module.moduleId, seen).then((r) => r);
    // Sjekken før låsen slipper den gjennom (den gamle versjonen er fortsatt aktiv). Det er sjekken etter som avgjør.
    expect(await stillWaiting(pending)).toBe(true);
    lock.release((tx) => publishNewModuleVersion(tx, module.moduleId));
    await lock.done;
    const response = await pending;
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("module_version_changed");
    expect(await submissions(userId, module.moduleId)).toEqual([]);
  }, 20_000);

  it("innholdslåsen holdes for lenge: 503 content_busy, ingenting skrevet, og et nytt forsøk går", async () => {
    const { headers, userId } = await learner();
    const module = await createModule(tag("opptatt"));
    const seen = await seenModuleVersionId(app, headers, module.moduleId);
    const lock = holdContent();
    await lock.held;
    const response = await submit(headers, module.moduleId, seen);
    lock.release();
    await lock.done;
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("content_busy");
    expect(await submissions(userId, module.moduleId)).toEqual([]);
    expect((await submit(headers, module.moduleId, seen)).status).toBe(201);
  }, 20_000);

  it("deltakerlåsen holdes (et vedtak pågår): innleveringen venter på den", async () => {
    const { headers, userId } = await learner();
    const module = await createModule(tag("deltakerlås"));
    const seen = await seenModuleVersionId(app, headers, module.moduleId);
    const lock = holdLearner(userId);
    await lock.held;
    const pending = submit(headers, module.moduleId, seen).then((r) => r);
    expect(await stillWaiting(pending)).toBe(true);
    expect(await submissions(userId, module.moduleId)).toEqual([]);
    lock.release();
    await lock.done;
    expect((await pending).status).toBe(201);
  }, 20_000);
});

describe("#934 5a-1: lesingen sender versjonen deltakeren så", () => {
  const reads = (userId: string, courseId: string) => prisma.courseSectionRead.findMany({ where: { userId, courseId } });
  const post = (headers: Record<string, string>, courseId: string, sectionId: string, body?: object) =>
    request(app).post(`/api/courses/${courseId}/sections/${sectionId}/read`).set(headers).send(body);

  it("GET gir versjonen teksten kom fra, og samme versjon tilbake registrerer lesingen", async () => {
    const { headers, userId } = await learner();
    const course = await createCourse("lesing-riktig");
    const shown = await request(app).get(`/api/courses/${course.courseId}/sections/${course.section.sectionId}`).set(headers);
    expect(shown.status).toBe(200);
    expect(shown.body.sectionVersionId).toBe(course.section.versionId);
    const response = await post(headers, course.courseId, course.section.sectionId, { sectionVersionId: shown.body.sectionVersionId });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(204);
    expect(await reads(userId, course.courseId)).toHaveLength(1);
  });

  it("versjonen er ikke lenger aktiv: 409 section_version_changed, og ingenting er skrevet", async () => {
    const { headers, userId } = await learner();
    const course = await createCourse("lesing-utdatert");
    await publishNewSectionVersion(prisma, course.section.sectionId);
    const response = await post(headers, course.courseId, course.section.sectionId, { sectionVersionId: course.section.versionId });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("section_version_changed");
    expect(await reads(userId, course.courseId)).toEqual([]);
  });

  it("lesing med en versjon som ikke er tekst: 400 validation_error, og ingenting er skrevet", async () => {
    const { headers, userId } = await learner();
    const course = await createCourse("lesing-ugyldig");
    const response = await post(headers, course.courseId, course.section.sectionId, { sectionVersionId: 7 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("validation_error");
    expect(await reads(userId, course.courseId)).toEqual([]);
  });

  it("versjonen mangler (en fane fra før utrullingen): 409 client_outdated, og ingenting er skrevet", async () => {
    const { headers, userId } = await learner();
    const course = await createCourse("lesing-mangler");
    for (const body of [undefined, {}, { sectionVersionId: "" }, { sectionVersionId: null }]) {
      const response = await post(headers, course.courseId, course.section.sectionId, body);
      expect(response.status).toBe(409);
      expect(response.body.error).toBe("client_outdated");
    }
    expect(await reads(userId, course.courseId)).toEqual([]);
  });

  it("en publisering som holder låsen idet lesingen kommer: den venter, og svarer 409", async () => {
    const { headers, userId } = await learner();
    const course = await createCourse("lesing-kappløp");
    const lock = holdContent();
    await lock.held;
    const pending = post(headers, course.courseId, course.section.sectionId, { sectionVersionId: course.section.versionId }).then((r) => r);
    expect(await stillWaiting(pending)).toBe(true);
    lock.release((tx) => publishNewSectionVersion(tx, course.section.sectionId));
    await lock.done;
    const response = await pending;
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("section_version_changed");
    expect(await reads(userId, course.courseId)).toEqual([]);
  }, 20_000);

  it("seksjonen tas ut av kurset mens lesingen venter: 404, og ingenting er skrevet — også medlemskapet sjekkes etter låsen", async () => {
    const { headers, userId } = await learner();
    const course = await createCourse("lesing-tatt-ut");
    const lock = holdContent();
    await lock.held;
    const pending = post(headers, course.courseId, course.section.sectionId, { sectionVersionId: course.section.versionId }).then((r) => r);
    expect(await stillWaiting(pending)).toBe(true);
    lock.release((tx) => tx.courseItem.deleteMany({ where: { courseId: course.courseId, sectionId: course.section.sectionId } }));
    await lock.done;
    expect((await pending).status).toBe(404);
    expect(await reads(userId, course.courseId)).toEqual([]);
  }, 20_000);

  it("deltakerlåsen holdes for lenge: 503 content_busy, og ingenting er skrevet", async () => {
    const { headers, userId } = await learner();
    const course = await createCourse("lesing-deltakerlås");
    const lock = holdLearner(userId);
    await lock.held;
    const response = await post(headers, course.courseId, course.section.sectionId, { sectionVersionId: course.section.versionId });
    lock.release();
    await lock.done;
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("content_busy");
    expect(await reads(userId, course.courseId)).toEqual([]);
  }, 20_000);
});

describe("#934 5a-1: kursbeviset måles og skrives under låsene, fra alle tre veiene inn", () => {
  // De tre veiene: alt er klart for bevis, bortsett fra at lesingen er det siste som mangler når den er veien inn.
  const ways: Array<{ name: string; prepare: (c: Awaited<ReturnType<typeof createCourse>>, userId: string) => Promise<unknown>; run: (c: Awaited<ReturnType<typeof createCourse>>, u: { headers: Record<string, string>; userId: string }) => Promise<unknown> }> = [
    {
      name: "workeren (outboxen)",
      prepare: (c, userId) => ready(c, userId),
      run: (c, u) => fromWorker(u.userId, c.module.moduleId),
    },
    {
      name: "kursbevissiden (GET /completions)",
      prepare: (c, userId) => ready(c, userId),
      run: (c, u) => request(app).get("/api/courses/completions").set(u.headers).then((r) => r),
    },
    {
      name: "lesingen av siste seksjon",
      prepare: (c, userId) => pass(userId, c.module),
      run: (c, u) => request(app).post(`/api/courses/${c.courseId}/sections/${c.section.sectionId}/read`).set(u.headers).send({ sectionVersionId: c.section.versionId }).then((r) => r),
    },
  ];

  for (const way of ways) {
    it(`${way.name}: en ny hovedversjon som holder låsen → beviset venter, og gjelder den nye versjonen`, async () => {
      const u = await learner();
      const course = await createCourse(`hoved ${way.name}`);
      await way.prepare(course, u.userId);
      const lock = holdContent();
      await lock.held;
      const pending = way.run(course, u);
      expect(await stillWaiting(pending)).toBe(true);
      expect(await certificates(u.userId, course.courseId)).toEqual([]);
      lock.release((tx) => tx.course.update({ where: { id: course.courseId }, data: { versionMajor: 2 } }));
      await lock.done;
      await pending;
      expect((await certificates(u.userId, course.courseId)).map((c) => c.versionMajor)).toEqual([2]);
    }, 20_000);

    it(`${way.name}: kravet endres mens den venter → beviset måles mot det nye kravet, og utstedes ikke`, async () => {
      const u = await learner();
      const course = await createCourse(`krav ${way.name}`);
      await way.prepare(course, u.userId);
      const extra = await createSection(tag("ny seksjon i kravet"));
      const lock = holdContent();
      await lock.held;
      const pending = way.run(course, u);
      expect(await stillWaiting(pending)).toBe(true);
      lock.release((tx) => tx.courseItem.create({ data: { courseId: course.courseId, itemType: "SECTION", sectionId: extra.sectionId, sortOrder: 2 } }));
      await lock.done;
      await pending;
      expect(await certificates(u.userId, course.courseId)).toEqual([]);
    }, 20_000);

    it(`${way.name}: en anke som snur en bestått mens utstedelsen venter på deltakerlåsen → ikke noe bevis`, async () => {
      const u = await learner();
      const course = await createCourse(`anke ${way.name}`);
      await way.prepare(course, u.userId);
      const lock = holdLearner(u.userId);
      await lock.held;
      const pending = way.run(course, u);
      expect(await stillWaiting(pending)).toBe(true);
      expect(await certificates(u.userId, course.courseId)).toEqual([]);
      lock.release((tx) => tx.certificationStatus.update({ where: { userId_moduleId: { userId: u.userId, moduleId: course.module.moduleId } }, data: { status: "NOT_CERTIFIED", passedAt: null } }));
      await lock.done;
      await pending;
      expect(await certificates(u.userId, course.courseId)).toEqual([]);
    }, 20_000);
  }

  it("en lesing som venter på innholdslåsen, holder ikke deltakerlåsen: innholdslåsen tas først, og et vedtak slipper forbi", async () => {
    const u = await learner();
    const course = await createCourse("rekkefølge");
    const lock = holdContent();
    await lock.held;
    const pending = request(app).post(`/api/courses/${course.courseId}/sections/${course.section.sectionId}/read`).set(u.headers).send({ sectionVersionId: course.section.versionId }).then((r) => r);
    expect(await stillWaiting(pending)).toBe(true);
    // Hadde lesingen tatt deltakerlåsen først, ville dette ventet på den, og den igjen på innholdslåsen.
    await expect(runLearnerWrite(u.userId, async () => "ok")).resolves.toBe("ok");
    lock.release();
    await lock.done;
    expect((await pending).status).toBe(204);
  }, 20_000);

  it("to deltakere venter ikke på hverandre: låsen er per person", async () => {
    const a = await learner();
    const b = await learner();
    const course = await createCourse("to personer");
    const lock = holdLearner(a.userId);
    await lock.held;
    const started = Date.now();
    const other = await request(app).post(`/api/courses/${course.courseId}/sections/${course.section.sectionId}/read`).set(b.headers).send({ sectionVersionId: course.section.versionId });
    const elapsed = Date.now() - started;
    lock.release();
    await lock.done;
    expect(other.status).toBe(204);
    expect(elapsed).toBeLessThan(2_500);
  }, 20_000);

  it("kursbevissiden gir opp samme runde når noen skriver innhold: 200 med det som finnes, og beviset kommer neste gang", async () => {
    const u = await learner();
    const a = await createCourse("siden a");
    const b = await createCourse("siden b");
    await ready(a, u.userId);
    await ready(b, u.userId);
    const lock = holdContent();
    await lock.held;
    const started = Date.now();
    const page = await request(app).get("/api/courses/completions").set(u.headers);
    const elapsed = Date.now() - started;
    lock.release();
    await lock.done;
    expect(page.status).toBe(200);
    expect(page.body.completions).toEqual([]);
    // Én venting på 3 sekunder, ikke én per kurs.
    expect(elapsed).toBeGreaterThanOrEqual(2_500);
    expect(elapsed).toBeLessThan(5_500);
    const next = await request(app).get("/api/courses/completions").set(u.headers);
    expect((next.body.completions as Array<{ courseId: string }>).map((c) => c.courseId).sort()).toEqual([a.courseId, b.courseId].sort());
  }, 20_000);

  it("kursbevissiden uten noe å utstede tar ingen lås: den svarer med en gang mens noen skriver innhold", async () => {
    const u = await learner();
    await createCourse("ingenting å utstede");
    const lock = holdContent();
    await lock.held;
    const started = Date.now();
    const page = await request(app).get("/api/courses/completions").set(u.headers);
    const elapsed = Date.now() - started;
    lock.release();
    await lock.done;
    expect(page.status).toBe(200);
    expect(elapsed).toBeLessThan(2_500);
  }, 20_000);

  it("workeren får ikke låsen: kaster content_busy, så outboxen prøver igjen, og et nytt forsøk utsteder", async () => {
    const u = await learner();
    const course = await createCourse("worker opptatt");
    await ready(course, u.userId);
    const lock = holdContent();
    await lock.held;
    const attempt = await fromWorker(u.userId, course.module.moduleId).then(() => null, (error: unknown) => error);
    lock.release();
    await lock.done;
    expect(attempt).toMatchObject({ code: "content_busy", httpStatus: 503 });
    expect(await certificates(u.userId, course.courseId)).toEqual([]);
    await fromWorker(u.userId, course.module.moduleId);
    expect(await certificates(u.userId, course.courseId)).toHaveLength(1);
  }, 20_000);

  it("en ekte hovedversjon gjennom skjemaet samtidig med utstedelsen: beviset og e-postraden stemmer, uansett hvem som kom først", async () => {
    // Funnet fra QA-porten 2.132.0 (kjent mangel 25): et bevis skrevet like etter at mottakerne ble talt, ga aldri e-post.
    for (let round = 0; round < 4; round += 1) {
      const holder = await learner();
      const u = await learner();
      const course = await createCourse(`samtidig ${round}`);
      // Noen har bevis fra før, ellers blir det ikke en hovedversjon.
      await prisma.courseCompletion.create({ data: { userId: holder.userId, courseId: course.courseId, versionMajor: 1, versionMinor: 0, moduleSnapshotJson: "[]" } });
      await ready(course, u.userId);
      const extra = await createSection(tag("ny seksjon"));
      const detail = await request(app).get(`/api/admin/content/courses/${course.courseId}`).set(ADMIN);
      const save = request(app).put(`/api/admin/content/courses/${course.courseId}/content`).set(ADMIN).send({
        items: [
          { type: "MODULE", moduleId: course.module.moduleId },
          { type: "SECTION", sectionId: course.section.sectionId },
          { type: "SECTION", sectionId: extra.sectionId },
        ],
        version: "major",
        expectedRevision: detail.body.course.contentRevision,
      }).then((r) => r);
      const [saved] = await Promise.all([save, fromWorker(u.userId, course.module.moduleId), request(app).get("/api/courses/completions").set(u.headers).then((r) => r)]);
      expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
      const own = await certificates(u.userId, course.courseId);
      const notices = await prisma.courseVersionNotice.findMany({ where: { courseId: course.courseId, userId: u.userId } });
      // Den nye seksjonen er ikke lest, så det kan bare finnes et bevis for den gamle versjonen.
      expect(own.every((c) => c.versionMajor === 1)).toBe(true);
      expect(notices.length, `runde ${round}: ${own.length} bevis, ${notices.length} rader`).toBe(own.length);
    }
  }, 60_000);

  it("beviset først, så hovedversjonen, begge bak en lås som holdes: personen har beviset og står på e-postlista", async () => {
    // Runden over kan ende med null bevis og null rader. Her er rekkefølgen tvunget: utstedelsen står i kø først.
    const holder = await learner();
    const u = await learner();
    const course = await createCourse("bevis først");
    await prisma.courseCompletion.create({ data: { userId: holder.userId, courseId: course.courseId, versionMajor: 1, versionMinor: 0, moduleSnapshotJson: "[]" } });
    await ready(course, u.userId);
    const extra = await createSection(tag("ny seksjon"));
    const detail = await request(app).get(`/api/admin/content/courses/${course.courseId}`).set(ADMIN);

    const lock = holdContent();
    await lock.held;
    const issuing = fromWorker(u.userId, course.module.moduleId);
    expect(await stillWaiting(issuing), "utstedelsen skal vente på innholdslåsen").toBe(true);
    const save = request(app).put(`/api/admin/content/courses/${course.courseId}/content`).set(ADMIN).send({
      items: [
        { type: "MODULE", moduleId: course.module.moduleId },
        { type: "SECTION", sectionId: course.section.sectionId },
        { type: "SECTION", sectionId: extra.sectionId },
      ],
      version: "major",
      expectedRevision: detail.body.course.contentRevision,
    }).then((r) => r);
    await pause(300);
    lock.release();
    await lock.done;
    const [saved] = await Promise.all([save, issuing]);

    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    expect((await certificates(u.userId, course.courseId)).map((c) => c.versionMajor)).toEqual([1]);
    expect(await prisma.courseVersionNotice.count({ where: { courseId: course.courseId, userId: u.userId } })).toBe(1);
  }, 30_000);
});

describe("#934 5a-1: vedtakene tar deltakerlåsen", () => {
  async function submissionWithDecision() {
    const u = await learner();
    const module = await createModule(tag("vedtak"));
    const passed = await pass(u.userId, module);
    return { ...u, module, ...passed };
  }

  it("manuell vurdering (POST /api/reviews/:id/override) venter på deltakerlåsen", async () => {
    const s = await submissionWithDecision();
    const review = await prisma.manualReview.create({ data: { submissionId: s.submissionId, triggerReason: "Test", reviewStatus: "OPEN" }, select: { id: true } });
    expect((await request(app).post(`/api/reviews/${review.id}/claim`).set(REVIEWER)).status).toBe(200);
    const lock = holdLearner(s.userId);
    await lock.held;
    const pending = request(app).post(`/api/reviews/${review.id}/override`).set(REVIEWER).send({ passFailTotal: false, decisionReason: "Stryk etter vurdering.", overrideReason: "For tynt." }).then((r) => r);
    expect(await stillWaiting(pending)).toBe(true);
    expect(await prisma.assessmentDecision.count({ where: { submissionId: s.submissionId } })).toBe(1);
    lock.release();
    await lock.done;
    const response = await pending;
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await prisma.assessmentDecision.count({ where: { submissionId: s.submissionId } })).toBe(2);
  }, 20_000);

  it("anke (POST /api/appeals/:id/resolve) venter på deltakerlåsen", async () => {
    const s = await submissionWithDecision();
    const appeal = await prisma.appeal.create({ data: { submissionId: s.submissionId, appealedById: s.userId, appealReason: "Jeg ber om en ny vurdering.", appealStatus: "OPEN" }, select: { id: true } });
    expect((await request(app).post(`/api/appeals/${appeal.id}/claim`).set(HANDLER)).status).toBe(200);
    const lock = holdLearner(s.userId);
    await lock.held;
    const pending = request(app).post(`/api/appeals/${appeal.id}/resolve`).set(HANDLER).send({ passFailTotal: false, decisionReason: "Stryk etter anke.", resolutionNote: "Ny vurdering er gjort." }).then((r) => r);
    expect(await stillWaiting(pending)).toBe(true);
    expect(await prisma.assessmentDecision.count({ where: { submissionId: s.submissionId } })).toBe(1);
    lock.release();
    await lock.done;
    const response = await pending;
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    expect(await prisma.assessmentDecision.count({ where: { submissionId: s.submissionId } })).toBe(2);
  }, 20_000);

  async function runningJob(submissionId: string) {
    const lockedAt = new Date();
    const job = await prisma.assessmentJob.create({
      data: { submissionId, status: "RUNNING", lockedBy: "test-worker", lockedAt, maxAttempts: 3 },
      select: { id: true },
    });
    return { jobId: job.id, fence: { lockedBy: "test-worker", lockedAt } };
  }

  it("flervalg alene (createMcqOnlyDecision) venter på deltakerlåsen, for den som leverte", async () => {
    const s = await submissionWithDecision();
    const job = await runningJob(s.submissionId);
    const lock = holdLearner(s.userId);
    await lock.held;
    const pending = createMcqOnlyDecision({
      ...job,
      submissionId: s.submissionId,
      userId: s.userId,
      moduleVersionId: s.module.versionId,
      mcqScaledScore: 90,
      mcqPercentScore: 90,
      assessmentPolicy: null,
    });
    expect(await stillWaiting(pending)).toBe(true);
    lock.release();
    await lock.done;
    await pending;
    expect(await prisma.assessmentDecision.count({ where: { submissionId: s.submissionId } })).toBe(2);
  }, 20_000);

  it("automatisk vurdering (createAssessmentDecision) venter på deltakerlåsen, for den som leverte", async () => {
    const s = await submissionWithDecision();
    const job = await runningJob(s.submissionId);
    const lock = holdLearner(s.userId);
    await lock.held;
    const pending = createAssessmentDecision({
      ...job,
      submissionId: s.submissionId,
      userId: s.userId,
      moduleVersionId: s.module.versionId,
      rubricVersionId: s.module.version.rubricVersionId!,
      promptTemplateVersionId: s.module.version.promptTemplateVersionId!,
      mcqScaledScore: 30,
      mcqPercentScore: 75,
      llmResult: {
        module_id: s.module.moduleId,
        rubric_scores: { a: 3 },
        rubric_total: 15,
        practical_score_scaled: 48,
        pass_fail_practical: true,
        criterion_rationales: { a: "Bra" },
        improvement_advice: [],
        red_flags: [],
        manual_review_recommended: false,
        confidence_note: "Sikker",
        evidence_sufficiency: "sufficient",
        recommended_outcome: "pass",
        manual_review_reason_code: "none",
      },
      assessmentPolicy: null,
      rubricMaxTotal: 20,
      rubricCriteriaIds: ["a"],
    } as never);
    expect(await stillWaiting(pending)).toBe(true);
    lock.release();
    await lock.done;
    await pending;
    expect(await prisma.assessmentDecision.count({ where: { submissionId: s.submissionId } })).toBe(2);
  }, 20_000);
});
