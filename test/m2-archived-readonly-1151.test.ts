import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { publishModuleVersion } from "../src/modules/adminContent/adminContentCommands.js";
import { publishModuleVersioned } from "../src/modules/course/versionedPublishService.js";
import { withRevision } from "./support/courseRevision.js";
import { archiveCourseConfirmed } from "./support/courseArchive.js";

// #1151 (doc/design/CONTENT_LIFECYCLE.md, G5 og G4): ARKIVERT ER URØRLIG, og SLETT KREVER ARKIVERT.
//
// Alt gjennom rutene (supertest), som en tabell: hvert kall mot et arkivert element gir koden og skriver ingenting (et
// fingeravtrykk av elementet er likt før og etter), og samme kall mot et aktivt element lykkes (kontrollen). Så sletting, og
// unntakene som fortsatt virker på et arkivert element. Vaktene etter låsen bak en forhåndssjekk: m2-archived-readonly-lock-1151.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
// En ny administrator per test: admin-API-et slipper bare 120 kall i minuttet per bruker.
const ADMIN: Record<string, string> = { "x-user-id": "", "x-user-email": "", "x-user-name": "Admin", "x-user-roles": "ADMINISTRATOR", "x-locale": "nb" };
let adminSeq = 0;
beforeEach(() => {
  adminSeq += 1;
  ADMIN["x-user-id"] = `ro-1151-admin-${RUN}-${adminSeq}`;
  ADMIN["x-user-email"] = `ro.1151.admin.${RUN}.${adminSeq}@x.test`;
  // Grensen før innloggingen (600 i minuttet) gjelder per IP-adresse; fila sender mer enn det. Én adresse per test.
  ADMIN["x-forwarded-for"] = `10.115.${Math.floor(adminSeq / 250)}.${adminSeq % 250}`;
});
let seq = 0;
const tag = (name: string) => `1151 ${name} ${RUN}-${seq++}`;

afterAll(async () => {
  await prisma.$disconnect();
});

const C = "/api/admin/content";
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 400);
const post = (path: string, body: object = {}) => request(app).post(path).set(ADMIN).send(body);
const put = (path: string, body: object = {}) => request(app).put(path).set(ADMIN).send(body);
const patch = (path: string, body: object = {}) => request(app).patch(path).set(ADMIN).send(body);
const get = (path: string) => request(app).get(path).set(ADMIN);
const del = (path: string) => request(app).delete(path).set(ADMIN);

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}

// ── Fiksturer, alt gjennom API-et ──────────────────────────────────────────────────────────────────────────────────────────

async function apiSection(name: string, publish = true) {
  const created = await ok(post(`${C}/sections`, { title: L(tag(name)), bodyMarkdown: L("Tekst.") }), "seksjon");
  const id = created.section.id as string;
  if (publish) await ok(post(`${C}/sections/${id}/publish`), "publiser seksjon");
  return id;
}

async function apiModule(name: string) {
  const module = await ok(post(`${C}/modules`, { title: L(tag(name)), description: L("Beskrivelse"), certificationLevel: "basic" }), "modul");
  const moduleId = module.module.id as string;
  const base = `${C}/modules/${moduleId}`;
  const rubric = await ok(post(`${base}/rubric-versions`, { criteria: { relevance: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } }), "rubrikk");
  const prompt = await ok(post(`${base}/prompt-template-versions`, { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [] }), "ledetekst");
  const mcq = await ok(post(`${base}/mcq-set-versions`, { title: L("MCQ"), questions: [{ stem: L("1+1?"), options: [L("2"), L("3")], correctAnswer: L("2"), rationale: L("M") }] }), "flervalg");
  const version = await ok(post(`${base}/module-versions`, {
    taskText: L("Oppgave"), assessorExpectedContent: L("Fasit"),
    rubricVersionId: rubric.rubricVersion.id, promptTemplateVersionId: prompt.promptTemplateVersion.id, mcqSetVersionId: mcq.mcqSetVersion.id,
  }), "modulversjon");
  await ok(post(`${base}/module-versions/${version.moduleVersion.id}/publish`), "publiser modul");
  return moduleId;
}

async function apiCourse(name: string, sectionIds: string[], publish: boolean) {
  const created = await ok(post(`${C}/courses`, { title: L(tag(name)) }), "kurs");
  const id = created.course.id as string;
  const items = sectionIds.map((sectionId) => ({ type: "SECTION", sectionId }));
  const r = await put(`${C}/courses/${id}/items`, await withRevision(id, { items }));
  expect(r.status, show(r)).toBe(204);
  if (publish) await ok(post(`${C}/courses/${id}/publish`), "publiser kurs");
  return id;
}

