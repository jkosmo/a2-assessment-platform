import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// En vanlig SMO — ikke administrator. Det er hen dette rammer.
const smo = {
  "x-user-id": "eierskap-smo",
  "x-user-email": "eierskap.smo@company.com",
  "x-user-name": "Eierskap SMO",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

const admin = {
  "x-user-id": "eierskap-admin",
  "x-user-email": "eierskap.admin@company.com",
  "x-user-name": "Eierskap Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const FINNES_IKKE = "det-finnes-ingen-slik-kurs-id-1030";

// ─────────────────────────────────────────────────────────────────────────────
// #1030: en ikke-admin som ba om et SLETTET kurs fikk «dette innholdet har ingen eier ennå — be en
// administrator legge deg til som eier».
//
// ⚠️ HVORFOR DET SKJER. Eierskapsvakta er middleware og kjører FØR handleren slår opp om innholdet
// finnes. `listContentOwnerUserIds` gir tom liste for BEGGE tilstandene — finnes uten eier, og
// finnes ikke — så grenen kan ikke skille dem. Brukeren ble bedt om å skaffe seg eierskap til noe
// som ikke er der.
//
// ⚠️ HVORFOR VI IKKE BARE SNUR REKKEFØLGEN. Eksistenssjekk først ville gitt en presis melding, men
// også gratis rekognosering: skillet mellom 403 og 404 kartlegger hvilke ID-er som finnes. Det er
// nettopp den kartleggingen #943 stengte. Meldingen er derfor gjort nøytral i stedet — mindre
// presis, men den lyver ikke.
// ─────────────────────────────────────────────────────────────────────────────

// ⚠️ MÅLT PÅ EN SKRIVERUTE. Da denne saken ble skrevet var `GET /:courseId` eierskapsvaktet, og det
// var der en SMO møtte den løgnaktige meldingen. Lesing er åpnet 2026-09-08 (doc/DECISIONS.md), så
// leseruta går nå gjennom for alle — men `unowned`-grenen, og dermed meldingen, lever på skriving.
describe("#1030 — avslaget om innhold uten eier lyver ikke om at innholdet finnes", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⚠️ en SMO som ber om et kurs som ikke finnes får ikke beskjed om å skaffe seg eierskap", async () => {
    const svar = await request(app)
      .put(`/api/admin/content/courses/${FINNES_IKKE}/items`)
      .set(smo)
      .send({ items: [] });

    expect(svar.status, "fortsatt 403 — se kontrollcasen under").toBe(403);
    expect(svar.body.error).toBe("content_unowned");

    const tekst = String(svar.body.message ?? "");
    expect(
      tekst,
      "«har ingen eier ennå» påstår at innholdet finnes, og ber brukeren skaffe seg eierskap til " +
        "noe som ikke er der",
    ).not.toMatch(/has no owner yet/i);
    expect(tekst, "meldingen skal dekke begge tilstander sannferdig").toMatch(/does not exist/i);
  });

  it("⚠️ KONTROLL: rekkefølgen er IKKE endret — en ikke-admin får fortsatt 403, ikke 404", async () => {
    // Dette er testens viktigste påstand. Den enkleste «fiksen» ville vært å slå opp eksistens
    // først og svare 404. Da hadde meldingen blitt presis — og hvem som helst kunne kartlagt
    // hvilke kurs-ID-er som finnes ved å skille 403 fra 404.
    //
    // Uten denne kontrollen ville testen over vært grønn for en løsning som åpnet nettopp det
    // hullet #943 lukket.
    const svar = await request(app)
      .put(`/api/admin/content/courses/${FINNES_IKKE}/items`)
      .set(smo)
      .send({ items: [] });

    expect(
      svar.status,
      "404 her ville bekreftet at ID-en ikke finnes, og dermed at andre ID-er gjør det",
    ).not.toBe(404);
  });

  it("en administrator får fortsatt 404 — hen har ingenting å kartlegge", async () => {
    // Kontrollcase motsatt vei: uten denne kan vi ikke skille «vakta gjør jobben sin» fra «ruta
    // svarer 403 på alt». Admin går utenom eierskapssjekken og møter handleren, som vet sannheten.
    const svar = await request(app)
      .put(`/api/admin/content/courses/${FINNES_IKKE}/items`)
      .set(admin)
      .send({ items: [] });

    expect(svar.status, "administrator skal få den ærlige 404-en").toBe(404);
  });
});
