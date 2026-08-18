# Diskusjon / Q&A — brukerguide (#495)

Hvordan deltakere og innholdsprodusenter (SMO/admin) bruker diskusjonsfunksjonen.
Teknisk referanse: `doc/API_REFERENCE.md` (seksjonen «Discussions / Q&A»). Design: `doc/DISCUSSIONS_DESIGN.md`.

## For deltakere

Diskusjon finnes **ett sted** i kursspilleren: et «Diskusjon»-panel nederst i kurset, sammenklappet
til du åpner det. Der hører alle spørsmål om kurset hjemme — også de som handler om én bestemt
seksjon.

> **Endret i 2.20.0 (#923).** Tidligere fantes egne diskusjons­tråder per seksjon (og per modul).
> Tre steder å skrive delte en samtale som uansett er liten, i tre halvdøde tråder. Nå er det ett
> sted, og det er ment å gjøre samtalen mer levende, ikke mindre. Tråder som allerede ble skrevet på
> seksjons- eller modulnivå er ikke slettet — de vises bare ikke lenger i deltakerflaten.

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
I **kurs-editoren**: avkrysningsboksen «Diskusjon på dette kurset». Skrus den av, er diskusjon
skjult for kurset. Diskusjon er **på som standard** for nye kurs, og lagres sammen med kurset.

Avkrysningen **per element** i sekvens­listen er borte fra og med 2.20.0 (#923): den styrte en flate
deltakeren ikke lenger har. Verdien som allerede var lagret per element ligger urørt i databasen og
skrives tilbake uendret når du lagrer sekvensen.

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
