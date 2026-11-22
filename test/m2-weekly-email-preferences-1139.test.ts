import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1139 skive 2 (doc/design/PLAN_1139.md, punkt 4 og 5): bryteren «Ukentlig e-post fra båten». Gjennom rutene, som profilen bruker.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const person = () => {
  const id = `ukentlig1139-${RUN}-${seq++}`;
  return { "x-user-id": id, "x-user-email": `${id}@x.test`, "x-user-name": "Deltaker", "x-user-roles": "PARTICIPANT" };
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe("#1139: avmeldingen", () => {
  it("på som standard; av og på igjen gjennom ruta; /api/me viser det som er lagret", async () => {
    const me = person();
    const first = await request(app).get("/api/me").set(me);
    expect(first.status).toBe(200);
    expect(first.body.preferences).toEqual({ weeklyEmail: true });

    const off = await request(app).put("/api/me/preferences").set(me).send({ weeklyEmail: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body).toEqual({ preferences: { weeklyEmail: false } });
    expect((await request(app).get("/api/me").set(me)).body.preferences).toEqual({ weeklyEmail: false });
    const stored = await prisma.user.findUniqueOrThrow({ where: { externalId: me["x-user-id"] }, select: { weeklyEmailEnabled: true } });
    expect(stored.weeklyEmailEnabled).toBe(false);

    const on = await request(app).put("/api/me/preferences").set(me).send({ weeklyEmail: true });
    expect(on.body).toEqual({ preferences: { weeklyEmail: true } });
  });

  it("gjelder alltid den innloggede: en bruker-id i forespørselen avvises, og en annen persons innstilling står", async () => {
    const me = person();
    const other = person();
    await request(app).get("/api/me").set(other);
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { externalId: other["x-user-id"] }, select: { id: true } });

    const withId = await request(app).put("/api/me/preferences").set(me).send({ weeklyEmail: false, userId: otherUser.id });
    expect(withId.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: otherUser.id }, select: { weeklyEmailEnabled: true } })).weeklyEmailEnabled).toBe(true);

    await request(app).put("/api/me/preferences").set(me).send({ weeklyEmail: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: otherUser.id }, select: { weeklyEmailEnabled: true } })).weeklyEmailEnabled).toBe(true);
  });

  it("feil form gir 400 og endrer ingenting", async () => {
    const me = person();
    for (const body of [{}, { weeklyEmail: "false" }, { weeklyEmail: 0 }, { weekly: false }]) {
      const response = await request(app).put("/api/me/preferences").set(me).send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect((await request(app).get("/api/me").set(me)).body.preferences).toEqual({ weeklyEmail: true });
  });

  it("innsynet tar med innstillingen", async () => {
    const me = person();
    await request(app).put("/api/me/preferences").set(me).send({ weeklyEmail: false });
    const data = await request(app).get("/api/me/data").set(me);
    expect(data.status).toBe(200);
    expect(JSON.stringify(data.body)).toContain('"weeklyEmailEnabled":false');
  });
});
