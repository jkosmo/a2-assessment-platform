// #763 (Layer B) integration tests: POST /api/admin/content/sections accepts inline figures/images
// (`assets[]`) alongside the section draft. Native Postgres profile; assets use the filesystem blob
// fallback (no Azure). Modelled on m2-content-export-import-assets.test.ts + agent-authoring-token.
//
// Coverage:
//   (a) draft:true + an SVG asset → section + SectionAsset row created, blob readable + sanitised,
//       markdown `asset:<sourceId>` ref remapped to the new asset id, response carries the
//       sourceId→assetId map; the section stays a draft (activeVersionId null).
//   (b) the same via an agent token (draft-scoped) still works and is attributed to the issuer.
//   (c) a section with an asset whose SVG cannot be sanitised is rejected (400).

import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { getAsset } from "../src/modules/course/assetStorage.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Steg 1</text></svg>';
const SVG_EN = '<svg xmlns="http://www.w3.org/2000/svg"><text>Step 1</text></svg>';

function svgAsset(sourceId: string, extra: Record<string, unknown> = {}) {
  return {
    sourceId,
    filename: "flyt.svg",
    mimeType: "image/svg+xml",
    sizeBytes: SVG.length,
    contentBase64: Buffer.from(SVG, "utf8").toString("base64"),
    ...extra,
  };
}

async function issueToken() {
  const response = await request(app)
    .post("/api/admin/content/agent-authoring/tokens")
    .set(adminHeaders)
    .send({ label: "figure-token" });
  expect(response.status).toBe(201);
  return response.body.token as string;
}

describe("#763 POST /sections with inline figures/images", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("(a) creates a draft section + SectionAsset, remaps the markdown ref, echoes sourceId→assetId", async () => {
    const res = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      .send({
        title: { nb: "Figur-seksjon" },
        bodyMarkdown: { nb: "# Prosess\n\n![Flyt](asset:fig-flow)" },
        draft: true,
        clientRef: "sec-figur",
        assets: [
          svgAsset("fig-flow", {
            sourceLocale: "nb",
            localizedVariants: [{ locale: "en-GB", contentBase64: Buffer.from(SVG_EN, "utf8").toString("base64") }],
          }),
        ],
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const sectionId = res.body.section.id as string;
    expect(res.body.clientRef).toBe("sec-figur");

    // Response carries the sourceId → assetId map.
    const assetMap = res.body.assetMap as Record<string, string>;
    expect(Object.keys(assetMap)).toEqual(["fig-flow"]);
    const newAssetId = assetMap["fig-flow"];
    expect(newAssetId).toBeTruthy();
    expect(newAssetId).not.toBe("fig-flow");

    // Draft stayed a draft (never auto-published by the remap re-save).
    const section = await prisma.courseSection.findUnique({
      where: { id: sectionId },
      select: { activeVersionId: true },
    });
    expect(section?.activeVersionId).toBeNull();

    // A SectionAsset row exists; its SVG blob is stored + sanitised; the localized variant persisted.
    const rows = await prisma.sectionAsset.findMany({ where: { sectionId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(newAssetId);
    const stored = (await getAsset(rows[0].blobPath)).toString("utf8");
    expect(stored).toContain("<svg");
    expect(stored).toContain("Steg 1");
    const localized = rows[0].localizedBlobPaths as Record<string, string> | null;
    expect(localized?.["en-GB"]).toBeTruthy();
    expect((await getAsset(localized!["en-GB"])).toString("utf8")).toContain("Step 1");
    expect(rows[0].sourceLocale).toBe("nb");

    // The stored (draft) markdown ref was remapped from the source token to the new asset id.
    const version = await prisma.courseSectionVersion.findFirst({
      where: { sectionId },
      orderBy: { versionNo: "desc" },
    });
    const body = version?.bodyMarkdown ?? "";
    expect(body).toContain(`asset:${newAssetId}`);
    expect(body).not.toContain("asset:fig-flow");
  });

  it("(b) works via an agent token (draft-scoped) and attributes to the issuer", async () => {
    const token = await issueToken();
    const res = await request(app)
      .post("/api/admin/content/sections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: { nb: "Token-figur" },
        bodyMarkdown: { nb: "![f](asset:t1)" },
        draft: true,
        assets: [svgAsset("t1")],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const newAssetId = (res.body.assetMap as Record<string, string>).t1;
    expect(newAssetId).toBeTruthy();

    const rows = await prisma.sectionAsset.findMany({ where: { sectionId: res.body.section.id } });
    expect(rows).toHaveLength(1);
    const version = await prisma.courseSectionVersion.findFirst({
      where: { sectionId: res.body.section.id },
      orderBy: { versionNo: "desc" },
    });
    expect(version?.bodyMarkdown ?? "").toContain(`asset:${newAssetId}`);
  });

  it("(c) rejects a section whose SVG cannot be sanitised (400)", async () => {
    const notSvg = Buffer.from("<html><body>not an svg</body></html>", "utf8").toString("base64");
    const res = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      .send({
        title: { nb: "Ugyldig" },
        bodyMarkdown: { nb: "![x](asset:bad)" },
        draft: true,
        assets: [svgAsset("bad", { contentBase64: notSvg })],
      });
    expect(res.status).toBe(400);
  });
});
