# #1169 og #1171 — handlinger og tilstandsmerker i hoder og rader

Status: kartlagt 26.11.2026. Venter på produkteiers avgjørelser (§ 4), så prototype (Artifact) før bygging. Fra konsistenssjekken
#1157; rekkefølgen godkjent 21.11.2026 (doc/DECISIONS.md).

## Kort fortalt

- **Mønsteret saken peker på, finnes ikke ennå.** Kursets hode har ingen fast «Mer»-meny: `form-page.js` og `list-page.js`
  bruker `rowActionsHtml` (`row-actions.js`), som viser alt når det er fire handlinger eller færre, og ellers de tre første og
  resten under «Mer». Hva som havner under «Mer», avhenger altså av tilstanden og rekkefølgen hver side sender. Arkiver står
  direkte i ett hode og under «Mer» i et annet av den grunn, ikke fordi noen har valgt det.
- **Forslaget:** én regel for alle fire typer (kurs, modul, seksjon, klasse), i hode og rad. Fast plass for hver handling, ett
  navn for hver, og «Mer» alltid på samme sted med samme rekkefølge. Kurs får «Dupliser» og «Døp om» i lista, som moduler og
  seksjoner.
- **#1171** i samme plan, fordi den rører de samme hodene: ett ord per tilstand, versjonen på én måte, og «Alt lagret» bare når
  noe er lagret.
- Ingen endring på tjeneren, unntatt «Dupliser kurs» hvis kopien skal ta med de samme elementene (§ 4, spørsmål 2).

## 1. Slik er det i dag

Fil:linje gjelder `public/static/` i grenen `1140-skill-oppdater` (2.184.0).

### Hodene

| Tilstand | Kurs (`courses.js:2483`) | Modul (`shell.js:3754`) | Seksjon (`sections.js:1024`) | Klasse (`classes.js:372`) |
|---|---|---|---|---|
| Ny | (bare Lagre/Avbryt) | Generer innhold, Be om endring | (bare Lagre/Avbryt) | (bare Lagre/Avbryt) |
| Utkast | Eksporter, Publiser, Arkiver | Publiser, Generer innhold, Be om endring \| **Mer:** Generer spørsmål, Eksporter, Importer | Eksporter, Publiser, Erstatt fra fil, Arkiver | Arkiver |
| Publisert | Eksporter, Avpubliser, Arkiver | Avpubliser, Generer innhold, Be om endring \| **Mer:** Generer spørsmål, Eksporter, Importer | Eksporter, Avpubliser, Erstatt fra fil, Arkiver | – |
| Publisert med utkast | Publiser utkastet, Forkast utkast, Eksporter \| **Mer:** Avpubliser, Arkiver | Publiser, Avpubliser, Generer innhold \| **Mer:** Be om endring, … | Eksporter, Publiser ny versjon, Avpubliser \| **Mer:** Erstatt fra fil, Arkiver | – |
| Arkivert | Eksporter, Gjenopprett, Slett (+ admin: Slett kurs og ubrukt innhold) | Eksporter, Gjenopprett, Slett | Eksporter, Gjenopprett, **Slett seksjon** | Gjenopprett, Slett |
| Ikke eier | Eksporter | Eksporter | Eksporter | (ingen) |

Det som ikke finnes: **Arkiver** i modulens hode. **Dupliser** og **Døp om** i noe hode. **Ta inn fra fil** i kursets hode
(kurset oppdateres fra fil via «Importer kurs» i lista).

### Radene

| Type | Eier (synlig \| Mer) | Ikke eier |
|---|---|---|
| Kurs (`courses.js:1118`) | Åpne, Eksporter, Publiser/Avpubliser, Arkiver (aldri «Mer»; arkivert admin: \| Slett kurs og ubrukt innhold) | Åpne, Eksporter, «Kun for eier» |
| Modul (`library.js:234`) | Åpne, Døp om, Dupliser \| Eksporter, (Avpubliser), Arkiver. **Ingen Publiser** | Åpne, Dupliser, Eksporter, «Kun for eier» |
| Seksjon (`sections.js:257`) | Åpne, Døp om, Dupliser \| Eksporter, Publiser/Avpubliser, Arkiver. Med utkast står «Publiser ny versjon» FØRST. Arkivert: **ingen Slett** | Åpne, Dupliser, Eksporter, «Kun for eier» |
| Klasse (`classes.js:116`) | Åpne, Arkiver (arkivert: Åpne, Gjenopprett, Slett) | «Kun for eier», **uten Åpne** |

