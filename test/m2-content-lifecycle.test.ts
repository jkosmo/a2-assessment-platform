import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { archiveModule, unpublishModule } from "../src/modules/adminContent/adminContentCommands.js";
import { archiveCourse, unpublishCourse, deleteCourse } from "../src/modules/course/courseCommands.js";
import {
  archiveSection,
  unpublishSection,
  restoreSection,
  publishSection,
  deleteSection,
  createSection,
} from "../src/modules/course/sectionCommands.js";

// #705 — enhetlig innholds-livssyklus. Verifiserer de fire vaktene fra
// doc/design/CONTENT_LIFECYCLE.md: G2 (bruk-lås på modul/seksjon i kurs), G3 (aktivitets-lås på
// kurs med påbegynt deltaker), og I3 (arkivering auto-avpubliserer; gjenopprett → utkast).
// Audit events FK actorId → User, so the actor must be a real user row (set in beforeAll).
let ACTOR = "lifecycle-actor";

const courseIds: string[] = [];
const moduleIds: string[] = [];
const sectionIds: string[] = [];
const userIds: string[] = [];

let seq = 0;
const uniq = () => `lc-${Date.now()}-${seq++}`;

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Admin",
  "x-user-roles": "ADMINISTRATOR",
};

async function makePublishedModule(): Promise<string> {
  const module = await prisma.module.create({ data: { title: `LC Module ${uniq()}` }, select: { id: true } });
  moduleIds.push(module.id);
  const version = await prisma.moduleVersion.create({
    data: { moduleId: module.id, versionNo: 1, publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version.id } });
  return module.id;
}

// #916: fully translated on purpose. Auto-publish-on-save (and publishSection) now run the
// translation gate, so a single-language fixture would land as a draft and every lifecycle
// assertion below would be measuring the gate instead of the lifecycle.
const LC_LOCALES = (value: string) => JSON.stringify({ "en-GB": value, nb: value, nn: value });

async function makeSection(): Promise<string> {
  const section = await createSection({
    title: LC_LOCALES("LC Section"),
    bodyMarkdown: LC_LOCALES("Body"),
    actorId: ACTOR,
  });
  sectionIds.push(section.id);
  return section.id;
}

async function makeCourse(opts: {
  moduleId?: string;
  sectionId?: string;
  published?: boolean;
}): Promise<string> {
  const items: Array<{ itemType: "MODULE" | "SECTION"; moduleId?: string; sectionId?: string; sortOrder: number }> = [];
  if (opts.moduleId) items.push({ itemType: "MODULE", moduleId: opts.moduleId, sortOrder: items.length });
  if (opts.sectionId) items.push({ itemType: "SECTION", sectionId: opts.sectionId, sortOrder: items.length });
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify({ "en-GB": "LC Course", nb: "LC Kurs", nn: "LC Kurs" }),
      publishedAt: opts.published ? new Date() : null,
      items: { create: items },
    },
    select: { id: true },
  });
  courseIds.push(course.id);
  return course.id;
}

async function makeUser(): Promise<string> {
  const tag = uniq();
  const user = await prisma.user.create({
    data: { externalId: tag, email: `${tag}@example.com`, name: "LC Participant" },
    select: { id: true },
  });
  userIds.push(user.id);
  return user.id;
}

