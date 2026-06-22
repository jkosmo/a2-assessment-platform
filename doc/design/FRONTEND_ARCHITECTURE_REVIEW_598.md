# Frontend-arkitekturgjennomgang + inkrementell oppdelingsplan (#598)

> Design-/plan-artefakt for EPIC #595. **Dette dokumentet endrer ingen produksjonskode.** Den
> faktiske refactoren er bevisst utsatt — blokkert på #599 (dekningsnett) — og denne planen er
> det som skal styre den. Analysen er forankret i den faktiske koden lest 2026-06-22; filhenvisninger
> er på formen `fil:linje`.
>
> Søsterdokument: `doc/design/TEST_COVERAGE_BASELINE_599.md` (hva som er vernet **før** refactoring).
> Stående ordrer i `CLAUDE.md`: «Map the full UI surface before building/fixing» og «Tests are
> written WITH the feature».

---

## 1. Dagens tilstand — inventar per monolitt

Klient-laget er vanilla-JS ES-moduler lastet direkte som `<script type="module">` fra statiske
HTML-sider (ingen bundler, ingen rammeverk). Tre filer dominerer (~13 000 linjer), men problemet er
bredere enn de tre — se §2.

### 1.1 `public/participant.js` — 3 107 linjer

- **Wiring:** `public/participant.html:233` (`<script src="/static/participant.js" type="module">`),
  etter i18n-bundle `participant-translations.js:232`.
- **Allerede importerte seams:** modulen importerer fra `participant-console-state.js`
  (`participant.js:7–17`), `api-client.js`, `consent-guard.js`, `loading.js`, `toast.js`,
  `dom-visibility.js`. Dette er presedens-mønsteret vi skal følge.
- **Eid tilstand (modul-globale `let`):** `currentLocale`, `currentQuestions`, `latestResult`,
  `latestHistory`, `latestAppeal`, `flowState`, `loadedModules`, `selectedModuleId`,
  `participantRuntimeConfig`, `roleSwitchState`, `autosaveTimer`, auto-assessment-poll-tilstand
  (`autoAssessmentTicker`/`...SubmissionId`/`...ElapsedSeconds`/`...NextPollInSeconds`/
  `...RequestInFlight`), `currentSubmissionFields`, kurs-tilstand (`participantCourses`,
  `participantCompletions`, `courseDetailCache`) — se `participant.js:89–156, 2831–2838`. I tillegg
  ~70 `const`-bindinger til DOM-noder (`participant.js:19–78`).
- **Bruker-flater som bor i denne ene filen:** modul-liste/-velger, innleverings-skjema (fritekst),
  MCQ-besvarelse, flow-gating (lås/opplås assessment/check/appeal), auto-assessment-polling,
  resultatvisning + skåre-rader (`renderResultSummary`), historikk, anke (appeal), kladd-autosave
  (drafts), preview-modus (forfatter-forhåndsvisning), kurs-akkordeon + læringsseksjon-leser,
  rolle-preset-velger, locale-velger, workspace-nav.
- **«Incomplete surface»-tette områder:** ~37 `localize*`/`render*`/`format*`/`moduleIs*`/`derive*`-
  funksjoner (`participant.js`). De fleste blander ren beslutningslogikk med DOM-mutasjon — se §3.

### 1.2 `public/static/admin-content-shell.js` — 4 733 linjer (Samtale-redigereren)

- **Wiring:** `public/admin-content.html:422`.
- **Allerede importerte seams (sterkest av de tre):** `admin-content-shell-state.js`,
  `module-status-logic.js`, `admin-content-preview.js`, `admin-content-blueprint-hash.js`,
  `admin-content-handoff.js`, `workspace-nav.js`, m.fl. (`admin-content-shell.js:1–31`). Mye av
  «courses»/«sections»/«library»/«calibration» er allerede splittet ut i egne `static/`-moduler.
- **Eid tilstand:** `sessionState` (idle/…), `modules`, `selectedModuleId`, `bundle`, `sessionDraft`,
  `previewDraft`, `chatLog`, `currentBlueprintHash`, `criteriaGenerationInFlight`,
  `criteriaReadyCallback`, `generationAbort` (AbortController), `activeUserRoles`,
  `participantRuntimeConfig`, `announcerResetHandle` — se `admin-content-shell.js:40–227`.
- **Flater:** samtale-/chat-drevet modulgenerering, blueprint-redigering (kriterier), drift-banner
  (lagret vs. live), forhåndsvisning per locale, MCQ-redigering, locale-propagering av oversettelser,
  ekstern-LLM-handoff.
