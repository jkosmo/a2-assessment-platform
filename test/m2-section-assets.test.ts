import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { JSDOM } from "jsdom";
import { getAsset, putAsset } from "../src/modules/course/assetStorage.js";
import { repairUnreadableSvgAssets } from "../src/modules/course/assetCommands.js";

const adminHeaders = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};
const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-roles": "PARTICIPANT",
};

// 1x1 transparent PNG.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// #483/F4 — section asset upload + serve (filesystem fallback in CI; no Azure storage).
describe("Section asset upload + serve", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ⚠️ #993: fiksturen fylte tidligere bare `nb` og publiserte aldri. Seksjonen sto dermed med
  // `activeVersionId: null` — holdt tilbake av oversettelsesgaten — mens tre tester påsto at en
  // DELTAKER fikk `200` på figurene i den. Det var lekkasjen, kodet inn som forventet oppførsel.
  //
  // En seksjon en deltaker faktisk kan se er publisert, så det er den fiksturen skal lage.
  async function createSection(): Promise<string> {
    const stamp = Date.now();
    const three = (base: string) => ({ nb: `${base} nb`, nn: `${base} nn`, "en-GB": `${base} en` });
    const res = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      .send({ title: three(`Asset-seksjon ${stamp}`), bodyMarkdown: three("# Hei") });
    expect(res.status).toBe(201);
    const sectionId = res.body.section.id as string;

    const published = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/publish`)
      .set(adminHeaders);
    expect(published.status, `publisering feilet: ${JSON.stringify(published.body)}`).toBe(200);
    return sectionId;
  }

  // Sections can't be deleted while their version FK (Restrict) holds; detach + drop versions
  // first. Assets cascade with the section.
  async function deleteSectionFully(sectionId: string): Promise<void> {
    await prisma.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId } });
    await prisma.courseSection.delete({ where: { id: sectionId } });
  }

  // #778/#786: a participant may only fetch a section asset if the section is in a published course
  // they can access. Link an OPEN published course so the participant-serve cases stay realistic.
  async function linkSectionToOpenCourse(sectionId: string): Promise<string> {
    const course = await prisma.course.create({
      data: { title: `Asset course ${Date.now()}`, publishedAt: new Date() }, // enrollmentPolicy defaults OPEN
      select: { id: true },
    });
    await prisma.courseItem.create({ data: { courseId: course.id, itemType: "SECTION", sectionId, sortOrder: 0 } });
    return course.id;
  }
  // Delete the course first (cascades the CourseItem) so the section is no longer Restrict-referenced.
  async function deleteSectionAndCourse(sectionId: string, courseId: string): Promise<void> {
    await prisma.courseCompletion.deleteMany({ where: { courseId } });
    await prisma.course.delete({ where: { id: courseId } });
    await deleteSectionFully(sectionId);
  }

  it("uploads an image, lists it, and serves it back to a participant in an accessible course", async () => {
    const sectionId = await createSection();
    const courseId = await linkSectionToOpenCourse(sectionId);

    const upload = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", PNG_1PX, { filename: "pixel.png", contentType: "image/png" });
    expect(upload.status).toBe(201);
    const assetId = upload.body.asset.id as string;
    expect(upload.body.asset.ref).toBe(`asset:${assetId}`);

    const list = await request(app)
      .get(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders);
    expect(list.status).toBe(200);
    expect((list.body.assets as Array<{ id: string }>).some((a) => a.id === assetId)).toBe(true);

    // Served back (any authenticated content viewer, e.g. a participant).
    const served = await request(app)
      .get(`/api/content-assets/${assetId}`)
      .set(participantHeaders);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
    expect(served.body.length).toBe(PNG_1PX.length);

    await deleteSectionAndCourse(sectionId, courseId);
  });

  // #657: SVG is accepted but sanitised before storage; the served bytes must be inert and the
  // serve endpoint must add hardening headers.
  it("sanitises an uploaded SVG and serves it with hardening headers", async () => {
    const sectionId = await createSection();
    const courseId = await linkSectionToOpenCourse(sectionId);
    const dirtySvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><script>alert(1)</script><rect onload="x()" width="50" height="20"/><text x="2" y="12">Hei</text></svg>`,
      "utf8",
    );

    const upload = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", dirtySvg, { filename: "drawing.svg", contentType: "image/svg+xml" });
    expect(upload.status).toBe(201);
    const assetId = upload.body.asset.id as string;

    const served = await request(app)
      .get(`/api/content-assets/${assetId}`)
      .set(participantHeaders);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/svg+xml");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-security-policy"]).toContain("sandbox");
    const body = served.text ?? served.body.toString();
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/onload/i);
    expect(body).toMatch(/Hei/);

    await deleteSectionAndCourse(sectionId, courseId);
  });

  // #657: the explicit localize action generates a translated SVG variant per other locale; the
  // serve endpoint returns the variant for `?locale=`. LLM stub mode tags text as `[<locale>] …`.
  it("localises SVG text and serves the per-locale variant", async () => {
    const sectionId = await createSection();
    const courseId = await linkSectionToOpenCourse(sectionId);
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><text x="2" y="12">Start</text></svg>`,
      "utf8",
    );
    const upload = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", svg, { filename: "d.svg", contentType: "image/svg+xml" });
    const assetId = upload.body.asset.id as string;

    const localize = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets/localize`)
      .set(adminHeaders)
      .send({ sourceLocale: "nb" });
    expect(localize.status).toBe(200);
    expect(localize.body.localizedAssetCount).toBe(1);

    // #663: re-running with the same source locale must NOT re-translate the unchanged drawing.
    const localizeAgain = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets/localize`)
      .set(adminHeaders)
      .send({ sourceLocale: "nb" });
    expect(localizeAgain.status).toBe(200);
    expect(localizeAgain.body.localizedAssetCount).toBe(0);
    expect(localizeAgain.body.skippedAssetCount).toBe(1);

    // Source locale → original text; another locale → stub-translated text.
    const original = await request(app).get(`/api/content-assets/${assetId}?locale=nb`).set(participantHeaders);
    expect((original.text ?? original.body.toString())).toMatch(/>Start</);

    const english = await request(app).get(`/api/content-assets/${assetId}?locale=en-GB`).set(participantHeaders);
    expect((english.text ?? english.body.toString())).toMatch(/\[en-GB\] Start/);

    await deleteSectionAndCourse(sectionId, courseId);
  });

  // #1083: en figur med hardt mellomrom i en etikett ble lagret som noe nettleseren ikke kan lese.
  // Målt hele veien, fra opplasting til det deltakeren får servert.
  const lesesSomSvg = (svg: string) => {
    try {
      new JSDOM(svg, { contentType: "image/svg+xml" });
      return true;
    } catch {
      return false;
    }
  };
  const hentet = (res: { text?: string; body: Buffer }) => res.text ?? res.body.toString();

  it("#1083: en figur med hardt mellomrom vises for deltakeren — også som oversatt variant", async () => {
    const sectionId = await createSection();
    const courseId = await linkSectionToOpenCourse(sectionId);
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20" aria-label="a &lt; b"><text x="2" y="12">§ 12</text></svg>`,
      "utf8",
    );
    const upload = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", svg, { filename: "paragraf.svg", contentType: "image/svg+xml" });
    expect(upload.status).toBe(201);
    const assetId = upload.body.asset.id as string;

    const servert = hentet(await request(app).get(`/api/content-assets/${assetId}`).set(participantHeaders));
    expect(lesesSomSvg(servert)).toBe(true);
    expect(servert).toContain("§ 12");
    expect(servert).not.toContain("&nbsp;");

    // Varianten lages av applySvgTextTranslations, som renser på nytt: samme vei, samme krav.
    const localize = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets/localize`)
      .set(adminHeaders)
      .send({ sourceLocale: "nb" });
    expect(localize.body.localizedAssetCount).toBe(1);
    const engelsk = hentet(await request(app).get(`/api/content-assets/${assetId}?locale=en-GB`).set(participantHeaders));
    expect(lesesSomSvg(engelsk)).toBe(true);
    expect(engelsk).toContain(" 12");

    await deleteSectionAndCourse(sectionId, courseId);
  });

  // #1083: figurene som ALT ligger i lageret rettes ikke av at rensingen er rettet. Vedlikeholds-
  // kommandoen finner dem og skriver dem på nytt — til samme sti, så raden og referansene står.
  it("#1083: reparasjonen finner uleselige lagrede figurer, rører ingenting i tørrkjøring, og retter dem med apply", async () => {
    const sectionId = await createSection();
    const courseId = await linkSectionToOpenCourse(sectionId);
    const upload = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><text x="2" y="12">Start</text></svg>`, "utf8"), { filename: "gammel.svg", contentType: "image/svg+xml" });
    const assetId = upload.body.asset.id as string;
    // En frisk figur ved siden av: kontrollen på at reparasjonen ikke rører det som er helt.
    const frisk = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><text x="2" y="12">Frisk</text></svg>`, "utf8"), { filename: "frisk.svg", contentType: "image/svg+xml" });
    const friskId = frisk.body.asset.id as string;

    // Slik figuren ble lagret FØR rettingen: HTML-utskrift, med &nbsp; og en bar < i en attributt.
    const gammelGrunnfil = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20" aria-label="a < b"><text x="2" y="12">§&nbsp;12</text></svg>`;
    const gammelVariant = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><text x="2" y="12">Section&nbsp;12</text></svg>`;
    expect(lesesSomSvg(gammelGrunnfil)).toBe(false);
    const rad = await prisma.sectionAsset.findUniqueOrThrow({ where: { id: assetId }, select: { blobPath: true } });
    const variantSti = `sections/${sectionId}/gammel-en-GB.svg`;
    await putAsset(rad.blobPath, Buffer.from(gammelGrunnfil, "utf8"), "image/svg+xml");
    await putAsset(variantSti, Buffer.from(gammelVariant, "utf8"), "image/svg+xml");
    await prisma.sectionAsset.update({ where: { id: assetId }, data: { sourceLocale: "nb", localizedBlobPaths: { "en-GB": variantSti } } });

    const mine = <T extends { assetId: string }>(funn: T[]) => funn.filter((f) => f.assetId === assetId || f.assetId === friskId);

    // Tørrkjøring: begge filene meldes, ingenting skrives.
    const tørr = await repairUnreadableSvgAssets({ dryRun: true });
    expect(mine(tørr.unreadable).map((f) => [f.assetId, f.locale, f.repairable, f.repaired])).toEqual([
      [assetId, null, true, false],
      [assetId, "en-GB", true, false],
    ]);
    expect((await getAsset(rad.blobPath)).toString("utf8")).toBe(gammelGrunnfil);

    // Apply: begge skrives på nytt, til samme sti.
    const skrevet = await repairUnreadableSvgAssets({ dryRun: false });
    expect(mine(skrevet.unreadable).map((f) => [f.locale, f.repaired])).toEqual([[null, true], ["en-GB", true]]);

    const servert = hentet(await request(app).get(`/api/content-assets/${assetId}`).set(participantHeaders));
    expect(lesesSomSvg(servert)).toBe(true);
    expect(servert).toContain("§ 12");
    const engelsk = hentet(await request(app).get(`/api/content-assets/${assetId}?locale=en-GB`).set(participantHeaders));
    expect(lesesSomSvg(engelsk)).toBe(true);
    expect(engelsk).toContain("Section 12");
    // Størrelsen i raden følger det som faktisk ligger i lageret.
    const etter = await prisma.sectionAsset.findUniqueOrThrow({ where: { id: assetId }, select: { sizeBytes: true, blobPath: true } });
    expect(etter.blobPath).toBe(rad.blobPath);
    expect(etter.sizeBytes).toBe((await getAsset(rad.blobPath)).byteLength);

    // Idempotent: en ny kjøring finner ingenting igjen på disse figurene.
    expect(mine((await repairUnreadableSvgAssets({ dryRun: false })).unreadable)).toEqual([]);

    await deleteSectionAndCourse(sectionId, courseId);
  });

  it("rejects a disallowed mime type", async () => {
    const sectionId = await createSection();
    const res = await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", Buffer.from("hello"), { filename: "x.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    await deleteSectionFully(sectionId);
  });

  it("returns 404 for an unknown asset id", async () => {
    const res = await request(app).get("/api/content-assets/does-not-exist").set(participantHeaders);
    expect(res.status).toBe(404);
  });

  // #758: deleting a section must reclaim its stored blobs (base + localized variants), not just the
  // DB rows — otherwise the images accumulate in storage forever.
  it("reclaims asset blobs from storage when the section is deleted", async () => {
    const sectionId = await createSection();
    await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", PNG_1PX, { filename: "pixel.png", contentType: "image/png" });
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><text x="2" y="12">Start</text></svg>`,
      "utf8",
    );
    await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets`)
      .set(adminHeaders)
      .attach("file", svg, { filename: "d.svg", contentType: "image/svg+xml" });
    // Localize the SVG so at least one variant blob also exists.
    await request(app)
      .post(`/api/admin/content/sections/${sectionId}/assets/localize`)
      .set(adminHeaders)
      .send({ sourceLocale: "nb" });

    // Every stored blob path (base blobs + localized variants) — captured before deletion.
    const rows = await prisma.sectionAsset.findMany({ where: { sectionId }, select: { blobPath: true, localizedBlobPaths: true } });
    const blobPaths = rows.flatMap((r) => [
      r.blobPath,
      ...Object.values((r.localizedBlobPaths as Record<string, string> | null) ?? {}),
    ]);
    expect(blobPaths.length).toBeGreaterThanOrEqual(3); // png + svg base + ≥1 variant
    for (const p of blobPaths) await expect(getAsset(p)).resolves.toBeInstanceOf(Buffer);

    // Delete via the real route (deleteSection → reclaimAssetBlobs).
    const del = await request(app).delete(`/api/admin/content/sections/${sectionId}`).set(adminHeaders);
    expect(del.status).toBe(204);

    // Rows cascaded AND blobs physically reclaimed.
    expect(await prisma.sectionAsset.count({ where: { sectionId } })).toBe(0);
    for (const p of blobPaths) await expect(getAsset(p)).rejects.toThrow();

    // #961: ruta må sende AKTØREN videre — et spor uten «hvem» svarer ikke på spørsmålet det
    // finnes for. Dette er den eneste testen som går gjennom HTTP-laget for sletting.
    const actor = await prisma.user.findUnique({
      where: { externalId: adminHeaders["x-user-id"] },
      select: { id: true },
    });
    const deleteEvents = await prisma.auditEvent.findMany({
      where: { entityType: "course_section", entityId: sectionId, action: "section_deleted" },
    });
    expect(deleteEvents).toHaveLength(1);
    expect(deleteEvents[0].actorId).toBe(actor?.id);
  });
});
