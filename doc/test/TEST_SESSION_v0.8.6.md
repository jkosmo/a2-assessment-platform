# Testøkt — v0.8.6

**Versjon testet:** 0.8.6
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
- Fullstendig deltakerflytt (modul → innlevering → MCQ → vurdering → resultat)
- Manuell gjennomgang: krev + overstyr
- Ankebehandler: krev + løs
- Innholdsforvaltning: opprett modul, lagre utkast, publiser
- Kalibrering: last øyeblikksbilde, filtrer
- Flerspråklig innhold (en-GB / nb / nn)
- Anke fra fullførte moduler
- Toastmeldinger på tvers av alle skjermbilder

---

## W1 — Scroll til ugyldig felt ved innleveringsvalidering

**Område:** `/participant` — Innleveringsseksjon
**Endring:** F2-fix — ved klikk på «Opprett innlevering» med utilstrekkelig tekst skal siden scrolle til det ugyldige feltet.

| Steg | Handling | Forventet | Resultat |
|------|----------|-----------|---------|
| 1 | Last moduler, velg en modul | Innleveringsskjema vises | |
| 2 | La obligatoriske felt stå tomme og klikk «Opprett innlevering» | Siden scroller til første ugyldige felt, feltet markeres med rød ramme | |
| 3 | Skriv 5 tegn i et obligatorisk felt og klikk knappen igjen | Scroll til feltet, hint vises under feltet («minst 10 tegn») | |
| 4 | Fyll inn nok tekst (≥10 tegn) | Feilhinten forsvinner umiddelbart | |

**Notater:** OK

---

## W2 — Tegnantall-hint på obligatoriske innleveringsfelt

**Område:** `/participant` — Innleveringsseksjon
**Endring:** Inline `div.small` med `aria-live="polite"` vises under obligatoriske tekstfelt.

| Steg | Handling | Forventet | Resultat |
|------|----------|-----------|---------|
| 1 | Velg en modul og se innleveringsskjemaet | Ingen hint vises på tomme felt | |
| 2 | Skriv 3 tegn i et obligatorisk felt | Hint vises: «Svaret ditt må inneholde minst 10 tegn» | |
| 3 | Fortsett til ≥10 tegn | Hinten forsvinner | |
| 4 | Sjekk at ikke-obligatoriske felt ikke viser hint | Ingen hint under valgfrie felt | |

**Notater:** OK

---

## W3 — Scroll til modulstatuskort etter moduloppretting

**Område:** `/admin-content` — Steg 2 og 4
**Endring:** F7-fix — etter vellykket moduloppretting scroller siden automatisk til statuskortet i steg 4.

| Steg | Handling | Forventet | Resultat |
|------|----------|-----------|---------|
| 1 | Fyll inn modulnavn og klikk «Opprett modul» | Toastmelding vises, siden scroller til steg 4-statuskortet | |
| 2 | Sjekk at module-ID-feltet i steg 3 er utfylt | Feltet inneholder den nye modul-IDen | |
| 3 | Sjekk statuskortet i steg 4 | Viser den nye modulen som valgt (shell/ingen versjon) | |

**Notater:** Den scrollet til seksjon 3. Ellers OK

---

## W4 — Forfatterprompt-dialogboks

**Område:** `/admin-content` — Steg 1, «Kopier forfatterprompt»
**Endring:** #125 — knappen åpner nå en dialogboks i stedet for å kopiere direkte.

| Steg | Handling | Forventet | Resultat |
|------|----------|-----------|---------|
| 1 | Klikk «Kopier forfatterprompt» | Dialogboks åpnes med MCQ-antall (10), avkrysningsbokser (alle merket), custom-JSON-felt (tomt) | |
| 2 | Klikk «Avbryt» | Dialogboks lukkes, ingenting kopieres | |
| 3 | Åpne dialog igjen, endre MCQ-antall til 5 og klikk «Kopier» | Dialogboks lukkes, toastmelding «Forfatterprompt kopiert» | |
| 4 | Lim inn i tekstfelt/editor | Prompt inneholder nøyaktig 5 MCQ-spørsmål-stubs | |
| 5 | Åpne dialog igjen, avmerk «Refleksjon», klikk «Kopier» | Prompt inneholder «submissionSchemaJson» med kun response + promptExcerpt | |
| 6 | Åpne dialog, lim inn egendefinert felt-JSON og klikk «Kopier» | Prompt bruker egendefinert feltliste (overstyrer avkrysningsbokser) | |
| 7 | Test Escape-tast med åpen dialog | Dialogboks lukkes | |

