// #916 — standalone section export/import + the section publish gate (#896 S4 applied to sections).
//
// What this file pins, and why each one is here rather than "obviously fine":
//   - Export is ownership-guarded. #903 exists because course export shipped without that guard.
//   - Import lands UNPUBLISHED (#896 §9), so a package is never live before a human looked at it.
//   - The envelope's `scope` is checked per endpoint — a course package posted to the section
//     importer must fail loudly, not half-import.
//   - The publish gate blocks a section with a language hole on EVERY door, not just the button.
//   - Figures travel through `stageSectionAssets` (the same path course import uses), so the
//     round-trip recreates the blobs and remaps the `asset:<id>` refs.

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { createSectionAsset } from "../src/modules/course/assetCommands.js";
import { getAsset } from "../src/modules/course/assetStorage.js";

const admin = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};
const smoOwner = {
  "x-user-id": "sec916-owner",
  "x-user-email": "sec916-owner@x.test",
  "x-user-name": "Owner SMO",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};
const smoOther = {
  "x-user-id": "sec916-other",
  "x-user-email": "sec916-other@x.test",
  "x-user-name": "Other SMO",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** All three locales — the shape a section needs to pass the publish gate. */
const L = (value: string) => ({ "en-GB": value, nb: value, nn: value });

async function createSection(
  headers: Record<string, string>,
  body: { title: unknown; bodyMarkdown: unknown },
): Promise<{ id: string; response: request.Response }> {
  const response = await request(app).post("/api/admin/content/sections").set(headers).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { id: response.body.section.id as string, response };
}

async function latestVersionOf(sectionId: string) {
  return prisma.courseSectionVersion.findFirst({
    where: { sectionId },
    orderBy: { versionNo: "desc" },
  });
}

describe("#916 standalone section export", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("exports the owner's own section as an a2-content-export/v1 envelope with scope 'section'", async () => {
    const stamp = Date.now();
    const { id } = await createSection(smoOwner, {
      title: L(`Eksportkilde ${stamp}`),
      bodyMarkdown: L("# Hei\n\nLes dette."),
    });

    const res = await request(app)
      .get(`/api/admin/content/sections/${id}/export-package`)
      .set(smoOwner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const envelope = res.body.envelope;
    expect(envelope.exportFormat).toBe("a2-content-export/v1");
    expect(envelope.scope).toBe("section");
    expect(envelope.module).toBeUndefined();
    expect(envelope.course).toBeUndefined();
    expect(envelope.section.title).toEqual(L(`Eksportkilde ${stamp}`));
    expect(envelope.section.bodyMarkdown).toEqual(L("# Hei\n\nLes dette."));
    // Source attribution travels, but only as opaque display data (the destination must never try
    // to resolve it against its own user table).
    expect(envelope.section.audit.sourceVersionNo).toBe(1);
    expect(typeof envelope.exportedBy).toBe("string");
    expect(envelope.exportedBy).toBeTruthy();
  });

  it("refuses to export another author's section (403 content_ownership)", async () => {
    const { id } = await createSection(smoOwner, {
      title: L(`Privat ${Date.now()}`),
      bodyMarkdown: L("# Ikke ditt"),
    });

    const res = await request(app)
      .get(`/api/admin/content/sections/${id}/export-package`)
      .set(smoOther);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_ownership");
    // The refusal must not leak the content it is protecting.
    expect(JSON.stringify(res.body)).not.toContain("Ikke ditt");

    // ADMINISTRATOR keeps universal access (same rule as every other ownership-guarded route).
    expect((await request(app).get(`/api/admin/content/sections/${id}/export-package`).set(admin)).status).toBe(200);
  });

  it("exports a DRAFT section's content — the newest version, not an empty body", async () => {
    // nb only, so the publish gate holds the create back: the section is a draft with real content.
    const { id, response } = await createSection(smoOwner, {
      title: { nb: `Utkast ${Date.now()}` },
      bodyMarkdown: { nb: "# Bare norsk" },
    });
    expect(response.body.section.activeVersionId).toBeNull();

    const res = await request(app).get(`/api/admin/content/sections/${id}/export-package`).set(smoOwner);
    expect(res.status).toBe(200);
    expect(res.body.envelope.section.bodyMarkdown).toEqual({ nb: "# Bare norsk" });
    // …and it reports honestly that the source was never published.
    expect(res.body.envelope.section.audit.publishedAt).toBeNull();
  });
});

describe("#916 standalone section import", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function exportEnvelope(sectionId: string, headers: Record<string, string>) {
    const res = await request(app).get(`/api/admin/content/sections/${sectionId}/export-package`).set(headers);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.envelope;
  }

  it("imports a section as a fresh, UNPUBLISHED copy (#896 §9)", async () => {
    const stamp = Date.now();
    const { id: sourceId } = await createSection(smoOwner, {
      title: L(`Rundtur ${stamp}`),
      bodyMarkdown: L("# Innhold\n\nEn setning."),
    });
    const envelope = await exportEnvelope(sourceId, smoOwner);

    const res = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOther)
      .send({ payload: envelope, mode: "createNew" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const newId = res.body.sectionId as string;
    expect(newId).not.toBe(sourceId);
    expect(res.body.published).toBe(false);
    expect(res.body.links.editor).toContain(newId);

    const imported = await prisma.courseSection.findUnique({ where: { id: newId } });
    // The whole point: content arrived, but participants cannot reach it yet.
    expect(imported?.activeVersionId).toBeNull();
    expect(JSON.parse(imported!.title)).toEqual(L(`Rundtur ${stamp}`));
    const version = await latestVersionOf(newId);
    expect(JSON.parse(version!.bodyMarkdown)).toEqual(L("# Innhold\n\nEn setning."));
    expect(version?.publishedAt).toBeNull();

    // The importer owns the copy — importing is authoring, not borrowing.
    const importer = await prisma.user.findFirst({ where: { externalId: "sec916-other" }, select: { id: true } });
    const owners = await prisma.contentOwner.findMany({ where: { contentType: "SECTION", contentId: newId } });
    expect(owners.map((o) => o.userId)).toEqual([importer!.id]);

    // And it is auditable as an import, not merely as a create.
    const event = await prisma.auditEvent.findFirst({ where: { action: "section_imported", entityId: newId } });
    expect(event).not.toBeNull();
    expect(JSON.parse(event!.metadataJson).mode).toBe("createNew");
  });

  it("stays unpublished even when the source section was published", async () => {
    const { id: sourceId } = await createSection(smoOwner, {
      title: L(`Live kilde ${Date.now()}`),
      bodyMarkdown: L("# Publisert innhold"),
    });
    const source = await prisma.courseSection.findUnique({ where: { id: sourceId } });
    expect(source?.activeVersionId).not.toBeNull(); // fully translated ⇒ auto-published on save

    const envelope = await exportEnvelope(sourceId, smoOwner);
    expect(envelope.section.audit.publishedAt).not.toBeNull();

    const res = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOwner)
      .send({ payload: envelope, mode: "createNew" });
    expect(res.status).toBe(201);
    const imported = await prisma.courseSection.findUnique({ where: { id: res.body.sectionId } });
    expect(imported?.activeVersionId).toBeNull();
  });

  it("rejects an envelope whose scope is not 'section'", async () => {
    const courseEnvelope = {
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      scope: "course",
      course: {
        course: {
          title: L(`Feil omfang ${Date.now()}`),
          certificationLevel: null,
          audit: {},
          items: [{ type: "SECTION", sortOrder: 0, section: { title: L("S"), bodyMarkdown: L("# S"), audit: {} } }],
        },
      },
    };

    const res = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOwner)
      .send({ payload: courseEnvelope, mode: "createNew" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("scope_mismatch");

    // Nothing was created on the way to the refusal.
    const created = await prisma.courseSection.findFirst({ where: { title: { contains: "Feil omfang" } } });
    expect(created).toBeNull();
  });

  it("rejects a section envelope whose scope/payload disagree (schema refine)", async () => {
    const res = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOwner)
      .send({
        payload: {
          exportFormat: "a2-content-export/v1",
          exportedAt: new Date().toISOString(),
          scope: "section",
          // No `section` field — the envelope claims a payload it does not carry.
        },
        mode: "createNew",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("replaceExisting requires ownership of the target section, and lands as an inactive version", async () => {
    const { id: targetId } = await createSection(smoOwner, {
      title: L(`Mål ${Date.now()}`),
      bodyMarkdown: L("# Original"),
    });
    const liveVersionId = (await prisma.courseSection.findUnique({ where: { id: targetId } }))!.activeVersionId;
    expect(liveVersionId).not.toBeNull();

    const { id: sourceId } = await createSection(smoOther, {
      title: L(`Ny tekst ${Date.now()}`),
      bodyMarkdown: L("# Erstatning"),
    });
    const envelope = await exportEnvelope(sourceId, smoOther);

    // A non-owner cannot write into someone else's section — the #528 lesson, applied here.
    const denied = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOther)
      .send({ payload: envelope, mode: "replaceExisting", targetId });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("content_ownership");
    expect((await latestVersionOf(targetId))!.id).toBe(liveVersionId);

    // The owner may — and the live version keeps serving until they publish.
    const allowed = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOwner)
      .send({ payload: envelope, mode: "replaceExisting", targetId });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);

    const after = await prisma.courseSection.findUnique({ where: { id: targetId } });
    expect(after?.activeVersionId).toBe(liveVersionId);
    const newest = await latestVersionOf(targetId);
    expect(newest!.id).not.toBe(liveVersionId);
    expect(newest!.versionNo).toBe(2);
    expect(newest!.publishedAt).toBeNull();
    expect(JSON.parse(newest!.bodyMarkdown)).toEqual(L("# Erstatning"));
  });

  it("carries figures through stageSectionAssets: blobs recreated, asset refs remapped", async () => {
    const { id: sourceId } = await createSection(smoOwner, {
      title: L(`Figurseksjon ${Date.now()}`),
      bodyMarkdown: L("midlertidig"),
    });
    const asset = await createSectionAsset({
      sectionId: sourceId,
      filename: "diagram.png",
      mimeType: "image/png",
      buffer: PNG_1PX,
    });
    const withRef = await request(app)
      .put(`/api/admin/content/sections/${sourceId}/content`)
      .set(smoOwner)
      .send({ bodyMarkdown: L(`# Figur\n\n![Diagram](asset:${asset.id})`) });
    expect(withRef.status).toBe(200);

    const envelope = (await request(app).get(`/api/admin/content/sections/${sourceId}/export-package`).set(smoOwner)).body.envelope;
    expect(envelope.section.assets).toHaveLength(1);
    expect(envelope.section.assets[0].sourceId).toBe(asset.id);

    const res = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOwner)
      .send({ payload: envelope, mode: "createNew" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.assetCount).toBe(1);

    const newId = res.body.sectionId as string;
    const rows = await prisma.sectionAsset.findMany({ where: { sectionId: newId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(asset.id);
    expect((await getAsset(rows[0].blobPath)).byteLength).toBe(PNG_1PX.byteLength);

    const body = (await latestVersionOf(newId))!.bodyMarkdown;
    expect(body).toContain(`asset:${rows[0].id}`);
    expect(body).not.toContain(`asset:${asset.id}`);
  });
});

describe("#916 section publish gate (#896 S4 applied to sections)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("blocks the publish button and names field × language", async () => {
    const { id } = await createSection(smoOwner, {
      title: { nb: `Halvspråklig ${Date.now()}`, "en-GB": "Half-translated" },
      bodyMarkdown: { nb: "# Bare norsk" },
    });

    const res = await request(app).post(`/api/admin/content/sections/${id}/publish`).set(smoOwner);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("publish_blocked_by_validation");

    const issues = res.body.issues as Array<{ code: string; field: string; missingLocales: string[]; severity: string }>;
    expect(issues.every((i) => i.severity === "blocking")).toBe(true);
    expect(issues.every((i) => i.code === "translation_incomplete")).toBe(true);
    // The title has en-GB + nb; only nynorsk is missing. The body has nb alone.
    expect(issues.find((i) => i.field === "title")?.missingLocales).toEqual(["nn"]);
    expect(issues.find((i) => i.field === "bodyMarkdown")?.missingLocales.sort()).toEqual(["en-GB", "nn"]);

    // Blocked means blocked — the section is still a draft afterwards.
    expect((await prisma.courseSection.findUnique({ where: { id } }))?.activeVersionId).toBeNull();
  });

  it("lets a fully translated section publish, and only names the fields that are actually missing", async () => {
    const { id } = await createSection(smoOwner, {
      title: { nb: `Fyll hullene ${Date.now()}` },
      bodyMarkdown: L("# Komplett innhold"),
    });
    // Only the title is short of a translation, so only the title is reported.
    const blocked = await request(app).post(`/api/admin/content/sections/${id}/publish`).set(smoOwner);
    expect(blocked.status).toBe(422);
    expect((blocked.body.issues as Array<{ field: string }>).map((i) => i.field)).toEqual(["title"]);

    const stamp = Date.now();
    expect(
      (await request(app).patch(`/api/admin/content/sections/${id}/title`).set(smoOwner).send({ title: L(`Ferdig ${stamp}`) })).status,
    ).toBe(200);

    const published = await request(app).post(`/api/admin/content/sections/${id}/publish`).set(smoOwner);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body.section.activeVersionId).not.toBeNull();
  });

  it("holds a content save back from auto-publish instead of failing it — the text is never lost", async () => {
    const { id } = await createSection(smoOwner, {
      title: L(`Levende ${Date.now()}`),
      bodyMarkdown: L("# Komplett"),
    });
    const liveVersionId = (await prisma.courseSection.findUnique({ where: { id } }))!.activeVersionId;
    expect(liveVersionId).not.toBeNull();

    const save = await request(app)
      .put(`/api/admin/content/sections/${id}/content`)
      .set(smoOwner)
      .send({ bodyMarkdown: { nb: "# Nytt, bare på norsk" } });
    expect(save.status).toBe(200);
    expect(save.body.translationGate.heldBack).toBe(true);
    expect((save.body.translationGate.issues as Array<{ field: string }>).map((i) => i.field)).toEqual(["bodyMarkdown"]);

    // Stored (version 2 exists, with the author's text) …
    const newest = await latestVersionOf(id);
    expect(newest!.versionNo).toBe(2);
    expect(JSON.parse(newest!.bodyMarkdown)).toEqual({ nb: "# Nytt, bare på norsk" });
    // … but NOT live: participants keep reading the last complete version.
    expect((await prisma.courseSection.findUnique({ where: { id } }))?.activeVersionId).toBe(liveVersionId);
    // The editor must still show what was saved, or the author would think the save was lost.
    const detail = await request(app).get(`/api/admin/content/sections/${id}`).set(smoOwner);
    expect(JSON.parse(detail.body.section.bodyMarkdown)).toEqual({ nb: "# Nytt, bare på norsk" });
    expect(detail.body.section.hasUnpublishedChanges).toBe(true);
  });

  it("blocks the course cascade too, and publishes nothing when a section has a hole", async () => {
    const { id: sectionId } = await createSection(admin, {
      title: { nb: `Kaskade ${Date.now()}` },
      bodyMarkdown: { nb: "# Bare norsk" },
    });
    const courseRes = await request(app)
      .post("/api/admin/content/courses")
      .set(admin)
      .send({ title: L(`Kaskadekurs ${Date.now()}`) });
    expect(courseRes.status).toBe(201);
    const courseId = courseRes.body.course.id as string;
    expect(
      (await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(admin).send({
        items: [{ type: "SECTION", sectionId }],
      })).status,
    ).toBe(204);

    const preview = await request(app).get(`/api/admin/content/courses/${courseId}/publish-preview`).set(admin);
    expect(preview.status).toBe(200);
    expect(preview.body.publishable).toBe(false);
    const item = (preview.body.unpublishedItems as Array<{ type: string; blockers: Array<{ code: string; field?: string; missingLocales?: string[] }> }>)
      .find((i) => i.type === "SECTION");
    expect(item?.blockers.some((b) => b.code === "translation_incomplete")).toBe(true);
    expect(item?.blockers.find((b) => b.field === "bodyMarkdown")?.missingLocales?.sort()).toEqual(["en-GB", "nn"]);

    // The confirmation step already reports the section as un-publishable …
    const confirm = await request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(admin).send({});
    expect(confirm.status).toBe(409);
    expect(confirm.body.publishable).toBe(false);

    // … and an author who confirms the cascade anyway is refused, not partially served.
    const cascade = await request(app)
      .post(`/api/admin/content/courses/${courseId}/publish`)
      .set(admin)
      .send({ publishItems: true });
    expect(cascade.status).toBe(422);
    expect(cascade.body.error).toBe("course_publish_blocked_by_items");
    // Nothing went live — not the section, not the course.
    expect((await prisma.courseSection.findUnique({ where: { id: sectionId } }))?.activeVersionId).toBeNull();
    expect((await prisma.course.findUnique({ where: { id: courseId } }))?.publishedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// QA før prod, 2026-08-18. Ingen av testene over dekket KURSIMPORT-stien, og det var der den
// verste konsekvensen lå.
//
// #916 la publiseringsgaten i `createSection`: `heldBackByTranslationGate = !input.draft &&
// !gate.ok`. Den frittstående importen sender `draft: true`, men kursimporten sendte ingenting —
// så en seksjon med ettspråks tittel ble korrekt holdt tilbake, mens kalleren aldri fikk vite det.
// `anyModuleHeldBack` telte bare moduler, så kurset ble publisert rundt en seksjon uten aktiv
// versjon.
//
// Resultatet for deltakeren: 200 med tom `html` — en blank side, ingen feilmelding — og
// `POST .../read` telte den fortsatt mot kursbeviset.
// ---------------------------------------------------------------------------
describe("#916 QA: course import must not publish around a held-back section", () => {
  function courseEnvelopeWithSection(courseTitle: string, sectionTitle: unknown, body: unknown) {
    return {
      exportFormat: "a2-content-export/v1",
      exportedAt: "2026-08-18T00:00:00.000Z",
      scope: "course",
      course: {
        course: {
          title: L(courseTitle),
          description: L("d"),
          certificationLevel: "foundation",
          // The source environment had this course published — that is what makes the importer
          // republish it, and what made the bug reachable.
          audit: { publishedAt: "2026-08-01T00:00:00.000Z" },
          // ⚠️ Kurset MÅ ha en modul. Uten en er publisering avvist med «Cannot publish a course
          // with no modules», og da hadde blokkertesten under bestått av helt feil grunn — den
          // ville målt en regel som ikke har noe med seksjoner å gjøre. Kontrollcasen avslørte det.
          items: [
            {
              type: "MODULE",
              sortOrder: 0,
              module: {
                module: { title: L("QA modul"), description: L("d"), certificationLevel: "foundation" },
                activeVersion: {
                  assessmentMode: "FREETEXT_ONLY",
                  taskText: L("Gjør oppgaven"),
                  assessorExpectedContent: L("Forventet"),
                  rubric: { criteria: { c1: 1 }, scalingRule: { practical_weight: 70 } },
                  promptTemplate: { systemPrompt: L("system"), userPromptTemplate: L("mal"), examples: [] },
                  audit: { publishedAt: "2026-08-01T00:00:00.000Z", versionNo: 1 },
                },
              },
            },
            { type: "SECTION", sortOrder: 1, section: { title: sectionTitle, bodyMarkdown: body } },
          ],
        },
      },
    };
  }

  it("leaves the course unpublished when an imported section has a language hole", async () => {
    const title = `QA blank section ${Date.now()}`;
    const response = await request(app)
      .post("/api/admin/content/courses/import")
      .set(admin)
      // A one-language title — the ordinary shape of content written before the gate existed, and
      // exactly what an export of an older course carries.
      .send({ mode: "createNew", payload: courseEnvelopeWithSection(title, "Kapittel 1", L("Full body")) });

    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const course = await prisma.course.findFirst({ where: { title: { contains: title } } });
    expect(course).toBeTruthy();

    const item = await prisma.courseItem.findFirst({ where: { courseId: course!.id, sectionId: { not: null } }, select: { sectionId: true } });
    const section = await prisma.courseSection.findUnique({ where: { id: item!.sectionId! } });

    // The section is held back — that part was already right.
    expect(section?.activeVersionId).toBeNull();
    // …and the course must NOT be published around it. This is the half that was missing: a
    // published course with a section that has no active version serves a blank page.
    expect(course?.publishedAt).toBeNull();
  });

  it("still republishes an imported course when every section is complete", async () => {
    const title = `QA complete section ${Date.now()}`;
    const response = await request(app)
      .post("/api/admin/content/courses/import")
      .set(admin)
      .send({ mode: "createNew", payload: courseEnvelopeWithSection(title, L("Kapittel 1"), L("Full body")) });

    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const course = await prisma.course.findFirst({ where: { title: { contains: title } } });
    const item = await prisma.courseItem.findFirst({ where: { courseId: course!.id, sectionId: { not: null } }, select: { sectionId: true } });
    const section = await prisma.courseSection.findUnique({ where: { id: item!.sectionId! } });

    // The guard must not swing the other way: a complete section still goes live, and so does the
    // course. A gate that blocks everything is as useless as one that blocks nothing.
    expect(section?.activeVersionId).not.toBeNull();
    expect(course?.publishedAt).not.toBeNull();
  });

  // ————————————————————————————————————————————————————————————————————————————————————————
  // #937: produkteier løftet én seksjon ut av en kurspakke og importerte fila. Den ble avvist med
  // rå Zod-utdata. Testene her dekket «konvolutt med FEIL scope», men ikke «fil som ikke er en
  // konvolutt i det hele tatt» — som er det en forfatter treffer først.
  // ————————————————————————————————————————————————————————————————————————————————————————

  it("#937: godtar en seksjon løftet ut av en kursfil — kurselementet, ikke bare payloaden", async () => {
    const stamp = Date.now();
    // NØYAKTIG formen produkteier hadde: kurselementet, ett nivå OVER konvolutten.
    const courseItem = {
      type: "SECTION",
      sortOrder: 18,
      section: {
        title: L(`Løftet ut ${stamp}`),
        bodyMarkdown: L("# Løftet\n\nInnholdet var aldri feil."),
        audit: {},
      },
    };

    const res = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOwner)
      .send({ payload: courseItem, mode: "createNew" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const imported = await prisma.courseSection.findUnique({ where: { id: res.body.sectionId } });
    expect(JSON.parse(imported!.title)).toEqual(L(`Løftet ut ${stamp}`));
    // Innpakket eller ei — importen skal fortsatt lande UPUBLISERT, som enhver annen import.
    expect(imported?.activeVersionId).toBeNull();
  });

  it("#937: godtar en bar seksjons-payload uten konvolutt", async () => {
    const stamp = Date.now();
    const bare = {
      title: L(`Bar payload ${stamp}`),
      bodyMarkdown: L("# Bar\n\nUten konvolutt."),
      audit: {},
    };

    const res = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOwner)
      .send({ payload: bare, mode: "createNew" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const imported = await prisma.courseSection.findUnique({ where: { id: res.body.sectionId } });
    expect(JSON.parse(imported!.title)).toEqual(L(`Bar payload ${stamp}`));
  });

  it("#937: en fil som ikke er en seksjon i det hele tatt gir en setning, ikke en Zod-dump", async () => {
    const res = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOwner)
      .send({ payload: { hva: "som helst", nested: { tull: true } }, mode: "createNew" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("not_an_export_envelope");

    // ⚠️ KODEN er kontrakten, ikke teksten. Konsollet er trespråklig og defaulter til en-GB, så
    // klienten slår opp `error` i sin egen LABELS-tabell og rendrer på forfatterens språk.
    // `message` er kun en engelsk reserve for API-konsumenter som ikke har en tabell.
    expect(res.body.message).toContain("Export");
    // Og den skal IKKE bære Zod-maskineriet som gjorde den opprinnelige meldingen ubrukelig.
    expect(res.body.issues).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("invalid_literal");
    expect(JSON.stringify(res.body)).not.toContain("invalid_union_discriminator");
  });

  // KONTROLLCASE. Uten disse vet vi ikke om vi målte toleransen eller bare slo av valideringen:
  // en «godta alt»-implementasjon ville bestått de tre over og strøket på begge under.

  it("#937 kontroll: en ekte konvolutt med FEIL exportFormat gir fortsatt formatfeilen", async () => {
    const res = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOwner)
      .send({
        payload: {
          exportFormat: "a2-content-export/v99",
          exportedAt: new Date().toISOString(),
          scope: "section",
          section: { title: L("S"), bodyMarkdown: L("# S"), audit: {} },
        },
        mode: "createNew",
      });

    // Den utga seg for å være en konvolutt, så den skal måles som en konvolutt — ikke pakkes inn
    // på nytt slik at forfatteren aldri får vite at formatversjonen er feil.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("#937 kontroll: et kurselement med UGYLDIG seksjonsinnhold avvises fortsatt", async () => {
    const res = await request(app)
      .post("/api/admin/content/sections/import")
      .set(smoOwner)
      .send({
        payload: { type: "SECTION", sortOrder: 0, section: { title: L("Bare tittel"), bodyMarkdown: 42 } },
        mode: "createNew",
      });

    // Innpakkingen avgjør FORMEN. Innholdet skal fortsatt gjennom skjemaet.
    expect(res.status).toBe(400);
    const created = await prisma.courseSection.findFirst({ where: { title: { contains: "Bare tittel" } } });
    expect(created).toBeNull();
  });

});
