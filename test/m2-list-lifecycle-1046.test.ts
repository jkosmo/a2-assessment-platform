import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #1046 steg B: alle fire forfatterlistene svarer med samme `lifecycle`-felt, regnet ut av tjeneren.
// Testen går gjennom de ekte rutene og ser at feltet er der og sier det riktige — én rad per type,
// hentet gjennom lista, ikke gjennom detaljkallet.

const adminHeaders = {
  "x-user-id": "lifecycle-admin-ext",
  "x-user-email": "lifecycle-admin@company.com",
  "x-user-name": "Lifecycle Admin",
  "x-user-roles": "ADMINISTRATOR",
};
const L = (value: string) => ({ "en-GB": value, nb: value, nn: value });

describe("#1046 steg B — lifecycle på alle fire listene", () => {
  const rydd: Array<() => Promise<unknown>> = [];
  afterAll(async () => {
    for (const f of rydd.reverse()) await f().catch(() => undefined);
    await prisma.$disconnect();
  });

  it("kurs: draft → published → archived, lest fra lista", async () => {
    const created = await request(app).post("/api/admin/content/courses").set(adminHeaders).send({ title: `Lifecycle kurs ${Date.now()}` });
    expect(created.status).toBe(201);
    const id = created.body.course.id as string;
    rydd.push(() => prisma.course.delete({ where: { id } }));

    const finn = async () => (await request(app).get("/api/admin/content/courses").set(adminHeaders)).body.courses.find((c: { id: string }) => c.id === id);
    expect((await finn()).lifecycle).toBe("draft");

    await prisma.course.update({ where: { id }, data: { publishedAt: new Date() } });
    expect((await finn()).lifecycle).toBe("published");

    expect((await request(app).post(`/api/admin/content/courses/${id}/archive`).set(adminHeaders)).status).toBe(200);
    expect((await finn()).lifecycle).toBe("archived");
  });

  it("seksjoner: published, og published_with_draft når en nyere versjon enn den live finnes", async () => {
    const created = await request(app).post("/api/admin/content/sections").set(adminHeaders).send({ title: L("Lifecycle seksjon"), bodyMarkdown: L("# Innhold") });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.section.id as string;
    // Versjonene har onDelete: Restrict — løsne den live pekeren og fjern dem før seksjonen.
    rydd.push(async () => {
      await prisma.courseSection.update({ where: { id }, data: { activeVersionId: null } });
      await prisma.courseSectionVersion.deleteMany({ where: { sectionId: id } });
      await prisma.courseSection.delete({ where: { id } });
    });

    const finn = async () => (await request(app).get("/api/admin/content/sections").set(adminHeaders)).body.sections.find((s: { id: string }) => s.id === id);
    const rad = await finn();
    expect(["draft", "published"]).toContain(rad.lifecycle);

    // Pek den live versjonen bakover: nyeste versjon er da nyere enn den live → published_with_draft.
    const nyeste = await prisma.courseSectionVersion.findFirst({ where: { sectionId: id }, orderBy: { versionNo: "desc" } });
    const eldre = await prisma.courseSectionVersion.create({
      data: { sectionId: id, versionNo: (nyeste?.versionNo ?? 1) + 1, bodyMarkdown: nyeste?.bodyMarkdown ?? "x" },
    });
    await prisma.courseSection.update({ where: { id }, data: { activeVersionId: nyeste?.id ?? eldre.id } });
    expect((await finn()).lifecycle).toBe("published_with_draft");
  });

  it("moduler: lista bærer lifecycle ved siden av det gamle status-feltet", async () => {
    const created = await request(app).post("/api/admin/content/modules").set(adminHeaders).send({
      title: L(`Lifecycle modul ${Date.now()}`), description: L("Test"), certificationLevel: "foundation",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = (created.body.module?.id ?? created.body.id) as string;
    rydd.push(() => prisma.module.delete({ where: { id } }));

    const rad = (await request(app).get("/api/admin/content/modules/library").set(adminHeaders)).body.modules.find((m: { id: string }) => m.id === id);
    expect(rad).toBeTruthy();
    expect(["draft", "published", "published_with_draft", "archived"]).toContain(rad.lifecycle);
    // Et nyopprettet skall uten live versjon er et utkast — samme ord uansett hvor mange versjoner det har.
    expect(rad.lifecycle).toBe("draft");
  });

  it("klasser: active → archived", async () => {
    const created = await request(app).post("/api/admin/content/classes").set(adminHeaders).send({ name: `Lifecycle klasse ${Date.now()}` });
    expect(created.status).toBe(201);
    const id = created.body.class.id as string;
    rydd.push(() => prisma.class.delete({ where: { id } }));

    const finn = async () => (await request(app).get("/api/admin/content/classes").set(adminHeaders)).body.classes.find((c: { id: string }) => c.id === id);
    expect((await finn()).lifecycle).toBe("active");
    expect((await request(app).post(`/api/admin/content/classes/${id}/archive`).set(adminHeaders)).status).toBe(200);
    expect((await finn()).lifecycle).toBe("archived");
  });
});