- **Pure-ish funksjoner som ennå bor i monolitten:** `buildLocalizedTextMap`,
  `normalizeModuleTitlePatch`, `buildLocalizedMcqDraft`, `resolveDriftState`,
  `buildPreviewCandidate`, `computeCriteriaDiff`, `buildCriteriaRecordFromEditorState`,
  `resolveChoiceLabel` (`admin-content-shell.js:1256–1471, 2705, 2883, 327`). 143 funksjoner totalt.

### 1.3 `public/admin-content.js` — 5 176 linjer (Avansert editor)

- **Wiring:** `public/admin-content-advanced.html:1092`.
- **Eid tilstand:** `currentLocale`, `modules`, `selectedModuleId`, `activeContentTab`,
  `activeModuleStartMode`, `selectedModuleStatus`, `editorBaselineSnapshot`,
  `latestCalibrationWorkspaceBody`, `participantRuntimeConfig`, `roleSwitchState`, `dirtyCards` (Set),
  `advPreviewLocale`/`advPreviewOpen`, MCQ-/submission-felt-tellere, kurs-tilstand
  (`courses`, `courseDialogModules`, `editingCourseId`) — se `admin-content.js:431–474, 4804–4807`.
- **Flater:** full modul-CRUD-editor, blueprint/kriterier, terskler, MCQ-redigering,
  submission-schema-redigering, modul-status/-publisering, kalibrerings-workspace, kurs-CRUD,
  forhåndsvisning, dirty-state-sporing.
- **Pure-ish funksjoner i monolitten:** `buildAuthoringPrompt`, `deriveModuleStatusView`,
  `buildEditorSnapshotFromDraft`, `buildParticipantPreviewPayload`, `formatNumber`,
  `localizeSubmissionStatus`, `buildDefaultSubmissionField`, `formatDateInputValue`/`...TimeValue`
  (`admin-content.js:167, 1116, 1026, 1366, 4342, 4353, 2458, 947, 960`). 157 funksjoner totalt.

### 1.4 De mindre filene (samme klasse, mindre volum)

| Fil | Linjer | Wiring | Flate |
|-----|--------|--------|-------|
| `public/review.js` | 1 690 | `review.html:284` | Manuell vurdering + anke-kø (REVIEWER/APPEAL_HANDLER) |
| `public/calibration.js` | 745 | `calibration.html:190` | Kalibreringsdashboard |
| `public/results.js` | 688 | `results.html:201` | Rapporter/pass-rater/CSV-eksport |
| `public/profile.js` | 657 | `profile.html:173` | Deltakerprofil, moduler, kurs, datasletting |
| `public/participant-completed.js` | — | `participant-completed.html` | Fullførte moduler/kursbevis |

### 1.5 Allerede-etablerte delte moduler (mønsteret å følge)

- `public/participant-console-state.js` (304 l, **unit-testet** i `test/participant-console-state.test.js`)
  — rene funksjoner: `deriveParticipantFlowGateState`, `buildModuleCardViewModels`,
  `resolveRoleSwitchState`, `resolveWorkspaceNavigationItems`, draft-helpers …
- `public/static/module-status-logic.js` (163 l, unit-testet) — eksplisitt «DOM-free, importable in
  both browser and Node.js» (`module-status-logic.js:1–10`).
- `public/static/dom-visibility.js` — `setHidden` (løser `.hidden`/display-klasse-fellen).
- `public/static/admin-content-shell-state.js`, `admin-content-courses-state.js` — unit-testet.
- `public/static/workspace-nav.js` — `renderWorkspaceNavigationWithProfile`.

**Konklusjon:** mønsteret finnes og er bevist. Refactoren er å *utvide* det, ikke å oppfinne det.

---

## 2. Kjerneproblemet, presist

Den tilbakevendende bug-klassen er **«correct fix, incomplete surface»** (`CLAUDE.md`: 6 bugger over
5 deploys 1.3.37→1.3.42). To strukturelle årsaker, begge synlige i koden over:

**(A) Samlokaliserte flater i én fil.** En atferd (f.eks. skåre-rad-synlighet, modultype-gating,
locale-fallback) finnes i flere kodestier i samme monolitt — og ofte *også* i en søsterfil. Et fiks
i én sti lar søsterstien stå igjen og produserer neste bug.

