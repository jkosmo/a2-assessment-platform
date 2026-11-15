import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { withRevision } from "./support/courseRevision.js";

// #1164 (produkteier 14.11.2026, doc/DECISIONS.md «Svar fra produkteier på #1157, første runde»):
//   - «Nye kurs bør ikke være åpent for alle.» Hver vei som oppretter et kurs, gir et BEGRENSET kurs når den ikke sier noe:
//     «Nytt kurs» (skjemaet sender feltet; uten feltet er det API-et), agent-API-et (skillen), og «Importer som nytt kurs».
//     Et uttrykkelig valg står (kontroll), og et eksisterende kurs endres ikke (kontroll: en oppdatering fra fil lar det være åpent).
//   - Publiseringsdialogen sier hvem som ser kurset etterpå: `GET …/publish-audience`, regnet på tjeneren.
// Alt gjennom rutene.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `1164 ${name} ${RUN}-${seq++}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 400);
const C = "/api/admin/content";

// Eieren er en SMO, som i virkeligheten. Én adresse per test (grensen før innloggingen gjelder per IP-adresse).
const OWNER: Record<string, string> = {
  "x-user-id": `1164-owner-${RUN}`,
  "x-user-email": `owner.1164.${RUN}@x.test`,
  "x-user-name": "Eier",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};
const OTHER_SMO: Record<string, string> = {
  "x-user-id": `1164-other-${RUN}`,
  "x-user-email": `other.1164.${RUN}@x.test`,
  "x-user-name": "Annen produsent",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};
let ip = 0;
beforeEach(() => {
  ip += 1;
  OWNER["x-forwarded-for"] = `10.164.${Math.floor(ip / 250)}.${ip % 250}`;
  OTHER_SMO["x-forwarded-for"] = `10.165.${Math.floor(ip / 250)}.${ip % 250}`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}

const policyOf = async (courseId: string) =>
  (await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { enrollmentPolicy: true } })).enrollmentPolicy;

async function publishedSection() {
  const created = await ok(request(app).post(`${C}/sections`).set(OWNER).send({ title: L(tag("seksjon")), bodyMarkdown: L("Tekst.") }), "seksjon");
  const id = created.section.id as string;
  await ok(request(app).post(`${C}/sections/${id}/publish`).set(OWNER), "publiser seksjon");
  return id;
}

/** Et kurs med én publisert seksjon, opprettet som forfatteren gjør det. `policy` utelatt: tjenerens standard. */
async function courseWithSection(options: { policy?: "OPEN" | "RESTRICTED"; publish?: boolean } = {}) {
  const sectionId = await publishedSection();
  const created = await ok(
    request(app).post(`${C}/courses`).set(OWNER).send({ title: L(tag("kurs")), ...(options.policy ? { enrollmentPolicy: options.policy } : {}) }),
    "kurs",
  );
  const courseId = created.course.id as string;
  const items = await request(app).put(`${C}/courses/${courseId}/items`).set(OWNER).send(await withRevision(courseId, { items: [{ type: "SECTION", sectionId }] }));
  expect(items.status, show(items)).toBe(204);
  if (options.publish) await ok(request(app).post(`${C}/courses/${courseId}/publish`).set(OWNER).send({}), "publiser kurs");
  return { courseId, sectionId };
}

