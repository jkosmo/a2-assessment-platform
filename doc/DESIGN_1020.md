# Design #1020 — «Slik kommer du videre» for den som ikke bestod

Status: **forslag, venter på produkteier** (2026-09-18).

## Anbefaling

Ta den lille varianten nå, og la seksjonskoblingen ligge:

1. **Flervalg med gjennomgang på (#1061):** under utfallet står kortet «Slik kommer du videre»
   med én setning som peker på gjennomgangen: *«N av M spørsmål ble feil — gå gjennom dem under
   før du prøver igjen.»* Gjennomgangen finnes allerede; det nye er setningen og plassen.
2. **Flervalg uten gjennomgang:** *«Gå gjennom modulinnholdet før du prøver igjen. Du manglet X
   poeng.»* Ingen ny informasjon, men svaret på «hva nå» står der spørsmålet stilles.
3. **Fritekst:** løft `participantGuidance.improvementAdvice` (finnes, fra språkmodellen) til samme
   kort med samme overskrift, slik at «hva gjør jeg nå» ser likt ut uansett modultype.

Alle tre er visning av data som finnes. Ingen migrasjon, ingen ny generering.

## Hvorfor ikke seksjonskoblingen

Undersøkt (issue-ens første spørsmål): **`MCQQuestion` har ingen referanse til seksjon eller
læringsmål** (`prisma/schema.prisma:357`). Læringsmålene ligger på modulversjonens blueprint som
en liste av strenger, ikke på spørsmålet. Å utlede koblingen (tekstlikhet spørsmål ↔ seksjon)
ville treffe feil ofte nok til å sende deltakeren til feil sted — som issue-en selv advarer mot.

Å la forfatteren merke spørsmål med seksjon er riktig vei, men det er et forfatterverktøy-løft
(felt i Rediger, i skillets pakkeformat, i importen) og bør vente til banken i #1062 har fått
brukstid. Da vet vi om merking er verdt kostnaden.

## Åpne spørsmål til produkteier

- Fritekstrådene er engelske fra modellen og går gjennom `localizeImprovementAdviceItems`
  (gjettemønsteret fra #1019). Skal de bli oversettbare **før** de løftes fram (anbefalt: ja —
  ett kall til lokalisereren ved visning, bufret på innleveringen), eller er engelsk godt nok
  inntil videre?
- Skal kortet også vises ved **bestått** når gjennomgangen er på? (Anbefalt: nei — «kommer du
  videre» er for den som ikke kom videre. Gjennomgangen vises uansett, jf. #1061.)

## Omfang når det bestilles

`public/participant.js` (resultatkortet, ved siden av `renderMcqReview`), tre tekstnøkler ×
tre språk i `participant-translations.js`, e2e i `participant-mcq-only.spec.ts`. Én kveld.
