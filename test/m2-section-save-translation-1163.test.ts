// #1163 skive 2: oversetting ved lagring for seksjoner (prinsipp 3), «Fyll inn det som mangler» som en ekte flyt (prinsipp 4)
// og migreringen som fyller tomme versjonstitler (doc/design/PLAN_1163_SEKSJON_UTKAST.md, «Andre gjennomlesing» punkt 2 og 5).
//
// Alt gjennom rutene. Språkmodellen er stubben (LLM_MODE er ikke azure_openai i testene): en oversatt figurtekst får
// `[<språk>] ` foran seg. Bildefilene ligger i filsystemet (`.course-assets-local`), så en fil som er laget eller ryddet bort, kan
// telles. Kallene til språkmodellen for figurtekst telles også (stubben, pakket inn): en avvist lagring skal ikke ha kostet noe.
import { promises as fs } from "node:fs";
import path from "node:path";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { runContentWrite } from "../src/db/contentLock.js";
import { getAsset } from "../src/modules/course/assetStorage.js";
import { applyDraftFigureTranslations, prepareDraftFigureTranslations } from "../src/modules/course/assetCommands.js";

const svgCalls = vi.hoisted(() => ({ texts: [] as string[][] }));
vi.mock("../src/modules/adminContent/llmContentGenerationService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/adminContent/llmContentGenerationService.js")>();
  return {
    ...actual,
    localizeSvgTexts: async (input: Parameters<typeof actual.localizeSvgTexts>[0]) => {
      svgCalls.texts.push([...input.texts]);
      return actual.localizeSvgTexts(input);
    },
  };
});
beforeEach(() => {
  svgCalls.texts.length = 0;
});
/** Figurtekstene språkmodellen ble bedt om å oversette (én gang per målspråk). */
const askedFor = () => svgCalls.texts.flat();

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const admin = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin", "x-user-roles": "ADMINISTRATOR" };
const deltaker = { "x-user-id": `deltaker-1163s2-${RUN}`, "x-user-email": `deltaker1163s2.${RUN}@company.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nn" };
const tre = (text: string) => ({ nb: `${text} nb`, nn: `${text} nn`, "en-GB": `${text} en` });
let seq = 0;
const tag = (name: string) => `1163s2 ${name} ${RUN}-${seq++}`;
const svg = (label: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="2" y="20">${label}</text></svg>`, "utf8");
const localDir = process.env.COURSE_ASSETS_LOCAL_DIR ?? path.resolve(process.cwd(), ".course-assets-local");

afterAll(async () => {
  await prisma.$disconnect();
});

type Detail = { id: string; title: string; versionNo: number; activeVersionId: string | null; bodyMarkdown: string };

async function detail(sectionId: string): Promise<Detail> {
  const res = await request(app).get(`/api/admin/content/sections/${sectionId}`).set(admin);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body.section as Detail;
}

/** En publisert seksjon på alle tre språk, laget gjennom API-et. */
async function publishedSection(name: string, body: (lang: string) => string = (lang) => `Tekst ${lang}.`) {
  const res = await request(app).post("/api/admin/content/sections").set(admin).send({
    title: tre(tag(name)),
    bodyMarkdown: { nb: body("nb"), nn: body("nn"), "en-GB": body("en") },
  });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  expect(res.body.section.activeVersionId).not.toBeNull();
  return res.body.section.id as string;
}

async function upload(sectionId: string, label: string) {
  const res = await request(app).post(`/api/admin/content/sections/${sectionId}/assets`).set(admin).attach("file", svg(label), { filename: "flyt.svg", contentType: "image/svg+xml" });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return res.body.asset.id as string;
}

/** Lagringen som redigereren gjør den: det fanen lastet, og språket forfatteren skrev på. */
async function saveFromTab(sectionId: string, body: Record<string, string>, sourceLocale: string, revision?: { expectedVersionNo: number; expectedTitle: string }) {
  const tab = await detail(sectionId);
  return request(app).put(`/api/admin/content/sections/${sectionId}`).set(admin).send({
    title: JSON.parse(tab.title),
    bodyMarkdown: body,
    expectedVersionNo: revision?.expectedVersionNo ?? tab.versionNo,
    expectedTitle: revision?.expectedTitle ?? tab.title,
    sourceLocale,
  });
}

