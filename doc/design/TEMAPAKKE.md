# Temapakke: båten som kan byttes ut

**Status:** plan, 2026-11-07. Ikke bygget. Bygges etter Profil (2.141.0).

**Avgjort av produkteier (2026-11-07):**
- **Én pakke per installasjon.** En organisasjon som vil ha sin egen metafor, kan forke kodebasen og legge til en
  pakke. Pakken må derfor være lett å lage: én mappe, én fil som beskriver den, og en sjekk som sier hva som mangler.
- **Figuren på fremdriftslinja i «Mine kurs» er med i pakken.**

**Bestilt av produkteier (2026-11-07):** «Det kan være ønskelig å bytte metaforer og bilder i ulike organisasjoner, og
det vil være enklere om alt er samlet.»

## Mål

Alt som hører til maskoten, altså bilder, linjer, bildetekster og figuren på fremdriftslinja, ligger i **én pakke**.
En installasjon velger pakke med én innstilling. Seilbåten blir den første pakken, og den gir nøyaktig det
brukerne ser i dag.

**Utenfor pakken:**
- **Regelen for humøret** (`src/modules/gamification/boatMood.ts`) er felles for alle pakker: denne uka, forrige uke,
  to uker, tre eller mer, aldri. En pakke gir bare ord og bilder til hvert humør.
- **Merkevaren** (logo, favicon, farger) hører til organisasjonen, ikke metaforen.
- **Tallene** (seksjoner, moduler, kurs) og hvem som ser dem.

## Hva ligger der i dag

| Flate | Hvor | Innhold |
|---|---|---|
| Profil, statistikk | `public/i18n/profile-translations.js`, `public/static/profile-stats.js` | 5 humør: linje på nb/nn/en-GB, bilde |
| E-post | `src/modules/certification/illustratedEmail.ts`, `src/assets/email/*.jpg` | 9 situasjoner: bilde, bildetekst på nb/nn/en-GB |
| «Mine kurs», fremdriftslinja | `public/static/course-progress-boat.js`, CSS i `participant.html` | figur som SVG i to tilstander (flatt og fullt seil), fartsstriper, feiring |
| Ukentlig e-post (#1139) | ikke bygget | skal bruke humørlinjene og bildene |

## Pakken

```
themes/seilbat/
  theme.json        navn, språk, humør, e-postsituasjoner, figur
  images/*.jpg      bildene (flyttes fra src/assets/email/)
  figure/*.svg      figuren på fremdriftslinja, én fil per tilstand
```

`theme.json` har tre deler:
- **`moods`**: for hvert av `mett`, `sulten`, `sur`, `dramatisk`, `ny` (senere `anker`): bilde og linje på nb, nn og en-GB.
- **`emailIllustrations`**: for hver av de ni situasjonene: bilde og bildetekst på tre språk.
- **`progressFigure`**: SVG for hver tilstand, og hvor langt fartsstripene rekker.

## Veier inn (alle lesere)

1. **Profil:** `GET /api/me/stats` gir humøret, linja **på brukerens språk** og bildeadressen. Klienten slutter å
   ha egne linjer og eget bildeoppslag.
2. **E-post:** `illustratedEmail.ts` henter bilde og bildetekst fra pakken, på mottakerens språk.
3. **«Mine kurs»:** figuren hentes fra pakken (`/static/theme/figure/...`), ikke fra kode.
4. **#1139:** den ukentlige e-posten leser `moods` som Profil.
5. **Bilder** serveres fra den aktive pakken under `/static/theme/`.

## Valg av pakke

- Innstillingen `GAMIFICATION_THEME` (standard `seilbat`), satt som GitHub-variabel per miljø og videre gjennom Bicep
  til **både app og worker**. En installasjon er én organisasjon (siloen, #275), så én pakke per installasjon er nok.
- **Pakken sjekkes ved oppstart:** alle humør og situasjoner, alle tre språk, alle filer finnes. Mangler noe,
  starter appen ikke. Det er bedre enn en e-post uten bilde eller en tom linje på Profil.

## Slik bygges det (to skiver)

1. **Flytt, uten synlig endring.** Seilbåten flyttes inn i pakken, og alle lesere går via den. Dette kontrolleres
   mot dagens utdata: hver e-posttype, Profil på tre språk og figuren på fremdriftslinja skal bli **identiske**
   før og etter. Testen lagres som fasit.
2. **Bytte.** Innstillingen, sjekken ved oppstart, og en liten testpakke (for eksempel «fjell») som viser at et bytte
   endrer alle flater og ingenting annet.

**Samtidighet:** ingen. Pakken leses ved oppstart og endres bare ved ny utrulling.
**Utrulling:** skive 1 kan gå ut alene. Skive 2 gjør ingenting før noen setter innstillingen.

## Åpent

- Skal en pakke kunne gi **egne navn** i teksten («båten», «fjellgeita»), eller bare linjer og bilder? Plan: bare
  linjer og bilder, til noen trenger mer.
