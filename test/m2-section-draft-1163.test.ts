// #1163 skive 1: «Lagre» på en seksjon lager et utkast; «Publiser» er det eneste deltakerne ser
// (doc/design/PLAN_1163_SEKSJON_UTKAST.md, doc/DECISIONS.md «felles prinsipper»).
//
// Alt gjennom rutene, med deltakerens egne ruter som målestokk: kursdetaljen (`GET /api/courses/:id`), leseren
// (`GET …/sections/:id`), lesingen (`POST …/read`) og aktivitetsrapporten. Hver regel har en kontroll som viser at det riktige
// slipper gjennom.
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { withRevision } from "./support/courseRevision.js";

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const admin = { "x-user-id": "admin-1", "x-user-email": "admin@company.com", "x-user-name": "Platform Admin", "x-user-roles": "ADMINISTRATOR" };
const deltaker = { "x-user-id": `deltaker-1163-${RUN}`, "x-user-email": `deltaker1163.${RUN}@company.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT", "x-locale": "nb" };
const smo = (name: string) => ({ "x-user-id": `smo-1163-${name}-${RUN}`, "x-user-email": `smo1163.${name}.${RUN}@company.test`, "x-user-name": name, "x-user-roles": "SUBJECT_MATTER_OWNER" });
const tre = (text: string) => ({ nb: text, nn: text, "en-GB": text });
let seq = 0;
const tag = (name: string) => `1163 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

type Detail = {
  id: string;
  title: string;
  versionNo: number;
  activeVersionId: string | null;
  hasUnpublishedChanges: boolean;
  publishedVersionNo: number | null;
  publishedTitle: string | null;
  draftSavedAt: string | null;
  courses: Array<{ id: string; title: string }>;
};

async function detail(sectionId: string, headers: Record<string, string> = admin): Promise<Detail> {
  const res = await request(app).get(`/api/admin/content/sections/${sectionId}`).set(headers);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body.section as Detail;
}

/** En publisert seksjon laget gjennom API-et (standarden uten `draft` publiserer). */
async function publishedSection(title: string, body: string, headers: Record<string, string> = admin) {
  const res = await request(app).post("/api/admin/content/sections").set(headers).send({ title: tre(title), bodyMarkdown: tre(body) });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  expect(res.body.section.activeVersionId).not.toBeNull();
  return res.body.section.id as string;
}

/** Et publisert, åpent kurs med seksjonene, rett i databasen: deltakeren kan lese det uten tildeling. */
async function courseWith(sectionIds: string[]) {
  const course = await prisma.course.create({
    data: {
      title: JSON.stringify(tre(tag("kurs"))),
      publishedAt: new Date(),
      enrollmentPolicy: "OPEN",
      items: { create: sectionIds.map((sectionId, i) => ({ itemType: "SECTION" as const, sectionId, sortOrder: i })) },
    },
    select: { id: true },
  });
  return course.id;
}

/** Det deltakeren ser: tittelen i kursdetaljen, og tittel, tekst og versjon i leseren. */
async function seen(courseId: string, sectionId: string) {
  const course = await request(app).get(`/api/courses/${courseId}`).set(deltaker);
  expect(course.status, JSON.stringify(course.body).slice(0, 300)).toBe(200);
  const item = (course.body.course.items as Array<{ sectionId?: string; title: string; read?: boolean }>).find((i) => i.sectionId === sectionId);
  const reader = await request(app).get(`/api/courses/${courseId}/sections/${sectionId}`).set(deltaker);
  expect(reader.status, JSON.stringify(reader.body).slice(0, 300)).toBe(200);
  return { listTitle: item?.title ?? null, read: item?.read ?? null, title: reader.body.title as string, html: reader.body.html as string, versionId: reader.body.sectionVersionId as string };
}

function save(sectionId: string, body: Record<string, unknown>, headers: Record<string, string> = admin) {
  return request(app).put(`/api/admin/content/sections/${sectionId}`).set(headers).send(body);
}

async function saveAsTab(sectionId: string, title: string, body: string) {
  const tab = await detail(sectionId);
  const res = await save(sectionId, { title: tre(title), bodyMarkdown: tre(body), expectedVersionNo: tab.versionNo, expectedTitle: tab.title });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body.section as Detail;
}

async function publish(sectionId: string, expectedVersionNo?: number) {
  const res = await request(app).post(`/api/admin/content/sections/${sectionId}/publish`).set(admin).send(expectedVersionNo === undefined ? {} : { expectedVersionNo });
  return res;
}

const courseVersion = (courseId: string) => prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { versionMajor: true, versionMinor: true } });

