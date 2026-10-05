// #1079: en figur i to oppsett — bredt (figuren selv) og smalt (for en smal spalte). Integrasjon mot
// ekte database og fillageret, hele veien: inn gjennom importen, ut til deltakeren, gjennom
// oversettelsen, ut i en eksport og inn igjen, og bort ved sletting.
//
// Det som måles, er at ALT som skriver eller leser en figur kjenner det smale oppsettet. Mangler
// ett sted, er figuren hel i det ene oppsettet og borte, uoversatt eller foreldreløs i det andre —
// og ingen av delene gir en feilmelding.

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { getAsset, putAsset } from "../src/modules/course/assetStorage.js";
import { chooseAssetFile, localizeSectionAssets, repairUnreadableSvgAssets } from "../src/modules/course/assetCommands.js";
import { extractSvgTexts } from "../src/modules/course/svgSanitizer.js";

const adminHeaders = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin" };
const participantHeaders = {
  "x-user-id": "participant-1",
  "x-user-email": "participant@company.com",
  "x-user-name": "Platform Participant",
  "x-user-roles": "PARTICIPANT",
};

// To tegninger av samme innhold. Det brede har alt på én rad, det smale på to — kjennetegnet her er
// bredden i viewBox, som er det testen leser for å vite hvilket oppsett den fikk.
const figur = (bredde: number, tekster: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bredde} 100">${tekster.map((t, i) => `<text x="10" y="${20 + i * 20}">${t}</text>`).join("")}</svg>`;
const BRED = figur(848, ["Motta", "Vurder", "Vedta"]);
const SMAL = figur(480, ["Motta", "Vurder", "Vedta"]);
const b64 = (svg: string) => Buffer.from(svg, "utf8").toString("base64");
const three = (base: string) => ({ nb: `${base} nb`, nn: `${base} nn`, "en-GB": `${base} en` });

type Layout = { layout: string; contentBase64: string; localizedVariants?: Array<{ locale: string; contentBase64: string }> };
const pakke = (asset: Record<string, unknown>) => ({
  exportFormat: "a2-content-export/v1",
  exportedAt: new Date().toISOString(),
  scope: "section",
  section: {
    title: three(`Oppsett ${Date.now()}`),
    bodyMarkdown: three("# Flyt\n\n![Saksgang](asset:flyt)"),
    assets: [{ sourceId: "flyt", filename: "flyt.svg", mimeType: "image/svg+xml", sizeBytes: BRED.length, contentBase64: b64(BRED), sourceLocale: "nb", ...asset }],
  },
});
const importer = (asset: Record<string, unknown>) =>
  request(app).post("/api/admin/content/sections/import").set(adminHeaders).send({ payload: pakke(asset), mode: "createNew" });

async function importerMedSmalt(ekstra: Partial<Layout> = {}): Promise<{ sectionId: string; assetId: string }> {
  const res = await importer({ layoutVariants: [{ layout: "narrow", contentBase64: b64(SMAL), ...ekstra }] });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const sectionId = res.body.sectionId as string;
  const asset = await prisma.sectionAsset.findFirstOrThrow({ where: { sectionId }, select: { id: true } });
  return { sectionId, assetId: asset.id };
}

const hent = (assetId: string, spørring = "", headers = adminHeaders) => request(app).get(`/api/content-assets/${assetId}${spørring}`).set(headers);
const tekst = (res: { text?: string; body: Buffer }) => res.text ?? res.body.toString();
const bredde = (res: { text?: string; body: Buffer }) => /viewBox="0 0 (\d+) /.exec(tekst(res))?.[1];

type Lagret = { blobPath: string; localizedBlobPaths: Record<string, string> | null; layoutVariants: { narrow?: { blobPath: string; localizedBlobPaths: Record<string, string> } } | null };
const lagret = async (assetId: string) =>
  (await prisma.sectionAsset.findUniqueOrThrow({ where: { id: assetId }, select: { blobPath: true, localizedBlobPaths: true, layoutVariants: true } })) as unknown as Lagret;

// Oversettelsesruta slipper gjennom ti kall i minuttet per bruker. Den er testens emne ÉN gang
// (første test under «oversettelse»); ellers kalles kommandoen bak den direkte. Med ruta overalt
// fikk det ellevte kallet 429, og en test som ikke sjekket svaret, gikk videre uten oversettelser.
const oversettFigurer = (sectionId: string, kilde: "nb" | "en-GB") => localizeSectionAssets(sectionId, kilde);

async function slett(sectionId: string): Promise<void> {
  await prisma.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
  await prisma.courseSectionVersion.deleteMany({ where: { sectionId } });
  await prisma.courseSection.delete({ where: { id: sectionId } });
}

