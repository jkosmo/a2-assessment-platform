import { describe, expect, it } from "vitest";
import { isSectionAvailableToParticipant } from "../../src/modules/course/sectionAvailability.js";

// ─────────────────────────────────────────────────────────────────────────────
// #944: predikatet testes DIREKTE her, fordi det ene leddet ikke kan nås gjennom API-et.
//
// `archiveSection` setter `archivedAt` OG nuller `activeVersionId` i samme skriving
// (`sectionCommands.ts:384`), så tilstanden «arkivert, men med aktiv versjon» oppstår ikke via
// normal vei. En integrasjonstest på en arkivert seksjon feiler derfor på VERSJONS-leddet uansett,
// og ville vært grønn selv om arkiv-leddet ikke fantes.
//
// ⚠️ Det oppdaget jeg ved å mutere hvert ledd for seg: å fjerne versjons-leddet gjorde tre
// integrasjonstester røde, mens å fjerne arkiv-leddet gjorde ingen av dem røde. Den «arkiverte»
// fikstureringen min målte i praksis det andre leddet.
//
// Arkiv-leddet BEHOLDES likevel, som forsvar i dybden: databasen tillater kombinasjonen, importen
// kan skrive den, og #938 sin inngangsdør er ikke stengt ennå. Men da må det testes der det faktisk
// kan avgjøres — her, med konstruerte inndata.
// ─────────────────────────────────────────────────────────────────────────────

describe("#944: isSectionAvailableToParticipant", () => {
  it("publisert og ikke arkivert → tilgjengelig", () => {
    expect(isSectionAvailableToParticipant({ archivedAt: null, activeVersionId: "v1" })).toBe(true);
  });

  it("uten aktiv versjon → ikke tilgjengelig (oversettelsesgaten holdt den tilbake)", () => {
    expect(isSectionAvailableToParticipant({ archivedAt: null, activeVersionId: null })).toBe(false);
  });

  it("arkivert MED aktiv versjon → ikke tilgjengelig", () => {
    // Den kombinasjonen `archiveSection` aldri lager, men databasen tillater. Dette er den ENESTE
    // testen som kan skille arkiv-leddet fra versjons-leddet — fjern den, og leddet blir udekket.
    expect(isSectionAvailableToParticipant({ archivedAt: new Date(), activeVersionId: "v1" })).toBe(false);
  });

  it("arkivert og uten aktiv versjon → ikke tilgjengelig", () => {
    // Tilstanden `archiveSection` faktisk produserer. Begge ledd feiler; testen sier ingenting om
    // hvilket, og det er greit så lenge de tre over dekker hver for seg.
    expect(isSectionAvailableToParticipant({ archivedAt: new Date(), activeVersionId: null })).toBe(false);
  });
});
