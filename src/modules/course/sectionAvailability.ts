// #944: ÉN definisjon av «kan en deltaker faktisk lese denne seksjonen».
//
// ⚠️ Hvorfor denne fila finnes.
//
// Fram til nå svarte fem steder ulikt på det spørsmålet:
//
//   courses.ts (hent innhold)          ingenting — kun medlemskap i kurset
//   courses.ts (marker lest)           ingenting — kun medlemskap
//   courseCompletionService (kravet)   archivedAt == null
//   coursePublishService (gaten)       activeVersionId !== null
//   courses.ts (MODUL i samme løkke)   activeVersionId && publishedAt && !archivedAt
//
// Seksjoner fikk ikke engang et `available`-felt i DTO-en, så klienten satte det til true for alle.
//
// Utfallet: en seksjon uten aktiv versjon — arkivert, ELLER holdt tilbake av oversettelsesgaten —
// ga deltakeren 200 med TOM SIDE. Hen trykket «lest», lesningen ble registrert, og kursbeviset
// utstedt for innhold som aldri ble publisert.
//
// To helt ulike årsaker, samme sti. Derfor er kuren én predikat begge årsakene går gjennom, ikke
// et filter til på hvert kallsted.
//
// Merk at `contentImportService.ts:149-151` beskriver nøyaktig dette scenariet som oppdaget en gang
// før. Fiksen ble den gangen lagt i IMPORTEN, ikke i lesestien — så alle andre veier til samme
// tilstand sto åpne.
//
// ── #958, oppfølgingen ───────────────────────────────────────────────────────────────────────
// Predikatet var riktig, men det var fortsatt kallerne som måtte huske å bruke det: `findCourseItems`
// leverte råmaterialet til alle åtte, og fire av dem tok hver sin avgjørelse. Nå bor regelen i
// `courseRepository.findCourseItemsForParticipant`, som filtrerer i spørringen og IKKE returnerer
// feltene under. Ingen av deltakerflatene kaller lenger predikatet direkte — de kan ikke, for de får
// ikke `archivedAt`/`activeVersionId` å regne på.
//
// Predikatet blir stående fordi det er den lesbare formen av regelen (og fordi det er formen som er
// direkte enhetstestbar, se kommentaren på arkiv-leddet under). `sectionAvailableWhere` er det som
// faktisk kjører.

/** Det minimale en seksjon må ha for at predikatet skal kunne avgjøres. */
export type SectionAvailabilityInput = {
  archivedAt: Date | null;
  activeVersionId: string | null;
};

/**
 * Sann når deltakeren kan lese seksjonen: den er ikke arkivert, OG den har en aktiv versjon.
 *
 * ⚠️ Begge leddene trengs, og de fanger hver sin årsak:
 *   - `archivedAt`      innholdet er tatt ut av sirkulasjon
 *   - `activeVersionId` innholdet er aldri publisert (typisk holdt av oversettelsesgaten)
 *
 * `archiveSection` (`sectionCommands.ts:384`) setter BEGGE feltene i samme skriving, så en arkivert
 * seksjon feiler begge ledd. En tilbakeholdt seksjon feiler bare det andre — og det er den som var
 * det levende hullet.
 *
 * ⚠️ Arkiv-leddet er derfor FORSVAR I DYBDEN, ikke bærende i dag: ingen normal vei lager
 * «arkivert med aktiv versjon». Det beholdes fordi databasen tillater kombinasjonen, importen kan
 * skrive den, og #938 sin inngangsdør ikke er stengt ennå.
 *
 * Konsekvensen for testing: en integrasjonstest på en arkivert seksjon feiler på versjons-leddet
 * uansett og kan IKKE skille de to. Arkiv-leddet er derfor dekket av
 * `test/unit/section-availability.test.ts`, som konstruerer tilstanden direkte. Verifisert ved å
 * mutere hvert ledd for seg — uten den unit-testen var arkiv-leddet udekket.
 */
export function isSectionAvailableToParticipant(section: SectionAvailabilityInput): boolean {
  return section.archivedAt === null && section.activeVersionId !== null;
}

/**
 * Samme regel som predikatet over, uttrykt som et Prisma-filter på `CourseSection`.
 *
 * ⚠️ Duplikatet er uunngåelig, ikke slurv: predikatet kan ikke kjøre i databasen, så et sted MÅ
 * regelen finnes i where-form. Det eneste vi kan gjøre er å la de to stavemåtene bo ved siden av
 * hverandre, slik at den som endrer den ene ser den andre.
 *
 * ⚠️ Hvorfor den bor HER og ikke i spørringene: #958. Regelen sto som en anonym `where`-literal i
 * `findCourseItemSectionIdsForCourses` mens predikatet sto i denne fila — to formuleringer av samme
 * setning, uten noe som holdt dem i takt. Endrer man den ene, tier den andre.
 *
 * Bruk `sectionAvailableWhere` når filtreringen kan skje i databasen (én rundtur, og kalleren får
 * aldri se radene den ikke skal bruke), og `isSectionAvailableToParticipant` når raden allerede er
 * lest. De to MÅ svare likt — `test/unit/section-availability.test.ts` sjekker det for alle fire
 * kombinasjonene, og er det eneste som holder dem i takt.
 */
export const sectionAvailableWhere = {
  archivedAt: null,
  activeVersionId: { not: null },
} as const;
