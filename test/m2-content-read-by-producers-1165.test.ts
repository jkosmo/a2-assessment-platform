import request from "supertest";
import type { Router } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { adminContentRouter } from "../src/routes/adminContent.js";
import { adminCoursesRouter } from "../src/routes/adminCourses.js";
import { adminSectionsRouter } from "../src/routes/adminSections.js";
import { withRevision } from "./support/courseRevision.js";

// #1165 (produkteier 14.11.2026, «Produsenter bør kunne se hverandres innhold»; doc/DECISIONS.md): en produsent som ikke eier et
// kurs eller en modul, kan åpne det for å LESE. Endre kan bare eierne (og administrator).
//
// Gjennom rutene, med tre roller: eieren (SMO A), en annen produsent (SMO B) og administrator.
//   - Lesingen: kursdetaljen og modulens `/export` svarer 200 for B, med `canManage: false`; for eieren og administrator `true`.
//     Modulens `/export-package` (eksport og «Dupliser») er åpen, og en kopi B lager, eies av B.
//   - Skrivingen, som en tabell: HVER skriverute på `/courses/:courseId` og `/modules/:moduleId` gir B 403 og endrer ingenting
//     (et fingeravtrykk før og etter). Tabellen er en dekningsvakt: rutene leses fra ruterne, og en ny skriverute uten rad i
//     tabellen gjør testen rød.
//   - Lesinger som er forspill til en skriving (og `/enrollments`, med personopplysninger), er fortsatt vaktet.
//   - #1180 (produkteier 21.11.2026): seksjoner følger samme regel. Detaljen svarer `canManage`, og HVER skriverute på
//     `/sections/:sectionId` står i tabellen med sin egen dekningsvakt.

const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
let seq = 0;
const tag = (name: string) => `1165 ${name} ${RUN}-${seq++}`;
const L = (text: string) => ({ "en-GB": text, nb: text, nn: text });
const show = (r: request.Response) => JSON.stringify(r.body).slice(0, 400);
const C = "/api/admin/content";

const person = (id: string, role: string, ip: string) => ({
  "x-user-id": `${id}-${RUN}`,
  "x-user-email": `${id}.${RUN}@x.test`,
  "x-user-name": id,
  "x-user-roles": role,
  "x-locale": "nb",
  // Grensen før innloggingen gjelder per IP-adresse; tabellen sender mange kall.
  "x-forwarded-for": ip,
});
const OWNER = person("1165-eier", "SUBJECT_MATTER_OWNER", "10.116.5.1");
const OTHER = person("1165-annen", "SUBJECT_MATTER_OWNER", "10.116.5.2");
const ADMIN = person("1165-admin", "ADMINISTRATOR", "10.116.5.3");

afterAll(async () => {
  await prisma.$disconnect();
});

async function ok(r: request.Response | Promise<request.Response>, label: string) {
  const res = await r;
  expect(res.status, `${label}: ${show(res)}`).toBeLessThan(300);
  return res.body;
}
const as = (headers: Record<string, string>) => ({
  get: (path: string) => request(app).get(path).set(headers),
  post: (path: string, body: object = {}) => request(app).post(path).set(headers).send(body),
  put: (path: string, body: object = {}) => request(app).put(path).set(headers).send(body),
  patch: (path: string, body: object = {}) => request(app).patch(path).set(headers).send(body),
  del: (path: string) => request(app).delete(path).set(headers),
});
const owner = as(OWNER);
const other = as(OTHER);
const admin = as(ADMIN);

const K = (id: string, action = "") => `${C}/courses/${id}${action}`;
const M = (id: string, action = "") => `${C}/modules/${id}${action}`;
const S = (id: string, action = "") => `${C}/sections/${id}${action}`;

// ── Fiksturer: alt eies av A, opprettet gjennom API-et ─────────────────────────────────────────────────────────────────────

let courseId = "";
let sectionId = "";
let moduleId = "";
let moduleVersionId = "";
let parts = { rubricVersionId: "", promptTemplateVersionId: "", mcqSetVersionId: "" };
let participantId = "";

