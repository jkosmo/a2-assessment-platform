# Testtilfeller for skillet `a2-authoring-api`

Tre presentasjoner, og for hver av dem en fasit på hva som bør bli av hvert lysark når skillet
lager et kurs av den. Et skript teller opp et ferdig kurs mot fasiten.

**Hvorfor:** Anthropics råd for skills er å lage minst tre testtilfeller *før* instruksjonene
skrives, og måle mot dem. Skillet hadde ingen. Da produkteier laget samme kurs i ChatGPT og i
Claude.ai 2026-10-05, fikk begge tre figurer av samme type, ingen ikoner og ingen av kortene fra
presentasjonen — og det fantes ikke noe tall å måle neste forsøk mot. Sak #1079.

Mappa ligger ved siden av skillet, ikke inni det: `npm run skill:package` pakker alt under
`skills/a2-authoring-api/`, og testtilfellene skal ikke med i pakka.

## De tre tilfellene

| Fil | Preg | Hva det prøver |
|---|---|---|
| `cases/rapportskriving.json` | Gjennomtegnet: flyt med faser, kort ved siden av hverandre, uthevede striper, tabeller, 25 ikoner | Blir grafikken tatt vare på — i flere former enn flyt — og blir ikonene brukt? |
| `cases/motearbeid.json` | Skjermbilder der innholdet er teksten i bildet (prompter), skjermbilder av Teams med røde ringer, og notater med hovedbudskap | Blir promptene tekst? Blir skjermbildene av grensesnittet med som bilder? Blir notatene brukt? |
| `cases/tilbudsarbeid.json` | To helsides infografikker som er rene bilder, en arbeidsflyt som matrise, skjermbilder med navn på personer | Blir infografikkene lest og bygget opp igjen? Blir matrisen en figur som ikke er en rett flyt? Stopper skillet ved personopplysninger? |

