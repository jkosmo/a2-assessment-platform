# Design #1095 — Justere et publisert kurs: eksport med identiteter, skill som justerer, reimport som oppdaterer

Produkteier, 2026-10-12: «Vi trenger funksjonalitet for dette. Strømlinjeformet eksport, med
reimport etter justering. Skillet må da også understøtte at dette er justeringer og ikke en full
omskriving.»

## Dagens situasjon, og hvorfor det ikke holder

- Eksportfila (`a2-content-export/v1`, `scope: course`) bærer innholdet, men **ingen identiteter**:
  ikke kursets id, ikke seksjonenes, ikke modulenes. En fil kan derfor ikke si «jeg er en ny
  utgave av det der».
- Kursimport lager alltid et **nytt kurs**. API-ets `replaceExisting` på kursnivå beholder kursets
  id, men lager nye seksjoner og moduler under, så all framdrift (lest/bestått er knyttet til
  seksjons- og modul-id) nullstilles, og de gamle elementene blir liggende i biblioteket.
- På elementnivå finnes det riktige alt: seksjonsimport med `replaceExisting` legger en **ny,
  upublisert versjon** på en eksisterende seksjon; modulimport med `replaceExisting` legger en ny
  versjon på en eksisterende modul. Men det er ett steg per element, i hver sin flate.
- Skillet er laget for å lage et kurs **fra en kilde**, og er instruert til aldri å skrive over
  (`replaceExisting` er forbudt). Det har ingen arbeidsflyt for «her er kurset; endre dette».

## Målbilde

```
Innholdsforvaltning ──«Eksporter for justering»──▶ kurs.json (med identiteter)
                                                        │
                                              Skillet: justér (ny arbeidsflyt)
                                                        │  endringsliste + importfil (samme identiteter)
Innholdsforvaltning ◀──«Oppdater dette kurset»─────────┘
   hvert element: ny versjon · nye elementer: opprettes · fjernede: tas ut av kurset
   kursets id, klasser, diskusjoner og framdrift beholdes
```

## Del 1 — Eksport med identiteter (plattform)

Eksportfila får en valgfri blokk `origin` på kurset og på hvert element:

```json
{ "course": { "course": { "origin": { "courseId": "…", "exportedAt": "…", "platformVersion": "2.88.0" }, "items": [
  { "type": "SECTION", "sortOrder": 0, "origin": { "sectionId": "…", "versionNo": 3 }, "section": { … } },
  { "type": "MODULE",  "sortOrder": 1, "origin": { "moduleId": "…",  "versionNo": 2 }, "module":  { … } }
] } } }
```

- Samme eksport som i dag, pluss `origin`. Knappen i Innholdsforvaltning heter «Eksporter»
  som før; «for justering» er ikke et eget format, bare det at fila nå kan komme tilbake.
- `origin` er valgfri i skjemaet, så eldre filer og filer fra skillets «lag kurs»-flyt leses som før.
- Import til **et annet miljø** (stage → prod) ignorerer `origin` når kurset ikke finnes der, og
  lager et nytt kurs som i dag. Ingen kopiering av id-er på tvers av miljøer.

## Del 2 — Skillet justerer (skill)

Ny arbeidsflyt `workflows/adjust-course.md`, med samme porter som de to andre, men kortere:

1. **Kilde = eksportfila.** Skillet leser den som **godkjent grunnlag**: hver seksjon, modul og
   figur går inn i `course-state.json` som «godkjent» før noe er gjort. Det er samme mekanisme som
   holder innhold på plass i dag (`content-preservation.md`, `course-state.mjs review`).
2. **Port: hva skal endres.** Forfatteren sier hva som skal justeres (en seksjon, en test, en
   figur; eventuelt med en ny kilde, som en oppdatert presentasjon). Skillet foreslår en
   endringsliste — element for element: endres / uendret / nytt / fjernes — og venter.
3. **Justér, ett element om gangen,** som i port 4 i dag. Alt som ikke står i endringslista,
   skal være **ordrett** som i fila. `course-state.mjs review` faller når noe godkjent er borte uten
   at forfatteren ba om det; en ny kontroll faller når et element merket «uendret» likevel er endret.
4. **Produser** med `produce-course.mjs` som i dag; importfila beholder `origin` på alt som
   fantes, og mangler det på det som er nytt. Leveransen er fila **og** endringslista.

