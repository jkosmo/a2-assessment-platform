import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { deleteModule } from "../src/modules/adminContent/index.js";
import { withRevision } from "./support/courseRevision.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";

// #1149 (samlesak #1148): arkiverte kurs teller ikke som bruk. Produkteier 13.11.2026.
//
//   Vises som «Brukt i kurs», i kursfilteret, i tematallet   bare AKTIVE kurs (archivedAt = null)
//   Avpublisere, arkivere en modul eller seksjon              stoppes av aktive kurs
//   Slette                                                    stoppes av ALLE kurs, også arkiverte
//                                                             (CourseItem → modul/seksjon er onDelete: Restrict),
//                                                             og svaret sier hvilke kurs som er arkiverte
//
// Testene går gjennom rutene (supertest). Hver fikstur sier ALT regelen leser: kursets `archivedAt` og
// `publishedAt` står uttrykkelig i hvert kurs, også der verdien er null.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
// En ny administrator per test: admin-API-et slipper bare 120 kall i minuttet per bruker (`generalApiLimiter`).
const ADMIN: Record<string, string> = {
  "x-user-id": "archived-1149-admin",
  "x-user-email": "archived.1149.admin@x.test",
  "x-user-name": "Admin",
  "x-user-roles": "ADMINISTRATOR",
  "x-locale": "nb",
};
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `archived-1149-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `archived.1149.admin.${RUN}.${adminSeq}@x.test`;
});

let seq = 0;
const tag = (name: string) => `1149 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

async function createPublishedModule(title: string) {
  const source = await prisma.moduleVersion.findFirst({
    where: { module: { activeVersionId: { not: null } } },
    select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    orderBy: { createdAt: "asc" },
  });
  expect(source).toBeTruthy();
  const module = await prisma.module.create({ data: { title: JSON.stringify(L(title)), archivedAt: null }, select: { id: true } });
  const moduleVersion = await prisma.moduleVersion.create({
    data: {
      moduleId: module.id,
      versionNo: 1,
      taskText: JSON.stringify(L(`${title} task`)),
      assessorExpectedContent: JSON.stringify(L(`${title} guidance`)),
      rubricVersionId: source!.rubricVersionId,
      promptTemplateVersionId: source!.promptTemplateVersionId,
      mcqSetVersionId: source!.mcqSetVersionId,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: moduleVersion.id } });
  return module.id;
}

async function createPublishedSection(title: string) {
  const section = await prisma.courseSection.create({ data: { title: JSON.stringify(L(title)), archivedAt: null }, select: { id: true } });
  const v1 = await prisma.courseSectionVersion.create({
    data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify(L("Tekst.")), publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: v1.id } });
  return section.id;
}

type CourseState = "archived" | "draft" | "published";

/**
 * Et kurs i en bestemt tilstand, med elementene. Tilstanden sier begge feltene regelen og lista leser:
 *   archived  = archivedAt satt, publishedAt null (arkivering avpubliserer, I3)
 *   draft     = archivedAt null, publishedAt null
 *   published = archivedAt null, publishedAt satt
 */
async function createCourse(name: string, state: CourseState, items: { moduleIds?: string[]; sectionIds?: string[] }) {
  const title = tag(name);
  const rows = [
    ...(items.moduleIds ?? []).map((moduleId) => ({ itemType: "MODULE" as const, moduleId })),
    ...(items.sectionIds ?? []).map((sectionId) => ({ itemType: "SECTION" as const, sectionId })),
  ].map((row, sortOrder) => ({ ...row, sortOrder }));
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(L(title)),
      certificationLevel: "basic",
      archivedAt: state === "archived" ? new Date() : null,
      publishedAt: state === "published" ? new Date() : null,
      slug: `archived-1149-${RUN}-${seq++}`,
      items: { create: rows },
    },
    select: { id: true },
  });
  return { id: course.id, title };
}

const sectionPath = (sectionId: string, action = "") => `/api/admin/content/sections/${sectionId}${action}`;
const modulePath = (moduleId: string, action = "") => `/api/admin/content/modules/${moduleId}${action}`;
const coursePath = (courseId: string, action = "") => `/api/admin/content/courses/${courseId}${action}`;
const post = (path: string, body: object = {}) => request(app).post(path).set(ADMIN).send(body);
const del = (path: string) => request(app).delete(path).set(ADMIN);