describe("#1163: «Lagre» er et utkast, «Publiser» er det deltakerne ser", () => {
  it("lagringen lager en upublisert versjon; deltakeren ser den gamle tittelen og teksten til den er publisert (ny versjon-id)", async () => {
    const gammel = tag("gammel tittel");
    const ny = tag("ny tittel");
    const sectionId = await publishedSection(gammel, "Gammel tekst.");
    const courseId = await courseWith([sectionId]);
    const før = await seen(courseId, sectionId);
    expect(før).toMatchObject({ listTitle: gammel, title: gammel });
    expect(før.html).toContain("Gammel tekst.");

    const etter = await saveAsTab(sectionId, ny, "Ny tekst.");
    // Forfatteren: utkastet er det redigerbare; detaljen sier også hva deltakerne ser.
    expect(etter).toMatchObject({ versionNo: 2, hasUnpublishedChanges: true, publishedVersionNo: 1 });
    expect(JSON.parse(etter.title).nb).toBe(ny);
    expect(JSON.parse(etter.publishedTitle!).nb).toBe(gammel);
    expect(etter.draftSavedAt).toEqual(expect.any(String));
    const v2 = await prisma.courseSectionVersion.findUniqueOrThrow({ where: { sectionId_versionNo: { sectionId, versionNo: 2 } } });
    expect(v2.publishedAt).toBeNull();
    expect(JSON.parse(v2.title!).nb).toBe(ny);

    // Deltakeren: uendret, også versjonen teksten kom fra (#934 skive 5a-1: lesingen gjelder den).
    const underUtkast = await seen(courseId, sectionId);
    expect(underUtkast).toMatchObject({ listTitle: gammel, title: gammel, versionId: før.versionId });
    expect(underUtkast.html).toContain("Gammel tekst.");
    // En lesing av den publiserte versjonen godtas fortsatt mens utkastet ligger der.
    expect((await request(app).post(`/api/courses/${courseId}/sections/${sectionId}/read`).set(deltaker).send({ sectionVersionId: før.versionId })).status).toBe(204);

    // Publisert: deltakeren ser den nye tittelen og teksten, fra en ny versjon.
    expect((await publish(sectionId, 2)).status).toBe(200);
    const publisert = await seen(courseId, sectionId);
    expect(publisert).toMatchObject({ listTitle: ny, title: ny });
    expect(publisert.html).toContain("Ny tekst.");
    expect(publisert.versionId).toBe(v2.id);
    expect(publisert.versionId).not.toBe(før.versionId);
    // En fane som viste den gamle teksten, kan ikke lenger registrere lesingen.
    const gammelFane = await request(app).post(`/api/courses/${courseId}/sections/${sectionId}/read`).set(deltaker).send({ sectionVersionId: før.versionId });
    expect(gammelFane.status).toBe(409);
    expect(gammelFane.body.error).toBe("section_version_changed");
    // Etter publiseringen: ikke noe utkast, og stripen har ingenting å si.
    expect(await detail(sectionId)).toMatchObject({ hasUnpublishedChanges: false, publishedVersionNo: 2, draftSavedAt: null });
  });

  it("aktivitetsrapporten og øyeblikksbildet (#934) følger den publiserte versjonen, ikke utkastet", async () => {
    const gammel = tag("rapport gammel");
    const ny = tag("rapport ny");
    const sectionId = await publishedSection(gammel, "Tekst.");
    const courseId = await courseWith([sectionId]);
    const lest = await seen(courseId, sectionId);
    expect((await request(app).post(`/api/courses/${courseId}/sections/${sectionId}/read`).set(deltaker).send({ sectionVersionId: lest.versionId })).status).toBe(204);
    const userId = (await prisma.user.findFirstOrThrow({ where: { email: deltaker["x-user-email"] }, select: { id: true } })).id;
    const rapport = async () => {
      const res = await request(app).get(`/api/reports/activity/users/${userId}/recent`).set({ ...admin, "x-locale": "nb" });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      return (res.body.events as Array<{ type: string; itemTitle: string }>).filter((e) => e.type === "read").map((e) => e.itemTitle);
    };
    const aktivFør = (await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { activeVersionId: true } })).activeVersionId;

    await saveAsTab(sectionId, ny, "Utkast.");
    expect(await rapport()).toContain(gammel);
    expect(await rapport()).not.toContain(ny);
    // Øyeblikksbildet bygger på `activeVersionId` (findSectionVersions): lagringen rører det ikke.
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { activeVersionId: true } })).activeVersionId).toBe(aktivFør);
    // Lesingen teller fortsatt etter lagringen.
    expect((await seen(courseId, sectionId)).read).toBe(true);

    expect((await publish(sectionId, 2)).status).toBe(200);
    expect(await rapport()).toContain(ny);
  });

  it("#1156: en seksjon i to kurs — lagringen endrer ingenting i noen av dem; publiseringen viser det nye i begge", async () => {
    const gammel = tag("to kurs gammel");
    const ny = tag("to kurs ny");
    const sectionId = await publishedSection(gammel, "Tekst.");
    const a = await courseWith([sectionId]);
    const b = await courseWith([sectionId]);
    const lest = await seen(a, sectionId);
    expect((await request(app).post(`/api/courses/${a}/sections/${sectionId}/read`).set(deltaker).send({ sectionVersionId: lest.versionId })).status).toBe(204);
    expect((await seen(b, sectionId)).read).toBe(true);

    await saveAsTab(sectionId, ny, "Utkast.");
    for (const courseId of [a, b]) expect(await seen(courseId, sectionId)).toMatchObject({ listTitle: gammel, title: gammel, read: true });

    expect((await publish(sectionId, 2)).status).toBe(200);
    for (const courseId of [a, b]) expect(await seen(courseId, sectionId)).toMatchObject({ listTitle: ny, title: ny });
  });

  it("#1140: en ny seksjon i kursets utkast, publisert før utkastet — deltakeren ser den først når utkastet publiseres, med den publiserte tittelen", async () => {
    const s1 = await publishedSection(tag("utkastkurs s1"), "Første.");
    const courseId = await courseWith([s1]);
    const ny = await request(app).post("/api/admin/content/sections").set(admin).send({ title: tre(tag("ny i utkastet")), bodyMarkdown: tre("Ny seksjon."), draft: true });
    expect(ny.status).toBe(201);
    const s2 = ny.body.section.id as string;
    const base = `/api/admin/content/courses/${courseId}`;
    const revisjon = (await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { contentRevision: true } })).contentRevision;
    const lagret = await request(app).put(`${base}/draft`).set(admin).send({ items: [{ type: "SECTION", sectionId: s1 }, { type: "SECTION", sectionId: s2 }], loaded: { expectedRevision: revisjon } });
    expect(lagret.status, JSON.stringify(lagret.body).slice(0, 300)).toBe(200);
    const publiserUtkast = async () => {
      const rad = await prisma.courseDraft.findUniqueOrThrow({ where: { courseId } });
      return request(app).post(`${base}/draft/publish`).set(admin).send({ loaded: { draftId: rad.id, revision: rad.revision } });
    };
    // Seksjonen er et utkast og ny i kursets utkast: utkastet kan ikke publiseres ennå.
    expect((await publiserUtkast()).status).toBe(400);

    // Seksjonen publiseres for seg, før kursets utkast. Deltakeren ser den ikke: den står ikke i det publiserte kurset.
    const publisertTittel = JSON.parse((await detail(s2)).title).nb as string;
    expect((await publish(s2, 1)).status).toBe(200);
    const før = await request(app).get(`/api/courses/${courseId}`).set(deltaker);
    expect((før.body.course.items as Array<{ sectionId?: string }>).map((i) => i.sectionId)).toEqual([s1]);

    // Så lagres et nytt utkast av seksjonen, og kursets utkast publiseres: deltakeren ser seksjonen med den PUBLISERTE tittelen.
    await saveAsTab(s2, tag("s2 utkast"), "Utkast av s2.");
    const pub = await publiserUtkast();
    expect(pub.status, JSON.stringify(pub.body).slice(0, 300)).toBe(200);
    const etter = await seen(courseId, s2);
    expect(etter).toMatchObject({ title: publisertTittel, listTitle: publisertTittel });
    expect(etter.html).toContain("Ny seksjon.");
  });

  it("en migrert versjon (tittelen fylt fra seksjonen) og en versjon gammel kode laget uten tittel: deltakeren ser riktig tittel", async () => {
    const gammel = tag("migrert");
    const sectionId = await publishedSection(gammel, "Tekst.");
    const courseId = await courseWith([sectionId]);
    // Gammel kode under utrullingen: en versjon uten tittel, publisert, og en arbeidstittel skrevet rett på seksjonen.
    const rullert = tag("rullert");
    await prisma.courseSection.update({ where: { id: sectionId }, data: { title: JSON.stringify(tre(rullert)) } });
    const v2 = await prisma.courseSectionVersion.create({ data: { sectionId, versionNo: 2, bodyMarkdown: JSON.stringify(tre("Gammel kode.")), publishedAt: new Date() }, select: { id: true } });
    // Kontroll: før v2 er aktiv, ser deltakeren v1s tittel — ikke arbeidstittelen gammel kode skrev.
    expect(await seen(courseId, sectionId)).toMatchObject({ title: gammel, listTitle: gammel });
    await prisma.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: v2.id } });
    // En versjon uten tittel: reserven er seksjonens tittel (valgt i DECISIONS, «Valgt under byggingen av #1163»).
    expect(await seen(courseId, sectionId)).toMatchObject({ title: rullert, listTitle: rullert });
  });
});