**Notater:** 1) Avkrysningsbokser er ikke på linje med ledetekst. 2) Dialogboks er for liten til at custom-JSON-felt vises fult. 

---

## W5 — Ikke-fargebasert radindikator i køer

**Område:** `/manual-review` og `/appeal-handler` — køtabeller
**Endring:** #118 — valgte tabellrader har nå et blått innsatt venstre-skygge i tillegg til bakgrunnsfargen.

| Steg | Handling | Forventet | Resultat |
|------|----------|-----------|---------|
| 1 | Last gjennomgangskø og velg en rad | Raden har blå venstre-kantlinje (box-shadow) i tillegg til lys blå bakgrunn | |
| 2 | Gjør det samme i ankekøen | Samme indikator | |

**Notater:** OK

---

## W6 — Statusindikatorer med ikke-fargebasert prefix

**Område:** Alle sider med `.field-success` og `.field-warning`
**Endring:** #118 — `✓` foran suksess-meldinger, `⚠` foran advarselsmeldinger; `--color-warning` mørknet for WCAG AA kontrast.

| Steg | Handling | Forventet | Resultat |
|------|----------|-----------|---------|
| 1 | I deltakerflyten: fyll inn nok tekst og klikk «Opprett innlevering» (hvis valideringsstatus vises) | Suksessmelding har «✓ »-prefix | |
| 2 | Sjekk evt. advarselmeldinger (f.eks. felthint) | Har «⚠ »-prefix | |

**Notater:** Ser ikke ⚠ Ellers OK

---

## W7 — Låst-seksjon uten opacity

**Område:** `/participant` — vurderings- og ankeseksjon før de låses opp
**Endring:** #122 — seksjoner som er låst bruker nå grå bakgrunn i stedet for `opacity: 0.75`.

| Steg | Handling | Forventet | Resultat |
|------|----------|-----------|---------|
| 1 | Last `/participant` uten å velge modul | Vurderings- og ankeseksjonene er skjult/låst | |
| 2 | Velg modul og opprett innlevering | Vurderingsseksjon vises som låst (grå kortbakgrunn, tekst fullt lesbar) | |
| 3 | Fullfør MCQ | Vurderingsseksjon låses opp (hvit kortbakgrunn) | |

**Notater:** OK

---

## W8 — Tastaturnavigering i scrollbare tabeller

**Område:** `/manual-review`, `/appeal-handler`, `/calibration`, `/participant/completed`
**Endring:** #124 — table-wrap-containere har nå `tabindex="0"` og fokusring.

| Steg | Handling | Forventet | Resultat |
|------|----------|-----------|---------|
| 1 | Tab til en køtabell-container | Container får synlig fokusring (blå outline) | |
| 2 | Bruk piltaster mens container er fokusert | Tabellen scroller horisontalt/vertikalt | |

**Notater:** Trenger å vite hvilke skjermbilder og seksjoner jeg kan gjøre dette

---

## W9 — Autocomplete av på interne identitetsfelt

**Område:** Alle 6 skjermbilder — identitetspanel
**Endring:** #121 — `autocomplete="off"` på `userId` og `roles`-felter.

| Steg | Handling | Forventet | Resultat |
|------|----------|-----------|---------|
| 1 | Åpne identitetspanelet på `/participant` og klikk i userId-feltet | Nettleserens autofullføring vises ikke | |
| 2 | Samme for roles-feltet | Ingen autofullføring | |

**Notater:** OK

---

## Oppsummering

| Test | Resultat |
|------|---------|
| W1 — Scroll til ugyldig felt | |
| W2 — Inline tegnantall-hint | |
| W3 — Scroll til statuskortet etter opprettelse | |
| W4 — Forfatterprompt-dialog | |
| W5 — Ikke-fargebasert radindikator | |
| W6 — Statusindikatorer med prefix | |
| W7 — Låst-seksjon uten opacity | |
| W8 — Tastaturnavigering i tabeller | |
| W9 — Autocomplete av | |

**Godkjent for produksjon:** Ja / Nei
**Funn som krever oppfølging:** _______________
