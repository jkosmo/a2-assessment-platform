// #749 (Layer A) integration tests: section figures/images (SectionAsset) carried through
// export AND import, so figures survive a round-trip. Native Postgres profile; assets use the
// filesystem blob fallback (no Azure). Modelled on m2-content-export-import.test.ts.
//
// Coverage:
//   (a) round-trip a section with a raster asset AND an SVG asset with a localized variant →
//       export → re-import → SectionAsset rows + blobs recreated, bodyMarkdown refs remapped to
//       new ids, localized variant preserved.
//   (b) an SVG with active content (script/onload) is sanitised on import.
//   (c) a disallowed mime and an oversized asset are rejected on import.
//   (d) a total envelope over 25 MB is rejected on export.
//   (e) an old asset-less v1 file imports unchanged (no SectionAsset rows).

import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { createSectionAsset, MAX_ASSET_BYTES } from "../src/modules/course/assetCommands.js";
import { updateSectionContent } from "../src/modules/course/sectionCommands.js";
import { putAsset, getAsset } from "../src/modules/course/assetStorage.js";
import { renderSectionMarkdown } from "../src/modules/course/sectionContent.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

const SVG_BASE = '<svg xmlns="http://www.w3.org/2000/svg"><text>Hei</text></svg>';
const SVG_EN = '<svg xmlns="http://www.w3.org/2000/svg"><text>Hi</text></svg>';
// Minimal 1x1 PNG (valid signature + IHDR-ish header; contents irrelevant for a raster blob).
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function createCourseWithSection(bodyMarkdownJson: string): Promise<{ courseId: string; sectionId: string }> {
  const sectionRes = await request(app)
    .post("/api/admin/content/sections")
    .set(adminHeaders)
    .send({ title: { nb: "Figur-seksjon" }, bodyMarkdown: { nb: "midlertidig" } });
  expect(sectionRes.status).toBe(201);
  const sectionId = sectionRes.body.section.id as string;
  // Store the markdown (with asset refs) directly to control the exact serialized value.
  await updateSectionContent(sectionId, bodyMarkdownJson, "admin-1");

  const courseRes = await request(app)
    .post("/api/admin/content/courses")
    .set(adminHeaders)
    .send({ title: { "en-GB": `Course ${Date.now()}`, nb: "Kurs", nn: "Kurs" } });
  expect(courseRes.status).toBe(201);
  const courseId = courseRes.body.course.id as string;

  const itemsRes = await request(app)
    .put(`/api/admin/content/courses/${courseId}/items`)
    .set(adminHeaders)
    .send({ items: [{ type: "SECTION", sectionId }] });
  expect(itemsRes.status).toBe(204);
  return { courseId, sectionId };
}

async function newSectionIdOf(courseId: string): Promise<string> {
  const itemsRes = await request(app).get(`/api/admin/content/courses/${courseId}/items`).set(adminHeaders);
  expect(itemsRes.status).toBe(200);
  const section = (itemsRes.body.items as Array<{ type: string; sectionId?: string }>).find((i) => i.type === "SECTION");
  expect(section?.sectionId).toBeTruthy();
  return section!.sectionId as string;
}