async function archiveCourse(courseId: string) {
  const { response } = await archiveCourseConfirmed(courseId, ADMIN);
  expect(response.status, show(response)).toBe(200);
}

/** Det siste av hver komponent på modulen: det en lagring eller en ny modulversjon bygger på. */
async function moduleParts(moduleId: string) {
  const latest = { where: { moduleId }, orderBy: { versionNo: "desc" as const }, select: { id: true } };
  const [rubric, prompt, mcq, version] = await Promise.all([
    prisma.rubricVersion.findFirstOrThrow(latest),
    prisma.promptTemplateVersion.findFirstOrThrow(latest),
    prisma.mCQSetVersion.findFirstOrThrow(latest),
    prisma.moduleVersion.findFirstOrThrow(latest),
  ]);
  return { rubricVersionId: rubric.id, promptTemplateVersionId: prompt.id, mcqSetVersionId: mcq.id, moduleVersionId: version.id };
}

// ── Fingeravtrykk: alt en skriving kan endre ──────────────────────────────────────────────────────────────────────────────

async function fingerprint(type: "SECTION" | "MODULE" | "COURSE", id: string) {
  if (type === "SECTION") {
    return JSON.stringify(await prisma.courseSection.findUniqueOrThrow({
      where: { id },
      select: { title: true, archivedAt: true, activeVersionId: true, updatedAt: true, _count: { select: { versions: true, assets: true } } },
    }));
  }
  if (type === "MODULE") {
    return JSON.stringify(await prisma.module.findUniqueOrThrow({
      where: { id },
      select: {
        title: true, description: true, archivedAt: true, activeVersionId: true, updatedAt: true,
        _count: { select: { versions: true, rubricVersions: true, promptTemplateVersions: true, mcqSetVersions: true } },
      },
    }));
  }
  const course = await prisma.course.findUniqueOrThrow({
    where: { id },
    select: {
      title: true, archivedAt: true, publishedAt: true, contentRevision: true, versionMajor: true, versionMinor: true, updatedAt: true,
      items: { select: { itemType: true, moduleId: true, sectionId: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  const draft = await prisma.courseDraft.findUnique({ where: { courseId: id }, select: { revision: true } });
  return JSON.stringify({ course, draft });
}

// ── Tabellen ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Kind = "SECTION" | "MODULE" | "COURSE";
type Row = {
  name: string;
  kind: Kind;
  code: string;
  status?: number;
  /** Kallet. `role` sier om det gjelder det arkiverte elementet eller kontrollen. */
  call: (id: string, role: "archived" | "active") => Promise<request.Response>;
  /** Gjør kontrollen klar (for eksempel publisert), før kallet. */
  prepareActive?: (id: string) => Promise<void>;
  /** For kurs: det arkiverte kurset trenger et lagret utkast. */
  prepareArchived?: (id: string) => Promise<void>;
};

const S = (id: string, action = "") => `${C}/sections/${id}${action}`;
const M = (id: string, action = "") => `${C}/modules/${id}${action}`;
const K = (id: string, action = "") => `${C}/courses/${id}${action}`;

// Kursene: et arkivert kurs og et aktivt utkast, med den SAMME delte seksjonen. Den følger ikke kurset inn i arkivet (den brukes
// i det andre), så elementlista kan sendes uendret til begge.
const sharedSection = new Map<string, string>();
const sectionItems = (courseId: string) => [{ type: "SECTION", sectionId: sharedSection.get(courseId)! }];

const rows: Row[] = [
  // Seksjon
  { name: "seksjon: nytt navn", kind: "SECTION", code: "section_archived", call: (id) => patch(S(id, "/title"), { title: L("Nytt navn") }) },
  { name: "seksjon: lagre innhold", kind: "SECTION", code: "section_archived", call: (id) => put(S(id, "/content"), { bodyMarkdown: L("Ny tekst.") }) },
  {
    name: "seksjon: last opp bilde", kind: "SECTION", code: "section_archived",
    call: (id) => request(app).post(S(id, "/assets")).set(ADMIN).attach("file", PNG_1PX, { filename: "pixel.png", contentType: "image/png" }),
  },
  { name: "seksjon: oversett figurer", kind: "SECTION", code: "section_archived", call: (id) => post(S(id, "/assets/localize"), { sourceLocale: "nb" }) },
  { name: "seksjon: publiser", kind: "SECTION", code: "section_archived", call: (id) => post(S(id, "/publish")) },
  { name: "seksjon: avpubliser", kind: "SECTION", code: "section_archived", call: (id) => post(S(id, "/unpublish")) },
  {
    name: "seksjon: import replaceExisting", kind: "SECTION", code: "section_archived",
    call: async (id) => {
      const exported = await ok(get(S(id, "/export-package")), "eksport");
      return post(`${C}/sections/import`, { payload: exported.envelope, mode: "replaceExisting", targetId: id });
    },
  },
  // Modul
  { name: "modul: nytt navn", kind: "MODULE", code: "module_archived", call: (id) => patch(M(id, "/title"), { title: L("Nytt navn") }) },
  {
    name: "modul: lagre (samlet)", kind: "MODULE", code: "module_archived",
    call: async (id) => {
      const parts = await moduleParts(id);
      return post(M(id, "/versions"), { taskText: L("Ny oppgave"), assessorExpectedContent: L("Fasit"), rubricVersionId: parts.rubricVersionId, promptTemplateVersionId: parts.promptTemplateVersionId, mcqSetVersionId: parts.mcqSetVersionId });
    },
  },
  {
    name: "modul: modulversjon", kind: "MODULE", code: "module_archived",
    call: async (id) => {
      const parts = await moduleParts(id);
      return post(M(id, "/module-versions"), { taskText: L("Oppgave"), assessorExpectedContent: L("Fasit"), rubricVersionId: parts.rubricVersionId, promptTemplateVersionId: parts.promptTemplateVersionId, mcqSetVersionId: parts.mcqSetVersionId });
    },
  },
  { name: "modul: kriterier", kind: "MODULE", code: "module_archived", call: (id) => post(M(id, "/rubric-versions"), { criteria: { relevance: "0-4" }, scalingRule: { max_total: 20 } }) },
  { name: "modul: ledetekst", kind: "MODULE", code: "module_archived", call: (id) => post(M(id, "/prompt-template-versions"), { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [] }) },
  { name: "modul: flervalgssett", kind: "MODULE", code: "module_archived", call: (id) => post(M(id, "/mcq-set-versions"), { title: L("MCQ"), questions: [{ stem: L("2+2?"), options: [L("4"), L("5")], correctAnswer: L("4") }] }) },
  {
    name: "modul: kriterier lages automatisk (ensure)", kind: "MODULE", code: "module_archived",
    call: (id) => post(M(id, "/rubric-versions/ensure"), { taskText: "Oppgave", assessorExpectedContent: "Fasit", certificationLevel: "basic", locale: "nb" }),
  },
  { name: "modul: behold kriteriene (sync-blueprint)", kind: "MODULE", code: "module_archived", call: (id) => post(M(id, "/rubric-versions/sync-blueprint"), { blueprintHash: `h${RUN}` }) },
  {
    name: "modul: eksempelsvar (benchmark)", kind: "MODULE", code: "module_archived",
    call: async (id) => post(M(id, "/benchmark-example-versions"), {
      basePromptTemplateVersionId: (await moduleParts(id)).promptTemplateVersionId,
      examples: [{ anchorId: "a1", input: "Svar", expectedOutcome: "PASS" }],
    }),
  },
  { name: "modul: hent fram eldre versjon", kind: "MODULE", code: "module_archived", call: async (id) => post(M(id, `/module-versions/${(await moduleParts(id)).moduleVersionId}/restore`)) },
  { name: "modul: fyll på flervalg", kind: "MODULE", code: "module_archived", call: (id) => post(M(id, "/mcq-questions"), { questions: [{ stem: L("3+3?"), options: [L("6"), L("7")], correctAnswer: L("6") }] }) },
  { name: "modul: avpubliser", kind: "MODULE", code: "module_archived", call: (id) => post(M(id, "/unpublish")) },
  { name: "modul: kalibrering (terskler)", kind: "MODULE", code: "module_archived", call: (id) => post("/api/calibration/workspace/publish-thresholds", { moduleId: id, totalMin: 55 }) },
  {
    name: "modul: import replaceExisting med autoPublish", kind: "MODULE", code: "module_archived",
    call: async (id) => {
      const exported = await ok(get(M(id, "/export-package")), "eksport");
      return post(`${C}/modules/import`, { payload: exported.envelope, mode: "replaceExisting", targetId: id, autoPublish: true });
    },
  },
  // Publiseringsporten i ruta sjekker FØR låsen og svarer som før (`item_archived` i `issues`); vakta etter låsen: under.
  { name: "modul: publiser (porten)", kind: "MODULE", code: "publish_blocked_by_validation", status: 422, call: async (id) => post(M(id, `/module-versions/${(await moduleParts(id)).moduleVersionId}/publish`)) },
  { name: "modul: publiser med versjonsvalg (porten)", kind: "MODULE", code: "publish_blocked_by_validation", status: 422, call: async (id) => post(M(id, `/module-versions/${(await moduleParts(id)).moduleVersionId}/publish-versioned`), { moduleVersion: "minor" }) },
  // Kurs
  { name: "kurs: felt (gammel fane)", kind: "COURSE", code: "course_archived", call: async (id) => put(K(id), await withRevision(id, { title: L("Nytt navn") })) },
  { name: "kurs: skjemaet (felt og liste)", kind: "COURSE", code: "course_archived", call: async (id) => put(K(id, "/content"), await withRevision(id, { title: L("Nytt navn"), items: sectionItems(id) })) },
  { name: "kurs: elementlista", kind: "COURSE", code: "course_archived", call: async (id) => put(K(id, "/items"), await withRevision(id, { items: sectionItems(id) })) },
  // Uten teller (agent-tokenet, en gammel fane): et kurs som har vært ute, ville ellers fått `course_form_outdated`.
  { name: "kurs: elementlista uten teller", kind: "COURSE", code: "course_archived", call: (id) => put(K(id, "/items"), { items: sectionItems(id) }) },
  { name: "kurs: moduler (eldre vei)", kind: "COURSE", code: "course_archived", call: async (id) => put(K(id, "/modules"), await withRevision(id, { modules: [] })) },
  {
    name: "kurs: lagre utkast", kind: "COURSE", code: "course_archived",
    prepareActive: async (id) => { await ok(post(K(id, "/publish")), "publiser kontroll"); },
    call: async (id) => put(K(id, "/draft"), { items: sectionItems(id), title: L("Utkast"), loaded: { expectedRevision: (await prisma.course.findUniqueOrThrow({ where: { id }, select: { contentRevision: true } })).contentRevision } }),
  },
  {
    name: "kurs: publiser utkast", kind: "COURSE", code: "course_archived",
    // Arkiveringen forkaster utkastet; et utkast fra før 2.159.0 kan likevel ligge der. Fiksturen skriver det direkte.
    prepareArchived: async (id) => {
      await prisma.courseDraft.create({ data: { courseId: id, payloadText: JSON.stringify({ items: sectionItems(id) }), baseRevision: 0, source: "form" } });
    },
    prepareActive: async (id) => {
      await ok(post(K(id, "/publish")), "publiser kontroll");
      const revision = (await prisma.course.findUniqueOrThrow({ where: { id }, select: { contentRevision: true } })).contentRevision;
      await ok(put(K(id, "/draft"), { items: sectionItems(id), title: L("Utkast"), loaded: { expectedRevision: revision } }), "utkast kontroll");
    },
    call: async (id) => {
      const draft = await prisma.courseDraft.findUniqueOrThrow({ where: { courseId: id }, select: { id: true, revision: true } });
      return post(K(id, "/draft/publish"), { loaded: { draftId: draft.id, revision: draft.revision } });
    },
  },
  { name: "kurs: publiser", kind: "COURSE", code: "course_archived", call: (id) => post(K(id, "/publish")) },
  { name: "kurs: publiser nye versjoner", kind: "COURSE", code: "course_archived", call: (id) => post(K(id, "/publish-pending"), { versionIds: [] }) },
  { name: "kurs: publiser nye versjoner med svar per kurs", kind: "COURSE", code: "course_archived", call: (id) => post(K(id, "/publish-pending-versioned"), { versionIds: [], expectedCourseIds: [] }) },
  {
    name: "kurs: avpubliser", kind: "COURSE", code: "course_archived",
    prepareActive: async (id) => { await ok(post(K(id, "/publish")), "publiser kontroll"); },
    call: (id) => post(K(id, "/unpublish")),
  },
  {
    name: "kurs: import replaceExisting", kind: "COURSE", code: "course_archived",
    call: async (id) => {
      const exported = await ok(get(K(id, "/export-package")), "eksport");
      return post(`${C}/courses/import`, { payload: exported.envelope, mode: "replaceExisting", targetId: id });
    },
  },
  {
    name: "kurs: import updateExisting («Oppdater dette kurset»)", kind: "COURSE", code: "course_archived",
    call: async (id) => {
      const exported = await ok(get(K(id, "/export-package")), "eksport");
      return post(`${C}/courses/import`, { payload: exported.envelope, mode: "updateExisting", targetId: id });
    },
  },
];

async function pair(kind: Kind): Promise<{ archived: string; active: string }> {
  if (kind === "SECTION") {
    const [archived, active] = [await apiSection("arkivert"), await apiSection("aktiv")];
    await ok(post(S(archived, "/archive")), "arkiver seksjon");
    return { archived, active };
  }
  if (kind === "MODULE") {
    const [archived, active] = [await apiModule("arkivert"), await apiModule("aktiv")];
    await ok(post(M(archived, "/archive")), "arkiver modul");
    return { archived, active };
  }
  const shared = await apiSection("delt");
  const archived = await apiCourse("arkivert", [shared], true);
  const active = await apiCourse("aktiv", [shared], false);
  await archiveCourse(archived);
  sharedSection.set(archived, shared);
  sharedSection.set(active, shared);
  return { archived, active };
}

describe("#1151 arkivert er urørlig: hvert kall mot et arkivert element avvises og skriver ingenting", () => {
  for (const row of rows) {
    it(row.name, async () => {
      const { archived, active } = await pair(row.kind);
      if (row.prepareArchived) await row.prepareArchived(archived);
      const before = await fingerprint(row.kind, archived);
      const rejected = await row.call(archived, "archived");
      expect(rejected.status, show(rejected)).toBe(row.status ?? 400);
      expect(rejected.body.error, show(rejected)).toBe(row.code);
      if (row.code === "publish_blocked_by_validation") {
        expect((rejected.body.issues as Array<{ code: string }>).map((issue) => issue.code)).toContain("item_archived");
      }
      expect(await fingerprint(row.kind, archived), "det arkiverte elementet er uendret").toBe(before);

      // Kontrollen: samme kall mot et aktivt element går.
      if (row.prepareActive) await row.prepareActive(active);
      const accepted = await row.call(active, "active");
      expect(accepted.status, `kontrollen: ${show(accepted)}`).toBeLessThan(300);
    });
  }

  it("de tre antatte tilfellene fra saken er borte: ingen «arkivert og aktiv»", async () => {
    const section = await apiSection("antatt seksjon");
    await ok(post(S(section, "/archive")), "arkiver");
    await put(S(section, "/content"), { bodyMarkdown: L("Ny tekst.") });
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: section }, select: { activeVersionId: true } })).activeVersionId).toBeNull();

    const module = await apiModule("antatt modul");
    const exported = await ok(get(M(module, "/export-package")), "eksport");
    await ok(post(M(module, "/archive")), "arkiver");
    await post(`${C}/modules/import`, { payload: exported.envelope, mode: "replaceExisting", targetId: module, autoPublish: true });
    expect((await prisma.module.findUniqueOrThrow({ where: { id: module }, select: { activeVersionId: true } })).activeVersionId).toBeNull();

    const { archived: course } = await pair("COURSE");
    await post(K(course, "/publish"));
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course }, select: { publishedAt: true } })).publishedAt).toBeNull();
  });

  it("påfyll av flervalg på en arkivert modul uten versjon: svaret er «arkivert», ikke «ingen versjon» (agent-API-et)", async () => {
    const created = await ok(post(`${C}/modules`, { title: L(tag("fyll uten versjon")), description: L("B"), certificationLevel: "basic" }), "modul");
    const id = created.module.id as string;
    await ok(post(M(id, "/archive")), "arkiver");
    const r = await post(M(id, "/mcq-questions"), { questions: [{ stem: L("3+3?"), options: [L("6"), L("7")], correctAnswer: L("6") }] });
    expect(r.status, show(r)).toBe(400);
    expect(r.body.error).toBe("module_archived");
  });

  it("vakta etter låsen i modulpubliseringen (bak porten i ruta): kommandoene avviser en arkivert modul", async () => {
    const module = await apiModule("publiser under låsen");
    const { moduleVersionId } = await moduleParts(module);
    await ok(post(M(module, "/archive")), "arkiver");
    await expect(publishModuleVersion(module, moduleVersionId, ADMIN["x-user-id"]!)).rejects.toMatchObject({ code: "module_archived" });
    // Hovedversjon med et kursett som ikke stemmer: svaret er «arkivert», før kursene sammenlignes.
    await expect(publishModuleVersioned(module, moduleVersionId, { userId: ADMIN["x-user-id"]!, roles: ["ADMINISTRATOR"] }, { moduleVersion: "major", expectedCourseIds: ["finnes-ikke"] }))
      .rejects.toMatchObject({ code: "module_archived" });
    expect((await prisma.module.findUniqueOrThrow({ where: { id: module }, select: { activeVersionId: true } })).activeVersionId).toBeNull();
  });

  it("et arkivert kurs med innholdet som fulgte det: «Publiser kurs» og «Oppdater dette kurset» sier at KURSET er arkivert", async () => {
    // Elementene er arkivert sammen med kurset. Svaret skal handle om kurset, ikke om elementene (`course_has_unpublished_items`,
    // `section_archived`): det er kurset som må gjenopprettes.
    const exclusive = await apiSection("fulgte kurset");
    const course = await apiCourse("med eget innhold", [exclusive], true);
    const exported = await ok(get(K(course, "/export-package")), "eksport");
    await archiveCourse(course);
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: exclusive }, select: { archivedAt: true } })).archivedAt).not.toBeNull();
    const before = await fingerprint("COURSE", course);

    const published = await post(K(course, "/publish"));
    expect(published.status, show(published)).toBe(400);
    expect(published.body.error).toBe("course_archived");

    const envelope = exported.envelope;
    envelope.course.course.items[0].section.bodyMarkdown = L("Endret i fila.");
    const updated = await post(`${C}/courses/import`, { payload: envelope, mode: "updateExisting", targetId: course });
    expect(updated.status, show(updated)).toBe(400);
    expect(updated.body.error).toBe("course_archived");
    expect(await fingerprint("COURSE", course)).toBe(before);
  });

  it("«Oppdater dette kurset» bytter et arkivert element forfatteren ikke eier, med en kopi, uten å røre det arkiverte", async () => {
    // Det fremmede elementet byttes ut med en kopi, og det gamle arkiveres «når ingen andre kurs bruker det». Er det alt arkivert,
    // skal `archivedAt` stå: den er starten på slettefristen (#1152).
    const smo = (name: string) => ({ ...ADMIN, "x-user-id": `ro-1151-${name}-${RUN}-${adminSeq}`, "x-user-email": `ro.1151.${name}.${RUN}.${adminSeq}@x.test`, "x-user-roles": "SUBJECT_MATTER_OWNER" });
    const author = smo("forfatter");
    const other = smo("annen");
    const foreign = await ok(request(app).post(`${C}/sections`).set(other).send({ title: L(tag("fremmed")), bodyMarkdown: L("Tekst.") }), "fremmed seksjon");
    const sectionId = foreign.section.id as string;
    const created = await ok(request(app).post(`${C}/courses`).set(author).send({ title: L(tag("forfatterens kurs")) }), "kurs");
    const courseId = created.course.id as string;
    expect((await request(app).put(K(courseId, "/items")).set(author).send(await withRevision(courseId, { items: [{ type: "SECTION", sectionId }] }))).status).toBe(204);
    const exported = await ok(request(app).get(K(courseId, "/export-package")).set(author), "eksport");
    const archivedAt = new Date("2026-10-01T10:00:00Z");
    await prisma.courseSection.update({ where: { id: sectionId }, data: { archivedAt, activeVersionId: null } });
    const envelope = exported.envelope;
    envelope.course.course.items[0].section.bodyMarkdown = L("Endret i fila.");

    const r = await request(app).post(`${C}/courses/import`).set(author).send({ payload: envelope, mode: "updateExisting", targetId: courseId });
    expect(r.status, show(r)).toBe(201);
    expect(r.body.summary.replacedUnownedIds).toEqual([expect.objectContaining({ type: "SECTION", oldId: sectionId, oldArchived: true })]);
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: sectionId }, select: { archivedAt: true } })).archivedAt).toEqual(archivedAt);
  });

  it("«Oppdater dette kurset» på et AKTIVT kurs avvises når et arkivert element i det skulle fått ny versjon", async () => {
    // Et gjenopprettet kurs kan ha et element som er arkivert (arkivert for hånd, ikke fulgt med). Tilstanden lages direkte.
    const section = await apiSection("arkivert i aktivt kurs");
    const course = await apiCourse("aktivt med arkivert", [section], false);
    const exported = await ok(get(K(course, "/export-package")), "eksport");
    const envelope = exported.envelope;
    envelope.course.course.items[0].section.bodyMarkdown = L("Endret i fila.");
    await prisma.courseSection.update({ where: { id: section }, data: { archivedAt: new Date(), activeVersionId: null } });
    const before = await fingerprint("SECTION", section);
    const r = await post(`${C}/courses/import`, { payload: envelope, mode: "updateExisting", targetId: course });
    expect(r.status, show(r)).toBe(400);
    expect(r.body.error).toBe("section_archived");
    expect(await fingerprint("SECTION", section)).toBe(before);
  });
});

