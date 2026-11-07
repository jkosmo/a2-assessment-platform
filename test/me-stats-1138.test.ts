import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { addDaysToKey, mondayOfKey, osloDayKey } from "../src/modules/reporting/activityReport.js";

// #1138: «Min statistikk» gjennom ruta, mot ekte Postgres. Utregningen per uke og humørregelen er
// dekket av test/unit/my-stats-1138.test.ts; her måles det bare ruta og databasen kan svare på:
//   - egne hendelser telles, andres aldri, og ingen vei fører til en annens statistikk;
//   - ukegrensen i Oslo-tid med ekte tidspunkt i databasen;
//   - samme seksjon lest to ganger i samme uke teller én gang;
//   - lesetida bruker seksjonsversjonen som gjaldt da brukeren leste, på brukerens språk.

const stamp = `${Date.now()}-${Math.round(performance.now())}`;
const DAY = 24 * 60 * 60 * 1000;

function headersFor(tag: string, roles = "PARTICIPANT", locale = "nb") {
  return {
    "x-user-id": `stats-${tag}-${stamp}`,
    "x-user-email": `stats-${tag}-${stamp}@x.test`,
    "x-user-name": `Stats ${tag}`,
    "x-user-roles": roles,
    "x-locale": locale,
  };
}

/** Tidspunktet for kl. hh:mm norsk tid på en dato (YYYY-MM-DD), med riktig sommer-/vintertid. */
function osloTime(key: string, hh: number, mm: number): Date {
  const [y, m, d] = key.split("-").map(Number);
  for (const offsetHours of [1, 2]) {
    const candidate = new Date(Date.UTC(y!, m! - 1, d!, hh, mm) - offsetHours * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(candidate);
    if (osloDayKey(candidate) === key && parts === `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`) return candidate;
  }
  throw new Error(`fant ikke ${key} ${hh}:${mm} i Oslo`);
}

const words = (n: number, word = "ord") => Array.from({ length: n }, () => word).join(" ");

describe("GET /api/me/stats (#1138)", () => {
  const userIds: Record<string, string> = {};
  const courseIds: string[] = [];
  const sectionIds: string[] = [];
  const submissionIds: string[] = [];
  let moduleId = "";
  let otherModuleId = "";
  let moduleVersionId = "";
  let otherModuleVersionId = "";

  // Ukene, regnet ut fra i dag i Oslo: denne uka (indeks 11) og de to før.
  const thisMonday = mondayOfKey(osloDayKey(new Date()));
  const lastMonday = addDaysToKey(thisMonday, -7);
  const twoMondaysAgo = addDaysToKey(thisMonday, -14);

  async function makeUser(tag: string) {
    const h = headersFor(tag);
    const user = await prisma.user.create({
      data: { externalId: h["x-user-id"], name: h["x-user-name"], email: h["x-user-email"] },
      select: { id: true },
    });
    userIds[tag] = user.id;
    return user.id;
  }

  async function section(body: Array<{ nb: string; "en-GB": string; publishedAt: Date }>) {
    const id = (await prisma.courseSection.create({ data: { title: JSON.stringify({ nb: "Seksjon" }) }, select: { id: true } })).id;
    sectionIds.push(id);
    let versionNo = 1;
    for (const v of body) {
      await prisma.courseSectionVersion.create({
        data: { sectionId: id, versionNo: versionNo++, bodyMarkdown: JSON.stringify({ nb: v.nb, "en-GB": v["en-GB"] }), publishedAt: v.publishedAt },
      });
    }
    return id;
  }

  async function pass(userId: string, modId: string, versionId: string, at: Date, score: number, passFailTotal = true) {
    const id = (await prisma.submission.create({
      data: { userId, moduleId: modId, moduleVersionId: versionId, deliveryType: "text", submissionStatus: "COMPLETED", submittedAt: new Date(at.getTime() - 60_000) },
      select: { id: true },
    })).id;
    submissionIds.push(id);
    await prisma.assessmentDecision.create({
      data: {
        submissionId: id, moduleVersionId: versionId, mcqScaledScore: 1, practicalScaledScore: 1, totalScore: score, redFlagsJson: "[]",
        passFailTotal, decisionType: "AUTOMATIC", decisionReason: "Fikstur for #1138.", finalisedAt: at,
      },
    });
  }

  beforeAll(async () => {
    for (const title of ["Kurs A", "Kurs B"]) {
      courseIds.push((await prisma.course.create({ data: { title: JSON.stringify({ nb: title }), publishedAt: new Date() }, select: { id: true } })).id);
    }
    moduleId = (await prisma.module.create({ data: { title: JSON.stringify({ nb: "Min modul", "en-GB": "My module" }) }, select: { id: true } })).id;
    moduleVersionId = (await prisma.moduleVersion.create({ data: { moduleId, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date() }, select: { id: true } })).id;
    otherModuleId = (await prisma.module.create({ data: { title: JSON.stringify({ nb: "Den andres modul" }) }, select: { id: true } })).id;
    otherModuleVersionId = (await prisma.moduleVersion.create({ data: { moduleId: otherModuleId, versionNo: 1, assessmentMode: "MCQ_ONLY", publishedAt: new Date() }, select: { id: true } })).id;

    const me = await makeUser("meg");
    const other = await makeUser("annen");
    await makeUser("admin");

    // Alle tidspunkt ligger i forrige og nest siste uke, så de alltid er passert når testen kjører.
    const longAgo = new Date(Date.now() - 400 * DAY);
    // s1: 400 ord på bokmål og 600 på engelsk da den ble lest. Versjon 2 (2000 ord) kom ETTER lesingen.
    const readS1 = osloTime(lastMonday, 0, 30); // mandag 00:30 forrige uke
    const s1 = await section([
      { nb: words(400), "en-GB": words(600, "word"), publishedAt: longAgo },
      { nb: words(2000), "en-GB": words(2000, "word"), publishedAt: new Date(readS1.getTime() + 60_000) },
    ]);
    // s2: lest søndag 23:30, en halvtime før s1 — men i uka før.
    const s2 = await section([{ nb: words(200), "en-GB": words(200, "word"), publishedAt: longAgo }]);
    // s3: bare den andre brukeren leser den.
    const s3 = await section([{ nb: words(5000), "en-GB": words(5000, "word"), publishedAt: longAgo }]);

    // Samme seksjon (s1) lest i to kurs samme uke: én seksjon, én gang lesetid.
    await prisma.courseSectionRead.create({ data: { userId: me, courseId: courseIds[0]!, sectionId: s1, readAt: readS1 } });
    await prisma.courseSectionRead.create({ data: { userId: me, courseId: courseIds[1]!, sectionId: s1, readAt: osloTime(lastMonday, 0, 45) } });
    await prisma.courseSectionRead.create({ data: { userId: me, courseId: courseIds[0]!, sectionId: s2, readAt: osloTime(addDaysToKey(lastMonday, -1), 23, 30) } });
    await pass(me, moduleId, moduleVersionId, osloTime(twoMondaysAgo, 10, 0), 87);
    await prisma.courseCompletion.create({ data: { userId: me, courseId: courseIds[0]!, moduleSnapshotJson: "[]", completedAt: osloTime(lastMonday, 12, 0) } });

    // Den andre brukeren: mye aktivitet i de samme ukene. Skal aldri telles hos meg.
    await prisma.courseSectionRead.create({ data: { userId: other, courseId: courseIds[0]!, sectionId: s3, readAt: osloTime(lastMonday, 1, 0) } });
    await prisma.courseSectionRead.create({ data: { userId: other, courseId: courseIds[1]!, sectionId: s2, readAt: osloTime(lastMonday, 1, 0) } });
    await pass(other, otherModuleId, otherModuleVersionId, osloTime(lastMonday, 2, 0), 99);
    await pass(other, moduleId, moduleVersionId, osloTime(twoMondaysAgo, 2, 0), 55);
    await prisma.courseCompletion.create({ data: { userId: other, courseId: courseIds[1]!, moduleSnapshotJson: "[]", completedAt: osloTime(lastMonday, 3, 0) } });
  });

  afterAll(async () => {
    const ids = Object.values(userIds);
    await prisma.assessmentDecision.deleteMany({ where: { submissionId: { in: submissionIds } } });
    await prisma.submission.deleteMany({ where: { id: { in: submissionIds } } });
    await prisma.courseCompletion.deleteMany({ where: { userId: { in: ids } } });
    await prisma.courseSectionRead.deleteMany({ where: { userId: { in: ids } } });
    await prisma.moduleVersion.deleteMany({ where: { id: { in: [moduleVersionId, otherModuleVersionId].filter(Boolean) } } });
    await prisma.module.deleteMany({ where: { id: { in: [moduleId, otherModuleId].filter(Boolean) } } });
    await prisma.courseSection.updateMany({ where: { id: { in: sectionIds } }, data: { activeVersionId: null } });
    await prisma.courseSectionVersion.deleteMany({ where: { sectionId: { in: sectionIds } } });
    await prisma.courseSection.deleteMany({ where: { id: { in: sectionIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    // Brukerne som ruta selv opprettet (administratoren) har samme merke.
    await prisma.user.deleteMany({ where: { OR: [{ id: { in: ids } }, { externalId: { contains: stamp } }] } });
    await prisma.$disconnect();
  });

  it("teller egne hendelser per uke i Oslo-tid, og aldri den andres", async () => {
    const res = await request(app).get("/api/me/stats").set(headersFor("meg"));
    expect(res.status).toBe(200);
    const weeks = res.body.weeks as Array<{ from: string; sectionsRead: number; modulesPassed: number; coursesCompleted: number; readingMinutes: number }>;
    expect(weeks).toHaveLength(12);
    expect(weeks[11]!.from).toBe(thisMonday);
    expect(weeks[10]!.from).toBe(lastMonday);

    // Denne uka: ingenting (den andres aktivitet er heller ikke her).
    expect(weeks[11]).toMatchObject({ sectionsRead: 0, modulesPassed: 0, coursesCompleted: 0, readingMinutes: 0 });
    // Forrige uke: s1 (lest i to kurs) én gang, 400 ord på bokmål = 2 min, og kurset. Ikke den andres s3.
    expect(weeks[10]).toMatchObject({ sectionsRead: 1, modulesPassed: 0, coursesCompleted: 1, readingMinutes: 2 });
    // Uka før: s2 søndag 23:30 (200 ord) og modulen.
    expect(weeks[9]).toMatchObject({ sectionsRead: 1, modulesPassed: 1, coursesCompleted: 0, readingMinutes: 1 });

    expect(res.body.totals).toEqual({ coursesCompleted: 1, modulesPassed: 1, sectionsRead: 2 });
    expect(res.body.recent).toMatchObject({ sectionsRead: 2, modulesPassed: 1, coursesCompleted: 1, readingMinutes: 3 });
    expect(res.body.passedModules).toEqual([
      { moduleId, moduleTitle: "Min modul", passedAt: osloTime(twoMondaysAgo, 10, 0).toISOString(), totalScore: 87 },
    ]);
    // Sist aktiv forrige uke.
    expect(res.body.mood).toBe("sulten");
  });

  it("lesetida og titlene følger brukerens språk", async () => {
    const res = await request(app).get("/api/me/stats").set(headersFor("meg", "PARTICIPANT", "en-GB"));
    expect(res.status).toBe(200);
    // 600 engelske ord i versjonen som gjaldt = 3 min; ikke de 2000 i versjonen som kom etterpå.
    expect(res.body.weeks[10].readingMinutes).toBe(3);
    expect(res.body.passedModules[0].moduleTitle).toBe("My module");
  });

  it("den andre brukeren ser bare sitt eget", async () => {
    const res = await request(app).get("/api/me/stats").set(headersFor("annen"));
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ coursesCompleted: 1, modulesPassed: 2, sectionsRead: 2 });
    expect((res.body.passedModules as Array<{ moduleId: string }>).map((m) => m.moduleId).sort()).toEqual([moduleId, otherModuleId].sort());
  });

  it("ingen vei til en annens statistikk: bruker-ID i spørrestrengen og i adressen virker ikke, heller ikke for administrator", async () => {
    const viaQuery = await request(app).get("/api/me/stats").query({ userId: userIds.meg }).set(headersFor("annen"));
    expect(viaQuery.status).toBe(200);
    // Fortsatt den andres egne tall, ikke mine.
    expect(viaQuery.body.totals).toEqual({ coursesCompleted: 1, modulesPassed: 2, sectionsRead: 2 });

    // En administrator uten egen aktivitet får sin egen tomme statistikk, uansett hva den spør om.
    const admin = await request(app).get("/api/me/stats").query({ userId: userIds.meg }).set(headersFor("admin", "ADMINISTRATOR"));
    expect(admin.status).toBe(200);
    expect(admin.body.totals).toEqual({ coursesCompleted: 0, modulesPassed: 0, sectionsRead: 0 });
    expect(admin.body.passedModules).toEqual([]);
    expect(admin.body.mood).toBe("ny");

    const viaPath = await request(app).get(`/api/me/stats/${userIds.meg}`).set(headersFor("admin", "ADMINISTRATOR"));
    expect(viaPath.status).toBe(404);
  });

  it("båtbildene fra e-postene serveres for profilen, og bare de", async () => {
    const boat = await request(app).get("/static/boat/vurdering-bestatt.jpg");
    expect(boat.status).toBe(200);
    expect(boat.headers["content-type"]).toBe("image/jpeg");
    const outside = await request(app).get("/static/boat/..%2Femail%2F..%2F..%2F..%2Fpackage.json");
    expect(outside.status).toBe(404);
  });
});