const sectionRow = (sectionId: string) =>
  prisma.courseSection.findUnique({ where: { id: sectionId }, select: { archivedAt: true, activeVersionId: true } });
const moduleRow = (moduleId: string) =>
  prisma.module.findUnique({ where: { id: moduleId }, select: { archivedAt: true, activeVersionId: true } });

describe("#1149: et arkivert kurs stopper ikke avpublisering og arkivering", () => {
  it("en seksjon som bare ligger i et arkivert kurs, kan avpubliseres og arkiveres", async () => {
    const sectionId = await createPublishedSection(tag("seksjon i arkivert kurs"));
    await createCourse("arkivert kurs", "archived", { sectionIds: [sectionId] });

    const unpublished = await post(sectionPath(sectionId, "/unpublish"));
    expect(unpublished.status, JSON.stringify(unpublished.body).slice(0, 300)).toBe(200);
    expect(await sectionRow(sectionId)).toEqual({ archivedAt: null, activeVersionId: null });

    const archived = await post(sectionPath(sectionId, "/archive"));
    expect(archived.status, JSON.stringify(archived.body).slice(0, 300)).toBe(200);
    expect((await sectionRow(sectionId))?.archivedAt).not.toBeNull();
  });

  it("en modul som bare ligger i et arkivert kurs, kan avpubliseres og arkiveres", async () => {
    const moduleId = await createPublishedModule(tag("modul i arkivert kurs"));
    await createCourse("arkivert kurs", "archived", { moduleIds: [moduleId] });

    const unpublished = await post(modulePath(moduleId, "/unpublish"));
    expect(unpublished.status, JSON.stringify(unpublished.body).slice(0, 300)).toBe(200);
    expect(await moduleRow(moduleId)).toEqual({ archivedAt: null, activeVersionId: null });

    const archived = await post(modulePath(moduleId, "/archive"));
    expect(archived.status, JSON.stringify(archived.body).slice(0, 300)).toBe(200);
    expect((await moduleRow(moduleId))?.archivedAt).not.toBeNull();
  });

  // KONTROLL: uten denne vet vi ikke om testene over måler regelen eller en vakt som er borte.
  for (const state of ["draft", "published"] as const) {
    it(`KONTROLL: en seksjon i et aktivt kurs (${state}) kan verken avpubliseres, arkiveres eller slettes`, async () => {
      const sectionId = await createPublishedSection(tag("seksjon i aktivt kurs"));
      const course = await createCourse("aktivt kurs", state, { sectionIds: [sectionId] });

      for (const action of ["/unpublish", "/archive"]) {
        const blocked = await post(sectionPath(sectionId, action));
        expect(blocked.status, `${action}: ${JSON.stringify(blocked.body).slice(0, 300)}`).toBe(400);
        expect(blocked.body.error).toBe("content_in_use");
        expect(blocked.body.details).toEqual({ count: 1, courseTitles: [course.title] });
      }
      // #1151: «slett krever arkivert» kommer før «ligger i et kurs». Hvordan «ligger i et aktivt kurs» svarer ved sletting av
      // et arkivert element: testen under med et aktivt og et arkivert kurs.
      const deleted = await del(sectionPath(sectionId));
      expect(deleted.status).toBe(400);
      expect(deleted.body.error).toBe("delete_requires_archived");

      const row = await sectionRow(sectionId);
      expect(row?.archivedAt).toBeNull();
      expect(row?.activeVersionId).not.toBeNull();
    });

    it(`KONTROLL: en modul i et aktivt kurs (${state}) kan verken avpubliseres, arkiveres eller slettes`, async () => {
      const moduleId = await createPublishedModule(tag("modul i aktivt kurs"));
      const course = await createCourse("aktivt kurs", state, { moduleIds: [moduleId] });

      for (const action of ["/unpublish", "/archive"]) {
        const blocked = await post(modulePath(moduleId, action));
        expect(blocked.status, `${action}: ${JSON.stringify(blocked.body).slice(0, 300)}`).toBe(400);
        expect(blocked.body.error).toBe("content_in_use");
        expect(blocked.body.details).toEqual({ count: 1, courseTitles: [course.title] });
      }
      // #1151: «slett krever arkivert» kommer først (også i ruta, foran forhåndssjekken av kursene).
      const deleted = await del(modulePath(moduleId));
      expect(deleted.status).toBe(400);
      expect(deleted.body.error).toBe("delete_requires_archived");

      const row = await moduleRow(moduleId);
      expect(row?.archivedAt).toBeNull();
      expect(row?.activeVersionId).not.toBeNull();
    });
  }

  it("i et aktivt OG et arkivert kurs: bare det aktive kurset stopper og navngis", async () => {
    const sectionId = await createPublishedSection(tag("seksjon i begge"));
    const moduleId = await createPublishedModule(tag("modul i begge"));
    await createCourse("arkivert kurs", "archived", { sectionIds: [sectionId], moduleIds: [moduleId] });
    const active = await createCourse("aktivt kurs", "published", { sectionIds: [sectionId], moduleIds: [moduleId] });

    for (const path of [sectionPath(sectionId, "/unpublish"), sectionPath(sectionId, "/archive"), modulePath(moduleId, "/unpublish"), modulePath(moduleId, "/archive")]) {
      const blocked = await post(path);
      expect(blocked.status, `${path}: ${JSON.stringify(blocked.body).slice(0, 300)}`).toBe(400);
      expect(blocked.body.error).toBe("content_in_use");
      // Det arkiverte kurset er ikke med, verken i tallet eller i navnene.
      expect(blocked.body.details).toEqual({ count: 1, courseTitles: [active.title] });
    }
  });
});

