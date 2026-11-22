import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1168: «Arkiver» på en modul sjekker først, som kursets dialog (#1150). `GET …/modules/:id/archive-preview` svarer hvilke kurs
// som holder modulen igjen. Svaret skal komme fra den SAMME regelen som sperren i `POST …/archive` («brukes andre steder»:
// aktive kurs og lagrede kursutkast, ikke arkiverte kurs), så testene sammenligner de to svarene i stedet for å fastsette en
// egen liste. Testene går gjennom rutene (supertest). Hvert kurs sier `archivedAt` og `publishedAt` uttrykkelig.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
// En ny administrator per test: admin-API-et slipper bare 120 kall i minuttet per bruker (`generalApiLimiter`).
const ADMIN: Record<string, string> = {
  "x-user-id": "preview-1168-admin",
  "x-user-email": "preview.1168.admin@x.test",
  "x-user-name": "Admin",
  "x-user-roles": "ADMINISTRATOR",
  "x-locale": "nb",
};
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `preview-1168-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `preview.1168.admin.${RUN}.${adminSeq}@x.test`;
});

let seq = 0;
const tag = (name: string) => `1168 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

async function createModule(title: string, { published }: { published: boolean }) {
  const module = await prisma.module.create({ data: { title: JSON.stringify(L(title)), archivedAt: null }, select: { id: true } });
  if (!published) return module.id;
  const source = await prisma.moduleVersion.findFirst({
    where: { module: { activeVersionId: { not: null } } },
    select: { rubricVersionId: true, promptTemplateVersionId: true, mcqSetVersionId: true },
    orderBy: { createdAt: "asc" },
  });
  expect(source).toBeTruthy();
  const version = await prisma.moduleVersion.create({
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
  await prisma.module.update({ where: { id: module.id }, data: { activeVersionId: version.id } });
  return module.id;
}

type CourseState = "archived" | "draft" | "published";

/** Et kurs i en bestemt tilstand. `inDraftOnly`: modulen står bare i kursets lagrede utkast, ikke i kurset. */
async function createCourse(name: string, state: CourseState, moduleId: string, { inDraftOnly = false } = {}) {
  const title = tag(name);
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(L(title)),
      certificationLevel: "basic",
      archivedAt: state === "archived" ? new Date() : null,
      publishedAt: state === "published" ? new Date() : null,
      slug: `preview-1168-${RUN}-${seq++}`,
      items: inDraftOnly ? undefined : { create: [{ itemType: "MODULE", moduleId, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  if (inDraftOnly) {
    await prisma.courseDraft.create({
      data: { courseId: course.id, payloadText: JSON.stringify({ items: [{ type: "MODULE", moduleId }] }), baseRevision: 0, source: "form" },
    });
  }
  return { id: course.id, title };
}

const modulePath = (moduleId: string, action = "") => `/api/admin/content/modules/${moduleId}${action}`;
const preview = (moduleId: string) => request(app).get(modulePath(moduleId, "/archive-preview")).set(ADMIN);
const archive = (moduleId: string) => request(app).post(modulePath(moduleId, "/archive")).set(ADMIN).send({});

type Use = { courseId: string; title: string; via: "course" | "draft" };
const byTitle = (uses: Use[]) => [...uses].sort((a, b) => a.title.localeCompare(b.title));

describe("#1168: forhåndsvisningen av «Arkiver» for en modul", () => {
  it("modul i et publisert kurs, i utkastet til et annet og i et arkivert: forhåndsvisningen navngir de to aktive, som sperren", async () => {
    const moduleId = await createModule(tag("modul i bruk"), { published: true });
    const published = await createCourse("publisert kurs", "published", moduleId);
    const draft = await createCourse("kurs med utkast", "draft", moduleId, { inDraftOnly: true });
    await createCourse("arkivert kurs", "archived", moduleId);

    const seen = await preview(moduleId);
    expect(seen.status, JSON.stringify(seen.body).slice(0, 300)).toBe(200);
    expect(seen.body.moduleId).toBe(moduleId);
    expect(seen.body.archived).toBe(false);
    expect(seen.body.published).toBe(true);
    expect(byTitle(seen.body.uses)).toEqual(byTitle([
      { courseId: published.id, title: published.title, via: "course" },
      { courseId: draft.id, title: draft.title, via: "draft" },
    ]));

    // Sperren svarer det samme: samme kurs, samme vei inn. Ingenting er arkivert.
    const blocked = await archive(moduleId);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("content_in_course_draft");
    expect(byTitle(blocked.body.details.uses)).toEqual(byTitle(seen.body.uses));
    const row = await prisma.module.findUniqueOrThrow({ where: { id: moduleId }, select: { archivedAt: true } });
    expect(row.archivedAt).toBeNull();
  });

  it("modul bare i et aktivt kurs: titlene er de samme som i sperrens svar", async () => {
    const moduleId = await createModule(tag("modul i ett kurs"), { published: true });
    const course = await createCourse("aktivt kurs", "draft", moduleId);

    const seen = await preview(moduleId);
    expect(seen.body.uses).toEqual([{ courseId: course.id, title: course.title, via: "course" }]);
    const blocked = await archive(moduleId);
    expect(blocked.body.error).toBe("content_in_use");
    expect(blocked.body.details.courseTitles).toEqual(seen.body.uses.map((use: Use) => use.title));
  });

  it("KONTROLL: modul bare i et arkivert kurs, upublisert: ingen kurs holder den igjen, og arkiveringen går gjennom", async () => {
    const moduleId = await createModule(tag("modul fri"), { published: false });
    await createCourse("arkivert kurs", "archived", moduleId);

    const seen = await preview(moduleId);
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual({ moduleId, archived: false, published: false, uses: [] });
    expect((await archive(moduleId)).status).toBe(200);

    // Etterpå sier forhåndsvisningen at den er arkivert.
    expect((await preview(moduleId)).body.archived).toBe(true);
  });

  it("kurstitlene kommer på forespørselens språk (QA 2.178.0: uten `locale` ville bokmål ha stått også på engelsk)", async () => {
    const moduleId = await createModule(tag("modul språk"), { published: false });
    const nb = tag("Kurs på bokmål");
    const en = tag("Course in English");
    const course = await prisma.course.create({
      data: {
        title: JSON.stringify({ "en-GB": en, nb, nn: nb }),
        certificationLevel: "basic",
        archivedAt: null,
        publishedAt: null,
        slug: `preview-1168-${RUN}-${seq++}`,
        items: { create: [{ itemType: "MODULE", moduleId, sortOrder: 0 }] },
      },
      select: { id: true },
    });

    const english = await request(app).get(modulePath(moduleId, "/archive-preview")).set({ ...ADMIN, "x-locale": "en-GB" });
    expect(english.body.uses).toEqual([{ courseId: course.id, title: en, via: "course" }]);
    // KONTROLL: bokmål gir bokmål.
    expect((await preview(moduleId)).body.uses).toEqual([{ courseId: course.id, title: nb, via: "course" }]);
  });

  it("en modul som ikke finnes: 404", async () => {
    const seen = await preview(`finnes-ikke-${RUN}`);
    expect(seen.status).toBe(404);
  });
});
