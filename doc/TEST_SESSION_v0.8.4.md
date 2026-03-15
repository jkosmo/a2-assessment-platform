# Testøkt — v0.8.4

**Versjon testet:** 0.8.4
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

Følgende ble verifisert OK i v0.8.1 og er ikke endret siden:
- W6 Tastaturisolasjon for låste seksjoner
- W7 Tilgjengelighet (skip-nav Edge, kontrastfarger, kortvisning)
- W8 Regresjon (kryssmodul-isolasjon, siste utkast lastes ved "Hent innhold")
- W4 Manuell gjennomgangsarbeidsflyt (kjernefunksjon)
- W5 Ankearbeidsflyt (kjernefunksjon)

---

## W1 — Meldingsstatus i innholdsforvaltning (v0.8.4)

**Forutsetning:** Logget inn som ADMINISTRATOR. admin-content.html er åpen. Et modul er valgt.
**Dekker:** v0.8.4 fargede meldinger — feil=rød, lagret=grønn, publisert=grønn

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Steg 3: velg et modul. Klikk «Hent innhold» | Meldingsfeltet viser nøytral tekst (f.eks. «Innhold lastet») — ikke grønt, ikke rødt | | |
| 2 | Tøm et obligatorisk felt (f.eks. Rubric-kriteria). Klikk «Lagre ny utkastversjon (Steg 5-8)» | Meldingsfeltet viser **rød** feilmelding | | |
| 3 | Fyll inn feltene igjen. Klikk «Lagre ny utkastversjon (Steg 5-8)» | Meldingsfeltet viser **grønn** melding «Lagret bundle» | | |
| 4 | Klikk «Publiser modulversjon» | Meldingsfeltet viser **grønn** melding om vellykket publisering | | |

**W1-konklusjon:** _______________

---

## W2 — Tilpasset innleveringsskjema og lagringsbekreftelse (TC-PART-03b / v0.8.4)

**Forutsetning:** Et modul er tilgjengelig. admin-content.html er åpen som ADMINISTRATOR.
**Dekker:** TC-PART-03b (tilpasset skjema), v0.8.4 grønn lagringsbekreftelse som diagnostisk bekreftelse

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Steg 3: velg modulen. Klikk «Hent innhold» | Skjema fylt ut | | |
| 2 | I steg 8 (Innleveringsskjema textarea), lim inn: `{"fields":[{"id":"answer","label":{"en-GB":"Your answer","nb":"Ditt svar","nn":"Ditt svar"},"type":"textarea","required":true},{"id":"reflection","label":{"en-GB":"Reflection","nb":"Refleksjon","nn":"Refleksjon"},"type":"textarea","required":false}]}` | Teksten limes inn uten feil | | |
| 3 | Klikk «Lagre ny utkastversjon (Steg 5-8)» | Meldingsfeltet viser **grønn** tekst «Lagret bundle» — **stopp og undersøk hvis rødt** | | |
| 4 | Bekreft at «Sist lagrede utkast» i statuspanelet viser en ny versjonskjede (f.eks. Module v2, Rubric v2…) | Ny versjonskjede synlig | | |
| 5 | Klikk «Publiser modulversjon» | Meldingsfeltet viser **grønn** publiseringsmelding. «Live nå» oppdateres til den nye versjonskjeden | | |
| 6 | Åpne **participant.html direkte** (ikke via Forhåndsvis-knappen). Sett lokalitet til **nb** | — | | |
| 7 | Velg modulen | Innleveringsskjema viser **2 felt** — «Ditt svar» (obligatorisk) og «Refleksjon» (valgfritt). Ikke standard 3 felt | | |
| 8 | Forsøk å sende med «Ditt svar» tomt | Innsending blokkert, valideringsmelding vist | | |
| 9 | La «Refleksjon» stå tom, fyll inn «Ditt svar» | Innsending opprettes uten feil | | |
| 10 | Bytt lokalitet til **en-GB** uten å laste siden på nytt | Feltetiketter oppdateres til «Your answer» og «Reflection» umiddelbart | | |