Kurs kan ikke dupliseres eller døpes om fra lista. «Publiser utkastet» og «Publiser nye versjoner» finnes bare i kursets hode.

### Tilstandsmerkene (#1171)

| Tilstand | Ordene i dag |
|---|---|
| Aldri publisert | «Arbeidsutkast» (ny modul), «Utkast» (alt annet), «Live + utkast» eller «Modulgrunnlag» (modulens forhåndsvisning) |
| Publisert | «Publisert v1.0» i ett merke (modulens hode); «Publisert» + brikken «v1.0» (kurs, lister); «Live» (modulens versjonsliste, forhåndsvisning); «Live – Modul v…» (samtaleloggen) |
| Versjonen | Kurs «v3.2», også før første publisering («v1.0», fordi `versionMajor` er 1 fra start). Modul «v2.1», ingen brikke før publisering. Seksjon «v1»/«v5» som heltall i egen kolonne; et utkast som aldri er publisert, viser «v1». Klasse: ingen |
| Formen | «Publisert» er en pille i modullista (`admin-content-library.html:38`), en firkant ellers (`shared.css:1327`) |
| Lagret | «Alt lagret» på en ny, tom side før noe er lagret (alle fire: sidene kaller `markClean()` etter første tegning). Modulen viser «Ulagrede endringer» rett etter første lagring med bare navn (`shell.js:2221–2223`: `sessionDraft` legges tilbake etter `loadModule`) — **en feil**, ikke et ordvalg |
| Annet | Modulens versjonsliste: «Live» og «Åpen nå». «Slett seksjon» mot «Slett» overalt ellers. «Be om endring» er to nøkler i modulens hode |

Ny modul åpner på **Innstillinger**; nytt kurs, ny seksjon og ny klasse på **Rediger**.

## 2. Forslaget

### Regelen for handlinger (hode og rad)

Plassene, i fast rekkefølge. En handling som ikke gjelder i tilstanden, står ikke (plassen lukkes, de andre flytter seg ikke
mellom plassene).

| Plass | Hode | Rad |
|---|---|---|
| 1 | Lagre, Avbryt | Åpne |
| 2 | **Hovedhandlingen for tilstanden** (tabellen under) | Samme hovedhandling |
| 3 | (bare modul) verktøyene for innhold: Generer innhold, Be om endring, Generer spørsmål — se spørsmål 3 | – |
| 4 | **«Mer»**, alltid, med fast rekkefølge: Døp om (bare rad) · Dupliser · Eksporter · Ta inn fra fil · Forkast utkast · Avpubliser · Arkiver / Gjenopprett · Slett | Samme «Mer» |

Hovedhandlingen:

