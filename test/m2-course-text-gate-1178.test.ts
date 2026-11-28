// #1178 skive 2 (prinsipp 4, doc/design/PLAN_1178_KURS_PUBLISERINGSPORT.md): publiseringen sjekker at kursets navn og beskrivelse
// finnes på alle tre språk. Hver vei inn, gjennom rutene:
//   1. «Publiser» når alt innhold er publisert   → 422 course_translation_incomplete, kurset er ikke publisert
//   2. «Publiser» med upubliserte elementer       → 422, og INGEN av elementene er publisert
//   3. «Publiser utkastet»                        → 422, utkastet står og kurset er som før
//   4. Import av et publisert kurs                → importeres, men holdes tilbake (upublisert), og importen sier det
// Hver med en kontroll som slipper gjennom.
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { withRevision } from "./support/courseRevision.js";

const admin = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const C = "/api/admin/content";
const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `1178 ${name} ${RUN}-${seq++}`;
const tre = (text: string) => ({ nb: text, nn: `${text} nn`, "en-GB": `${text} en` });
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 400);

afterAll(async () => {
  await prisma.$disconnect();
});

async function section(published: boolean) {
  // `draft: true`: uten den publiseres en ny seksjon når den opprettes (AA-2), og kaskaden ville ikke hatt noe å publisere.
  const r = await request(app).post(`${C}/sections`).set(admin).send({ title: tre(tag("seksjon")), bodyMarkdown: tre("Tekst."), draft: true });
  expect(r.status, show(r)).toBe(201);
  const id = r.body.section.id as string;
  if (published) expect((await request(app).post(`${C}/sections/${id}/publish`).set(admin)).status).toBe(200);
  const row = await prisma.courseSection.findUniqueOrThrow({ where: { id }, select: { activeVersionId: true } });
  expect(row.activeVersionId === null, "fiksturen: seksjonen er publisert bare når testen ber om det").toBe(!published);
  return id;
}

/** Et kurs med én seksjon. `title`/`description` sendes som forfatteren gjør (språkkart). */
async function course(options: { title: Record<string, string>; description?: Record<string, string>; sectionPublished?: boolean }) {
  const sectionId = await section(options.sectionPublished !== false);
  const created = await request(app).post(`${C}/courses`).set(admin).send({
    title: options.title,
    ...(options.description ? { description: options.description } : {}),
    enrollmentPolicy: "OPEN",
  });
  expect(created.status, show(created)).toBe(201);
  const courseId = created.body.course.id as string;
  const items = await request(app).put(`${C}/courses/${courseId}/items`).set(admin).send(await withRevision(courseId, { items: [{ type: "SECTION", sectionId }] }));
  expect(items.status, show(items)).toBe(204);
  return { courseId, sectionId };
}

const courseRow = (courseId: string) =>
  prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { publishedAt: true, title: true, description: true } });

function expectGate(res: request.Response, issues: Array<{ field: string; missingLocales: string[] }>) {
  expect(res.status, show(res)).toBe(422);
  expect(res.body.error).toBe("course_translation_incomplete");
  expect(res.body.details.issues.map((i: { field: string; missingLocales: string[] }) => ({ field: i.field, missingLocales: i.missingLocales }))).toEqual(issues);
}

