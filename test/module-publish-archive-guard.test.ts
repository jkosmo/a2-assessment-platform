import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "arkivvakt-admin",
  "x-user-email": "arkivvakt.admin@company.com",
  "x-user-name": "Arkivvakt Admin",
  "x-user-roles": "ADMINISTRATOR",
};

// ─────────────────────────────────────────────────────────────────────────────
// #955: invarianten «arkivert men publisert oppstår aldri» kunne brytes.
//
// Fire steder håndhever den — `coursePublishService` for både moduler og seksjoner,
// `adminContentCommands`, og repoet som formulerer løftet. Publiseringsruta for en MODULVERSJON
// gjorde det ikke, og kunne ikke: `findModuleContentBundle` selekterte ikke engang `archivedAt`.
//
// ⚠️ HVA DET KOSTER. Scenarioet er ikke teoretisk:
//   1. arkiver en modul  → `activeVersionId` nullstilles
//   2. publiser en versjon direkte på ruta → «arkivert + aktiv versjon» finnes nå
//   3. legg modulen i et kurs → `setCourseItems` sjekker bare eksistens
//   4. `evaluateModule` ser `activeVersionId !== null`, sier `publishable: true`, og UTELATER
//      modulen fra `unpublishedItems`
//   5. kurset publiseres uten kaskade
//
// Deltakeren møter modulen som `available: false` — en blindvei i et publisert kurs, uten at noe
// sa fra underveis.
//
// Samme feilklasse som har truffet oss sju ganger: samme regel på N steder, håndhevet på N−1.
// ─────────────────────────────────────────────────────────────────────────────

describe("#955 — en arkivert modul kan ikke publiseres", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("blokkerer publisering av en versjon på en arkivert modul", async () => {
    const modul = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: { "en-GB": "Archive guard", nb: "Arkivvakt", nn: "Arkivvakt" },
        description: { "en-GB": "Guard", nb: "Vakt", nn: "Vakt" },
        certificationLevel: "basic",
      });
    expect(modul.status, "modulen skal opprettes").toBe(201);
    const moduleId = modul.body.module.id;

    const rubrikk = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/rubric-versions`)
      .set(adminHeaders)
      .send({ criteria: { klarhet: { label: "Klarhet", maxScore: 4 } }, scalingRule: { passTerskel: 0.6 } });
    expect(rubrikk.status).toBe(201);

    const mal = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/prompt-template-versions`)
      .set(adminHeaders)
      .send({ systemPrompt: "s", userPromptTemplate: "u", examples: [] });
    expect(mal.status).toBe(201);

    const versjon = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions`)
      .set(adminHeaders)
      .send({
        assessmentMode: "FREETEXT_ONLY",
        taskText: { "en-GB": "Describe your process.", nb: "Beskriv prosessen din.", nn: "Skildre prosessen din." },
        assessorExpectedContent: {
          "en-GB": "A strong response documents the steps.",
          nb: "Et sterkt svar dokumenterer stegene.",
          nn: "Eit sterkt svar dokumenterer stega.",
        },
        rubricVersionId: rubrikk.body.rubricVersion.id,
        promptTemplateVersionId: mal.body.promptTemplateVersion.id,
      });
    expect(versjon.status, "versjonen skal opprettes").toBe(201);
    const versionId = versjon.body.moduleVersion.id;

    // ⚠️ KONTROLLCASE. Uten dette vet vi ikke om blokkeringen under kommer av arkiveringen eller av
    // en helt annen gate — blueprint, oversettelse, eierskap. En test som bare ser «422» kan ikke
    // skille «vakta virker» fra «noe annet stoppet oss uansett».
    const førArkivering = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versionId}/publish`)
      .set(adminHeaders);
    expect(førArkivering.status, "modulen skal kunne publiseres FØR den arkiveres").toBe(200);

    // Arkiver, som nullstiller activeVersionId (I3).
    const arkiver = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/archive`)
      .set(adminHeaders)
      .send({});
    expect(arkiver.status, "arkivering skal lykkes").toBeLessThan(300);

    const etterArkivering = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/module-versions/${versionId}/publish`)
      .set(adminHeaders);

    expect(
      etterArkivering.status,
      "publisering av en arkivert modul skal blokkeres, ikke gå gjennom",
    ).toBe(422);

    const koder = (etterArkivering.body.issues ?? []).map((i: { code?: string }) => i.code);
    expect(koder, "blokkeringen skal bruke SAMME kode som de fire andre stedene").toContain("item_archived");

    // ⚠️ Og modulen skal fortsatt være avpublisert etterpå. Uten denne kunne ruta svart 422 og
    // likevel ha skrevet activeVersionId — akkurat den tilstanden invarianten forbyr.
    const etterpå = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { archivedAt: true, activeVersionId: true },
    });
    expect(etterpå?.archivedAt, "modulen skal fortsatt være arkivert").not.toBeNull();
    expect(etterpå?.activeVersionId, "arkivert + aktiv versjon skal ikke finnes").toBeNull();
  });
});
