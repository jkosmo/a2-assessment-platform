import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { resolveShownMajorForScope, ShownMajorScopeOutdatedError } from "../src/modules/module/participantModuleVersion.js";

// #1140 etappe 1 (doc/design/PLAN_1140_E1.md): hvilken versjon av en modul en deltaker får.
//
// Regelen: kurset modulen åpnes fra (`courseId`), bestemmer når deltakeren har modulen i det. Uten kjent kurs gjelder reserven:
// den høyeste hovedversjonen blant kursene deltakeren har tilgang til som inneholder modulen. I begge gis den nyeste publiserte
// versjonen innen hovedversjonen, og et kurs uten låst hovedversjon følger modulens nyeste. Uten kurs: modulens nyeste.
//
// Ingen kode skriver `CourseModuleRequirement.shownModuleMajor` i etappe 1, så testene setter feltet rett i databasen. Alt går
// gjennom rutene klienten bruker: `GET /api/modules`, `GET /api/modules/:id`, `GET …/active-version` og `POST /api/submissions`.
// Regelen for hvilke beståtte som teller i et kurs (`minModuleMajor`) er urørt og prøvd i m2-module-credit-934-5a2.test.ts.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
let seq = 0;
const tag = (name: string) => `1140e1 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

function headersFor(role: string) {
  const suffix = `${RUN}-${seq++}`;
  return {
    "x-user-id": `mv-1140-${suffix}`,
    "x-user-email": `mv.1140.${suffix}@x.test`,
    "x-user-name": "Person",
    "x-user-department": "Learning",
    "x-user-roles": role,
    "x-locale": "nb",
  };
}

async function learner() {
  const headers = headersFor("PARTICIPANT");
  const user = await prisma.user.create({
    data: { externalId: headers["x-user-id"], email: headers["x-user-email"], name: headers["x-user-name"], department: headers["x-user-department"] },
    select: { id: true },
  });
  return { headers, userId: user.id };
}

/** En modul med publiserte versjoner med disse numrene, i rekkefølge. Den siste er aktiv. Svaret er nummer → versjonens id. */
async function moduleWithVersions(name: string, numbers: Array<[number, number]>) {
  const source = await prisma.moduleVersion.findFirstOrThrow({
    where: { module: { activeVersionId: { not: null } } },
    select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    orderBy: { createdAt: "asc" },
  });
  const title = tag(name);
  const module = await prisma.module.create({ data: { title: JSON.stringify(L(title)) }, select: { id: true } });
  const versions = new Map<string, string>();
  let last = "";
  for (const [index, [major, minor]] of numbers.entries()) {
    const version = await prisma.moduleVersion.create({
      data: {
        moduleId: module.id,
        versionNo: index + 1,
        versionMajor: major,
        versionMinor: minor,
        taskText: JSON.stringify(L(`${title} oppgave ${major}.${minor}`)),
        assessorExpectedContent: JSON.stringify(L("Fasit")),
        rubricVersionId: source.rubricVersionId,
        promptTemplateVersionId: source.promptTemplateVersionId,
        mcqSetVersionId: source.mcqSetVersionId,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    versions.set(`${major}.${minor}`, version.id);
    last = version.id;
  }
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: last } });
  return { moduleId: module.id, title, v: (number: string) => versions.get(number) as string };
}

/** Et kurs med modulen. `shown` er hovedversjonen kurset har låst (utelatt = følger modulens nyeste). */
async function courseWith(
  moduleId: string,
  options: { shown?: number; published?: boolean; archived?: boolean; policy?: "OPEN" | "RESTRICTED" } = {},
) {
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(L(tag("kurs"))),
      enrollmentPolicy: options.policy ?? "OPEN",
      publishedAt: options.published === false ? null : new Date(),
      archivedAt: options.archived ? new Date() : null,
      items: { create: [{ itemType: "MODULE", moduleId, sortOrder: 0 }] },
      moduleRequirements: { create: [{ moduleId, minModuleMajor: 1, shownModuleMajor: options.shown ?? null }] },
    },
    select: { id: true },
  });
  return course.id;
}

type ListedModule = { id: string; taskText: string | null; activeVersion: { id: string; versionMajor: number | null; versionMinor: number | null } | null };

async function listed(headers: Record<string, string>, moduleId: string, query = "") {
  const response = await request(app).get(`/api/modules${query}`).set(headers);
  expect(response.status).toBe(200);
  return (response.body.modules as ListedModule[]).find((module) => module.id === moduleId);
}
const courseQuery = (courseId?: string) => (courseId === undefined ? "" : `?courseId=${encodeURIComponent(courseId)}`);
async function single(headers: Record<string, string>, moduleId: string, courseId?: string) {
  const response = await request(app).get(`/api/modules/${moduleId}${courseQuery(courseId)}`).set(headers);
  expect(response.status).toBe(200);
  return response.body.module as ListedModule;
}
async function activeVersionRoute(headers: Record<string, string>, moduleId: string, courseId?: string) {
  const response = await request(app).get(`/api/modules/${moduleId}/active-version${courseQuery(courseId)}`).set(headers);
  expect(response.status).toBe(200);
  return response.body.activeVersion as { id: string; taskText: string | null };
}
/** `courseId` er kurset modulen ble åpnet fra, slik deltakersiden sender det. */
function submit(headers: Record<string, string>, moduleId: string, moduleVersionId: string, courseId?: string) {
  return request(app).post("/api/submissions").set(headers).send({
    moduleId,
    moduleVersionId,
    ...(courseId === undefined ? {} : { courseId }),
    deliveryType: "text",
    responseJson: { response: "Svaret mitt.", reflection: "Refleksjon.", promptExcerpt: "Utdrag." },
  });
}
const submissions = (userId: string, moduleId: string) => prisma.submission.findMany({ where: { userId, moduleId }, select: { moduleVersionId: true } });

/** Alle tre lesingene klienten og API-et har, skal gi samme versjon. `courseId`: kurset modulen åpnes fra. */
async function expectShown(headers: Record<string, string>, moduleId: string, versionId: string, courseId?: string) {
  expect((await listed(headers, moduleId, courseQuery(courseId)))?.activeVersion?.id, "GET /api/modules").toBe(versionId);
  expect((await single(headers, moduleId, courseId)).activeVersion?.id, "GET /api/modules/:id").toBe(versionId);
  expect((await activeVersionRoute(headers, moduleId, courseId)).id, "GET /api/modules/:id/active-version").toBe(versionId);
}

describe("#1140 etappe 1: uten låst hovedversjon er alt som før", () => {
  it("modul uten kurs, og modul i et kurs uten lås: deltakeren får modulens aktive versjon, og leverer på den", async () => {
    const { headers, userId } = await learner();
    const alone = await moduleWithVersions("alene", [[1, 0], [2, 0]]);
    const inCourse = await moduleWithVersions("i kurs", [[1, 0], [2, 0]]);
    await courseWith(inCourse.moduleId);

    await expectShown(headers, alone.moduleId, alone.v("2.0"));
    await expectShown(headers, inCourse.moduleId, inCourse.v("2.0"));
    expect((await submit(headers, inCourse.moduleId, inCourse.v("2.0"))).status).toBe(201);
    expect((await submit(headers, inCourse.moduleId, inCourse.v("1.0"))).body.error).toBe("module_version_changed");
    expect((await submissions(userId, inCourse.moduleId)).map((s) => s.moduleVersionId)).toEqual([inCourse.v("2.0")]);
  });
});

describe("#1140 etappe 1: kurset modulen åpnes fra, bestemmer", () => {
  it("to åpne kurs på hver sin hovedversjon: deltakeren får kursets egen, i lesingene og i innleveringen", async () => {
    const { headers, userId } = await learner();
    const module = await moduleWithVersions("per og kari", [[1, 0], [1, 1], [2, 0], [2, 1]]);
    const pers = await courseWith(module.moduleId, { shown: 1 });
    const karis = await courseWith(module.moduleId, { shown: 2 });

    await expectShown(headers, module.moduleId, module.v("1.1"), pers);
    await expectShown(headers, module.moduleId, module.v("2.1"), karis);

    // Fra Pers kurs: versjon 2 er ikke den deltakeren skal ha der, og ingenting skrives.
    const wrong = await submit(headers, module.moduleId, module.v("2.1"), pers);
    expect(wrong.status).toBe(409);
    expect(wrong.body.error).toBe("module_version_changed");
    expect(await submissions(userId, module.moduleId)).toEqual([]);

    expect((await submit(headers, module.moduleId, module.v("1.1"), pers)).status).toBe(201);
    expect((await submit(headers, module.moduleId, module.v("2.1"), karis)).status).toBe(201);
    expect((await submit(headers, module.moduleId, module.v("1.1"), karis)).body.error).toBe("module_version_changed");
    expect((await submissions(userId, module.moduleId)).map((s) => s.moduleVersionId).sort()).toEqual([module.v("1.1"), module.v("2.1")].sort());
  });

  it("kurset uten lås følger nyeste, også når et annet tilgjengelig kurs har låst en eldre — og omvendt", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("ulåst og låst", [[1, 0], [2, 0]]);
    const locked = await courseWith(module.moduleId, { shown: 1 });
    const follows = await courseWith(module.moduleId);
    await expectShown(headers, module.moduleId, module.v("1.0"), locked);
    await expectShown(headers, module.moduleId, module.v("2.0"), follows);
  });

  it("uten kurs gjelder reserven: den høyeste blant kursene deltakeren har modulen i", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("reserven", [[1, 0], [2, 0], [3, 0]]);
    await courseWith(module.moduleId, { shown: 1 });
    await courseWith(module.moduleId, { shown: 2 });
    await expectShown(headers, module.moduleId, module.v("2.0"));
    expect((await submit(headers, module.moduleId, module.v("2.0"))).status).toBe(201);
  });

  it("et kurs deltakeren ikke har tilgang til, eller som ikke har modulen, kan ikke bestemme: reserven", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("ikke mitt kurs", [[1, 0], [2, 0], [3, 0]]);
    const closed = await courseWith(module.moduleId, { shown: 1, policy: "RESTRICTED" });
    await courseWith(module.moduleId, { shown: 2 });
    const other = await moduleWithVersions("annen modul", [[1, 0]]);
    const unrelated = await courseWith(other.moduleId);

    for (const courseId of [closed, unrelated, "finnes-ikke", "x".repeat(200)]) {
      await expectShown(headers, module.moduleId, module.v("2.0"), courseId);
    }
    expect((await submit(headers, module.moduleId, module.v("1.0"), closed)).body.error).toBe("module_version_changed");
    expect((await submit(headers, module.moduleId, module.v("2.0"), closed)).status).toBe(201);
  });

  it("uten noen låser endrer kurset ingenting: modulens aktive, som før", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("ingen lås", [[1, 0], [2, 0]]);
    const courseId = await courseWith(module.moduleId);
    await expectShown(headers, module.moduleId, module.v("2.0"), courseId);
    expect((await submit(headers, module.moduleId, module.v("2.0"), courseId)).status).toBe(201);
  });
});

describe("#1140 etappe 1: reserven — et kurs som har låst en hovedversjon, uten at kurset er oppgitt", () => {
  it("låst til 1 mens modulen er på 2.0: deltakeren får siste 1.x, med teksten til den versjonen", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("låst", [[1, 0], [1, 1], [2, 0]]);
    await courseWith(module.moduleId, { shown: 1 });

    await expectShown(headers, module.moduleId, module.v("1.1"));
    const inList = await listed(headers, module.moduleId);
    expect(inList?.activeVersion).toMatchObject({ versionMajor: 1, versionMinor: 1 });
    expect(inList?.taskText).toBe(`${module.title} oppgave 1.1`);
    expect((await activeVersionRoute(headers, module.moduleId)).taskText).toBe(`${module.title} oppgave 1.1`);
  });

  it("innleveringen står på den låste versjonen; modulens nyeste gir 409, og ingenting er skrevet", async () => {
    const { headers, userId } = await learner();
    const module = await moduleWithVersions("lever", [[1, 0], [1, 1], [2, 0]]);
    await courseWith(module.moduleId, { shown: 1 });

    const newest = await submit(headers, module.moduleId, module.v("2.0"));
    expect(newest.status).toBe(409);
    expect(newest.body.error).toBe("module_version_changed");
    expect(await submissions(userId, module.moduleId)).toEqual([]);

    const shown = await submit(headers, module.moduleId, module.v("1.1"));
    expect(shown.status, JSON.stringify(shown.body).slice(0, 300)).toBe(201);
    expect((await submissions(userId, module.moduleId)).map((s) => s.moduleVersionId)).toEqual([module.v("1.1")]);
  });

  it("to kurs, låst til 1 og 2, modulen på 3.0: den høyeste, 2.x", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("to kurs", [[1, 0], [2, 0], [2, 1], [3, 0]]);
    await courseWith(module.moduleId, { shown: 1 });
    await courseWith(module.moduleId, { shown: 2 });
    await expectShown(headers, module.moduleId, module.v("2.1"));
  });

  it("to kurs, ett låst til 1 og ett uten lås: kurset uten lås følger nyeste, og nyeste er høyest", async () => {
    const { headers, userId } = await learner();
    const module = await moduleWithVersions("blandet", [[1, 0], [2, 0]]);
    await courseWith(module.moduleId, { shown: 1 });
    await courseWith(module.moduleId);
    await expectShown(headers, module.moduleId, module.v("2.0"));
    expect((await submit(headers, module.moduleId, module.v("2.0"))).status).toBe(201);
    expect((await submissions(userId, module.moduleId)).map((s) => s.moduleVersionId)).toEqual([module.v("2.0")]);
  });

  it("låsen teller bare i kurs deltakeren har tilgang til: ikke avpublisert, arkivert eller begrenset uten påmelding", async () => {
    const { headers, userId } = await learner();
    for (const options of [{ published: false }, { archived: true }, { policy: "RESTRICTED" as const }]) {
      const module = await moduleWithVersions("utenfor", [[1, 0], [2, 0]]);
      await courseWith(module.moduleId, { shown: 1, ...options });
      await expectShown(headers, module.moduleId, module.v("2.0"));
      // Innleveringen bruker samme regel som lesingen.
      expect((await submit(headers, module.moduleId, module.v("1.0"))).body.error, JSON.stringify(options)).toBe("module_version_changed");
    }
    // KONTROLL: samme begrensede kurs MED påmelding teller, så testen over måler tilgangen og ikke noe annet.
    const module = await moduleWithVersions("påmeldt", [[1, 0], [2, 0]]);
    const courseId = await courseWith(module.moduleId, { shown: 1, policy: "RESTRICTED" });
    await expectShown(headers, module.moduleId, module.v("2.0"));
    await prisma.courseEnrollment.create({ data: { userId, courseId, source: "SELF" } });
    await expectShown(headers, module.moduleId, module.v("1.0"));
    expect((await submit(headers, module.moduleId, module.v("1.0"))).status).toBe(201);
  });

  it("forfatterlesing (adminFacing) får modulens nyeste, også når et åpent kurs har låst en eldre", async () => {
    const admin = headersFor("ADMINISTRATOR");
    const module = await moduleWithVersions("forfatter", [[1, 0], [2, 0]]);
    await courseWith(module.moduleId, { shown: 1 });
    expect((await listed(admin, module.moduleId, "?adminFacing=true"))?.activeVersion?.id).toBe(module.v("2.0"));
    // Samme person i deltakervisningen får det kursene viser.
    expect((await listed(admin, module.moduleId))?.activeVersion?.id).toBe(module.v("1.0"));
  });

  it("en lås som peker på en hovedversjon uten publisert versjon: modulens aktive, aldri «ingen versjon»", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("peker feil", [[1, 0], [2, 0]]);
    await courseWith(module.moduleId, { shown: 7 });
    await expectShown(headers, module.moduleId, module.v("2.0"));
    expect((await submit(headers, module.moduleId, module.v("2.0"))).status).toBe(201);
  });

  it("en upublisert versjon innen hovedversjonen vises ikke og kan ikke leveres på: den nyeste PUBLISERTE", async () => {
    const { headers, userId } = await learner();
    const module = await moduleWithVersions("upublisert", [[1, 0], [1, 1], [2, 0]]);
    await prisma.moduleVersion.update({ where: { id: module.v("1.1") }, data: { publishedAt: null } });
    await courseWith(module.moduleId, { shown: 1 });
    await expectShown(headers, module.moduleId, module.v("1.0"));
    expect((await submit(headers, module.moduleId, module.v("1.1"))).body.error).toBe("module_version_changed");
    expect((await submit(headers, module.moduleId, module.v("1.0"))).status).toBe(201);
    expect((await submissions(userId, module.moduleId)).map((s) => s.moduleVersionId)).toEqual([module.v("1.0")]);
  });
});

describe("#1140 etappe 1: tilgang gjennom en klasse, og det svaret ikke skal røpe", () => {
  const ADMIN = headersFor("ADMINISTRATOR");

  it("begrenset kurs tildelt en klasse deltakeren er medlem av: låsen teller, likt i lista og i innleveringen", async () => {
    const { headers, userId } = await learner();
    const module = await moduleWithVersions("klasse", [[1, 0], [2, 0]]);
    const courseId = await courseWith(module.moduleId, { shown: 1, policy: "RESTRICTED" });
    await expectShown(headers, module.moduleId, module.v("2.0"));

    const created = await request(app).post("/api/admin/content/classes").set(ADMIN).send({ name: tag("klasse") });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const classId = created.body.class.id as string;
    expect((await request(app).post(`/api/admin/content/classes/${classId}/members`).set(ADMIN).send({ userId })).status).toBe(201);
    expect((await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(ADMIN).send({ courseId })).status).toBe(201);

    await expectShown(headers, module.moduleId, module.v("1.0"));
    expect((await submit(headers, module.moduleId, module.v("1.0"))).status).toBe(201);
    expect((await submissions(userId, module.moduleId)).map((s) => s.moduleVersionId)).toEqual([module.v("1.0")]);
  });

  it("et kurs med modulen, men uten rad for kravet, følger nyeste", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("uten rad", [[1, 0], [2, 0]]);
    await courseWith(module.moduleId, { shown: 1 });
    await prisma.course.create({
      data: { title: JSON.stringify(L(tag("kurs uten rad"))), publishedAt: new Date(), items: { create: [{ itemType: "MODULE", moduleId: module.moduleId, sortOrder: 0 }] } },
    });
    await expectShown(headers, module.moduleId, module.v("2.0"));
  });

  it("den eldre versjonen sendes som den aktive: uten fasiten og uten de rå kriteriene (#387, #1124)", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("skjult", [[1, 0], [2, 0]]);
    await courseWith(module.moduleId, { shown: 1 });
    for (const shown of [await listed(headers, module.moduleId), await single(headers, module.moduleId)]) {
      const body = shown as unknown as Record<string, unknown> & { activeVersion: Record<string, unknown> };
      expect(body.activeVersion.id).toBe(module.v("1.0"));
      expect(body.activeVersion).not.toHaveProperty("assessorExpectedContent");
      expect(body.activeVersion).not.toHaveProperty("rubricVersion");
      expect(body).not.toHaveProperty("assessorExpectedContent");
      expect(JSON.stringify(body)).not.toContain("Fasit");
    }
    expect(JSON.stringify(await activeVersionRoute(headers, module.moduleId))).not.toContain("Fasit");
  });

  it("databasen nekter en vist hovedversjon lavere enn kravet", async () => {
    const module = await moduleWithVersions("under kravet", [[1, 0], [2, 0]]);
    const courseId = await courseWith(module.moduleId, { shown: 2 });
    await expect(prisma.courseModuleRequirement.updateMany({ where: { courseId }, data: { minModuleMajor: 3 } })).rejects.toThrow();
    await expect(prisma.courseModuleRequirement.updateMany({ where: { courseId }, data: { minModuleMajor: 2 } })).resolves.toMatchObject({ count: 1 });
  });
});

describe("#1140 etappe 1: grensetilfeller som er notert, ikke løst", () => {
  it("modulens aktive versjon mangler nummer (eldre rader): en lås gir versjonen med den hovedversjonen", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("uten nummer", [[1, 0], [2, 0]]);
    await prisma.moduleVersion.update({ where: { id: module.v("2.0") }, data: { versionMajor: null, versionMinor: null } });
    await courseWith(module.moduleId, { shown: 1 });
    await expectShown(headers, module.moduleId, module.v("1.0"));
  });

  // ⚠️ KJENT MANGEL (planlesingen 2026-11-11, M1), festet her så den ikke endres stille. En forfatter kan sette en eldre versjon
  // i SAMME hovedversjon live igjen (1.1 → tilbake til 1.0). Når modulen så får 2.0, vet ingenting at 1.0 var den siste som
  // gjaldt i hovedversjon 1, og et kurs låst til 1 får 1.1. Ingen kurs kan være låst før etappe 3, og der avgjøres det:
  // forslaget er at en eldre versjon bare kan settes live som ny versjon («Gjenopprett»), slik regelen er for eldre
  // hovedversjoner. Da er «høyest mindre nummer» alltid den som gjaldt sist.
  it("etter en tilbakerulling innen hovedversjonen vises den høyeste, ikke den som gjaldt sist", async () => {
    const { headers } = await learner();
    const module = await moduleWithVersions("tilbakerullet", [[1, 0], [1, 1], [2, 0]]);
    await courseWith(module.moduleId, { shown: 1 });
    await expectShown(headers, module.moduleId, module.v("1.1"));
  });
});

describe("#1140 etappe 1: en lås som dukker opp mens innleveringen er på vei", () => {
  it("kursene ble regnet ut uten låser, og nå finnes en: avbrytes, så kalleren kan be deltakeren laste på nytt", async () => {
    const module = await moduleWithVersions("kappløp", [[1, 0], [2, 0]]);
    expect(await resolveShownMajorForScope(prisma, module.moduleId, null)).toBeNull();
    await courseWith(module.moduleId, { shown: 1 });
    await expect(resolveShownMajorForScope(prisma, module.moduleId, null)).rejects.toBeInstanceOf(ShownMajorScopeOutdatedError);
  });

  it("et kurs fra forberedelsen er avpublisert eller har mistet modulen før låsen: det teller ikke lenger", async () => {
    const module = await moduleWithVersions("endret kurs", [[1, 0], [2, 0]]);
    const locked = await courseWith(module.moduleId, { shown: 1 });
    expect(await resolveShownMajorForScope(prisma, module.moduleId, [locked])).toBe(1);
    await prisma.course.update({ where: { id: locked }, data: { publishedAt: null } });
    expect(await resolveShownMajorForScope(prisma, module.moduleId, [locked])).toBeNull();
    await prisma.course.update({ where: { id: locked }, data: { publishedAt: new Date() } });
    await prisma.courseItem.deleteMany({ where: { courseId: locked } });
    expect(await resolveShownMajorForScope(prisma, module.moduleId, [locked])).toBeNull();
  });
});
