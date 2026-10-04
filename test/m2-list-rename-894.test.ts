// #894: omdøping i lista, og synlig oversettelsesstatus.
//
// Saken ble målt i klikk: en SMO døpte om 18 elementer, sju steg per element — over hundre
// interaksjoner. Verre enn tidsbruken var at den billigste veien ga feil resultat: et halvt kurs
// endte med titler på feil språk, uten at noe sa fra.
//
// Det tjenersiden må levere for at lista skal kunne gjøre jobben:
//   1. `titleLocales` på hver rad — hvilke språk tittelen FAKTISK finnes på.
//   2. En tittel-oversetter som slipper språk den ikke klarer, i stedet for å fylle dem med kilden.
//
// ⚠️ Punkt 2 er hele grunnen til at saken var blokkert av #892. Fylles et språk med kildeteksten,
// ser tittelen oversatt ut og leser som feil språk — og da hjelper ingen markering i lista.

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const admin = {
  "x-user-id": "admin-1",
  "x-user-email": "admin@company.com",
  "x-user-name": "Platform Admin",
};

async function createModule(title: unknown) {
  const res = await request(app).post("/api/admin/content/modules").set(admin).send({ title, certificationLevel: "basic" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.module.id as string;
}

async function libraryRow(moduleId: string) {
  const res = await request(app).get("/api/admin/content/modules/library").set(admin);
  expect(res.status).toBe(200);
  return (res.body.modules as Array<{ id: string; titleLocales?: string[] }>).find((m) => m.id === moduleId);
}

describe("#894 — lista kan vise hva som mangler oversettelse", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("en modul skrevet på ett språk rapporterer det ene språket", async () => {
    const stamp = Date.now();
    const id = await createModule({ nb: `Bare bokmål ${stamp}` });

    const row = await libraryRow(id);
    expect(row?.titleLocales).toEqual(["nb"]);
  });

  it("en fullt oversatt modul rapporterer alle tre", async () => {
    const stamp = Date.now();
    const id = await createModule({ nb: `Norsk ${stamp}`, nn: `Nynorsk ${stamp}`, "en-GB": `English ${stamp}` });

    const row = await libraryRow(id);
    expect(row?.titleLocales?.slice().sort()).toEqual(["en-GB", "nb", "nn"]);
  });

  it("en omdøping i ett språk endrer hva lista rapporterer — uten å røre de andre", async () => {
    const stamp = Date.now();
    const id = await createModule({ nb: `Før ${stamp}`, nn: `Før nynorsk ${stamp}` });
    expect((await libraryRow(id))?.titleLocales?.slice().sort()).toEqual(["nb", "nn"]);

    const patch = await request(app)
      .patch(`/api/admin/content/modules/${id}/title`)
      .set(admin)
      .send({ title: { nb: `Etter ${stamp}` } });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    // ⚠️ Nynorsk står fortsatt der — med den GAMLE teksten. Det er nettopp derfor lista må vise
    // status og tilby oversetting etterpå: en omdøping i ett språk gjør de andre utdaterte, ikke
    // tomme, og det er en tilstand ingenting sa fra om før.
    const row = await libraryRow(id);
    expect(row?.titleLocales?.slice().sort()).toEqual(["nb", "nn"]);
    const stored = await prisma.module.findUnique({ where: { id }, select: { title: true } });
    expect(JSON.parse(stored!.title)).toMatchObject({ nb: `Etter ${stamp}`, nn: `Før nynorsk ${stamp}` });
  });

  it("tittel-oversetteren svarer per språk og hopper over kildespråket", async () => {
    const res = await request(app)
      .post("/api/admin/content/titles/localize")
      .set(admin)
      .send({ title: "Risikovurdering i praksis", sourceLocale: "nb", targetLocales: ["nb", "nn", "en-GB"] });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Kildespråket oversettes ikke til seg selv.
    expect(res.body.title).not.toHaveProperty("nb");
    // I test-modus er oversetteren en stubb; det som betyr noe her er formen og at ingen språk
    // blir stille borte — hvert mål havner enten i `title` eller i `failedLocales`.
    const dekket = [...Object.keys(res.body.title), ...res.body.failedLocales].sort();
    expect(dekket).toEqual(["en-GB", "nn"]);
  });

  // ⚠️ FELLE, festet her fordi den er lett å gå i og umulig å se i ettertid.
  //
  // Er tittelen lagret som REN STRENG («skrevet på ett språk»), og du sender et språkkart som
  // patch, er grunnlaget for sammenslåingen TOMT (`localizedTitleMergeBase` returnerer {} for en
  // streng). Originalen forsvinner. Den som oversetter fra lista må derfor sende kildespråket MED
  // i patchen — ikke bare de nye språkene.
  it("⚠️ en patch uten kildespråket sletter en tittel som var lagret som ren streng", async () => {
    const stamp = Date.now();
    const id = await createModule(`Bare én tekst ${stamp}`);
    const før = await prisma.module.findUnique({ where: { id }, select: { title: true } });
    expect(før!.title).toBe(`Bare én tekst ${stamp}`);

    await request(app)
      .patch(`/api/admin/content/modules/${id}/title`)
      .set(admin)
      .send({ title: { nn: `Berre éin tekst ${stamp}` } });

    const etter = await prisma.module.findUnique({ where: { id }, select: { title: true } });
    // Originalen er BORTE — bare nynorsk står igjen. Slik er kontrakten i dag.
    expect(JSON.parse(etter!.title)).toEqual({ nn: `Berre éin tekst ${stamp}` });
  });

  it("patchen bevarer originalen når kildespråket sendes med", async () => {
    const stamp = Date.now();
    const id = await createModule(`Bare én tekst B ${stamp}`);

    await request(app)
      .patch(`/api/admin/content/modules/${id}/title`)
      .set(admin)
      .send({ title: { nb: `Bare én tekst B ${stamp}`, nn: `Berre éin tekst B ${stamp}` } });

    const etter = await prisma.module.findUnique({ where: { id }, select: { title: true } });
    expect(JSON.parse(etter!.title)).toEqual({
      nb: `Bare én tekst B ${stamp}`,
      nn: `Berre éin tekst B ${stamp}`,
    });
    expect((await libraryRow(id))?.titleLocales?.slice().sort()).toEqual(["nb", "nn"]);
  });

  it("en tom tittel avvises — vi oversetter ikke ingenting", async () => {
    const res = await request(app)
      .post("/api/admin/content/titles/localize")
      .set(admin)
      .send({ title: "   ", sourceLocale: "nb", targetLocales: ["nn"] });
    expect(res.status).toBe(400);
  });
});
