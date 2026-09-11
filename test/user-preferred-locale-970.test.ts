import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

// Diskusjonsvarsler: `logOperationalEvent` er stille i test, og revisjonsraden bærer ikke emnet.
// Emnet fanges derfor ved senderen; resten av modulen går uendret gjennom (importOriginal).
const sendteDiskusjonsvarsler: Array<{ recipientEmail: string; subject: string }> = [];
vi.mock("../src/modules/certification/participantNotificationService.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/certification/participantNotificationService.js")>();
  return {
    ...original,
    sendDiscussionNotification: async (input: { recipientEmail: string; subject: string }) => {
      sendteDiskusjonsvarsler.push({ recipientEmail: input.recipientEmail, subject: input.subject });
      return { delivered: true, channel: "log", subject: input.subject, nextStepGuidance: "" };
    },
  };
});

import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// ─────────────────────────────────────────────────────────────────────────────
// #970: «sist sett»-språket skrives ved innlogging.
//
// Påminnelser og tildelingsvarsler har ingen besvarelse å lese språket fra. Valg A: kolonnen
// `User.preferredLocale` settes til forespørselens løste språk i samme skriving som `lastLoginAt`
// (`upsertUserFromPrincipal`). Ingen ny UI; en bruker som aldri har logget inn står som NULL.
//
// ⚠️ Testen måler at verdien FØLGER brukeren, ikke bare at den settes én gang. En implementasjon
// som skrev ved opprettelse og aldri mer ville bestått halve testen — og latt en bruker som byttet
// språk i appen få e-post på det gamle for alltid.
// ─────────────────────────────────────────────────────────────────────────────

const ext = `pl-${Date.now()}-${Math.round(performance.now())}`;
const headers = {
  "x-user-id": ext,
  "x-user-email": `${ext}@x.test`,
  "x-user-name": "Preferred Locale",
  "x-user-roles": "PARTICIPANT",
};

async function lagret() {
  const u = await prisma.user.findUnique({ where: { externalId: ext }, select: { preferredLocale: true } });
  return u?.preferredLocale ?? null;
}

describe("#970 — preferredLocale følger det språket brukeren sist hadde appen på", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⚠️ første innlogging skriver språket, neste med et annet språk overskriver det", async () => {
    expect((await request(app).get("/api/me").set(headers).set("x-locale", "nn")).status).toBe(200);
    expect(await lagret()).toBe("nn");

    expect((await request(app).get("/api/me").set(headers).set("x-locale", "en-GB")).status).toBe(200);
    expect(await lagret()).toBe("en-GB");
  });

  it("uten x-locale gjelder Accept-Language — samme oppløsning som resten av forespørselen", async () => {
    expect((await request(app).get("/api/me").set(headers).set("accept-language", "nb-NO,nb;q=0.9")).status).toBe(200);
    expect(await lagret()).toBe("nb");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Diskusjonsvarsler: den tredje senderen som var låst til bokmål. Abonnenten brukte sist appen på
// engelsk (x-locale da tråden ble opprettet) — svaret skal varsles på engelsk, selv om svareren
// skrev på bokmål. Det er ABONNENTENS språk som gjelder.
// ─────────────────────────────────────────────────────────────────────────────

describe("#970 — diskusjonsvarsler går på abonnentens språk", () => {
  it("⚠️ abonnent med en-GB får «New reply in: …», ikke «Nytt svar i: …»", async () => {
    const stamp = `${Date.now()}-${Math.round(performance.now())}`;
    const asker = { "x-user-id": `pl-asker-${stamp}`, "x-user-email": `pl-asker-${stamp}@x.test`, "x-user-name": "Asker", "x-user-roles": "PARTICIPANT" };
    const helper = { "x-user-id": `pl-helper-${stamp}`, "x-user-email": `pl-helper-${stamp}@x.test`, "x-user-name": "Helper", "x-user-roles": "PARTICIPANT" };
    const course = await prisma.course.create({
      data: { title: JSON.stringify({ "en-GB": "C", nb: "C", nn: "C" }), publishedAt: new Date() },
      select: { id: true },
    });

    // Spørreren bruker appen på engelsk → preferredLocale = en-GB, og hen er auto-abonnent på tråden.
    const q = await request(app)
      .post(`/api/courses/${course.id}/discussions`)
      .set(asker).set("x-locale", "en-GB")
      .send({ kind: "QUESTION", title: `Locale ${stamp}`, bodyMarkdown: "Why?" });
    expect(q.status).toBe(201);

    const reply = await request(app)
      .post(`/api/courses/${course.id}/discussions/${q.body.thread.id}/replies`)
      .set(helper).set("x-locale", "nb")
      .send({ bodyMarkdown: "Because." });
    expect(reply.status).toBe(201);

    const tilAsker = sendteDiskusjonsvarsler.filter((v) => v.recipientEmail === asker["x-user-email"]);
    expect(tilAsker.length, "ett varsel til abonnenten").toBe(1);
    expect(tilAsker[0].subject).toBe(`New reply in: Locale ${stamp}`);
  });
});
