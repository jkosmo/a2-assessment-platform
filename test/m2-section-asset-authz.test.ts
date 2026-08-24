import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #778/#786: a section asset must not be readable by just any authenticated user. Access is granted
// only when the asset's section belongs to a published course the participant can access; authors
// (SMO/ADMIN) bypass so they can preview assets in unpublished/draft sections.

const adminHeaders = {
  "x-user-id": "asset-authz-admin",
  "x-user-email": "asset-authz-admin@company.com",
  "x-user-name": "Asset Authz Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function participant(externalId: string) {
  return {
    "x-user-id": externalId,
    "x-user-email": `${externalId}@x.test`,
    "x-user-name": externalId,
    "x-user-roles": "PARTICIPANT",
  };
}

async function makeUser(tag: string) {
  const ext = `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { externalId: ext, name: tag, email: `${ext}@x.test` },
    select: { id: true, externalId: true },
  });
}

// Create a section + a real (blob-backed) PNG asset via the admin API.
//
// ⚠️ #993: fiksturen fylte tidligere BARE `nb`, og publiserte aldri. Resultatet var en seksjon med
// `activeVersionId: null` — altså holdt tilbake av oversettelsesgaten — og testen under påsto at en
// deltaker fikk `200` på figuren i den. Fiksturen kodet inn nøyaktig lekkasjen saken handler om.
//
// Nå fylles alle tre språk og seksjonen publiseres, slik en seksjon en deltaker faktisk kan se ser
// ut. `available: false`-tilfellene testes eksplisitt lenger ned i stedet for å snike seg inn som
// en utilsiktet standardtilstand.
async function makeSectionWithAsset(
  options: { publish?: boolean } = {},
): Promise<{ sectionId: string; assetId: string }> {
  const stamp = Date.now();
  const three = (base: string) => ({ nb: `${base} nb`, nn: `${base} nn`, "en-GB": `${base} en` });
  const secRes = await request(app)
    .post("/api/admin/content/sections")
    .set(adminHeaders)
    .send({ title: three(`authz-asset ${stamp}`), bodyMarkdown: three("# x") });
  expect(secRes.status).toBe(201);
  const sectionId = secRes.body.section.id as string;

  if (options.publish !== false) {
    const published = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/publish`)
      .set(adminHeaders);
    expect(published.status, `publisering feilet: ${JSON.stringify(published.body)}`).toBe(200);
  }
  const upload = await request(app)
    .post(`/api/admin/content/sections/${sectionId}/assets`)
    .set(adminHeaders)
    .attach("file", PNG_1PX, { filename: "pixel.png", contentType: "image/png" });
  expect(upload.status).toBe(201);
  return { sectionId, assetId: upload.body.asset.id as string };
}

async function linkToCourse(sectionId: string, enrollmentPolicy: "OPEN" | "RESTRICTED"): Promise<string> {
  const course = await prisma.course.create({
    data: { title: `Asset authz ${enrollmentPolicy} ${Date.now()}`, publishedAt: new Date(), enrollmentPolicy },
    select: { id: true },
  });
  await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId, sortOrder: 0 } });
  return course.id;
}

async function cleanup(sectionId: string, courseId?: string) {
  if (courseId) {
    await prisma.courseEnrollment.deleteMany({ where: { courseId } });
    await prisma.course.delete({ where: { id: courseId } }); // cascades CourseItem
  }
  await prisma.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
  await prisma.courseSectionVersion.deleteMany({ where: { sectionId } });
  await prisma.courseSection.delete({ where: { id: sectionId } }); // cascades SectionAsset
}

