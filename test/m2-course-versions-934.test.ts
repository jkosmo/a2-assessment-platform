import request from "supertest";
import { courseRevision, withRevision } from "./support/courseRevision.js";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { reconcileCourseCompletionsForUser } from "../src/modules/course/index.js";
import { deriveStatus } from "../src/modules/course/enrollmentService.js";
import { applyCourseVersionChange, NO_SECTION_SNAPSHOT, renameSectionInVersionSnapshots } from "../src/modules/course/courseVersioning.js";
import { runContentWrite } from "../src/db/contentLock.js";
import { publishModuleVersion } from "../src/modules/adminContent/adminContentCommands.js";
import { readSection } from "./support/participantFlow.js";
import { recordFixturePass } from "./support/modulePassFixture.js";

// #934 skive 1: kurs har hovedversjon og mindre versjon, og et kursbevis gjelder sin hovedversjon
// (produkteier 2026-11-01, doc/DESIGN_934.md). Ingen flate setter versjonen ennå — testen gjør det
// direkte i databasen, slik skive 3 vil gjøre det gjennom forfatterdialogen (skive 2 lærer først leserne
// å skille versjonene og fjerner den gamle nøkkelen).

describe("#934 kursbevis per hovedversjon", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("et nytt kurs er 1.0, og beviset utstedes for 1.0", async () => {
    const { participant, course } = await courseWithOnePassedModule("ny");
    const fresh = await prisma.course.findUniqueOrThrow({ where: { id: course.id }, select: { versionMajor: true, versionMinor: true } });
    expect(fresh).toEqual({ versionMajor: 1, versionMinor: 0 });

    await reconcileCourseCompletionsForUser(participant.id);
    const bevis = await completions(participant.id, course.id);
    expect(bevis).toEqual([{ versionMajor: 1, versionMinor: 0 }]);
  });

  it("en mindre versjon gir ikke nytt bevis — beviset for hovedversjonen gjelder", async () => {
    const { participant, course } = await courseWithOnePassedModule("mindre");
    await reconcileCourseCompletionsForUser(participant.id);
    await prisma.course.update({ where: { id: course.id }, data: { versionMinor: 1 } });

    await reconcileCourseCompletionsForUser(participant.id);
    expect(await completions(participant.id, course.id)).toEqual([{ versionMajor: 1, versionMinor: 0 }]);
  });

  // Skive 2 (2.128.0): den gamle nøkkelen er fjernet, og leserne skiller versjonene.
  it("en ny hovedversjon gir et nytt bevis når kravet er oppfylt; det gamle står urørt, og det skjer bare én gang", async () => {
    const { participant, course } = await courseWithOnePassedModule("hoved");
    await reconcileCourseCompletionsForUser(participant.id);
    const første = await prisma.courseCompletion.findFirstOrThrow({ where: { userId: participant.id, courseId: course.id } });

    await prisma.course.update({ where: { id: course.id }, data: { versionMajor: 2, versionMinor: 3 } });
    await reconcileCourseCompletionsForUser(participant.id);
    await reconcileCourseCompletionsForUser(participant.id);

    expect(await completions(participant.id, course.id)).toEqual([
      { versionMajor: 1, versionMinor: 0 },
      { versionMajor: 2, versionMinor: 3 },
    ]);
    const gamle = await prisma.courseCompletion.findUniqueOrThrow({ where: { id: første.id } });
    expect(gamle.certificateId).toBe(første.certificateId);
    expect(gamle.completedAt.toISOString()).toBe(første.completedAt.toISOString());
  });

  it("databasen har den unike nøkkelen (bruker, kurs, hovedversjon) — og den gamle (bruker, kurs) er borte", async () => {
    const indekser = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'CourseCompletion' AND indexdef LIKE 'CREATE UNIQUE%'`;
    const def = (navn: string) => indekser.find((i) => i.indexname === navn)?.indexdef ?? "";
    expect(def("CourseCompletion_userId_courseId_versionMajor_key")).toMatch(/\("userId", "courseId", "versionMajor"\)$/);
    expect(indekser.map((i) => i.indexname)).not.toContain("CourseCompletion_userId_courseId_key");
  });

  it("«Mine kurs» og kursbeviset sier hvilken versjon beviset gjelder, og om det er kursets nåværende", async () => {
    const { participant, course, headers } = await courseWithOnePassedModule("api");
    await reconcileCourseCompletionsForUser(participant.id);
    // Versjon 2 har en ny modul deltakeren ikke har tatt: hen har bare bevis for versjon 1.
    const ny = await createPublishedModule(`934 api ny modul ${Date.now()}`);
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "MODULE", moduleId: ny.module.id, sortOrder: 2 } });
    await prisma.course.update({ where: { id: course.id }, data: { versionMajor: 2, versionMinor: 0 } });

    const liste = await request(app).get("/api/courses/completions").set(headers);
    expect(liste.status).toBe(200);
    const forKurset = liste.body.completions.filter((c: { courseId: string }) => c.courseId === course.id);
    expect(forKurset).toEqual([expect.objectContaining({ versionMajor: 1, versionMinor: 0, current: false })]);

    const ett = await request(app).get(`/api/courses/completions/${forKurset[0].certificateId}`).set(headers);
    expect(ett.status).toBe(200);
    expect(ett.body).toMatchObject({ versionMajor: 1, versionMinor: 0, current: false });
  });

  it("kursrapporten teller bevis for nåværende hovedversjon, og en med bare eldre bevis står som «må ta ny versjon»", async () => {
    const { participant, course } = await courseWithOnePassedModule("rapport");
    await reconcileCourseCompletionsForUser(participant.id);
    const ny = await createPublishedModule(`934 rapport ny modul ${Date.now()}`);
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "MODULE", moduleId: ny.module.id, sortOrder: 2 } });
    await prisma.course.update({ where: { id: course.id }, data: { versionMajor: 2, versionMinor: 0 } });
    const admin = { "x-user-id": `v934-admin-${Date.now()}`, "x-user-email": `v934.admin.${Date.now()}@x.test`, "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };

    const sammendrag = await request(app).get("/api/reports/courses").query({ selectedCourseId: course.id }).set(admin);
    expect(sammendrag.status).toBe(200);
    const rad = sammendrag.body.rows.find((r: { courseId: string }) => r.courseId === course.id);
    expect(rad).toMatchObject({ completedParticipants: 0 });
    expect(rad.enrolledParticipants).toBeGreaterThanOrEqual(1);

    const detaljer = await request(app).get("/api/reports/courses/details").query({ selectedCourseId: course.id }).set(admin);
    expect(detaljer.status).toBe(200);
    const deltaker = detaljer.body.rows.find((r: { participantId: string }) => r.participantId === participant.id);
    expect(deltaker).toMatchObject({ status: "NEEDS_NEW_VERSION", earlierCertificateVersion: 1, certificateId: null, completedAt: null });
    expect(detaljer.body.totals).toMatchObject({ completed: 0, needsNewVersion: 1 });

    // Tar hen det nye, får hen bevis for versjon 2 — og står som fullført, telt én gang.
    await createPassedCertification(participant.id, ny);
    await reconcileCourseCompletionsForUser(participant.id);
    const etterpå = await request(app).get("/api/reports/courses/details").query({ selectedCourseId: course.id }).set(admin);
    const igjen = etterpå.body.rows.find((r: { participantId: string }) => r.participantId === participant.id);
    expect(igjen).toMatchObject({ status: "COMPLETED", earlierCertificateVersion: null });
    const sammendrag2 = await request(app).get("/api/reports/courses").query({ selectedCourseId: course.id }).set(admin);
    expect(sammendrag2.body.rows.find((r: { courseId: string }) => r.courseId === course.id)).toMatchObject({ completedParticipants: 1 });
  });

  it("en oppfylt frist står som oppfylt etter en ny hovedversjon (produkteier 2026-11-01)", async () => {
    const { participant, course } = await courseWithOnePassedModule("frist");
    await reconcileCourseCompletionsForUser(participant.id);
    // Versjon 2 har fått en modul deltakeren ikke har tatt — hen har bare bevis for versjon 1.
    const ny = await createPublishedModule(`934 frist ny modul ${Date.now()}`);
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "MODULE", moduleId: ny.module.id, sortOrder: 2 } });
    await prisma.course.update({ where: { id: course.id }, data: { versionMajor: 2, versionMinor: 0 } });
    await reconcileCourseCompletionsForUser(participant.id);
    expect(await completions(participant.id, course.id)).toEqual([{ versionMajor: 1, versionMinor: 0 }]);

    const status = await deriveStatus(participant.id, course.id, new Date(Date.now() - 86_400_000), new Date());
    expect(status).toBe("COMPLETED");
  });
});

// #934 skive 3 (2.129.0): forfatteren velger mindre eller hovedversjon når et publisert kurs endres, og en
// seksjon som er endret siden forrige hovedversjon, leses på nytt. Alt gjennom rutene, som forfatteren og
// deltakeren bruker dem.
describe("#934 skive 3 — forfatterens valg og seksjonsregelen", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("innhold endret som HOVEDVERSJON: 2.0, raden for begge versjoner, og bare det nye gjenstår", async () => {
    const { participant, course, headers } = await courseWithOnePassedModule("s3-hoved");
    const modulId = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } })).moduleId!;
    const seksjon = await createPublishedSection("s3-hoved");
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: seksjon.id, sortOrder: 2 } });
    expect((await readSection(app, headers, course.id, seksjon.id)).status).toBe(204);
    await reconcileCourseCompletionsForUser(participant.id);
    expect(await completions(participant.id, course.id)).toEqual([{ versionMajor: 1, versionMinor: 0 }]);

    // Forfatteren ser versjonen og hvor mange spørsmålet gjelder.
    const før = await request(app).get(`/api/admin/content/courses/${course.id}`).set(admin());
    expect(før.status).toBe(200);
    expect(før.body.course).toMatchObject({ versionMajor: 1, versionMinor: 0, certificateHolders: 1 });

    const ny = await createPublishedModule(`934 s3 ny modul ${Date.now()}`);
    const lagret = await request(app).put(`/api/admin/content/courses/${course.id}/items`).set(admin()).send(await withRevision(course.id, {
      items: [
        { type: "MODULE", moduleId: modulId },
        { type: "SECTION", sectionId: seksjon.id },
        { type: "MODULE", moduleId: ny.module.id },
      ],
      version: "major",
    }));
    expect(lagret.status, JSON.stringify(lagret.body)).toBe(204);

    expect(await version(course.id)).toEqual({ versionMajor: 2, versionMinor: 0 });
    const rader = await prisma.courseVersion.findMany({ where: { courseId: course.id }, orderBy: { versionMajor: "asc" } });
    expect(rader.map((r) => r.versionMajor)).toEqual([1, 2]);
    // Seksjonen er den samme i begge: den er ikke endret, og lesingen teller.
    expect(JSON.parse(rader[0].sectionVersionsJson)).toEqual({ [seksjon.id]: seksjon.versionId });
    expect(JSON.parse(rader[1].sectionVersionsJson)).toEqual({ [seksjon.id]: seksjon.versionId });
    const hendelse = await prisma.auditEvent.findFirst({ where: { entityId: course.id, action: "course_version_changed" }, orderBy: { timestamp: "desc" } });
    expect(JSON.parse(hendelse!.metadataJson)).toMatchObject({ kind: "major", requested: "major", from: "1.0", to: "2.0" });

    // Deltakeren: seksjonen står som lest, den nye modulen gjenstår, og ingen nytt bevis ennå.
    const detalj = await request(app).get(`/api/courses/${course.id}`).set(headers);
    expect(detalj.body.course.items.find((i: { id?: string; sectionId?: string; type: string; read?: boolean }) => i.type === "SECTION")).toMatchObject({ read: true });
    await reconcileCourseCompletionsForUser(participant.id);
    expect(await completions(participant.id, course.id)).toEqual([{ versionMajor: 1, versionMinor: 0 }]);

    // Tar hen den nye modulen, får hen bevis for versjon 2.
    await createPassedCertification(participant.id, ny);
    await reconcileCourseCompletionsForUser(participant.id);
    expect(await completions(participant.id, course.id)).toEqual([
      { versionMajor: 1, versionMinor: 0 },
      { versionMajor: 2, versionMinor: 0 },
    ]);
  });

  it("to hovedversjoner etter hverandre: en seksjon fornyet som MINDRE innenfor versjon 2, er ikke «endret» i versjon 3", async () => {
    const { participant, course, headers } = await courseWithOnePassedModule("s3-to");
    const modulId = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } })).moduleId!;
    const seksjon = await createPublishedSection("s3-to");
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: seksjon.id, sortOrder: 2 } });
    expect((await readSection(app, headers, course.id, seksjon.id)).status).toBe(204);
    await reconcileCourseCompletionsForUser(participant.id);
    const innhold = (moduler: string[]) => [
      ...moduler.map((moduleId) => ({ type: "MODULE", moduleId })),
      { type: "SECTION", sectionId: seksjon.id },
    ];

    // Versjon 2: en ny modul. Deltakeren tar den og får bevis for versjon 2.
    const n1 = await createPublishedModule(`934 s3 to n1 ${Date.now()}`);
    expect((await request(app).put(`/api/admin/content/courses/${course.id}/items`).set(admin()).send(await withRevision(course.id, { items: innhold([modulId, n1.module.id]), version: "major" }))).status).toBe(204);
    await createPassedCertification(participant.id, n1);
    await reconcileCourseCompletionsForUser(participant.id);
    expect((await completions(participant.id, course.id)).map((c) => c.versionMajor)).toEqual([1, 2]);

    // Innenfor versjon 2: seksjonen får ny tekst, publisert som mindre versjon (#1095 — lesingen står).
    const v2 = await prisma.courseSectionVersion.create({
      data: { sectionId: seksjon.id, versionNo: 2, bodyMarkdown: JSON.stringify(L("Rettet.")) },
      select: { id: true },
    });
    expect((await request(app).post(`/api/admin/content/courses/${course.id}/publish-pending`).set(admin()).send({ versionIds: [v2.id], courseVersion: "minor" })).status).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 2, versionMinor: 1 });

    // Versjon 3: bare en modul til. Seksjonen er ikke endret siden versjon 2 — slutten av 2 er sammenligningen.
    const n2 = await createPublishedModule(`934 s3 to n2 ${Date.now()}`);
    expect((await request(app).put(`/api/admin/content/courses/${course.id}/items`).set(admin()).send(await withRevision(course.id, { items: innhold([modulId, n1.module.id, n2.module.id]), version: "major" }))).status).toBe(204);
    expect(await version(course.id)).toEqual({ versionMajor: 3, versionMinor: 0 });
    const rad2 = await prisma.courseVersion.findUniqueOrThrow({ where: { courseId_versionMajor: { courseId: course.id, versionMajor: 2 } } });
    expect(JSON.parse(rad2.sectionVersionsJson)).toEqual({ [seksjon.id]: v2.id });
    const body = (await request(app).get(`/api/courses/${course.id}`).set(headers)).body;
    expect(body.course.items.find((i: { type: string }) => i.type === "SECTION")).toMatchObject({ read: true });
  });

  it("hovedversjon uten noen med kursbevis blir mindre — det finnes ingen å gjelde for", async () => {
    const { course } = await courseWithOnePassedModule("s3-ingen");
    const modulId = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } })).moduleId!;
    const ny = await createPublishedModule(`934 s3 ingen ny ${Date.now()}`);
    const lagret = await request(app).put(`/api/admin/content/courses/${course.id}/items`).set(admin()).send(await withRevision(course.id, {
      items: [{ type: "MODULE", moduleId: modulId }, { type: "MODULE", moduleId: ny.module.id }],
      version: "major",
    }));
    expect(lagret.status).toBe(204);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
    expect(await prisma.courseVersion.count({ where: { courseId: course.id } })).toBe(0);
  });

  it("uten svar er det mindre; bare diskusjonsbryteren gir ingen ny versjon; et avpublisert kurs med kursbevis versjoneres", async () => {
    const { participant, course } = await courseWithOnePassedModule("s3-mindre");
    await reconcileCourseCompletionsForUser(participant.id);
    const modulId = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } })).moduleId!;

    // Diskusjonen av for modulen: ikke innhold.
    const bryter = await request(app).put(`/api/admin/content/courses/${course.id}/items`).set(admin()).send(await withRevision(course.id, {
      items: [{ type: "MODULE", moduleId: modulId, discussionsEnabled: false }],
    }));
    expect(bryter.status).toBe(204);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 0 });

    // En modul til, UTEN svar, fra en ny klient (markøren), når noen har kursbevis: avvist — og ingenting lagret.
    const ny = await createPublishedModule(`934 s3 mindre ny ${Date.now()}`);
    const nytt = [{ type: "MODULE", moduleId: modulId }, { type: "MODULE", moduleId: ny.module.id }];
    const uten = await request(app).put(`/api/admin/content/courses/${course.id}/items`).set(admin()).send(await withRevision(course.id, { items: nytt, versionAware: true }));
    expect(uten.status).toBe(400);
    expect(uten.body.error).toBe("course_version_required");
    expect(await prisma.courseItem.count({ where: { courseId: course.id } })).toBe(1);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
    // Med svaret «mindre»: 1.1, og beviset gjelder fortsatt.
    expect((await request(app).put(`/api/admin/content/courses/${course.id}/items`).set(admin()).send(await withRevision(course.id, { items: nytt, version: "minor" }))).status).toBe(204);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
    expect(await completions(participant.id, course.id)).toEqual([{ versionMajor: 1, versionMinor: 0 }]);

    // Avpublisert, men har vært ute (kursbevis finnes): versjoneres som et publisert kurs (QA-porten) —
    // ellers kunne innholdet endres mens kurset var nede og publiseres igjen uten versjon.
    await prisma.course.update({ where: { id: course.id }, data: { publishedAt: null } });
    const avpublisert = await request(app).put(`/api/admin/content/courses/${course.id}/items`).set(admin()).send(await withRevision(course.id, {
      items: [{ type: "MODULE", moduleId: ny.module.id }],
      version: "major",
    }));
    expect(avpublisert.status).toBe(204);
    expect(await version(course.id)).toEqual({ versionMajor: 2, versionMinor: 0 });
  });

  it("et kurs som aldri har vært publisert, får ingen versjon før det publiseres (det blir 1.0)", async () => {
    const m = await createPublishedModule(`934 s3 utkast ${Date.now()}`);
    const n = await createPublishedModule(`934 s3 utkast n ${Date.now()}`);
    const utkast = await prisma.course.create({
      data: {
        title: JSON.stringify(L(`934 utkast ${Date.now()}`)),
        items: { create: [{ itemType: "MODULE", moduleId: m.module.id, sortOrder: 0 }] },
      },
      select: { id: true },
    });
    const lagret = await request(app).put(`/api/admin/content/courses/${utkast.id}/items`).set(admin()).send(await withRevision(utkast.id, {
      items: [{ type: "MODULE", moduleId: m.module.id }, { type: "MODULE", moduleId: n.module.id }],
    }));
    expect(lagret.status).toBe(204);
    expect(await version(utkast.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
    // Har det fått delingslenka (det har vært publisert én gang), versjoneres det selv om det er nede nå.
    await prisma.course.update({ where: { id: utkast.id }, data: { slug: `934-utkast-${Date.now()}` } });
    const igjen = await request(app).put(`/api/admin/content/courses/${utkast.id}/items`).set(admin()).send(await withRevision(utkast.id, {
      items: [{ type: "MODULE", moduleId: n.module.id }, { type: "MODULE", moduleId: m.module.id }],
    }));
    expect(igjen.status).toBe(204);
    expect(await version(utkast.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
  });

  it("den gamle inngangen PUT /modules gir også en mindre versjon når innholdet endres", async () => {
    const { course } = await courseWithOnePassedModule("s3-legacy");
    const modulId = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } })).moduleId!;
    const ny = await createPublishedModule(`934 s3 legacy ny ${Date.now()}`);
    const lik = await request(app).put(`/api/admin/content/courses/${course.id}/modules`).set(admin()).send(await withRevision(course.id, { modules: [{ moduleId: modulId, sortOrder: 0 }] }));
    expect(lik.status).toBe(204);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
    const endret = await request(app).put(`/api/admin/content/courses/${course.id}/modules`).set(admin()).send(await withRevision(course.id, {
      modules: [{ moduleId: modulId, sortOrder: 0 }, { moduleId: ny.module.id, sortOrder: 1 }],
    }));
    expect(endret.status).toBe(204);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
  });

  it("navnet endret er mindre — men ikke når innholdet lagres i samme omgang, og ikke for samme navn i annen rekkefølge", async () => {
    const { course } = await courseWithOnePassedModule("s3-navn");
    const tittel = JSON.parse((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).title) as Record<string, string>;

    // Ren tekst lagret (eldre data), og skjemaet sender `{ nb: … }` med samme tekst: ren tekst er bokmål —
    // ingen endring (QA-porten, runde 3). Ellers ville en lagring av bare innstillinger gitt ny versjon.
    await prisma.course.update({ where: { id: course.id }, data: { title: tittel.nb } });
    expect((await request(app).put(`/api/admin/content/courses/${course.id}`).set(admin()).send(await withRevision(course.id, { title: { nb: tittel.nb }, sortOrder: 7 }))).status).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
    await prisma.course.update({ where: { id: course.id }, data: { title: JSON.stringify(tittel) } });

    // Samme tekst, lagret med nøklene i en annen rekkefølge enn kodeken skriver dem (eldre data, eller en
    // skriver som ikke gikk gjennom kodeken). Skjemaet sender hele kartet ved hver lagring: ingen endring.
    await prisma.course.update({ where: { id: course.id }, data: { title: JSON.stringify(Object.fromEntries(Object.entries(tittel).reverse())) } });
    expect((await request(app).put(`/api/admin/content/courses/${course.id}`).set(admin()).send(await withRevision(course.id, { title: tittel }))).status).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 0 });

    const nytt = { ...tittel, nb: `${tittel.nb} (ny)` };
    expect((await request(app).put(`/api/admin/content/courses/${course.id}`).set(admin()).send(await withRevision(course.id, { title: nytt }))).status).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });

    // Navn OG innhold i samme lagring (kursskjemaet sender begge i ett kall): ÉN versjon, fra innholdet.
    const modulId = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } })).moduleId!;
    const ny = await createPublishedModule(`934 s3 navn ny ${Date.now()}`);
    const igjen = { ...tittel, nb: `${tittel.nb} (igjen)` };
    const begge = await request(app).put(`/api/admin/content/courses/${course.id}/content`).set(admin()).send(await withRevision(course.id, {
      title: igjen,
      items: [{ type: "MODULE", moduleId: modulId }, { type: "MODULE", moduleId: ny.module.id }],
      version: "minor",
    }));
    expect(begge.status, JSON.stringify(begge.body).slice(0, 300)).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 2 });
    // Svaret viser versjonen etter økningen, ikke raden fra før den.
    expect(begge.body.course).toMatchObject({ versionMajor: 1, versionMinor: 2 });
    expect(await prisma.courseItem.count({ where: { courseId: course.id } })).toBe(2);
    // Et klientflagg kan ikke slå økningen av lenger: feltet finnes ikke.
    const flagg = await request(app).put(`/api/admin/content/courses/${course.id}`).set(admin()).send(await withRevision(course.id, { title: { ...tittel, nb: `${tittel.nb} (flagg)` }, skipVersionBump: true }));
    expect(flagg.status).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 3 });
  });

  it("#934 skive 4a: overgangen er fjernet — uten svar avvises endringen når noen har kursbevis, med eller uten markøren", async () => {
    const { participant, course } = await courseWithOnePassedModule("s3-gammelfane");
    await reconcileCourseCompletionsForUser(participant.id);
    const modulId = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } })).moduleId!;
    const ny = await createPublishedModule(`934 s3 gammelfane ${Date.now()}`);
    for (const markør of [{}, { versionAware: true }]) {
      const svar = await request(app).put(`/api/admin/content/courses/${course.id}/items`).set(admin()).send(await withRevision(course.id, {
        items: [{ type: "MODULE", moduleId: modulId }, { type: "MODULE", moduleId: ny.module.id }],
        ...markør,
      }));
      expect(svar.status).toBe(400);
      expect(svar.body.error).toBe("course_version_required");
    }
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
    expect(await prisma.courseItem.count({ where: { courseId: course.id } })).toBe(1);

    // Uten svar, på et kurs UTEN kursbevis: ingen å spørre for — mindre, som før.
    const uten = await courseWithOnePassedModule("s3-markor-ingen");
    const m = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: uten.course.id, itemType: "MODULE" } })).moduleId!;
    const n = await createPublishedModule(`934 s3 markør ${Date.now()}`);
    const nyKlient = await request(app).put(`/api/admin/content/courses/${uten.course.id}/items`).set(admin()).send(await withRevision(uten.course.id, {
      items: [{ type: "MODULE", moduleId: m }, { type: "MODULE", moduleId: n.module.id }],
    }));
    expect(nyKlient.status).toBe(204);
    expect(await version(uten.course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
  });

  it("PUT /:courseId lagrer innstillingene: innhold i kallet ignoreres, og …/content krever innholdet", async () => {
    const { course } = await courseWithOnePassedModule("s3-gammel");
    const ny = await createPublishedModule(`934 s3 gammel ${Date.now()}`);
    const svar = await request(app).put(`/api/admin/content/courses/${course.id}`).set(admin()).send(await withRevision(course.id, {
      items: [{ type: "MODULE", moduleId: ny.module.id }],
      version: "major",
    }));
    expect(svar.status).toBe(200);
    expect(await prisma.courseItem.count({ where: { courseId: course.id } })).toBe(1);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
    // Det nye endepunktet krever innholdet — uten det er kallet ugyldig, ikke en halv lagring.
    expect((await request(app).put(`/api/admin/content/courses/${course.id}/content`).set(admin()).send(await withRevision(course.id, { sortOrder: 3 }))).status).toBe(400);
  });

  it("samtidige endringer mister ingen økning: samme lastede teller gir én lagring og 409 for resten; etter hverandre gir de 1.5", async () => {
    const { course } = await courseWithOnePassedModule("s3-samtidig");
    const tittel = JSON.parse((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).title) as Record<string, string>;
    const lastet = await courseRevision(course.id);
    const samtidig = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => request(app).put(`/api/admin/content/courses/${course.id}`).set(admin()).send({ title: { ...tittel, nb: `${tittel.nb} (${n})` }, expectedRevision: lastet })),
    );
    expect(samtidig.map((s) => s.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
    for (const n of [6, 7, 8, 9]) {
      const svar = await request(app).put(`/api/admin/content/courses/${course.id}`).set(admin()).send(await withRevision(course.id, { title: { ...tittel, nb: `${tittel.nb} (${n})` } }));
      expect(svar.status).toBe(200);
    }
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 5 });
    const hendelser = await prisma.auditEvent.findMany({ where: { entityId: course.id, action: "course_version_changed" } });
    expect(hendelser.map((h) => JSON.parse(h.metadataJson).to).sort()).toEqual(["1.1", "1.2", "1.3", "1.4", "1.5"]);
  });

  it("låsen i selve økningen: fem samtidige økninger uten annen skriving først gir 1.5", async () => {
    const { course } = await courseWithOnePassedModule("s3-laas");
    await Promise.all([1, 2, 3, 4, 5].map(() => runContentWrite((tx) => applyCourseVersionChange(tx, course.id, { kind: "minor" }, NO_SECTION_SNAPSHOT))));
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 5 });
  });

  it("to samtidige «Publiser nye versjoner» publiserer én gang: den andre får 409, og versjonen øker én gang", async () => {
    const { participant, course, headers } = await courseWithOnePassedModule("s3-tofaner");
    const seksjon = await createPublishedSection("s3-tofaner");
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: seksjon.id, sortOrder: 2 } });
    expect((await readSection(app, headers, course.id, seksjon.id)).status).toBe(204);
    await reconcileCourseCompletionsForUser(participant.id);
    const v2 = await prisma.courseSectionVersion.create({
      data: { sectionId: seksjon.id, versionNo: 2, bodyMarkdown: JSON.stringify(L("Ny tekst.")) },
      select: { id: true },
    });
    const send = () => request(app).post(`/api/admin/content/courses/${course.id}/publish-pending`).set(admin()).send({ versionIds: [v2.id], courseVersion: "minor" });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
  });

  it("kursskjemaets ene kall (PUT /:courseId/content) bærer forfatterens svar: hovedversjon gir 2.0", async () => {
    const { participant, course } = await courseWithOnePassedModule("s3-ettkall");
    await reconcileCourseCompletionsForUser(participant.id);
    const modulId = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } })).moduleId!;
    const ny = await createPublishedModule(`934 s3 ettkall ${Date.now()}`);
    const svar = await request(app).put(`/api/admin/content/courses/${course.id}/content`).set(admin()).send(await withRevision(course.id, {
      items: [{ type: "MODULE", moduleId: modulId }, { type: "MODULE", moduleId: ny.module.id }],
      version: "major",
    }));
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 2, versionMinor: 0 });
    expect(svar.body.course).toMatchObject({ versionMajor: 2, versionMinor: 0 });
  });

  it("en utbyttet seksjon (import) tar øyeblikksbildet med seg: de kopierte lesingene teller som før", async () => {
    const { participant, course, headers } = await courseWithOnePassedModule("s3-bytt");
    const modulId = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } })).moduleId!;
    const gammel = await createPublishedSection("s3-bytt-gammel");
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: gammel.id, sortOrder: 2 } });
    expect((await readSection(app, headers, course.id, gammel.id)).status).toBe(204);
    await reconcileCourseCompletionsForUser(participant.id);
    // Versjon 2 (en modul til): seksjonen er uendret, og lesingen (fra før versjon 2) teller.
    const n1 = await createPublishedModule(`934 s3 bytt n1 ${Date.now()}`);
    expect((await request(app).put(`/api/admin/content/courses/${course.id}/items`).set(admin()).send(await withRevision(course.id, {
      items: [{ type: "MODULE", moduleId: modulId }, { type: "SECTION", sectionId: gammel.id }, { type: "MODULE", moduleId: n1.module.id }],
      version: "major",
    }))).status).toBe(204);

    // Importen bytter seksjonen med en kopi: ny id, lesingen kopiert med samme tidspunkt (slik importen gjør).
    const kopi = await createPublishedSection("s3-bytt-kopi");
    const lesing = await prisma.courseSectionRead.findFirstOrThrow({ where: { courseId: course.id, sectionId: gammel.id } });
    await prisma.courseItem.updateMany({ where: { courseId: course.id, sectionId: gammel.id }, data: { sectionId: kopi.id } });
    await prisma.courseSectionRead.create({ data: { userId: lesing.userId, courseId: course.id, sectionId: kopi.id, readAt: lesing.readAt } });
    await runContentWrite((tx) => renameSectionInVersionSnapshots(tx, course.id, gammel.id, kopi.id));

    const body = (await request(app).get(`/api/courses/${course.id}`).set(headers)).body;
    expect(body.course.items.find((i: { type: string }) => i.type === "SECTION")).toMatchObject({ sectionId: kopi.id, read: true });
  });

  it("«Publiser nye versjoner» som HOVEDVERSJON: den endrede seksjonen leses på nytt, den uendrede teller", async () => {
    const { participant, course, headers } = await courseWithOnePassedModule("s3-pending");
    const uendret = await createPublishedSection("s3-uendret");
    const endres = await createPublishedSection("s3-endres");
    await prisma.courseItem.createMany({
      data: [
        { courseId: course.id, itemType: "SECTION", sectionId: uendret.id, sortOrder: 2 },
        { courseId: course.id, itemType: "SECTION", sectionId: endres.id, sortOrder: 3 },
      ],
    });
    for (const id of [uendret.id, endres.id]) {
      expect((await readSection(app, headers, course.id, id)).status).toBe(204);
    }
    await reconcileCourseCompletionsForUser(participant.id);
    expect(await completions(participant.id, course.id)).toEqual([{ versionMajor: 1, versionMinor: 0 }]);
    const lestFør = await readAt(participant.id, course.id);

    // En ny versjon av den ene seksjonen ligger klar.
    const v2 = await prisma.courseSectionVersion.create({
      data: { sectionId: endres.id, versionNo: 2, bodyMarkdown: JSON.stringify(L("Ny tekst.")) },
      select: { id: true },
    });
    const klar = await request(app).get(`/api/admin/content/courses/${course.id}/pending-versions`).set(admin());
    expect(klar.status).toBe(200);
    // #934 skive 4b: og hvor mange en hovedversjon sender e-post til.
    expect(klar.body.course).toEqual({ published: true, versionMajor: 1, versionMinor: 0, certificateHolders: 1, majorEmailRecipients: 1 });
    expect(klar.body.items.map((i: { versionId: string }) => i.versionId)).toEqual([v2.id]);

    const publisert = await request(app).post(`/api/admin/content/courses/${course.id}/publish-pending`).set(admin()).send({
      versionIds: [v2.id],
      courseVersion: "major",
    });
    expect(publisert.status, JSON.stringify(publisert.body)).toBe(200);
    expect(publisert.body.version).toMatchObject({ kind: "major", to: { major: 2, minor: 0 } });
    const rader = await prisma.courseVersion.findMany({ where: { courseId: course.id }, orderBy: { versionMajor: "asc" } });
    expect(JSON.parse(rader[0].sectionVersionsJson)).toEqual({ [uendret.id]: uendret.versionId, [endres.id]: endres.versionId });
    expect(JSON.parse(rader[1].sectionVersionsJson)).toEqual({ [uendret.id]: uendret.versionId, [endres.id]: v2.id });

    // Deltakeren: den endrede er ulest, den uendrede lest — i kursdetaljen OG i fremdriften i «Mine kurs».
    const lest = async () => {
      const body = (await request(app).get(`/api/courses/${course.id}`).set(headers)).body;
      return Object.fromEntries(
        (body.course.items as Array<{ type: string; sectionId: string; read?: boolean }>).filter((i) => i.type === "SECTION").map((i) => [i.sectionId, i.read]),
      );
    };
    expect(await lest()).toEqual({ [uendret.id]: true, [endres.id]: false });
    const liste = (await request(app).get("/api/courses").set(headers)).body.courses.find((c: { id: string }) => c.id === course.id);
    expect(liste.progress).toMatchObject({ sectionCompleted: 1, sectionTotal: 2 });
    await reconcileCourseCompletionsForUser(participant.id);
    expect(await completions(participant.id, course.id)).toEqual([{ versionMajor: 1, versionMinor: 0 }]);

    // Kursrapporten teller det samme.
    const rapport = await request(app).get("/api/reports/courses/details").query({ selectedCourseId: course.id }).set(admin());
    expect(rapport.body.rows.find((r: { participantId: string }) => r.participantId === participant.id)).toMatchObject({
      status: "NEEDS_NEW_VERSION",
      readSections: 1,
    });

    // Leser hen den på nytt, teller den — lesingen får nytt tidspunkt, den uendrede beholder sitt.
    expect((await readSection(app, headers, course.id, endres.id)).status).toBe(204);
    expect(await lest()).toEqual({ [uendret.id]: true, [endres.id]: true });
    const lestEtter = await readAt(participant.id, course.id);
    expect(lestEtter[uendret.id]).toBe(lestFør[uendret.id]);
    expect(new Date(lestEtter[endres.id]).getTime()).toBeGreaterThanOrEqual(rader[1].publishedAt.getTime());
    await reconcileCourseCompletionsForUser(participant.id);
    expect(await completions(participant.id, course.id)).toEqual([
      { versionMajor: 1, versionMinor: 0 },
      { versionMajor: 2, versionMinor: 0 },
    ]);
  });

  it("«Publiser nye versjoner» er alt eller ingenting: feiler versjonen, er heller ingen seksjon publisert", async () => {
    const { participant, course, headers } = await courseWithOnePassedModule("s3-atom");
    const seksjon = await createPublishedSection("s3-atom");
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: seksjon.id, sortOrder: 2 } });
    expect((await readSection(app, headers, course.id, seksjon.id)).status).toBe(204);
    await reconcileCourseCompletionsForUser(participant.id);
    const v2 = await prisma.courseSectionVersion.create({
      data: { sectionId: seksjon.id, versionNo: 2, bodyMarkdown: JSON.stringify(L("Ny tekst.")) },
      select: { id: true },
    });
    // En rad for versjon 2 finnes allerede: økningen til 2.0 kan ikke skrive sin — den siste skrivingen feiler.
    await prisma.courseVersion.create({ data: { courseId: course.id, versionMajor: 2, publishedAt: new Date(), sectionVersionsJson: "{}" } });

    const svar = await request(app).post(`/api/admin/content/courses/${course.id}/publish-pending`).set(admin()).send({ versionIds: [v2.id], courseVersion: "major" });
    expect(svar.status).toBe(500);
    expect(svar.body.error).toBe("course_pending_failed");
    // Ingenting står levende uten versjon: seksjonen har fortsatt den gamle teksten, og kurset er 1.0.
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: seksjon.id } })).activeVersionId).toBe(seksjon.versionId);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
    // Og et nytt forsøk ser det samme settet.
    const igjen = await request(app).get(`/api/admin/content/courses/${course.id}/pending-versions`).set(admin());
    expect(igjen.body.items.map((i: { versionId: string }) => i.versionId)).toEqual([v2.id]);
  });

  it("«Publiser nye versjoner» som mindre: lesingen står (#1095), og versjonen blir 1.1", async () => {
    const { participant, course, headers } = await courseWithOnePassedModule("s3-pmindre");
    const seksjon = await createPublishedSection("s3-pmindre");
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: seksjon.id, sortOrder: 2 } });
    expect((await readSection(app, headers, course.id, seksjon.id)).status).toBe(204);
    await reconcileCourseCompletionsForUser(participant.id);
    const v2 = await prisma.courseSectionVersion.create({
      data: { sectionId: seksjon.id, versionNo: 2, bodyMarkdown: JSON.stringify(L("Rettet skrivefeil.")) },
      select: { id: true },
    });
    // Uten svar, når noen har kursbevis: avvist, og ingenting publisert.
    const uten = await request(app).post(`/api/admin/content/courses/${course.id}/publish-pending`).set(admin()).send({ versionIds: [v2.id] });
    expect(uten.status).toBe(400);
    expect(uten.body.error).toBe("course_version_required");
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: seksjon.id } })).activeVersionId).toBe(seksjon.versionId);
    const publisert = await request(app).post(`/api/admin/content/courses/${course.id}/publish-pending`).set(admin()).send({ versionIds: [v2.id], courseVersion: "minor" });
    expect(publisert.status, JSON.stringify(publisert.body)).toBe(200);
    expect(publisert.body.version).toMatchObject({ kind: "minor", to: { major: 1, minor: 1 } });
    expect(await prisma.courseVersion.count({ where: { courseId: course.id } })).toBe(0);
    const body = (await request(app).get(`/api/courses/${course.id}`).set(headers)).body;
    expect(body.course.items.find((i: { type: string }) => i.type === "SECTION")).toMatchObject({ read: true });
  });
});

describe("#934 skive 3 — alle veier inn går gjennom den delte funksjonen", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Et kurs som har vært ute og har kursbevis, avpublisert, med en ny seksjon som utkast. */
  async function avpublisertMedUtkast(tag: string) {
    const { participant, course } = await courseWithOnePassedModule(tag);
    await reconcileCourseCompletionsForUser(participant.id);
    const modulId = (await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } })).moduleId!;
    const utkast = await prisma.courseSection.create({ data: { title: JSON.stringify(L(`934 utkast ${tag} ${Date.now()}`)) }, select: { id: true } });
    await prisma.courseSectionVersion.create({ data: { sectionId: utkast.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Utkast.")) } });
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: utkast.id, sortOrder: 2 } });
    await prisma.course.update({ where: { id: course.id }, data: { publishedAt: null } });
    return { course, modulId, utkastId: utkast.id };
  }

  it("«Publiser kurs» med nytt innhold i et kurs med kursbevis: uten svar avvist og ingenting publisert; med svar én transaksjon", async () => {
    const { course, utkastId } = await avpublisertMedUtkast("kaskade");
    const forhånd = await request(app).get(`/api/admin/content/courses/${course.id}/publish-preview`).set(admin());
    expect(forhånd.body.course).toMatchObject({ published: false, versionMajor: 1, versionMinor: 0, certificateHolders: 1 });

    const uten = await request(app).post(`/api/admin/content/courses/${course.id}/publish`).set(admin()).send({ publishItems: true });
    expect(uten.status, JSON.stringify(uten.body).slice(0, 300)).toBe(400);
    expect(uten.body.error).toBe("course_version_required");
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: utkastId } })).activeVersionId).toBeNull();
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).publishedAt).toBeNull();

    const med = await request(app).post(`/api/admin/content/courses/${course.id}/publish`).set(admin()).send({ publishItems: true, courseVersion: "major" });
    expect(med.status, JSON.stringify(med.body).slice(0, 300)).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 2, versionMinor: 0 });
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: utkastId } })).activeVersionId).not.toBeNull();
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).publishedAt).not.toBeNull();
  });

  it("«Publiser kurs» første gang: ingen versjon, ingen spørsmål — kurset blir 1.0", async () => {
    const m = await createPublishedModule(`934 første ${Date.now()}`);
    const utkast = await prisma.courseSection.create({ data: { title: JSON.stringify(L(`934 første utkast ${Date.now()}`)) }, select: { id: true } });
    await prisma.courseSectionVersion.create({ data: { sectionId: utkast.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Utkast.")) } });
    const nytt = await prisma.course.create({
      data: {
        title: JSON.stringify(L(`934 første kurs ${Date.now()}`)),
        items: { create: [{ itemType: "MODULE", moduleId: m.module.id, sortOrder: 0 }, { itemType: "SECTION", sectionId: utkast.id, sortOrder: 1 }] },
      },
      select: { id: true },
    });
    const svar = await request(app).post(`/api/admin/content/courses/${nytt.id}/publish`).set(admin()).send({ publishItems: true });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(200);
    expect(await version(nytt.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
  });

  it("en seksjon lagret, publisert eller omdøpt fra sin EGEN side gir kursene den ligger i en mindre versjon", async () => {
    const { course } = await courseWithOnePassedModule("seksjonside");
    const seksjon = await createPublishedSection("seksjonside");
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: seksjon.id, sortOrder: 2 } });
    // Lagret med alle språk: lagring ER publisering (latest-wins).
    const lagret = await request(app).put(`/api/admin/content/sections/${seksjon.id}/content`).set(admin()).send({ bodyMarkdown: L("Ny tekst.") });
    expect(lagret.status, JSON.stringify(lagret.body).slice(0, 300)).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
    // Publisert fra egen side.
    await prisma.courseSectionVersion.create({ data: { sectionId: seksjon.id, versionNo: 9, bodyMarkdown: JSON.stringify(L("Enda nyere.")) } });
    expect((await request(app).post(`/api/admin/content/sections/${seksjon.id}/publish`).set(admin())).status).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 2 });
    // Omdøpt.
    const navn = await request(app).patch(`/api/admin/content/sections/${seksjon.id}/title`).set(admin()).send({ title: L(`Nytt navn ${Date.now()}`) });
    expect(navn.status, JSON.stringify(navn.body).slice(0, 300)).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 3 });
  });

  it("en modul publisert fra sin EGEN side gir kursene den ligger i en mindre versjon (eget valg per kurs: skive 5)", async () => {
    const { course, participant } = await courseWithOnePassedModule("modulside");
    const modul = await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } });
    const aktiv = await prisma.module.findUniqueOrThrow({ where: { id: modul.moduleId! }, select: { activeVersionId: true } });
    const kilde = await prisma.moduleVersion.findUniqueOrThrow({ where: { id: aktiv.activeVersionId! } });
    const ny = await prisma.moduleVersion.create({
      data: {
        moduleId: modul.moduleId!,
        versionNo: 2,
        taskText: kilde.taskText,
        assessorExpectedContent: kilde.assessorExpectedContent,
        rubricVersionId: kilde.rubricVersionId,
        promptTemplateVersionId: kilde.promptTemplateVersionId,
        mcqSetVersionId: kilde.mcqSetVersionId,
      },
      select: { id: true },
    });
    // Ruta validerer modulens innhold (testmodulen er minimal); kroken sitter i kommandoen ruta kaller.
    await publishModuleVersion(modul.moduleId!, ny.id, participant.id);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
  });
});

describe("#934 skive 3 — QA-runde 5: delte elementer, lesing under versjonsendring, kappløp, gjentak", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Et kurs som har vært ute (kursbevis finnes), avpublisert. */
  async function avpublisert(tag: string) {
    const fixture = await courseWithOnePassedModule(tag);
    await reconcileCourseCompletionsForUser(fixture.participant.id);
    await prisma.course.update({ where: { id: fixture.course.id }, data: { publishedAt: null } });
    return fixture;
  }

  it("«Publiser nye versjoner» i ett kurs gir ANDRE kurs med samme seksjon en mindre versjon", async () => {
    const a = await courseWithOnePassedModule("delt-a");
    const b = await courseWithOnePassedModule("delt-b");
    const seksjon = await createPublishedSection("delt");
    await prisma.courseItem.createMany({
      data: [
        { courseId: a.course.id, itemType: "SECTION", sectionId: seksjon.id, sortOrder: 2 },
        { courseId: b.course.id, itemType: "SECTION", sectionId: seksjon.id, sortOrder: 2 },
      ],
    });
    const v2 = await prisma.courseSectionVersion.create({ data: { sectionId: seksjon.id, versionNo: 2, bodyMarkdown: JSON.stringify(L("Ny tekst.")) }, select: { id: true } });
    const svar = await request(app).post(`/api/admin/content/courses/${a.course.id}/publish-pending`).set(admin()).send({ versionIds: [v2.id], courseVersion: "minor" });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(200);
    expect(await version(a.course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
    expect(await version(b.course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
  });

  it("en lesing venter på en åpen versjonsendring (delt lås), så tidspunktet aldri havner på feil side av grensen", async () => {
    const { course, headers } = await courseWithOnePassedModule("lesing-laas");
    const seksjon = await createPublishedSection("lesing-laas");
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: seksjon.id, sortOrder: 2 } });
    // Lesingen finnes fra før: en NY lesing venter uansett (fremmednøkkelen låser kursraden), men en lesing som
    // bare skal få nytt tidspunkt, gjør det bare med den delte låsen.
    expect((await readSection(app, headers, course.id, seksjon.id)).status).toBe(204);
    let sluppet = 0;
    // #934 skive 4a: innholdslåsen eksklusivt, slik en versjonsendring holder den.
    const holder = runContentWrite(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      sluppet = Date.now();
    }, { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const lesing = readSection(app, headers, course.id, seksjon.id).then((r) => ({ status: r.status, ferdig: Date.now() }));
    const [, lest] = await Promise.all([holder, lesing]);
    expect(lest.status).toBe(204);
    expect(lest.ferdig).toBeGreaterThanOrEqual(sluppet);
  });

  it("«Publiser kurs» i ett kurs gir ANDRE kurs med samme nye seksjon en mindre versjon", async () => {
    const { course } = await avpublisert("kaskade-delt");
    const annet = await courseWithOnePassedModule("kaskade-delt-b");
    const utkast = await prisma.courseSection.create({ data: { title: JSON.stringify(L(`934 delt utkast ${Date.now()}`)) }, select: { id: true } });
    await prisma.courseSectionVersion.create({ data: { sectionId: utkast.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Utkast.")) } });
    await prisma.courseItem.createMany({ data: [
      { courseId: course.id, itemType: "SECTION", sectionId: utkast.id, sortOrder: 3 },
      { courseId: annet.course.id, itemType: "SECTION", sectionId: utkast.id, sortOrder: 3 },
    ] });
    const svar = await request(app).post(`/api/admin/content/courses/${course.id}/publish`).set(admin()).send({ publishItems: true, courseVersion: "minor" });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 300)).toBe(200);
    expect(await version(annet.course.id)).toEqual({ versionMajor: 1, versionMinor: 1 });
  });

  it("to samtidige «Publiser kurs» publiserer én gang: den andre får 409, og kurset blir 1.0", async () => {
    const m = await createPublishedModule(`934 kappløp ${Date.now()}`);
    const utkast = await prisma.courseSection.create({ data: { title: JSON.stringify(L(`934 kappløp ${Date.now()}`)) }, select: { id: true } });
    await prisma.courseSectionVersion.create({ data: { sectionId: utkast.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Utkast.")) } });
    const nytt = await prisma.course.create({
      data: {
        title: JSON.stringify(L(`934 kappløp kurs ${Date.now()}`)),
        items: { create: [{ itemType: "MODULE", moduleId: m.module.id, sortOrder: 0 }, { itemType: "SECTION", sectionId: utkast.id, sortOrder: 1 }] },
      },
      select: { id: true },
    });
    const send = () => request(app).post(`/api/admin/content/courses/${nytt.id}/publish`).set(admin()).send({ publishItems: true });
    const [x, y] = await Promise.all([send(), send()]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await version(nytt.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
  });

  it("et nytt forsøk på en versjon som alt er aktiv (seksjon og modul), gir ingen ny kursversjon", async () => {
    const { course, participant } = await courseWithOnePassedModule("gjentak");
    const seksjon = await createPublishedSection("gjentak");
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId: seksjon.id, sortOrder: 2 } });
    expect((await request(app).post(`/api/admin/content/sections/${seksjon.id}/publish`).set(admin())).status).toBe(200);
    expect((await request(app).post(`/api/admin/content/sections/${seksjon.id}/publish`).set(admin())).status).toBe(200);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
    const modul = await prisma.courseItem.findFirstOrThrow({ where: { courseId: course.id, itemType: "MODULE" } });
    const aktiv = await prisma.module.findUniqueOrThrow({ where: { id: modul.moduleId! }, select: { activeVersionId: true } });
    await publishModuleVersion(modul.moduleId!, aktiv.activeVersionId!, participant.id);
    expect(await version(course.id)).toEqual({ versionMajor: 1, versionMinor: 0 });
  });
});

function admin() {
  return {
    "x-user-id": "v934-s3-admin",
    "x-user-email": "v934.s3.admin@x.test",
    "x-user-name": "Admin",
    "x-user-roles": "ADMINISTRATOR",
    "x-locale": "nb",
  };
}

const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });

async function version(courseId: string) {
  return prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { versionMajor: true, versionMinor: true } });
}

async function readAt(userId: string, courseId: string) {
  const rows = await prisma.courseSectionRead.findMany({ where: { userId, courseId }, select: { sectionId: true, readAt: true } });
  return Object.fromEntries(rows.map((r) => [r.sectionId, r.readAt.toISOString()]));
}

async function createPublishedSection(tag: string) {
  const section = await prisma.courseSection.create({
    data: { title: JSON.stringify(L(`934 seksjon ${tag} ${Date.now()}`)) },
    select: { id: true },
  });
  const v1 = await prisma.courseSectionVersion.create({
    data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Første tekst.")), publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: v1.id } });
  return { id: section.id, versionId: v1.id };
}

async function completions(userId: string, courseId: string) {
  return prisma.courseCompletion.findMany({
    where: { userId, courseId },
    orderBy: { versionMajor: "asc" },
    select: { versionMajor: true, versionMinor: true },
  });
}

async function courseWithOnePassedModule(tag: string) {
  const suffix = `${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const participant = await prisma.user.create({
    data: { externalId: `v934-${suffix}`, email: `v934.${suffix}@company.com`, name: "Versjonstest", department: "Learning" },
    select: { id: true },
  });
  const modul = await createPublishedModule(`934 modul ${suffix}`);
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify({ "en-GB": `934 ${suffix}`, nb: `934 ${suffix}`, nn: `934 ${suffix}` }),
      publishedAt: new Date(),
      items: { create: [{ itemType: "MODULE", moduleId: modul.module.id, sortOrder: 1 }] },
    },
    select: { id: true },
  });
  await createPassedCertification(participant.id, modul);
  // Deltakerens egne hoder, for rutene (samme person som raden over: koblet på externalId).
  const headers = {
    "x-user-id": `v934-${suffix}`,
    "x-user-email": `v934.${suffix}@company.com`,
    "x-user-name": "Versjonstest",
    "x-user-department": "Learning",
    "x-user-roles": "PARTICIPANT",
    "x-locale": "nb",
  };
  return { participant, course, headers };
}

