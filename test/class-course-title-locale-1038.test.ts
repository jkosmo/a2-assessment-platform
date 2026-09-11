import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// ─────────────────────────────────────────────────────────────────────────────
// #1038: serveren eier «hvilket språk viser vi» — også på klasseskjermen.
//
// `GET /classes/:id/courses` sendte kurstittelen i lagringsformatet (språkkart som JSON), og
// `admin-content-classes.js` tolket den selv med kjeden nb → en-GB → nn → første. Serverens kjede
// er locale → en-GB → første. De to var uenige om en delvis oversatt tittel — og #892 gjør delvis
// oversatt til en lovlig tilstand, ikke en teoretisk kant.
//
// ⚠️ Testen måler SPRÅKET, ikke bare at det er en streng. En rute som returnerte `JSON.parse(x).nb`
// ville gitt en streng og vært like feil som før for en engelsk leser.
// ─────────────────────────────────────────────────────────────────────────────

const adminHeaders = {
  "x-user-id": "class-title-admin-ext",
  "x-user-email": "class-title-admin@company.com",
  "x-user-name": "Class Title Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const TITTEL = { nb: "Kurs på bokmål", "en-GB": "Course in English" };

async function opprettKursOgKlasse() {
  const course = await prisma.course.create({
    data: { title: JSON.stringify(TITTEL), enrollmentPolicy: "RESTRICTED", publishedAt: new Date() },
    select: { id: true },
  });
  const created = await request(app).post("/api/admin/content/classes").set(adminHeaders).send({ name: `Kull ${Date.now()}` });
  expect(created.status).toBe(201);
  const classId = created.body.class.id as string;
  const assigned = await request(app).post(`/api/admin/content/classes/${classId}/courses`).set(adminHeaders).send({ courseId: course.id });
  expect(assigned.status).toBe(201);
  return { courseId: course.id, classId };
}

describe("#1038 — klassens kurstitler kommer ferdig valgt for leserens språk", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⚠️ x-locale styrer tittelen på klassens tildelinger — begge språk, ikke bare bokmål", async () => {
    const { courseId, classId } = await opprettKursOgKlasse();
    const url = `/api/admin/content/classes/${classId}/courses`;

    const nb = await request(app).get(url).set(adminHeaders).set("x-locale", "nb");
    const en = await request(app).get(url).set(adminHeaders).set("x-locale", "en-GB");
    expect(nb.status).toBe(200);
    expect(en.status).toBe(200);

    const radNb = (nb.body.courses as Array<{ courseId: string; title: string }>).find((c) => c.courseId === courseId);
    const radEn = (en.body.courses as Array<{ courseId: string; title: string }>).find((c) => c.courseId === courseId);
    expect(radNb?.title).toBe(TITTEL.nb);
    expect(radEn?.title).toBe(TITTEL["en-GB"]);
    // Kontroll: ikke lagringsformatet.
    expect(radNb?.title.startsWith("{")).toBe(false);
  });

  it("⚠️ kurslista har `displayTitle` for leserens språk ved siden av lagringsformatet i `title`", async () => {
    // Forfatterkonsollet REDIGERER kartet og trenger `title` som før. Klasseskjermen bare VISER, og
    // skal slippe å ha sin egen mening om hva som gjelder når ett språk mangler.
    const { courseId } = await opprettKursOgKlasse();
    const en = await request(app).get("/api/admin/content/courses").set(adminHeaders).set("x-locale", "en-GB");
    expect(en.status).toBe(200);
    const rad = (en.body.courses as Array<{ id: string; title: string; displayTitle: string }>).find((c) => c.id === courseId);
    expect(rad?.displayTitle).toBe(TITTEL["en-GB"]);
    expect(rad?.title).toBe(JSON.stringify(TITTEL));
  });

  it("nynorsk uten egen tekst faller tilbake slik serveren gjør det overalt ellers — ikke på bokmål", async () => {
    // Serverens kjede er locale → en-GB → første. Klientens gamle kjede ville valgt bokmål her.
    // Det er nettopp den uenigheten saken handler om.
    const { courseId, classId } = await opprettKursOgKlasse();
    const nn = await request(app).get(`/api/admin/content/classes/${classId}/courses`).set(adminHeaders).set("x-locale", "nn");
    const rad = (nn.body.courses as Array<{ courseId: string; title: string }>).find((c) => c.courseId === courseId);
    expect(rad?.title).toBe(TITTEL["en-GB"]);
  });
});
