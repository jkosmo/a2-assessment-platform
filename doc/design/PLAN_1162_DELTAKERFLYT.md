# #1162 — Deltakeren: seksjon og modul åpnes ulikt, «tilbake» heter mange ting, kursbeviset har tre navn

Status: forslag, ikke bygget (21.11.2026). Fra konsistenssjekken #1157.

**Avgjort av produkteier 21.11.2026** (alle seks spørsmålene nederst; står også i `doc/DECISIONS.md`, «Deltakerflyten»): lang
form på tilbake («← Tilbake til kurset», «← Tilbake til Mine kurs»); kursbeviset åpnes i samme fane; «Gå videre» i en modul bare
når den er bestått; «Ta testen» i stedet for «Gjennomfør»; merket heter «Lesestoff» og «Test»; de tre tilbake-tekstene på
produsentsidene tas i #1170.

## Kort fortalt

- **Regelen:** den nyeste versjonen er fasiten. Seksjonsleseren («Steg 1 av 4», én tydelig knapp videre) er mønsteret, og
  ordet er «Kursbevis».
- **Forslaget i fem skiver**, hver kan rulles ut alene. Tre er bare tekst (1, 2, 4). Én endrer hvordan kursbeviset åpnes (3).
  Den siste (5) lar modulen åpnes som seksjonen, og den må vises som prototype før den bygges.
- **Produkteier må avgjøre seks ting** (siste avsnitt). Den viktigste: skal kursbeviset åpnes i samme fane, slik at
  nettleserens tilbakeknapp virker?
- **Funn utenfor saken:** tre av de sju «tilbake»-tekstene i saken står på produsentsidene, ikke hos deltakeren. De følger
  allerede mønsteret «← Tilbake til <stedet>». Forslaget tar dem ikke med.

## 1. Slik er det i dag

Fil:linje gjelder grenen `1173-sprak` (start 3c820d78, versjon 2.169.0). Tekstene er bokmål; nynorsk og engelsk har samme
nøkler.

### Hvordan seksjon og modul åpnes

| Hva | Seksjon | Modul | Hvor |
| --- | --- | --- | --- |
| Knappen i lista | «Les» | «Gjennomfør» | `participant.js:5057`, nøkler `courses.section.read` / `courses.module.go` (`participant-translations.js:1105`, `:1176`) |
| Ferdig steg | «Se igjen» (begge) | «Se igjen» | `participant.js:5067`, `courses.step.review` (`:1128`) |
| Plassering | Tar over hele kurskortet (lesemodus): resten av kurset og «← Alle kurs» skjules | Folder seg ut under raden, resten av kurset står | `participant.js:5306` setter `course-reading` bare for seksjoner; CSS `participant.html:454–463` |
| Merket i hodet | «LESER» | «ARBEIDSFLATE» | `participant.js:5474` / `:5402`, nøkler `courses.section.readerTag` / `courses.module.workspaceTag` (`:1108`, `:1119`) |
| Hvor i kurset | «Steg 2 av 4» i hodet | Ingenting (står bare i lista) | `participant.js:5466–5476` |
| Lukk | «Lukk seksjonen» | «Lukk modulen» | `participant.js:5481` / `:5404`, `courses.section.close` / `courses.module.close` (`:1106`, `:1120`) |
| Videre | Én hovedknapp: «Marker seksjon lest, og gå videre» eller «… og gå til testen»; siste steg «Avslutt kurset» | Sekundærknapp under arbeidsflaten: «Gå til neste element: {tittel} →», vises alltid, også før modulen er bestått | `participant.js:5427–5445` / `:5387–5396`, `:5410–5415` |

### «Marker seksjon lest» på en seksjon som allerede er lest

Knappen velges bare ut fra om det finnes et neste element (`participant.js:5427–5443`), ikke ut fra `entry.read`. En lest
seksjon som åpnes igjen med «Se igjen», viser derfor «Marker seksjon lest, og gå videre». Klikket sender lesingen på nytt
(`participant.js:5510–5526`), noe serveren tåler, men teksten sier noe som ikke skjer.

### Alle «tilbake»

