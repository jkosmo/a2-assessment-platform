# Overlevering — hvor arbeidet står

> **Skrevet 2026-10-04.** Dette dokumentet skrives om ved hver overlevering; les datoen før du
> stoler på tallene. Metodikken ligger i `doc/TEST_AND_RELEASE_PLAYBOOK.md` og endres ikke her.

---

## Kort: det som må avgjøres

**Prod og stage står begge på 2.77.0. 2.78.1 ligger på `dev` og er ikke rullet ut noe sted.**

| Miljø | Versjon | |
|---|---|---|
| prod | 2.77.0 | rullet 2026-10-04 kl. 08:54 fra `3f111c68`; #894 er lukket |
| stage | 2.77.0 | samme commit |
| `main` (git) | 2.76.0 | **bak prod** til PR #1082 er merget |
| `dev` (git) | 2.78.1 | #1073, #1080 og #1081 foran prod |

Tre ting krever et menneske:

1. **PR #1082 må merges.** `main` står på 2.76.0 mens prod kjører 2.77.0. En utrulling uten
   `git_ref` bygger `main` HEAD og ville rullet prod tilbake.
2. **2.78.1 til stage** krever GO fra QA-porten først. Den har gitt NO-GO to ganger på denne
   versjonen (se #1073 under). Prod krever deretter GitHub-godkjenning fra `jkosmo`, utenfor
   arbeidstid.
3. **Åpne beslutninger** ligger nederst i dette dokumentet.

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

⚠️ **Flytgjenkjenningen er fortsatt et anslag** og kan bli neste funn. Kuren som finnes, er at hver
figur selv sier `data-motion="animated"` eller `"static"`. Det endrer kontrakten for skillet og
venter på produkteier.

## Hva som ble gjort: #1081 (2.78.1)

«Mer»-menyen i nederste listerad lå skjult bak tabellrammen. `row-actions.js` låner nå luft i
bunnen av ramma mens menyen er åpen. `test/e2e/row-more-last-row-1081.spec.ts` måler det.

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

Sist målt 2026-10-04, på 2.78.1: **1590 enhet · 69 DOM · 373 e2e · 707 integrasjon**, alle grønne.
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
