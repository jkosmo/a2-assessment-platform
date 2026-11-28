import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1194: `?locale=` ble sendt rått videre fra modulbiblioteket og modularkivet. En tittel lagret som ren streng slås opp i
// tekstsamlingen for språket, og `contentMessages["nb-NO"]` er undefined, så `?locale=nb-NO` ga 500. Nå normaliseres verdien;
// et ukjent språk gir forespørselens språk.

const admin = { "x-user-id": "loc-1194-admin", "x-user-email": "loc-1194@x.test", "x-user-name": "Adm", "x-user-roles": "ADMINISTRATOR" };
const tittel = `Ren strengtittel 1194 ${Date.now()}`;
let moduleId: string | null = null;

afterAll(async () => {
  if (moduleId) {
    await prisma.moduleVersion.deleteMany({ where: { moduleId } }).catch(() => undefined);
    await prisma.module.delete({ where: { id: moduleId } }).catch(() => undefined);
  }
});

describe("#1194 — ?locale= normaliseres i modulbiblioteket og modularkivet", () => {
  it("en modul med ren strengtittel finnes (forutsetningen for feilen)", async () => {
    const res = await request(app).post("/api/admin/content/modules").set(admin).send({ title: tittel, description: "Beskrivelse" });
    expect(res.status).toBe(201);
    moduleId = res.body.module?.id ?? res.body.id ?? null;
    expect(moduleId).toBeTruthy();
    const lagret = await prisma.module.findUnique({ where: { id: moduleId! }, select: { title: true } });
    // Kontroll: tittelen er lagret som ren streng, ikke som språkkart — ellers måler testen en annen vei.
    expect(lagret?.title).toBe(tittel);
  });

  for (const verdi of ["nb-NO", "NB", "no", "xx", ""]) {
    it(`/modules/library?locale=${verdi} svarer 200 og viser modulen`, async () => {
      const res = await request(app).get(`/api/admin/content/modules/library?locale=${encodeURIComponent(verdi)}`).set(admin);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain(tittel);
    });
  }

  it("/modules/archive?locale=nb-NO svarer 200", async () => {
    const res = await request(app).get("/api/admin/content/modules/archive?locale=nb-NO").set(admin);
    expect(res.status).toBe(200);
  });
});