Presentasjonene ligger **utenfor repoet** (`C:\Dev\Assessment\` hos produkteier). De er interne,
de er på 17–20 MB, og to av dem har navn på personer i skjermbildene. De skal ikke sjekkes inn.
Testtilfellene beskriver lysarkene med nummer, form og noen få nøytrale ord; en enhetstest
(`test/unit/skill-evals-score-course-1079.test.ts`) holder adresser og dokumentnavn ute.

## Slik er et tilfelle bygget

Hvert lysark med faglig innhold har:

- `form` — hva lysarket er: `flyt`, `kort`, `tabell`, `liste`, `matrise`, `smartart`, `sitat`,
  `skjermbilde-prompt`, `skjermbilde-grensesnitt`, `infografikk-som-bilde`, `tidslinje`, `oppgave`.
- `forventet` — behandlingene som er riktige: `figur`, `innholdsblokk`, `tabell`, `bilde`,
  `prompt-som-tekst`, `tekst`, `læringsmål`, `oppgave`, `struktur`, `utelatt`. Den første er den
  beste.
- `nøkkelord` — noen få uttrykk som står som tekst på lysarket, og som bare det lysarket har.
- `bildetekst` — uttrykk som **bare** står inne i et bilde. De er lest av et menneske (eller en
  modell som så på bildet), og er det som viser om teksten i et skjermbilde kom med som tekst.
- `valgfri` — lysark som godt kan utelates (praktisk opplegg). De teller ikke i summene.
- `personopplysninger` — skjermbildet viser navn på personer. Skriptet kan ikke se om bildet er
  tatt med; det står under `manuellSjekk`.

`manuellSjekk` er det tallene ikke kan svare på. Det skal leses hver gang.

## Slik kjøres et tilfelle

1. **Ny samtale** i ChatGPT og i Claude.ai, med gjeldende skillpakke installert. Last opp
   presentasjonen (og oppsummeringen der den finnes), og skriv: *«Lag et kurs av denne
   presentasjonen.»* Ikke noe mer.
2. **Svar bare «godkjent» ved portene.** Det som måles, er hva skillet foreslår av seg selv. En
   forfatter som ber om flere figurer, får flere figurer — og da måles forfatteren.
3. **Hent kurset** som JSON. Importfila skillet leverer er nok, og det enkleste. Skriptet leser
   også en eksport fra plattformen etter import
   (`GET /api/admin/content/courses/<id>/export-package`) og pakka skillet arbeider i
   (`a2-authoring-package/v1`, men bare når teksten står i pakka og ikke i filer ved siden av).
4. **Tell:** `node skills/a2-authoring-api-evals/score-course.mjs skills/a2-authoring-api-evals/cases/<tilfelle>.json <kurs.json>`
5. **Les `manuellSjekk`** i tilfellet, og se på kurset.
6. **Før tallene inn** under «Målinger» nederst, med dato, skillversjon og hvor det ble kjørt.

## Hva tallene betyr

| Tall | Betyr | Betyr ikke |
|---|---|---|
| Lysark med innholdet i kurset | minst halvparten av lysarkets uttrykk står i kurset (tekst eller figur) | at det er godt forklart |
| Lysark som fikk forventet behandling | formen i kurset er en av dem fasiten godtar | at figuren er pen eller riktig |
| Figurformer | hvor mange ulike slags figurer kurset har | at flere alltid er bedre — men én form for ni ulike lysark er for lite |
| Figurer med tegning/ikon | figurer som har annet enn bokser, sirkler og streker | at ikonene er kildens egne |
| Tekst fra bilder gjengitt som tekst | uttrykk som bare sto i et bilde, og som nå er tekst | at hele prompten er med ordrett |
| For tunge bilder | rasterbilder over 300 kB | — |

«Venter på innholdsblokker» er lysark der fasiten sier `innholdsblokk`, og kurset har noe annet.
Plattformen har ikke innholdsblokker ennå (plan punkt 4 i #1079), så ingen kurs kan få det
riktig i dag. Når blokkene finnes, må `score-course.mjs` lære å kjenne dem igjen.

Tellingen er grov med vilje: den leter etter noen få uttrykk. Et kurs som skriver om alt med
andre ord, får for lavt tall; et kurs som nevner uttrykkene i en bisetning, får for høyt. Bruk
tallene til å se retning fra versjon til versjon, ikke som karakter på ett kurs.

## Målinger

### 2026-10-05 — skill 2.82.2 (nullpunktet)

Laget av produkteier, importert på stage, eksportert derfra. Kursene ble laget før oppskriften
over fantes, og det er ikke kjent hvordan portene ble besvart. Tallene er nullpunktet, ikke en ren
kjøring.

| Tilfelle | Hvor | Innhold med | Forventet behandling | Figurer | Former | Smalt oppsett | Tegning/ikon | Tabeller |
|---|---|---|---|---|---|---|---|---|
| Rapportskriving | Claude.ai | 9 av 9 | 4 av 9 (5 venter på innholdsblokker) | 3 | flyt | 3 | 0 av 25 ikoner | 4 |
| Rapportskriving | ChatGPT | 4 av 9 | 4 av 9 (4 venter på innholdsblokker) | 3 | flyt | 1 | 0 av 25 ikoner | 0 |
| Møtearbeid | – | ikke kjørt | | | | | | |
| Tilbudsarbeid | – | ikke kjørt | | | | | | |

Det tallene viser: Claude.ai tok med alt innholdet, men i tre former (flyt, tabell, tekst).
ChatGPT skrev kortere og mistet fem lysark. Ingen av dem brukte et ikon eller en annen figurform
enn flyt.

### 2026-10-05 — skill 2.83.0, grov prøve (IKKE milepæl 1)

To hjelpeagenter (Sonnet, i Claude Code) fikk det ombygde skillet og hver sin presentasjon, og
fulgte skillet ordrett med «godkjent» ved hver port. Det er en annen flate og en annen modell enn
ChatGPT og Claude.ai: tallene sier at skillet lar seg følge fra start til importfil, ikke hvordan
det går der produkteier bruker det. «Forventet behandling» teller fra og med denne målingen kort,
uthevede bokser og prompt-bokser i formen skillet skriver dem (rekke av `###`, sitat med fet
merkelapp, kodeblokk); nullpunktet over ville fått samme tall med den tellingen, for de kursene
hadde ingen slike.

| Tilfelle | Hvor | Innhold med | Forventet behandling | Figurer | Former | Smalt oppsett | Ikoner | Tabeller | Bilder | Tekst fra bilder |
|---|---|---|---|---|---|---|---|---|---|---|
| Rapportskriving | Claude Code, Sonnet | 9 av 9 | 8 av 9 | 2 | flyt | 2 | 21 (kilden har 25) | 3 | 0 | – |
| Møtearbeid | Claude Code, Sonnet | 12 av 13 | 12 av 13 | 1 | flyt | 1 | kilden har ingen | 0 | 5 (213 kB) | 14 av 14 |
| Tilbudsarbeid | – | ikke kjørt | | | | | | | | |

Det tallene ikke viser, lest ut av kursene:

- Lysarket som ikke fikk forventet behandling i begge kursene, er oppgaven. Den ble en fritekstmodul
  begge steder; måleskriptet har ingen måte å kjenne igjen en oppgave på.
- Rapportskriving: stripene med flere punkter ble til fire og fem bokser etter hverandre. Skillet
  sier nå at én stripe er én boks med liste.
- Møtearbeid: et skjermbilde med møte-ID og passord ble tatt med. Skillet foreslår nå å utelate
  slike.
- Begge kursene har bare flytfigurer. Presentasjonene har ingen matrise, tre eller tidslinje;
  Tilbudsarbeid har en matrise og er ikke kjørt.