beforeAll(async () => {
  const module = await ok(owner.post(`${C}/modules`, { title: L(tag("modul")), description: L("Beskrivelse"), certificationLevel: "basic" }), "modul");
  moduleId = module.module.id;
  const rubric = await ok(owner.post(M(moduleId, "/rubric-versions"), { criteria: { relevance: "0-4" }, scalingRule: { practical_weight: 70, max_total: 20 } }), "rubrikk");
  const prompt = await ok(owner.post(M(moduleId, "/prompt-template-versions"), { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [] }), "ledetekst");
  const mcq = await ok(owner.post(M(moduleId, "/mcq-set-versions"), { title: L("MCQ"), questions: [{ stem: L("1+1?"), options: [L("2"), L("3")], correctAnswer: L("2"), rationale: L("M") }] }), "flervalg");
  parts = { rubricVersionId: rubric.rubricVersion.id, promptTemplateVersionId: prompt.promptTemplateVersion.id, mcqSetVersionId: mcq.mcqSetVersion.id };
  const version = await ok(owner.post(M(moduleId, "/module-versions"), { taskText: L("Oppgave"), assessorExpectedContent: L("Fasit"), ...parts }), "modulversjon");
  moduleVersionId = version.moduleVersion.id;
  await ok(owner.post(M(moduleId, `/module-versions/${moduleVersionId}/publish`)), "publiser modul");

  const section = await ok(owner.post(`${C}/sections`, { title: L(tag("seksjon")), bodyMarkdown: L("Tekst.") }), "seksjon");
  sectionId = section.section.id;
  await ok(owner.post(`${C}/sections/${sectionId}/publish`), "publiser seksjon");
  const course = await ok(owner.post(`${C}/courses`, { title: L(tag("kurs")) }), "kurs");
  courseId = course.course.id;
  const items = await owner.put(K(courseId, "/items"), await withRevision(courseId, { items: [{ type: "SECTION", sectionId }, { type: "MODULE", moduleId }] }));
  expect(items.status, show(items)).toBe(204);
  await ok(owner.post(K(courseId, "/publish")), "publiser kurs");

  const externalId = `1165-p-${RUN}`;
  participantId = (await prisma.user.create({ data: { externalId, name: "Deltaker", email: `${externalId}@x.test` }, select: { id: true } })).id;
  await ok(owner.post(K(courseId, "/enrollments"), { userIds: [participantId] }), "tildel");
});

async function fingerprint() {
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    select: {
      title: true, archivedAt: true, publishedAt: true, contentRevision: true, versionMajor: true, versionMinor: true, updatedAt: true, enrollmentPolicy: true,
      items: { select: { itemType: true, moduleId: true, sectionId: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
      enrollments: { select: { userId: true, revokedAt: true } },
    },
  });
  const draft = await prisma.courseDraft.findUnique({ where: { courseId }, select: { revision: true } });
  const module = await prisma.module.findUniqueOrThrow({
    where: { id: moduleId },
    select: {
      title: true, description: true, archivedAt: true, activeVersionId: true, updatedAt: true,
      _count: { select: { versions: true, rubricVersions: true, promptTemplateVersions: true, mcqSetVersions: true } },
    },
  });
  const section = await prisma.courseSection.findUniqueOrThrow({
    where: { id: sectionId },
    select: { title: true, archivedAt: true, activeVersionId: true, updatedAt: true, _count: { select: { versions: true, assets: true } } },
  });
  return JSON.stringify({ course, draft, module, section });
}

