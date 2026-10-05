# Overlevering — hvor arbeidet står

> **Skrevet 2026-10-05.** Dette dokumentet skrives om ved hver overlevering; les datoen før du
> stoler på tallene. Metodikken ligger i `doc/TEST_AND_RELEASE_PLAYBOOK.md` og endres ikke her.

---

## Kort: det som må avgjøres

**Prod står på 2.78.3. Stage står på 2.82.1: sju rettinger som produkteier skal teste samlet (kvelden 2026-10-05). Ingenting av 2.79–2.82 er i prod.**

| Miljø | Versjon | |
|---|---|---|
| prod | 2.78.3 | rullet 2026-10-04 kl. 20:13 fra `2433d2b7`, godkjent av produkteier. #1080, #1081, #1083 |
| stage | 2.82.1 | rullet 2026-10-05 kl. 11:00 fra `5538cdc3`, commiten QA-porten ga GO på (`.ai-qa/qa-20261005-100836.md` og `-103917.md`); `/version` og helsesjekk bekreftet |
| `main` (git) | 2.78.3 | likt med prod (PR #1086 flettet 2026-10-04) |
| `dev` (git) | 2.82.2 | sju rettinger (2.82.0), to oppfølgere etter QA (2.82.1), og kurset på telefon (2.82.2), se under |

**2.82.0, i én setning hver** (detaljer og rotårsaker i `doc/VERSIONS.md`):

| Sak | Hva som er rettet | Målt i |
|---|---|---|
| #1079 | Figuren kan leses på telefon: det smale oppsettet har to steg per rad og oppgir sin egen størrelse; leseren har smalere marger på telefon | `test/e2e/figure-legible-on-phone-1079.spec.ts` |
| #1084 | «Mer» står innenfor rammen på listene: overskrifter og statusmerker får brekke, og handlingskolonnen er festet til høyre | `test/e2e/list-fits-frame-1084.spec.ts` |
| #1085 | Menylinja får plass på telefon: én linje på 390 px, og lenkene brekker i stedet for å stikke ut på smalere skjermer | `test/e2e/nav-fits-phone-1085.spec.ts` |
| #1087 | Skillet teller etiketter slik plattformen gjør; de samme figurparene sendes gjennom begge | `test/unit/asset-layout-variants-1079.test.ts` |
| #1088 | `?locale=constructor` gir ikke lenger feil 500 på en figur | `test/m2-section-asset-layouts-1079.test.ts` |
| #1089 | En avvist figur etterlater ikke lenger et utkast: figurene sjekkes før seksjonen lages, alt i én transaksjon | samme, og `test/unit/section-create-with-assets-1089.test.ts` |
| #1090 | En ny oversettelse av figurer fjerner de forrige oversatte filene | samme |

**2.82.2: et kurs med lange stegtitler gikk ut av skjermen på telefon — og gjør det i prod.**
Produkteier åpnet testkurset på en ekte telefon og fant det. Når et steg er lest eller kommer
senere, vises det som en rad med tittelen på én linje, og den raden presset hele kursinnholdet ut
til 668 px på en skjerm på 390. Rettet: rutenettene rundt kursinnholdet og rundt hvert steg holder
på bredden, og på telefon får tittelen sin egen linje. (Første utgave rettet bare det ene
rutenettet og fikk NO-GO fra QA: diskusjonslinja under stegene presset fortsatt innholdet ut på
engelsk. Se `doc/VERSIONS.md`.) `test/e2e/course-steps-fit-phone.spec.ts`. Feilen fantes før
dagens arbeid og ligger i prod (2.78.3) til 2.82 er rullet dit.

⚠️ **Lærdommen gjelder testene:** alt som åpnet et kurs på telefonbredde, åpnet et kurs med ETT
ulest steg. Mål en side i de tilstandene en bruker kommer i, ikke bare slik den åpner seg.
Produkteier bruker Fairphone 6 med Firefox, men har sagt at det ikke skal testes mot mange
telefoner — «det viktige er at det er testet på en liten skjerm». Firefox ble prøvd én gang
(samme svar som Chromium) og er ikke lagt inn i oppsettet.

⚠️ **Ett testkurs står igjen på stage, arkivert:** «Stage-test figur i to oppsett 1791205999067».
Det ble fullført på telefonen, fikk et kursbevis, og kan derfor ikke slettes
(`course_has_completions`). Stage-testen teller det som «står igjen» ved hver kjøring.

Seks ting krever et menneske:

1. **Tre synlige endringer er mine valg, ikke produkteiers.** Han skal se dem på stage og kan si
   nei før prod:
   - *Leseren har smalere marger på telefon* (`participant.html`, under 600 px). Tre linjer CSS.
     Uten dem er etikettene 8,5 px på en telefon på 360 px; med dem 9,5.
   - *To statusmerker står under hverandre* i listene («Publisert» over «Nyere utkast»), på alle
     bredder. Plassen går til navnekolonnen. Radene med utkast blir én linje høyere.
   - *På et nettbrett på høykant* står den smale figuren i sin egen størrelse (300 px) til venstre
     i en spalte på 580 px. Lesbart, men fire steg per rad ville sett bedre ut der. Det krever et
     tredje oppsett (`doc/DECISIONS.md`).
2. **Ekte telefon er ikke prøvd.** Alt om telefon er målt i Chromium med telefonbredde. Spalten
   (201 px på 390) og etikettstørrelsen bør ses på en ekte telefon før #1079 regnes som ferdig.
3. **Prod for 2.82.0** krever GitHub-godkjenning fra `jkosmo`, utenfor arbeidstid. Den har én
   migrasjon (fra 2.81.0: én ny kolonne, bare utvidelse). «Språk går foran oppsett» er fortsatt
   mitt valg (`doc/DECISIONS.md`).
4. **Skillet i ChatGPT er ikke prøvd.** Produkteier fikk 2.81.1-pakka og er bedt om å si fra om
   figurene vises som bilder der. 2.82.0 endrer skillet igjen (det smale oppsettet,
   etikettsjekken, forhåndsvisningen), så pakka må bygges på nytt: `npm run skill:package`.
5. **To funn fra QA som fantes fra før, er ikke blitt saker.** `?locale=xx` på modulbiblioteket og
   arkivet gir feil 500 (`src/routes/adminContent.ts`, samme type feil som #1088, bare ved en adresse
   skrevet for hånd). Og «Mer» på en av de nederste radene kan kuttes av tabellrammen når lista
   har svært få rader. Produkteier avgjør om de skal bli saker.
6. **Lagrede figurer er ikke målt.** `npm run maint:repair-unreadable-svg-assets` (tørrkjøring uten
   `--apply`) er ikke kjørt mot stage eller prod. Se `doc/OPERATIONS_RUNBOOK.md`.

⚠️ **Figurer som alt er lagret med det gamle smale oppsettet** (fire per rad, uten egen størrelse)
blir ikke tegnet på nytt av seg selv. De vises som før: for små på telefon. I prod finnes ingen
(2.81.0 kom aldri dit). På stage finnes bare det testene og produkteier selv har lagt inn.

**Mutasjonssjekken fant to ting i dag, begge i mine egne rettinger:**

- Regelen som skulle gjøre menylenkene tettere på telefon, virket aldri. Fem sider har sin egen
  kopi av menystilen i en stilblokk som kommer etter `shared.css`, og kopien vant. Menyen brakk
  til to linjer i stedet for å stå på én. Regelen har nå to klasser i velgeren.
  **Kopiene bør fjernes** (`admin-content-library.html`, `-courses`, `-sections`, `-classes`,
  `-calibration`): det er de som gjør at en endring i `shared.css` ser ut til å virke og ikke gjør det.
- En kontroll av at statusmerkene sto under hverandre, godtok merker side om side (den sammenlignet
  toppene, og merkene er ulike høye).

**Slik testes en utgivelse på stage:** produkteier logger inn én gang (`npm run stage:auth`),
`npm run test:stage:release` kjører målingene med den ekte klienten mot de ekte dataene, og
`test-results/stage-rapport/rapport.html` viser utfallet med skjermbilder. Han skal ikke klikke seg
gjennom det en maskin kan måle. Sist kjørt mot 2.81.0 (2026-10-04): alle målingene for #1079 besto,
#1084 og #1085 feilet som ventet. Mot 2.82.1 skal alle bestå, og målingen av deltakeren på telefon
krever nå at etikettene er minst 9 px på skjermen. Testen er prøvekjørt mot en lokal app
(`STAGE_LOKAL=http://127.0.0.1:3001`): 35 besto, 2 hoppet over (ingen kurs med «Mer» lokalt).
Den holder seg under appens grense på 120 forespørsler i minuttet (`test/stage/pace.ts`, én
arbeider) — uten det ga prøvekjøringen svar 429 og tomme lister. `STAGE_BEHOLD=1` lar testkurset
stå igjen, så figuren kan ses på en ekte telefon; neste kjøring rydder det bort.
Det produkteier skal gjøre, står i `C:\Dev\Assessment\MANUELL_TEST_STAGE_2.82.1.md` (utenfor repoet).

Åpne beslutninger ligger nederst i dette dokumentet.

---

## Hva som ble gjort: #894

Saken: å døpe om 18 elementer kostet over hundre klikk, og den billigste veien ga feil resultat —
et halvt kurs endte med titler på feil språk uten at noe sa fra (#892, nå lukket).

Flaten, på **modul- og seksjonslista**:

| | |
|---|---|
| «Døp om» i raden | Enter lagrer på språket lista viser, Escape avbryter |
| Språkkolonne | viser **hullene** («nn, en mangler»), ikke hva som finnes |
| «Oversett det som mangler (N)» | én samlet runde, etter omdøpingene; tallet gjelder de synlige radene |
| «Bare de som mangler språk» | bryter i filterraden som snevrer inn tilstandsfilteret |

Et språk som ikke kommer gjennom, blir stående **tomt og navngitt** — aldri fylt med kildeteksten.
Det er hele poenget med #892, og den regelen må ikke mykes opp.

### Filene

| Fil | Hva den eier |
|---|---|
| `public/static/list-rename.js` | alt som er felles: språkmerket, kildespråket, omdøpingsfeltet, den samlede runden |
| `public/static/list-page.js` | kroken `afterTableRender` og `toggle` — delt av alle fire listene |
| `public/static/admin-content-library.js` | modullistas to kallsteder |
| `public/static/admin-content-sections.js` | seksjonslistas to kallsteder |
| `src/i18n/content.ts` | `localesPresent()` — hvilke språk en lagret tekst faktisk har |
| `src/routes/adminContent.ts` | `POST /titles/localize` |
| `src/routes/adminSections.ts` | `titleLocales` på seksjonsradene |
| `src/modules/adminContent/adminContentQueries.ts` | `titleLocales` på modulradene |

Testene: `test/unit/locales-present-894.test.ts`, `test/m2-list-rename-894.test.ts`,
`test/e2e/admin-content-list-rename-894.spec.ts`, `test/stage/list-rename-894.spec.ts`.

---

## Hva som ble gjort: #1073 (2.78.0)

Bare skillet `a2-authoring-api` — ingen endring i plattformen, ingen migrasjon. En figur som viser
et forløp tegnes animert som standard; `skills/a2-authoring-api/scripts/figure-motion-check.mjs`
håndhever reglene (én gang, innen 5 sekunder, bare CSS, komplett stillbilde). Detaljene står i
`doc/VERSIONS.md`.

Endringen ble skrevet 2026-10-03 i en egen økt på nett, oppå `main`, og kalte seg 2.77.0 der. Det
nummeret hadde #894 allerede, så den ble tatt inn i `dev` 2026-10-04 som 2.78.0. Saken står åpen:
plattformsiden (respektere «redusert bevegelse», spille av på nytt) er ikke gjort.

**Lærdom:** en økt som starter fra `main` ser ikke versjonsnumre som bare finnes på `dev`. Start
nettøkter fra `dev`, eller sjekk `origin/dev` før versjonen settes.

**QA-porten ga NO-GO fire ganger** (2026-10-04). De tre første rundene fant seks til åtte hull i
figursjekken hver; den fjerde fant at det som får variere i malen, var for romslig (nå strammet inn).
Sjekken prøvde å regne ut hva nettleseren gjør med figurens stilregler, og hver runde fant nye
kombinasjoner. Produkteier bestemte derfor: **stilblokka i en animert figur er flytmalens stilblokk,
ordrett.** Farger, varighet, forsinkelser og antall steg kan variere; alt annet er
`unsupported_animation_form`. Sjekken sammenligner, den tolker ikke. `<animateMotion>` avvises (bare
CSS). Detaljene og lærdommen står i `doc/VERSIONS.md`.

Produkteier bestemte også at **stage venter på GO fra porten**, selv om porten sa at
plattformendringene (#1080, #1081) var klare isolert sett.

⚠️ **Codex-kontoen gikk tom for kreditt midt i runde fem** (2026-10-04 ca. kl. 11:45), før dommen.
`scripts/ai-qa.ps1` uten `-Local` feiler derfor med exit 1 til kontoen er fylt på. Reserveløsningen
er `-Local` (skriver bestillingen til fil) og `-Judge <svarfil>` (dømmer en lokal agents svar etter
samme krav).

**Femte runde (reserveløsningen) ga også NO-GO**, med to hull: et steg tegnet som rombe, og
`<style media="print">`. Produkteier bestemte da at **hele figuren låses til malen**: en animert
figur består av `<rect>` som steg, streker, etiketter og én stilblokk uten attributter, og ingenting
annet. Ikke levert av det saken ber om: malen «sti som tegnes», e2e i deltakerflaten og
forfatterveiledningen.

⚠️ **Flytgjenkjenningen er fortsatt et anslag** og kan bli neste funn. Kuren som finnes, er at hver
figur selv sier `data-motion="animated"` eller `"static"`. Det endrer kontrakten for skillet og
venter på produkteier.

## Hva som ble gjort: #1081 (2.78.1)

«Mer»-menyen i nederste listerad lå skjult bak tabellrammen. `row-actions.js` låner nå luft i
bunnen av ramma mens menyen er åpen. `test/e2e/row-more-last-row-1081.spec.ts` måler det.

## Hva som ble gjort: #1083 (2.78.2)

En SVG-figur med hardt mellomrom i en etikett ble lagret i en form nettleseren ikke kan lese, og
deltakeren så ingen figur. `sanitizeSvg` skrev figuren ut som HTML, mens den serveres og leses som
XML. Rensingen skriver nå XML og avviser et resultat som ikke lar seg lese. Detaljene og målingene
står i `doc/VERSIONS.md`.

⚠️ **Det som alt er lagret, rettes ikke av seg selv.** Se punkt 4 øverst.

⚠️ **Første utgave av rettingen lekket minne** (rundt 1,5 MB per figur), og QA-porten ga NO-GO på
den. Årsaken var ett `querySelector` på et tre fra jsdom-vinduet som lever like lenge som prosessen.
`test/unit/svg-sanitizer-memory-1083.test.ts` måler nå heapen. Rører du `svgSanitizer.ts`: kjør den
testen, og les kommentaren i `test/support/measureSvgSanitizerMemory.mts` før du måler minne selv —
en synkron løkke ser ut som en lekkasje også i frisk kode.

## Hva som ble gjort: 2.78.3 (oppfølging av #1083 og figursjekken)

QA-gjennomgangen av 2.78.2 ga GO for stage med to funn. Begge er rettet, og detaljene står i
`doc/VERSIONS.md`.

- **Lesbarhetskontrollen i `sanitizeSvg` doblet minnetoppen.** En tett figur på 1 MB (rundt 25 000
  elementer) tok ned prosessen ved 512 MB heap i 2.78.2. Kontrollen leser nå gjennom teksten med
  samme XML-leser som før (`saxes`), uten å bygge et dokument. Testen sammenligner svarene med
  `DOMParser` på 637 tilfeller, og en egen test kjører kontrollen på 4 MB med 256 MB heap.
- **Skillets figursjekk** avviser nå både en omvendt skråstrek og en tegnreferanse (`&#97;`) i
  figurens CSS, som `css_escape`. Tegnreferansen var et hull: plattformen gjør `&#97;nimation` om til
  `animation` ved lagring, og sjekken godkjente figuren som stillestående. ⚠️ Klassen er **ikke**
  tettet: seks skrivemåter til slipper gjennom. Ikke lapp videre; se «Åpne beslutninger».

⚠️ **Ikke rettet:** en tett figur på 1,5 MB tar fortsatt ned prosessen ved 512 MB heap, slik den
gjorde før #1083. Det er antall elementer som koster, ikke bytes, og grensa i dag er 5 MB i bytes.
Heap-grensa i prod er ikke lest av. Se «Åpne beslutninger».

## Hva som ble gjort: #1079 steg 2 og 3 (2.79.0, 2.80.0) — og hva som gjenstår

Saken: en PowerPoint skal bli et kurs der figurene tegnes på nytt som små SVG-er, ikke ett bilde
per lysark. Produkteier har godkjent retningen og plattformdesignet (kommentarene i #1079).

| Steg | Hva | Status |
|---|---|---|
| 1 | Måle en ekte presentasjon, tegne ett lysbilde på nytt, sammenligne med originalen | gjort; beslutningene står i #1079 |
| 2 | Skillet: sirkler som steg og farge per fase, i malen og sjekkene | **gjort, 2.79.0** |
| 3 | Skillet: to oppsett (bredt og smalt) fra én beskrivelse | **gjort, 2.80.0** |
| 4 | Plattformen: lagre det smale oppsettet (`layoutVariants`) og velge etter spaltebredde | **gjort, 2.81.0** |
| 5 | Det smale oppsettet kan leses på telefon: to steg per rad, egen størrelse, smalere marger rundt leseren | **gjort, 2.82.0** — ikke sett på en ekte telefon |
| – | Uttrekk fra presentasjonsfila (`pptx-extract.mjs`), og et sammendrag som kilde | ikke startet |

Steg 2: ny mal «flow with phases» i `figure-design.md`, `figure-motion-check.mjs` godtar den som en
andre form av malen, og `figure-fit-check.mjs` avviser etiketter som overlapper og streker gjennom
en etikett. Detaljer og målinger i `doc/VERSIONS.md`.

Steg 3: `skills/a2-authoring-api/scripts/draw-flow-figure.mjs` tar én beskrivelse (steg, faser,
farger) som JSON og tegner begge oppsettene, og kjører begge figursjekkene på resultatet før det
returneres. Kjørt på arbeidsflyten fra den ekte presentasjonen gir det de to figurene produkteier
godkjente, tegn for tegn. En figur har høyst åtte steg (begrunnelsen står i skriptet). Til
begge går nå i pakka: den brede som figuren selv, den smale i `layoutVariants`.
⚠️ Fra 2.82.0 er det smale oppsettet et annet enn det produkteier godkjente 2026-10-04 (to steg
per rad i stedet for fire) — se steg 5 og `doc/DECISIONS.md`.

**Steg 4 (2.81.0): plattformen lagrer det smale oppsettet og velger etter spaltebredden.** En figur
med smalt oppsett vises i det når spalten er under 640 px. Alt som skriver eller leser en figur,
kjenner det smale oppsettet: lagring (ny kolonne `layoutVariants`), import, eksport, forfatter-API,
oversettelse, levering (`?layout=narrow`), sletting, reparasjonen fra #1083, klienten
(`hydrateContentAssetImages`, to kallsteder) og skillets tre sjekker. Oversikten står i
`doc/FEATURE_SURFACE_MAP.md` §11b, reglene som er valg i `doc/DECISIONS.md`.

⚠️ **Én leser.** `layoutVariants` er JSON. Les den bare gjennom `readLayoutVariants` og `assetFiles`
i `assetCommands.ts` — sletting, reparasjon og eksport er bygget på samme liste over filer. Et nytt
sted som leser kolonnen selv, gir filer som ryddes av den ene og blir liggende etter den andre.

⚠️ **«Språk går foran oppsett» er min avgjørelse, ikke produkteiers.** Har figuren det smale
oppsettet bare på norsk og det brede på engelsk, får en engelsk leser det brede. Står som åpent
spørsmål i `doc/DECISIONS.md`.

## Hva som ble gjort: skillet viser figurer som bilde (2.81.1)

Produkteier bruker skillet i **ChatGPT**. Der ble en figur skrevet ut som SVG-kode («vises som
tagger»), fordi skillet sa «vis den rendret» uten å si hvordan, og bare nevnte Playwright «i
repoet» som måte å se på en figur. `figure-preview.mjs` lager nå en side der figurene vises som
bilder (bred og telefonbred spalte, knapp for å spille av animasjonen), og en stillestående fil for
tegnere som ikke er nettlesere. Reglene står i `figure-design.md` («Seeing the figure»).

⚠️ **Ikke prøvd i ChatGPT.** Målt er at sida og den stillestående fila er riktige i en nettleser.
Om ChatGPT viser sida i canvas eller bare gir den som fil, og om sandkassa der har en tegner, er
ikke kjent. Produkteier har fått pakka (`dist/skills/a2-authoring-api-v2.81.1.zip`, bygget med
`npm run skill:package`) og er bedt om å si fra hva som skjer. Forrige pakke på maskinen var 2.61.0.

## Hva som ble gjort: #1080 (2.78.1)

Telefonvisningen av de fire listene. Cellene manglet kolonnenavn, var bredere enn kortet, og «Mer»
lå utenfor. Én linje i `list-page.js` og én telefonregel i `shared.css`.
`test/e2e/list-mobile-labels-1080.spec.ts` måler det i nettleseren. Andre tabeller i appen bruker
samme kortregel uten `data-label` og er ikke målt.

---

## ⚠️ Fire feller i denne koden

Disse er festet i tester. Fjerner du testen, mister du vakten.

**1. To ulike kontrakter for tittel-PATCH.**
Modulenes `PATCH /modules/:id/title` **slår sammen** på tjeneren. Seksjonenes
`PATCH /sections/:id/title` **erstatter**. Derfor sender klienten kildespråkets tekst med i
modulpatchen (uten den slettes en tittel som er lagret som ren streng, fordi grunnlaget for
sammenslåingen da er tomt) og hele språkkartet i seksjonspatchen (uten det slettes de andre
språkene). Begge ville sett ut som vellykkede operasjoner.

**2. En ren streng er bokmål.**
`LEGACY_STRING_LOCALE` i `public/static/localized-value.js`. Seksjonssidas egen `parseLocalized`
legger en ulokalisert tittel under *visningsspråket* — riktig i editoren, feil i lista: en omdøping
sett i nynorsk ville flyttet den norske teksten til nynorsk. `lagretTittelkart` i `list-rename.js`
leser den som tjeneren gjør, og importerer konstanten i stedet for å gjenta regelen.

**3. `afterRender` kjører ikke på et filterklikk.**
Et filterklikk tegner bare tabellen. En hodeknapp hvis tekst avhenger av hva som er synlig — som
«Oversett det som mangler (N)» — hører derfor i `afterTableRender`, ikke i `afterRender`. Ellers
står tallet igjen og lover noe annet enn knappen gjør.

**4. «Eksporter» ligger nå under «Mer».**
Radene fikk en sjette handling, og D5-regelen gir plass til tre pluss «Mer». Dette gjelder begge
listene. Jeg utvidet ikke regelen for å unngå det — det ville vært en tverrgående designendring for
å få plass til én knapp. Produkteier har fått beskjed, men ikke bedt om noe annet.

---

## Slik verifiserer du

**Alle fire suitene, i én prosess** (hopper du over én, antar du):

```bash
(npm run build && npm run test:unit && npm run test:dom \
  && npx playwright test --config playwright.admin-content.config.ts \
  && npm run test:integration:native) > "$TEMP/claude/kjoring.log" 2>&1; echo "EXIT=$?"
```

Sist målt 2026-10-05, på 2.82.2: **1840 enhet · 69 DOM · 450 e2e · 757 integrasjon**, alle grønne.
(På 2.82.0 trengte nettleserrekka to kjøringer: i den første feilet «add a section from the library» i
`admin-content-course-sections.spec.ts` — nedtrekkslista i kursbyggeren, som ikke er rørt. 15 av
15 alene, 430 av 430 i neste fullkjøring. Se «e2e-suiten rykker» under.)
⚠️ Sjekk at port 3001 er fri først: en lokal app som står igjen, plukker vurderingsjobber fra
testdatabasen og gir tilfeldige feil i `assessment-policy.integration.test.ts`.
Kjør `npm run build` alene etter å ha skrevet en ny testfil: bygget typesjekker også testene, og en
typefeil der stopper hele rekka etter ti sekunder.
Ikke pipe utdataene til `tail` — det skjuler feiltellingen og gir exit 0.

**Mot utrullet stage** (krever innlogging, tokenet varer ~85 minutter og er for lengst utløpt nå):

```bash
npm run stage:auth     # åpner et nettleservindu — et menneske må logge inn
npm run test:stage
```

**Utrulling til stage:**

```bash
gh workflow run "Deploy App Only (no infra)" --repo jkosmo/a2-assessment-platform \
  --ref main -f deploy_production=false -f skip_staging=false -f git_ref=<FULL SHA>
```

`--ref main` og full SHA. `--ref dev` gir en stille «skipped», kort SHA gir checkout-feil.
Verifiser alltid med `curl <app>/version` mot appen — kjøringens farge lyver begge veier.
Vertsnavnene står i `doc/ENVIRONMENTS.local.md` (gitignorert, skal ikke skrives ut).

---

## Det som gjenstår

| Hva | Hvorfor det ikke er gjort |
|---|---|
| **Kurs- og klasselista** mangler omdøping og språkkolonne | #894 nevner bare modul- og seksjonslista. Mekanismen er delt, så det er innkobling, ikke ny kode. |
| **e2e-suiten rykker** | Fire fulle kjøringer 30.09 ga én feilende test hver gang — fire *forskjellige* tester, alle grønne alene. `fullyParallel: false` gjelder bare innen en fil; filer kjører i parallell mot én statisk server. Det ble lest som belastning, ikke kode. ⚠️ **Det holdt ikke helt:** 2026-10-04 feilet «samlet oversetting bærer de lagrede språkene videre» i `admin-content-list-rename-894.spec.ts` to av fem ganger også ALENE. Testen ventet på den første patchen og sjekket den andre uten å vente. Rettet (120 av 120 etterpå). Neste gang en test feiler i fullkjøringen: kjør den alene med `--repeat-each=5` før den avskrives som last. |
| **Fem sider har sin egen kopi av menystilen** (`.content-area-nav`, `.content-area-nav-link` i `admin-content-library.html`, `-courses`, `-sections`, `-classes`, `-calibration`) | Kopiene kommer etter `shared.css` og vinner over den. En endring i `shared.css` ser ut til å virke og gjør det ikke (#1085, funnet av mutasjonssjekken 2026-10-05). Å fjerne dem er opprydding på tvers av fem sider, og ble ikke tatt med i en samling småfeil. |
| **Kompleksitetsmålingen teller rå linjer** | Skåren falt 76 → 73 fordi to filer så vidt passerte 800-grensa (802 og 809). Målingen teller også kommentarlinjer, som dette prosjektet bevisst skriver mange av. Om grensa skal telle kodelinjer, er det en regelendring — egen commit, med `REGELENDRINGER`-merket i `doc/complexity/history.json`. |

---

## Åpne beslutninger som venter på produkteier

| Sak | Hva som trengs |
|---|---|
| **#1000** | Tre spørsmål i `doc/DESIGN_1000_1066.md` — oppfølgingsrollene er begrunnet med et forhold datamodellen ikke har |
| **#1066** | Skal administrator kunne tildele fagansvarlig-rollen i appen? Rolle- og sikkerhetsregimet må avklares først |
| **#928** | Drift-varselet er verken synlig eller utløst av den vanligste årsaken (`doc/DESIGN_928.md`) |
| **#934** | Kursversjonering: målbilde, og det minste som gjør dagens versjon logisk |
| **#808** | Står åpen med ny utløser: nedetid som flytter seg inn i arbeidstiden, eller deploy-nedetid som ikke lenger godtas. Morgenomstarten (~06:05) er akseptert. |
| **#1073: hvor skal animasjonsreglene håndheves?** | Skillets figursjekk leser forfatterens tekst med mønstre; plattformen leser med en HTML-leser som retter skrivemåten (`<STYLE>`, attributter uten anførselstegn, tegnreferanser). Seks kjente skrivemåter slipper gjennom som «stillestående» og lagres som animasjon i løkke (`doc/VERSIONS.md`, 2.78.3). Ingen oppstår ved et uhell. Forslag: slutt å lappe skillet, og la plattformens validering kontrollere det **rensede** resultatet hvis garantien skal gjelde. Skillet blir da en hjelp, ikke en vakt. |
| **Tett figur kan ta ned appen** (ingen sak ennå) | En SVG med svært mange elementer (rundt 1,5 MB tett tegnet) bruker opp minnet under rensingen, nå som før #1083. Bare en innlogget forfatter kan laste opp. Skal det settes en grense på antall elementer, og hvor? Les først av heap-grensa i prod. |

---

## Hva kapasiteten gjør med målingene

Stage og prod deler **én B1-instans** mellom tre apper. Det forklarer mye som ser ut som feil:

- Stage-suiten 30.09: 45 bestått, **10 feilet**, 3 ustabile. Alle ti var kapasitet. `courses` svarte
  500 under last, og 200 på 2,0–3,6 sekunder tre ganger på rad da stage var i ro. De ni andre var
  `Target page has been closed`, `Request context disposed` og `beforeAll`-tidsavbrudd — nedrigging
  etter treghet, ikke påstander som feilet.
- Modullista brukte 16 sekunder under last og 2,7 i ro.

**Konklusjonen hver gang:** kall endepunktet på nytt når miljøet er i ro før du melder en feil.

---

## Ekte tall fra stage (målt 2026-09-30)

| | Rader | Alle tre språk | Med hull |
|---|---:|---:|---:|
| Moduler | 101 | 81 | **20** |
| Seksjoner | 63 | 27 | **36** |

Alle 56 hullene har samme form: `nn` og `en-GB` mangler. Altså titler skrevet på ett språk — ikke
delvise oversettelser. Og **alle rader hadde `titleLocales` fra tjeneren**; manglet feltet, ville
hver eneste rad meldt «nn, en mangler», og funksjonen ville sett ut som den virket mens den var feil
om alle. Det er det `test/stage/list-rename-894.spec.ts` vokter.
