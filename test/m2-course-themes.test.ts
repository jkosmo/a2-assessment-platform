// 2.102.0: tema i «Mine kurs».
//
// Produkteier, 2026-10-25: kursene samles etter tema i «Mine kurs». Det testen måler, og hvorfor:
//   - Bare administrator lager, endrer og sletter tema. Fagansvarlig kan lese lista (hen må kunne
//     velge tema for sitt kurs), men får 403 på endringer.
//   - Et kurs kan få flere tema; lagringen setter NØYAKTIG de valgte, og et tema som ikke finnes,
//     avvises i stedet for å hoppes stille over.
//   - PUT uten `themeIds` lar temaene stå — en lagring av tittelen skal ikke viske dem ut.
//   - «Mine kurs» får temaene per kurs og en samlet liste, alfabetisk i deltakerens språk.
//   - Slettes et tema, mister kursene bare koblingen.

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const stamp = `${Date.now()}`;
const L = (nb: string, nn: string, en: string) => JSON.stringify({ "en-GB": en, nb, nn });

function headersFor(role: "ADMINISTRATOR" | "SUBJECT_MATTER_OWNER" | "PARTICIPANT", who: string, locale = "nb") {
  const externalId = `theme-${who}-${stamp}`;
  return {
    "x-user-id": externalId,
    "x-user-email": `${externalId}@company.com`,
    "x-user-name": who,
    "x-user-roles": role,
    "x-locale": locale,
  };
}

const admin = headersFor("ADMINISTRATOR", "admin");
const smo = headersFor("SUBJECT_MATTER_OWNER", "smo");

const createdThemeIds: string[] = [];
const createdCourseIds: string[] = [];

async function createTheme(nb: string, nn: string, en: string) {
  const res = await request(app).post("/api/admin/content/themes").set(admin).send({ name: { nb, nn, "en-GB": en } });
  expect(res.status).toBe(201);
  createdThemeIds.push(res.body.theme.id);
  return res.body.theme.id as string;
}

async function publishedCourse(nb: string) {
  const course = await prisma.course.create({ data: { title: L(nb, nb, nb), publishedAt: new Date() }, select: { id: true } });
  createdCourseIds.push(course.id);
  return course.id;
}