// ── Lesingen ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("#1165: en annen produsent kan lese kurs og moduler hen ikke eier", () => {
  it("kursdetaljen: 200 for alle tre, og `canManage` sier hvem som kan endre", async () => {
    const seen = await ok(other.get(K(courseId)), "annen");
    expect(seen.course.id).toBe(courseId);
    expect(seen.course.canManage).toBe(false);
    expect((await ok(owner.get(K(courseId)), "eier")).course.canManage).toBe(true);
    expect((await ok(admin.get(K(courseId)), "admin")).course.canManage).toBe(true);
    // Det skjemaet leser i tillegg: elementene og eksporten.
    expect((await other.get(K(courseId, "/items"))).status).toBe(200);
    expect((await other.get(K(courseId, "/export-package"))).status).toBe(200);
  });

  it("modulen (`/export`, det modulsida laster): 200 for alle tre, med innholdet og `canManage`", async () => {
    const seen = await ok(other.get(M(moduleId, "/export")), "annen");
    expect(seen.moduleExport.module.id).toBe(moduleId);
    expect(seen.moduleExport.selectedConfiguration?.moduleVersion?.id).toBe(moduleVersionId);
    expect(seen.moduleExport.canManage).toBe(false);
    expect((await ok(owner.get(M(moduleId, "/export")), "eier")).moduleExport.canManage).toBe(true);
    expect((await ok(admin.get(M(moduleId, "/export")), "admin")).moduleExport.canManage).toBe(true);
  });

  it("#1180 seksjonen: detaljen svarer 200 for alle tre, og `canManage` sier hvem som kan endre", async () => {
    const seen = await ok(other.get(S(sectionId)), "annen");
    expect(seen.section.id).toBe(sectionId);
    expect(seen.section.canManage).toBe(false);
    expect((await ok(owner.get(S(sectionId)), "eier")).section.canManage).toBe(true);
    expect((await ok(admin.get(S(sectionId)), "admin")).section.canManage).toBe(true);
    // Lista merker raden likt.
    const list = await ok(other.get(`${C}/sections`), "lista");
    expect(list.sections.find((row: { id: string }) => row.id === sectionId)?.canManage).toBe(false);
    // «Eksporter» (og dermed «Dupliser») er lesing.
    expect((await other.get(S(sectionId, "/export-package"))).status).toBe(200);
  });

  it("«Eksporter» og «Dupliser» på en annens modul: eksportpakken er åpen, og kopien eies av den som kopierte", async () => {
    const exported = await ok(other.get(M(moduleId, "/export-package")), "eksport");
    expect(exported.envelope.exportFormat).toBe("a2-content-export/v1");
    const copy = await ok(other.post(`${C}/modules/import`, { payload: exported.envelope, mode: "createNew", autoPublish: false }), "kopi");
    const copyId = copy.moduleId as string;
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe(moduleId);
    expect((await ok(other.get(M(copyId, "/export")), "kopien")).moduleExport.canManage).toBe(true);
    // Originalen er fortsatt ikke hens.
    expect((await ok(other.get(M(moduleId, "/export")), "originalen")).moduleExport.canManage).toBe(false);
  });

  it("lesinger som er forspill til en skriving, og `/enrollments`, er fortsatt vaktet", async () => {
    const guarded = [
      K(courseId, "/pending-versions"),
      K(courseId, "/archive-preview"),
      K(courseId, "/restore-preview"),
      K(courseId, "/enrollments"),
      K(courseId, "/publish-audience"),
      M(moduleId, "/passed-count"),
      M(moduleId, "/archive-preview"),
      M(moduleId, `/module-versions/${moduleVersionId}/publish-preview-versioned`),
    ];
    for (const path of guarded) {
      const refused = await other.get(path);
      expect(refused.status, `${path}: ${show(refused)}`).toBe(403);
      expect(refused.body.error, path).toBe("content_ownership");
      // Kontroll: eieren slipper forbi vakta (ellers ville en stengt dør vært grønn). Svaret kan være et annet avslag
      // (forhåndsvisningen av en gjenoppretting for et kurs som ikke er arkivert), men ikke 403.
      expect((await owner.get(path)).status, `${path} eier`).not.toBe(403);
    }
  });
});

// ── Skrivingen, som en tabell ─────────────────────────────────────────────────────────────────────────────────────────────

type Row = { route: string; call: () => Promise<request.Response> };

// `route` er nøyaktig slik ruteren har den («METODE /sti»): kursruterens stier er relative til `/courses`.
const courseRows: Row[] = [
  { route: "PUT /:courseId", call: async () => other.put(K(courseId), await withRevision(courseId, { title: L("Nytt navn") })) },
  { route: "PUT /:courseId/content", call: async () => other.put(K(courseId, "/content"), await withRevision(courseId, { title: L("Nytt"), items: [] })) },
  { route: "PUT /:courseId/draft", call: () => other.put(K(courseId, "/draft"), { items: [], loaded: { expectedRevision: 0 } }) },
  { route: "DELETE /:courseId/draft", call: () => other.del(K(courseId, "/draft?draftId=x&revision=0")) },
  { route: "POST /:courseId/draft/publish", call: () => other.post(K(courseId, "/draft/publish"), { loaded: { draftId: "x", revision: 0 } }) },
  { route: "PUT /:courseId/modules", call: async () => other.put(K(courseId, "/modules"), await withRevision(courseId, { modules: [] })) },
  { route: "PUT /:courseId/items", call: async () => other.put(K(courseId, "/items"), await withRevision(courseId, { items: [] })) },
  { route: "POST /:courseId/publish", call: () => other.post(K(courseId, "/publish"), { publishItems: true }) },
  { route: "POST /:courseId/publish-pending", call: () => other.post(K(courseId, "/publish-pending"), { versionIds: [] }) },
  { route: "POST /:courseId/publish-pending-versioned", call: () => other.post(K(courseId, "/publish-pending-versioned"), { versionIds: [], expectedCourseIds: [] }) },
  { route: "POST /:courseId/unpublish", call: () => other.post(K(courseId, "/unpublish")) },
  { route: "POST /:courseId/archive", call: () => other.post(K(courseId, "/archive")) },
  { route: "POST /:courseId/restore", call: () => other.post(K(courseId, "/restore")) },
  { route: "DELETE /:courseId", call: () => other.del(K(courseId)) },
  // ADMINISTRATOR-bare (#762), ikke eierskap: 403 `forbidden` også for eieren.
  { route: "POST /:courseId/cascade-delete", call: () => other.post(K(courseId, "/cascade-delete")) },
  { route: "POST /:courseId/enrollments", call: () => other.post(K(courseId, "/enrollments"), { userIds: [participantId] }) },
  { route: "DELETE /:courseId/enrollments/:userId", call: () => other.del(K(courseId, `/enrollments/${participantId}`)) },
];