type Row = { sourceLocale: string | null; localizedBlobPaths: Record<string, string> | null };
const row = async (assetId: string) =>
  (await prisma.sectionAsset.findUniqueOrThrow({ where: { id: assetId }, select: { sourceLocale: true, localizedBlobPaths: true } })) as unknown as Row;

/** Bildefilene seksjonen har i lageret. */
async function files(sectionId: string) {
  try {
    return (await fs.readdir(path.join(localDir, "sections", sectionId))).sort();
  } catch {
    return [];
  }
}

describe("#1163 skive 2: figurene oversettes ved lagring", () => {
  it("figuren utkastet har lagt til, oversettes fra språket forfatteren skrev på; figuren den publiserte versjonen viser og en figur ingen viser til, røres ikke", async () => {
    const sectionId = await publishedSection("figur");
    const publisertFigur = await upload(sectionId, "Publisert");
    const nyFigur = await upload(sectionId, "Motta");
    const ubrukt = await upload(sectionId, "Ubrukt");
    // Den publiserte versjonen viser til `publisertFigur` (gjennom «Publiser», som en forfatter ville gjort det).
    const v2 = await saveFromTab(sectionId, { nb: `Tekst ![p](asset:${publisertFigur})`, nn: "Tekst nn", "en-GB": "Text en" }, "nb");
    expect(v2.status, JSON.stringify(v2.body).slice(0, 300)).toBe(200);
    expect((await request(app).post(`/api/admin/content/sections/${sectionId}/publish`).set(admin).send({ expectedVersionNo: 2 })).status).toBe(200);
    // Den figuren var ny i v2, og ble oversatt da. Nullstilles her, så regelen «den publiserte versjonen viser til den» måles alene.
    await prisma.sectionAsset.update({ where: { id: publisertFigur }, data: { sourceLocale: null, localizedBlobPaths: Prisma.DbNull } });
    svgCalls.texts.length = 0;

    const res = await saveFromTab(sectionId, { nb: `Tekst ![p](asset:${publisertFigur}) ![n](asset:${nyFigur})`, nn: "Tekst nn", "en-GB": "Text en" }, "nb");
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.figureTranslation).toEqual({ translated: 1, failed: 0 });

    const ny = await row(nyFigur);
    expect(ny.sourceLocale).toBe("nb");
    expect(Object.keys(ny.localizedBlobPaths ?? {}).sort()).toEqual(["en-GB", "nn"]);
    expect((await getAsset(ny.localizedBlobPaths!.nn!)).toString("utf8")).toContain("[nn] Motta");
    // Kontroll: figuren deltakerne ser (den publiserte versjonen viser til den), og figuren ingen tekst viser til.
    expect(await row(publisertFigur)).toEqual({ sourceLocale: null, localizedBlobPaths: null });
    expect(await row(ubrukt)).toEqual({ sourceLocale: null, localizedBlobPaths: null });
    // Og språkmodellen ble bare spurt om den nye figuren — ikke om den publiserte.
    expect(askedFor()).toEqual(["Motta", "Motta"]);
  });

  it("språkbytte: en figur som alt er oversatt, oversettes ikke på nytt fra det nye språket; en ny figur oversettes fra språket det ble skrevet på", async () => {
    const sectionId = await publishedSection("språkbytte");
    const første = await upload(sectionId, "Steg");
    expect((await saveFromTab(sectionId, { nb: `![a](asset:${første})`, nn: "nn", "en-GB": "en" }, "nb")).status).toBe(200);
    const etterBokmål = await row(første);
    expect(etterBokmål.sourceLocale).toBe("nb");

    // Forfatteren skriver nå på engelsk og legger til en figur til.
    const andre = await upload(sectionId, "Step");
    svgCalls.texts.length = 0;
    const res = await saveFromTab(sectionId, { nb: `![a](asset:${første})`, nn: "nn", "en-GB": `Changed ![a](asset:${første}) ![b](asset:${andre})` }, "en-GB");
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.figureTranslation).toEqual({ translated: 1, failed: 0 });
    // Den første står som den var: samme kilde, samme filer.
    expect(await row(første)).toEqual(etterBokmål);
    // Kontroll: den nye er oversatt fra engelsk.
    const ny = await row(andre);
    expect(ny.sourceLocale).toBe("en-GB");
    expect(Object.keys(ny.localizedBlobPaths ?? {}).sort()).toEqual(["nb", "nn"]);
    expect((await getAsset(ny.localizedBlobPaths!.nb!)).toString("utf8")).toContain("[nb] Step");
    expect(askedFor()).toEqual(["Step", "Step"]);
  });

  it("en figur som mangler ett språk, får bare det; språket den alt har, beholdes", async () => {
    const sectionId = await publishedSection("delvis");
    const figur = await upload(sectionId, "Delvis");
    expect((await saveFromTab(sectionId, { nb: `![a](asset:${figur})`, nn: "nn", "en-GB": "en" }, "nb")).status).toBe(200);
    const hel = await row(figur);
    const engelsk = hel.localizedBlobPaths!["en-GB"]!;
    await prisma.sectionAsset.update({ where: { id: figur }, data: { localizedBlobPaths: { "en-GB": engelsk } } });
    svgCalls.texts.length = 0;
    const res = await saveFromTab(sectionId, { nb: `Ny ![a](asset:${figur})`, nn: "nn", "en-GB": "en" }, "nb");
    expect(res.body.figureTranslation).toEqual({ translated: 1, failed: 0 });
    const etter = await row(figur);
    expect(etter.localizedBlobPaths!["en-GB"]).toBe(engelsk);
    expect(etter.localizedBlobPaths!.nn).toEqual(expect.any(String));
    // Ett kall: bare nynorsk.
    expect(askedFor()).toEqual(["Delvis"]);
  });

  it("et smalt oppsett som mangler språkene, får dem; det brede, som har dem, beholder filene sine", async () => {
    const sectionId = await publishedSection("oppsett");
    const figur = await upload(sectionId, "Oppsett");
    expect((await saveFromTab(sectionId, { nb: `![a](asset:${figur})`, nn: "nn", "en-GB": "en" }, "nb")).status).toBe(200);
    const bred = await prisma.sectionAsset.findUniqueOrThrow({ where: { id: figur }, select: { blobPath: true, localizedBlobPaths: true } });
    // Et smalt oppsett uten oversettelser (samme tekster som det brede, som oppsett må ha).
    await prisma.sectionAsset.update({ where: { id: figur }, data: { layoutVariants: { narrow: { blobPath: bred.blobPath, localizedBlobPaths: {} } } } });
    const res = await saveFromTab(sectionId, { nb: `Ny ![a](asset:${figur})`, nn: "nn", "en-GB": "en" }, "nb");
    expect(res.body.figureTranslation).toEqual({ translated: 1, failed: 0 });
    const etter = await prisma.sectionAsset.findUniqueOrThrow({ where: { id: figur }, select: { localizedBlobPaths: true, layoutVariants: true } });
    expect(etter.localizedBlobPaths).toEqual(bred.localizedBlobPaths);
    const smal = (etter.layoutVariants as { narrow: { localizedBlobPaths: Record<string, string> } }).narrow;
    expect(Object.keys(smal.localizedBlobPaths).sort()).toEqual(["en-GB", "nn"]);
  });

  it("en avvist lagring (409) endrer ingen figur og etterlater ingen nye filer; kontroll: samme lagring med riktig versjon oversetter", async () => {
    const sectionId = await publishedSection("avvist");
    const figur = await upload(sectionId, "Avvist");
    const før = await files(sectionId);
    const body = { nb: `![a](asset:${figur})`, nn: "nn", "en-GB": "en" };
    const tab = await detail(sectionId);

    const avvist = await saveFromTab(sectionId, body, "nb", { expectedVersionNo: tab.versionNo + 5, expectedTitle: tab.title });
    expect(avvist.status).toBe(409);
    expect(avvist.body.error).toBe("section_changed");
    expect(await row(figur)).toEqual({ sourceLocale: null, localizedBlobPaths: null });
    expect(await files(sectionId)).toEqual(før);
    expect((await detail(sectionId)).versionNo).toBe(tab.versionNo);
    // Avvist før språkmodellen ble spurt: en utdatert fane koster ingenting.
    expect(askedFor()).toEqual([]);

    // Tittelen fanen lastet, er endret («Døp om» i en annen fane): også avvist, og ingen figur endret.
    const tittelAvvist = await saveFromTab(sectionId, body, "nb", { expectedVersionNo: tab.versionNo, expectedTitle: JSON.stringify({ nb: "Noe annet" }) });
    expect(tittelAvvist.status).toBe(409);
    expect(await row(figur)).toEqual({ sourceLocale: null, localizedBlobPaths: null });
    expect(await files(sectionId)).toEqual(før);
    expect(askedFor()).toEqual([]);

    const godtatt = await saveFromTab(sectionId, body, "nb", { expectedVersionNo: tab.versionNo, expectedTitle: tab.title });
    expect(godtatt.status).toBe(200);
    expect((await row(figur)).sourceLocale).toBe("nb");
    expect((await files(sectionId)).length).toBe(før.length + 2);
  });

  it("en figur som ikke kan oversettes, står urørt og telles som feilet; teksten lagres likevel", async () => {
    const sectionId = await publishedSection("feiler");
    const figur = await upload(sectionId, "Borte");
    const blobPath = (await prisma.sectionAsset.findUniqueOrThrow({ where: { id: figur }, select: { blobPath: true } })).blobPath;
    // Fila mangler i lageret: oversettingen av figuren feiler.
    await fs.rm(path.join(localDir, blobPath), { force: true });
    const res = await saveFromTab(sectionId, { nb: `Lagret ![a](asset:${figur})`, nn: "nn", "en-GB": "en" }, "nb");
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.figureTranslation).toEqual({ translated: 0, failed: 1 });
    expect(JSON.parse(res.body.section.bodyMarkdown).nb).toContain("Lagret");
    expect(await row(figur)).toEqual({ sourceLocale: null, localizedBlobPaths: null });
  });

  it("under låsen: en figur den publiserte versjonen har begynt å vise til, og en rad som er endret siden oversettingen, skrives ikke (filene deres står i `skipped`); kontroll: en uendret figur skrives", async () => {
    const sectionId = await publishedSection("lås");
    const blePublisert = await upload(sectionId, "Publisert imens");
    const bleEndret = await upload(sectionId, "Endret imens");
    const uendret = await upload(sectionId, "Uendret");
    const body = JSON.stringify({ nb: `![a](asset:${blePublisert}) ![b](asset:${bleEndret}) ![c](asset:${uendret})`, nn: "nn", "en-GB": "en" });
    const { prepared } = await prepareDraftFigureTranslations(sectionId, body, "nb");
    expect(prepared.map((p) => p.assetId).sort()).toEqual([blePublisert, bleEndret, uendret].sort());

    // Mens språkmodellen arbeidet: noen publiserte en versjon som viser til den første figuren, og den andre ble oversatt et annet
    // sted (den gamle knappen i en fane fra før).
    const v2 = await prisma.courseSectionVersion.create({ data: { sectionId, versionNo: 2, title: JSON.stringify(tre("v2")), bodyMarkdown: JSON.stringify({ nb: `![a](asset:${blePublisert})`, nn: "nn", "en-GB": "en" }), publishedAt: new Date() } });
    await prisma.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: v2.id } });
    await prisma.sectionAsset.update({ where: { id: bleEndret }, data: { sourceLocale: "en-GB" } });

    const result = await runContentWrite((tx) => applyDraftFigureTranslations(tx, sectionId, prepared));
    expect(result.applied).toEqual([uendret]);
    expect(result.skipped.map((p) => p.assetId).sort()).toEqual([blePublisert, bleEndret].sort());
    expect(await row(blePublisert)).toEqual({ sourceLocale: null, localizedBlobPaths: null });
    expect(await row(bleEndret)).toEqual({ sourceLocale: "en-GB", localizedBlobPaths: null });
    expect((await row(uendret)).sourceLocale).toBe("nb");
  });

  it("uten `sourceLocale` (en fane fra 2.166.0) lagres teksten som før, uten figuroversetting", async () => {
    const sectionId = await publishedSection("gammel fane");
    const figur = await upload(sectionId, "Gammel");
    const tab = await detail(sectionId);
    const res = await request(app).put(`/api/admin/content/sections/${sectionId}`).set(admin).send({
      title: JSON.parse(tab.title), bodyMarkdown: { nb: `![a](asset:${figur})`, nn: "nn", "en-GB": "en" }, expectedVersionNo: tab.versionNo, expectedTitle: tab.title,
    });
    expect(res.status).toBe(200);
    expect(res.body.figureTranslation).toBeUndefined();
    expect(await row(figur)).toEqual({ sourceLocale: null, localizedBlobPaths: null });
  });
});

