import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

const adminHeaders = {
  "x-user-id": "omfang-admin",
  "x-user-email": "omfang.admin@company.com",
  "x-user-name": "Omfang Admin",
  "x-user-roles": "ADMINISTRATOR",
};

// ─────────────────────────────────────────────────────────────────────────────
// #1049: forfatteren kan overstyre forventet svarlengde.
//
// ⚠️ HVORFOR DET ER ET EGET FELT, OG IKKE NIVÅET. Produkteier 2026-09-06: «Det er ikke slik at det
// å skrive langt er vanskeligere enn å være kort.» Tabellen sa det motsatte — advanced ga
// 400–700 ord — og hver generert oppgave arvet påstanden.
//
// ⚠️ HVORFOR PÅ `Module` OG IKKE PÅ VERSJONEN. Genereringen er TILSTANDSLØS: den tar ingen
// moduleId, og den kjøres før den første versjonen finnes. Feltet må derfor ligge et sted klienten
// kan lese FØR generering, altså på modulen — ved siden av `certificationLevel`, som løser nøyaktig
// samme problem og allerede har rørleggingen.
//
// ⚠️ OG DERFOR IKKE I `assessmentPolicy`. Den ligger på versjonen, og den handler om VURDERING —
// scoring og passRules. Omfang handler om GENERERING. Å legge det der ville gjentatt den
// konflateringen saken retter, ett hakk til side.
//
// NULL betyr «bruk nivåets standard». Kolonnene har derfor ingen default: en default ville frosset
// dagens tall i hver rad, og en endring av standarden ville ikke nådd eksisterende moduler.
// ─────────────────────────────────────────────────────────────────────────────

describe("#1049 — forfatterens omfang lagres og overstyrer nivåets standard", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lagres ved opprettelse, endres ved lagring, og kan nullstilles til standarden", async () => {
    const opprettet = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: { "en-GB": "Scope", nb: "Omfang", nn: "Omfang" },
        certificationLevel: "advanced",
        // Korte svar på et avansert nivå — nettopp kombinasjonen den gamle tabellen gjorde umulig.
        scopeMinWords: 150,
        scopeMaxWords: 250,
      });
    expect(opprettet.status, "modulen skal opprettes").toBe(201);
    const moduleId = opprettet.body.module.id;

    const etterOpprettelse = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { certificationLevel: true, scopeMinWords: true, scopeMaxWords: true },
    });
    expect(etterOpprettelse?.scopeMinWords).toBe(150);
    expect(etterOpprettelse?.scopeMaxWords).toBe(250);

    // ⚠️ KONTROLLCASE. Uten dette kan testen ikke skille «omfanget ble lagret» fra «alle felt
    // lagres uansett hva vi sender» — nivået skal stå urørt ved siden av.
    expect(etterOpprettelse?.certificationLevel, "nivået skal være uendret").toContain("advanced");

    // Endring gjennom samme vei som Innstillinger bruker.
    //
    // ⚠️ Ruta komponerer en VERSJON, så kroppen må bære versjonsinnhold også — modulfeltene alene
    // avvises. Slik gjør Innstillinger det: den sender de endrede modulfeltene sammen med
    // versjonen. MCQ_ONLY er den letteste gyldige formen: ingen rubrikk, ingen ledetekst.
    const versjonsinnhold = {
      assessmentMode: "MCQ_ONLY" as const,
      mcqSet: {
        title: { "en-GB": "Quiz", nb: "Quiz", nn: "Quiz" },
        questions: [{
          stem: { "en-GB": "Which one?", nb: "Hvilken?", nn: "Kva for ein?" },
          options: [
            { "en-GB": "A", nb: "A", nn: "A" },
            { "en-GB": "B", nb: "B", nn: "B" },
          ],
          correctAnswer: { "en-GB": "A", nb: "A", nn: "A" },
          rationale: { "en-GB": "Because A.", nb: "Fordi A.", nn: "Fordi A." },
        }],
      },
    };

    const endret = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ ...versjonsinnhold, scopeMinWords: 120, scopeMaxWords: 200 });
    expect(endret.status, `lagringen skal gå gjennom: ${JSON.stringify(endret.body).slice(0, 300)}`).toBeLessThan(300);

    const etterEndring = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { scopeMinWords: true, scopeMaxWords: true },
    });
    expect(etterEndring?.scopeMinWords).toBe(120);
    expect(etterEndring?.scopeMaxWords).toBe(200);

    // ⚠️ NULL ER EN EKTE VERDI HER: «tilbake til nivåets standard». Uten at null kan skrives, ville
    // en forfatter som satte et tall aldri kunne angre — bare bytte det mot et annet tall.
    const nullstilt = await request(app)
      .post(`/api/admin/content/modules/${moduleId}/versions`)
      .set(adminHeaders)
      .send({ ...versjonsinnhold, scopeMinWords: null, scopeMaxWords: null });
    expect(nullstilt.status).toBeLessThan(300);

    const etterNullstilling = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { scopeMinWords: true, scopeMaxWords: true },
    });
    expect(etterNullstilling?.scopeMinWords).toBeNull();
    expect(etterNullstilling?.scopeMaxWords).toBeNull();

    // Lagringen laget en versjon, så modulen kan ikke slettes rett fram. Ryddingen skal ikke kunne
    // maskere resultatet over, derfor best effort.
    try {
      await prisma.module.update({ where: { id: moduleId }, data: { activeVersionId: null } });
      await prisma.mCQSetVersion.deleteMany({ where: { moduleId } });
      await prisma.moduleVersion.deleteMany({ where: { moduleId } });
      await prisma.module.delete({ where: { id: moduleId } });
    } catch {
      // Testdatabasen tåler en etterlatt rad; en rød test her ville pekt på oppryddingen, ikke
      // på feltet vi måler.
    }
  });

  it("en modul uten omfang lagrer null, ikke nivåets tall", async () => {
    // Standarden hører hjemme i koden. Skrev vi den inn i raden, ville en endring av standarden
    // ikke nådd moduler som aldri hadde bedt om noe annet.
    const opprettet = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: { "en-GB": "No scope", nb: "Uten omfang", nn: "Utan omfang" },
        certificationLevel: "advanced",
      });
    expect(opprettet.status).toBe(201);

    const rad = await prisma.module.findUnique({
      where: { id: opprettet.body.module.id },
      select: { scopeMinWords: true, scopeMaxWords: true },
    });
    expect(rad?.scopeMinWords, "ingen default i databasen").toBeNull();
    expect(rad?.scopeMaxWords).toBeNull();

    await prisma.module.delete({ where: { id: opprettet.body.module.id } });
  });

  it("avviser tall utenfor det rimelige", async () => {
    const svar = await request(app)
      .post("/api/admin/content/modules")
      .set(adminHeaders)
      .send({
        title: { "en-GB": "Bad", nb: "Ugyldig", nn: "Ugyldig" },
        certificationLevel: "basic",
        scopeMinWords: 999999,
      });
    expect(svar.status, "et urimelig ordantall skal avvises av skjemaet").toBe(400);
  });
});
