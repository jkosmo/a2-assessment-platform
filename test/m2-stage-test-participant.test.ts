import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// 2.154.1: stage-testkontoen som DELTAKER, gjennom rutene (src/auth/stageTestService.ts, src/auth/authenticate.ts).
//
// Resten av integrasjonssuiten kjører med AUTH_MODE=mock, der stage-testkontoen ikke finnes: den er et app-only Entra-token.
// Denne fila kjører derfor appen i Entra-modus, med `jwtVerify` byttet ut (signaturen er ikke det som prøves her — det er hva
// plattformen gjør med et token den alt har godtatt) og stage-innstillingene satt. Alt etter tokenet er ekte: brukeren lagres i
// testdatabasen, rollene leses som på stage, og kursporten i `routes/submissions.ts` slår opp kurs og klasser.
//
// ⚠️ Miljøet settes i `vi.hoisted`, altså FØR `src/config/env.ts` leses (den validerer ved import), og tilbakestilles i
// `afterAll`, så neste fil får sitt eget.

const h = vi.hoisted(() => {
  const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const APP = `stage-app-${RUN}`;
  const keys = ["AUTH_MODE", "ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_AUDIENCE", "DEPLOY_ENVIRONMENT", "STAGE_TEST_SERVICE_APP_ID"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]])) as Record<(typeof keys)[number], string | undefined>;
  process.env.AUTH_MODE = "entra";
  process.env.ENTRA_TENANT_ID = "test-tenant";
  process.env.ENTRA_CLIENT_ID = "test-client";
  process.env.ENTRA_AUDIENCE = "api://test-audience";
  process.env.DEPLOY_ENVIRONMENT = "staging";
  process.env.STAGE_TEST_SERVICE_APP_ID = APP;
  // Tokenene testen kan vise fram. Nøkkelen er det som står etter «Bearer ».
  const tokens: Record<string, Record<string, unknown>> = {
    "app-token": { oid: `sp-${RUN}`, sub: `sp-${RUN}`, azp: APP, roles: ["ADMINISTRATOR"] },
    "annen-app-token": { oid: `sp2-${RUN}`, sub: `sp2-${RUN}`, azp: `annen-app-${RUN}` },
    "bruker-token": { oid: `bruker-${RUN}`, preferred_username: `bruker-${RUN}@example.test`, name: "Bruker", scp: "access_as_user", roles: [] },
  };
  return { RUN, APP, saved, tokens };
});

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn(async (token: string) => {
      const payload = h.tokens[token];
      if (!payload) throw new Error("ugyldig token");
      return { payload, protectedHeader: { alg: "RS256" } };
    }),
  };
});

import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { env } from "../src/config/env.js";
import { issueAgentAuthoringToken } from "../src/auth/agentAuthoringTokenService.js";

const FAGANSVARLIG_ID = `stage-test-service:${h.APP}`;
const DELTAKER_ID = `stage-test-service-participant:${h.APP}`;
const BRUKER_ID = `bruker-${h.RUN}`;
const AGENT_EIER_ID = `agent-eier-${h.RUN}`;

const som = (token: string, rolle?: string) => ({
  authorization: `Bearer ${token}`,
  ...(rolle === undefined ? {} : { "x-stage-test-role": rolle }),
});
const FAGANSVARLIG = som("app-token");
const DELTAKER = som("app-token", "PARTICIPANT");

const originalCourseOnly = env.PARTICIPANT_COURSE_ONLY;
const originalDeploy = env.DEPLOY_ENVIRONMENT;
const opprettet = { kurs: [] as string[], moduler: [] as string[], klasser: [] as string[] };

async function modulIKurs(enrollmentPolicy: "OPEN" | "RESTRICTED" | null) {
  const modul = await prisma.module.create({ data: { title: `Stage-deltaker ${h.RUN}` }, select: { id: true } });
  opprettet.moduler.push(modul.id);
  if (enrollmentPolicy === null) return { moduleId: modul.id, courseId: null };
  const kurs = await prisma.course.create({
    data: { title: JSON.stringify({ "en-GB": "K", nb: "K", nn: "K" }), publishedAt: new Date(), enrollmentPolicy },
    select: { id: true },
  });
  opprettet.kurs.push(kurs.id);
  await prisma.courseItem.create({ data: { courseId: kurs.id, moduleId: modul.id, itemType: "MODULE", sortOrder: 0 } });
  return { moduleId: modul.id, courseId: kurs.id };
}

