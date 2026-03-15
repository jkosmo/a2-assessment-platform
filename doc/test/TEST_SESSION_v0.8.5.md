# Testøkt — v0.8.5

**Versjon testet:** 0.8.5
**Dato:** _______________
**Tester:** _______________
**Miljø:** _______________

---

## Slik bruker du dette dokumentet

| Symbol | Betydning |
|--------|-----------|
| ✅ | Bestått |
| ❌ | Feil — beskriv i Notater |
| ⚠️ | Delvis / uventet men ikke blokkerende |
| — | Hoppet over / ikke aktuelt |

---

## Hva er allerede bekreftet (utelatt fra denne økten)

Følgende ble verifisert OK i tidligere versjoner og er ikke endret siden:
- W1 Meldingsstatus i innholdsforvaltning (farget feil=rød, lagret=grønn, publisert=grønn)
- W3 Norske feltetiketter — standard innleveringsfelt
- W4 Administratorversjonskjede — badge-format i «Live nå» og «Lagrede versjoner»
- W5 Pre-formatering i gjennomgang/anke (lys bakgrunn, rulling)
- W6 Anke fra fullførte moduler — ankeknapp synlig og funksjonell
- W7 Norske kriterienavn i resultat
- Tastaturisolasjon for låste seksjoner
- Tilgjengelighet (skip-nav, kontrast, kortvisning)
- Regresjon (kryssmodul-isolasjon, siste utkast lastes ved «Hent innhold»)
- Manuell gjennomgangsarbeidsflyt
- Ankearbeidsflyt (kjerneflyt)

---

## W1 — Tilpasset innleveringsskjema med lokaliserte feltetiketter (TC-PART-03b)

**Forutsetning:** Logget inn som ADMINISTRATOR. admin-content.html åpen. Et modul er valgt.
**Dekker:** v0.8.5 fiks — `submissionSchemaJson` med lokaliserte etikettobjekter godtas av serveren

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Velg et modul i steg 3. Klikk «Hent innhold» | Skjema fylles ut uten feil | | |
| 2 | I steg 8 (Innleveringsskjema textarea), lim inn: `{"fields":[{"id":"answer","label":{"en-GB":"Your answer","nb":"Ditt svar","nn":"Ditt svar"},"type":"textarea","required":true},{"id":"reflection","label":{"en-GB":"Reflection","nb":"Refleksjon","nn":"Refleksjon"},"type":"textarea","required":false}]}` | Teksten limes inn uten feil | | |
| 3 | Klikk «Lagre ny utkastversjon (Steg 5-8)» | Meldingsfeltet viser **grønn** tekst «Lagret bundle» — ingen rød feilmelding | | |
| 4 | Bekreft at «Sist lagrede utkast» i statuspanelet viser ny versjonskjede | Ny versjonskjede synlig | | |
| 5 | Klikk «Publiser modulversjon» | Grønn publiseringsmelding. «Live nå» oppdateres | | |
| 6 | Åpne **participant.html direkte**. Sett lokalitet til **nb** | — | | |
| 7 | Velg modulen | Innleveringsskjema viser **2 felt** — «Ditt svar» (obligatorisk) og «Refleksjon» (valgfritt). Ikke standard 3 felt | | |
| 8 | Forsøk å sende med «Ditt svar» tomt | Innsending blokkert, valideringsmelding vist | | |
| 9 | La «Refleksjon» stå tom, fyll inn «Ditt svar» | Innsending opprettes uten feil | | |
| 10 | Bytt lokalitet til **en-GB** uten å laste siden på nytt | Feltetiketter oppdateres til «Your answer» og «Reflection» umiddelbart | | |

**W1-konklusjon:** _______________

---

## W2 — Ankekøen viser modulnavn som tekst (ikke JSON)

**Forutsetning:** Minst én åpen anke finnes i systemet. appeal-handler.html åpen som ADMINISTRATOR.
**Dekker:** v0.8.5 fiks — modulnavn i ankekøen løses fra lokalisert JSON-streng

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Åpne appeal-handler.html. Klikk «Last ankekø» / vent på autolast | Ankekøen lastes | | |
| 2 | Inspiser «Modul»-kolonnen i ankekøtabellen | Viser **leselig modulnavn** (f.eks. «Testmodul») — ikke rå JSON som `{"en-GB":"...","nb":"..."}` | | |
| 3 | Bytt lokalitet (f.eks. fra **en-GB** til **nb**) | Modulnavnet i køtabellen oppdateres til riktig språk | | |

**W2-konklusjon:** _______________

---

## W3 — Ankedetaljer viser innleveringsfelter og ankebegrunnelse

**Forutsetning:** En anke er valgt i ankekøen. appeal-handler.html åpen.
**Dekker:** v0.8.5 fiks — ankepanelet leser feltene fra `responseJson` og viser `appealReason`

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Klikk på en anke i køen | «Detaljer for valgt anke»-panelet vises | | |
| 2 | Inspiser seksjonen «Innlevering» | Feltene **Svar**, **Refleksjon** og **Instruksjon brukt** viser faktisk innleveringsinnhold — ikke «-» for alle | | |
| 3 | Inspiser toppen av panelet under «Anke» | **Ankebegrunnelse** viser teksten deltakeren la inn — ikke «-» | | |
| 4 | Inspiser «Modul»-linjen i panelet | Viser leselig modulnavn — ikke rå JSON | | |

**W3-konklusjon:** _______________

---

## W4 — Standardbegrunnelse ved anke fra fullførte moduler

**Forutsetning:** En deltaker har minst én fullført modul med «Ikke bestått». participant-completed.html åpen.
**Dekker:** v0.8.5 fiks — ankeskjemaet forhåndsfyller begrunnelse med standardtekst

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Åpne participant-completed.html. Klikk «Last fullførte moduler» | Tabellen lastes | | |
| 2 | Klikk «Anke resultat» for en rad med «Ikke bestått» | Ankeskjema vises under tabellen | | |
| 3 | Inspiser «Begrunnelse for anke»-feltet | Feltet er **forhåndsutfylt** med standardtekst (f.eks. «Ber om ny vurdering på grunn av mulig avvik i poengsetting.») — ikke tomt | | |
| 4 | Slett teksten, skriv en egendefinert begrunnelse og klikk «Send inn anke» | Anken sendes inn med egendefinert begrunnelse. Grønn bekreftelsesmelding | | |

**W4-konklusjon:** _______________

---

## Øktkonklusjon

| Arbeidsflyt | Konklusjon | Blokkerende? |
|-------------|------------|:------------:|
| W1 — Tilpasset innleveringsskjema med lokaliserte etiketter | | |
| W2 — Ankekø modulnavn som tekst | | |
| W3 — Ankedetaljer med innleveringsfelter og begrunnelse | | |
| W4 — Standardbegrunnelse ved anke fra fullførte moduler | | |

**Samlet:** _______________

**Nye feil funnet:**

| # | Beskrivelse | Alvorlighet | Fil / område |
|---|-------------|-------------|-------------|
| 1 | | | |
| 2 | | | |