describe("#1151 sidefunn: eksempelsvar-ruta har eierskapsvakt", () => {
  it("en annen fagansvarlig får 403 og skriver ingenting; eieren får lagret", async () => {
    const smo = (name: string) => ({ ...ADMIN, "x-user-id": `ro-1151-${name}-${RUN}-${adminSeq}`, "x-user-email": `ro.1151.${name}.${RUN}.${adminSeq}@x.test`, "x-user-roles": "SUBJECT_MATTER_OWNER" });
    const owner = smo("eier");
    const other = smo("annen");
    const created = await ok(request(app).post(`${C}/modules`).set(owner).send({ title: L(tag("eksempelsvar")), description: L("B"), certificationLevel: "basic" }), "modul");
    const id = created.module.id as string;
    await ok(request(app).post(M(id, "/prompt-template-versions")).set(owner).send({ systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [] }), "ledetekst");
    const body = { basePromptTemplateVersionId: (await prisma.promptTemplateVersion.findFirstOrThrow({ where: { moduleId: id }, select: { id: true } })).id, examples: [{ anchorId: "a1", input: "Svar", expectedOutcome: "PASS" }] };
    const refused = await request(app).post(M(id, "/benchmark-example-versions")).set(other).send(body);
    expect(refused.status, show(refused)).toBe(403);
    expect(await prisma.promptTemplateVersion.count({ where: { moduleId: id } })).toBe(1);
    expect((await request(app).post(M(id, "/benchmark-example-versions")).set(owner).send(body)).status).toBe(201);
  });
});