const lever = (hoder: Record<string, string>, moduleId: string) =>
  request(app).post("/api/submissions").set(hoder).send({ moduleId, deliveryType: "text", responseJson: {} });

describe("stage-testkontoen som deltaker, gjennom rutene (2.154.1)", () => {
  afterEach(() => {
    env.PARTICIPANT_COURSE_ONLY = originalCourseOnly;
    env.DEPLOY_ENVIRONMENT = originalDeploy;
  });

  afterAll(async () => {
    await prisma.courseGroupAssignment.deleteMany({ where: { classId: { in: opprettet.klasser } } });
    await prisma.class.deleteMany({ where: { id: { in: opprettet.klasser } } });
    await prisma.courseItem.deleteMany({ where: { courseId: { in: opprettet.kurs } } });
    await prisma.course.deleteMany({ where: { id: { in: opprettet.kurs } } });
    await prisma.module.deleteMany({ where: { id: { in: opprettet.moduler } } });
    const brukere = [FAGANSVARLIG_ID, DELTAKER_ID, BRUKER_ID, AGENT_EIER_ID];
    await prisma.agentAuthoringToken.deleteMany({ where: { user: { externalId: { in: brukere } } } });
    await prisma.user.deleteMany({ where: { externalId: { in: brukere } } });
    await prisma.$disconnect();
    for (const [key, value] of Object.entries(h.saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uten hodet: fagansvarlig som før; med PARTICIPANT: en egen bruker med bare deltakerrollen — også andre gang", async () => {
    const fagansvarlig = await request(app).get("/api/me").set(FAGANSVARLIG);
    expect(fagansvarlig.status, fagansvarlig.text).toBe(200);
    expect(fagansvarlig.body.user.externalId).toBe(FAGANSVARLIG_ID);
    expect(fagansvarlig.body.user.roles).toEqual(["SUBJECT_MATTER_OWNER"]);

    for (const gang of [1, 2]) {
      const deltaker = await request(app).get("/api/me").set(DELTAKER);
      expect(deltaker.status, `gang ${gang}: ${deltaker.text}`).toBe(200);
      expect(deltaker.body.user.externalId).toBe(DELTAKER_ID);
      expect(deltaker.body.user.email).toBe("stage-testkonto-deltaker@stage.invalid");
      expect(deltaker.body.user.roles, `gang ${gang}`).toEqual(["PARTICIPANT"]);
    }

    // To brukere i databasen, og ingen lagrede roller på deltakeren: rollen kommer bare fra innloggingen.
    const lagret = await prisma.user.findMany({
      where: { externalId: { in: [FAGANSVARLIG_ID, DELTAKER_ID] } },
      select: { id: true, externalId: true, roleAssignments: { select: { appRole: true } } },
    });
    expect(lagret).toHaveLength(2);
    expect(new Set(lagret.map((u) => u.id)).size).toBe(2);
    expect(lagret.find((u) => u.externalId === DELTAKER_ID)?.roleAssignments).toEqual([]);
  });

  it("deltakeren er en deltaker: administrasjonsflaten svarer 403, mens fagansvarlig kommer inn", async () => {
    const deltaker = await request(app).get("/api/admin/content/courses").set(DELTAKER);
    expect(deltaker.status, deltaker.text).toBe(403);
    // Kontroll: det er rollen som stenger, ikke at ruta er stengt for stage-testkontoen.
    const fagansvarlig = await request(app).get("/api/admin/content/courses").set(FAGANSVARLIG);
    expect(fagansvarlig.status, fagansvarlig.text).toBe(200);
  });

  it("enhver annen verdi i hodet avvises med 401 — ingen stille tilbakefall til fagansvarlig", async () => {
    for (const verdi of ["participant", "ADMINISTRATOR", "SUBJECT_MATTER_OWNER", "PARTICIPANT,ADMINISTRATOR", ""]) {
      const svar = await request(app).get("/api/me").set(som("app-token", verdi));
      expect(svar.status, `verdi «${verdi}»`).toBe(401);
    }
  });

  it("hodet hjelper ikke utenfor stage, og ikke fra en annen app", async () => {
    env.DEPLOY_ENVIRONMENT = "production";
    expect((await request(app).get("/api/me").set(DELTAKER)).status).toBe(401);
    expect((await request(app).get("/api/me").set(FAGANSVARLIG)).status).toBe(401);
    env.DEPLOY_ENVIRONMENT = undefined;
    expect((await request(app).get("/api/me").set(DELTAKER)).status).toBe(401);
    env.DEPLOY_ENVIRONMENT = originalDeploy;

    expect((await request(app).get("/api/me").set(som("annen-app-token", "PARTICIPANT"))).status).toBe(401);
    expect((await request(app).get("/api/me").set(som("annen-app-token"))).status).toBe(401);
    // Kontroll: med stage-innstillingen tilbake slipper deltakeren inn igjen.
    expect((await request(app).get("/api/me").set(DELTAKER)).status).toBe(200);
  });

  it("hodet har ingen virkning for et brukertoken — verken mer eller mindre", async () => {
    for (const verdi of [undefined, "PARTICIPANT", "ADMINISTRATOR", "tull"]) {
      const svar = await request(app).get("/api/me").set(som("bruker-token", verdi));
      expect(svar.status, `verdi «${verdi}»`).toBe(200);
      expect(svar.body.user.externalId).toBe(BRUKER_ID);
      expect(svar.body.user.roles, `verdi «${verdi}»`).toEqual([]);
    }
  });

  it("hodet har ingen virkning for et agent-token: rollene er dem tokenet ble utstedt med", async () => {
    const eier = await prisma.user.create({
      data: { externalId: AGENT_EIER_ID, email: `${AGENT_EIER_ID}@example.test`, name: "Agent-eier" },
      select: { id: true },
    });
    const { secret } = await issueAgentAuthoringToken({ userId: eier.id, roles: ["SUBJECT_MATTER_OWNER"] });
    for (const verdi of [undefined, "PARTICIPANT", "tull"]) {
      const svar = await request(app).post("/api/admin/content/agent-authoring/validate").set(som(secret, verdi)).send({});
      // Fagansvarlig når fram til valideringen (400 for en tom kropp); som deltaker ville administrasjonsflaten svart 403.
      expect([401, 403], `verdi «${verdi}»: ${svar.status} ${svar.text.slice(0, 200)}`).not.toContain(svar.status);
    }
  });

  it("kursporten: modul uten kurs og begrenset kurs gir course_required; åpent kurs og klasse med kurset slipper gjennom", async () => {
    env.PARTICIPANT_COURSE_ONLY = true;

    const utenKurs = await modulIKurs(null);
    const nektet = await lever(DELTAKER, utenKurs.moduleId);
    expect(nektet.status, nektet.text).toBe(403);
    expect(nektet.body.error).toBe("course_required");
    // Kontroll: fagansvarlig-identiteten går forbi porten (det er grunnen til at deltakeridentiteten trengs).
    expect((await lever(FAGANSVARLIG, utenKurs.moduleId)).body.error).not.toBe("course_required");

    // Åpent publisert kurs: porten slipper gjennom. Modulen har ingen publisert versjon, så innleveringen feiler senere —
    // men ikke i porten.
    const åpent = await modulIKurs("OPEN");
    const iÅpent = await lever(DELTAKER, åpent.moduleId);
    expect(iÅpent.body.error, iÅpent.text).not.toBe("course_required");
    expect(iÅpent.status).not.toBe(403);

    // Begrenset kurs deltakeren ikke har: nektet. Etter at deltakeren er lagt i en klasse med kurset: slipper gjennom.
    const begrenset = await modulIKurs("RESTRICTED");
    const før = await lever(DELTAKER, begrenset.moduleId);
    expect(før.status, før.text).toBe(403);
    expect(før.body.error).toBe("course_required");

    const deltaker = await prisma.user.findUniqueOrThrow({ where: { externalId: DELTAKER_ID }, select: { id: true } });
    const klasse = await prisma.class.create({ data: { name: `Stage-deltaker ${h.RUN}`, kind: "MANUAL" }, select: { id: true } });
    opprettet.klasser.push(klasse.id);
    await prisma.classMember.create({ data: { classId: klasse.id, userId: deltaker.id } });
    await prisma.courseGroupAssignment.create({ data: { classId: klasse.id, courseId: begrenset.courseId! } });

    const etter = await lever(DELTAKER, begrenset.moduleId);
    expect(etter.body.error, etter.text).not.toBe("course_required");
    expect(etter.status).not.toBe(403);
  });
});