**W2-konklusjon:** _______________

---

## W3 — Norske feltetiketter (standard felt) (TC-PART-07)

**Forutsetning:** Et modul uten tilpasset `submissionSchemaJson` er publisert. participant.html er åpen.
**Dekker:** TC-PART-07 — standard innleveringsfelt vises i deltakers lokalitet

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Åpne participant.html. Sett lokalitet til **en-GB** | — | | |
| 2 | Velg modulen | Feltetiketter vises på engelsk: «Your answer», «Reflection (what you changed and why)», «Instruction used (paste prompt or task text)» | | |
| 3 | Bytt lokalitet til **nb** | Feltetiketter oppdateres umiddelbart til «Ditt svar», «Refleksjon (hva du endret og hvorfor)», «Instruksjon brukt (lim inn prompt eller oppgavetekst)» | | |
| 4 | Skriv inn tekst i «Ditt svar». Bytt til **nn** | Teksten i feltet **beholdes** — ikke slettet. Etikett vises på nynorsk | | |
| 5 | Bytt tilbake til **nb** | Teksten beholdes, etiketter på bokmål | | |

**W3-konklusjon:** _______________

---

## W4 — Administratorversjonskjede (TC-ADMIN-09)

**Forutsetning:** Et modul med publisert versjon og minst 2 lagrede versjoner av rubrikk/prompt/MCQ finnes. admin-content.html åpen.
**Dekker:** TC-ADMIN-09 — «Lagrede versjoner» bruker samme badgekjede-format som «Live nå»

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Velg modulen i steg 3 | Statuspanelet viser «Live nå» og «Lagrede versjoner» | | |
| 2 | Inspiser «Live nå» | Vises som badgekjede, f.eks. «Module v1 › Rubric v1 › Prompt v1 › MCQ v1» | | |
| 3 | Inspiser «Lagrede versjoner» | Vises som **samme badgekjede-format** (ikke ren tekst), f.eks. «Module v2 › Rubric v3 › Prompt v3 › MCQ v3» | | |
| 4 | Sammenlign visuell stil mellom «Live nå» og «Lagrede versjoner» | Begge bruker identiske badges og separatorer | | |

**W4-konklusjon:** _______________

---

## W5 — Pre-formatering i gjennomgang og ankehåndtering (TC-ADMIN-10)

**Forutsetning:** En innlevering finnes under manuell gjennomgang, og en anke finnes i ankekøen.
**Dekker:** TC-ADMIN-10 — strukturert innhold i `<pre>` vises med lys bakgrunn og leselig kontrast

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Åpne manual-review.html. Velg en gjennomgang fra køen | Detaljpanelet vises | | |
| 2 | Inspiser innholdsvisningen under «Valgt gjennomgang» | **Lys bakgrunn** (ikke stor svart boks). Tekst leselig med mørk farge. Maks høyde med rulling hvis innholdet er langt | | |
| 3 | Åpne appeal-handler.html. Velg en anke fra køen | Detaljpanelet vises | | |
| 4 | Inspiser innholdsvisningen under «Valgt anke» | Samme — lys bakgrunn, leselig kontrast, rulling ved langt innhold | | |

**W5-konklusjon:** _______________

---

## W6 — Anke fra fullførte moduler (TC-PART-09)