describe("Unified content lifecycle (#705)", () => {
  beforeAll(async () => {
    ACTOR = await makeUser();
  });

  afterAll(async () => {
    await prisma.courseSectionRead.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.courseCompletion.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.courseItem.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.courseSection.updateMany({ where: { id: { in: sectionIds } }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await prisma.courseSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.module.updateMany({ where: { id: { in: moduleIds } }, data: { activeVersionId: null } });
    await prisma.moduleVersion.deleteMany({ where: { moduleId: { in: moduleIds } } });
    await prisma.module.deleteMany({ where: { id: { in: moduleIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  // G2 — modul i kurs er bærende og kan ikke trekkes vekk.
  it("blokkerer avpubliser OG arkiver av en modul som ligger i et kurs (G2)", async () => {
    const moduleId = await makePublishedModule();
    await makeCourse({ moduleId, published: false }); // også utkast-kurs låser (vedtatt: alle kurs)

    await expect(unpublishModule(moduleId, ACTOR)).rejects.toThrow(/i bruk i 1 kurs/);
    await expect(archiveModule(moduleId, ACTOR)).rejects.toThrow(/i bruk i 1 kurs/);

    // Modulen er fortsatt publisert (ingen tilstandsendring skjedde).
    const after = await prisma.module.findUnique({ where: { id: moduleId }, select: { activeVersionId: true, archivedAt: true } });
    expect(after?.activeVersionId).not.toBeNull();
    expect(after?.archivedAt).toBeNull();
  });

  // I3 — arkivering av en modul utenfor kurs auto-avpubliserer.
  it("auto-avpubliserer en modul ved arkivering når den ikke er i noe kurs (I3)", async () => {
    const moduleId = await makePublishedModule();

    await archiveModule(moduleId, ACTOR);

    const after = await prisma.module.findUnique({ where: { id: moduleId }, select: { activeVersionId: true, archivedAt: true } });
    expect(after?.activeVersionId).toBeNull();
    expect(after?.archivedAt).not.toBeNull();
  });

  // G2 — seksjon i kurs.
  it("blokkerer avpubliser/arkiver/slett av en seksjon som ligger i et kurs (G2)", async () => {
    const sectionId = await makeSection();
    await makeCourse({ sectionId, published: false });

    await expect(unpublishSection(sectionId, ACTOR)).rejects.toThrow(/i bruk i 1 kurs/);
    await expect(archiveSection(sectionId, ACTOR)).rejects.toThrow(/i bruk i 1 kurs/);
    await expect(deleteSection(sectionId)).rejects.toThrow(/i bruk i 1 kurs/);
  });

  // Seksjon-livssyklus utenfor kurs: full symmetri.
  it("seksjon utenfor kurs: arkiver auto-avpubliserer, gjenopprett → utkast, publiser re-peker (I3)", async () => {
    const sectionId = await makeSection();

    // Auto-publisert ved opprettelse.
    const created = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { activeVersionId: true } });
    expect(created?.activeVersionId).not.toBeNull();

    await archiveSection(sectionId, ACTOR);
    const archived = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { activeVersionId: true, archivedAt: true } });
    expect(archived?.activeVersionId).toBeNull();
    expect(archived?.archivedAt).not.toBeNull();

    await restoreSection(sectionId, ACTOR);
    const restored = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { activeVersionId: true, archivedAt: true } });
    expect(restored?.archivedAt).toBeNull();
    expect(restored?.activeVersionId).toBeNull(); // gjenopprett lander i Utkast

    await publishSection(sectionId, ACTOR);
    const republished = await prisma.courseSection.findUnique({ where: { id: sectionId }, select: { activeVersionId: true } });
    expect(republished?.activeVersionId).not.toBeNull();
  });

  // G3 — kurs med påbegynt-ufullført deltaker. Arkiver blokkeres; avpubliser er bevisst tillatt
  // (reversibel «myk» nedtaking).
  it("blokkerer ARKIVER (ikke avpubliser) av et kurs med påbegynt deltaker; fullføring frigjør (G3, I3)", async () => {
    const sectionId = await makeSection();
    const userId = await makeUser();

    // Eget kurs for avpubliser-delen (slik at vi kan republisere uten å påvirke arkiver-delen).
    const unpubCourseId = await makeCourse({ sectionId, published: true });
    await prisma.courseSectionRead.create({ data: { userId, courseId: unpubCourseId, sectionId } });
    // Avpubliser er IKKE G3-låst — skal lykkes selv med påbegynt deltaker.
    const unpubResult = await unpublishCourse(unpubCourseId, ACTOR);
    expect(unpubResult.publishedAt).toBeNull();

    // Arkiver ER G3-låst.
    const archCourseId = await makeCourse({ sectionId, published: true });
    await prisma.courseSectionRead.create({ data: { userId, courseId: archCourseId, sectionId } });
    await expect(archiveCourse(archCourseId, ACTOR)).rejects.toThrow(/midt i en gjennomføring/);

    // Fullført: deltakeren har en completion → ikke lenger «midt i».
    await prisma.courseCompletion.create({ data: { userId, courseId: archCourseId, moduleSnapshotJson: "[]" } });

    const result = await archiveCourse(archCourseId, ACTOR);
    expect(result.archivedAt).not.toBeNull();
    expect(result.publishedAt).toBeNull(); // I3: arkivering auto-avpubliserer kurset
  });

  // Regresjonsvakt: seksjonslistas status-merkelapp trenger activeVersionId i list-responsen.
  // (Tidligere utelatt → alle seksjoner viste «Utkast» og Publiser-knappen så ingen effekt.)
  it("GET /sections returnerer activeVersionId så status kan utledes", async () => {
    const sectionId = await makeSection(); // createSection auto-publiserer
    const res = await request(app)
      .get("/api/admin/content/sections")
      .set({ "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Admin" });
    expect(res.status).toBe(200);
    const row = (res.body.sections as Array<{ id: string; activeVersionId: string | null }>).find((s) => s.id === sectionId);
    expect(row).toBeTruthy();
    expect(row?.activeVersionId).toBeTruthy(); // publisert → status «Publisert», ikke «Utkast»
  });

  // A1 (#705): en sletting skal logges som `course_deleted`, ikke `course_archived`.
  it("logger course_deleted når et kurs slettes (ikke archived)", async () => {
    const courseId = await makeCourse({ published: false });
    await deleteCourse(courseId, ACTOR);
    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: "course", entityId: courseId },
      orderBy: { timestamp: "desc" },
    });
    expect(audit?.action).toBe("course_deleted");
  });

  // A2 (#705): G1 er enkelt-kilde — publisering av en versjon som ikke finnes på modulen avvises,
  // ingen uvoktet fallthrough.
  it("avviser publisering av en versjon som ikke finnes på modulen (404)", async () => {
    const moduleId = await makePublishedModule();
    const res = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/does-not-exist/publish`)
      .set(adminHeaders);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("module_version_not_found");
  });

  // A3 (#705): modul-slett i bruk gir 409 med den navngitte-kurs-meldingen (som avpubliser/arkiver).
  it("modul-slett i bruk gir 409 med navngitt-kurs-melding", async () => {
    const moduleId = await makePublishedModule();
    await makeCourse({ moduleId, published: false });
    const res = await request(app)
      .delete(`/api/admin/content/modules/${moduleId}`)
      .set(adminHeaders);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("module_in_use");
    expect(res.body.courseCount).toBe(1);
    expect(res.body.message).toContain("i bruk i 1 kurs");
    expect(res.body.message).toContain("«LC Kurs»");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// #938 — de to dørene inn til «arkivert innhold i et kurs».
//
// G2 stengte den ene: innhold som LIGGER i et kurs kan ikke arkiveres. Den andre sto åpen:
// allerede arkivert innhold kunne LEGGES INN. Det er slik «Samfunnsvitere» på stage fikk en
// arkivert modul som blokkerte fullføring for alltid.
//
// ⚠️ Poenget er ikke et filter til. Med begge dører stengt kan tilstanden ikke oppstå — og da
// slipper de fem leserne å ha hver sin regel for å håndtere den.
// ──────────────────────────────────────────────────────────────────────────────

describe("#938: arkivert innhold kan ikke legges inn i et kurs", () => {
  it("en arkivert seksjon avvises, og feilmeldingen sier HVORFOR", async () => {
    const course = await prisma.course.create({
      data: { title: `Door Course ${Date.now()}` },
      select: { id: true },
    });
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Archived" }), archivedAt: new Date() },
      select: { id: true },
    });

    const res = await request(app)
      .put(`/api/admin/content/courses/${course.id}/items`)
      .set(adminHeaders)
      .send({ items: [{ type: "SECTION", sectionId: section.id }] });

    expect(res.status).toBe(400);
    // «One or more sections do not exist» ville vært en løgn — den finnes, den kan bare ikke brukes.
    expect(JSON.stringify(res.body)).toMatch(/archived/i);

    const items = await prisma.courseItem.count({ where: { courseId: course.id } });
    expect(items, "ingenting skal være skrevet på veien til avslaget").toBe(0);
  });

  it("en arkivert modul avvises på samme måte", async () => {
    const course = await prisma.course.create({
      data: { title: `Door Course M ${Date.now()}` },
      select: { id: true },
    });
    const mod = await prisma.module.create({
      data: { title: JSON.stringify({ "en-GB": "Archived module" }), archivedAt: new Date() },
      select: { id: true },
    });

    const res = await request(app)
      .put(`/api/admin/content/courses/${course.id}/items`)
      .set(adminHeaders)
      .send({ items: [{ type: "MODULE", moduleId: mod.id }] });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/archived/i);
  });

  it("KONTROLLCASE: ikke-arkivert innhold legges inn som før", async () => {
    // Uten denne vet vi ikke om vi målte arkivregelen eller bare knekte ruta. En `return 400` uten
    // betingelse ville bestått begge testene over.
    const course = await prisma.course.create({
      data: { title: `Door Course OK ${Date.now()}` },
      select: { id: true },
    });
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Live" }) },
      select: { id: true },
    });

    const res = await request(app)
      .put(`/api/admin/content/courses/${course.id}/items`)
      .set(adminHeaders)
      .send({ items: [{ type: "SECTION", sectionId: section.id }] });

    expect(res.status, JSON.stringify(res.body)).toBe(204);
    expect(await prisma.courseItem.count({ where: { courseId: course.id } })).toBe(1);
  });

  it("KONTROLLCASE: en id som ikke finnes gir fortsatt «does not exist», ikke «archived»", async () => {
    // De to feilene må kunne skilles. Slår man dem sammen, mister forfatteren informasjonen om
    // hvilken av dem det er — og det var nettopp uklare feilmeldinger som ga oss #937.
    const course = await prisma.course.create({
      data: { title: `Door Course X ${Date.now()}` },
      select: { id: true },
    });

    const res = await request(app)
      .put(`/api/admin/content/courses/${course.id}/items`)
      .set(adminHeaders)
      .send({ items: [{ type: "SECTION", sectionId: "finnes-ikke-i-det-hele-tatt" }] });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/do not exist/i);
    expect(JSON.stringify(res.body)).not.toMatch(/archived/i);
  });
});

describe("#938: innhold i et utstedt kursbevis kan ikke slettes", () => {
  it("en seksjon som står i et kursbevis nektes slettet — og bes arkivert i stedet", async () => {
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "In a certificate" }) },
      select: { id: true },
    });
    const course = await prisma.course.create({
      data: { title: `Cert Course ${Date.now()}`, publishedAt: new Date() },
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: { externalId: `cert-user-${Date.now()}`, email: `cu${Date.now()}@x.no`, name: "U" },
      select: { id: true },
    });
    // Beviset peker på seksjonen. Seksjonen er IKKE lenger i kurset — G2 slipper den derfor gjennom.
    await prisma.courseCompletion.create({
      data: {
        userId: user.id,
        courseId: course.id,
        moduleSnapshotJson: "[]",
        sectionSnapshotJson: JSON.stringify([section.id]),
      },
    });

    const res = await request(app)
      .delete(`/api/admin/content/sections/${section.id}`)
      .set(adminHeaders);

    expect(res.status).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/kursbevis/i);
    // Meldingen skal peke på veien videre, ikke bare nekte.
    expect(body).toMatch(/arkiver/i);

    expect(await prisma.courseSection.count({ where: { id: section.id } }), "seksjonen skal fortsatt finnes").toBe(1);
  });

  it("KONTROLLCASE: en seksjon uten kursbevis slettes fortsatt", async () => {
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Free to delete" }) },
      select: { id: true },
    });
    const res = await request(app).delete(`/api/admin/content/sections/${section.id}`).set(adminHeaders);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
  });
});

describe("#938 P1: slettevernet dekker gamle bevis og kaskaden", () => {
  async function participant(tag: string) {
    return prisma.user.create({
      data: { externalId: `p1-${tag}-${Date.now()}`, email: `p1${tag}${Date.now()}@x.no`, name: "P" },
      select: { id: true },
    });
  }

  it("et kursbevis UTEN øyeblikksbilde beskytter fortsatt seksjonen deltakeren leste", async () => {
    // ⚠️ Kursbevis utstedt før v2.23.0 har sectionSnapshotJson = NULL. Et `contains`-oppslag treffer
    // aldri NULL, så den første versjonen av vakta beskyttet ingen av dem — og jeg hadde selv skrevet
    // i beslutningsloggen at kolonnen var nullbar og ikke bakfylt.
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Legacy basis" }) },
      select: { id: true },
    });
    const course = await prisma.course.create({
      data: { title: `Legacy Course ${Date.now()}`, publishedAt: new Date() },
      select: { id: true },
    });
    const user = await participant("legacy");

    // Beviset er fra «før»: ingen seksjons-øyeblikksbilde. Lesesporet er alt vi har.
    await prisma.courseCompletion.create({
      data: { userId: user.id, courseId: course.id, moduleSnapshotJson: "[]", sectionSnapshotJson: null },
    });
    await prisma.courseSectionRead.create({
      data: { userId: user.id, courseId: course.id, sectionId: section.id },
    });

    const res = await request(app).delete(`/api/admin/content/sections/${section.id}`).set(adminHeaders);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/før øyeblikksbildet|kursbevis/i);
    expect(await prisma.courseSection.count({ where: { id: section.id } })).toBe(1);
  });

  it("KONTROLLCASE: et gammelt bevis for et ANNET kurs beskytter ikke", async () => {
    // Uten denne ville «blokker hvis det finnes noe NULL-bevis i det hele tatt» bestått testen over.
    // Regelen er at deltakeren må ha lest seksjonen I DET KURSET hen fikk beviset for.
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Unrelated" }) },
      select: { id: true },
    });
    const otherCourse = await prisma.course.create({
      data: { title: `Other Course ${Date.now()}`, publishedAt: new Date() },
      select: { id: true },
    });
    const user = await participant("unrelated");
    await prisma.courseCompletion.create({
      data: { userId: user.id, courseId: otherCourse.id, moduleSnapshotJson: "[]", sectionSnapshotJson: null },
    });

    const res = await request(app).delete(`/api/admin/content/sections/${section.id}`).set(adminHeaders);
    expect(res.status, JSON.stringify(res.body)).toBe(204);
  });

  it("kaskadesletting blokkeres når en eksklusiv seksjon står i et bevis for et annet kurs", async () => {
    // Scenariet QA fant: seksjonen ble fjernet fra sitt opprinnelige kurs, lagt EKSKLUSIVT i et
    // annet, og det andre kurset kaskadeslettes. Kaskaden slettet seksjonen direkte, uten vakta.
    const section = await prisma.courseSection.create({
      data: { title: JSON.stringify({ "en-GB": "Moved but certified" }) },
      select: { id: true },
    });
    const originalCourse = await prisma.course.create({
      data: { title: `Original ${Date.now()}`, publishedAt: new Date() },
      select: { id: true },
    });
    const user = await participant("cascade");
    await prisma.courseCompletion.create({
      data: {
        userId: user.id,
        courseId: originalCourse.id,
        moduleSnapshotJson: "[]",
        sectionSnapshotJson: JSON.stringify([section.id]),
      },
    });

    // Nå ligger seksjonen eksklusivt i et NYTT kurs, som ikke har noen fullføringer selv.
    const newCourse = await prisma.course.create({
      data: { title: `New Home ${Date.now()}` },
      select: { id: true },
    });
    await prisma.courseItem.create({
      data: { courseId: newCourse.id, itemType: "SECTION", sectionId: section.id, sortOrder: 0 },
    });

    // Forhåndsvisningen skal SI fra, ikke la slettingen kaste halvveis i en transaksjon.
    const preview = await request(app)
      .get(`/api/admin/content/courses/${newCourse.id}/cascade-delete-preview`)
      .set(adminHeaders);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.deletable, "kurset skal ikke være slettbart").toBe(false);
    expect(JSON.stringify(preview.body.blockers)).toMatch(/kursbevis/i);

    expect(await prisma.courseSection.count({ where: { id: section.id } })).toBe(1);
  });
});