describe("#1151 slett krever arkivert (G4)", () => {
  it("seksjon: ikke arkivert → delete_requires_archived; arkivert → slettet", async () => {
    const id = await apiSection("slett");
    const refused = await del(S(id));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("delete_requires_archived");
    expect(refused.body.details).toMatchObject({ itemType: "SECTION" });
    expect(await prisma.courseSection.count({ where: { id } })).toBe(1);
    await ok(post(S(id, "/archive")), "arkiver");
    expect((await del(S(id))).status).toBe(204);
    expect(await prisma.courseSection.count({ where: { id } })).toBe(0);
  });

  it("modul: ikke arkivert → delete_requires_archived (også før «ligger i et kurs»); arkivert og tom → slettet", async () => {
    const created = await ok(post(`${C}/modules`, { title: L(tag("slett modul")), description: L("B"), certificationLevel: "basic" }), "modul");
    const id = created.module.id as string;
    const refused = await del(M(id));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("delete_requires_archived");
    expect(refused.body.details).toMatchObject({ itemType: "MODULE" });
    expect(await prisma.module.count({ where: { id } })).toBe(1);
    await ok(post(M(id, "/archive")), "arkiver");
    const deleted = await del(M(id));
    expect(deleted.status, show(deleted)).toBe(200);
    expect(await prisma.module.count({ where: { id } })).toBe(0);
  });

  it("kurs: ikke arkivert → delete_requires_archived; arkivert → slettet", async () => {
    const id = await apiCourse("slett kurs", [await apiSection("i slett kurs")], false);
    const refused = await del(K(id));
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("delete_requires_archived");
    expect(refused.body.details).toMatchObject({ itemType: "COURSE" });
    expect(await prisma.course.count({ where: { id } })).toBe(1);
    await archiveCourse(id);
    expect((await del(K(id))).status).toBe(204);
    expect(await prisma.course.count({ where: { id } })).toBe(0);
  });

  it("kaskaden: et kurs som ikke er arkivert, gir delete_requires_archived i forhåndsvisningen og slettingen; arkivert → slettet med innholdet", async () => {
    const section = await apiSection("eksklusiv");
    const id = await apiCourse("kaskade", [section], true);
    const preview = await get(K(id, "/cascade-delete-preview"));
    expect(preview.status, show(preview)).toBe(400);
    expect(preview.body.error).toBe("delete_requires_archived");
    const refused = await post(K(id, "/cascade-delete"), { expectedDeletedModuleIds: [], expectedDeletedSectionIds: [section] });
    expect(refused.status, show(refused)).toBe(400);
    expect(refused.body.error).toBe("delete_requires_archived");
    expect(await prisma.course.count({ where: { id } })).toBe(1);

    await archiveCourse(id);
    const ready = await ok(get(K(id, "/cascade-delete-preview")), "forhåndsvisning");
    expect(ready.deletableSections.map((s: { id: string }) => s.id)).toEqual([section]);
    await ok(post(K(id, "/cascade-delete"), { expectedDeletedModuleIds: [], expectedDeletedSectionIds: [section] }), "kaskade");
    expect(await prisma.course.count({ where: { id } })).toBe(0);
    expect(await prisma.courseSection.count({ where: { id: section } })).toBe(0);
  });
});