describe("#1163: konfliktsjekken (prinsipp 6) — versjonen og tittelen fanen lastet", () => {
  it("en utdatert versjon avvises med 409 `section_changed`, og ingenting skrives; riktig versjon lagrer (kontroll)", async () => {
    const sectionId = await publishedSection(tag("konflikt"), "Tekst.");
    const fane = await detail(sectionId);
    // En annen fane lagret i mellomtiden — med SAMME tittel, så det er versjonen alene som avslører det (mutasjonstesten:
    // med en ny tittel fanget tittelsjekken det, og versjonssjekken kunne fjernes uten at testen merket det).
    await saveAsTab(sectionId, JSON.parse(fane.title).nb, "Andre fane.");
    expect((await detail(sectionId)).title).toBe(fane.title);
    const før = await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { title: true, _count: { select: { versions: true } } } });

    const gammel = await save(sectionId, { title: tre("Min tittel"), bodyMarkdown: tre("Min tekst."), expectedVersionNo: fane.versionNo, expectedTitle: fane.title });
    expect(gammel.status).toBe(409);
    expect(gammel.body.error).toBe("section_changed");
    const etter = await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { title: true, _count: { select: { versions: true } } } });
    expect(etter).toEqual(før);

    // Kontroll: med det fanen har nå, lagres det.
    const nå = await detail(sectionId);
    const ok = await save(sectionId, { title: tre("Min tittel"), bodyMarkdown: tre("Min tekst."), expectedVersionNo: nå.versionNo, expectedTitle: nå.title });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
    expect(ok.body.section.versionNo).toBe(nå.versionNo + 1);
  });

  it("en tittel skrevet uten ny versjon (gammel kode under utrullingen) avvises også: tittelen fanen lastet sjekkes", async () => {
    const sectionId = await publishedSection(tag("tittelkonflikt"), "Tekst.");
    const fane = await detail(sectionId);
    await prisma.courseSection.update({ where: { id: sectionId }, data: { title: JSON.stringify(tre(tag("skrevet av gammel kode"))) } });
    const res = await save(sectionId, { title: tre("Min"), bodyMarkdown: tre("Min."), expectedVersionNo: fane.versionNo, expectedTitle: fane.title });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("section_changed");
    expect(res.body.details).toMatchObject({ titleChanged: true });
    expect(await prisma.courseSectionVersion.count({ where: { sectionId } })).toBe(1);
  });

  it("lagringen krever revisjonen: uten `expectedVersionNo` er det 400, og ingenting skrives", async () => {
    const sectionId = await publishedSection(tag("uten revisjon"), "Tekst.");
    const res = await save(sectionId, { title: tre("Min"), bodyMarkdown: tre("Min.") });
    expect(res.status).toBe(400);
    expect(await prisma.courseSectionVersion.count({ where: { sectionId } })).toBe(1);
  });

  it("«Døp om» i lista lager et utkast, med versjonen lista så; begge retninger mot redigereren gir 409", async () => {
    const gammel = tag("døp gammel");
    const sectionId = await publishedSection(gammel, "Tekst.");
    const courseId = await courseWith([sectionId]);
    const rad = async () => ((await request(app).get("/api/admin/content/sections").set(admin)).body.sections as Array<{ id: string; title: string; latestVersionNo: number }>).find((s) => s.id === sectionId)!;

    // Redigereren åpnet, så døpes den om i lista: redigererens lagring avvises.
    const fane = await detail(sectionId);
    const r1 = await rad();
    expect(r1.latestVersionNo).toBe(1);
    const nyttNavn = tag("døp nytt");
    const omdøpt = await request(app).patch(`/api/admin/content/sections/${sectionId}/title`).set(admin).send({ title: tre(nyttNavn), expectedVersionNo: r1.latestVersionNo, expectedTitle: r1.title });
    expect(omdøpt.status, JSON.stringify(omdøpt.body).slice(0, 300)).toBe(200);
    expect(omdøpt.body.section).toMatchObject({ versionNo: 2, hasUnpublishedChanges: true });
    // Utkastet har den siste teksten og det nye navnet; deltakeren ser det gamle navnet.
    const v2 = await prisma.courseSectionVersion.findUniqueOrThrow({ where: { sectionId_versionNo: { sectionId, versionNo: 2 } } });
    expect(JSON.parse(v2.title!).nb).toBe(nyttNavn);
    expect(JSON.parse(v2.bodyMarkdown).nb).toBe("Tekst.");
    expect(v2.publishedAt).toBeNull();
    expect(await seen(courseId, sectionId)).toMatchObject({ title: gammel, listTitle: gammel });
    const redigerer = await save(sectionId, { title: tre("Fra redigereren"), bodyMarkdown: tre("Fra redigereren."), expectedVersionNo: fane.versionNo, expectedTitle: fane.title });
    expect(redigerer.status).toBe(409);
    expect(redigerer.body.error).toBe("section_changed");

    // Andre veien: redigereren lagrer, og lista (som så v2) døper om: avvist, ingenting skrevet.
    const r2 = await rad();
    await saveAsTab(sectionId, nyttNavn, "Redigert tekst.");
    const antall = await prisma.courseSectionVersion.count({ where: { sectionId } });
    const gammelRad = await request(app).patch(`/api/admin/content/sections/${sectionId}/title`).set(admin).send({ title: tre(tag("for sent")), expectedVersionNo: r2.latestVersionNo, expectedTitle: r2.title });
    expect(gammelRad.status).toBe(409);
    expect(gammelRad.body.error).toBe("section_changed");
    expect(await prisma.courseSectionVersion.count({ where: { sectionId } })).toBe(antall);
  });

  it("masseoversettingen av titler (samme rute, flere rader) lager utkast og avvises for en rad noen har lagret siden", async () => {
    const a = await publishedSection(tag("masse a"), "Tekst a.");
    const b = await publishedSection(tag("masse b"), "Tekst b.");
    const rader = ((await request(app).get("/api/admin/content/sections").set(admin)).body.sections as Array<{ id: string; title: string; latestVersionNo: number }>).filter((s) => s.id === a || s.id === b);
    expect(rader).toHaveLength(2);
    // Seksjon b lagres i redigereren mens lista står.
    await saveAsTab(b, tag("b lagret"), "Lagret.");
    const svar: Record<string, number> = {};
    for (const rad of rader) {
      const kart = JSON.parse(rad.title) as Record<string, string>;
      const res = await request(app).patch(`/api/admin/content/sections/${rad.id}/title`).set(admin)
        .send({ title: { ...kart, nn: `${kart.nb} (nn)` }, expectedVersionNo: rad.latestVersionNo, expectedTitle: rad.title });
      svar[rad.id] = res.status;
    }
    expect(svar).toEqual({ [a]: 200, [b]: 409 });
    expect((await detail(a)).hasUnpublishedChanges).toBe(true);
  });

  it("samme navn på nytt gir ingen ny versjon", async () => {
    const navn = tag("samme");
    const sectionId = await publishedSection(navn, "Tekst.");
    const fane = await detail(sectionId);
    const res = await request(app).patch(`/api/admin/content/sections/${sectionId}/title`).set(admin).send({ title: tre(navn), expectedVersionNo: fane.versionNo, expectedTitle: fane.title });
    expect(res.status).toBe(200);
    expect(await prisma.courseSectionVersion.count({ where: { sectionId } })).toBe(1);
  });
});

