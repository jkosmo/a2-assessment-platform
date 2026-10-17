import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1099: «Aktivitet» under Deltakere, mot ekte Postgres. Utregningen er dekket av enhetstesten; her
// måles det bare databasen kan svare på: hvem som telles som deltaker, at de fire hendelsestypene
// faktisk leses fra sine tabeller, at et bestått forsøk med to vedtak telles én gang, tilgang, og
// titlene i «det siste hen har gjort».
//
// ⚠️ Databasen deles med alle de andre testene. Alt her ligger i en egen avdeling, og rapporten
// spørres med den avdelingen — ellers ville tallene tatt med deltakere fra andre testfiler.

const stamp = `${Date.now()}-${Math.round(performance.now())}`;
const department = `Akt-${stamp}`;

const headersFor = (roles: string, id = `activity-${roles.toLowerCase()}-${stamp}`) => ({
  "x-user-id": id,
  "x-user-email": `${id}@x.test`,
  "x-user-name": `Activity ${roles}`,
  "x-user-roles": roles,
  "x-locale": "nb",
});

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 60 * 60 * 1000);

describe("Aktivitet under Deltakere (#1099)", () => {
  const userIds: Record<string, string> = {};
  let courseId = "";
  let sectionId = "";
  let copySectionId = "";
  let moduleId = "";
  let moduleVersionId = "";
  let submissionId = "";
  const submissionIds: string[] = [];

  async function makeUser(tag: string, opts: { participant?: boolean; otherRole?: "REVIEWER"; active?: boolean; lastLoginAt?: Date; dept?: string } = {}) {
    const user = await prisma.user.create({
      data: {
        externalId: `act-${tag}-${stamp}`,
        name: `Akt ${tag}`,
        email: `act-${tag}-${stamp}@x.test`,
        department: opts.dept ?? department,
        activeStatus: opts.active ?? true,
        lastLoginAt: opts.lastLoginAt ?? null,
      },
      select: { id: true },
    });
    if (opts.participant ?? true) {
      await prisma.roleAssignment.create({ data: { userId: user.id, appRole: "PARTICIPANT", validFrom: ago(400) } });
    }
    if (opts.otherRole) {
      await prisma.roleAssignment.create({ data: { userId: user.id, appRole: opts.otherRole, validFrom: ago(400) } });
    }
    userIds[tag] = user.id;
    return user.id;
  }

  beforeAll(async () => {
    courseId = (await prisma.course.create({
      data: { title: JSON.stringify({ nb: "Aktivitetskurs", "en-GB": "Activity course" }), publishedAt: new Date() },
      select: { id: true },
    })).id;
    sectionId = (await prisma.courseSection.create({
      data: { title: JSON.stringify({ nb: "Les meg først", "en-GB": "Read me first" }) },
      select: { id: true },
    })).id;
    copySectionId = (await prisma.courseSection.create({
      data: { title: JSON.stringify({ nb: "Les meg først (kopi)", "en-GB": "Read me first (copy)" }) },
      select: { id: true },
    })).id;
    moduleId = (await prisma.module.create({ data: { title: JSON.stringify({ nb: "Aktivitetsmodul", "en-GB": "Activity module" }) }, select: { id: true } })).id;
    moduleVersionId = (await prisma.moduleVersion.create({
      data: { moduleId, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date() },
      select: { id: true },
    })).id;

    const a = await makeUser("aktiv");
    const b = await makeUser("rolig");
    await makeUser("ikke-startet", { lastLoginAt: ago(2) });
    const sluttet = await makeUser("sluttet", { active: false });
    // En bruker uten noen lagret rolle som har lest noe — det vanlige på stage, der rollene bare står i
    // tokenet. Skal telles, fordi hen har gjort noe.
    const ikkeDeltaker = await makeUser("uten-rolle", { participant: false });
    // En gjest: logget inn, ingen lagret rolle, ingenting gjort. Skal IKKE telles — i prod opprettes en
    // brukerrad for alle i tenanten som åpner en lenke.
    await makeUser("gjest", { participant: false, lastLoginAt: ago(3) });
    // En vurderer med lagret rolle, men ingen deltakerrolle og ingenting gjort: telles ikke.
    await makeUser("vurderer", { participant: false, otherRole: "REVIEWER" });

    // aktiv: alle fire hendelsestypene i går.
    const lest = ago(1, 3);
    await prisma.courseSectionRead.create({ data: { userId: a, courseId, sectionId, readAt: lest } });
    // «Oppdater kurs» (#1095) kopierer lesingen til den nye seksjonen med samme tidspunkt: én lesing.
    await prisma.courseSectionRead.create({ data: { userId: a, courseId, sectionId: copySectionId, readAt: lest } });
    submissionId = (await prisma.submission.create({
      data: { userId: a, moduleId, moduleVersionId, deliveryType: "text", submissionStatus: "COMPLETED", submittedAt: ago(1, 2) },
      select: { id: true },
    })).id;
    // To beståtte vedtak på samme innlevering (ny vurdering): skal telles som ÉN bestått modul.
    for (const hours of [1, 0]) {
      await prisma.assessmentDecision.create({
        data: {
          submissionId, moduleVersionId, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: 1, redFlagsJson: "[]",
          passFailTotal: true, decisionType: "AUTOMATIC", decisionReason: "Fikstur for #1099.", finalisedAt: ago(1, hours),
        },
      });
    }
    await prisma.courseCompletion.create({ data: { userId: a, courseId, moduleSnapshotJson: "[]", completedAt: ago(1) } });

    submissionIds.push(submissionId);

    // anket: et forsøk som ble bestått og så strøket etter anke, og et erstattet forsøk som bærer et
    // gammelt automatisk bestått. Ingen av dem er bestått (#948/#951) — begge er levert.
    const anket = await makeUser("anket");
    const anketForsøk = (await prisma.submission.create({
      data: { userId: anket, moduleId, moduleVersionId, deliveryType: "text", submissionStatus: "COMPLETED", submittedAt: ago(2) },
      select: { id: true },
    })).id;
    submissionIds.push(anketForsøk);
    for (const [hours, pass] of [[3, true], [1, false]] as const) {
      await prisma.assessmentDecision.create({
        data: {
          submissionId: anketForsøk, moduleVersionId, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: 1, redFlagsJson: "[]",
          passFailTotal: pass, decisionType: pass ? "AUTOMATIC" : "APPEAL_RESOLUTION", decisionReason: "Fikstur for #1099.", finalisedAt: ago(1, hours),
        },
      });
    }
    const erstattet = (await prisma.submission.create({
      data: { userId: anket, moduleId, moduleVersionId, deliveryType: "text", submissionStatus: "SUPERSEDED", submittedAt: ago(3) },
      select: { id: true },
    })).id;
    submissionIds.push(erstattet);
    await prisma.assessmentDecision.create({
      data: {
        submissionId: erstattet, moduleVersionId, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: 1, redFlagsJson: "[]",
        passFailTotal: true, decisionType: "AUTOMATIC", decisionReason: "Fikstur for #1099.", finalisedAt: ago(3),
      },
    });

    // sensor: et fritekstforsøk levert for ti dager siden og bestått av sensor i dag, og deretter
    // seksten nyere forsøk. Det beståtte skal stå i «det siste hen har gjort» selv om innleveringen
    // ikke er blant de 15 siste. Egen avdeling, så tallene i den første testen ikke påvirkes.
    const sensor = await makeUser("sensor", { dept: `${department}-b` });
    const gammelt = (await prisma.submission.create({
      data: { userId: sensor, moduleId, moduleVersionId, deliveryType: "text", submissionStatus: "COMPLETED", submittedAt: ago(10) },
      select: { id: true },
    })).id;
    submissionIds.push(gammelt);
    await prisma.assessmentDecision.create({
      data: {
        submissionId: gammelt, moduleVersionId, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: 1, redFlagsJson: "[]",
        passFailTotal: true, decisionType: "MANUAL_OVERRIDE", decisionReason: "Fikstur for #1099.", finalisedAt: ago(0, 1),
      },
    });
    for (let i = 0; i < 16; i++) {
      const id = (await prisma.submission.create({
        data: { userId: sensor, moduleId, moduleVersionId, deliveryType: "text", submissionStatus: "SUPERSEDED", submittedAt: ago(5, i) },
        select: { id: true },
      })).id;
      submissionIds.push(id);
    }

    // rolig: én lesing for 20 dager siden.
    await prisma.courseSectionRead.create({ data: { userId: b, courseId, sectionId, readAt: ago(20) } });

    // Skal ikke telles: en som har sluttet. Skal telles: en uten lagret rolle som har lest noe.
    await prisma.courseSectionRead.create({ data: { userId: sluttet, courseId, sectionId, readAt: ago(1) } });
    await prisma.courseSectionRead.create({ data: { userId: ikkeDeltaker, courseId, sectionId, readAt: ago(1) } });
  });

  afterAll(async () => {
    const ids = Object.values(userIds);
    await prisma.assessmentDecision.deleteMany({ where: { submissionId: { in: submissionIds } } });
    await prisma.submission.deleteMany({ where: { userId: { in: ids } } });
    await prisma.courseCompletion.deleteMany({ where: { userId: { in: ids } } });
    await prisma.courseSectionRead.deleteMany({ where: { userId: { in: ids } } });
    if (moduleVersionId) await prisma.moduleVersion.deleteMany({ where: { id: moduleVersionId } });
    if (moduleId) await prisma.module.deleteMany({ where: { id: moduleId } });
    await prisma.courseSection.deleteMany({ where: { id: { in: [sectionId, copySectionId].filter(Boolean) } } });
    if (courseId) await prisma.course.deleteMany({ where: { id: courseId } });
    if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("teller deltakerne i avdelingen, med de fire hendelsestypene og riktig status", async () => {
    const res = await request(app)
      .get("/api/reports/activity")
      .query({ period: "4", grain: "week", department })
      .set(headersFor("ADMINISTRATOR"));
    expect(res.status).toBe(200);
    expect(res.body.department).toBe(department);
    expect(res.body.departments).toContain(department);
    // aktiv, anket, uten-rolle, rolig og ikke-startet. Ikke den som har sluttet, gjesten eller vurdereren.
    expect(res.body.population).toBe(5);
    expect(res.body.kpis).toMatchObject({ active7: 3, active30: 4, started: 4 });
    // Den kopierte lesingen er én; det ankede og det erstattede forsøket er levert, ikke bestått.
    expect(res.body.kpis.events7).toEqual({ read: 2, submitted: 3, passed: 1, completed: 1 });

    const status = Object.fromEntries(
      (res.body.people as Array<{ userId: string; status: string }>).map((p) => [p.userId, p.status]),
    );
    expect(status).toEqual({
      [userIds.aktiv!]: "active",
      [userIds.anket!]: "active",
      [userIds["uten-rolle"]!]: "active",
      [userIds.rolig!]: "quiet",
      [userIds["ikke-startet"]!]: "not_started",
    });
    const ikkeStartet = res.body.people.find((p: { userId: string }) => p.userId === userIds["ikke-startet"]);
    expect(ikkeStartet.lastLoginAt).toBeTruthy();
    expect(ikkeStartet.activeDaysByWeek).toHaveLength(12);

    const total = (res.body.buckets as Array<{ counts: Record<string, number> }>)
      .reduce((sum, b) => sum + b.counts.read + b.counts.submitted + b.counts.passed + b.counts.completed, 0);
    expect(total).toBe(8); // fire fra «aktiv», to leverte fra «anket», én fra «uten-rolle» og én fra «rolig»
  });

  it("rapportleser får rapporten; fagansvarlig og deltaker får det ikke", async () => {
    const reader = await request(app).get("/api/reports/activity").query({ department }).set(headersFor("REPORT_READER"));
    expect(reader.status).toBe(200);
    const smo = await request(app).get("/api/reports/activity").query({ department }).set(headersFor("SUBJECT_MATTER_OWNER"));
    expect(smo.status).toBe(403);
    const participant = await request(app).get("/api/reports/activity").query({ department }).set(headersFor("PARTICIPANT"));
    expect(participant.status).toBe(403);
    const smoRecent = await request(app).get(`/api/reports/activity/users/${userIds.aktiv}/recent`).set(headersFor("SUBJECT_MATTER_OWNER"));
    expect(smoRecent.status).toBe(403);
  });

  it("avviser en ukjent periode", async () => {
    const res = await request(app).get("/api/reports/activity").query({ period: "7" }).set(headersFor("ADMINISTRATOR"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error ?? res.body.code).toBe("report_filters_invalid");
  });

  it("«det siste hen har gjort»: titler på leserens språk, og et bestått forsøk én gang", async () => {
    const res = await request(app).get(`/api/reports/activity/users/${userIds.aktiv}/recent`).set(headersFor("ADMINISTRATOR"));
    expect(res.status).toBe(200);
    const events = res.body.events as Array<{ type: string; itemTitle: string; courseTitle: string | null }>;
    expect(events.map((e) => e.type)).toEqual(["completed", "passed", "submitted", "read"]);
    expect(events.find((e) => e.type === "read")).toMatchObject({ itemTitle: "Les meg først", courseTitle: "Aktivitetskurs" });
    expect(events.find((e) => e.type === "passed")).toMatchObject({ itemTitle: "Aktivitetsmodul" });
    expect(events.find((e) => e.type === "completed")).toMatchObject({ itemTitle: "Aktivitetskurs" });
  });

  it("en ukjent person gir 404", async () => {
    const res = await request(app).get("/api/reports/activity/users/finnes-ikke/recent").set(headersFor("ADMINISTRATOR"));
    expect(res.status).toBe(404);
  });

  it("oppslaget når ikke lenger enn lista: sluttet og gjest gir 404; en uten lagret rolle som har gjort noe gir svar", async () => {
    const sluttet = await request(app).get(`/api/reports/activity/users/${userIds.sluttet}/recent`).set(headersFor("ADMINISTRATOR"));
    expect(sluttet.status).toBe(404);
    const gjest = await request(app).get(`/api/reports/activity/users/${userIds.gjest}/recent`).set(headersFor("ADMINISTRATOR"));
    expect(gjest.status).toBe(404);
    const utenRolle = await request(app).get(`/api/reports/activity/users/${userIds["uten-rolle"]}/recent`).set(headersFor("ADMINISTRATOR"));
    expect(utenRolle.status).toBe(200);
    expect(utenRolle.body.events).toHaveLength(1);
  });

  it("et bestått vedtak på en gammel innlevering står i «det siste hen har gjort», også bak mange nyere forsøk", async () => {
    const res = await request(app).get(`/api/reports/activity/users/${userIds.sensor}/recent`).set(headersFor("ADMINISTRATOR"));
    expect(res.status).toBe(200);
    expect(res.body.events[0]).toMatchObject({ type: "passed", itemTitle: "Aktivitetsmodul" });
  });

  it("det ankede forsøket står som levert, ikke bestått, i «det siste hen har gjort»", async () => {
    const res = await request(app).get(`/api/reports/activity/users/${userIds.anket}/recent`).set(headersFor("ADMINISTRATOR"));
    expect(res.status).toBe(200);
    expect((res.body.events as Array<{ type: string }>).map((e) => e.type)).toEqual(["submitted", "submitted"]);
  });
});