describe("#1149: sletting stoppes av alle kurs, og svaret sier hvilke som er arkiverte", () => {
  it("en arkivert seksjon som bare ligger i et arkivert kurs, kan ikke slettes", async () => {
    const sectionId = await createPublishedSection(tag("seksjon som ikke kan slettes"));
    const course = await createCourse("arkivert kurs", "archived", { sectionIds: [sectionId] });
    // Veien forfatteren går: «Slett» vises bare på et arkivert element.
    expect((await post(sectionPath(sectionId, "/archive"))).status).toBe(200);

    const deleted = await del(sectionPath(sectionId));
    expect(deleted.status, JSON.stringify(deleted.body).slice(0, 300)).toBe(400);
    expect(deleted.body.error).toBe("content_in_archived_course");
    expect(deleted.body.details).toEqual({ count: 1, courseTitles: [course.title], archivedCount: 1, archivedCourseTitles: [course.title] });
    // Reserven for en API-konsument uten oversettelser sier det samme.
    expect(deleted.body.message).toContain(`Arkiverte kurs (1): «${course.title}»`);
    expect(await sectionRow(sectionId)).not.toBeNull();
    expect(await prisma.courseItem.count({ where: { courseId: course.id, sectionId } })).toBe(1);
  });

  it("en arkivert modul som bare ligger i et arkivert kurs, kan ikke slettes — ruta og `deleteModule` svarer likt", async () => {
    const moduleId = await createPublishedModule(tag("modul som ikke kan slettes"));
    const course = await createCourse("arkivert kurs", "archived", { moduleIds: [moduleId] });
    expect((await post(modulePath(moduleId, "/archive"))).status).toBe(200);

    const details = { count: 1, courseTitles: [course.title], archivedCount: 1, archivedCourseTitles: [course.title] };
    const deleted = await del(modulePath(moduleId));
    expect(deleted.status, JSON.stringify(deleted.body).slice(0, 300)).toBe(400);
    expect(deleted.body.error).toBe("content_in_archived_course");
    expect(deleted.body.details).toEqual(details);
    // #705: antallet står også øverst i kroppen, som for `module_in_use`.
    expect(deleted.body.courseCount).toBe(1);

    // Ruta svarer fra en forhåndssjekk uten lås. Sjekken som gjelder, står i `deleteModule` etter innholdslåsen;
    // den nås ikke gjennom ruta så lenge forhåndssjekken stopper først, så den kalles direkte her.
    await expect(deleteModule(moduleId, "archived-1149-actor")).rejects.toMatchObject({ code: "content_in_archived_course", details });
    expect(await moduleRow(moduleId)).not.toBeNull();
    expect(await prisma.courseItem.count({ where: { courseId: course.id, moduleId } })).toBe(1);
  });

  it("i et aktivt og et arkivert kurs: svaret navngir begge, og sier hvilket som er arkivert", async () => {
    const sectionId = await createPublishedSection(tag("seksjon i begge, slettes"));
    const moduleId = await createPublishedModule(tag("modul i begge, slettes"));
    const archived = await createCourse("arkivert kurs", "archived", { sectionIds: [sectionId], moduleIds: [moduleId] });
    const active = await createCourse("aktivt kurs", "draft", { sectionIds: [sectionId], moduleIds: [moduleId] });
    // #1151: slett krever arkivert. Et arkivert element i et aktivt kurs oppstår når et kurs gjenopprettes med et element som ble
    // arkivert for seg; tilstanden skrives direkte.
    await prisma.courseSection.update({ where: { id: sectionId }, data: { archivedAt: new Date(), activeVersionId: null } });
    await prisma.module.update({ where: { id: moduleId }, data: { archivedAt: new Date(), activeVersionId: null } });

    for (const path of [sectionPath(sectionId), modulePath(moduleId)]) {
      const deleted = await del(path);
      expect(deleted.status, `${path}: ${JSON.stringify(deleted.body).slice(0, 300)}`).toBe(400);
      expect(deleted.body.error).toBe("content_in_archived_course");
      expect(deleted.body.details.count).toBe(2);
      expect([...deleted.body.details.courseTitles].sort()).toEqual([active.title, archived.title].sort());
      expect(deleted.body.details.archivedCount).toBe(1);
      expect(deleted.body.details.archivedCourseTitles).toEqual([archived.title]);
    }
  });

  it("KONTROLL: en arkivert seksjon som ikke ligger i noe kurs, kan slettes", async () => {
    const sectionId = await createPublishedSection(tag("seksjon uten kurs"));
    expect((await post(sectionPath(sectionId, "/archive"))).status).toBe(200);
    expect((await del(sectionPath(sectionId))).status).toBe(204);
    expect(await sectionRow(sectionId)).toBeNull();
  });
});

