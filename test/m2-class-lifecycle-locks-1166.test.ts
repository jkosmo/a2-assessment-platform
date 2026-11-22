import request from "supertest";
import type { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1166 (Codex-funn i #1157): «arkivert» ble sjekket FØR låsen ved sletting av en klasse og ved tildeling av et kurs til en klasse.
//   - Sletting: en gjenoppretting som kom mellom sjekken og slettingen, gjorde klassen aktiv, og den ble slettet likevel.
//   - Tildeling: kursets arkivtilstand ble lest før transaksjonen, og bare klassen ble låst. En arkivering av kurset imellom
//     gjorde sjekken ugyldig.
// Nå sjekkes begge i skrivetransaksjonen, etter at raden er låst (mønsteret fra courseArchive.ts). Testen holder den andre
// skrivingen åpen i en egen transaksjon, sender kallet, venter til det enten står og venter på en lås eller er ferdig (en tilstand,
// ikke en fast pause), slipper, og krever avslaget.
//
// Uendret, og festet her: å fjerne noe fra en arkivert klasse går fortsatt. Og produkteiers regel (14.11.2026): den som eier en
// klasse, kan tildele kurs hen ikke eier, via klassen — men ikke enkeltvis fra kurset.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `1166 ${name} ${RUN}-${seq++}`;
const L = (text: string) => JSON.stringify({ "en-GB": text, nb: text, nn: text });
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 400);
const C = "/api/admin/content";

const person = (id: string, role: string, ip: string) => ({
  "x-user-id": `${id}-${RUN}`,
  "x-user-email": `${id}.${RUN}@x.test`,
  "x-user-name": id,
  "x-user-roles": role,
  "x-forwarded-for": ip,
});
const ADMIN = person("1166-admin", "ADMINISTRATOR", "10.116.6.1");
const CLASS_OWNER = person("1166-klasseeier", "SUBJECT_MATTER_OWNER", "10.116.6.2");
const COURSE_OWNER = person("1166-kurseier", "SUBJECT_MATTER_OWNER", "10.116.6.3");

afterAll(async () => {
  await prisma.$disconnect();
});

async function newClass(headers: Record<string, string> = ADMIN) {
  const created = await request(app).post(`${C}/classes`).set(headers).send({ name: tag("klasse") });
  expect(created.status, show(created)).toBe(201);
  return created.body.class.id as string;
}

async function newCourse() {
  const created = await prisma.course.create({ data: { title: L(tag("kurs")), enrollmentPolicy: "RESTRICTED", publishedAt: new Date() }, select: { id: true } });
  return created.id;
}

/**
 * Venter til et kall enten står og venter på en lås mot `table`, eller er ferdig. Ferdig er også et svar: uten fiksen venter ikke
 * tildelingen (fremmednøkkelen låser bare kursets nøkkel), og da skal testen bli rød på avslaget, ikke her.
 */
async function waitUntilBlockedOrDone(table: string, isDone: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (isDone()) return "done";
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND state = 'active' AND query LIKE ${`%"${table}"%`}`;
    if (Number(rows[0]?.n ?? 0) > 0) return "blocked";
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`kallet verken ventet på en lås mot ${table} eller ble ferdig innen 10 s`);
}

/** Holder `write` åpen i en egen transaksjon til `release` kalles. */
function holdOpen(write: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let ready!: () => void;
  const isReady = new Promise<void>((resolve) => { ready = resolve; });
  const done = prisma.$transaction(async (tx) => {
    await write(tx);
    ready();
    await held;
  }, { timeout: 20_000 });
  return { isReady, release, done };
}

describe("#1166: sletting av en klasse sjekker «arkivert» etter låsen", () => {
  it("kontroll: en arkivert klasse kan slettes; en aktiv kan ikke", async () => {
    const active = await newClass();
    const refused = await request(app).delete(`${C}/classes/${active}`).set(ADMIN);
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("class_not_archived");

    const archived = await newClass();
    expect((await request(app).post(`${C}/classes/${archived}/archive`).set(ADMIN)).status).toBe(200);
    expect((await request(app).delete(`${C}/classes/${archived}`).set(ADMIN)).status).toBe(204);
    expect(await prisma.class.count({ where: { id: archived } })).toBe(0);
  });

  it("en gjenoppretting som står åpen mens klassen slettes: slettingen venter, ser at klassen er aktiv, og sletter ikke", async () => {
    const classId = await newClass();
    expect((await request(app).post(`${C}/classes/${classId}/archive`).set(ADMIN)).status).toBe(200);

    const restoring = holdOpen((tx) => tx.class.update({ where: { id: classId }, data: { archivedAt: null } }));
    await restoring.isReady;
    let settled = false;
    const deleting = request(app).delete(`${C}/classes/${classId}`).set(ADMIN).then((response) => { settled = true; return response; });
    expect(await waitUntilBlockedOrDone("Class", () => settled)).toBe("blocked");
    restoring.release();
    await restoring.done;

    const response = await deleting;
    expect(response.status, show(response)).toBe(400);
    expect(response.body.error).toBe("class_not_archived");
    expect(await prisma.class.count({ where: { id: classId } }), "klassen skal finnes").toBe(1);
  });
});

describe("#1166: tildeling av et kurs til en klasse sjekker kursets arkivtilstand etter låsen", () => {
  it("kontroll: et aktivt kurs kan tildeles; et arkivert kan ikke", async () => {
    const classId = await newClass();
    const active = await newCourse();
    const assigned = await request(app).post(`${C}/classes/${classId}/courses`).set(ADMIN).send({ courseId: active });
    expect(assigned.status, show(assigned)).toBe(201);

    const archived = await newCourse();
    await prisma.course.update({ where: { id: archived }, data: { archivedAt: new Date(), publishedAt: null } });
    const refused = await request(app).post(`${C}/classes/${classId}/courses`).set(ADMIN).send({ courseId: archived });
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("course_archived");
  });

  it("en arkivering av kurset som står åpen mens det tildeles: tildelingen venter, og avvises når arkiveringen er skrevet", async () => {
    const classId = await newClass();
    const courseId = await newCourse();

    const archiving = holdOpen((tx) => tx.course.update({ where: { id: courseId }, data: { archivedAt: new Date(), publishedAt: null } }));
    await archiving.isReady;
    let settled = false;
    const assigning = request(app).post(`${C}/classes/${classId}/courses`).set(ADMIN).send({ courseId }).then((response) => { settled = true; return response; });
    await waitUntilBlockedOrDone("Course", () => settled);
    archiving.release();
    await archiving.done;

    const response = await assigning;
    expect(response.status, show(response)).toBe(400);
    expect(response.body.error).toBe("course_archived");
    expect(await prisma.courseGroupAssignment.count({ where: { classId, courseId } }), "ingen tildeling skal være skrevet").toBe(0);
  });

  it("uendret: å ta et kurs ut av en arkivert klasse går fortsatt", async () => {
    const classId = await newClass();
    const courseId = await newCourse();
    expect((await request(app).post(`${C}/classes/${classId}/courses`).set(ADMIN).send({ courseId })).status).toBe(201);
    expect((await request(app).post(`${C}/classes/${classId}/archive`).set(ADMIN)).status).toBe(200);
    const removed = await request(app).delete(`${C}/classes/${classId}/courses/${courseId}`).set(ADMIN);
    expect(removed.status, show(removed)).toBe(204);
    expect(await prisma.courseGroupAssignment.count({ where: { classId, courseId } })).toBe(0);
  });
});

describe("#1166: den som eier en klasse, kan tildele kurs hen ikke eier, via klassen (produkteier 14.11.2026)", () => {
  it("via klassen: 201. Enkeltvis fra kurset: 403, for der kreves det at man eier kurset", async () => {
    const created = await request(app).post(`${C}/courses`).set(COURSE_OWNER).send({ title: JSON.parse(L(tag("en annens kurs"))) });
    expect(created.status, show(created)).toBe(201);
    const courseId = created.body.course.id as string;
    const classId = await newClass(CLASS_OWNER);
    const externalId = `1166-p-${RUN}`;
    const learner = await prisma.user.create({ data: { externalId, name: "Deltaker", email: `${externalId}@x.test` }, select: { id: true } });

    const viaClass = await request(app).post(`${C}/classes/${classId}/courses`).set(CLASS_OWNER).send({ courseId });
    expect(viaClass.status, show(viaClass)).toBe(201);
    expect(await prisma.courseGroupAssignment.count({ where: { classId, courseId } })).toBe(1);

    const individually = await request(app).post(`${C}/courses/${courseId}/enrollments`).set(CLASS_OWNER).send({ userIds: [learner.id] });
    expect(individually.status, show(individually)).toBe(403);
    expect(individually.body.error).toBe("content_ownership");

    // Kontroll: klassen må fortsatt være ens egen.
    const notMyClass = await newClass(COURSE_OWNER);
    const refused = await request(app).post(`${C}/classes/${notMyClass}/courses`).set(CLASS_OWNER).send({ courseId });
    expect(refused.status, show(refused)).toBe(403);
  });
});
