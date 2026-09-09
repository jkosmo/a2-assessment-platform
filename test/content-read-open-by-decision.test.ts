import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

// En SMO som ikke eier noe av innholdet under. Det er nettopp hen beslutningen handler om.
const fremmedSmo = {
  "x-user-id": "fremmed-smo",
  "x-user-email": "fremmed.smo@company.com",
  "x-user-name": "Fremmed SMO",
  "x-user-roles": "SUBJECT_MATTER_OWNER",
};

const eier = {
  "x-user-id": "eier-admin",
  "x-user-email": "eier.admin@company.com",
  "x-user-name": "Eier Admin",
  "x-user-roles": "ADMINISTRATOR",
};

const L = (t: string) => ({ "en-GB": t, nb: t, nn: t });

// ─────────────────────────────────────────────────────────────────────────────
// LESING AV KURSINNHOLD ER ÅPEN — OG DET ER EN BESLUTNING, IKKE ET HULL.
//
// Produkteier 2026-09-08:
//
//   «Er man SMO skal man kunne se alt kursinnhold. Hvis de benytter dette til å jukse, så er det
//   til slutt deres eget problem. Dette er et verktøy for kompetansebygging, og å motivere for
//   kompetansebygging — hvis noen ønsker å omgå dette er det deres eget problem.»
//
// ⚠️ DENNE TESTEN FINNES FOR Å HINDRE AT BESLUTNINGEN BLIR «RETTET» TILBAKE. #943 la vaktene på i
// god tro, etter et funn fra nattskanningen. En senere skanning vil se det samme mønsteret igjen —
// åpen lesing ved siden av vaktet skriving — og foreslå det samme. Uten en test som sier at
// asymmetrien er tilsiktet, er den bare et funn som venter på å bli lukket på nytt.
//
// ⚠️ #943s EGEN BEGRUNNELSE ER OGSÅ BORTE. Den var ikke at kolleger ikke skal se hverandres arbeid,
// men at lesetilgang gjorde et eierskapshull i kursimporten utnyttbart. `POST /courses/import`
// krever i dag eierskap for `replaceExisting`, så det hullet er tettet.
// ─────────────────────────────────────────────────────────────────────────────

describe("kursinnhold kan leses av enhver forfatter", () => {
  let courseId = "";
  let sectionId = "";

  beforeAll(async () => {
    const kurs = await request(app)
      .post("/api/admin/content/courses")
      .set(eier)
      .send({ title: L(`Fremmed kurs ${Date.now()}`), description: L("d") });
    expect(kurs.status, "kurset skal opprettes").toBe(201);
    courseId = kurs.body.course?.id ?? kurs.body.id;

    const seksjon = await request(app)
      .post("/api/admin/content/sections")
      .set(eier)
      .send({ title: L("Fremmed seksjon"), bodyMarkdown: L("Lesestoff.") });
    expect(seksjon.status).toBeLessThan(300);
    sectionId = seksjon.body.section?.id ?? seksjon.body.id;

    // ⚠️ Kurset må ha et element for at eksporten skal ha noe å pakke — et tomt kurs gir 422, og
    // da ville eksporttesten under bestått av helt feil grunn: den ville målt «kurset er tomt»,
    // ikke «en fremmed forfatter slipper til».
    const koblet = await request(app)
      .put(`/api/admin/content/courses/${courseId}/items`)
      .set(eier)
      .send({ items: [{ type: "SECTION", sectionId }] });
    expect(koblet.status, `elementet skal kobles: ${JSON.stringify(koblet.body).slice(0, 200)}`)
      .toBeLessThan(300);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⚠️ en fremmed SMO kan lese et kurs hen ikke eier", async () => {
    const svar = await request(app).get(`/api/admin/content/courses/${courseId}`).set(fremmedSmo);
    expect(
      svar.status,
      "403 her betyr at #943-vakta er tilbake — se beslutningen i toppen av fila",
    ).toBeLessThan(300);
  });

  it("⚠️ og seksjoner, som er det tydeligste tilfellet", async () => {
    // Produkteier: «Når det gjelder seksjoner så er det i alle fall ingen grunn til å beskytte mot
    // lesing, vi ønsker at så mange som mulig leser seksjoner.»
    const svar = await request(app).get(`/api/admin/content/sections/${sectionId}`).set(fremmedSmo);
    expect(svar.status, "lesestoff skal ikke være skjult for kolleger").toBeLessThan(300);
  });

  it("⚠️ KONTROLL: å ENDRE er fortsatt vaktet", async () => {
    // Blokkeringens makker. Beslutningen gjelder å SE, ikke å endre. Uten denne kunne vaktene vært
    // fjernet fra skriverutene også, og testene over ville sett nøyaktig like grønne ut.
    const svar = await request(app)
      .patch(`/api/admin/content/sections/${sectionId}/title`)
      .set(fremmedSmo)
      .send({ title: L("Kapret") });
    expect(svar.status, "en fremmed SMO skal ikke kunne endre andres seksjon").toBe(403);
  });

  it("⚠️ en fremmed SMO kan eksportere kurset — MCQ-fasiten inkludert", async () => {
    // ⚠️ DETTE ER EN BESLUTNING, OG DEN VAR OPPE TIL VURDERING TO GANGER.
    //
    // Målingen viste hva som lå i eksporten: 4 av 7 vellykkede kurseksporter ga `correctAnswer` til
    // en SMO som ikke eide noe av innholdet. Jeg foreslo å strippe fasiten for den som ikke eier
    // modulen. Produkteier 2026-09-08:
    //
    //   «Hvis noen ønsker å jukse så er det fritt frem — det er bare å laste ned modulen og legge
    //   den inn i en LLM, så får de fasit. Vi skal ikke ta høyde for å sikre oss mot juks, det er
    //   umulig.»
    //
    // Argumentet holder: oppgaveteksten og alternativene gir en språkmodell svaret uansett om vi
    // sender `correctAnswer` eller ikke. Strippingen ville vært en kostnad uten en beskyttelse —
    // og #392 viste allerede hva den koster: en sikkerhetskopi som mistet svarene ved import.
    //
    // Testen står her for at ingen skal «rette» dette tilbake i god tro. Feiler den, er det fordi
    // noen har gjeninnført en beskyttelse som er vurdert og forkastet.
    const pakke = await request(app)
      .get(`/api/admin/content/courses/${courseId}/export-package`)
      .set(fremmedSmo);

    expect(pakke.status, "en fremmed forfatter skal kunne eksportere kurset").toBeLessThan(300);
  });

  it("⚠️ KONTROLL: deltakerlista er IKKE kursinnhold og forblir vaktet", async () => {
    // `/enrollments` lister navn, e-post og avdeling. «Juks er deres eget problem» er en beslutning
    // om innhold, ikke om andres personopplysninger. Skal den også åpnes, er det en egen beslutning
    // — og da skal denne testen feile og tvinge den fram i en diff.
    const svar = await request(app)
      .get(`/api/admin/content/courses/${courseId}/enrollments`)
      .set(fremmedSmo);
    expect(svar.status, "personopplysninger er ikke dekket av beslutningen om kursinnhold").toBe(403);
  });
});