describe("#1163 skive 2: «Fyll inn det som mangler» — fyll inn, lagre utkastet, publiser på nytt", () => {
  async function courseWith(sectionId: string) {
    const course = await prisma.course.create({
      data: { title: JSON.stringify(tre(tag("kurs"))), publishedAt: new Date(), enrollmentPolicy: "OPEN", items: { create: [{ itemType: "SECTION", sectionId, sortOrder: 0 }] } },
      select: { id: true },
    });
    return course.id;
  }

  it("et eldre utkast porten holdt igjen (bare bokmål): publiseringen gir 422; utfylt og lagret går det ut; deltakeren ser det utfylte", async () => {
    const sectionId = await publishedSection("holdt igjen");
    const courseId = await courseWith(sectionId);
    const section = await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { title: true } });
    // Slik gammel kode (før #1163) la et utkast porten holdt igjen: en ny versjon uten nynorsk og engelsk, ikke publisert.
    await prisma.courseSectionVersion.create({ data: { sectionId, versionNo: 2, title: section.title, bodyMarkdown: JSON.stringify({ nb: "Holdt igjen." }) } });

    const blokkert = await request(app).post(`/api/admin/content/sections/${sectionId}/publish`).set(admin).send({ expectedVersionNo: 2 });
    expect(blokkert.status).toBe(422);
    expect(blokkert.body.issues).toEqual([expect.objectContaining({ field: "bodyMarkdown", missingLocales: ["en-GB", "nn"] })]);

    // Klienten fyller hullene og lagrer utkastet, med versjonen forfatteren prøvde å publisere.
    const tab = await detail(sectionId);
    expect(tab.versionNo).toBe(2);
    const fylt = await request(app).put(`/api/admin/content/sections/${sectionId}`).set(admin).send({
      title: JSON.parse(tab.title), bodyMarkdown: { nb: "Holdt igjen.", nn: "[nn] Holdt igjen.", "en-GB": "[en-GB] Holdt igjen." },
      expectedVersionNo: 2, expectedTitle: tab.title, sourceLocale: "nb",
    });
    expect(fylt.status, JSON.stringify(fylt.body).slice(0, 300)).toBe(200);
    expect(fylt.body.section.versionNo).toBe(3);
    // Kontroll: versjonen porten holdt igjen, er ikke lenger den nyeste; å publisere den gir 409, ikke en gammel tekst.
    expect((await request(app).post(`/api/admin/content/sections/${sectionId}/publish`).set(admin).send({ expectedVersionNo: 2 })).status).toBe(409);
    const publisert = await request(app).post(`/api/admin/content/sections/${sectionId}/publish`).set(admin).send({ expectedVersionNo: 3 });
    expect(publisert.status, JSON.stringify(publisert.body).slice(0, 300)).toBe(200);

    const leser = await request(app).get(`/api/courses/${courseId}/sections/${sectionId}`).set(deltaker);
    expect(leser.status).toBe(200);
    expect(leser.body.html).toContain("[nn] Holdt igjen.");
  });

  it("et utkast laget av agent-API-et (bare bokmål, figur med bare engelsk): fyllingen lagrer, figuren får nynorsk og beholder engelsk, og publiseringen går", async () => {
    const tokenRes = await request(app).post("/api/admin/content/agent-authoring/tokens").set(admin).send({ label: tag("token") });
    expect(tokenRes.status).toBe(201);
    const englishFigure = svg("Receive").toString("base64");
    const laget = await request(app).post("/api/admin/content/sections").set("Authorization", `Bearer ${tokenRes.body.token}`).send({
      title: { nb: tag("agent") },
      bodyMarkdown: { nb: "Fra agenten ![f](asset:fig)" },
      draft: true,
      assets: [{ sourceId: "fig", filename: "flyt.svg", mimeType: "image/svg+xml", sizeBytes: 100, contentBase64: svg("Motta").toString("base64"), sourceLocale: "nb", localizedVariants: [{ locale: "en-GB", contentBase64: englishFigure }] }],
    });
    expect(laget.status, JSON.stringify(laget.body).slice(0, 300)).toBe(201);
    const sectionId = laget.body.section.id as string;
    const figur = laget.body.assetMap.fig as string;
    const engelsk = (await row(figur)).localizedBlobPaths!["en-GB"];

    const blokkert = await request(app).post(`/api/admin/content/sections/${sectionId}/publish`).set(admin).send({ expectedVersionNo: 1 });
    expect(blokkert.status).toBe(422);
    expect((blokkert.body.issues as Array<{ field: string }>).map((i) => i.field).sort()).toEqual(["bodyMarkdown", "title"]);

    const tab = await detail(sectionId);
    const tittel = JSON.parse(tab.title) as { nb: string };
    const fylt = await request(app).put(`/api/admin/content/sections/${sectionId}`).set(admin).send({
      title: { nb: tittel.nb, nn: `[nn] ${tittel.nb}`, "en-GB": `[en-GB] ${tittel.nb}` },
      bodyMarkdown: { nb: JSON.parse(tab.bodyMarkdown).nb, nn: "[nn] Fra agenten", "en-GB": "[en-GB] From the agent" },
      expectedVersionNo: tab.versionNo, expectedTitle: tab.title, sourceLocale: "nb",
    });
    expect(fylt.status, JSON.stringify(fylt.body).slice(0, 300)).toBe(200);
    expect(fylt.body.figureTranslation).toEqual({ translated: 1, failed: 0 });
    const etter = await row(figur);
    expect(etter.localizedBlobPaths!["en-GB"]).toBe(engelsk);
    expect((await getAsset(etter.localizedBlobPaths!.nn!)).toString("utf8")).toContain("[nn] Motta");

    const publisert = await request(app).post(`/api/admin/content/sections/${sectionId}/publish`).set(admin).send({ expectedVersionNo: fylt.body.section.versionNo });
    expect(publisert.status, JSON.stringify(publisert.body).slice(0, 300)).toBe(200);
  });
});

