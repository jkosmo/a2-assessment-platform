import { describe, expect, it } from "vitest";
import {
  isSectionAvailableToParticipant,
  sectionAvailableWhere,
} from "../../src/modules/course/sectionAvailability.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// #958: predikatet er ORAKELET for Prisma-filteret.
//
// Etter #958 er det `sectionAvailableWhere` som faktisk kjører — filtreringen skjer i databasen, i
// `findCourseItemsForParticipant`. Predikatet over er den lesbare formen av samme setning, og to
// formuleringer av samme regel er nøyaktig feilklassen #938 handlet om.
//
// Derfor står de ikke bare ved siden av hverandre: predikatet er spesifikasjonen filteret måles mot,
// over alle fire kombinasjonene. Endrer noen den ene uten den andre, blir dette rødt.
// ─────────────────────────────────────────────────────────────────────────────

describe("#958: sectionAvailableWhere svarer likt som predikatet, på alle fire kombinasjonene", () => {
  /** Evaluerer `sectionAvailableWhere` slik Prisma ville gjort — de to operatorene den bruker. */
  function whereAccepts(section: { archivedAt: Date | null; activeVersionId: string | null }) {
    return (
      section.archivedAt === sectionAvailableWhere.archivedAt
      && section.activeVersionId !== sectionAvailableWhere.activeVersionId.not
    );
  }

  const combinations = [
    { archivedAt: null, activeVersionId: "v1" },
    { archivedAt: null, activeVersionId: null },
    { archivedAt: new Date(), activeVersionId: "v1" },
    { archivedAt: new Date(), activeVersionId: null },
  ];

  for (const section of combinations) {
    it(`archivedAt=${section.archivedAt ? "satt" : "null"}, activeVersionId=${section.activeVersionId ?? "null"}`, () => {
      expect(whereAccepts(section)).toBe(isSectionAvailableToParticipant(section));
    });
  }

  it("KONTROLLCASE: de fire kombinasjonene gir ikke samme svar", () => {
    // Uten denne ville testene over bestått hvis begge formene alltid sa «ja» (eller alltid «nei»).
    // Da måler man at to konstanter er like, ikke at to regler er enige.
    const answers = combinations.map(isSectionAvailableToParticipant);
    expect(answers).toEqual([true, false, false, false]);
  });
});
