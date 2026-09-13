import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #931 pkt 5: seksjonseksport kunne lage en fil seksjonsimport avviste. Eksporten tillater 25 MB
// vedlegg (≈33 MB base64); importen lå under /sections-prefiksets 15 MB-grense. Fire figurer à 5 MB
// eksporterte fint og ga 413 ved import. Kursimport hadde alt sin egen 35 MB-grense (#749).

const admin = { "x-user-id": "admin-931", "x-user-email": "admin-931@company.com", "x-user-name": "A", "x-user-roles": "ADMINISTRATOR" };

describe("#931 pkt 5 — seksjonsimport tar imot det seksjonseksport kan lage", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⚠️ en kropp på 20 MB avvises ikke med 413 — den når fram til valideringen", async () => {
    // Ugyldig pakke med vilje: vi måler grensen, ikke importen. 400 = kroppen ble lest og avvist av
    // skjemaet; 413 = den kom aldri så langt.
    const body = { payload: { padding: "x".repeat(20 * 1024 * 1024) }, mode: "createNew" };
    const res = await request(app).post("/api/admin/content/sections/import").set(admin).send(body);
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(400);
  });

  it("kontroll: kursimport på samme størrelse oppfører seg likt", async () => {
    const body = { payload: { padding: "x".repeat(20 * 1024 * 1024) }, mode: "createNew" };
    const res = await request(app).post("/api/admin/content/courses/import").set(admin).send(body);
    expect(res.status).toBe(400);
  });
});