// De to andre som sletter, er UENDRET av #1149: de teller fortsatt alle kurs. Testene fester det, fordi
// «arkiverte kurs teller ikke» ellers er lett å spre hit, og da ville et element blitt forsøkt slettet under
// et arkivert kurs.
describe("#1149: kaskadeslettingen og masseryddingen teller fortsatt arkiverte kurs", () => {
  type Entry = { id: string };

  it("kaskadesletting: et element som også ligger i et arkivert kurs, er delt og spares. KONTROLL: et eksklusivt element slettes", async () => {
    const sharedSection = await createPublishedSection(tag("seksjon delt med arkivert kurs"));
    const sharedModule = await createPublishedModule(tag("modul delt med arkivert kurs"));
    const ownSection = await createPublishedSection(tag("seksjon bare i dette kurset"));
    await createCourse("arkivert kurs", "archived", { sectionIds: [sharedSection], moduleIds: [sharedModule] });
    // #1151: kaskaden krever et arkivert kurs.
    const course = await createCourse("kurs som slettes", "archived", { sectionIds: [sharedSection, ownSection], moduleIds: [sharedModule] });

    const preview = await request(app).get(coursePath(course.id, "/cascade-delete-preview")).set(ADMIN);
    expect(preview.status, JSON.stringify(preview.body).slice(0, 300)).toBe(200);
    const ids = (entries: Entry[]) => entries.map((entry) => entry.id);
    expect(ids(preview.body.sparedSections)).toEqual([sharedSection]);
    expect(ids(preview.body.sparedModules)).toEqual([sharedModule]);
    expect(ids(preview.body.deletableSections)).toEqual([ownSection]);
    expect(ids(preview.body.deletableModules)).toEqual([]);
  });

  it("masserydding av upubliserte moduler: en modul i et arkivert kurs hoppes over", async () => {
    const moduleId = await createPublishedModule(tag("upublisert modul i arkivert kurs"));
    await createCourse("arkivert kurs", "archived", { moduleIds: [moduleId] });
    // #1149 slipper avpubliseringen gjennom, og da er modulen en kandidat for ryddingen (upublisert, ikke arkivert).
    expect((await post(modulePath(moduleId, "/unpublish"))).status).toBe(200);

    // Bare forhåndsvisningen: selve ryddingen sletter alle upubliserte moduler i testdatabasen.
    const preview = await request(app).get("/api/admin/content/modules/purge-unpublished/preview").set(ADMIN);
    expect(preview.status).toBe(200);
    const candidate = (preview.body.candidates as Array<{ id: string; courseModules: number; reasonSkipped: string | null }>).find((c) => c.id === moduleId);
    expect(candidate).toMatchObject({ courseModules: 1 });
    expect(candidate?.reasonSkipped).toContain("in 1 course(s)");
  });
});