async function createPublishedModule(title: string) {
  const source = await prisma.moduleVersion.findFirst({
    where: { module: { activeVersionId: { not: null } } },
    select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    orderBy: { createdAt: "asc" },
  });
  expect(source).toBeTruthy();
  const module = await prisma.module.create({ data: { title }, select: { id: true } });
  const moduleVersion = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      taskText: `${title} task`,
      assessorExpectedContent: `${title} guidance`,
      rubricVersionId: source!.rubricVersionId,
      promptTemplateVersionId: source!.promptTemplateVersionId,
      mcqSetVersionId: source!.mcqSetVersionId,
      publishedAt: new Date(),
    },
    select: { id: true, rubricVersionId: true, promptTemplateVersionId: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: moduleVersion.id } });
  return { module, moduleVersion };
}

async function createPassedCertification(userId: string, fixture: Awaited<ReturnType<typeof createPublishedModule>>) {
  const submission = await prisma.submission.create({
    data: {
      userId,
      moduleId: fixture.module.id,
      moduleVersionId: fixture.moduleVersion.id,
      deliveryType: "text",
      responseJson: JSON.stringify({ response: "934" }),
      submissionStatus: "COMPLETED",
    },
    select: { id: true },
  });
  const decision = await prisma.assessmentDecision.create({
    data: {
      submissionId: submission.id,
      moduleVersionId: fixture.moduleVersion.id,
      rubricVersionId: fixture.moduleVersion.rubricVersionId,
      promptTemplateVersionId: fixture.moduleVersion.promptTemplateVersionId,
      mcqScaledScore: 84,
      practicalScaledScore: 14,
      totalScore: 98,
      redFlagsJson: "[]",
      passFailTotal: true,
      decisionType: "AUTOMATIC",
      decisionReason: "934",
      finalisedById: userId,
    },
    select: { id: true },
  });
  await prisma.certificationStatus.create({
    data: { userId, moduleId: fixture.module.id, latestDecisionId: decision.id, status: "ACTIVE", passedAt: new Date() },
  });
  // #934: det regelen prod bruker leser (ModulePass, nummer og krav), som vedtakssporet ville skrevet.
  await recordFixturePass({ userId, moduleId: fixture.module.id, moduleVersionId: fixture.moduleVersion.id, submissionId: submission.id, decisionId: decision.id });
}