describe("#749 section-asset export/import round-trip", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("(a) round-trips a raster + an SVG-with-localized-variant, recreating blobs and remapping refs", async () => {
    // Section markdown references both assets by their source ids.
    const { courseId, sectionId } = await createCourseWithSection(JSON.stringify({ nb: "placeholder" }));

    const png = await createSectionAsset({ sectionId, filename: "diagram.png", mimeType: "image/png", buffer: PNG_BYTES });
    const svg = await createSectionAsset({ sectionId, filename: "flyt.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG_BASE, "utf8") });

    // Attach a localized SVG variant (as #657 would) directly, so the round-trip carries it.
    const variantPath = `sections/${sectionId}/variant-en-${svg.id}.svg`;
    await putAsset(variantPath, Buffer.from(SVG_EN, "utf8"), "image/svg+xml");
    await prisma.sectionAsset.update({
      where: { id: svg.id },
      data: { sourceLocale: "nb", localizedBlobPaths: { "en-GB": variantPath } },
    });

    const markdown = JSON.stringify({ nb: `# Figurer\n\n![Flyt](asset:${svg.id})\n\n![Diagram](asset:${png.id})` });
    await updateSectionContent(sectionId, markdown, "admin-1");

    // Export — the envelope must carry both assets inline.
    const exportRes = await request(app).get(`/api/admin/content/courses/${courseId}/export-package`).set(adminHeaders);
    expect(exportRes.status, JSON.stringify(exportRes.body)).toBe(200);
    const items = exportRes.body.envelope.course.course.items as Array<{ type: string; section?: { assets?: unknown[] } }>;
    const exportedAssets = (items.find((i) => i.type === "SECTION")?.section?.assets ?? []) as Array<{
      sourceId: string;
      mimeType: string;
      contentBase64: string;
      sourceLocale?: string | null;
      localizedVariants?: Array<{ locale: string; contentBase64: string }>;
    }>;
    expect(exportedAssets).toHaveLength(2);
    const exportedSvg = exportedAssets.find((a) => a.mimeType === "image/svg+xml")!;
    expect(exportedSvg.sourceId).toBe(svg.id);
    expect(exportedSvg.sourceLocale).toBe("nb");
    expect(exportedSvg.localizedVariants).toHaveLength(1);
    expect(exportedSvg.localizedVariants![0].locale).toBe("en-GB");
    expect(Buffer.from(exportedSvg.localizedVariants![0].contentBase64, "base64").toString("utf8")).toContain("Hi");

    // Import as a new course.
    const importRes = await request(app)
      .post("/api/admin/content/courses/import")
      .set(adminHeaders)
      .send({ payload: exportRes.body.envelope, mode: "createNew" });
    expect(importRes.status, JSON.stringify(importRes.body)).toBe(201);
    const newCourseId = importRes.body.courseId as string;
    expect(newCourseId).not.toBe(courseId);

    const newSectionId = await newSectionIdOf(newCourseId);
    expect(newSectionId).not.toBe(sectionId);

    const newAssets = await prisma.sectionAsset.findMany({ where: { sectionId: newSectionId }, orderBy: { createdAt: "asc" } });
    expect(newAssets).toHaveLength(2);
    const newPng = newAssets.find((a) => a.mimeType === "image/png")!;
    const newSvg = newAssets.find((a) => a.mimeType === "image/svg+xml")!;
    expect(newPng.id).not.toBe(png.id);
    expect(newSvg.id).not.toBe(svg.id);

    // Blobs recreated and readable.
    const pngBlob = await getAsset(newPng.blobPath);
    expect(pngBlob.byteLength).toBe(PNG_BYTES.byteLength);
    const svgBlob = (await getAsset(newSvg.blobPath)).toString("utf8");
    expect(svgBlob).toContain("Hei");

    // Localized variant preserved under a fresh path.
    const localized = newSvg.localizedBlobPaths as Record<string, string> | null;
    expect(localized?.["en-GB"]).toBeTruthy();
    expect(localized!["en-GB"]).not.toBe(variantPath);
    expect((await getAsset(localized!["en-GB"])).toString("utf8")).toContain("Hi");
    expect(newSvg.sourceLocale).toBe("nb");

    // bodyMarkdown refs remapped to the NEW ids; source ids no longer present.
    const newSection = await prisma.courseSection.findUnique({ where: { id: newSectionId }, include: { activeVersion: true } });
    const newBody = newSection?.activeVersion?.bodyMarkdown ?? "";
    expect(newBody).toContain(`asset:${newSvg.id}`);
    expect(newBody).toContain(`asset:${newPng.id}`);
    expect(newBody).not.toContain(`asset:${svg.id}`);
    expect(newBody).not.toContain(`asset:${png.id}`);
  });

  it("(b) sanitises an SVG with active content (script/onload) on import", async () => {
    const evilSvg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text onload="alert(2)">Hei</text></svg>';
    const envelope = {
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      scope: "course",
      course: {
        course: {
          title: { "en-GB": `Evil ${Date.now()}`, nb: "Ond", nn: "Ond" },
          certificationLevel: null,
          audit: {},
          items: [
            {
              type: "SECTION",
              sortOrder: 0,
              section: {
                title: { nb: "Ond seksjon" },
                bodyMarkdown: { nb: "![x](asset:evil1)" },
                audit: {},
                assets: [
                  {
                    sourceId: "evil1",
                    filename: "evil.svg",
                    mimeType: "image/svg+xml",
                    sizeBytes: evilSvg.length,
                    contentBase64: Buffer.from(evilSvg, "utf8").toString("base64"),
                  },
                ],
              },
            },
          ],
        },
      },
    };

    const importRes = await request(app)
      .post("/api/admin/content/courses/import")
      .set(adminHeaders)
      .send({ payload: envelope, mode: "createNew" });
    expect(importRes.status, JSON.stringify(importRes.body)).toBe(201);

    const newSectionId = await newSectionIdOf(importRes.body.courseId);
    const rows = await prisma.sectionAsset.findMany({ where: { sectionId: newSectionId } });
    expect(rows).toHaveLength(1);
    const stored = (await getAsset(rows[0].blobPath)).toString("utf8");
    expect(stored).toContain("<svg");
    expect(stored).toContain("Hei");
    expect(stored.toLowerCase()).not.toContain("<script");
    expect(stored.toLowerCase()).not.toContain("onload");
  });

  it("(c) rejects a disallowed mime and an oversized asset on import", async () => {
    const baseEnvelope = (asset: Record<string, unknown>) => ({
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      scope: "course",
      course: {
        course: {
          title: { "en-GB": `Bad ${Date.now()}`, nb: "Feil", nn: "Feil" },
          certificationLevel: null,
          audit: {},
          items: [
            {
              type: "SECTION",
              sortOrder: 0,
              section: { title: { nb: "S" }, bodyMarkdown: { nb: "![x](asset:a1)" }, audit: {}, assets: [asset] },
            },
          ],
        },
      },
    });

    const disallowed = await request(app)
      .post("/api/admin/content/courses/import")
      .set(adminHeaders)
      .send({
        payload: baseEnvelope({
          sourceId: "a1",
          filename: "doc.tiff",
          mimeType: "image/tiff",
          sizeBytes: 10,
          contentBase64: Buffer.from("not-an-image", "utf8").toString("base64"),
        }),
        mode: "createNew",
      });
    expect(disallowed.status).toBe(400);
    expect(disallowed.body.error).toBe("validation_error");

    const oversizedBuffer = Buffer.alloc(MAX_ASSET_BYTES + 1, 0x41);
    const oversized = await request(app)
      .post("/api/admin/content/courses/import")
      .set(adminHeaders)
      .send({
        payload: baseEnvelope({
          sourceId: "a1",
          filename: "huge.png",
          mimeType: "image/png",
          sizeBytes: oversizedBuffer.byteLength,
          contentBase64: oversizedBuffer.toString("base64"),
        }),
        mode: "createNew",
      });
    expect(oversized.status).toBe(400);
    expect(oversized.body.error).toBe("validation_error");
  });

  it("(d) rejects a total envelope over the 25 MB asset cap on export", async () => {
    const { courseId, sectionId } = await createCourseWithSection(JSON.stringify({ nb: "over-cap" }));
    // 6 x ~4.5 MB = ~27 MB > 25 MB total cap (each under the 5 MB per-asset limit).
    const chunk = Buffer.alloc(Math.floor(4.5 * 1024 * 1024), 0x42);
    for (let i = 0; i < 6; i += 1) {
      await createSectionAsset({ sectionId, filename: `big-${i}.png`, mimeType: "image/png", buffer: chunk });
    }

    const exportRes = await request(app).get(`/api/admin/content/courses/${courseId}/export-package`).set(adminHeaders);
    expect(exportRes.status).toBe(400);
    expect(exportRes.body.error).toBe("validation_error");
    expect(String(exportRes.body.message)).toMatch(/cap/i);
  });

  it("(f) #754 remaps refs whose sourceId contains hyphens/underscores (agent fallback files)", async () => {
    // An agent (e.g. ChatGPT via the skill) invents sourceIds like `fig-styringslogikker`
    // ([a-zA-Z0-9_-]{1,64}). The import-time remap must rewrite the WHOLE ref, not stop at the
    // first hyphen — otherwise the ref keeps pointing at the source token and the figure breaks.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Styringslogikker</text></svg>';
    const envelope = {
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      scope: "course",
      course: {
        course: {
          title: { "en-GB": `Hyphen ${Date.now()}`, nb: "Bindestrek", nn: "Bindestrek" },
          certificationLevel: null,
          audit: {},
          items: [
            {
              type: "SECTION",
              sortOrder: 0,
              section: {
                title: { nb: "Figur-seksjon" },
                bodyMarkdown: { nb: "# Styring\n\n![Tre logikker](asset:fig-styringslogikker)\n\n![Flyt](asset:fig_nytte-2)" },
                audit: {},
                assets: [
                  { sourceId: "fig-styringslogikker", filename: "a.svg", mimeType: "image/svg+xml", sizeBytes: svg.length, contentBase64: Buffer.from(svg, "utf8").toString("base64") },
                  { sourceId: "fig_nytte-2", filename: "b.svg", mimeType: "image/svg+xml", sizeBytes: svg.length, contentBase64: Buffer.from(svg, "utf8").toString("base64") },
                ],
              },
            },
          ],
        },
      },
    };

    const importRes = await request(app)
      .post("/api/admin/content/courses/import")
      .set(adminHeaders)
      .send({ payload: envelope, mode: "createNew" });
    expect(importRes.status, JSON.stringify(importRes.body)).toBe(201);

    const newSectionId = await newSectionIdOf(importRes.body.courseId);
    const rows = await prisma.sectionAsset.findMany({ where: { sectionId: newSectionId }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);

    const section = await prisma.courseSection.findUnique({ where: { id: newSectionId }, include: { activeVersion: true } });
    const body = section?.activeVersion?.bodyMarkdown ?? "";
    // Every ref remapped to a real new asset id; no source token survives.
    for (const row of rows) expect(body).toContain(`asset:${row.id}`);
    expect(body).not.toContain("asset:fig-styringslogikker");
    expect(body).not.toContain("asset:fig_nytte-2");
    // The rendered HTML resolves each figure to the serve endpoint (no dangling asset: ref).
    const html = renderSectionMarkdown(JSON.parse(body).nb);
    expect(html).not.toContain('src="asset:');
    for (const row of rows) expect(html).toContain(`/api/content-assets/${row.id}`);
  });

  it("(e) imports an old asset-less v1 file unchanged (no SectionAsset rows)", async () => {
    const envelope = {
      exportFormat: "a2-content-export/v1",
      exportedAt: new Date().toISOString(),
      scope: "course",
      course: {
        course: {
          title: { "en-GB": `Plain ${Date.now()}`, nb: "Enkel", nn: "Enkel" },
          certificationLevel: null,
          audit: {},
          items: [
            {
              type: "SECTION",
              sortOrder: 0,
              // No `assets` key at all — the pre-#749 shape.
              section: { title: { nb: "Ren tekst" }, bodyMarkdown: { nb: "# Bare tekst" }, audit: {} },
            },
          ],
        },
      },
    };

    const importRes = await request(app)
      .post("/api/admin/content/courses/import")
      .set(adminHeaders)
      .send({ payload: envelope, mode: "createNew" });
    expect(importRes.status, JSON.stringify(importRes.body)).toBe(201);

    const newSectionId = await newSectionIdOf(importRes.body.courseId);
    const rows = await prisma.sectionAsset.findMany({ where: { sectionId: newSectionId } });
    expect(rows).toHaveLength(0);
    const section = await prisma.courseSection.findUnique({ where: { id: newSectionId }, include: { activeVersion: true } });
    expect(section?.activeVersion?.bodyMarkdown ?? "").toContain("Bare tekst");
  });
});