describe("Section asset object-level authorization (#786)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("denies a participant not enrolled in the asset's RESTRICTED course (404)", async () => {
    const { sectionId, assetId } = await makeSectionWithAsset();
    const courseId = await linkToCourse(sectionId, "RESTRICTED");
    const outsider = await makeUser("asset-outsider");

    const res = await request(app).get(`/api/content-assets/${assetId}`).set(participant(outsider.externalId));
    expect(res.status).toBe(404);

    await cleanup(sectionId, courseId);
  });

  it("allows a participant enrolled in the asset's RESTRICTED course (200)", async () => {
    const { sectionId, assetId } = await makeSectionWithAsset();
    const courseId = await linkToCourse(sectionId, "RESTRICTED");
    const enrolled = await makeUser("asset-enrolled");
    await prisma.courseEnrollment.create({
      data: { courseId, userId: enrolled.id, source: "INDIVIDUAL", assignedAt: new Date() },
    });

    const res = await request(app).get(`/api/content-assets/${assetId}`).set(participant(enrolled.externalId));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");

    await cleanup(sectionId, courseId);
  });

  it("lets an author (ADMINISTRATOR) preview an asset whose section is in NO course (draft)", async () => {
    const { sectionId, assetId } = await makeSectionWithAsset();

    // No course link at all → a participant would be denied, but the author bypass applies.
    const denied = await makeUser("asset-draft-participant");
    const p = await request(app).get(`/api/content-assets/${assetId}`).set(participant(denied.externalId));
    expect(p.status).toBe(404);

    const author = await request(app).get(`/api/content-assets/${assetId}`).set(adminHeaders);
    expect(author.status).toBe(200);
    expect(author.headers["content-type"]).toContain("image/png");

    await cleanup(sectionId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #993 — #944 sin TREDJE dør.
//
// De to første ble lukket ved å filtrere en utilgjengelig seksjon ut av deltakerens sekvens og av
// lesestien. En figur henger under seksjonen, men har sin egen rute — og den arvet ingenting.
//
// ⚠️ Scenariet er ikke hypotetisk: en deltaker som HAR lest seksjonen har allerede sett
// `asset:`-id-en i markdown-en. Etter at seksjonen arkiveres eller holdes tilbake svarer lesestien
// 404, mens asset-ruta svarte 200 — fordi den bare spurte om KURSET var synlig.
//
// Hver blokkering har en makker som bekrefter at det riktige fortsatt slipper gjennom. Uten den
// vet vi ikke om vi målte den nye regelen eller bare knakk ruta.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("#993 en figur arves ikke av en seksjon deltakeren ikke kan lese", () => {
  it("KONTROLL: en publisert seksjon i et OPEN kurs serverer figuren", async () => {
    const { sectionId, assetId } = await makeSectionWithAsset();
    const courseId = await linkToCourse(sectionId, "OPEN");
    const reader = await makeUser("asset-993-control");

    const res = await request(app).get(`/api/content-assets/${assetId}`).set(participant(reader.externalId));
    expect(res.status, "en tilgjengelig seksjon skal fortsatt servere figuren").toBe(200);

    await cleanup(sectionId, courseId);
  });

  it("en ARKIVERT seksjon serverer den ikke lenger — heller ikke til den som leste den før", async () => {
    const { sectionId, assetId } = await makeSectionWithAsset();
    const courseId = await linkToCourse(sectionId, "OPEN");
    const reader = await makeUser("asset-993-archived");

    // Deltakeren rekker å lese seksjonen, og har dermed sett asset-id-en.
    const before = await request(app).get(`/api/content-assets/${assetId}`).set(participant(reader.externalId));
    expect(before.status, "forutsetningen: figuren var lesbar før arkiveringen").toBe(200);

    await prisma.courseSection.update({ where: { id: sectionId }, data: { archivedAt: new Date() } });

    const after = await request(app).get(`/api/content-assets/${assetId}`).set(participant(reader.externalId));
    expect(after.status, "arkivert seksjon skal ikke lenger servere figuren").toBe(404);

    await prisma.courseSection.update({ where: { id: sectionId }, data: { archivedAt: null } });
    await cleanup(sectionId, courseId);
  });

  it("en seksjon HOLDT TILBAKE av oversettelsesgaten serverer den ikke", async () => {
    const { sectionId, assetId } = await makeSectionWithAsset();
    const courseId = await linkToCourse(sectionId, "OPEN");
    const reader = await makeUser("asset-993-heldback");

    // Avpublisering: versjonen finnes, men ingen er aktiv — samme tilstand gaten etterlater.
    await prisma.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });

    const res = await request(app).get(`/api/content-assets/${assetId}`).set(participant(reader.externalId));
    expect(res.status, "tilbakeholdt seksjon skal ikke servere figuren").toBe(404);

    await cleanup(sectionId, courseId);
  });

  it("forfatteren kan fortsatt forhåndsvise figuren i en arkivert seksjon", async () => {
    // ⚠️ Kontrollcase for omgåelsen: innstrammingen skal ramme deltakere, ikke forfattere. En
    // SMO som rydder i arkivert innhold må fortsatt kunne se hva som ligger der.
    const { sectionId, assetId } = await makeSectionWithAsset();
    const courseId = await linkToCourse(sectionId, "OPEN");
    await prisma.courseSection.update({ where: { id: sectionId }, data: { archivedAt: new Date() } });

    const author = await request(app).get(`/api/content-assets/${assetId}`).set(adminHeaders);
    expect(author.status, "forfatterens omgåelse skal være uendret").toBe(200);

    await prisma.courseSection.update({ where: { id: sectionId }, data: { archivedAt: null } });
    await cleanup(sectionId, courseId);
  });
});