**(B) Ren logikk er ikke importerbar.** Beslutningene er bakt inn i `render*`-funksjoner som muterer
DOM. Eksempel `renderResultSummary` (`participant.js:2157`): den **pure** beslutningen «hvilke
skåre-rader skal vises for denne modultypen» (`!selectedModuleIsFreetextOnly()` /
`!selectedModuleIsMcqOnly()`, `participant.js:2188–2192`) er flettet sammen med `appendSummaryRow`/
`document.createElement`. Fordi funksjonen rører DOM kan den **kun** testes via full Playwright-e2e.
Det er dyrt, tregt og fanger ikke grenkombinasjonene — derfor karakteriseres dagens oppførsel nå i
e2e (#599 §4) i stedet for i unit.

**(C) Massiv kopi-duplisering av delte helpers** — den mest direkte driveren av (A) på tvers av
filer. Verifisert med grep:

| Helper | Antall kopier | Hvor (utvalg) |
|--------|---------------|----------------|
| `renderWorkspaceNavigation` | **14 filer** | participant, admin-content, profile, review, results, calibration, shell, courses, library, sections, … |
| `resolveInitialLocale` | **9 filer** | participant, admin-content, profile, review, results, calibration, certificate, admin-platform, participant-completed |
| `localizeContentValue`/`localizeValue` | **8 filer** | admin-content, calibration, participant, profile, results, shell, admin-content-calibration, … |
| `formatNumber` | **7 filer** | participant, admin-content, calibration, profile, review, participant-completed, admin-content-calibration |
| `escapeHtml` (+ variantnavn `escapeHtmlP`/`escapeHtmlR`/`escapeHtmlC`) | **10 filer** | participant.js:2840, results.js:524, participant-completed.js:512, admin-content.js:4869, shell:213, preview, library, courses, sections, loading |

`escapeHtml` med fem ulike navn (`escapeHtml`, `escapeHtmlP`, `escapeHtmlR`, `escapeHtmlC`) er den
reneste illustrasjonen: en HTML-eskaperings-fiks i én må manuelt speiles til ni andre, ellers står
en XSS-/visnings-bug igjen i de uberørte. Dette er bug-klasse (A) i sin enkleste form.

**Effekt:** klient-laget (~16 000 linjer) har i praksis **kun e2e som atferdsvern**
(`TEST_COVERAGE_BASELINE_599.md` §1–2). Ren logikk som *kunne* vært unit-testet på millisekunder er
fanget bak DOM.

---

## 3. Foreslåtte seams — prioritert liste over rene moduler å ekstrahere

Prinsipp (fra presedensen): **én ren funksjon flyttes ut, eksporteres, får unit-test, og monolitten
importerer den tilbake.** Ingen atferdsendring. Hver seam gjør en hittil e2e-only beslutning billig
unit-testbar.

Prioritet = (bug-frekvens i flaten) × (antall samlokaliserte kopier) ÷ (ekstraherings-risiko).

### P1 — Delte presentasjons-primitiver (høyest verdi: dreper duplikat-klassen direkte)

| Område / funksjon | Foreslått modul | Hvorfor først |
|-------------------|-----------------|----------------|
| `escapeHtml` (×10, 5 navn) | `public/static/html-escape.js` | Triviell, ren, sikkerhetsrelevant; én sannhet fjerner 9 søsterkopier |
| `formatNumber`, `formatDateTime`, `formatDate`, `pct`, `formatScore` (×7) | `public/static/format-display.js` | Rene, locale-uavhengige; én test pinner avrunding/format |
| `resolveInitialLocale`, `t`/`tForLocale`-fallback-kjede, `localizeContentValue`/`localizeValue`, `isLocaleObject` (×8–9) | `public/static/i18n-resolve.js` | i18n-resolusjon er nøyaktig laget `CLAUDE.md` flagger som e2e-usynlig; ren gitt `(translations, locale, key)` |

> Merk: `t` selv leser modul-global `currentLocale`. Ekstraher den **rene** kjernen
> `resolveTranslation(translations, locale, key)`; behold en tynn `t(key)`-wrapper i hver fil som
> sender inn `currentLocale`. Dette er nøyaktig `tForLocale`-formen som allerede finnes
> (`participant.js:185`).

### P2 — Deltaker-resultat/gating-beslutninger (høyest bug-historikk)

| Område / funksjon | Foreslått modul | Enables |
|-------------------|-----------------|---------|
| Skåre-rad-synlighet pr. modustype (`moduleIsMcqOnly`/`moduleIsFreetextOnly` + hvilke rader vises i `renderResultSummary`, `participant.js:504–522, 2188–2192`) | utvid `participant-console-state.js` med f.eks. `deriveResultRowVisibility(module, scoreComponents)` | unit-test for #591-regelen (i dag kun delvis e2e-pinnet, `TEST_COVERAGE_BASELINE_599.md` §3) |
| `deriveAssessmentProgressKeyFromSubmissionStatus` (`participant.js:1947`) | `participant-console-state.js` | ren status→i18n-nøkkel-mapping; trivielt testbar |
| `outcomeClass`, `localizeDecisionType`, `localizeStatusExplanation`, `localizeKnownContent`/`localizeDecisionReason`/`localizeConfidence`/`localizeImprovementAdvice`/`localizeCriterionName`/`...Rationale` (`participant.js:1755–1947`) | `public/static/participant-result-localize.js` (tar `t` som arg) | hele resultat-tekstkjeden — i dag kun via e2e |
| `summarizeParticipantResponse`, `inferParticipantToastType`, `formatOutputStatus`/`...Detail` (`participant.js:385–457`) | samme modul | debug/output-visning |

### P3 — Forfatter (Samtale + Avansert) delte beslutninger

| Område / funksjon | Foreslått modul | Enables |
|-------------------|-----------------|---------|
| `buildLocalizedTextMap`, `normalizeModuleTitlePatch`, `buildLocalizedMcqDraft`, `resolveChoiceLabel` (`admin-content-shell.js:1256–1392, 327`) | `public/static/admin-content-localize.js` | locale-propagering av oversettelser (`feedback_teacher_locale_control`) |
| `resolveDriftState`, `computeCriteriaDiff`, `buildCriteriaRecordFromEditorState` (`admin-content-shell.js:1015, 2883, 2705`) | `public/static/admin-content-criteria.js` | drift-banner + kriterie-diff (delt mellom shell og advanced) |
| `buildAuthoringPrompt`, `buildEditorSnapshotFromDraft`, `deriveModuleStatusView`, `buildDefaultSubmissionField` (`admin-content.js:167, 1026, 1116, 2458`) | `public/static/admin-content-editor-state.js` | dirty/baseline + prompt-bygging |

> Mange shell-funksjoner er **allerede** halvveis ekstrahert (`admin-content-preview.js`,
> `module-status-logic.js`). P3 fyller hullene og konsoliderer der shell og advanced har divergerende
> kopier av samme beslutning (klassisk (A)).

### Ikke seams (forblir i monolitten)

DOM-rendering (`appendSummaryRow`, `createSummaryCard`, `document.createElement`-tunge `render*`),
event-binding, `fetch`-orkestrering, modul-global tilstand. Disse beholdes som tynne «view»-lag som
**kaller** de utvunne rene funksjonene. Mål: render-funksjonen blir et stativ rundt en ren beslutning.

---

## 4. Inkrementell migreringsplan (skive for skive)

Ikke et big-bang-rewrite. Hver skive: (a) flytt ÉN gruppe rene funksjoner til ny `static/`-modul,
(b) eksporter, (c) skriv unit-test (vitest, DB-fri), (d) la monolitten(e) importere tilbake og slette
sine lokale kopier, (e) `npx tsc --noEmit` + `npx vitest run` grønt, (f) e2e for berørt flate grønt
lokalt, (g) version-bump, (h) egen PR. Rekkefølge etter risiko/verdi (lavest risiko først):

**Skive 1 — `html-escape.js` (start her).** Lavest risiko, høyest duplikat-utbytte. Ny modul med
`escapeHtml(str)`. Erstatt de 10 kopiene (inkl. `escapeHtmlP`/`escapeHtmlR`/`escapeHtmlC`) med import.
Unit-test: kjente farlige strenger (`<`, `>`, `&`, `"`, `'`) + ikke-streng-input. Ren, ingen
tilstand, ingen locale — perfekt første kutt og umiddelbart bevis på mønsteret. **En implementerer
kan starte her direkte.**

**Skive 2 — `format-display.js`.** `formatNumber`/`formatDateTime`/`formatDate`/`pct`/`formatScore`.
Unit-test avrunding, `null`/`undefined`, ugyldige datoer. 7 kopier konsolideres.

**Skive 3 — `i18n-resolve.js`.** Ren `resolveTranslation(translations, locale, key)` +
`localizeContentValue(value, locale)` + `isLocaleObject`. Behold tynne `t`-wrappere i hver fil. Test
fallback-kjeden (`locale → en-GB → key`) eksplisitt — dette er «raw i18n key»-bug-klassen fra
`CLAUDE.md`.

**Skive 4 — deltaker-resultat-lokalisering (`participant-result-localize.js`).** Flytt `localize*`/
`outcomeClass`/`localizeDecisionType` (P2). `renderResultSummary` beholder DOM, men kaller rene fns.
Test alle decision/confidence/criterion-grener — i dag e2e-only.

**Skive 5 — skåre-rad-/gating-beslutninger inn i `participant-console-state.js`.** `deriveResultRowVisibility` +
`deriveAssessmentProgressKeyFromSubmissionStatus`. Utvider den allerede-testede modulen (lavest
friksjon — testfilen finnes). Pinner #591-regelen i unit i stedet for delvis e2e.

**Skive 6 — forfatter-lokalisering (`admin-content-localize.js`, P3).** Konsolider divergerende
shell/advanced-kopier av locale-propagering.

**Skive 7 — forfatter-kriterier/drift (`admin-content-criteria.js`, P3).** `computeCriteriaDiff`/
`resolveDriftState`/`buildCriteriaRecordFromEditorState`.

**Skive 8 — forfatter-editor-state (`admin-content-editor-state.js`, P3).** `buildAuthoringPrompt`/
`deriveModuleStatusView`/baseline-snapshot.

Stopp-punkt: etter hver skive er repoet i en utgivbar, grønn tilstand. Planen kan pauses når som
helst uten halvferdig refactor.

---

## 5. Eksplisitte non-goals

1. **Ingen atferdsendring.** Hver skive er ren ekstraksjon: samme output, nå importerbar + testet.
   Karakteriserings-testene fra #599 må forbli grønne uendret.
2. **Intet rammeverk** (React/Vue/Svelte/web components/bundler) introduseres som del av denne
   planen. Det ville være et separat, begrunnet forslag — ikke smuglet inn via en «opprydding».
   Vanilla ES-moduler + vitest er allerede tilstrekkelig for å gjøre logikk testbar.
3. **Ikke skriv om alt på én gang.** Monolittene forblir monolitter som «view»-lag; vi tømmer dem for
   *ren* logikk over tid, ikke i én PR.
4. **Ikke flytt DOM-rendering, event-binding eller `fetch`-orkestrering** i denne omgang — kun rene,
   side-effekt-frie beslutninger.
5. **Ingen omdøping/omstrukturering av DOM-id-er eller i18n-nøkler** (det ville bryte e2e-vernet).

---

## 6. Avhengigheter og sekvensering

- **Blokkert på #599 (dekningsnett).** Refactoren starter ikke før karakteriserings-e2e for høyrisiko-
  flatene er på plass (`TEST_COVERAGE_BASELINE_599.md` §4–5). Begrunnelse: en ekstraksjon uten
  atferdsendring krever et atferdsvern *før* kuttet for å bevise «ingen endring». #599 §4-hullene
  (bl.a. biblioteks-inngangen #348, kvantitativ server-baseline) bør være tettet for flatene en skive
  rører.
- **Informert av #597 (feature surface map).** «Map the full UI surface»-ordren betyr at hver skive
  må liste *alle* kopier/innganger av funksjonen den flytter (grep-tabellene i §2/§3 er startpunktet)
  og fjerne dem alle i samme PR — ellers reproduserer vi (A).
- **Presedens å speile:** `participant-console-state.js` + `module-status-logic.js` (struktur,
  JSDoc-header «DOM-free, importable in Node.js», tilhørende `test/*.test.js`).
- **Per-skive gates (fra `CLAUDE.md` stående ordrer):** `tsc --noEmit` rent, `vitest run` uten nye
  feil, e2e for berørt flate grønt **lokalt** før deploy, version-bump + `doc/VERSIONS.md` i samme
  commit, og dokumentasjon oppdatert hvis API/route-flate endres (ekstraksjon endrer den normalt ikke).
- **Deploy-disiplin:** dette er kode-only endringer → `deploy-app.yml`. Maks én strukturell endring
  per deploy; én skive = én PR = én utgivelse.

---

## 7. Hvorfor dette fjerner bug-klassen

«Correct fix, incomplete surface» oppstår fordi beslutningen finnes i N kodestier og fikset treffer
1. Etter en skive finnes beslutningen i **én** eksportert funksjon med unit-test; alle flater
importerer den. Et fiks treffer da definisjonsvis hele flaten, og unit-testen fanger regresjon på
millisekunder uten deploy — i tråd med «bruk deploy-ventetid til å forbedre testdekning».