const moduleRows: Row[] = [
  { route: "PATCH /modules/:moduleId/title", call: () => other.patch(M(moduleId, "/title"), { title: L("Nytt navn") }) },
  { route: "DELETE /modules/:moduleId", call: () => other.del(M(moduleId)) },
  { route: "POST /modules/:moduleId/rubric-versions", call: () => other.post(M(moduleId, "/rubric-versions"), { criteria: { relevance: "0-4" }, scalingRule: { max_total: 20 } }) },
  {
    route: "POST /modules/:moduleId/rubric-versions/ensure",
    call: () => other.post(M(moduleId, "/rubric-versions/ensure"), { taskText: "Oppgave", assessorExpectedContent: "Fasit", certificationLevel: "basic", locale: "nb" }),
  },
  { route: "POST /modules/:moduleId/rubric-versions/sync-blueprint", call: () => other.post(M(moduleId, "/rubric-versions/sync-blueprint"), { blueprintHash: `h${RUN}` }) },
  { route: "POST /modules/:moduleId/prompt-template-versions", call: () => other.post(M(moduleId, "/prompt-template-versions"), { systemPrompt: L("Sys"), userPromptTemplate: L("Eval"), examples: [] }) },
  { route: "POST /modules/:moduleId/mcq-set-versions", call: () => other.post(M(moduleId, "/mcq-set-versions"), { title: L("MCQ"), questions: [{ stem: L("2+2?"), options: [L("4"), L("5")], correctAnswer: L("4") }] }) },
  { route: "POST /modules/:moduleId/module-versions", call: () => other.post(M(moduleId, "/module-versions"), { taskText: L("Oppgave"), assessorExpectedContent: L("Fasit"), ...parts }) },
  { route: "POST /modules/:moduleId/mcq-questions", call: () => other.post(M(moduleId, "/mcq-questions"), { questions: [{ stem: L("3+3?"), options: [L("6"), L("7")], correctAnswer: L("6") }] }) },
  { route: "POST /modules/:moduleId/versions", call: () => other.post(M(moduleId, "/versions"), { taskText: L("Ny oppgave"), assessorExpectedContent: L("Fasit"), ...parts }) },
  {
    route: "POST /modules/:moduleId/benchmark-example-versions",
    call: () => other.post(M(moduleId, "/benchmark-example-versions"), { basePromptTemplateVersionId: parts.promptTemplateVersionId, examples: [{ anchorId: "a1", input: "Svar", expectedOutcome: "PASS" }] }),
  },
  { route: "POST /modules/:moduleId/module-versions/:moduleVersionId/restore", call: () => other.post(M(moduleId, `/module-versions/${moduleVersionId}/restore`)) },
  { route: "POST /modules/:moduleId/module-versions/:moduleVersionId/publish", call: () => other.post(M(moduleId, `/module-versions/${moduleVersionId}/publish`)) },
  { route: "POST /modules/:moduleId/module-versions/:moduleVersionId/publish-versioned", call: () => other.post(M(moduleId, `/module-versions/${moduleVersionId}/publish-versioned`), { moduleVersion: "minor" }) },
  { route: "POST /modules/:moduleId/unpublish", call: () => other.post(M(moduleId, "/unpublish")) },
  { route: "POST /modules/:moduleId/archive", call: () => other.post(M(moduleId, "/archive")) },
  { route: "POST /modules/:moduleId/restore", call: () => other.post(M(moduleId, "/restore")) },
];

// #1180: seksjonsruterens stier er relative til `/sections`.
const sectionRows: Row[] = [
  { route: "PATCH /:sectionId/title", call: () => other.patch(S(sectionId, "/title"), { title: L("Kapret"), expectedVersionNo: 1 }) },
  { route: "PUT /:sectionId", call: () => other.put(S(sectionId), { title: L("Kapret"), bodyMarkdown: L("Kapret."), expectedVersionNo: 1 }) },
  { route: "POST /:sectionId/assets", call: () => other.post(S(sectionId, "/assets")) },
  { route: "POST /:sectionId/publish", call: () => other.post(S(sectionId, "/publish")) },
  { route: "POST /:sectionId/unpublish", call: () => other.post(S(sectionId, "/unpublish")) },
  { route: "POST /:sectionId/archive", call: () => other.post(S(sectionId, "/archive")) },
  { route: "POST /:sectionId/restore", call: () => other.post(S(sectionId, "/restore")) },
  { route: "DELETE /:sectionId", call: () => other.del(S(sectionId)) },
];