describe("#1163: publiseringen", () => {
  it("publiserer versjonen forfatteren så: en nyere versjon gir 409, og ingenting publiseres eller versjoneres", async () => {
    const sectionId = await publishedSection(tag("publiser konflikt"), "Tekst.");
    const courseId = await courseWith([sectionId]);
    await saveAsTab(sectionId, tag("v2"), "To.");
    const sett = (await detail(sectionId)).versionNo;
    await saveAsTab(sectionId, tag("v3"), "Tre.");
    const aktivFør = (await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { activeVersionId: true } })).activeVersionId;
    const versjonFør = await courseVersion(courseId);

    const res = await publish(sectionId, sett);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("section_changed");
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { activeVersionId: true } })).activeVersionId).toBe(aktivFør);
    expect(await courseVersion(courseId)).toEqual(versjonFør);

    // Kontroll: med den nyeste publiseres den, og kurset får én mindre versjon.
    const ok = await publish(sectionId, sett + 1);
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
    expect(ok.body.section.publishedVersionNo).toBe(3);
    expect(await courseVersion(courseId)).toEqual({ versionMajor: versjonFør.versionMajor, versionMinor: versjonFør.versionMinor + 1 });
  });

  it("porten måler versjonen som publiseres — dens tittel, ikke arbeidstittelen", async () => {
    const sectionId = await publishedSection(tag("port"), "Tekst.");
    // Utkastet har en tittel på bare bokmål: porten holder publiseringen igjen (422, feltet `title`).
    const fane = await detail(sectionId);
    const kortTittel = tag("bare bokmål");
    expect((await save(sectionId, { title: { nb: kortTittel }, bodyMarkdown: tre("Tekst 2."), expectedVersionNo: fane.versionNo, expectedTitle: fane.title })).status).toBe(200);
    // Arbeidstittelen settes til et fullt kart (som gammel kode kunne gjort): porten skal fortsatt se versjonens tittel.
    await prisma.courseSection.update({ where: { id: sectionId }, data: { title: JSON.stringify(tre(kortTittel)) } });
    const stoppet = await publish(sectionId, 2);
    expect(stoppet.status).toBe(422);
    expect(stoppet.body.error).toBe("publish_blocked_by_validation");
    expect((stoppet.body.issues as Array<{ field?: string }>).map((i) => i.field)).toContain("title");

    // Omvendt: versjonens tittel er komplett, arbeidstittelen bare bokmål — publiseringen går gjennom.
    const neste = await detail(sectionId);
    expect((await save(sectionId, { title: tre(tag("komplett")), bodyMarkdown: tre("Tekst 3."), expectedVersionNo: neste.versionNo, expectedTitle: neste.title })).status).toBe(200);
    await prisma.courseSection.update({ where: { id: sectionId }, data: { title: JSON.stringify({ nb: "bare bokmål" }) } });
    const ok = await publish(sectionId, 3);
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
  });

  it("kurskaskaden (`publish-preview`) måler også versjonens tittel, ikke arbeidstittelen", async () => {
    const lagd = await request(app).post("/api/admin/content/sections").set(admin).send({ title: { nb: tag("kaskade bare bokmål") }, bodyMarkdown: tre("Tekst."), draft: true });
    expect(lagd.status).toBe(201);
    const sectionId = lagd.body.section.id as string;
    // Arbeidstittelen komplett (som gammel kode kunne skrevet), versjonens tittel bare på bokmål.
    await prisma.courseSection.update({ where: { id: sectionId }, data: { title: JSON.stringify(tre(tag("kaskade komplett"))) } });
    const course = await prisma.course.create({
      data: { title: JSON.stringify(tre(tag("kaskadekurs"))), items: { create: [{ itemType: "SECTION", sectionId, sortOrder: 0 }] } },
      select: { id: true },
    });
    const preview = async () => {
      const res = await request(app).get(`/api/admin/content/courses/${course.id}/publish-preview`).set(admin);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      return (res.body.unpublishedItems as Array<{ id: string; publishable: boolean; blockers: Array<{ field?: string }> }>).find((i) => i.id === sectionId)!;
    };
    const stoppet = await preview();
    expect(stoppet.publishable).toBe(false);
    expect(stoppet.blockers.map((b) => b.field)).toContain("title");
    // Kontroll: versjonens tittel komplett — publiserbar.
    await prisma.courseSectionVersion.updateMany({ where: { sectionId }, data: { title: JSON.stringify(tre(tag("kaskade versjon komplett"))) } });
    expect((await preview()).publishable).toBe(true);
  });

  it("et utkast laget av agent-API-et (`draft: true`) og et eldre utkast fra før migreringen publiseres gjennom samme port", async () => {
    const agent = await request(app).post("/api/admin/content/sections").set(admin).send({ title: tre(tag("agent")), bodyMarkdown: tre("Fra agenten."), draft: true });
    expect(agent.status).toBe(201);
    expect(agent.body.section.activeVersionId).toBeNull();
    const agentId = agent.body.section.id as string;
    const v1 = await prisma.courseSectionVersion.findFirstOrThrow({ where: { sectionId: agentId } });
    expect(v1.title).not.toBeNull();
    expect((await publish(agentId, 1)).status).toBe(200);

    // Eldre utkast holdt igjen av porten før #1163: tittelen fylt av migreringen, teksten på bare bokmål.
    const sectionId = await publishedSection(tag("holdt igjen"), "Tekst.");
    const seksjon = await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { title: true } });
    await prisma.courseSectionVersion.create({ data: { sectionId, versionNo: 2, title: seksjon.title, bodyMarkdown: JSON.stringify({ nb: "Bare bokmål." }) } });
    const stoppet = await publish(sectionId, 2);
    expect(stoppet.status).toBe(422);
    expect((stoppet.body.issues as Array<{ field?: string }>).map((i) => i.field)).toContain("bodyMarkdown");
  });
});

