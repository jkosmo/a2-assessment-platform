# Diskusjon / Q&A — brukerguide (#495)

Hvordan deltakere og innholdsprodusenter (SMO/admin) bruker diskusjonsfunksjonen.
Teknisk referanse: `doc/API_REFERENCE.md` (seksjonen «Discussions / Q&A»). Design: `doc/DISCUSSIONS_DESIGN.md`.

## For deltakere

Diskusjon finnes to steder i kursspilleren:

- **Kurs-nivå:** Et «Diskusjon»-panel nederst når du åpner et kurs. Bruk det for spørsmål som
  gjelder hele kurset.
- **Per seksjon:** Når du åpner en lærings­seksjon, ligger et diskusjons­panel nederst i leseren
  for spørsmål knyttet til akkurat den seksjonen.

### Stille spørsmål eller starte en diskusjon
1. Klikk **«Spør / diskuter»**.
2. Velg type: **Spørsmål** (kan markeres som løst med ett akseptert svar) eller **Diskusjon**.
3. Skriv tittel og melding, og **Publiser**. Du blir automatisk abonnent på tråden.

Meldinger støtter enkel formatering (fet, kursiv, lister, lenker, kode). Du skriver på ditt eget
språk — innleggene oversettes ikke.

### Svare og følge
- Åpne en tråd og skriv i svar­feltet. Når du svarer, blir du abonnent og varsles ved nye svar.
- **Abonner / Avslutt abonnement** styrer om du får varsel for tråden.

### Spørsmål og «marker som svar»
- Et spørsmål viser **Åpen** eller **Løst**.
- Stilte du spørsmålet (eller er du SMO/admin), kan du **markere som svar** på det svaret som løste
  det. Tråden settes da til **Løst**.

### Redigere og slette egne innlegg
Du kan redigere og slette dine egne innlegg. Slettede innlegg vises som «Slettet innlegg» (selve
raden beholdes for trådens sammenheng).

## For innholdsprodusenter (SMO / admin)

### Skru diskusjon av/på
I **kurs-editoren**:
- **Hele kurset:** avkrysningsboksen «Diskusjon på dette kurset». Skrus den av, er all diskusjon
  (kurs-nivå og alle elementer) skjult for kurset.
- **Per element:** i sekvens­listen har hver modul/seksjon en **«Diskusjon»**-avkrysning. Skru den
  av for å hindre diskusjon på akkurat det elementet (kurs-nivå­boardet påvirkes ikke).

Diskusjon er **på som standard** for nye kurs og elementer. Lagres sammen med kurset/sekvensen.

### Moderering
Som SMO/admin ser du modererings­knapper inne i hver tråd:
- **Fest / Løsne** — festede tråder vises øverst.
- **Lås / Lås opp** — en låst tråd kan ikke få nye svar.
- **Slett** — soft-delete av hvilket som helst innlegg (raden beholdes, vises som «Slettet
  innlegg»).
- **Marker som svar** — du kan akseptere svar på spørsmål.

### Varsler
- Nytt **spørsmål** varsler kursets SMO-er.
- Nytt **svar** varsler trådens abonnenter (de som har postet i tråden).

Varsling er bevisst minimal i denne versjonen; finkornet preferanse-/sammendrags­styring kommer
senere (#497). E-poster inneholder ingen lenker — du blir bedt om å logge inn selv.

## Personvern og sikkerhet
- Brukergenerert innhold rendres med en streng sanitering (ingen `iframe`/rå-HTML/bilder) — strengere
  enn lærings­seksjoner.
- Anonymiserte brukere vises som «Slettet bruker».
- Skriving krever tilgang til det publiserte kurset; moderering krever SMO/admin.
