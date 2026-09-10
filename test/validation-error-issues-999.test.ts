// ─────────────────────────────────────────────────────────────────────────────
// #999 siste porsjon: de elleve HÅNDBYGDE formavslagene bærer nå `issues`.
//
// ⚠️ HVORFOR EN INTEGRASJONSTEST OG IKKE BARE RATSJEN. Ratsjen i
// `test/unit/domain-error-codes-999.test.ts` teller LINJER i kildekoden. Den ser at frasen er
// borte — ikke at ruta faktisk svarer med `issues`. Det er to forskjellige påstander, og en
// omskriving som bare flyttet setningen ville sett like grønn ut nedenfra.
//
// ⚠️ DET ER `issues` SOM ER MÅLET, IKKE FRAVÆRET AV `message`. `api-error.js` velger gren på
// `Array.isArray(body.issues)`: er den der, får brukeren den generiske, LOKALISERTE overskriften og
// Zod-utdataet i detaljfeltet. Er den borte, vises serverens engelske setning ordrett — uansett
// hvilket språk brukeren har valgt. Testene under påstår derfor nøyaktig det klienten forgrener på.
//
// Ingen av de elleve fikk kode, og det var poenget: «url is required» og «Missing file» er
// FORMVALIDERING. En `DomainRuleError` ville påstått at brukeren brøt en regel om innholdet.
// ─────────────────────────────────────────────────────────────────────────────