Reglene som gjelder nytt innhold (ikoner, kortramme, kilden bak teksten, spørsmål per seksjon)
gjelder bare det som endres; skillet skal ikke «rydde» i det som ikke er bestilt. Oversettelsene:
bare endrede elementer oversettes på nytt; uendrede beholder sine tre språk fra fila.

## Del 3 — Reimport som oppdatering (plattform)

Importdialogen for kurs leser fila før noe skjer. Finnes `origin.courseId` i dette miljøet, viser
dialogen **«Oppdater dette kurset»** ved siden av «Importer som nytt kurs», med en oversikt:

| Element | Hva skjer |
|---|---|
| seksjon/modul med `origin` som finnes i kurset | **ny versjon** på det eksisterende elementet (seksjon: som dagens seksjonsimport; modul: som dagens modulimport) |
| element uten `origin` | **opprettes** og legges inn i rekkefølgen |
| element i kurset som ikke er i fila | **tas ut av kurset** (ikke slettet; blir liggende i biblioteket, arkiveres manuelt) |
| element med `origin` som ikke finnes | avvist med melding — fila hører ikke til dette kurset |
| kursets tittel, beskrivelse, nivå, plassering | oppdateres |

Alt i én transaksjon, med revisjonsspor per element (samme hendelser som i dag). Kursets id,
klassetildeling, påmeldinger, diskusjoner og deltakernes framdrift er urørt. Oversettelsesporten
virker som i dag: et element som mangler et språk, holdes tilbake, og kurset avpubliseres (#996).

Teknisk er dette en orkestrering av de to importveiene som alt finnes (`replaceExisting` for
seksjon og modul) pluss `setCourseItems`; det nye er gjenkjenningen av fila og dialogen.

## Valg som er produkteiers — avgjort 2026-10-12

**Produkteiers svar:** (1) legg dem klar — det skal en bevisst handling til for å publisere en ny
versjon på plattformen; (2) framdrift håndteres som ved en manuell justering i plattformen i dag,
det vil si «lest» beholdes (en ny versjon nullstiller ikke lesestatus); (3) enig; (4) enig.
Dermed: importen legger nye, upubliserte versjoner og publiserer ingenting; dialogen har ikke
valget «publiser nå». Nye elementer opprettes som utkast og legges i rekkefølgen; deltakeren ser
dem først når de publiseres (tilgjengelighetsregelen i `sectionAvailability.ts`).

1. **Publisere de nye versjonene med en gang, eller legge dem klar til gjennomsyn?**
   Anbefaling: dialogen har et valg, standard **publiser nå** når fila kommer fra skillet med
   grønne kontroller og endringslista er vist — det er «strømlinjeformet». Velger forfatteren
   «legg klar», får hver seksjon og modul en upublisert versjon som publiseres i sin egen flate.
2. **Framdrift på en justert seksjon.** En deltaker som har lest den, står som «lest» selv om
   teksten er ny. Anbefaling: **behold** — dette er justeringer. Trengs «må leses på nytt» en gang,
   er det et eget valg per element senere, ikke nå.
3. **Fjernede elementer.** Tas ut av kurset, men slettes ikke. Anbefaling: **ja**, slik tabellen
   sier; kursbevis og historikk kan peke på dem.
4. **Skal skillet få lov til å foreslå endringer utover bestillingen** («jeg ser også at …»)?
   Anbefaling: det kan **nevne** dem i endringslista som forslag, men ikke gjøre dem uten et ja.

## Omfang og rekkefølge

- **Fase A (plattform, liten):** `origin` i eksporten; import med `mode: "updateExisting"` som
  orkestrerer elementimportene; dialogen med oversikt og valget publiser nå / legg klar.
  Integrasjonstest: eksporter → endre to elementer i fila → oppdater → framdrift og klasser
  urørt, to nye versjoner, ett element tatt ut. E2e: dialogen.
- **Fase B (skill, middels):** `workflows/adjust-course.md`; `course-state` lastes fra eksportfila;
  kontrollen «uendret er uendret»; endringslista i leveransen; oversettelse bare av det endrede;
  forsiden får en tredje rad i «which workflow». Eval: Tilbudsarbeid eksportert fra prod →
  «skriv prompt-skjermbildene om til prompt-bokser» → importfil der alt annet er ordrett.
- **Fase C (senere):** forskjellsvisning i dialogen (før/etter per element).

Versjon: A og B kan gå hver for seg; A først, så B kan måles mot et ekte miljø.
