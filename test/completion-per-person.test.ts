import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// «Fullføring per modul» teller PERSONER, ikke forsøk (produkteier 2026-10-19). Før telte rapporten
// hvert forsøk: en deltaker som strøk og så besto, sto både under «Bestått» og «Ikke bestått», og
// «Totalt» var antall innleveringer. Det siste forsøket er det som gjelder; «Forsøk» viser alle.
//
// Mot ekte Postgres fordi «siste forsøk» hviler på sorteringen i spørringen — den kan ikke måles med
// en mock. Forsøkene opprettes i tidsrekkefølge, så uten sorteringen ser rapporten det GAMLE først.

const stamp = `${Date.now()}-${Math.round(performance.now())}`;
const reader = {
  "x-user-id": `per-person-reader-${stamp}`,
  "x-user-email": `per-person-reader-${stamp}@x.test`,
  "x-user-name": "Per Person Reader",
  "x-user-roles": "REPORT_READER",
};

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe("Fullføring per modul teller personer, siste forsøk", () => {
  const userIds: string[] = [];
  const submissionIds: string[] = [];
  let moduleId = "";
  let moduleVersionId = "";

  async function attempt(userId: string, daysAgo: number, status: "COMPLETED" | "UNDER_REVIEW", passed: boolean | null) {
    const submission = await prisma.submission.create({
      data: { userId, moduleId, moduleVersionId, deliveryType: "text", submissionStatus: status, submittedAt: ago(daysAgo) },
      select: { id: true },
    });
    submissionIds.push(submission.id);
    if (passed !== null) {
      await prisma.assessmentDecision.create({
        data: {
          submissionId: submission.id, moduleVersionId, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: passed ? 1 : 0,
          redFlagsJson: "[]", passFailTotal: passed, decisionType: "AUTOMATIC", decisionReason: "Fikstur, telling per person.",
          finalisedAt: ago(daysAgo),
        },
      });
    }
  }

  async function person(tag: string) {
    const user = await prisma.user.create({
      data: { externalId: `pp-${tag}-${stamp}`, name: `PP ${tag}`, email: `pp-${tag}-${stamp}@x.test`, activeStatus: true },
      select: { id: true },
    });
    userIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    moduleId = (await prisma.module.create({ data: { title: JSON.stringify({ nb: "Telling per person", "en-GB": "Per person" }) }, select: { id: true } })).id;
    moduleVersionId = (await prisma.moduleVersion.create({
      data: { moduleId, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date() },
      select: { id: true },
    })).id;

    // Saken fra skjermbildet: strøk, tok modulen på nytt, besto. Skal telles som ÉN bestått.
    const omtak = await person("omtak");
    await attempt(omtak, 3, "COMPLETED", false);
    await attempt(omtak, 1, "COMPLETED", true);
    // Besto første gang.
    await attempt(await person("bestod"), 2, "COMPLETED", true);
    // Strøk, og har ikke prøvd igjen.
    await attempt(await person("strok"), 2, "COMPLETED", false);
    // Strøk, og det nye forsøket ligger hos sensor: «under vurdering», ikke «ikke bestått».
    const venter = await person("venter");
    await attempt(venter, 3, "COMPLETED", false);
    await attempt(venter, 1, "UNDER_REVIEW", null);
  });

  afterAll(async () => {
    await prisma.assessmentDecision.deleteMany({ where: { submissionId: { in: submissionIds } } });
    await prisma.submission.deleteMany({ where: { id: { in: submissionIds } } });
    if (moduleVersionId) await prisma.moduleVersion.deleteMany({ where: { id: moduleVersionId } });
    if (moduleId) await prisma.module.deleteMany({ where: { id: moduleId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("fullføring: fire deltakere, tre fullført, én under vurdering, seks forsøk", async () => {
    const res = await request(app).get("/api/reports/completion").query({ moduleId }).set(reader);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({
      moduleId,
      totalSubmissions: 4,
      completedSubmissions: 3,
      underReviewSubmissions: 1,
      completionRate: 0.75,
      attempts: 6,
    });
    expect(res.body.totals).toMatchObject({ totalSubmissions: 4, completedSubmissions: 3, underReviewSubmissions: 1, attempts: 6 });
  });

  it("bestått: den som strøk og så besto, er bestått og ikke strøket", async () => {
    const res = await request(app).get("/api/reports/pass-rates").query({ moduleId }).set(reader);
    expect(res.status).toBe(200);
    expect(res.body.rows[0]).toMatchObject({
      moduleId,
      totalSubmissions: 4,
      decisionCount: 3,
      passCount: 2,
      failCount: 1,
      underReviewCount: 1,
      passRate: 0.6667,
    });
  });

  it("statusfilteret gjelder det SISTE forsøket: et gammelt fullført forsøk drar ikke med seg personen", async () => {
    const res = await request(app).get("/api/reports/completion").query({ moduleId, status: "COMPLETED" }).set(reader);
    expect(res.status).toBe(200);
    // «venter» har et fullført forsøk, men det siste ligger hos sensor. Forsøkene telles bare for de tre som er med.
    expect(res.body.rows[0]).toMatchObject({ totalSubmissions: 3, completedSubmissions: 3, underReviewSubmissions: 0, attempts: 4 });
  });

  it("utfallsfilteret gjelder det siste forsøket: «ikke bestått» er bare den som ikke har prøvd igjen", async () => {
    const res = await request(app).get("/api/reports/pass-rates").query({ moduleId, status: "FAIL" }).set(reader);
    expect(res.status).toBe(200);
    expect(res.body.rows[0]).toMatchObject({ totalSubmissions: 1, failCount: 1, passCount: 0, underReviewCount: 0 });
  });

  it("CSV-eksporten har samme tall og kolonnen for forsøk", async () => {
    const res = await request(app).get("/api/reports/export").query({ type: "completion", format: "csv", moduleId }).set(reader);
    expect(res.status).toBe(200);
    const [header, row] = String(res.text).trim().split(/\r?\n/);
    const cols = header.split(",");
    const values = row.split(",");
    const at = (name: string) => values[cols.indexOf(name)];
    expect(cols).toContain("attempts");
    expect(at("totalSubmissions")).toBe("4");
    expect(at("attempts")).toBe("6");
  });
});
