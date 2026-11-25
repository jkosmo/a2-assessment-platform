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

En bestått modul og en lest seksjon teller i alle kurs som har dem (#1156: seksjonen bare i kurs deltakeren ser). Fullfører én
lesing eller én bestått flere kurs, utstedes et kursbevis i hvert av dem. Kursbevisene i de andre kursene enn det deltakeren står
i, utstedes like etter, av workeren; mangler ett, kommer det når «Mine kurs» åpnes.

## Ny hovedversjon: når må deltakeren ta kurset på nytt? (#1192, 2.181.8)

Når et kurs får en ny hovedversjon, beholder den som fullførte en eldre versjon kursbeviset sitt. Den nye versjonen er
**frivillig** for dem til noen setter en ny frist.

**Slik krever du den nye versjonen:** åpne klassen under Deltakere → Klasser, sett en ny dato i «Frist» på kursraden og trykk
«Lagre frist». En frist satt etter at den nye versjonen ble publisert, gjør kurset uferdig igjen for dem i klassen som bare har
kursbevis for en eldre versjon. De får påminnelser, står som uferdige i Status og kursrapporten, og kurset kommer med i
mandagse-posten. En tom dato fjerner fristen.

- Uten ny frist står kurset som fullført. Kursrapporten viser da «Fullført (versjon 1)», så du ser at beviset gjelder en eldre
  versjon.
- Å endre fristen sender ingen e-post om nytt kurs. Påminnelsene går som vanlig.
- **Også en flyttet frist teller som ny.** Gir du klassen en uke ekstra etter at kurset har fått en ny hovedversjon, må de med
  kursbevis for en eldre versjon ta den nye.
- Frister som fantes før 2.181.8, regnes som satt før den nye versjonen. Vil du kreve den nye versjonen, setter du fristen på
  nytt.
- Kjent mangel: har deltakeren i tillegg en tidligere frist fra en annen klasse, eller kurset tildelt direkte, gjelder den, og den
  nye fristen virker ikke for den personen.

## Feiringen

- Når en **modul** bestås, vises en tydelig «bestått»-feiring (banner + konfetti), og «slett og
  prøv på nytt» nedtones (#549).
- Når **hele kurset** fullføres i samme økt, vises konfetti + en bekreftelse på at kurset er
  gjennomført, og bevis-banneret dukker opp i kursvisningen (#550).

## Se og skriv ut kursbeviset

Beviset nås fra kurskortet i «Mine kurs» (`/participant`) og fra fanen «Beståtte kurs» i Profil:

1. **I «Mine kurs»** på et fullført kurs — med lenken **«Vis kursbevis»**, også på telefon. Fullførte kurs står
   nederst i hvert tema. Har kurset fått en ny hovedversjon, heter lenken til det gamle beviset «Vis kursbevis for versjon 2».
2. **I Profil** (`/profile`), fanen «Beståtte kurs» — hvert bevis har lenken **«Vis kursbevis»**.
   Bevis-IDen står ikke lenger i tabellen (2.141.0); den står på selve beviset.

Lenken åpner en ren bevis-side (`/certificate?id=<bevis-ID>`) med kursnavn, deltakerens navn,
fullføringsdato, sertifiseringsnivå og bevis-ID. Klikk **«Skriv ut / lagre som PDF»** for å skrive
ut eller lagre beviset som PDF via nettleseren.

Beviset åpnes i samme fane (#1162). Nettleserens tilbake-knapp fører dit du kom fra: kurset (med det du hadde åpent),
«Mine kurs» eller profilen. Lenken øverst på beviset heter **«← Tilbake til Mine kurs»**, eller **«← Tilbake til profilen»**
når du åpnet beviset fra profilen.

> Et bevis er **personlig**: du kan bare åpne dine egne bevis. Forsøk på å åpne et annet bevis gir
> «fant ikke beviset».

## Diplom-bakgrunn (administrator) — #580

En **administrator** kan laste opp et **plattform-bredt bakgrunnsbilde** som vises bak alle kursbevis,
så de ser ut som ekte diplomer.

1. Gå til **Plattforminnstillinger** (`/admin-platform`) → seksjonen **«Kursbevis-bakgrunn»**.
2. Velg et bilde (PNG, JPEG, GIF eller WebP, maks 15 MB) og klikk **«Last opp bakgrunn»**.
3. En forhåndsvisning vises. **«Fjern»** tar bort bildet igjen. Endringer trer i kraft umiddelbart —
   ingen «Lagre» nødvendig.

Bildet legges bak teksten (skalert til å dekke beviset) og kommer med i **«Skriv ut / lagre som PDF»**.
Velg et bilde med rolig bakgrunn / god kontrast så bevis-teksten forblir lesbar. Det er **ett** felles
bilde for hele plattformen (per-kurs-maler kan komme senere).

## Merknader

- Beviset gjenspeiler kurset slik det var ved fullføring (modulene som inngikk fryses i beviset).
- Sertifiseringsnivået kommer fra kurset.
- Fremtid: signert/verifiserbart bevis og e-postvarsel ved kursfullføring (utenfor #550).