// Skrivinger som ikke har id-en i stien, men i kroppen.
const bodyRows: Row[] = [
  {
    route: "kurs: import inn i kurset (updateExisting)",
    call: async () => {
      const exported = await ok(other.get(K(courseId, "/export-package")), "eksport");
      return other.post(`${C}/courses/import`, { payload: exported.envelope, mode: "updateExisting", targetId: courseId });
    },
  },
  {
    route: "modul: import inn i modulen (replaceExisting)",
    call: async () => {
      const exported = await ok(other.get(M(moduleId, "/export-package")), "eksport");
      return other.post(`${C}/modules/import`, { payload: exported.envelope, mode: "replaceExisting", targetId: moduleId });
    },
  },
  {
    route: "seksjon: import inn i seksjonen (replaceExisting)",
    call: async () => {
      const exported = await ok(other.get(S(sectionId, "/export-package")), "eksport");
      return other.post(`${C}/sections/import`, { payload: exported.envelope, mode: "replaceExisting", targetId: sectionId });
    },
  },
  { route: "modul: kalibrering (terskler)", call: () => other.post("/api/calibration/workspace/publish-thresholds", { moduleId, totalMin: 55 }) },
];

/** «METODE /sti» for hver rute på ruteren som ikke er en lesing, og som har `param` i stien. */
function writeRoutes(router: Router, param: string): string[] {
  const out: string[] = [];
  for (const layer of (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack) {
    if (!layer.route || !layer.route.path.includes(param)) continue;
    for (const method of Object.keys(layer.route.methods)) {
      if (method === "get" || method === "head" || method === "options") continue;
      out.push(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  return out.sort();
}

describe("#1165: skrivingen er fortsatt eiernes", () => {
  it("dekningsvakt: hver skriverute på et kurs, en modul eller en seksjon har en rad i tabellen", () => {
    const courseRoutes = writeRoutes(adminCoursesRouter, ":courseId");
    const moduleRoutes = writeRoutes(adminContentRouter, ":moduleId");
    const sectionRoutes = writeRoutes(adminSectionsRouter, ":sectionId");
    // Kontrollcase: finner oppslaget ingen ruter, måler vakta ingenting.
    expect(courseRoutes.length).toBeGreaterThan(10);
    expect(moduleRoutes.length).toBeGreaterThan(10);
    expect(sectionRoutes.length).toBeGreaterThan(5);
    expect(courseRoutes, "ny skriverute på kurset uten rad i tabellen").toEqual(courseRows.map((row) => row.route).sort());
    expect(moduleRoutes, "ny skriverute på modulen uten rad i tabellen").toEqual(moduleRows.map((row) => row.route).sort());
    expect(sectionRoutes, "ny skriverute på seksjonen uten rad i tabellen").toEqual(sectionRows.map((row) => row.route).sort());
  });

  for (const row of [...courseRows, ...moduleRows, ...sectionRows, ...bodyRows]) {
    it(`en annen produsent: ${row.route} gir 403 og endrer ingenting`, async () => {
      const before = await fingerprint();
      const refused = await row.call();
      expect(refused.status, `${row.route}: ${show(refused)}`).toBe(403);
      expect(["content_ownership", "forbidden"]).toContain(refused.body.error);
      expect(await fingerprint(), `${row.route} endret noe`).toBe(before);
    });
  }

  it("kontroll: eieren kan skrive (samme vakt slipper henne inn)", async () => {
    const renamed = await owner.patch(M(moduleId, "/title"), { title: L(tag("nytt navn")) });
    expect(renamed.status, show(renamed)).toBeLessThan(300);
  });

  it("kontroll #1180: eieren kan endre seksjonen (samme vakt slipper henne inn)", async () => {
    const latest = await prisma.courseSectionVersion.findFirstOrThrow({ where: { sectionId }, orderBy: { versionNo: "desc" }, select: { versionNo: true } });
    const renamed = await owner.patch(S(sectionId, "/title"), { title: L(tag("nytt seksjonsnavn")), expectedVersionNo: latest.versionNo });
    expect(renamed.status, show(renamed)).toBeLessThan(300);
  });
});