describe("#1151 unntakene virker fortsatt på et arkivert element", () => {
  it("gjenopprett: seksjon, modul, og kurs med innholdet som fulgte det", async () => {
    const section = await apiSection("gjenopprett");
    await ok(post(S(section, "/archive")), "arkiver");
    await ok(post(S(section, "/restore")), "gjenopprett seksjon");
    const module = await apiModule("gjenopprett");
    await ok(post(M(module, "/archive")), "arkiver");
    await ok(post(M(module, "/restore")), "gjenopprett modul");

    const exclusive = await apiSection("fulgte kurset");
    const course = await apiCourse("gjenopprett", [exclusive], true);
    await archiveCourse(course);
    expect((await prisma.courseSection.findUniqueOrThrow({ where: { id: exclusive }, select: { archivedAt: true } })).archivedAt).not.toBeNull();
    await ok(post(K(course, "/restore")), "gjenopprett kurs");
    const back = await prisma.courseSection.findUniqueOrThrow({ where: { id: exclusive }, select: { archivedAt: true, activeVersionId: true } });
    expect(back.archivedAt).toBeNull();
    expect(back.activeVersionId).not.toBeNull();
  });

  it("dobbel arkivering og gjenoppretting av en modul har koder (før: engelsk tekst)", async () => {
    const module = await apiModule("koder");
    const notArchived = await post(M(module, "/restore"));
    expect(notArchived.status, show(notArchived)).toBe(400);
    expect(notArchived.body.error).toBe("module_not_archived");
    await ok(post(M(module, "/archive")), "arkiver");
    const twice = await post(M(module, "/archive"));
    expect(twice.status, show(twice)).toBe(400);
    expect(twice.body.error).toBe("module_already_archived");
  });

  it("eksport av arkivert seksjon, modul og kurs", async () => {
    const { archived: section } = await pair("SECTION");
    expect((await get(S(section, "/export-package"))).status).toBe(200);
    const { archived: module } = await pair("MODULE");
    expect((await get(M(module, "/export-package"))).status).toBe(200);
    const { archived: course } = await pair("COURSE");
    expect((await get(K(course, "/export-package"))).status).toBe(200);
  });

  it("eierpanelet: legge til en eier på et arkivert kurs og en arkivert seksjon", async () => {
    const other = `ro-1151-eier-${RUN}-${adminSeq}`;
    await prisma.user.upsert({ where: { id: other }, update: {}, create: { id: other, email: `${other}@x.test`, name: "Eier", externalId: other } });
    const { archived: section } = await pair("SECTION");
    await ok(post(`/api/admin/content-owners/SECTION/${section}`, { userId: other }), "eier seksjon");
    const { archived: course } = await pair("COURSE");
    await ok(post(`/api/admin/content-owners/COURSE/${course}`, { userId: other }), "eier kurs");
    expect(await prisma.contentOwner.count({ where: { userId: other, contentId: { in: [section, course] } } })).toBe(2);
  });

  it("forkast utkast, fjern påmelding og fjern klassetildeling på et arkivert kurs", async () => {
    const shared = await apiSection("delt unntak");
    const course = await apiCourse("unntak", [shared], true);
    await apiCourse("bruker delt", [shared], false);
    const learner = `ro-1151-deltaker-${RUN}-${adminSeq}`;
    await prisma.user.upsert({ where: { id: learner }, update: {}, create: { id: learner, email: `${learner}@x.test`, name: "Deltaker", externalId: learner } });
    await ok(post(K(course, "/enrollments"), { userIds: [learner] }), "påmelding");
    const klass = await ok(post(`${C}/classes`, { name: tag("klasse") }), "klasse");
    await ok(post(`${C}/classes/${klass.class.id}/courses`, { courseId: course }), "klassetildeling");
    await archiveCourse(course);
    const draft = await prisma.courseDraft.create({ data: { courseId: course, payloadText: JSON.stringify({ items: [] }), baseRevision: 0, source: "form" }, select: { id: true, revision: true } });

    expect((await del(`${K(course, "/draft")}?draftId=${draft.id}&revision=${draft.revision}`)).status).toBe(204);
    expect((await del(K(course, `/enrollments/${learner}`))).status).toBe(204);
    expect((await del(`${C}/classes/${klass.class.id}/courses/${course}`)).status).toBe(204);
    expect(await prisma.courseDraft.count({ where: { courseId: course } })).toBe(0);
    expect(await prisma.courseGroupAssignment.count({ where: { courseId: course } })).toBe(0);
  });
});
