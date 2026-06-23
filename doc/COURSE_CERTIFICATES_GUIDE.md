# Kursbevis og kursfullføring — brukerguide

Hvordan en deltaker fullfører et kurs, feiringen som vises, og hvordan man ser og skriver ut
kursbeviset (#549/#550).

## Når blir et kurs fullført?

Et kurs er fullført når deltakeren har:

- **bestått alle moduler** i kurset, og
- **lest alle læringsseksjoner** i kurset.

Begge deler teller likt mot «X/Y fullført» i kursvisningen. Når det siste elementet er på plass
(siste modul bestått eller siste seksjon lest), utstedes et **kursbevis** automatisk med en unik
**bevis-ID**.

## Feiringen

- Når en **modul** bestås, vises en tydelig «bestått»-feiring (banner + konfetti), og «slett og
  prøv på nytt» nedtones (#549).
- Når **hele kurset** fullføres i samme økt, vises konfetti + en bekreftelse på at kurset er
  gjennomført, og bevis-banneret dukker opp i kursvisningen (#550).

## Se og skriv ut kursbeviset

Bevis-IDen vises to steder:

1. **I kursvisningen** (deltakerflaten) på et fullført kurs — sammen med en **«Vis bevis»**-lenke.
2. **Under «Mine kursbevis»** på Fullført-siden (`/participant/completed`) — hvert bevis har en
   **«Vis / skriv ut bevis»**-lenke.

Lenken åpner en ren bevis-side (`/certificate?id=<bevis-ID>`) med kursnavn, deltakerens navn,
fullføringsdato, sertifiseringsnivå og bevis-ID. Klikk **«Skriv ut / lagre som PDF»** for å skrive
ut eller lagre beviset som PDF via nettleseren.

> Et bevis er **personlig**: du kan bare åpne dine egne bevis. Forsøk på å åpne et annet bevis gir
> «fant ikke beviset».

## Diplom-bakgrunn (administrator) — #580

En **administrator** kan laste opp et **plattform-bredt bakgrunnsbilde** som vises bak alle kursbevis,
så de ser ut som ekte diplomer.

1. Gå til **Plattforminnstillinger** (`/admin-platform`) → seksjonen **«Kursbevis-bakgrunn»**.
2. Velg et bilde (PNG, JPEG, GIF eller WebP, maks 5 MB) og klikk **«Last opp bakgrunn»**.
3. En forhåndsvisning vises. **«Fjern»** tar bort bildet igjen. Endringer trer i kraft umiddelbart —
   ingen «Lagre» nødvendig.

Bildet legges bak teksten (skalert til å dekke beviset) og kommer med i **«Skriv ut / lagre som PDF»**.
Velg et bilde med rolig bakgrunn / god kontrast så bevis-teksten forblir lesbar. Det er **ett** felles
bilde for hele plattformen (per-kurs-maler kan komme senere).

## Merknader

- Beviset gjenspeiler kurset slik det var ved fullføring (modulene som inngikk fryses i beviset).
- Sertifiseringsnivået kommer fra kurset.
- Fremtid: signert/verifiserbart bevis og e-postvarsel ved kursfullføring (utenfor #550).
