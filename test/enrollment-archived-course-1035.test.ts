import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const admin = {
  "x-user-id": "arkiv-innmelding-admin",
  "x-user-email": "arkiv.innmelding@company.com",
  "x-user-name": "Arkiv Innmelding",
  "x-user-roles": "ADMINISTRATOR",
};

function deltaker(id: string) {
  return {
    "x-user-id": id,
    "x-user-email": `${id}@company.com`,
    "x-user-name": id,
    "x-user-roles": "PARTICIPANT",
  };
}

async function bruker(tag: string) {
  const stamp = `${Date.now()}-${Math.round(performance.now())}`;
  return prisma.user.create({
    data: { externalId: `1035-${tag}-${stamp}`, name: tag, email: `1035-${tag}-${stamp}@x.test`, department: "QA" },
    select: { id: true, externalId: true },
  });
}

async function kurs(opts: { archived?: boolean; published?: boolean; policy?: "OPEN" | "RESTRICTED" } = {}) {
  const c = await prisma.course.create({
    data: {
      title: JSON.stringify({ "en-GB": `1035 ${Date.now()}-${Math.round(performance.now())}` }),
      enrollmentPolicy: opts.policy ?? "OPEN",
      publishedAt: opts.published === false ? null : new Date(),
      archivedAt: opts.archived ? new Date() : null,
    },
    select: { id: true },
  });
  return c.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// #1035: to veier inn til «denne personen skal ta dette kurset», og bare den ene sjekket om
// kurset var levende.
//
// Klassetildeling blokkerer arkiverte kurs (#688). Individuell innmelding gjorde det ikke — en
// deltaker kunne meldes inn, med frist, på et kurs som var pensjonert. #967 gjorde skaden mindre
// ved å stoppe påminnelsene, men også MER STILLE: raden ble liggende uten at noe skjedde og uten at
// noen fikk beskjed.
//
// ⚠️ UPUBLISERT BLOKKERES IKKE. «Meld inn nå, publiser senere» er en legitim arbeidsflyt, og
// klasseveien blokkerer heller ikke det. De to veiene skal si det samme — det er hele poenget.
// ─────────────────────────────────────────────────────────────────────────────

describe("#1035 — individuell innmelding blokkerer arkiverte kurs, som klasseveien", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⚠️ administrator kan ikke melde noen inn på et arkivert kurs", async () => {
    const courseId = await kurs({ archived: true });
    const learner = await bruker("a");
    const svar = await request(app)
      .post(`/api/admin/content/courses/${courseId}/enrollments`)
      .set(admin)
      .send({ userIds: [learner.id] });

    expect(svar.status).toBe(400);
    // ⚠️ SAMME KODE som klasseveien (#688), så klienten oversetter dem likt. Et pensjonert kurs
    // skal ikke ha én forklaring på klasseskjermen og en annen på kursskjermen.
    expect(svar.body.error).toBe("course_archived");
  });

  it("KONTROLL: deltakerveien var allerede stengt — arkiverte kurs er usynlige for deltakere", async () => {
    // ⚠️ Jeg antok først at også denne døra sto åpen, og ventet 400 `course_archived`. Den gir 404:
    // `POST /api/courses/:id/enroll` sjekker `archivedAt` selv (courses.ts) FØR den kaller
    // `selfEnroll`, fordi et arkivert kurs ikke skal finnes for en deltaker i det hele tatt.
    //
    // Så #1035 sitt hull var admin-veien ALENE. Vakta i `selfEnroll` er tjenestens eget vern for en
    // framtidig direkte kaller — ikke det som beskytter deltakeren i dag. Det er ruta som gjør det,
    // og denne testen fester at den fortsetter med det.
    const courseId = await kurs({ archived: true, policy: "OPEN" });
    const svar = await request(app)
      .post(`/api/courses/${courseId}/enroll`)
      .set(deltaker("1035-selv"))
      .send({});

    expect(svar.status, "et arkivert kurs skal ikke finnes for en deltaker").toBe(404);
  });

  it("⚠️ KONTROLL: et UPUBLISERT kurs kan fortsatt tildeles", async () => {
    // Blokkeringens makker. Saken tok stilling: «meld inn nå, publiser senere» er legitimt, og
    // #967 valgte av samme grunn å undertrykke e-posten framfor å blokkere. Uten denne testen kunne
    // vakta blitt for bred og stengt en arbeidsflyt forfattere faktisk bruker.
    const courseId = await kurs({ published: false });
    const learner = await bruker("b");
    const svar = await request(app)
      .post(`/api/admin/content/courses/${courseId}/enrollments`)
      .set(admin)
      .send({ userIds: [learner.id] });

    expect(svar.status, `upublisert skal gå gjennom: ${JSON.stringify(svar.body).slice(0, 200)}`).toBeLessThan(300);
  });

  it("⚠️ KONTROLL: opprydding i et arkivert kurs går fortsatt — avmelding og listing", async () => {
    // Fire funksjoner deler `requireCourse`. Hadde vakta ligget der, ville vi låst døra UT sammen
    // med døra inn: ingen kunne fjernet noen fra et pensjonert kurs, eller sett hvem som sto der.
    const courseId = await kurs({ archived: false });
    const learner = await bruker("c");
    const inn = await request(app)
      .post(`/api/admin/content/courses/${courseId}/enrollments`)
      .set(admin)
      .send({ userIds: [learner.id] });
    expect(inn.status, `innmelding: ${JSON.stringify(inn.body).slice(0, 150)}`).toBeLessThan(300);

    await prisma.course.update({ where: { id: courseId }, data: { archivedAt: new Date() } });

    const liste = await request(app).get(`/api/admin/content/courses/${courseId}/enrollments`).set(admin);
    expect(liste.status, "listing av et arkivert kurs skal gå").toBe(200);

    const ut = await request(app)
      .delete(`/api/admin/content/courses/${courseId}/enrollments/${learner.id}`)
      .set(admin);
    expect(ut.status, "avmelding fra et arkivert kurs skal gå").toBeLessThan(300);
  });
});