async function participant(options: { active?: boolean } = {}) {
  const externalId = `1164-p-${RUN}-${seq++}`;
  const user = await prisma.user.create({
    data: { externalId, name: `Deltaker ${externalId}`, email: `${externalId}@x.test`, activeStatus: options.active ?? true },
    select: { id: true },
  });
  const headers = { "x-user-id": externalId, "x-user-email": `${externalId}@x.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" };
  return { userId: user.id, headers };
}

async function klass(name: string, memberIds: string[], courseId: string) {
  const created = await ok(request(app).post(`${C}/classes`).set(OWNER).send({ name }), "klasse");
  const classId = created.class.id as string;
  for (const userId of memberIds) await ok(request(app).post(`${C}/classes/${classId}/members`).set(OWNER).send({ userId }), "medlem");
  await ok(request(app).post(`${C}/classes/${classId}/courses`).set(OWNER).send({ courseId }), "tildel kurs");
  return classId;
}

const audience = (courseId: string, query = "") => request(app).get(`${C}/courses/${courseId}/publish-audience${query}`).set(OWNER);

describe("#1164: nye kurs er begrenset som standard, fra hver vei som oppretter kurs", () => {
  it("«Nytt kurs» / POST /courses uten synlighet: begrenset. Et uttrykkelig valg står (kontroll)", async () => {
    const plain = await ok(request(app).post(`${C}/courses`).set(OWNER).send({ title: L(tag("standard")) }), "kurs");
    expect(plain.course.enrollmentPolicy).toBe("RESTRICTED");
    expect(await policyOf(plain.course.id)).toBe("RESTRICTED");

    const open = await ok(request(app).post(`${C}/courses`).set(OWNER).send({ title: L(tag("åpent")), enrollmentPolicy: "OPEN" }), "kurs");
    expect(await policyOf(open.course.id)).toBe("OPEN");
    const restricted = await ok(request(app).post(`${C}/courses`).set(OWNER).send({ title: L(tag("begrenset")), enrollmentPolicy: "RESTRICTED" }), "kurs");
    expect(await policyOf(restricted.course.id)).toBe("RESTRICTED");
  });

  it("agent-API-et (skillen, et agent-token): begrenset", async () => {
    const issued = await ok(request(app).post(`${C}/agent-authoring/tokens`).set(OWNER).send({ label: tag("token") }), "token");
    const created = await request(app).post(`${C}/courses`).set("authorization", `Bearer ${issued.token}`).send({ title: L(tag("fra skillen")), clientRef: "kurs" });
    expect(created.status, show(created)).toBe(201);
    expect(await policyOf(created.body.course.id)).toBe("RESTRICTED");
  });

  it("«Importer som nytt kurs»: begrenset, også fra et åpent kurs. «Oppdater dette kurset» lar det åpne kurset være åpent (kontroll)", async () => {
    const { courseId: sourceId } = await courseWithSection({ policy: "OPEN", publish: true });
    const exported = await ok(request(app).get(`${C}/courses/${sourceId}/export-package`).set(OWNER), "eksport");

    const imported = await ok(request(app).post(`${C}/courses/import`).set(OWNER).send({ payload: exported.envelope, mode: "createNew" }), "import som nytt");
    expect(imported.courseId).toBeTruthy();
    expect(imported.courseId).not.toBe(sourceId);
    expect(await policyOf(imported.courseId)).toBe("RESTRICTED");

    // Et eksisterende kurs er urørt: oppdateringen fra fila endrer ikke synligheten.
    await ok(request(app).post(`${C}/courses/import`).set(OWNER).send({ payload: exported.envelope, mode: "updateExisting", targetId: sourceId }), "oppdater fra fil");
    expect(await policyOf(sourceId)).toBe("OPEN");
  });

  it("et nytt, publisert kurs ses bare av de tildelte", async () => {
    const { courseId } = await courseWithSection({ publish: true });
    const outsider = await participant();
    const member = await participant();
    await klass(tag("klasse"), [member.userId], courseId);
    const seen = async (headers: Record<string, string>) =>
      ((await request(app).get("/api/courses").set(headers)).body.courses as Array<{ id: string }>).some((row) => row.id === courseId);
    expect(await seen(member.headers), "den tildelte ser kurset").toBe(true);
    expect(await seen(outsider.headers), "en som ikke er tildelt, ser det ikke").toBe(false);
  });
});

describe("#1164: GET …/publish-audience sier hvem som ser kurset etter publiseringen", () => {
  it("et åpent kurs: alle deltakere", async () => {
    const { courseId } = await courseWithSection({ policy: "OPEN" });
    const body = await ok(audience(courseId), "hvem");
    expect(body.audience).toEqual({ policy: "OPEN" });
  });

  it("et begrenset kurs uten tildelinger: ingen", async () => {
    const { courseId } = await courseWithSection();
    const body = await ok(audience(courseId), "hvem");
    expect(body.audience).toEqual({ policy: "RESTRICTED", classes: [], individualCount: 0, totalCount: 0 });
  });

  it("et begrenset kurs: klassene med antall som kan nås, de enkeltvis tildelte, og hver person én gang i alt", async () => {
    const { courseId } = await courseWithSection();
    const [p1, p2Inactive, p3, p4, p5] = [await participant(), await participant({ active: false }), await participant(), await participant(), await participant()];
    const nameA = `A-klasse ${RUN}`;
    const nameB = `B-klasse ${RUN}`;
    const classA = await klass(nameA, [p1.userId, p2Inactive.userId], courseId);
    const classB = await klass(nameB, [p1.userId, p3.userId], courseId);
    // En arkivert klasse gir ikke et nytt kurs til noen, og står ikke i lista.
    const archived = await klass(`C-arkivert ${RUN}`, [p5.userId], courseId);
    await ok(request(app).post(`${C}/classes/${archived}/archive`).set(OWNER), "arkiver klasse");
    // Enkeltvis: p4, og p1 som også er i begge klassene (telles én gang).
    await ok(request(app).post(`${C}/courses/${courseId}/enrollments`).set(OWNER).send({ userIds: [p4.userId, p1.userId] }), "enkeltvis");

    const body = await ok(audience(courseId), "hvem");
    expect(body.audience).toEqual({
      policy: "RESTRICTED",
      classes: [
        { id: classA, name: nameA, isSystem: false, memberCount: 1 },
        { id: classB, name: nameB, isSystem: false, memberCount: 2 },
      ],
      individualCount: 2,
      totalCount: 3,
    });
  });

  it("«Publiser utkastet»: med ?draft=1 gjelder synligheten i utkastet; uten, kursets", async () => {
    const { courseId, sectionId } = await courseWithSection({ publish: true });
    const revision = (await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { contentRevision: true } })).contentRevision;
    await ok(
      request(app).put(`${C}/courses/${courseId}/draft`).set(OWNER).send({
        items: [{ type: "SECTION", sectionId }],
        enrollmentPolicy: "OPEN",
        loaded: { expectedRevision: revision },
      }),
      "utkast",
    );
    expect((await ok(audience(courseId, "?draft=1"), "utkastet")).audience).toEqual({ policy: "OPEN" });
    expect((await ok(audience(courseId), "kurset")).audience.policy).toBe("RESTRICTED");
  });

  it("vaktet som publiseringen: en annen produsent får 403", async () => {
    const { courseId } = await courseWithSection();
    const refused = await request(app).get(`${C}/courses/${courseId}/publish-audience`).set(OTHER_SMO);
    expect(refused.status, show(refused)).toBe(403);
    expect(refused.body.error).toBe("content_ownership");
  });
});