**Forutsetning:** En deltaker har minst én fullført modul med resultat «Ikke bestått» (passFailTotal=false, status=COMPLETED). participant-completed.html åpen.
**Dekker:** TC-PART-09 — ankeknapp synlig og funksjonell for kvalifiserte tidligere resultater

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Åpne participant-completed.html. Klikk «Last fullførte moduler» | Tabellen lastes med 6 kolonner: Modul, Fullført, Status, Total poengsum, Bestått/ikke bestått, Anke | | |
| 2 | For rad med «Ikke bestått» — inspiser ankekolonnen | Viser knappen «Anke resultat» | | |
| 3 | For rad med «Bestått» — inspiser ankekolonnen | Tom celle — ingen ankeknapp | | |
| 4 | Klikk «Anke resultat» for en mislykket rad | Ankeskjema vises under tabellen med modulnavn, begrunnelsestekstfelt, «Send inn anke»- og «Avbryt»-knapper | | |
| 5 | Klikk «Avbryt» | Ankeskjemaet skjules | | |
| 6 | Klikk «Anke resultat» igjen. Fyll inn begrunnelse og klikk «Send inn anke» | Grønn bekreftelsesmelding vises. «Send inn anke»-knappen deaktiveres | | |
| 7 | Bytt lokalitet til **en-GB** — sjekk knappetekster og skjemafelt | Oppdateres til engelsk: «Appeal result», «Reason for appeal», «Submit appeal», «Cancel» | | |

**W6-konklusjon:** _______________

---

## W7 — Norske kriterienavn i resultat (TC-PART-05b)

**Forutsetning:** En innlevering er ferdig vurdert. Modulens rubrikk bruker kriterienøkler som «Technical Accuracy», «Conceptual Understanding», «Application», «Clarity» (eller tilsvarende camelCase/snake_case varianter).
**Dekker:** TC-PART-05b — kriterienavn vises oversatt i deltakers lokalitet

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Åpne participant.html i **nb** lokalitet | — | | |
| 2 | Velg modulen. Vent til vurdering er fullført. Vis resultat | Kriterienavn under «Kriteriegrunngjevingar»-seksjonen vises på **norsk**: «Teknisk nøyaktighet», «Konseptuell forståelse», «Anvendelse», «Klarhet» (ikke engelske nøkler) | | |
| 3 | Bytt lokalitet til **en-GB** | Kriterienavn bytter til engelsk: «Technical accuracy», «Conceptual understanding» osv. | | |

**W7-konklusjon:** _______________

---

## W8 — Sjekk framdrift etter tidsavbrudd (TC-PART-08)

**Merk:** Dette steget krever at en LLM-vurdering faktisk går ut på tid. Utfør kun hvis dette skjer under normal testing.

**Dekker:** TC-PART-08 — «Sjekk framdrift»-knappen aktiv etter tidsavbrudd

| # | Steg | Forventet | Resultat | Notater |
|---|------|-----------|:--------:|---------|
| 1 | Send inn en vurdering. Vent til framdriftsmeldingen viser «tidsavbrudd» | Tidsavbruddsmelding vises | | |
| 2 | Inspiser «Sjekk framdrift»-knappen umiddelbart etter | Knappen er **aktiv** (ikke deaktivert) | | |
| 3 | Klikk «Sjekk framdrift» | Ny statussjekk kjøres | | |

**W8-konklusjon:** — (kun hvis tidsavbrudd oppstår)

---

## Øktkonklusjon

| Arbeidsflyt | Konklusjon | Blokkerende? |
|-------------|------------|:------------:|
| W1 — Meldingsstatus (v0.8.4) | | |
| W2 — Tilpasset innleveringsskjema (TC-PART-03b) | | |
| W3 — Norske feltetiketter standard (TC-PART-07) | | |
| W4 — Versjonskjede-format (TC-ADMIN-09) | | |
| W5 — Pre-formatering gjennomgang/anke (TC-ADMIN-10) | | |
| W6 — Anke fra fullført historikk (TC-PART-09) | | |
| W7 — Norske kriterienavn (TC-PART-05b) | | |
| W8 — Sjekk framdrift etter tidsavbrudd (TC-PART-08) | | |

**Samlet:** _______________

**Nye feil funnet:**

| # | Beskrivelse | Alvorlighet | Fil / område |
|---|-------------|-------------|-------------|
| 1 | | | |
| 2 | | | |