| Tekst (nb) | Hvem ser den | Hvor den fører | Hvor |
| --- | --- | --- | --- |
| «← Alle kurs» | Deltaker, i et kurs | Lista i «Mine kurs» | `participant.html:581`, `participant.js:4478` → `unfocusCourse` (`:4336`); `courses.backToList` (`participant-translations.js:1087`) |
| «Lukk seksjonen» | Deltaker, i en seksjon | Kurset | se tabellen over |
| «Lukk modulen» | Deltaker, i en modul | Kurset | se tabellen over |
| «Tilbake til kurs» | Deltaker, på kursbeviset | `/participant` («Mine kurs»), i den nye fanen | `certificate.html:63`, `certificate.back` (`certificate-translations.js:41`) |
| «← Tilbake» | Deltaker, i en diskusjonstråd | Trådlista i samme panel | `static/discussion-panel.js:202`, `discussion.action.back` |
| «← Tilbake til profil» | Deltaker, «Mine data» i profilen | Profilen | `profile.html:312`, `dataview.back` |
| «← Tilbake til kurs» | **Produsent**, kursskjemaet | Kurslista | `courses.back` (`admin-content-translations.js:1805`) |
| «← Tilbake til kurset» | **Produsent**, seksjon åpnet fra et kurs | Kurset | `sections.backToCourse` (`:1884`) |
| «← Tilbake til moduler» | **Produsent**, modulens arbeidsflate | Modullista | `shell.header.back` (`:1429`) |

De tre siste er produsentsider. De sier allerede «← Tilbake til <stedet>», som er regelen forslaget bygger på.

### Kursbeviset