import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// ⚠️ EGEN BRUKER-ID, IKKE `admin-1`. `generateLimiter` er 10 forespørsler per minutt PER BRUKER, og
// fem av rutene under ligger bak den. Deler vi bøtte med de andre admin-testene i samme kjøring,
// blir feilen en 429 som ser ut som en ekte regresjon.
const adminHeaders = {
  "x-user-id": "admin-999-issues",
  "x-user-email": "admin-999-issues@company.com",
  "x-user-name": "Issues Guard Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const smoHeaders = {
  "x-user-id": "smo-999-issues",
  "x-user-email": "smo-999-issues@company.com",
  "x-user-name": "Issues Guard SMO",
  "x-user-department": "Learning",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

/**
 * Det klienten faktisk forgrener på: 400, koden `validation_error`, og en ikke-tom `issues`-LISTE.
 *
 * ⚠️ `felt` ER IKKE PYNT. Første utgave av denne fila påsto bare «400 med issues», og da var
 * komponeringstesten GRØNN med skjemakontrollen fjernet: ruta avviser den samme kroppen for fire
 * andre grunner (oppgavetekst, rubrikk, promptmal, MCQ-sett), så avslaget kom uansett. Testen målte
 * at ruta er streng, ikke at DENNE regelen finnes. Fanget av mutasjonstesting, ikke av lesing.
 */
function forventFormavslag(
  response: { status: number; body: Record<string, unknown> },
  hva: string,
  felt: string,
) {
  const kropp = JSON.stringify(response.body);
  expect(response.status, `${hva}: ${kropp}`).toBe(400);
  expect(response.body.error, hva).toBe("validation_error");
  expect(Array.isArray(response.body.issues), `${hva}: issues må være en LISTE — ${kropp}`).toBe(true);
  const treff = (response.body.issues as { path?: unknown[] }[]).filter((issue) =>
    (issue.path ?? []).includes(felt),
  );
  expect(treff.length, `${hva}: ingen innvending peker på «${felt}» — ${kropp}`).toBeGreaterThan(0);
}

describe("#999 — formavslagene bærer issues, ikke serverens prosa", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROLLCASE: hjelperen kan se forskjell på et Zod-avslag og et kodeløst svar", () => {
    // Uten denne kunne `forventFormavslag` vært grønn på hva som helst — og da måler resten av fila
    // ingenting. En manglende `issues` MÅ få den til å kaste.
    const avslag = (body: Record<string, unknown>, felt: string) => () =>
      forventFormavslag({ status: 400, body }, "kontroll", felt);

    expect(avslag({ error: "validation_error", message: "url is required" }, "url")).toThrow();
    // Og en objekt-`issues` (ikke liste) er heller ikke godt nok: `api-error.js` bruker
    // `Array.isArray`, så et objekt tar samme gren som ingenting.
    expect(avslag({ error: "validation_error", issues: { url: ["required"] } }, "url")).toThrow();
    // ⚠️ Og et avslag om NOE ANNET teller ikke. Det var akkurat dette hullet mutasjonstesten fant:
    // ruta svarte 400 med issues om fire andre felter, og testen så det som bestått.
    expect(avslag({ error: "validation_error", issues: [{ path: ["taskText"] }] }, "validTo")).toThrow();
    expect(avslag({ error: "validation_error", issues: [{ path: ["url"] }] }, "url")).not.toThrow();
  });

  it("agent-authoring/validate: feil packageFormat", async () => {
    const response = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set(adminHeaders)
      .send({ package: { packageFormat: "a2-content-export/v1" } });
    forventFormavslag(response, "feil packageFormat", "packageFormat");
  });

  it("agent-authoring/validate: kropp uten `package`", async () => {
    const response = await request(app)
      .post("/api/admin/content/agent-authoring/validate")
      .set(adminHeaders)
      .send({});
    forventFormavslag(response, "manglende package", "package");
  });

  it("POST /modules: ulesbar validFrom", async () => {
    const response = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: { nb: "Datotest", nn: "Datotest", "en-GB": "Date test" },
        certificationLevel: "basic",
        validFrom: "ikke-en-dato",
      });
    forventFormavslag(response, "modules validFrom", "validFrom");
  });

  it("POST /modules/:id/versions: ulesbar validTo", async () => {
    // Skjemaet kjører FØR eierskapssjekken, så en modul-id som ikke finnes er nok her — og gjør
    // testen uavhengig av seeddata.
    const response = await request(app)
      .post("/api/admin/content/modules/finnes-ikke/versions")
      .set(adminHeaders)
      .send({ validTo: "ikke-en-dato" });
    forventFormavslag(response, "compose validTo", "validTo");
  });

  it("source-material/fetch-url og crawl-url: url mangler", async () => {
    const fetchUrl = await request(app)
      .post("/api/admin/content/source-material/fetch-url")
      .set(adminHeaders)
      .send({});
    forventFormavslag(fetchUrl, "fetch-url uten url", "url");

    const crawlUrl = await request(app)
      .post("/api/admin/content/source-material/crawl-url")
      .set(adminHeaders)
      .send({ url: "   " });
    forventFormavslag(crawlUrl, "crawl-url med bare mellomrom", "url");
  });

  it("source-material/condense: tomt kildemateriale, ukjent nivå, ukjent språk", async () => {
    const tomt = await request(app)
      .post("/api/admin/content/source-material/condense")
      .set(adminHeaders)
      .send({ sourceMaterial: "   " });
    forventFormavslag(tomt, "condense uten sourceMaterial", "sourceMaterial");

    const nivå = await request(app)
      .post("/api/admin/content/source-material/condense")
      .set(adminHeaders)
      .send({ sourceMaterial: "Tekst", certificationLevel: "ekspert" });
    forventFormavslag(nivå, "condense med ukjent nivå", "certificationLevel");

    const språk = await request(app)
      .post("/api/admin/content/source-material/condense")
      .set(adminHeaders)
      .send({ sourceMaterial: "Tekst", locale: "sv-SE" });
    forventFormavslag(språk, "condense med ukjent språk", "locale");
  });

  it("calibration/workspace: ukjent statusfilter og ulesbar dato", async () => {
    const status = await request(app)
      .get("/api/calibration/workspace?moduleId=finnes-ikke&status=IKKE_EN_STATUS")
      .set(smoHeaders);
    forventFormavslag(status, "kalibrering statusfilter", "status");

    const dato = await request(app)
      .get("/api/calibration/workspace?moduleId=finnes-ikke&dateFrom=ikke-en-dato")
      .set(smoHeaders);
    forventFormavslag(dato, "kalibrering dateFrom", "dateFrom");
  });

  it("seksjonsvedlegg: opplasting uten fil", async () => {
    const opprettet = await request(app)
      .post("/api/admin/content/sections")
      .set(adminHeaders)
      .send({
        title: { nb: `Vedleggstest ${Date.now()}`, nn: "Vedleggstest", "en-GB": "Asset test" },
        bodyMarkdown: { nb: "# Hei", nn: "# Hei", "en-GB": "# Hi" },
      });
    expect(opprettet.status, JSON.stringify(opprettet.body)).toBe(201);
    const sectionId = opprettet.body.section.id as string;

    try {
      const response = await request(app)
        .post(`/api/admin/content/sections/${sectionId}/assets`)
        .set(adminHeaders);
      forventFormavslag(response, "vedlegg uten fil", "file");
    } finally {
      await prisma.courseSection.update({ where: { id: sectionId }, data: { activeVersionId: null } });
      await prisma.courseSectionVersion.deleteMany({ where: { sectionId } });
      await prisma.courseSection.delete({ where: { id: sectionId } });
    }
  });

  // ⚠️ MOTPRØVEN. Uten den kunne alle testene over vært grønne fordi rutene svarer 400 på ALT —
  // «regelen virker» og «ingenting slipper gjennom» ser like ut nedenfra.
  it("KONTROLLCASE: gyldige verdier slipper forbi skjemaet", async () => {
    const gyldigDato = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: { nb: `Gyldig dato ${Date.now()}`, nn: "Gyldig dato", "en-GB": "Valid date" },
        certificationLevel: "basic",
        validFrom: "2026-01-01",
      });
    expect(gyldigDato.status, JSON.stringify(gyldigDato.body)).toBe(201);
    const moduleId = gyldigDato.body.module.id as string;
    await prisma.module.delete({ where: { id: moduleId } });

    // Tom streng betyr «ikke satt» hos begge kallerne, og skal fortsatt slippe gjennom — avviste
    // skjemaet den, ville et fjernet tidsvindu blitt en feil.
    //
    // ⚠️ Komponeringsruta avviser kroppen uansett (den mangler oppgavetekst, rubrikk og resten), så
    // påstanden kan ikke være «ikke 400». Den må være at ingen av innvendingene handler om DATOEN.
    const tomDato = await request(app)
      .post("/api/admin/content/modules/finnes-ikke/versions")
      .set(adminHeaders)
      .send({ validFrom: "" });
    const datoInnvendinger = ((tomDato.body.issues ?? []) as { path?: unknown[] }[]).filter((issue) =>
      (issue.path ?? []).includes("validFrom"),
    );
    expect(datoInnvendinger, `tom validFrom skal ikke avvises: ${JSON.stringify(tomDato.body)}`).toEqual([]);
  });
});