describe("#1149: listene viser bare aktive kurs som bruk", () => {
  type UsageRow = { id: string; courseCount: number; courses: Array<{ id: string; title: string }> };

  it("seksjonslista: det arkiverte kurset er borte fra `courses` og `courseCount`, det aktive står", async () => {
    const both = await createPublishedSection(tag("seksjon i begge"));
    const onlyArchived = await createPublishedSection(tag("seksjon bare i arkivert"));
    const archived = await createCourse("arkivert kurs", "archived", { sectionIds: [both, onlyArchived] });
    const active = await createCourse("aktivt kurs", "draft", { sectionIds: [both] });

    const list = await request(app).get("/api/admin/content/sections").set(ADMIN);
    expect(list.status).toBe(200);
    const rows = list.body.sections as UsageRow[];
    const row = (id: string) => rows.find((s) => s.id === id);

    expect(row(both)).toMatchObject({ courseCount: 1, courses: [{ id: active.id, title: active.title }] });
    expect(row(onlyArchived)).toMatchObject({ courseCount: 0, courses: [] });
    // Ingen rad i hele lista navngir det arkiverte kurset: kursfilteret bygges av `courses`.
    expect(rows.flatMap((s) => s.courses.map((c) => c.id))).not.toContain(archived.id);
  });

  it("modulbiblioteket: det arkiverte kurset er borte fra `courses` og `courseCount`, det aktive står", async () => {
    const both = await createPublishedModule(tag("modul i begge"));
    const onlyArchived = await createPublishedModule(tag("modul bare i arkivert"));
    const archived = await createCourse("arkivert kurs", "archived", { moduleIds: [both, onlyArchived] });
    const active = await createCourse("aktivt kurs", "published", { moduleIds: [both] });

    const list = await request(app).get("/api/admin/content/modules/library").query({ locale: "nb" }).set(ADMIN);
    expect(list.status).toBe(200);
    const rows = list.body.modules as UsageRow[];
    const row = (id: string) => rows.find((m) => m.id === id);

    expect(row(both)).toMatchObject({ courseCount: 1, courses: [{ id: active.id, title: active.title }] });
    expect(row(onlyArchived)).toMatchObject({ courseCount: 0, courses: [] });
    expect(rows.flatMap((m) => m.courses.map((c) => c.id))).not.toContain(archived.id);
  });

  it("temalista: `courseCount` teller bare aktive kurs", async () => {
    const archived = await createCourse("arkivert kurs", "archived", {});
    const draft = await createCourse("utkast", "draft", {});
    const published = await createCourse("publisert", "published", {});
    const mixed = await prisma.courseTheme.create({ data: { name: JSON.stringify(L(tag("tema med alle tre"))) }, select: { id: true } });
    const onlyArchived = await prisma.courseTheme.create({ data: { name: JSON.stringify(L(tag("tema bare arkivert"))) }, select: { id: true } });
    await prisma.courseThemeAssignment.createMany({
      data: [
        { themeId: mixed.id, courseId: archived.id },
        { themeId: mixed.id, courseId: draft.id },
        { themeId: mixed.id, courseId: published.id },
        { themeId: onlyArchived.id, courseId: archived.id },
      ],
    });

    const list = await request(app).get("/api/admin/content/themes").set(ADMIN);
    expect(list.status).toBe(200);
    const themes = list.body.themes as Array<{ id: string; courseCount: number }>;
    // Utkast og publisert er begge aktive; det arkiverte kurset telles ikke.
    expect(themes.find((t) => t.id === mixed.id)?.courseCount).toBe(2);
    expect(themes.find((t) => t.id === onlyArchived.id)?.courseCount).toBe(0);
    // Koblingen til det arkiverte kurset finnes fortsatt: bare tallet er endret.
    expect(await prisma.courseThemeAssignment.count({ where: { themeId: onlyArchived.id } })).toBe(1);
  });
});

