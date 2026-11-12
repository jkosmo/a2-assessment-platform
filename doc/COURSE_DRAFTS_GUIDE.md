# Utkast for kurs — veiledning for forfattere

Gjelder fra 2.157.0 (#1140). For deg som redigerer kurs i innholdsforvaltningen.

## Det viktigste

Når du lagrer et kurs som er publisert, lagrer du et **utkast**. Deltakerne ser ingenting av det før du trykker
**«Publiser utkastet»**. Slik virker moduler også.

Et kurs som ikke er publisert, lagres som før: det du lagrer, er kurset.

## Slik ser det ut

- Kurset står som **«Publisert»** med brikken **«Nyere utkast»**, i kurslista og øverst i kursbyggeren.
- Under merket står hvem som lagret utkastet og når, og hvilken versjon deltakerne ser.
- Skjemaet viser utkastet, ikke det deltakerne ser.

## To ting som er lette å overse

- **Innstillingene er også med i utkastet.** Synlighet, plassering i «Mine kurs», tema og diskusjon endres for deltakerne
  først når utkastet er publisert. Vil du for eksempel begrense synligheten raskt, lagrer du og trykker «Publiser utkastet».
- **«Eksporter» gir det publiserte kurset, ikke utkastet.** Skal du justere kurset i en fil, publiserer du utkastet først
  og eksporterer etterpå. Ellers bygger fila på den forrige utgaven.

## Knappene

| Knapp | Hva den gjør |
|---|---|
| **Lagre** | Lagrer det du har skrevet, til utkastet. Ingenting endres for deltakerne. |
| **Avbryt** | Tar bort det du har skrevet siden sist du lagret. Utkastet står. |
| **Publiser utkastet** | Sender utkastet ut til deltakerne. Har du ulagrede endringer, lagres de først. |
| **Forkast utkast** | Sletter hele utkastet, etter at du har bekreftet. Kurset deltakerne ser, endres ikke. |

Har du lagt til, tatt ut eller flyttet innhold, og noen har kursbevis, spør «Publiser utkastet» om det er en mindre versjon
eller en hovedversjon. Det er samme spørsmål som før, bare flyttet fra «Lagre» til publiseringen. Ellers publiseres utkastet
med en gang.

## Når noe stopper deg

- **«Noen andre har endret utkastet …»** To forfattere har hatt kurset åpent samtidig, og den andre lagret, publiserte eller
  forkastet først. Ingenting av ditt er lagret. Kopier det du skrev, last siden på nytt og gjør endringen igjen.
- **En rad i innholdslista er merket rødt.** Modulen eller seksjonen er arkivert eller slettet, eller den er ny i utkastet og
  ikke publisert. Publiser den, eller ta den ut av utkastet. Utkastet kan ikke publiseres før det er gjort.
- **«Kurset har et utkast …» når du laster opp en kursfil.** «Oppdater dette kurset» skriver rett i det publiserte kurset,
  og stoppes når kurset har et utkast. Publiser eller forkast utkastet først.
- **Kurset er avpublisert, og det ligger et utkast igjen.** Publiser kurset igjen for å fortsette på utkastet, eller forkast
  utkastet. Til da kan kurset ikke lagres.

## Nye versjoner av moduler og seksjoner

«Publiser nye versjoner» er fortsatt en egen knapp. Har kurset både et utkast og nye versjoner av innholdet, er det to
steg. De blir slått sammen til én publisering i en senere utgave.

## For administratorer og utviklere

API og regler: `doc/API_REFERENCE.md` (rutene `…/draft`), `doc/FEATURE_SURFACE_MAP.md` §32 og `doc/design/PLAN_1140_E2.md`.
