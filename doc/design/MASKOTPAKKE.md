# Maskotpakke: båten som kan byttes ut

**Status:** bygget. Plan revidert 2026-11-07 etter en uavhengig gjennomlesing (Codex var over utgiftstaket). Steg 0 og
1 bygget 2026-11-08 (grenen `maskotpakke-skive-1`, i 2.142.0). Steg 2 bygget 2026-11-08 (grenen
`maskotpakke-skive-2`): sjekken (`npm run mascot:check`, i CI og ved oppstart), testpakken, forhåndsvisningen
(`npm run mascot:preview`) og README-malen (`mascots/seilbat/README.md`). Se «Bygget i skive 2» nederst.
Bygges etter Profil (2.141.0) og før den ukentlige e-posten (#1139), så den leser pakken fra første dag.

**Bestilt av produkteier (2026-11-07):** «Det kan være ønskelig å bytte metaforer og bilder i ulike organisasjoner, og
det vil være enklere om alt er samlet.»

**Avgjort av produkteier (2026-11-07):**
- **Én pakke per installasjon.** En organisasjon som vil ha sin egen metafor, forker kodebasen og legger til en pakke.
  Pakken må derfor være lett å lage: én mappe, én fil som beskriver den, en sjekk som sier hva som mangler, og et
  skript som viser resultatet.
- **Figuren på fremdriftslinja i «Mine kurs» er med i pakken.**

**Navnet:** «maskot» (`mascot`), ikke «tema». Tema betyr allerede kurstema i appen.

## Mål

Alt som hører til maskoten, altså bilder, tekster, bildetekster og figuren på fremdriftslinja, ligger i **én pakke**.
Seilbåten blir den første pakken og gir nøyaktig det brukerne ser i dag.

**Felles for alle pakker (ikke i pakken):**
- Regelen for humøret (`src/modules/gamification/boatMood.ts`): denne uka, forrige uke, to uker, tre eller mer, aldri.
- Grensen på 30 % for figurens to tilstander (`COURSE_BOAT_FULL_SAIL_PCT`).
- Tallene, og at bare brukeren selv ser statistikken.
- E-post bruker innebygde bilder (CID), aldri bildeadresser. En sendt e-post blir aldri berørt av et bytte.

## Hvor ting ligger nå (etter skive 1)

| Flate | Leser | Innhold i pakken (`mascots/seilbat/`) |
|---|---|---|
| Profil, statistikk | `public/static/profile-stats.js` henter `/static/mascot/moods.json` (laget av `mascotMoodsJson`) | 5 humør: linje på nb, nn og en-GB, bilde i `images/` |
| E-post, bildene | `src/modules/certification/illustratedEmail.ts` (`EMAIL_ILLUSTRATIONS`) | 9 situasjoner: bilde i `images/` (JPEG, 600 × 200, under 30 kB), bildetekst på tre språk |
| E-post, teksten | `src/i18n/notificationMessages.ts` (ny hovedversjon) via `mascotEmailText` | `emailTexts.courseNewVersionIntro`: «har vært en tur på verftet» |
| «Mine kurs», fremdriftslinja | `public/static/course-progress-boat.js` henter `/static/mascot/figure.js` og `/static/mascot/figure.css` | `figure/*.svg` i tre tilstander (flatt seil, fullt seil, feiring med konfetti), `figure.css`, målene i `figure` (31 px til hekken, stripenes rekkevidde), retning fra høyre, 4,2 s feiring |
| Favicon | `src/routes/mascot.ts` på de faste adressene `/static/favicon.*` | `favicon.svg` og tre PNG-er |
| Ukentlig e-post (#1139) | ikke bygget | skal bruke humørlinjene og bildene |

Før skive 1 lå bildene i `src/assets/email/*.jpg`, faviconet i `public/static/favicon.*`, linjene i
`public/i18n/profile-translations.js` og figuren i `course-progress-boat.js` og `participant.html`. De er flyttet.

Figuren er tegnet på A-2-logoen (seilet er A-en, 2-tallet sitter ved roret), så den er både merkevare og metafor.

## Pakken

```
mascots/seilbat/
  mascot.json       versjon, navn, humør, e-postsituasjoner, e-posttekster, figur
  images/*.jpg      bildene (flyttes fra src/assets/email/)
  figure/*.svg      figuren, én fil per tilstand (flatt, fullt, feiring)
  figure.css        figurens egne klasser og mål
  favicon.*         merket
  README.md         hva hver nøkkel betyr, med krav til bildene
mascot.config.json  { "mascot": "seilbat" }   ← valget, innsjekket i repoet
```

Pakkemappa får `eol=lf` i `.gitattributes`, så filene er like byte for byte på alle maskiner.

## Valg av pakke: en fil i repoet, ikke en variabel

Valget står i `mascot.config.json` i repoet. App og worker kommer fra samme pakkefil, og har derfor alltid samme
maskot. Den vanlige utrullingen (`deploy-app.yml`) tar valget med. En GitHub-variabel gjør ikke det, fordi den bare
når appene gjennom Bicep, og Bicep kan sette ny verdi før ny kode er ute. Da starter ikke appen.

## Sjekken

- **I CI, over alle pakker i repoet, med alle feil listet på én gang:**
  - humørene og e-postsituasjonene i pakken er de samme som i koden;
  - alle tre språk finnes, og ingen tekst er tom;
  - filene ligger inne i pakkemappa;
  - bildene er JPEG, 600 × 200 og under 30 kB;
  - ingen bildetekst har adresser (samme kontroll som e-postene, `LINK_LIKE`);
  - SVG-ene har ikke `<script>`, `on*` eller eksterne referanser.
- **Ved oppstart** som sikkerhetsnett, i `index.ts` for web og worker. Ikke i `env.ts`, som også lastes av tester
  og skript.
- **Versjonsfelt i `mascot.json`.** Legger vi til en ny nøkkel (for eksempel `anker` fra #1139), feiler forkens CI med
  beskjed om hva som mangler. Den feiler ikke i drift.

## Veier inn

1. **Profil:** `GET /api/me/stats` beholder `mood`. Klienten leser linjer og bilder for alle tre språk fra pakkens
   statiske JSON, så et språkbytte gir riktig linje med en gang, også om ny henting feiler.
2. **E-post:** `illustratedEmail.ts` og `notificationMessages.ts` (verft-setningen) leser pakken. E-post lages både i
   web (tildelt kurs, diskusjon) og i worker (vurdering, anke, påminnelser, ny hovedversjon), og begge har samme pakke.
   E-poster i køen lages ved sending, så de bruker pakken som gjelder da.
3. **«Mine kurs»:** SVG-en settes rett inn i siden, aldri som `<img>`, så CSS og animasjon virker. Serveren leverer
   SVG-ene som en JS-modul, så tegningen forblir synkron. Klassenavnene og `data-boat-mood` beholdes i skive 1.
4. **Favicon** fra pakken.
5. **Bildeadresser** inneholder pakkenavnet (`/static/mascot/seilbat/...`), så en nettleser aldri viser et bilde fra
   forrige pakke. `/static/boat/` står som alias i skive 1, så en åpen, gammel fane ikke får ødelagte bilder.
6. **Testserveren** for e2e (`scripts/test/admin-content-static-server.mjs`) lærer pakken.
7. **#1139** leser `moods` som Profil.

## Slik bygges det

0. **Fasit fra dagens kode, før noe flyttes**, som egen commit:
   - **e-post byte for byte:** ni situasjoner × tre språk × med og uten lenke. Emne, tekst, HTML, vedleggets navn,
     type og sha256. Påminnelsene og ny hovedversjon er med;
   - **bildene:** sha256 per fil;
   - **Profil, strukturelt:** linje, bildets bytes, alt, bredde og høyde for fem humør × tre språk, og språkbyttet;
   - **figuren:** normalisert DOM for tilstandene ikke påbegynt, 1 av 300, 29 %, 30 %, fullført og feiring, pluss
     skjermbilder på 390 og 1280 px med animasjon fryst, null pikslers avvik.
1. **Flytt, uten synlig endring.** Seilbåten inn i pakken, alle lesere via den. Fasiten skal stå uendret. Etterpå
   mutasjonstest: ett tegn endret i en bildetekst skal felle fasiten.
2. **Bytte.** Sjekken i CI og ved oppstart, en liten testpakke som viser at et bytte endrer alle flater og ingenting
   annet, et skript som tegner alle e-poster, humør og figurtilstander til HTML for forhåndsvisning, og README-malen.

**Samtidighet:** ingen. Pakken leses ved oppstart og endres bare ved ny utrulling.
**Utrulling:** skive 1 kan gå ut alene. Skive 2 endrer ingenting før noen bytter valget i en fork.

## Avgjort før bygging (produkteier 2026-11-07)

1. **Faviconet følger maskoten** og ligger i pakken.
2. **Retningen på fremdriftslinja følger maskoten** og ligger i pakken. Seilbåten fyller fra høyre.

## Åpent, ikke nå

- Egne navn i teksten («båten», «fjellgeita»). Verft-setningen løses ved at hele setningen ligger i pakken.

## Bygget i skive 2

- **Sjekken:** `src/modules/mascot/mascotCheck.ts`. `npm run mascot:check` (`src/scripts/mascotCheck.ts`) sjekker alle
  pakker i `mascots/` og valget i `mascot.config.json`, og lister alle feil på én gang. `test/unit/mascot-check.test.ts`
  kjører skriptet, så det kjører i CI, og viser hver regel med en kopi av seilbåten som har én feil. I tillegg til
  punktene over: ukjente nøkler og språk avvises (en skrivefeil blir oppdaget), filene sjekkes også etter at snarveier
  er fulgt, SVG-ene kan ikke ha `<foreignObject>`, `figure.css` kan ikke hente noe utenfra, og `figure.celebrationMs`
  må være lik varigheten til animasjonen på `.course-boat--leaving` i `figure.css`.
- **Versjonen:** en eldre pakke får beskjed om hvilken versjon koden leser, og hver nøkkel som mangler, listes.
  `ADDED_IN_VERSION` i `mascotPack.ts` fører opp hva som er nytt i hver versjon etter den første.
- **Ved oppstart:** `startServer` i `src/index.ts` kaller `assertActiveMascotPack()` først, for både web og worker
  (begge går gjennom samme `index.ts`). En feil går til den vanlige «Application startup failed.» og stopper
  prosessen med listen over hva som er galt. Pakken leses også når e-postmalen og ruta lastes; en pakke som ikke kan
  leses, stopper allerede der, med den samme typen melding.
- **`LINK_LIKE`** er flyttet til `src/modules/certification/linkLike.ts`, så sjekken bruker samme regel som e-postmalen
  uten å laste malen (som leser den valgte pakken).
- **Testpakken:** `test/fixtures/mascot-swap/mascots/testbat/` (med egen `mascot.config.json` i
  `test/fixtures/mascot-swap/`), utenfor `mascots/`, så den aldri kan velges i drift. En ball i stedet for en båt, egne
  bilder og tekster, og feiringen på 3 s. Den velges i testene med `useMascotPack`, før noe har lest pakken:
  - `test/unit/mascot-swap-email.test.ts`: de samme e-postene som fasiten. Bildet, bildeteksten og verft-setningen er
    testpakkens, og med dem byttet tilbake er e-posten lik fasiten byte for byte;
  - `test/unit/mascot-swap-files.test.ts`: faviconet, bildene, humørene og figuren appen serverer, er testpakkens;
    seilbåtens bildeadresser gir 404;
  - `test/e2e/mascot-swap.spec.ts`: på Profil er linja og bildet testpakkens, i «Mine kurs» SVG-en og feiringens
    varighet; resten er likt fasiten.
- **Forhåndsvisningen:** `npm run mascot:preview -- <navn> [fil]` (`src/scripts/mascotPreview.ts`) skriver
  `dist/mascot-preview-<navn>.html` med alle e-poster (ni situasjoner × tre språk), alle humør på Profil og figuren i
  hver tilstand med feiringen. Tegnet av de ekte funksjonene: e-postmalen med tekstene, `renderStats`,
  `renderCourseProgress` og `launchCourseBoatCelebration`. Hvilken tekst, grunn og lenke hver e-post får, er satt opp i
  skriptet likt avsenderne. `test/unit/mascot-preview.test.ts` kjører skriptet.
- **README-malen:** `mascots/seilbat/README.md`.

**Fasiten endret med vilje (oppfølgingen av #1137, smale linjer):** i `test/fixtures/mascot-fasit/figure-dom.json`
er `style` på båten for tilstandene 1 av 300, 29 % og 30 % ny. Øvre grense i `clamp()` er nå
`max(calc(100% - <rekkevidde>px), calc((<rekkevidde>px - 100%) * 10000))`, så stripegrensen bare gjelder når linja er
minst like bred som stripenes rekkevidde. Med dagens linjebredder gir det samme posisjon: skjermbildene på 390 og
1280 px er uendret, med null pikslers avvik.

Ikke dekket: sjekken ser ikke på PNG-ene i faviconet (størrelse og format), og ikke på om `{course}` og `{major}` står
i verft-setningen.
