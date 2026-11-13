import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { withRevision } from "./support/courseRevision.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";

// #1151: vaktene ETTER låsen, bak en forhåndssjekk. Forhåndssjekkene (`assertNotArchivedBeforeLock`, `assertArchivedBeforeLock`)
// sparer en opplasting, et kall til språkmodellen eller gir et tydeligere svar før låsen. Mellom dem og låsen kan elementet bli
// arkivert; da er det vakta i transaksjonen som svarer. Her slås forhåndssjekkene av, så vakta etter låsen måles alene, som om
// arkiveringen kom imellom. (Søsterfila m2-archived-readonly-1151 måler veiene slik de er.) `vi.mock` løftes over importene.
vi.mock("../src/modules/content/archivedGuard.js", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, assertNotArchivedBeforeLock: async () => {}, assertArchivedBeforeLock: async () => {} };
});

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const ADMIN: Record<string, string> = { "x-user-id": "", "x-user-email": "", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `rol-1151-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `rol.1151.admin.${RUN}.${adminSeq}@x.test`;
  // Grensen før innloggingen (600 i minuttet) gjelder per IP-adresse. Én adresse per test.
  ADMIN["x-forwarded-for"] = `10.116.0.${adminSeq}`;
});
let seq = 0;
const tag = (name: string) => `1151l ${name} ${RUN}-${seq++}`;
afterAll(async () => {
  await prisma.$disconnect();
});

const C = "/api/admin/content";
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 400);
const post = (path: string, body: object = {}) => request(app).post(path).set(ADMIN).send(body);
const get = (path: string) => request(app).get(path).set(ADMIN);
async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}
function expectCode(r: request.Response, code: string) {
  expect(r.status, show(r)).toBe(400);
  expect(r.body.error, show(r)).toBe(code);
}

async function apiSection(name: string, publish = true) {
  // Uten `draft: true` publiseres en seksjon med alle språk ved lagring.
  const created = await ok(post(`${C}/sections`, { title: L(tag(name)), bodyMarkdown: L("Tekst."), draft: !publish }), "seksjon");
  const id = created.section.id as string;
  if (publish) await ok(post(`${C}/sections/${id}/publish`), "publiser");
  return id;
}

async function apiCourse(name: string, sectionIds: string[], publish: boolean) {
  const created = await ok(post(`${C}/courses`, { title: L(tag(name)) }), "kurs");
  const id = created.course.id as string;
  const r = await request(app).put(`${C}/courses/${id}/items`).set(ADMIN).send(await withRevision(id, { items: sectionIds.map((sectionId) => ({ type: "SECTION", sectionId })) }));
  expect(r.status, show(r)).toBe(204);
  if (publish) await ok(post(`${C}/courses/${id}/publish`), "publiser kurs");
  return id;
}

async function archivedCourseWithShared(sharedPublished: boolean) {
  const shared = await apiSection("delt", sharedPublished);
  // Kurset er et utkast: en upublisert seksjon kan stå i det.
  const course = await apiCourse("arkivert", [shared], false);
  await apiCourse("bruker delt", [shared], false);
  const { response } = await archiveCourseConfirmed(course, ADMIN);
  expect(response.status, show(response)).toBe(200);
  return { course, shared };
}

describe("#1151 vaktene etter låsen (forhåndssjekkene slått av)", () => {
  it("seksjon: bilde lastet opp til en arkivert seksjon lagres ikke", async () => {
    const id = await apiSection("bilde");
    await ok(post(`${C}/sections/${id}/archive`), "arkiver");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const r = await request(app).post(`${C}/sections/${id}/assets`).set(ADMIN).attach("file", png, { filename: "p.png", contentType: "image/png" });
    expectCode(r, "section_archived");
    expect(await prisma.sectionAsset.count({ where: { sectionId: id } })).toBe(0);
  });

  it("seksjon: oversatte figurer skrives ikke til en arkivert seksjon", async () => {
    const id = await apiSection("figur");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40"><text x="5" y="25">Hei verden</text></svg>', "utf8");
    await ok(request(app).post(`${C}/sections/${id}/assets`).set(ADMIN).attach("file", svg, { filename: "f.svg", contentType: "image/svg+xml" }), "figur");
    await ok(post(`${C}/sections/${id}/archive`), "arkiver");
    const before = await prisma.sectionAsset.findMany({ where: { sectionId: id }, select: { sourceLocale: true, localizedBlobPaths: true } });
    const r = await post(`${C}/sections/${id}/assets/localize`, { sourceLocale: "nb" });
    expectCode(r, "section_archived");
    expect(await prisma.sectionAsset.findMany({ where: { sectionId: id }, select: { sourceLocale: true, localizedBlobPaths: true } })).toEqual(before);
  });

  it("seksjon: import replaceExisting gir ingen ny versjon på en arkivert seksjon", async () => {
    const id = await apiSection("import");
    const exported = await ok(get(`${C}/sections/${id}/export-package`), "eksport");
    await ok(post(`${C}/sections/${id}/archive`), "arkiver");
    const r = await post(`${C}/sections/import`, { payload: exported.envelope, mode: "replaceExisting", targetId: id });
    expectCode(r, "section_archived");
    expect(await prisma.courseSectionVersion.count({ where: { sectionId: id } })).toBe(1);
  });

  it("modul: «lag kriterier på nytt» (ensure med force) skriver ingen rubrikk på en arkivert modul", async () => {
    const created = await ok(post(`${C}/modules`, { title: L(tag("ensure")), description: L("B"), certificationLevel: "basic" }), "modul");
    const id = created.module.id as string;
    await ok(post(`${C}/modules/${id}/archive`), "arkiver");
    const r = await post(`${C}/modules/${id}/rubric-versions/ensure`, { taskText: "Oppgave", assessorExpectedContent: "Fasit", certificationLevel: "basic", locale: "nb", force: true });
    expectCode(r, "module_archived");
    expect(await prisma.rubricVersion.count({ where: { moduleId: id } })).toBe(0);
  });

  it("modul: sletting av en modul som ikke er arkivert, stoppes etter låsen", async () => {
    const created = await ok(post(`${C}/modules`, { title: L(tag("slett")), description: L("B"), certificationLevel: "basic" }), "modul");
    const id = created.module.id as string;
    const r = await request(app).delete(`${C}/modules/${id}`).set(ADMIN);
    expectCode(r, "delete_requires_archived");
    expect(await prisma.module.count({ where: { id } })).toBe(1);
  });

  it("kurs: «Publiser kurs» uten noe upublisert (publishCourse) publiserer ikke et arkivert kurs", async () => {
    const { course } = await archivedCourseWithShared(true);
    const r = await post(`${C}/courses/${course}/publish`);
    expectCode(r, "course_archived");
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course }, select: { publishedAt: true } })).publishedAt).toBeNull();
  });

  it("kurs: kaskadepubliseringen publiserer verken kurset eller det upubliserte elementet", async () => {
    const { course, shared } = await archivedCourseWithShared(false);
    const r = await post(`${C}/courses/${course}/publish`, { publishItems: true });
    expectCode(r, "course_archived");
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: shared }, select: { activeVersionId: true } })).activeVersionId).toBeNull();
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course }, select: { publishedAt: true } })).publishedAt).toBeNull();
  });

  it("kurs: «Publiser nye versjoner» virker ikke på et arkivert kurs", async () => {
    const { course, shared } = await archivedCourseWithShared(true);
    // En ny, upublisert versjon av den delte seksjonen (lagt klar av en import), så noe ligger klar.
    const exported = await ok(get(`${C}/sections/${shared}/export-package`), "eksport");
    await ok(post(`${C}/sections/import`, { payload: exported.envelope, mode: "replaceExisting", targetId: shared }), "ny versjon");
    const pending = await ok(get(`${C}/courses/${course}/pending-versions`), "klar");
    const versionIds = (pending.items as Array<{ versionId: string }>).map((item) => item.versionId);
    expect(versionIds).toHaveLength(1);
    const before = await prisma.course.findUniqueOrThrow({ where: { id: course }, select: { versionMinor: true, contentRevision: true } });
    const activeBefore = (await prisma.courseSection.findUniqueOrThrow({ where: { id: shared }, select: { activeVersionId: true } })).activeVersionId;
    const r = await post(`${C}/courses/${course}/publish-pending`, { versionIds });
    expectCode(r, "course_archived");
    expect(await prisma.course.findUniqueOrThrow({ where: { id: course }, select: { versionMinor: true, contentRevision: true } })).toEqual(before);
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: shared }, select: { activeVersionId: true } })).activeVersionId).toBe(activeBefore);
  });
});