afterAll(async () => {
  await prisma.courseThemeAssignment.deleteMany({ where: { courseId: { in: createdCourseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
  await prisma.courseTheme.deleteMany({ where: { id: { in: createdThemeIds } } });
});

describe("2.102.0 tema i «Mine kurs»", () => {
  it("bare administrator endrer temalisten; fagansvarlig kan lese den", async () => {
    const themeId = await createTheme(`Tilgang ${stamp}`, `Tilgang ${stamp}`, `Access ${stamp}`);

    const created = await request(app).post("/api/admin/content/themes").set(smo).send({ name: { nb: "Nei" } });
    expect(created.status).toBe(403);
    const renamed = await request(app).put(`/api/admin/content/themes/${themeId}`).set(smo).send({ name: { nb: "Nei" } });
    expect(renamed.status).toBe(403);
    const deleted = await request(app).delete(`/api/admin/content/themes/${themeId}`).set(smo);
    expect(deleted.status).toBe(403);

    const list = await request(app).get("/api/admin/content/themes").set(smo);
    expect(list.status).toBe(200);
    expect(list.body.themes.some((t: { id: string }) => t.id === themeId)).toBe(true);
  });

  it("bokmål er påkrevd", async () => {
    const res = await request(app).post("/api/admin/content/themes").set(admin).send({ name: { "en-GB": "Only English" } });
    expect(res.status).toBe(400);
  });

  it("kurset får nøyaktig de valgte temaene, og en lagring uten themeIds lar dem stå", async () => {
    const a = await createTheme(`A ${stamp}`, `A ${stamp}`, `A ${stamp}`);
    const b = await createTheme(`B ${stamp}`, `B ${stamp}`, `B ${stamp}`);
    const courseId = await publishedCourse(`Kurs med tema ${stamp}`);

    const both = await request(app).put(`/api/admin/content/courses/${courseId}`).set(admin).send({ themeIds: [a, b] });
    expect(both.status).toBe(200);
    let detail = await request(app).get(`/api/admin/content/courses/${courseId}`).set(admin);
    expect([...detail.body.course.themeIds].sort()).toEqual([a, b].sort());

    // En vanlig lagring av kursets felter, uten themeIds: temaene står.
    const titleOnly = await request(app).put(`/api/admin/content/courses/${courseId}`).set(admin).send({ sortOrder: 3 });
    expect(titleOnly.status).toBe(200);
    detail = await request(app).get(`/api/admin/content/courses/${courseId}`).set(admin);
    expect([...detail.body.course.themeIds].sort()).toEqual([a, b].sort());

    const onlyB = await request(app).put(`/api/admin/content/courses/${courseId}`).set(admin).send({ themeIds: [b] });
    expect(onlyB.status).toBe(200);
    detail = await request(app).get(`/api/admin/content/courses/${courseId}`).set(admin);
    expect(detail.body.course.themeIds).toEqual([b]);

    const none = await request(app).put(`/api/admin/content/courses/${courseId}`).set(admin).send({ themeIds: [] });
    expect(none.status).toBe(200);
    detail = await request(app).get(`/api/admin/content/courses/${courseId}`).set(admin);
    expect(detail.body.course.themeIds).toEqual([]);
  });

  it("et tema som ikke finnes, avvises — og ingenting lagres", async () => {
    const a = await createTheme(`Finnes ${stamp}`, `Finst ${stamp}`, `Exists ${stamp}`);
    const courseId = await publishedCourse(`Kurs ukjent tema ${stamp}`);
    const res = await request(app).put(`/api/admin/content/courses/${courseId}`).set(admin).send({ themeIds: [a, "finnes-ikke"], sortOrder: 7 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("course_theme_not_found");
    const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { sortOrder: true } });
    expect(course.sortOrder).toBeNull();
    expect(await prisma.courseThemeAssignment.count({ where: { courseId } })).toBe(0);
  });

  it("et nytt kurs kan få tema med en gang", async () => {
    const a = await createTheme(`Nytt ${stamp}`, `Nytt ${stamp}`, `New ${stamp}`);
    const res = await request(app).post("/api/admin/content/courses").set(admin).send({ title: { nb: `Nytt kurs ${stamp}` }, themeIds: [a] });
    expect(res.status).toBe(201);
    createdCourseIds.push(res.body.course.id);
    const detail = await request(app).get(`/api/admin/content/courses/${res.body.course.id}`).set(admin);
    expect(detail.body.course.themeIds).toEqual([a]);
  });

  it("«Mine kurs» viser temaene per kurs og en samlet liste, alfabetisk i deltakerens språk", async () => {
    // Navnene sorterer ulikt på nynorsk og engelsk, så rekkefølgen viser hvilket språk som ble brukt.
    const x = await createTheme(`Øving ${stamp}`, `Øving ${stamp}`, `Alpha ${stamp}`);
    const y = await createTheme(`Begynnelse ${stamp}`, `Byrjing ${stamp}`, `Zulu ${stamp}`);
    const courseId = await publishedCourse(`Mine kurs-tema ${stamp}`);
    await request(app).put(`/api/admin/content/courses/${courseId}`).set(admin).send({ themeIds: [x, y] }).expect(200);

    const nb = await request(app).get("/api/courses").set(headersFor("PARTICIPANT", "deltaker", "nb"));
    expect(nb.status).toBe(200);
    const course = nb.body.courses.find((c: { id: string }) => c.id === courseId);
    expect(course.themes.map((t: { name: string }) => t.name)).toEqual([`Begynnelse ${stamp}`, `Øving ${stamp}`]);
    const listed = nb.body.themes.filter((t: { id: string }) => t.id === x || t.id === y).map((t: { id: string }) => t.id);
    expect(listed).toEqual([y, x]);

    const en = await request(app).get("/api/courses").set(headersFor("PARTICIPANT", "deltaker", "en-GB"));
    const enListed = en.body.themes.filter((t: { id: string }) => t.id === x || t.id === y).map((t: { name: string }) => t.name);
    expect(enListed).toEqual([`Alpha ${stamp}`, `Zulu ${stamp}`]);
  });

  it("den samlede lista er alfabetisk også når temaene kommer fra hvert sitt kurs", async () => {
    // Kursene står alfabetisk (#1093): «Alfa-kurs» før «Beta-kurs». (Ikke «Aa»: på norsk sorteres det som «Å».) Temaene deres står motsatt vei, så en
    // liste i den rekkefølgen kursene kom i, ville gitt Ø før B.
    const late = await createTheme(`Ølandet ${stamp}`, `Ølandet ${stamp}`, `Late ${stamp}`);
    const early = await createTheme(`Bakkene ${stamp}`, `Bakkane ${stamp}`, `Early ${stamp}`);
    const first = await publishedCourse(`Alfa-kurs ${stamp}`);
    const second = await publishedCourse(`Beta-kurs ${stamp}`);
    await request(app).put(`/api/admin/content/courses/${first}`).set(admin).send({ themeIds: [late] }).expect(200);
    await request(app).put(`/api/admin/content/courses/${second}`).set(admin).send({ themeIds: [early] }).expect(200);

    const res = await request(app).get("/api/courses").set(headersFor("PARTICIPANT", "deltaker2", "nb"));
    const ids = res.body.courses.map((c: { id: string }) => c.id);
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
    const listed = res.body.themes.filter((t: { id: string }) => t.id === late || t.id === early).map((t: { id: string }) => t.id);
    expect(listed).toEqual([early, late]);
  });

  it("kursoversikten i innholdsforvaltningen har temaene per kurs", async () => {
    const a = await createTheme(`Oversikt ${stamp}`, `Oversikt ${stamp}`, `Overview ${stamp}`);
    const courseId = await publishedCourse(`Kurs i oversikt ${stamp}`);
    await request(app).put(`/api/admin/content/courses/${courseId}`).set(admin).send({ themeIds: [a] }).expect(200);
    const list = await request(app).get("/api/admin/content/courses").set(admin);
    const row = list.body.courses.find((c: { id: string }) => c.id === courseId);
    expect(row.themes).toEqual([{ id: a, name: `Oversikt ${stamp}` }]);
  });

  it("et slettet tema forsvinner fra kursene, og kursene står", async () => {
    const a = await createTheme(`Slettes ${stamp}`, `Slettast ${stamp}`, `Deleted ${stamp}`);
    const courseId = await publishedCourse(`Kurs mister tema ${stamp}`);
    await request(app).put(`/api/admin/content/courses/${courseId}`).set(admin).send({ themeIds: [a] }).expect(200);

    const list = await request(app).get("/api/admin/content/themes").set(admin);
    expect(list.body.themes.find((t: { id: string }) => t.id === a).courseCount).toBe(1);

    const res = await request(app).delete(`/api/admin/content/themes/${a}`).set(admin);
    expect(res.status).toBe(200);
    expect(res.body.detachedCourseCount).toBe(1);
    expect(await prisma.course.count({ where: { id: courseId } })).toBe(1);
    const detail = await request(app).get(`/api/admin/content/courses/${courseId}`).set(admin);
    expect(detail.body.course.themeIds).toEqual([]);

    const again = await request(app).delete(`/api/admin/content/themes/${a}`).set(admin);
    expect(again.status).toBe(404);
  });
});