describe("#1163 skive 2: migreringen fyller tomme versjonstitler", () => {
  it("en versjon uten tittel får seksjonens tittel; en versjon med tittel røres ikke", async () => {
    const sectionId = await publishedSection("migrering");
    const section = await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { title: true } });
    // Slik en instans med 2.165.0-kode lager en versjon under utrullingen: uten tittel.
    const utenTittel = await prisma.courseSectionVersion.create({ data: { sectionId, versionNo: 2, bodyMarkdown: JSON.stringify(tre("v2")) } });
    const medTittel = await prisma.courseSectionVersion.create({ data: { sectionId, versionNo: 3, title: JSON.stringify({ nb: "Egen" }), bodyMarkdown: JSON.stringify(tre("v3")) } });
    expect(utenTittel.title).toBeNull();

    const sql = await fs.readFile(path.resolve(process.cwd(), "prisma/migrations/20261118120000_section_version_title_fill/migration.sql"), "utf8");
    await prisma.$executeRawUnsafe(sql);

    expect((await prisma.courseSectionVersion.findUniqueOrThrow({ where: { id: utenTittel.id } })).title).toBe(section.title);
    expect((await prisma.courseSectionVersion.findUniqueOrThrow({ where: { id: medTittel.id } })).title).toBe(JSON.stringify({ nb: "Egen" }));
  });
});