describe("#1149: et arkivert kurs gjenopprettes med et element som er arkivert i mellomtiden", () => {
  it("kurset lander som utkast, og publiseringen stoppes av `item_archived` til elementene er gjenopprettet", async () => {
    const sectionId = await createPublishedSection(tag("seksjon arkivert i mellomtiden"));
    const moduleId = await createPublishedModule(tag("modul arkivert i mellomtiden"));
    const course = await createCourse("kurs som gjenopprettes", "published", { sectionIds: [sectionId], moduleIds: [moduleId] });

    // Kurset arkiveres (ingen deltakere midt i, så G3 slipper det), og så elementene.
    // #1150 skive 2a-2: elementene ligger bare i dette kurset og følger det inn i arkivet. For å få «arkivert i mellomtiden»
    // gjenopprettes de hver for seg (merket nullstilles) og arkiveres for hånd. Da blir de stående når kurset gjenopprettes.
    expect((await archiveCourseConfirmed(course.id, ADMIN)).response.status).toBe(200);
    expect((await post(sectionPath(sectionId, "/restore"))).status).toBe(200);
    expect((await post(modulePath(moduleId, "/restore"))).status).toBe(200);
    expect((await post(sectionPath(sectionId, "/archive"))).status).toBe(200);
    expect((await post(modulePath(moduleId, "/archive"))).status).toBe(200);

    const restored = await post(coursePath(course.id, "/restore"));
    expect(restored.status, JSON.stringify(restored.body).slice(0, 300)).toBe(200);
    const detail = await request(app).get(coursePath(course.id)).set(ADMIN);
    expect(detail.body.course).toMatchObject({ lifecycle: "draft", archivedAt: null, publishedAt: null });

    // Uten bekreftelse: forfatteren får spørsmålet, og ser at elementene ikke kan publiseres.
    const asked = await post(coursePath(course.id, "/publish"));
    expect(asked.status, JSON.stringify(asked.body).slice(0, 300)).toBe(409);
    expect(asked.body.error).toBe("course_has_unpublished_items");
    expect(asked.body.publishable).toBe(false);
    const blockerCodes = (asked.body.unpublishedItems as Array<{ blockers: Array<{ code: string }> }>).map((item) => item.blockers.map((b) => b.code));
    expect(blockerCodes).toEqual([["item_archived"], ["item_archived"]]);

    // Med bekreftelse: stoppet, og ingenting er publisert.
    const blocked = await post(coursePath(course.id, "/publish"), { publishItems: true });
    expect(blocked.status, JSON.stringify(blocked.body).slice(0, 300)).toBe(422);
    expect(blocked.body.error).toBe("course_publish_blocked_by_items");
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id }, select: { publishedAt: true } })).publishedAt).toBeNull();

    // Nå er kurset aktivt igjen, og elementene ligger i det: de kan ikke slettes, og svaret er det vanlige
    // (kurset er ikke lenger arkivert).
    const deleted = await del(sectionPath(sectionId));
    expect(deleted.status).toBe(400);
    expect(deleted.body.error).toBe("content_in_use");

    // Veien ut: gjenopprett elementene. Da er `item_archived` borte fra forhåndsvisningen.
    expect((await post(sectionPath(sectionId, "/restore"))).status).toBe(200);
    expect((await post(modulePath(moduleId, "/restore"))).status).toBe(200);
    const preview = await request(app).get(coursePath(course.id, "/publish-preview")).set(ADMIN);
    expect(preview.status).toBe(200);
    const after = (preview.body.unpublishedItems as Array<{ blockers: Array<{ code: string }> }>).flatMap((item) => item.blockers.map((b) => b.code));
    expect(after).not.toContain("item_archived");
  });

  it("KONTROLL: gjenopprettes kurset FØR elementet arkiveres, stoppes arkiveringen av det aktive kurset", async () => {
    const sectionId = await createPublishedSection(tag("seksjon, kurset gjenopprettet først"));
    const course = await createCourse("kurs gjenopprettet først", "archived", { sectionIds: [sectionId] });

    expect((await post(coursePath(course.id, "/restore"))).status).toBe(200);
    const blocked = await post(sectionPath(sectionId, "/archive"));
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("content_in_use");
    expect(blocked.body.details).toEqual({ count: 1, courseTitles: [course.title] });
  });

  // QA-porten 2.158.0: «et gjenopprettet kurs lander som utkast» sto bare på at arkiveringen hadde nullstilt
  // `publishedAt`. Et kurs arkivert før #705, eller publisert fra en gammel fane etter arkiveringen, er arkivert OG
  // publisert, og ville gått rett ut til deltakerne ved gjenoppretting — forbi publiseringsporten, med innhold som
  // etter #1149 kan være arkivert.
  it("et kurs som er arkivert OG publisert, gjenopprettes som utkast", async () => {
    const sectionId = await createPublishedSection(tag("seksjon i arkivert og publisert kurs"));
    const course = await createCourse("arkivert og publisert", "archived", { sectionIds: [sectionId] });
    // Tilstanden kan ikke lages gjennom rutene i dag (arkivering avpubliserer); den finnes i eldre data.
    await prisma.course.update({ where: { id: course.id }, data: { publishedAt: new Date("2026-05-01T08:00:00.000Z") } });
    expect((await post(sectionPath(sectionId, "/archive"))).status).toBe(200);

    const restored = await post(coursePath(course.id, "/restore"));
    expect(restored.status, JSON.stringify(restored.body).slice(0, 300)).toBe(200);
    const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id }, select: { archivedAt: true, publishedAt: true } });
    expect(row).toEqual({ archivedAt: null, publishedAt: null });
  });
});