| Tilstand | Hovedhandling | Under «Mer» i tillegg |
|---|---|---|
| Aldri publisert | Publiser | – |
| Publisert | (ingen) | Avpubliser |
| Publisert med utkast | Publiser utkastet (modul og seksjon: «Publiser ny versjon» → samme ord, se #1179) | Forkast utkast, Avpubliser |
| Avpublisert | Publiser | – |
| Arkivert | Gjenopprett | Slett |
| Ikke eier | (ingen) | Dupliser, Eksporter; merket «Kun for eier» står ved siden av |

Navn: **«Ta inn fra fil»** for «Importer» (modulens hode) og «Erstatt fra fil» (seksjonens hode) — eller «Erstatt fra fil» for
begge (se spørsmål 5). **«Slett»** overalt («Slett seksjon» viker). Klassen får «Åpne» også for ikke-eier (lesing).

Hvorfor «Avpubliser» under «Mer»: den tar noe bort fra deltakerne og er sjelden. Hovedplassen er for det som fører arbeidet
videre.

Nytt for kurs: **Dupliser** (rad og hode, se spørsmål 2) og **Døp om** (rad). «Publiser utkastet» også i lista.
Nytt for modul: **Arkiver** og **Dupliser** i hodet, **Publiser** i lista.
Nytt for seksjon: **Slett** i lista (arkivert), **Dupliser** i hodet.

### Merkene (#1171)

- **Ett ord per tilstand**, felles merke (`lifecycleBadge`) overalt: «Utkast», «Publisert», «Arkivert», og brikken «Nyere
  utkast». «Arbeidsutkast», «Live» og «Live + utkast» viker. Modulens versjonsliste: «Publisert» og «Åpen».
- **Versjonen som egen brikke ved siden av merket**, likt for kurs, modul og seksjon («v3.2», «v2.1», «v5»), og **ingen brikke
  før første publisering** (et kurs som aldri er publisert, viser ikke «v1.0»; en seksjon ikke «v1»).
- **Én form** for merket (den i `shared.css`); modullistas lokale pille viker.
- **«Alt lagret» bare når noe er lagret.** En ny side som ikke er lagret, viser ingenting der (eller «Ikke lagret ennå», se
  prototypen). Modulens «Ulagrede endringer» etter første lagring rettes (feil).

### Skiver

1. **Merkene og «Alt lagret»** (#1171): ord, versjonsbrikke, form, feilen i modulen. Bare klient.
2. **Hodene** (#1169): regelen i `form-page.js` (fast «Mer»), og hver sides liste over handlinger med plass.
3. **Radene** (#1169): samme regel i `list-page.js`; Publiser i modullista, Slett i seksjonslista, Åpne for klasser.
4. **Dupliser og Døp om for kurs**, og Dupliser/Arkiver i hodene der de mangler. «Dupliser kurs» trenger en rute hvis kopien
   skal ha de samme elementene.
5. Det mindre fra #1171: meldingene som legger seg over knappene på 1280 px, kursbyggerens visning av om elementene er
   publisert, «?»-hjelp på tema-siden, og fanen en ny modul åpner på (spørsmål 4).

Prototype før skive 2 og 3: de fire hodene og radene i hver tilstand, på 1280 og 390 px, som den ekte siden (som for #1162
skive 5).

## 3. Det som berøres

- Felles: `row-actions.js` (regelen), `form-page.js`, `list-page.js`, `content-status-badge.js`, `shared.css`.
- Sidene: `admin-content-courses.js`, `admin-content-shell.js` (+ `-shell-state.js`, `-settings-tab.js`), `admin-content-library.js`
  (+ `.html`), `admin-content-sections.js`, `admin-content-classes.js`, i18n i tre språk.
- Testene som fester dagens handlinger og merker (listen i kartleggingen): blant annet `admin-content-readonly-others-1165`,
  `admin-content-archived-readonly-1151`, `section-publish-new-version-1095`, `module-version-number-934-5b`,
  `admin-content-module-header-newer-draft`, `admin-content-module-library` (fanen), `list-fits-frame-1084`,
  `row-more-last-row-1081`, og DOM-/enhetstestene for `form-page`, `list-page`, `row-actions` og `content-status-badge`.

## 4. Det produkteier må avgjøre

1. **Fast «Mer» i alle hoder og rader**, også når det bare er én eller to handlinger der? (Anbefalt ja: samme sted hver gang.
   Mot: ett klikk mer for Eksporter og Arkiver.)
2. **Hva «Dupliser kurs» tar med.** (a) Et nytt kurs med **de samme** modulene og seksjonene (anbefalt: innholdet deles
   mellom kurs i dag, og en endring i en modul skal gjelde begge kurs), eller (b) **kopier** av alle modulene og seksjonene
   (det dagens eksport → import gir). Ingen av dem tar med klasser, tildelinger eller kursbevis.
3. **Modulens innholdsverktøy** (Generer innhold, Be om endring, Generer spørsmål): synlige i hodet etter hovedhandlingen
   (anbefalt: det er måten man arbeider med en modul på), eller under «Mer».
4. **Ny modul åpner på Innstillinger** (navn, type og nivå først), de andre på Rediger. Beholde (anbefalt: modulen trenger
   typen før innholdet kan lages), eller Rediger som de andre?
5. **Navnet på å hente innhold fra fil i hodet:** «Erstatt fra fil» for både modul og seksjon (anbefalt: sier hva som skjer),
   eller «Ta inn fra fil».
