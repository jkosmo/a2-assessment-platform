import { describe, expect, it } from "vitest";
import { isSectionAvailableToParticipant, sectionAvailableWhere } from "../../src/modules/course/sectionAvailability.js";

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
// #992: regelen finnes i TO former — som predikat og som Prisma-where. Den ene kan ikke kjøre i
// databasen, så duplikatet er uunngåelig. Da må det i det minste være bevist enig med seg selv.
// ─────────────────────────────────────────────────────────────────────────────

describe("#992: where-formen sier det samme som predikatet", () => {
  // Simulerer hva Prisma ville sluppet gjennom for `{ archivedAt: null, activeVersionId: { not: null } }`.
  // Ikke en ekte spørring — men den leser where-objektet, så en endring DER slår ut her.
  function matchesWhere(row: { archivedAt: Date | null; activeVersionId: string | null }): boolean {
    const w = sectionAvailableWhere as { archivedAt: null; activeVersionId: { not: null } };
    if (Object.keys(w).length !== 2) throw new Error("where-formen har fått felt predikatet ikke kjenner");
    return row.archivedAt === w.archivedAt && row.activeVersionId !== w.activeVersionId.not;
  }

  const rows = [
    { archivedAt: null, activeVersionId: "v1" },
    { archivedAt: null, activeVersionId: null },
    { archivedAt: new Date(), activeVersionId: "v1" },
    { archivedAt: new Date(), activeVersionId: null },
  ];

  it.each(rows)("enige om %o", (row) => {
    expect(matchesWhere(row)).toBe(isSectionAvailableToParticipant(row));
  });

  it("KONTROLL: de fire radene dekker begge utfall", () => {
    // Uten denne kunne begge sider vært konstant false og «enige» om ingenting.
    const results = rows.map(isSectionAvailableToParticipant);
    expect(results).toContain(true);
    expect(results).toContain(false);
  });
});