describe("#1149: importens «oppdater kurs» arkiverer et utbyttet element som bare et arkivert kurs bruker", () => {
  const smo = () => ({
    "x-user-id": `archived-1149-smo-${RUN}`,
    "x-user-email": `archived.1149.smo.${RUN}@x.test`,
    "x-user-name": "Fagansvarlig",
    "x-user-roles": "SUBJECT_MATTER_OWNER",
    "x-locale": "nb",
  });

  // En publisert modul laget gjennom API-et, slik eksporten krever (kriterier, ledetekst, flervalg, versjon).
  async function apiModule(title: string) {
    const send = async (path: string, body: object) => {
      const r = await post(path, body);
      expect(r.status, `${path}: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
      return r.body;
    };
    const module = await send("/api/admin/content/modules", { title: L(title), description: L("Beskrivelse"), certificationLevel: "basic" });
    const moduleId = module.module.id as string;
    const rubric = await send(modulePath(moduleId, "/rubric-versions"), { criteria: { relevance: "0-4", quality: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } });
    const prompt = await send(modulePath(moduleId, "/prompt-template-versions"), { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [{ note: "fixture" }] });
    const mcq = await send(modulePath(moduleId, "/mcq-set-versions"), { title: L("MCQ"), questions: [{ stem: L("Hva er 1+1?"), options: [L("2"), L("3")], correctAnswer: L("2"), rationale: L("Matte") }] });
    const version = await send(modulePath(moduleId, "/module-versions"), {
      taskText: L("Reflekter"),
      assessorExpectedContent: L("Nevn QA"),
      rubricVersionId: rubric.rubricVersion.id,
      promptTemplateVersionId: prompt.promptTemplateVersion.id,
      mcqSetVersionId: mcq.mcqSetVersion.id,
    });
    await send(modulePath(moduleId, `/module-versions/${version.moduleVersion.id}/publish`), {});
    return moduleId;
  }

  async function apiSection(title: string) {
    const created = await post("/api/admin/content/sections", { title: L(title), bodyMarkdown: L("Administratorens tekst.") });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const id = created.body.section.id as string;
    expect((await post(sectionPath(id, "/publish"))).status).toBe(200);
    return id;
  }

  it("arkivert kurs ellers: arkiveres. KONTROLL, aktivt kurs ellers: blir stående", async () => {
    // Administratoren eier fire elementer. Fagansvarlig legger dem i sitt kurs og oppdaterer kurset fra fil:
    // det hen ikke eier, byttes ut med egne kopier, og det gamle arkiveres når ingen andre AKTIVE kurs bruker det.
    const sectionInArchived = await apiSection(tag("seksjon, ellers i arkivert kurs"));
    const sectionInActive = await apiSection(tag("seksjon, ellers i aktivt kurs"));
    const moduleInArchived = await apiModule(tag("modul, ellers i arkivert kurs"));
    const moduleInActive = await apiModule(tag("modul, ellers i aktivt kurs"));
    const otherArchived = await createCourse("annet kurs, arkivert", "archived", { sectionIds: [sectionInArchived], moduleIds: [moduleInArchived] });
    const otherActive = await createCourse("annet kurs, aktivt", "draft", { sectionIds: [sectionInActive], moduleIds: [moduleInActive] });

    const created = await request(app).post("/api/admin/content/courses").set(smo()).send({ title: L(tag("fagansvarligs kurs")) });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const courseId = created.body.course.id as string;
    const items = await request(app).put(coursePath(courseId, "/items")).set(smo()).send(await withRevision(courseId, { items: [
      { type: "SECTION", sectionId: sectionInArchived }, { type: "SECTION", sectionId: sectionInActive },
      { type: "MODULE", moduleId: moduleInArchived }, { type: "MODULE", moduleId: moduleInActive },
    ] }));
    expect(items.status, JSON.stringify(items.body).slice(0, 300)).toBe(204);
    expect((await request(app).post(coursePath(courseId, "/publish")).set(smo())).status).toBe(200);

    const exported = await request(app).get(coursePath(courseId, "/export-package")).set(smo());
    expect(exported.status, JSON.stringify(exported.body).slice(0, 300)).toBe(200);
    const file = JSON.parse(JSON.stringify(exported.body.envelope ?? exported.body));
    for (const item of file.course.course.items as Array<any>) {
      if (item.section) item.section.bodyMarkdown = L("Justert av fagansvarlig.");
      else item.module.activeVersion.taskText = L("Justert oppgave.");
    }

    const imported = await request(app).post("/api/admin/content/courses/import").set(smo()).send({ payload: file, mode: "updateExisting", targetId: courseId });
    expect(imported.status, JSON.stringify(imported.body).slice(0, 400)).toBe(201);
    const replaced = imported.body.summary.replacedUnownedIds as Array<{ type: string; oldId: string; oldArchived: boolean }>;
    expect(replaced.map((r) => [r.type, r.oldId, r.oldArchived])).toEqual([
      ["SECTION", sectionInArchived, true],
      ["SECTION", sectionInActive, false],
      ["MODULE", moduleInArchived, true],
      ["MODULE", moduleInActive, false],
    ]);

    // Arkivert, ikke slettet, og det arkiverte kurset har fortsatt raden sin.
    expect((await sectionRow(sectionInArchived))?.archivedAt).not.toBeNull();
    expect((await moduleRow(moduleInArchived))?.archivedAt).not.toBeNull();
    expect(await prisma.courseItem.count({ where: { courseId: otherArchived.id } })).toBe(2);
    // Det aktive kurset bruker sine fortsatt: de står urørt.
    expect((await sectionRow(sectionInActive))?.archivedAt).toBeNull();
    expect((await moduleRow(moduleInActive))?.archivedAt).toBeNull();
    expect(await prisma.courseItem.count({ where: { courseId: otherActive.id } })).toBe(2);
  });
});