describe("#1178 skive 2 — publiseringsporten for kursets navn og beskrivelse", () => {
  it("vei 1: «Publiser» avvises når navnet mangler nynorsk og engelsk; kurset er ikke publisert", async () => {
    const { courseId } = await course({ title: { nb: tag("bare bokmål") } });
    const res = await request(app).post(`${C}/courses/${courseId}/publish`).set(admin).send({});
    expectGate(res, [{ field: "title", missingLocales: ["en-GB", "nn"] }]);
    expect((await courseRow(courseId)).publishedAt).toBeNull();
  });

  it("vei 1, kontroll: navn på alle tre språk og ingen beskrivelse publiseres", async () => {
    const { courseId } = await course({ title: tre(tag("komplett")) });
    const res = await request(app).post(`${C}/courses/${courseId}/publish`).set(admin).send({});
    expect(res.status, show(res)).toBe(200);
    expect((await courseRow(courseId)).publishedAt).not.toBeNull();
  });

  it("vei 1: en beskrivelse på bare bokmål avvises; navnet er komplett", async () => {
    const { courseId } = await course({ title: tre(tag("beskrivelse")), description: { nb: "Bare bokmål." } });
    const res = await request(app).post(`${C}/courses/${courseId}/publish`).set(admin).send({});
    expectGate(res, [{ field: "description", missingLocales: ["en-GB", "nn"] }]);
  });

  it("vei 2: kaskaden avvises før noe skrives — seksjonen er fortsatt upublisert", async () => {
    const { courseId, sectionId } = await course({ title: { nb: tag("kaskade"), "en-GB": "Cascade" }, sectionPublished: false });
    const res = await request(app).post(`${C}/courses/${courseId}/publish`).set(admin).send({ publishItems: true });
    expectGate(res, [{ field: "title", missingLocales: ["nn"] }]);
    expect((await courseRow(courseId)).publishedAt).toBeNull();
    const s = await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { activeVersionId: true } });
    expect(s.activeVersionId, "seksjonen ble ikke publisert av en kaskade som stoppet").toBeNull();
  });

  it("vei 2, kontroll: kaskaden med komplett navn publiserer både seksjonen og kurset", async () => {
    const { courseId, sectionId } = await course({ title: tre(tag("kaskade ok")), sectionPublished: false });
    const res = await request(app).post(`${C}/courses/${courseId}/publish`).set(admin).send({ publishItems: true });
    expect(res.status, show(res)).toBe(200);
    expect((await courseRow(courseId)).publishedAt).not.toBeNull();
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { activeVersionId: true } })).activeVersionId).not.toBeNull();
  });

  it("vei 3: «Publiser utkastet» med et navn uten nynorsk avvises; utkastet står og kurset er som før", async () => {
    const original = tre(tag("utkast"));
    const { courseId, sectionId } = await course({ title: original });
    expect((await request(app).post(`${C}/courses/${courseId}/publish`).set(admin).send({})).status).toBe(200);
    const before = await courseRow(courseId);
    const loaded = (await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { contentRevision: true } })).contentRevision;
    const saved = await request(app).put(`${C}/courses/${courseId}/draft`).set(admin).send({
      title: { nb: "Nytt navn", "en-GB": "New name" },
      items: [{ type: "SECTION", sectionId }],
      loaded: { expectedRevision: loaded },
    });
    expect(saved.status, show(saved)).toBe(200);
    const draft = saved.body.draft as { id: string; revision: number };
    const res = await request(app).post(`${C}/courses/${courseId}/draft/publish`).set(admin).send({ loaded: { draftId: draft.id, revision: draft.revision } });
    expectGate(res, [{ field: "title", missingLocales: ["nn"] }]);
    expect(await prisma.courseDraft.count({ where: { courseId } }), "utkastet står").toBe(1);
    expect(await courseRow(courseId)).toEqual(before);
  });

  it("vei 3, kontroll: et utkast med navn på alle tre språk publiseres", async () => {
    const { courseId, sectionId } = await course({ title: tre(tag("utkast ok")) });
    expect((await request(app).post(`${C}/courses/${courseId}/publish`).set(admin).send({})).status).toBe(200);
    const loaded = (await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { contentRevision: true } })).contentRevision;
    const saved = await request(app).put(`${C}/courses/${courseId}/draft`).set(admin).send({
      title: tre("Nytt navn"),
      items: [{ type: "SECTION", sectionId }],
      loaded: { expectedRevision: loaded },
    });
    expect(saved.status, show(saved)).toBe(200);
    const res = await request(app).post(`${C}/courses/${courseId}/draft/publish`).set(admin).send({ loaded: { draftId: saved.body.draft.id, revision: saved.body.draft.revision } });
    expect(res.status, show(res)).toBe(200);
    expect(await prisma.courseDraft.count({ where: { courseId } })).toBe(0);
  });

  /** En eksportert fil av et publisert kurs, med navnet byttet ut. */
  async function exportedPublishedCourse(title: unknown) {
    const { courseId } = await course({ title: tre(tag("import")) });
    expect((await request(app).post(`${C}/courses/${courseId}/publish`).set(admin).send({})).status).toBe(200);
    const out = await request(app).get(`${C}/courses/${courseId}/export-package`).set(admin);
    expect(out.status, show(out)).toBe(200);
    const file = JSON.parse(JSON.stringify(out.body.envelope ?? out.body));
    expect(file.course.course.audit.publishedAt, "fila sier at kurset var publisert").toBeTruthy();
    file.course.course.title = title;
    return file;
  }

  it("vei 4: en import av et publisert kurs med navn på bare bokmål holdes tilbake, og importen sier det", async () => {
    const file = await exportedPublishedCourse({ nb: tag("importert bokmål") });
    const res = await request(app).post(`${C}/courses/import`).set(admin).send({ payload: file, mode: "createNew" });
    expect(res.status, show(res)).toBeLessThan(300);
    const newId = (res.body.courseId ?? res.body.course?.id) as string;
    expect(newId, show(res)).toBeTruthy();
    expect(res.body.heldBackByTranslationGate, show(res)).toBe(true);
    expect((await courseRow(newId)).publishedAt, "holdt tilbake: ikke publisert").toBeNull();
  });

  it("vei 4, kontroll: en import med navn på alle tre språk publiseres", async () => {
    const file = await exportedPublishedCourse(tre(tag("importert komplett")));
    const res = await request(app).post(`${C}/courses/import`).set(admin).send({ payload: file, mode: "createNew" });
    expect(res.status, show(res)).toBeLessThan(300);
    const newId = (res.body.courseId ?? res.body.course?.id) as string;
    expect(res.body.heldBackByTranslationGate, show(res)).toBe(false);
    expect((await courseRow(newId)).publishedAt).not.toBeNull();
  });
});
