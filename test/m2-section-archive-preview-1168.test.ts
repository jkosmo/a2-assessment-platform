import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1168, andre skive: «Arkiver» på en seksjon sjekker først, som modulen (2.178.0) og kurset (#1150). Før spurte en spørreboks,
// og avslaget kom etterpå. `GET …/sections/:id/archive-preview` svarer hvilke kurs som holder seksjonen igjen, fra den SAMME
// regelen som sperren i `POST …/archive` («brukes andre steder»: aktive kurs og lagrede kursutkast, ikke arkiverte kurs), så
// testene sammenligner de to svarene i stedet for å fastsette en egen liste. Gjennom rutene (supertest). Hvert kurs sier
// `archivedAt` og `publishedAt` uttrykkelig.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
// En ny administrator per test: admin-API-et slipper bare 120 kall i minuttet per bruker (`generalApiLimiter`).
const ADMIN: Record<string, string> = {
  "x-user-id": "section-preview-1168-admin",
  "x-user-email": "section.preview.1168.admin@x.test",
  "x-user-name": "Admin",
  "x-user-roles": "ADMINISTRATOR",
  "x-locale": "nb",
};
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `section-preview-1168-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `section.preview.1168.admin.${RUN}.${adminSeq}@x.test`;
});

let seq = 0;
const tag = (name: string) => `1168s ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

async function createSection(title: string, { published }: { published: boolean }) {
  const section = await prisma.courseSection.create({ data: { title: JSON.stringify(L(title)), archivedAt: null }, select: { id: true } });
  if (!published) return section.id;
  const version = await prisma.courseSectionVersion.create({
    data: { sectionId: section.id, versionNo: 1, bodyMarkdown: JSON.stringify(L(`${title} tekst`)), title: JSON.stringify(L(title)), publishedAt: new Date() },
    select: { id: true },
  });
  await prisma.courseSection.update({ where: { id: section.id }, data: { activeVersionId: version.id } });
  return section.id;
}

type CourseState = "archived" | "draft" | "published";

/** Et kurs i en bestemt tilstand. `inDraftOnly`: seksjonen står bare i kursets lagrede utkast, ikke i kurset. */
async function createCourse(name: string, state: CourseState, sectionId: string, { inDraftOnly = false } = {}) {
  const title = tag(name);
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(L(title)),
      certificationLevel: "basic",
      archivedAt: state === "archived" ? new Date() : null,
      publishedAt: state === "published" ? new Date() : null,
      slug: `section-preview-1168-${RUN}-${seq++}`,
      items: inDraftOnly ? undefined : { create: [{ itemType: "SECTION", sectionId, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  if (inDraftOnly) {
    await prisma.courseDraft.create({
      data: { courseId: course.id, payloadText: JSON.stringify({ items: [{ type: "SECTION", sectionId }] }), baseRevision: 0, source: "form" },
    });
  }
  return { id: course.id, title };
}

const sectionPath = (sectionId: string, action = "") => `/api/admin/content/sections/${sectionId}${action}`;
const preview = (sectionId: string, headers: Record<string, string> = ADMIN) => request(app).get(sectionPath(sectionId, "/archive-preview")).set(headers);
const archive = (sectionId: string) => request(app).post(sectionPath(sectionId, "/archive")).set(ADMIN).send({});

type Use = { courseId: string; title: string; via: "course" | "draft" };
const byTitle = (uses: Use[]) => [...uses].sort((a, b) => a.title.localeCompare(b.title));

describe("#1168: forhåndsvisningen av «Arkiver» for en seksjon", () => {
  it("seksjon i et publisert kurs, i utkastet til et annet og i et arkivert: forhåndsvisningen navngir de to aktive, som sperren", async () => {
    const sectionId = await createSection(tag("seksjon i bruk"), { published: true });
    const published = await createCourse("publisert kurs", "published", sectionId);
    const draft = await createCourse("kurs med utkast", "draft", sectionId, { inDraftOnly: true });
    await createCourse("arkivert kurs", "archived", sectionId);

    const seen = await preview(sectionId);
    expect(seen.status, JSON.stringify(seen.body).slice(0, 300)).toBe(200);
    expect(seen.body.sectionId).toBe(sectionId);
    expect(seen.body.archived).toBe(false);
    expect(seen.body.published).toBe(true);
    expect(byTitle(seen.body.uses)).toEqual(byTitle([
      { courseId: published.id, title: published.title, via: "course" },
      { courseId: draft.id, title: draft.title, via: "draft" },
    ]));

    // Sperren svarer det samme: samme kurs, samme vei inn. Ingenting er arkivert.
    const blocked = await archive(sectionId);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("content_in_course_draft");
    expect(byTitle(blocked.body.details.uses)).toEqual(byTitle(seen.body.uses));
    const row = await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { archivedAt: true } });
    expect(row.archivedAt).toBeNull();
  });

  it("seksjon bare i et aktivt kurs: titlene er de samme som i sperrens svar", async () => {
    const sectionId = await createSection(tag("seksjon i ett kurs"), { published: true });
    const course = await createCourse("aktivt kurs", "draft", sectionId);

    const seen = await preview(sectionId);
    expect(seen.body.uses).toEqual([{ courseId: course.id, title: course.title, via: "course" }]);
    const blocked = await archive(sectionId);
    expect(blocked.body.error).toBe("content_in_use");
    expect(blocked.body.details.courseTitles).toEqual(seen.body.uses.map((use: Use) => use.title));
  });

  it("KONTROLL: seksjon bare i et arkivert kurs, upublisert: ingen kurs holder den igjen, og arkiveringen går gjennom", async () => {
    const sectionId = await createSection(tag("seksjon fri"), { published: false });
    await createCourse("arkivert kurs", "archived", sectionId);

    const seen = await preview(sectionId);
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual({ sectionId, archived: false, published: false, uses: [] });
    expect((await archive(sectionId)).status).toBe(200);

    // Etterpå sier forhåndsvisningen at den er arkivert.
    expect((await preview(sectionId)).body.archived).toBe(true);
  });

  it("kurstitlene kommer på forespørselens språk", async () => {
    const sectionId = await createSection(tag("seksjon språk"), { published: false });
    const nb = tag("Kurs på bokmål");
    const en = tag("Course in English");
    const course = await prisma.course.create({
      data: {
        title: JSON.stringify({ "en-GB": en, nb, nn: nb }),
        certificationLevel: "basic",
        archivedAt: null,
        publishedAt: null,
        slug: `section-preview-1168-${RUN}-${seq++}`,
        items: { create: [{ itemType: "SECTION", sectionId, sortOrder: 0 }] },
      },
      select: { id: true },
    });

    const english = await preview(sectionId, { ...ADMIN, "x-locale": "en-GB" });
    expect(english.body.uses).toEqual([{ courseId: course.id, title: en, via: "course" }]);
    // KONTROLL: bokmål gir bokmål.
    expect((await preview(sectionId)).body.uses).toEqual([{ courseId: course.id, title: nb, via: "course" }]);
  });

  it("en seksjon som ikke finnes: 404 for administratoren", async () => {
    const seen = await preview(`finnes-ikke-${RUN}`);
    expect(seen.status).toBe(404);
  });
});