describe("#1079 — en figur i bredt og smalt oppsett", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("importen lagrer det smale oppsettet ved siden av det brede, og leveringen gir det som blir bedt om", async () => {
    const { sectionId, assetId } = await importerMedSmalt();
    const rad = await lagret(assetId);
    expect(rad.layoutVariants?.narrow?.blobPath).toBeTruthy();
    expect(rad.layoutVariants?.narrow?.blobPath).not.toBe(rad.blobPath);

    const vanlig = await hent(assetId);
    expect(vanlig.status).toBe(200);
    expect(bredde(vanlig)).toBe("848");
    expect(vanlig.headers["x-asset-layout"]).toBe("wide");
    expect(vanlig.headers["x-asset-layouts"]).toBe("wide,narrow");

    const smal = await hent(assetId, "?layout=narrow");
    expect(bredde(smal)).toBe("480");
    expect(smal.headers["x-asset-layout"]).toBe("narrow");
    expect(smal.headers["x-asset-layouts"]).toBe("wide,narrow");
    // Samme herding som for den brede: det er en SVG som kan åpnes direkte.
    expect(smal.headers["content-security-policy"]).toContain("sandbox");
    expect(smal.headers["x-content-type-options"]).toBe("nosniff");

    // Et oppsett som ikke finnes, er det brede — ikke en feil.
    const ukjent = await hent(assetId, "?layout=diagonal");
    expect(ukjent.status).toBe(200);
    expect(bredde(ukjent)).toBe("848");
    expect(ukjent.headers["x-asset-layout"]).toBe("wide");

    await slett(sectionId);
  });

  it("#1088: ?locale=constructor gir figuren, ikke feil 500 — for begge oppsettene", async () => {
    const { sectionId, assetId } = await importerMedSmalt();
    for (const språk of ["constructor", "__proto__", "toString"]) {
      const bred = await hent(assetId, `?locale=${språk}`);
      expect(bred.status, `locale=${språk}`).toBe(200);
      expect(bredde(bred)).toBe("848");
      const smal = await hent(assetId, `?layout=narrow&locale=${språk}`);
      expect(smal.status, `layout=narrow&locale=${språk}`).toBe(200);
      expect(bredde(smal)).toBe("480");
    }
    await slett(sectionId);
  });

  it("kontroll: en figur uten smalt oppsett gir det brede også når det smale blir bedt om, og sier at den bare har ett", async () => {
    const res = await importer({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const sectionId = res.body.sectionId as string;
    const asset = await prisma.sectionAsset.findFirstOrThrow({ where: { sectionId }, select: { id: true, layoutVariants: true } });
    expect(asset.layoutVariants).toBeNull();

    const smal = await hent(asset.id, "?layout=narrow");
    expect(bredde(smal)).toBe("848");
    expect(smal.headers["x-asset-layout"]).toBe("wide");
    expect(smal.headers["x-asset-layouts"]).toBe("wide");
    await slett(sectionId);
  });

  it("det smale oppsettet renses som det brede: aktivt innhold fjernes før lagring", async () => {
    const skitten = SMAL.replace("<text", `<script>alert(1)</script><rect onload="x()" width="5" height="5"/><text`);
    const { sectionId, assetId } = await importerMedSmalt({ contentBase64: b64(skitten) });
    const smal = tekst(await hent(assetId, "?layout=narrow"));
    expect(smal).not.toMatch(/<script/i);
    expect(smal).not.toMatch(/onload/i);
    expect(smal).toContain("Motta");
    await slett(sectionId);
  });

  it("en deltaker får det smale oppsettet på samme vilkår som det brede — og ingen av dem uten tilgang", async () => {
    const { sectionId, assetId } = await importerMedSmalt();
    // Importert seksjon er et utkast: deltakeren har ikke tilgang, verken til det brede eller det smale.
    expect((await hent(assetId, "", participantHeaders)).status).toBe(404);
    expect((await hent(assetId, "?layout=narrow", participantHeaders)).status).toBe(404);

    const publisert = await request(app).post(`/api/admin/content/sections/${sectionId}/publish`).set(adminHeaders);
    expect(publisert.status, JSON.stringify(publisert.body)).toBe(200);
    const kurs = await prisma.course.create({ data: { title: `Oppsett-kurs ${Date.now()}`, publishedAt: new Date() }, select: { id: true } });
    await prisma.courseItem.create({ data: { courseId: kurs.id, itemType: "SECTION", sectionId, sortOrder: 0 } });

    const smal = await hent(assetId, "?layout=narrow", participantHeaders);
    expect(smal.status).toBe(200);
    expect(bredde(smal)).toBe("480");

    await prisma.course.delete({ where: { id: kurs.id } });
    await slett(sectionId);
  });

  describe("oversettelse", () => {
    it("begge oppsettene oversettes, med de samme oversettelsene, og andre kjøring gjør ingenting", async () => {
      const { sectionId, assetId } = await importerMedSmalt();
      const oversett = () => request(app).post(`/api/admin/content/sections/${sectionId}/assets/localize`).set(adminHeaders).send({ sourceLocale: "nb" });

      const første = await oversett();
      expect(første.status, JSON.stringify(første.body)).toBe(200);
      expect(første.body.localizedAssetCount).toBe(1);

      const rad = await lagret(assetId);
      expect(Object.keys(rad.localizedBlobPaths ?? {}).sort()).toEqual(["en-GB", "nn"]);
      expect(Object.keys(rad.layoutVariants?.narrow?.localizedBlobPaths ?? {}).sort()).toEqual(["en-GB", "nn"]);
      // Det smale oppsettet selv er urørt: samme fil som før oversettelsen.
      expect(bredde(await hent(assetId, "?layout=narrow&locale=nb"))).toBe("480");

      const bredEngelsk = await hent(assetId, "?locale=en-GB");
      const smalEngelsk = await hent(assetId, "?layout=narrow&locale=en-GB");
      expect(bredde(bredEngelsk)).toBe("848");
      expect(bredde(smalEngelsk)).toBe("480");
      expect(smalEngelsk.headers["x-asset-layout"]).toBe("narrow");
      // Stubben merker oversatt tekst med språket. Begge oppsettene har de samme tekstene.
      expect(extractSvgTexts(tekst(smalEngelsk))).toEqual(["[en-GB] Motta", "[en-GB] Vurder", "[en-GB] Vedta"]);
      expect(extractSvgTexts(tekst(smalEngelsk))).toEqual(extractSvgTexts(tekst(bredEngelsk)));

      const andre = await oversett();
      expect(andre.body.localizedAssetCount).toBe(0);
      expect(andre.body.skippedAssetCount).toBe(1);
      await slett(sectionId);
    });

    it("en figur som er oversatt i det brede oppsettet, men ikke i det smale, regnes ikke som ferdig", async () => {
      const { sectionId, assetId } = await importerMedSmalt();
      const oversett = async () => ({ body: await oversettFigurer(sectionId, "nb") });
      await oversett();
      // Slik en figur ville sett ut om det smale oppsettet kom til etter oversettelsen.
      const rad = await lagret(assetId);
      await prisma.sectionAsset.update({ where: { id: assetId }, data: { layoutVariants: { narrow: { blobPath: rad.layoutVariants!.narrow!.blobPath, localizedBlobPaths: {} } } } });

      const igjen = await oversett();
      expect(igjen.body.localizedAssetCount).toBe(1);
      expect(Object.keys((await lagret(assetId)).layoutVariants?.narrow?.localizedBlobPaths ?? {}).sort()).toEqual(["en-GB", "nn"]);
      await slett(sectionId);
    });

    // #1090: en ny oversettelse skrev nye stier på raden og lot de gamle filene ligge. Ingen rad
    // pekte på dem lenger, så ingenting ryddet dem.
    it("#1090: oversatt på nytt fra et annet kildespråk — de forrige oversatte filene er borte, de nye finnes", async () => {
      const { sectionId, assetId } = await importerMedSmalt();
      const oversett = async (kilde: "nb" | "en-GB") => ({ body: await oversettFigurer(sectionId, kilde) });
      const oversatteFiler = (rad: Lagret) => [...Object.values(rad.localizedBlobPaths ?? {}), ...Object.values(rad.layoutVariants?.narrow?.localizedBlobPaths ?? {})];

      expect((await oversett("nb")).body.localizedAssetCount).toBe(1);
      const første = await lagret(assetId);
      const gamle = oversatteFiler(første);
      expect(gamle).toHaveLength(4);
      for (const fil of gamle) await expect(getAsset(fil)).resolves.toBeInstanceOf(Buffer);

      expect((await oversett("en-GB")).body.localizedAssetCount).toBe(1);
      const andre = await lagret(assetId);
      const nye = oversatteFiler(andre);
      expect(nye).toHaveLength(4);
      expect(nye.filter((fil) => gamle.includes(fil)), "ingen av de nye er en gammel fil").toEqual([]);
      for (const fil of nye) await expect(getAsset(fil), `ny fil ${fil}`).resolves.toBeInstanceOf(Buffer);
      for (const fil of gamle) await expect(getAsset(fil), `gammel fil ${fil}`).rejects.toThrow();
      // Figuren selv, i begge oppsett, er urørt.
      await expect(getAsset(andre.blobPath)).resolves.toBeInstanceOf(Buffer);
      await expect(getAsset(andre.layoutVariants!.narrow!.blobPath)).resolves.toBeInstanceOf(Buffer);
      expect(andre.blobPath).toBe(første.blobPath);
      await slett(sectionId);
    });

    it("#1090: kontroll — en oversettelse som hoppes over fordi figuren alt er oversatt, sletter ingenting", async () => {
      const { sectionId, assetId } = await importerMedSmalt();
      const oversett = async () => ({ body: await oversettFigurer(sectionId, "nb") });
      await oversett();
      const før = await lagret(assetId);
      expect((await oversett()).body.skippedAssetCount).toBe(1);
      const etter = await lagret(assetId);
      expect(etter).toEqual(før);
      for (const fil of [...Object.values(etter.localizedBlobPaths ?? {}), ...Object.values(etter.layoutVariants!.narrow!.localizedBlobPaths)]) {
        await expect(getAsset(fil)).resolves.toBeInstanceOf(Buffer);
      }
      await slett(sectionId);
    });

    it("språk går foran oppsett: finnes det smale bare på norsk og det brede på engelsk, får en engelsk leser det brede", async () => {
      const { sectionId, assetId } = await importerMedSmalt();
      const rad = await lagret(assetId);
      const bredEngelsk = `sections/${sectionId}/bred-en.svg`;
      await putAsset(bredEngelsk, Buffer.from(figur(848, ["Receive", "Assess", "Decide"]), "utf8"), "image/svg+xml");
      await prisma.sectionAsset.update({ where: { id: assetId }, data: { localizedBlobPaths: { "en-GB": bredEngelsk } } });

      const svar = await hent(assetId, "?layout=narrow&locale=en-GB");
      expect(tekst(svar)).toContain("Receive");
      expect(bredde(svar)).toBe("848");
      expect(svar.headers["x-asset-layout"]).toBe("wide");
      // På norsk, der det smale finnes, er det det smale som kommer.
      expect(bredde(await hent(assetId, "?layout=narrow&locale=nb"))).toBe("480");
      expect(rad.layoutVariants?.narrow).toBeTruthy();
      await slett(sectionId);
    });
  });

  it("eksporten bærer det smale oppsettet med oversettelsene, og en ny import gir en figur med begge", async () => {
    const { sectionId, assetId } = await importerMedSmalt();
    expect((await oversettFigurer(sectionId, "nb")).localizedAssetCount).toBe(1);

    const eksport = await request(app).get(`/api/admin/content/sections/${sectionId}/export-package`).set(adminHeaders);
    expect(eksport.status, JSON.stringify(eksport.body)).toBe(200);
    const [asset] = eksport.body.envelope.section.assets as Array<{ sourceId: string; layoutVariants?: Layout[]; localizedVariants?: unknown[] }>;
    expect(asset?.sourceId).toBe(assetId);
    expect(asset?.localizedVariants).toHaveLength(2);
    expect(asset?.layoutVariants).toHaveLength(1);
    const smalt = asset!.layoutVariants![0]!;
    expect(smalt.layout).toBe("narrow");
    expect(Buffer.from(smalt.contentBase64, "base64").toString("utf8")).toContain(`viewBox="0 0 480 100"`);
    expect(smalt.localizedVariants?.map((v) => v.locale).sort()).toEqual(["en-GB", "nn"]);

    const inn = await request(app).post("/api/admin/content/sections/import").set(adminHeaders).send({ payload: eksport.body.envelope, mode: "createNew" });
    expect(inn.status, JSON.stringify(inn.body)).toBe(201);
    const kopi = await prisma.sectionAsset.findFirstOrThrow({ where: { sectionId: inn.body.sectionId as string }, select: { id: true } });
    const kopiRad = await lagret(kopi.id);
    // Egne filer, ikke en peker til kildens.
    const kildeRad = await lagret(assetId);
    expect(kopiRad.layoutVariants?.narrow?.blobPath).toBeTruthy();
    expect(kopiRad.layoutVariants?.narrow?.blobPath).not.toBe(kildeRad.layoutVariants?.narrow?.blobPath);
    expect(bredde(await hent(kopi.id, "?layout=narrow"))).toBe("480");
    expect(extractSvgTexts(tekst(await hent(kopi.id, "?layout=narrow&locale=nn")))).toEqual(["[nn] Motta", "[nn] Vurder", "[nn] Vedta"]);

    await slett(inn.body.sectionId as string);
    await slett(sectionId);
  });

  it("sletting av seksjonen fjerner HVER fil: bredt, smalt og alle oversettelsene av begge", async () => {
    const { sectionId, assetId } = await importerMedSmalt();
    expect((await oversettFigurer(sectionId, "nb")).localizedAssetCount).toBe(1);
    const rad = await lagret(assetId);
    const filer = [
      rad.blobPath,
      ...Object.values(rad.localizedBlobPaths ?? {}),
      rad.layoutVariants!.narrow!.blobPath,
      ...Object.values(rad.layoutVariants!.narrow!.localizedBlobPaths),
    ];
    expect(filer).toHaveLength(6);
    for (const fil of filer) await expect(getAsset(fil)).resolves.toBeInstanceOf(Buffer);

    const slettet = await request(app).delete(`/api/admin/content/sections/${sectionId}`).set(adminHeaders);
    expect(slettet.status).toBe(204);
    for (const fil of filer) await expect(getAsset(fil), fil).rejects.toThrow();
  });

  it("reparasjonen fra #1083 går også gjennom det smale oppsettet og oversettelsene av det", async () => {
    const { sectionId, assetId } = await importerMedSmalt();
    expect((await oversettFigurer(sectionId, "nb")).localizedAssetCount).toBe(1);
    const rad = await lagret(assetId);
    // Slik rensingen skrev før #1083: &nbsp; finnes ikke i XML, så fila lar seg ikke lese.
    const uleselig = (svg: string) => svg.replace("Motta", "Motta&nbsp;sak");
    const smal = rad.layoutVariants!.narrow!;
    await putAsset(smal.blobPath, Buffer.from(uleselig(SMAL), "utf8"), "image/svg+xml");
    await putAsset(smal.localizedBlobPaths["nn"]!, Buffer.from(uleselig(SMAL), "utf8"), "image/svg+xml");

    const mine = <T extends { assetId: string }>(funn: T[]) => funn.filter((f) => f.assetId === assetId);
    const tørr = mine((await repairUnreadableSvgAssets({ dryRun: true })).unreadable);
    expect(tørr.map((f) => `${f.layout}/${f.locale}`).sort()).toEqual(["narrow/nn", "narrow/null"]);
    expect(tørr.every((f) => f.repairable && !f.repaired)).toBe(true);

    const rettet = mine((await repairUnreadableSvgAssets({ dryRun: false })).unreadable);
    expect(rettet.every((f) => f.repaired)).toBe(true);
    expect(mine((await repairUnreadableSvgAssets({ dryRun: true })).unreadable)).toEqual([]);
    expect(tekst(await hent(assetId, "?layout=narrow"))).toContain("Motta sak");
    // `sizeBytes` er størrelsen på figuren selv, den brede. Å reparere det smale oppsettet endrer den ikke.
    const etter = await prisma.sectionAsset.findUniqueOrThrow({ where: { id: assetId }, select: { sizeBytes: true, blobPath: true } });
    expect(etter.sizeBytes).toBe((await getAsset(etter.blobPath)).byteLength);
    await slett(sectionId);
  });

  // QA-gjennomgangen av 2.81.0 pekte på at testene over bare går ÉN vei inn: seksjonsimport som ny
  // seksjon. De tre andre veiene en figur kan komme inn, virket da gjennomgangen kjørte dem — men
  // ingenting voktet dem. En figur som mister det smale oppsettet på én av veiene, gir ingen feil.
  describe("de andre veiene inn bærer også det smale oppsettet", () => {
    it("forfatter-API-et: en seksjon opprettet med figurer (POST /sections) får det smale oppsettet lagret", async () => {
      const res = await request(app)
        .post("/api/admin/content/sections")
        .set(adminHeaders)
        .send({
          title: three(`Oppsett forfatter ${Date.now()}`),
          bodyMarkdown: three("# Flyt\n\n![Saksgang](asset:flyt)"),
          draft: true,
          clientRef: "sek-oppsett",
          assets: [{ sourceId: "flyt", filename: "flyt.svg", mimeType: "image/svg+xml", sizeBytes: BRED.length, contentBase64: b64(BRED), sourceLocale: "nb", layoutVariants: [{ layout: "narrow", contentBase64: b64(SMAL) }] }],
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const sectionId = res.body.section.id as string;
      const assetId = (res.body.assetMap as Record<string, string>)["flyt"]!;
      expect((await lagret(assetId)).layoutVariants?.narrow?.blobPath).toBeTruthy();
      expect(bredde(await hent(assetId, "?layout=narrow"))).toBe("480");
      await slett(sectionId);
    });

    // #1089: forfatter-API-et laget seksjonen FØR figurene var sjekket. En avvist figur ga 400, og
    // lot seksjonen ligge igjen — uten figuren, med en `asset:`-referanse som ikke pekte på noe.
    // Prøvde agenten igjen, fantes seksjonen to ganger.
    describe("#1089: forfatter-API-et sjekker figurene før seksjonen lages", () => {
      const opprett = (assets: unknown[]) =>
        request(app).post("/api/admin/content/sections").set(adminHeaders).send({
          title: three(`Oppsett 1089 ${Date.now()}`),
          bodyMarkdown: three("# Flyt\n\n![Saksgang](asset:flyt)"),
          draft: true,
          clientRef: "sek-1089",
          assets,
        });
      const figuren = (ekstra: Record<string, unknown> = {}) => ({ sourceId: "flyt", filename: "flyt.svg", mimeType: "image/svg+xml", sizeBytes: BRED.length, contentBase64: b64(BRED), sourceLocale: "nb", ...ekstra });
      const tell = async () => ({ seksjoner: await prisma.courseSection.count(), figurer: await prisma.sectionAsset.count(), versjoner: await prisma.courseSectionVersion.count() });

      it.each<[string, Record<string, unknown>, string]>([
        ["et smalt oppsett med andre etiketter", { layoutVariants: [{ layout: "narrow", contentBase64: b64(figur(480, ["Motta", "Vurder", "Arkiver"])) }] }, "asset_layout_text_mismatch"],
        ["en figur som ikke er en SVG", { contentBase64: b64("<p>ikke en figur</p>") }, "asset_svg_invalid"],
        ["en ukjent bildetype", { mimeType: "image/tiff", filename: "flyt.tiff" }, "asset_unsupported_type"],
      ])("%s: 400, og ingen seksjon, ingen versjon og ingen figur er laget", async (_navn, ekstra, kode) => {
        const før = await tell();
        const res = await opprett([figuren(ekstra)]);
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(JSON.stringify(res.body)).toContain(kode);
        expect(await tell()).toEqual(før);
      });

      it("den andre figuren avvises: den første er heller ikke lagret", async () => {
        const før = await tell();
        const res = await opprett([figuren(), figuren({ sourceId: "to", contentBase64: b64("<p>nei</p>") })]);
        expect(res.status).toBe(400);
        expect(await tell()).toEqual(før);
      });

      it("kontroll: en gyldig figur gir seksjonen, figuren og teksten med figurens endelige id — i én versjon", async () => {
        const før = await tell();
        const res = await opprett([figuren({ layoutVariants: [{ layout: "narrow", contentBase64: b64(SMAL) }] })]);
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        const sectionId = res.body.section.id as string;
        const assetId = (res.body.assetMap as Record<string, string>)["flyt"]!;
        expect(await tell()).toEqual({ seksjoner: før.seksjoner + 1, figurer: før.figurer + 1, versjoner: før.versjoner + 1 });

        const versjoner = await prisma.courseSectionVersion.findMany({ where: { sectionId }, select: { versionNo: true, bodyMarkdown: true } });
        expect(versjoner).toHaveLength(1);
        expect(versjoner[0]!.bodyMarkdown).toContain(`asset:${assetId}`);
        expect(versjoner[0]!.bodyMarkdown).not.toContain("asset:flyt");
        // Figuren hører til seksjonen, og filene ligger under seksjonens egen sti.
        const rad = await prisma.sectionAsset.findUniqueOrThrow({ where: { id: assetId }, select: { sectionId: true, blobPath: true } });
        expect(rad.sectionId).toBe(sectionId);
        expect(rad.blobPath.startsWith(`sections/${sectionId}/`)).toBe(true);
        await slett(sectionId);
      });
    });

    it("erstatning av en eksisterende seksjon (replaceExisting) gir den nye figuren begge oppsettene", async () => {
      const { sectionId } = await importerMedSmalt();
      const før = await prisma.sectionAsset.findMany({ where: { sectionId }, select: { id: true } });
      const res = await request(app)
        .post("/api/admin/content/sections/import")
        .set(adminHeaders)
        .send({ payload: pakke({ layoutVariants: [{ layout: "narrow", contentBase64: b64(SMAL) }] }), mode: "replaceExisting", targetId: sectionId });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

      const etter = await prisma.sectionAsset.findMany({ where: { sectionId }, orderBy: { createdAt: "asc" }, select: { id: true } });
      const nye = etter.filter((a) => !før.some((f) => f.id === a.id));
      expect(nye).toHaveLength(1);
      expect((await lagret(nye[0]!.id)).layoutVariants?.narrow?.blobPath).toBeTruthy();
      expect(bredde(await hent(nye[0]!.id, "?layout=narrow"))).toBe("480");
      await slett(sectionId);
    });

    it("kurseksport og kursimport: figuren i kurset kommer fram med det smale oppsettet", async () => {
      const { sectionId } = await importerMedSmalt();
      const kurs = await request(app).post("/api/admin/content/courses").set(adminHeaders).send({ title: three(`Oppsett-kurs ${Date.now()}`) });
      expect(kurs.status, JSON.stringify(kurs.body)).toBe(201);
      const courseId = kurs.body.course.id as string;
      expect((await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(adminHeaders).send({ items: [{ type: "SECTION", sectionId }] })).status).toBe(204);

      const eksport = await request(app).get(`/api/admin/content/courses/${courseId}/export-package`).set(adminHeaders);
      expect(eksport.status, JSON.stringify(eksport.body)).toBe(200);
      const elementer = eksport.body.envelope.course.course.items as Array<{ type: string; section?: { assets?: Array<{ layoutVariants?: Layout[] }> } }>;
      expect(elementer.find((e) => e.type === "SECTION")?.section?.assets?.[0]?.layoutVariants?.[0]?.layout).toBe("narrow");

      const inn = await request(app).post("/api/admin/content/courses/import").set(adminHeaders).send({ payload: eksport.body.envelope, mode: "createNew" });
      expect(inn.status, JSON.stringify(inn.body)).toBe(201);
      const nyttKurs = inn.body.courseId as string;
      const innhold = await request(app).get(`/api/admin/content/courses/${nyttKurs}/items`).set(adminHeaders);
      const nySeksjon = (innhold.body.items as Array<{ type: string; sectionId?: string }>).find((i) => i.type === "SECTION")!.sectionId!;
      expect(nySeksjon).not.toBe(sectionId);
      const nyFigur = await prisma.sectionAsset.findFirstOrThrow({ where: { sectionId: nySeksjon }, select: { id: true } });
      expect((await lagret(nyFigur.id)).layoutVariants?.narrow?.blobPath).toBeTruthy();
      expect(bredde(await hent(nyFigur.id, "?layout=narrow"))).toBe("480");

      for (const id of [nyttKurs, courseId]) await prisma.course.delete({ where: { id } });
      await slett(nySeksjon);
      await slett(sectionId);
    });
  });

  describe("det som ikke er et gyldig oppsett, avvises med årsaken navngitt — og ingenting lagres", () => {
    const antallSeksjoner = () => prisma.courseSection.count();

    it.each<[string, Record<string, unknown>, string]>([
      ["et ukjent oppsett", { layoutVariants: [{ layout: "diagonal", contentBase64: b64(SMAL) }] }, "unknown layout"],
      ["samme oppsett to ganger", { layoutVariants: [{ layout: "narrow", contentBase64: b64(SMAL) }, { layout: "narrow", contentBase64: b64(SMAL) }] }, "same layout twice"],
      ["et smalt oppsett med en etikett det brede ikke har", { layoutVariants: [{ layout: "narrow", contentBase64: b64(figur(480, ["Motta", "Vurder", "Vedta", "Arkiver"])) }] }, "does not carry the same texts"],
      ["et smalt oppsett som mangler en etikett", { layoutVariants: [{ layout: "narrow", contentBase64: b64(figur(480, ["Motta", "Vurder"])) }] }, "does not carry the same texts"],
      ["et smalt oppsett som ikke er en figur", { layoutVariants: [{ layout: "narrow", contentBase64: b64("<html><body>nei</body></html>") }] }, "SVG could not be processed"],
      [
        "en oversettelse av det smale som ikke sier det samme som oversettelsen av det brede",
        {
          localizedVariants: [{ locale: "en-GB", contentBase64: b64(figur(848, ["Receive", "Assess", "Decide"])) }],
          layoutVariants: [{ layout: "narrow", contentBase64: b64(SMAL), localizedVariants: [{ locale: "en-GB", contentBase64: b64(figur(480, ["Receive", "Assess", "Archive"])) }] }],
        },
        "(en-GB) does not carry the same texts",
      ],
      [
        "et rasterbilde med oppsett",
        { filename: "bilde.png", mimeType: "image/png", contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", layoutVariants: [{ layout: "narrow", contentBase64: b64(SMAL) }] },
        "only an SVG figure can have more than one layout",
      ],
    ])("%s", async (_navn, asset, melding) => {
      const før = await antallSeksjoner();
      const res = await importer(asset);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain(melding);
      expect(await antallSeksjoner()).toBe(før);
    });
  });

  // Regelen for hvilken fil som svarer, målt uten database: alle seksten kombinasjonene av hva
  // figuren har (smalt, bred oversettelse, smal oversettelse) og hva det blir bedt om.
  describe("chooseAssetFile — språk før oppsett", () => {
    const rad = (smalt: boolean, bredEn: boolean, smalEn: boolean) => ({
      blobPath: "bred",
      localizedBlobPaths: bredEn ? { "en-GB": "bred-en" } : null,
      layoutVariants: smalt ? { narrow: { blobPath: "smal", localizedBlobPaths: smalEn ? { "en-GB": "smal-en" } : {} } } : null,
    });

    it.each<[string, ReturnType<typeof rad>, { locale?: string; layout?: string }, string]>([
      ["ingenting bedt om", rad(true, true, true), {}, "bred"],
      ["engelsk", rad(true, true, true), { locale: "en-GB" }, "bred-en"],
      ["smalt", rad(true, true, true), { layout: "narrow" }, "smal"],
      ["smalt på engelsk, begge finnes", rad(true, true, true), { layout: "narrow", locale: "en-GB" }, "smal-en"],
      ["smalt på engelsk, bare det brede er oversatt", rad(true, true, false), { layout: "narrow", locale: "en-GB" }, "bred-en"],
      ["smalt på engelsk, bare det smale er oversatt", rad(true, false, true), { layout: "narrow", locale: "en-GB" }, "smal-en"],
      ["smalt på engelsk, ingenting er oversatt", rad(true, false, false), { layout: "narrow", locale: "en-GB" }, "smal"],
      ["smalt, men figuren har ikke noe smalt", rad(false, true, false), { layout: "narrow", locale: "en-GB" }, "bred-en"],
      ["smalt, figuren har verken smalt eller oversettelse", rad(false, false, false), { layout: "narrow", locale: "en-GB" }, "bred"],
      ["bredt på engelsk når bare det smale er oversatt", rad(true, false, true), { locale: "en-GB" }, "bred"],
      ["et oppsett som ikke finnes", rad(true, true, true), { layout: "diagonal", locale: "en-GB" }, "bred-en"],
      ["et språk figuren ikke har", rad(true, true, true), { layout: "narrow", locale: "nn" }, "smal"],
    ])("%s", (_navn, asset, ønsket, forventet) => {
      expect(chooseAssetFile(asset, ønsket).blobPath).toBe(forventet);
    });

    // #1088: `?locale=constructor` ga feil 500. Et vanlig oppslag i et objekt treffer også det alle
    // objekter arver, og `constructor` ga en funksjon der det skulle stått en sti.
    it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])("#1088: språket «%s» finnes ikke på figuren, og gir figuren slik den ble tegnet", (språk) => {
      expect(chooseAssetFile(rad(true, true, true), { locale: språk })).toEqual({ blobPath: "bred", layout: "wide" });
      expect(chooseAssetFile(rad(true, true, true), { locale: språk, layout: "narrow" })).toEqual({ blobPath: "smal", layout: "narrow" });
      expect(chooseAssetFile(rad(false, false, false), { locale: språk, layout: "narrow" })).toEqual({ blobPath: "bred", layout: "wide" });
    });

    it("#1088: et språk som står i kolonnen med noe annet enn en sti, regnes som at det mangler", () => {
      for (const rart of [{ "en-GB": "" }, { "en-GB": 7 }, { "en-GB": null }, { "en-GB": { sti: "x" } }]) {
        expect(chooseAssetFile({ blobPath: "bred", localizedBlobPaths: rart, layoutVariants: null }, { locale: "en-GB" })).toEqual({ blobPath: "bred", layout: "wide" });
      }
    });

    it("svaret sier hvilket oppsett fila er", () => {
      expect(chooseAssetFile(rad(true, true, false), { layout: "narrow", locale: "en-GB" }).layout).toBe("wide");
      expect(chooseAssetFile(rad(true, true, true), { layout: "narrow", locale: "en-GB" }).layout).toBe("narrow");
    });

    it("en kolonne med annet innhold enn formen leses som «ingen oppsett», ikke som en feil", () => {
      for (const rart of ["tekst", 7, [], { narrow: "sti" }, { narrow: { blobPath: "" } }, { narrow: null }]) {
        expect(chooseAssetFile({ blobPath: "bred", localizedBlobPaths: null, layoutVariants: rart }, { layout: "narrow" })).toEqual({ blobPath: "bred", layout: "wide" });
      }
    });
  });
});