describe("#1163: dørene som ikke er redigereren", () => {
  it("den gamle `PUT …/content` (faner fra før) lager et utkast og publiserer ikke", async () => {
    const gammel = tag("gammel fane");
    const sectionId = await publishedSection(gammel, "Tekst.");
    const courseId = await courseWith([sectionId]);
    const res = await request(app).put(`/api/admin/content/sections/${sectionId}/content`).set(admin).send({ bodyMarkdown: tre("Fra en gammel fane.") });
    expect(res.status).toBe(200);
    expect(res.body.section).toMatchObject({ versionNo: 2, hasUnpublishedChanges: true });
    expect(res.body).not.toHaveProperty("translationGate");
    const v2 = await prisma.courseSectionVersion.findUniqueOrThrow({ where: { sectionId_versionNo: { sectionId, versionNo: 2 } } });
    expect(v2.publishedAt).toBeNull();
    expect(JSON.parse(v2.title!).nb).toBe(gammel);
    expect((await seen(courseId, sectionId)).html).not.toContain("gammel fane");
  });

  it("ny seksjon fra redigereren (`draft: true`) er et utkast; standarden i API-et publiserer fortsatt (kontroll)", async () => {
    const utkast = await request(app).post("/api/admin/content/sections").set(admin).send({ title: tre(tag("ny")), bodyMarkdown: tre("Ny."), draft: true });
    expect(utkast.status).toBe(201);
    expect(utkast.body.section.activeVersionId).toBeNull();
    const standard = await request(app).post("/api/admin/content/sections").set(admin).send({ title: tre(tag("standard")), bodyMarkdown: tre("Standard.") });
    expect(standard.status).toBe(201);
    expect(standard.body.section.activeVersionId).not.toBeNull();
  });

  it("detaljen sier hvilke kurs seksjonen står i (publiseringsdialogen)", async () => {
    const sectionId = await publishedSection(tag("kursliste"), "Tekst.");
    const courseId = await courseWith([sectionId]);
    const d = await detail(sectionId);
    expect(d.courses.map((c) => c.id)).toEqual([courseId]);
  });
});