| Hvor | Tekst i dag | Hvor i koden |
| --- | --- | --- |
| Kursraden i «Mine kurs» (fullført kurs) | «Sertifikat · Vis bevis», liten lenke; under 600 px bare «Vis bevis» | `participant.js:4875`; `courses.certificate.short` + `courses.certificate.view` (`participant-translations.js:1185`, `:1181`); CSS `participant.html:203` |
| Eldre versjon av et kurs (#934) | «Kursbevis, versjon {n} · Vis bevis» | `participant.js:4887`; `courses.certificate.earlier` (`:1182`) |
| Profilen | Kolonne «Kursbevis», lenke «Vis kursbevis» | `profile.js:432–436`; `profile.courses.view` (`profile-translations.js:274`) |
| Selve beviset | Overskrift «Kursbevis» | `certificate-translations.js:30` |
| Ubrukt nøkkel | «Sertifikat utstedt» | `courses.certificate.earned` (`:1180`); ingen leser den |

Alle tre lenkene åpner beviset i en ny fane (`target="_blank"`, `participant.js:4875`, `:4887`, `profile.js:434`). Den nye
fanen har ingen historikk, så nettleserens tilbakeknapp gjør ingenting. Lenken på beviset fører til «Mine kurs» i den nye
fanen, og deltakeren har da appen åpen i to faner.

## 2. Forslaget

### Regel for «tilbake»

**«← Tilbake til <stedet du kommer til>»**, med stedets navn slik siden selv heter. Én tekst per sted, ikke per
element:

| Situasjon | Tekst | Erstatter |
| --- | --- | --- |
| I en åpen seksjon **eller** modul | «← Tilbake til kurset» | «Lukk seksjonen», «Lukk modulen» |
| I et kurs | «← Tilbake til Mine kurs» | «← Alle kurs» |
| På kursbeviset, kom fra et kurs | «← Tilbake til Mine kurs» | «Tilbake til kurs» |
| På kursbeviset, kom fra profilen | «← Tilbake til profilen» | «Tilbake til kurs» |
| I en diskusjonstråd | «← Tilbake til innleggene» | «← Tilbake» |
| «Mine data» i profilen | uendret («← Tilbake til profil») | — |

Knappen står der den står i dag. Bare teksten endres (skive 2), bortsett fra kursbeviset (skive 3).

### Kursbeviset heter «Kursbevis»

- Lenken heter **«Vis kursbevis»** overalt: kursraden (også på telefon, der «Sertifikat ·» i dag skjules), profilen og
  merknaden om eldre versjon («Vis kursbevis for versjon {n}»).
- Overskriften på beviset er fortsatt «Kursbevis».
- «Sertifikat» og den ubrukte «Sertifikat utstedt» fjernes fra tabellene.
- Engelsk: «View course certificate» / «Course certificate». Nynorsk: «Vis kursbevis».

### Kursbeviset åpnes i samme fane

`target="_blank"` fjernes på de tre lenkene. Nettleserens tilbakeknapp fører da tilbake til kurset eller profilen. Siden
#1158 står kurset (og et åpent element) i adressen, så kurset står som før når deltakeren kommer tilbake. Utskrift går
fortsatt gjennom knappen «Skriv ut / lagre som PDF» på beviset. Lenken på beviset fører dit deltakeren kom fra: lenken fra
profilen bærer `?fra=profil`, ellers «Mine kurs».

### Modulen åpnes som seksjonen

Modulen tar over kurskortet på samme måte som seksjonen (samme lesemodus, `course-reading`), og hodet er likt:

- Merket sier hva steget er, med ordene lista allerede bruker: **«Lesestoff»** og **«Test»** (i stedet for «Leser» og
  «Arbeidsflate»).
- **«Steg 3 av 4»** står i hodet også for modulen.
- **«← Tilbake til kurset»** står i hodet for begge.
- **Én hovedknapp videre** nederst. Seksjon: som i dag. Modul: «Gå videre» (eller «Avslutt kurset» på siste steg) når
  modulen er bestått. Før den er bestått står ingen knapp videre, bare «← Tilbake til kurset» i hodet (avgjørelse 3).
- I lista heter knappen for en modul **«Ta testen»** (i stedet for «Gjennomfør»), som passer med «Test — må bestås» i
  lista og «… og gå til testen» i seksjonen (avgjørelse 4).

Modulens innhold (oppgave, flervalg, innlevering, resultat) endres ikke. Det er rammen rundt som blir lik.

### «Marker seksjon lest» på en lest seksjon

En seksjon som allerede er lest, får **«Gå videre»** / **«Gå til testen»** / «Avslutt kurset». Det sendes ingen ny lesing.
Uleste seksjoner er som i dag.

## 3. Skiver

Hver skive kan rulles ut alene, i denne rekkefølgen. Ingen av dem rører serveren eller databasen.

| Skive | Hva | Prototype først? | Tester |
| --- | --- | --- | --- |
| 1. Kursbevis-ordet | Nøklene i `participant-translations.js` og `profile-translations.js` (tre språk); fjern `courses.certificate.short` og `.earned`; CSS-regelen i `participant.html:203` faller bort | Nei, bare tekst | e2e: lenketeksten på kursraden, eldre versjon og profilen på tre språk, også på 390 px |
| 2. «Tilbake»-tekstene | `courses.section.close`, `courses.module.close`, `courses.backToList`, `certificate.back`, `discussion.action.back` | Nei, men mål bredden: «← Tilbake til Mine kurs» og hodet med «← Tilbake til kurset» på 390 og 360 px | e2e på tre språk; skjermbilde på 360 px |
| 3. Kursbeviset i samme fane | Fjern `target="_blank"` (`participant.js:4875`, `:4887`, `profile.js:434`); `?fra=profil` og lenketeksten på beviset (`certificate.js`) | Nei, oppførsel; avgjørelse 2 først | e2e: åpne beviset, nettleserens tilbake står i kurset (med åpent element) og i profilen |
| 4. Lest seksjon | `renderSectionReaderInto` velger tekst ut fra `entry.read`; ingen ny `POST …/read` når den er lest | Nei | e2e: lest seksjon viser «Gå videre» og sender ikke lesingen; ulest som før (kontroll) |
| 5. Modulen som seksjonen | `openInlineItemByEntry` setter lesemodus for moduler; `buildModuleInlinePanel` får samme hode (merke, steg, tilbake) og hovedknapp; listeknappen «Ta testen» | **Ja.** Prototype (Artifact) av modul i lesemodus: før bestått, etter bestått, siste steg, på 1280 og 390 px | e2e: hodet og knappen for modul og seksjon side om side; arbeidsflaten overlever språkbytte (§ 6b i `FEATURE_SURFACE_MAP.md`); flaten etter innlevering (vurdering pågår) |

Skive 5 er den med risiko: modulens arbeidsflate er én felles DOM-node som flyttes inn i raden (`mountModuleWorkspaceInto`,
§ 6b i `doc/FEATURE_SURFACE_MAP.md`). Lesemodus skjuler resten av kortet med CSS, og arbeidsflaten må ikke havne i et skjult
undertre når kurset tegnes på nytt. Les § 6b og `participant-course-focus.spec.ts` før bygging.

## 4. Det produkteier må avgjøre

1. **Tekstene for tilbake.** «← Tilbake til kurset» og «← Tilbake til Mine kurs» (anbefalt, samme form som produsentsidene),
   eller korte «← Kurset» og «← Mine kurs» (plass på telefon)?
2. **Kursbeviset i samme fane?** Anbefalt ja: tilbakeknappen virker, og appen står ikke i to faner. Mot: noen er vant til
   at beviset står i egen fane for utskrift.
3. **Knappen videre i en modul som ikke er bestått.** I dag står «Gå til neste element» alltid. Forslaget fjerner den til
   modulen er bestått, som seksjonen (som krever lesing). Skal deltakeren kunne hoppe over en test og gå videre?
4. **«Gjennomfør» → «Ta testen»** i lista?
5. **Merket i hodet: «Lesestoff»/«Test»** i stedet for «Leser»/«Arbeidsflate»?
6. **Produsentsidene** (tre av de sju i saken): utenfor #1162, enig?
