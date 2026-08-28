import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// #787 slice 4b: ownership enforcement on course/section/class write paths. The creator owns what they
// make (4a), a non-owner SMO is blocked (403 content_ownership), and ADMINISTRATOR bypasses. This is the
// deliberate behavior change — previously any SMO could mutate any content.

const smoA = { "x-user-id": "enf-a", "x-user-email": "enf-a@x.test", "x-user-name": "A", "x-user-roles": "SUBJECT_MATTER_OWNER" };
const smoB = { "x-user-id": "enf-b", "x-user-email": "enf-b@x.test", "x-user-name": "B", "x-user-roles": "SUBJECT_MATTER_OWNER" };
const admin = { "x-user-id": "enf-admin", "x-user-email": "enf-admin@x.test", "x-user-name": "Adm", "x-user-roles": "ADMINISTRATOR" };
const L = (s: string) => ({ "en-GB": s, nb: s, nn: s });

describe("content ownership enforcement (#787 slice 4b)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("COURSE: non-owner SMO is blocked, owner + admin allowed", async () => {
    const create = await request(app).post("/api/admin/content/courses").set(smoA).send({ title: L("Enf course") });
    expect(create.status).toBe(201);
    const id = create.body.course.id as string;

    const bRes = await request(app).put(`/api/admin/content/courses/${id}`).set(smoB).send({ title: L("hijack") });
    expect(bRes.status).toBe(403);
    expect(bRes.body.error).toBe("content_ownership");

    expect((await request(app).put(`/api/admin/content/courses/${id}`).set(smoA).send({ title: L("owner edit") })).status).toBe(200);
    expect((await request(app).put(`/api/admin/content/courses/${id}`).set(admin).send({ title: L("admin edit") })).status).toBe(200);
  });

  it("SECTION: non-owner SMO is blocked, owner + admin allowed", async () => {
    const create = await request(app).post("/api/admin/content/sections").set(smoA).send({ title: L("Enf section"), bodyMarkdown: "# S" });
    expect(create.status).toBe(201);
    const id = create.body.section.id as string;

    const bRes = await request(app).put(`/api/admin/content/sections/${id}/content`).set(smoB).send({ bodyMarkdown: "# hijack" });
    expect(bRes.status).toBe(403);
    expect(bRes.body.error).toBe("content_ownership");

    expect((await request(app).put(`/api/admin/content/sections/${id}/content`).set(smoA).send({ bodyMarkdown: "# owner" })).status).toBe(200);
    expect((await request(app).put(`/api/admin/content/sections/${id}/content`).set(admin).send({ bodyMarkdown: "# admin" })).status).toBe(200);
  });

  it("CLASS: non-owner SMO is blocked on delete, owner allowed", async () => {
    const create = await request(app).post("/api/admin/content/classes").set(smoA).send({ name: `Enf-${Date.now()}` });
    expect(create.status).toBe(201);
    const id = create.body.class.id as string;

    const bRes = await request(app).delete(`/api/admin/content/classes/${id}`).set(smoB);
    expect(bRes.status).toBe(403);
    expect(bRes.body.error).toBe("content_ownership");

    expect([200, 204]).toContain((await request(app).delete(`/api/admin/content/classes/${id}`).set(smoA)).status);
  });

  // #787 slice 5 (list UX): the list endpoints annotate each row with `canManage` so the UI hides the
  // edit/lifecycle actions the guard above would 403 on. Owner + admin ⇒ true; a non-owner SMO ⇒ false.
  const canManageOf = (rows: Array<{ id: string; canManage?: boolean }>, id: string) =>
    rows.find((r) => r.id === id)?.canManage;

  it("SECTION list: canManage true for owner+admin, false for non-owner", async () => {
    const create = await request(app).post("/api/admin/content/sections").set(smoA).send({ title: L("Mng section"), bodyMarkdown: "# S" });
    const id = create.body.section.id as string;
    expect(canManageOf((await request(app).get("/api/admin/content/sections").set(smoA)).body.sections, id)).toBe(true);
    expect(canManageOf((await request(app).get("/api/admin/content/sections").set(smoB)).body.sections, id)).toBe(false);
    expect(canManageOf((await request(app).get("/api/admin/content/sections").set(admin)).body.sections, id)).toBe(true);
  });

  it("COURSE list: canManage true for owner+admin, false for non-owner", async () => {
    const create = await request(app).post("/api/admin/content/courses").set(smoA).send({ title: L("Mng course") });
    const id = create.body.course.id as string;
    expect(canManageOf((await request(app).get("/api/admin/content/courses").set(smoA)).body.courses, id)).toBe(true);
    expect(canManageOf((await request(app).get("/api/admin/content/courses").set(smoB)).body.courses, id)).toBe(false);
    expect(canManageOf((await request(app).get("/api/admin/content/courses").set(admin)).body.courses, id)).toBe(true);
  });

  it("CLASS list: canManage true for owner+admin, false for non-owner", async () => {
    const create = await request(app).post("/api/admin/content/classes").set(smoA).send({ name: `Mng-${Date.now()}` });
    const id = create.body.class.id as string;
    expect(canManageOf((await request(app).get("/api/admin/content/classes").set(smoA)).body.classes, id)).toBe(true);
    expect(canManageOf((await request(app).get("/api/admin/content/classes").set(smoB)).body.classes, id)).toBe(false);
    expect(canManageOf((await request(app).get("/api/admin/content/classes").set(admin)).body.classes, id)).toBe(true);
  });

  it("MODULE library: canManage true for owner+admin, false for non-owner", async () => {
    const create = await request(app).post("/api/admin/content/modules").set(smoA).send({ title: L(`Mng module ${Date.now()}`) });
    expect(create.status).toBe(201);
    const id = create.body.module.id as string;
    expect(canManageOf((await request(app).get("/api/admin/content/modules/library").set(smoA)).body.modules, id)).toBe(true);
    expect(canManageOf((await request(app).get("/api/admin/content/modules/library").set(smoB)).body.modules, id)).toBe(false);
    expect(canManageOf((await request(app).get("/api/admin/content/modules/library").set(admin)).body.modules, id)).toBe(true);
  });

  // ── #943: LESING av eget innhold var uguardet mens skrivingen var guardet ──────────────────────
  //
  // ⚠️ Poenget med disse er ikke at 403 kommer, men HVEM den kommer for. En vakt som avviser alle
  // ville også vært grønn på «B får 403». Hver test krever derfor tre svar av samme rute: eieren
  // slipper inn, den fremmede avvises, administrator slipper inn. Bare da måler den en avgrensning
  // og ikke en stengt dør.

  it("COURSE-lesing: detalj, items og publish-preview er vaktet som skriverutene", async () => {
    const create = await request(app).post("/api/admin/content/courses").set(smoA).send({ title: L("Read-guard course") });
    expect(create.status).toBe(201);
    const id = create.body.course.id as string;

    for (const path of [`/api/admin/content/courses/${id}`, `/api/admin/content/courses/${id}/items`, `/api/admin/content/courses/${id}/publish-preview`]) {
      expect((await request(app).get(path).set(smoA)).status, `${path} eier`).toBe(200);
      expect((await request(app).get(path).set(admin)).status, `${path} admin`).toBe(200);

      const blocked = await request(app).get(path).set(smoB);
      expect(blocked.status, `${path} fremmed SMO`).toBe(403);
      expect(blocked.body.error).toBe("content_ownership");
    }
  });

  // Lista skal FORTSATT være åpen. Den er hvordan man finner sine egne kurs, og hver rad bærer
  // allerede `canManage`. Uten denne testen ville en senere «stram alt»-runde kunne lukke lista
  // uten at noe ble rødt — og da fant ingen SMO fram til noe som helst.
  it("COURSE-lista forblir lesbar for en fremmed SMO, med canManage: false", async () => {
    const create = await request(app).post("/api/admin/content/courses").set(smoA).send({ title: L("Listed course") });
    const id = create.body.course.id as string;

    const list = await request(app).get("/api/admin/content/courses").set(smoB);
    expect(list.status).toBe(200);
    const row = (list.body.courses as Array<{ id: string; canManage?: boolean }>).find((c) => c.id === id);
    expect(row?.canManage).toBe(false);
  });

  // ⚠️ Denne er saken #943 IKKE navnga — den pekte på kurs. Klassene har samme form én ruter
  // bortenfor, og lesingen der er den som lekker mest: `/members` gir NAVN og E-POST.
  it("CLASS-lesing: medlemmer og kurstildelinger er vaktet — /members gir navn og e-post", async () => {
    const create = await request(app).post("/api/admin/content/classes").set(smoA).send({ name: `Read-guard-${Date.now()}` });
    expect(create.status).toBe(201);
    const id = create.body.class.id as string;

    const members = await request(app).get(`/api/admin/content/classes/${id}/members`).set(smoA);
    expect(members.status).toBe(200);
    expect((await request(app).get(`/api/admin/content/classes/${id}/courses`).set(smoA)).status).toBe(200);
    expect((await request(app).get(`/api/admin/content/classes/${id}/members`).set(admin)).status).toBe(200);
    expect((await request(app).get(`/api/admin/content/classes/${id}/courses`).set(admin)).status).toBe(200);

    for (const path of [`/api/admin/content/classes/${id}/members`, `/api/admin/content/classes/${id}/courses`]) {
      const blocked = await request(app).get(path).set(smoB);
      expect(blocked.status, path).toBe(403);
      expect(blocked.body.error).toBe("content_ownership");
    }
  });

  // Det som faktisk lekket: at responsen bærer personopplysninger. Uten denne kunne `/members` en
  // dag slutte å sende e-post, vakta bli overflødig, og testen over fortsatt vært grønn — og da
  // ville ingen visst hvorfor vakta sto der.
  it("CLASS /members bærer personopplysninger — derfor står vakta der", async () => {
    const create = await request(app).post("/api/admin/content/classes").set(smoA).send({ name: `Pii-${Date.now()}` });
    const id = create.body.class.id as string;
    // Klassemedlemskap peker på den INTERNE bruker-id-en, ikke externalId fra headeren.
    const memberUser = await prisma.user.findUnique({ where: { externalId: "enf-a" }, select: { id: true } });
    expect(memberUser).toBeTruthy();
    const addRes = await request(app)
      .post(`/api/admin/content/classes/${id}/members`)
      .set(smoA)
      .send({ userId: memberUser!.id });
    expect(addRes.status).toBe(201);

    const members = await request(app).get(`/api/admin/content/classes/${id}/members`).set(smoA);
    expect(members.status).toBe(200);
    expect(members.body.members[0]).toMatchObject({ email: "enf-a@x.test" });
  });

  // ⚠️ QA-porten pekte på dette hullet: UEID innhold var utestet. Det er den grenen som faktisk
  // endrer oppførsel for gammelt innhold — systemklasser og kurs eldre enn eierskapsmodellen har
  // ingen `ContentOwner`-rad, og en ikke-admin får derfor 403 `content_unowned` der lesingen før
  // gikk gjennom.
  //
  // Uten denne testen kunne noen senere «rydde opp» i unowned-grenen — la den falle gjennom til
  // allow — uten at noe ble rødt. Da ville hele vakta vært hullete for nettopp det innholdet
  // ingen har tatt eierskap til.
  it("UEID kurs: SMO får content_unowned, administrator kommer inn", async () => {
    const create = await request(app).post("/api/admin/content/courses").set(smoA).send({ title: L("Orphan course") });
    const id = create.body.course.id as string;
    // Gjør kurset foreldreløst — slik legacy-innhold ser ut i databasen.
    await prisma.contentOwner.deleteMany({ where: { contentType: "COURSE", contentId: id } });

    const orphaned = await request(app).get(`/api/admin/content/courses/${id}`).set(smoA);
    expect(orphaned.status).toBe(403);
    // ⚠️ Feilkoden, ikke bare statusen: `content_unowned` og `content_ownership` betyr to helt
    // ulike ting for den som leser meldingen — «ingen eier ennå» mot «ikke din».
    expect(orphaned.body.error).toBe("content_unowned");

    expect((await request(app).get(`/api/admin/content/courses/${id}`).set(admin)).status).toBe(200);
  });

  it("UEID klasse: SMO får content_unowned på medlemslista, administrator kommer inn", async () => {
    const create = await request(app).post("/api/admin/content/classes").set(smoA).send({ name: `Orphan-${Date.now()}` });
    const id = create.body.class.id as string;
    await prisma.contentOwner.deleteMany({ where: { contentType: "CLASS", contentId: id } });

    const orphaned = await request(app).get(`/api/admin/content/classes/${id}/members`).set(smoA);
    expect(orphaned.status).toBe(403);
    expect(orphaned.body.error).toBe("content_unowned");

    expect((await request(app).get(`/api/admin/content/classes/${id}/members`).set(admin)).status).toBe(200);
  });
});