describe("#1163: eksport og import tar med både det publiserte og utkastet", () => {
  async function publisertModul(tittel: string) {
    const post = async (path: string, body: object) => {
      const r = await request(app).post(path).set(admin).send(body);
      expect(r.status, `${path}: ${JSON.stringify(r.body).slice(0, 300)}`).toBeLessThan(300);
      return r.body;
    };
    const modul = await post("/api/admin/content/modules", { title: tre(tittel), description: tre("Beskrivelse"), certificationLevel: "basic" });
    const moduleId = modul.module.id as string;
    const rubric = await post(`/api/admin/content/modules/${moduleId}/rubric-versions`, { criteria: { relevance: "0-4", quality: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } });
    const prompt = await post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`, { systemPrompt: tre("Sys"), userPromptTemplate: tre("Eval"), examples: [{ note: "fixture" }] });
    const mcq = await post(`/api/admin/content/modules/${moduleId}/mcq-set-versions`, { title: tre("MCQ"), questions: [{ stem: tre("Hva er 1+1?"), options: [tre("2"), tre("3")], correctAnswer: tre("2"), rationale: tre("Matte") }] });
    const versjon = await post(`/api/admin/content/modules/${moduleId}/module-versions`, {
      taskText: tre("Reflekter"),
      assessorExpectedContent: tre("Nevn QA"),
      rubricVersionId: rubric.rubricVersion.id,
      promptTemplateVersionId: prompt.promptTemplateVersion.id,
      mcqSetVersionId: mcq.mcqSetVersion.id,
    });
    await post(`/api/admin/content/modules/${moduleId}/module-versions/${versjon.moduleVersion.id}/publish`, {});
    return moduleId;
  }

  /** Et publisert, åpent kurs laget gjennom API-et av `headers`, med elementene. */
  async function apiCourse(headers: Record<string, string>, items: Array<{ type: "SECTION"; sectionId: string } | { type: "MODULE"; moduleId: string }>) {
    const opprettet = await request(app).post("/api/admin/content/courses").set(headers).send({ title: tre(tag("eksportkurs")), enrollmentPolicy: "OPEN" });
    expect(opprettet.status, JSON.stringify(opprettet.body).slice(0, 300)).toBe(201);
    const courseId = opprettet.body.course.id as string;
    const lagt = await request(app).put(`/api/admin/content/courses/${courseId}/items`).set(headers).send(await withRevision(courseId, { items }));
    expect(lagt.status, JSON.stringify(lagt.body).slice(0, 300)).toBe(204);
    const pub = await request(app).post(`/api/admin/content/courses/${courseId}/publish`).set(headers);
    expect(pub.status, JSON.stringify(pub.body).slice(0, 300)).toBe(200);
    return courseId;
  }

  async function exportCourse(courseId: string, headers: Record<string, string> = admin) {
    const ut = await request(app).get(`/api/admin/content/courses/${courseId}/export-package`).set(headers);
    expect(ut.status, JSON.stringify(ut.body).slice(0, 300)).toBe(200);
    return JSON.parse(JSON.stringify(ut.body.envelope ?? ut.body));
  }

  it("publisert kurs, seksjon v1 aktiv og v2 utkast: eksport og import som nytt kurs publiserer IKKE v2", async () => {
    const publisertTittel = tag("eksport publisert");
    const utkastTittel = tag("eksport utkast");
    const sectionId = await publishedSection(publisertTittel, "Publisert tekst.");
    const moduleId = await publisertModul(tag("eksport modul"));
    const courseId = await apiCourse(admin, [{ type: "SECTION", sectionId }, { type: "MODULE", moduleId }]);
    await saveAsTab(sectionId, utkastTittel, "Utkasttekst.");

    const fil = await exportCourse(courseId);
    const sek = fil.course.course.items[0].section;
    // Hovedinnholdet er utkastet (det forfatteren arbeider i); det deltakerne ser, står i `publishedVersion`.
    expect(sek.title.nb).toBe(utkastTittel);
    expect(sek.bodyMarkdown.nb).toBe("Utkasttekst.");
    expect(sek.publishedVersion.title.nb).toBe(publisertTittel);
    expect(sek.publishedVersion.bodyMarkdown.nb).toBe("Publisert tekst.");

    delete fil.course.course.origin;
    for (const it of fil.course.course.items) delete it.origin;
    const svar = await request(app).post("/api/admin/content/courses/import").set(admin).send({ payload: fil, mode: "createNew" });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 400)).toBe(201);
    const nyttKurs = svar.body.courseId as string;
    expect((await prisma.course.findUniqueOrThrow({ where: { id: nyttKurs }, select: { publishedAt: true } })).publishedAt).not.toBeNull();
    // Opprett deltakerens tilgang: «Importer som nytt kurs» gir et begrenset kurs (#1164); åpne det for testen.
    await prisma.course.update({ where: { id: nyttKurs }, data: { enrollmentPolicy: "OPEN" } });
    const ny = await prisma.courseItem.findFirstOrThrow({ where: { courseId: nyttKurs, itemType: "SECTION" }, select: { sectionId: true } });
    const rad = await prisma.courseSection.findUniqueOrThrow({
      where: { id: ny.sectionId! },
      select: { title: true, activeVersion: { select: { versionNo: true, title: true } }, versions: { orderBy: { versionNo: "asc" }, select: { versionNo: true, title: true, publishedAt: true, bodyMarkdown: true } } },
    });
    expect(rad.activeVersion?.versionNo).toBe(1);
    expect(JSON.parse(rad.activeVersion!.title!).nb).toBe(publisertTittel);
    expect(rad.versions).toHaveLength(2);
    expect(rad.versions[1]!.publishedAt).toBeNull();
    expect(JSON.parse(rad.versions[1]!.title!).nb).toBe(utkastTittel);
    expect(JSON.parse(rad.versions[1]!.bodyMarkdown).nb).toBe("Utkasttekst.");
    // Arbeidstittelen er utkastets, som etter en lagring.
    expect(JSON.parse(rad.title).nb).toBe(utkastTittel);
    // Deltakeren i det nye kurset ser det publiserte.
    const deltakerSer = await seen(nyttKurs, ny.sectionId!);
    expect(deltakerSer).toMatchObject({ title: publisertTittel, listTitle: publisertTittel });
    expect(deltakerSer.html).toContain("Publisert tekst.");
  });

  it("uten utkast bærer eksporten ingen `publishedVersion` (kontroll), og frittstående import lager utkastet alene", async () => {
    const sectionId = await publishedSection(tag("uten utkast"), "Tekst.");
    const pakke = await request(app).get(`/api/admin/content/sections/${sectionId}/export-package`).set(admin);
    expect(pakke.status).toBe(200);
    expect(pakke.body.envelope.section).not.toHaveProperty("publishedVersion");

    const utkastTittel = tag("frittstående utkast");
    await saveAsTab(sectionId, utkastTittel, "Utkast.");
    const medUtkast = await request(app).get(`/api/admin/content/sections/${sectionId}/export-package`).set(admin);
    expect(medUtkast.body.envelope.section.publishedVersion).toBeTruthy();
    const imp = await request(app).post("/api/admin/content/sections/import").set(admin).send({ payload: medUtkast.body.envelope, mode: "createNew" });
    expect(imp.status, JSON.stringify(imp.body).slice(0, 300)).toBe(201);
    const ny = await prisma.courseSection.findUniqueOrThrow({ where: { id: imp.body.sectionId }, select: { activeVersionId: true, title: true, versions: { select: { title: true } } } });
    expect(ny.activeVersionId).toBeNull();
    expect(ny.versions).toHaveLength(1);
    expect(JSON.parse(ny.versions[0]!.title!).nb).toBe(utkastTittel);
    expect(JSON.parse(ny.title).nb).toBe(utkastTittel);
  });

  it("frittstående «erstatt fra fil» med en annen tittel: tittelen ligger i den nye versjonen; deltakeren ser den gamle", async () => {
    const gammel = tag("erstatt gammel");
    const sectionId = await publishedSection(gammel, "Gammel.");
    const courseId = await courseWith([sectionId]);
    const filTittel = tag("erstatt fil");
    const envelope = { exportFormat: "a2-content-export/v1", exportedAt: new Date().toISOString(), scope: "section", section: { title: tre(filTittel), bodyMarkdown: tre("Fra fila."), audit: {} } };
    const res = await request(app).post("/api/admin/content/sections/import").set(admin).send({ payload: envelope, mode: "replaceExisting", targetId: sectionId });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    const d = await detail(sectionId);
    expect(JSON.parse(d.title).nb).toBe(filTittel);
    expect(JSON.parse(d.publishedTitle!).nb).toBe(gammel);
    expect(await seen(courseId, sectionId)).toMatchObject({ title: gammel, listTitle: gammel });
  });

  it("«Oppdater kurs»: en ren tittelendring er en endring — egen seksjon får ny versjon, en annens byttes ut med kopi; deltakeren ser det gamle", async () => {
    const eier = smo("eier");
    const annen = smo("annen");
    const egen = await publishedSection(tag("oppdater egen"), "Egen.", eier);
    const fremmedTittel = tag("oppdater fremmed");
    const fremmed = await publishedSection(fremmedTittel, "Fremmed.", annen);
    const moduleId = await publisertModul(tag("oppdater modul"));
    const courseId = await apiCourse(eier, [{ type: "SECTION", sectionId: egen }, { type: "SECTION", sectionId: fremmed }, { type: "MODULE", moduleId }]);

    // Kontroll: fila uendret — ingenting får ny versjon.
    const uendret = await exportCourse(courseId, eier);
    const kontroll = await request(app).post("/api/admin/content/courses/import").set(eier).send({ payload: uendret, mode: "updateExisting", targetId: courseId });
    expect(kontroll.status, JSON.stringify(kontroll.body).slice(0, 400)).toBe(201);
    expect(kontroll.body.summary).toMatchObject({ updatedSections: 0, replacedUnownedIds: [] });
    expect(kontroll.body.summary.unchangedIds).toContain(egen);

    const fil = await exportCourse(courseId, eier);
    const nyEgen = tag("ny egen tittel");
    const nyFremmed = tag("ny fremmed tittel");
    fil.course.course.items[0].section.title = tre(nyEgen);
    fil.course.course.items[1].section.title = tre(nyFremmed);
    const svar = await request(app).post("/api/admin/content/courses/import").set(eier).send({ payload: fil, mode: "updateExisting", targetId: courseId });
    expect(svar.status, JSON.stringify(svar.body).slice(0, 400)).toBe(201);
    expect(svar.body.summary.updatedSections).toBe(1);
    const byttet = (svar.body.summary.replacedUnownedIds as Array<{ type: string; oldId: string; newId: string }>).find((r) => r.oldId === fremmed);
    expect(byttet).toBeTruthy();

    // Egen seksjon: v2 med den nye tittelen, upublisert.
    const egenV2 = await prisma.courseSectionVersion.findUniqueOrThrow({ where: { sectionId_versionNo: { sectionId: egen, versionNo: 2 } } });
    expect(JSON.parse(egenV2.title!).nb).toBe(nyEgen);
    expect(egenV2.publishedAt).toBeNull();
    // Kopien av den fremmede: v1 er det deltakerne så (med den gamle tittelen, aktiv), v2 fila.
    const kopi = await prisma.courseSection.findUniqueOrThrow({
      where: { id: byttet!.newId },
      select: { activeVersion: { select: { versionNo: true, title: true } }, versions: { orderBy: { versionNo: "asc" }, select: { title: true, publishedAt: true } } },
    });
    expect(kopi.activeVersion?.versionNo).toBe(1);
    expect(JSON.parse(kopi.activeVersion!.title!).nb).toBe(fremmedTittel);
    expect(JSON.parse(kopi.versions[1]!.title!).nb).toBe(nyFremmed);
    expect(kopi.versions[1]!.publishedAt).toBeNull();
    // Deltakeren ser de gamle titlene.
    expect((await seen(courseId, byttet!.newId)).title).toBe(fremmedTittel);
    expect((await seen(courseId, egen)).title).not.toBe(nyEgen);
  });
});
