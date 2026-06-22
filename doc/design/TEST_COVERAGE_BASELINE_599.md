# Testdekning-baseline (#599) — utkast

> Discovery-artefakt for EPIC #595. Formål: fastslå hva som er vernet **før** refactoring
> (#596 single source of truth, #598 frontend-oppdeling) starter, og peke ut hullene som må
> tettes med karakteriserings-tester først. Måler dagens tilstand — ikke ønsket fremtid.

## 1. Testinventar per lag

| Lag | Antall | Harness | Krever DB | Vurdering |
|-----|--------|---------|-----------|-----------|
| **unit** (`test/unit/`) | 58 filer | vitest | nei | Sterk på server-logikk + rene funksjoner |
| **integration** (`test/*.test.*`) | 58 filer | vitest + Postgres | **ja** (pretest) | Sterk på server-flyt (m1/m2-suiter) |
| **dom** (`test/dom/`) | 2 filer | vitest + jsdom | nei | Kun statisk HTML-/a11y-kontrakt, ikke atferd |
| **e2e** (`test/e2e/`) | 6 specs / 44 tester | Playwright + statisk server | nei | Eneste atferds-vern for klient-laget |

## 2. Hvor dekningen er sterk vs. tynn

**Sterk:** server-laget. `src/modules/*` har bred unit + integration-dekning (assessment-pipeline,
admin-content-publisering, calibration, appeals, source-material-extract, SSRF/crawl-logikk).

**Tynn — og det er her buggene bor:** klient-laget. Tre monolitter utgjør ~16 000 linjer:

| Fil | Linjer | Direkte test-hjem i dag |
|-----|--------|--------------------------|
| `public/admin-content.js` (avansert editor) | 5 176 | kun e2e |
| `public/static/admin-content-shell.js` (Samtale) | 4 672 | kun e2e |
| `public/participant.js` | 3 107 | kun e2e |

**Strukturell rotårsak:** klient-funksjonene (`renderResultSummary`, `deriveParticipantFlowGateState`,
`selectedModuleIsFreetextOnly`, modultype-synlighet …) er ikke eksportert/importerbare. De kan
derfor **ikke** unit-testes — eneste vern er full e2e. Dette er både hvorfor karakterisering nå må
skje i e2e, **og** et selvstendig argument for #598 (ekstraher rene funksjoner → billig unit-test).

## 3. Flate → test-mapping (høyrisiko-flater for refactoring)

| Flate | e2e/dom-dekning | Status |
|-------|-----------------|--------|
| Filgrense/opplasting | `admin-content-workspaces`, `section-editor` | ✅ (regresjons-e2e lagt til 1.3.51) |
| Modul-opprettelse (Samtale) | `admin-content-workspaces` | ✅ (men kun «Samtale»-inngang; biblioteks-dialog #348?) |
| Modultype-velger (3-veis) | `admin-content-workspaces` | ✅ |
| MCQ_ONLY (forfatter + deltaker) | `admin-content-workspaces`, `participant-mcq-only` | ✅ |
| FREETEXT_ONLY (forfatter + deltaker) | `admin-content-workspaces`, `participant-mcq-only` | ⚠️ delvis (resultat-rad revertert som ikke-deterministisk) |
| Skåre-visning per modus (#591) | `participant-mcq-only` | ⚠️ kun MCQ-grenen deterministisk; fritekst-grenen udekket |
| Kursbevis (3 visninger) | `participant-certificate`, `profile-certificate-link` | ✅ (resultat-banner-visningen?) |
| Læringsseksjon | `participant-section-reader`, `section-editor`, m.fl. | ✅ |
| **Enkelt-URL-henting (fetch-url, #454)** | **INGEN** | ❌ klient fetch-lag uten e2e |
| **Crawl (Slice B, #479)** | (i #593-branch, ikke på main ennå) | 🔜 lander med #593 |
| **Participant flow-gating** | indirekte via `participant-mcq-only` | ⚠️ ingen direkte test av gate-state-logikken |

## 4. Konkrete hull å tette før refactoring

1. ✅ **`fetch-url` (enkelt-URL-henting):** TETTET — karakteriserings-e2e lagt til
   (`admin-content-workspaces`: «fetches a single URL and adds a source chip»).
2. ✅ **Skåre-visning, FREETEXT_ONLY-grenen:** TETTET — deterministisk e2e via `#checkResult` med
   `autoStartAfterMcq=false` (`participant-mcq-only`: «FREETEXT_ONLY result hides the MCQ score
   row»). Begge grener av `renderResultSummary` er nå pinnet.
3. ✅ **Participant flow-gating:** ALLEREDE DEKKET — korrigert funn. `deriveParticipantFlowGateState`
   er en *importerbar* ren funksjon i `public/participant-console-state.js` (ikke begravd i
   monolitten) og er unit-testet i `test/participant-console-state.test.js` (initial/afterMcq/
   completed + `requiresMcq:false`-grenen). Ingen ny test nødvendig.
   - ✅ `renderResultSummary`-triaden er nå komplett: MCQ_ONLY (skjul praktisk), FREETEXT_ONLY
     (skjul MCQ) og **FREETEXT_PLUS_MCQ** (vis begge) er alle pinnet i `participant-mcq-only.spec.ts`.
4. **Modul-opprettelse, biblioteks-inngangen (#348):** verifiser at e2e dekker *begge* innganger
   (Samtale-idle + biblioteks-dialog), ikke bare Samtale. *(gjenstår)*
5. **Kvantitativ server-baseline:** installer `@vitest/coverage-v8` og fest et tall på `src/modules/*`
   som `verify` håndhever (gate: «ikke under baseline» på berørte moduler). *(gjenstår)*
6. ✅ **Synk-vakt for opplastings-body-grense:** TETTET — `source-material-extraction-service`-testen
   asserterer at `SOURCE_MATERIAL_UPLOAD_BODY_LIMIT_BYTES` alltid rommer en maks-fil base64 (mønster
   for #596).

## 5. Anbefalt rekkefølge for #599

1. Legg til coverage-provider → kvantitativ server-baseline + rapport.
2. Skriv karakteriserings-e2e for hullene i §4 (1–4) — pinner *dagens* oppførsel.
3. Innfør dekningsgate i `verify` på modulene #596/#598 vil røre.
4. Først da: løft blokkeringen på #596 og #598.

## 6. Notater

- Integration-suiten krever Docker/Postgres lokalt (pretest). For rask iterasjon under #599 er
  unit + dom + e2e (alle DB-frie) det effektive arbeidssettet; integration verifiseres i CI (`verify`,
  fersk DB).
- Crawl-e2e og enkelt-URL-e2e bør samles når #593 merges, så `fetch-url`-hullet tettes samtidig.

## 7. Kvantitativ baseline (unit-only) — 2026-06-22

Provider `@vitest/coverage-v8@2.1.9` (matcher vitest `^2.1.x`) lagt til som devDependency.
Coverage er aktivert **kun** i `vitest.unit.config.ts` (provider `v8`, reporter `text` +
`json-summary`, `include: ["src/**/*.ts"]`, ekskluderer `*.d.ts`, `src/scripts/**`, `test/**`,
`scripts/**`). Integration/dom-konfigene er bevisst urørt.

Kjørt DB-fritt med `dotenv -e .env.test -- vitest run --config vitest.unit.config.ts --coverage`
(397 unit-tester, alle grønne). **Dette er unit-only-baselinen** — integration-suiten dekker en
betydelig del av repository-/rute-laget som her står lavt, og måles separat i CI.

### Total (kun unit, hele `src/**/*.ts`)

| Metrikk | % | Dekket / Totalt |
|---------|---|-----------------|
| **Lines** | **44.6 %** | 7614 / 17075 |
| **Statements** | 44.6 % | 7614 / 17075 |
| **Functions** | 48.8 % | 333 / 682 |
| **Branches** | 71.7 % | 1300 / 1813 |

(Den lave linjedekningen totalt drives av `src/routes/**` ~5–37 % og `src/repositories/**`
~5–73 % — begge i hovedsak verifisert gjennom integration-suiten, ikke unit.)

### Per `src/modules/*` (refactoring-relevant — det #596/#598 vil røre)

| Modul | Lines | Branches | Functions |
|-------|-------|----------|-----------|
| adminContent | 49.1 % (1966/4001) | 69.4 % (430/620) | 45.0 % (86/191) |
| appeal | 51.5 % (423/822) | 75.2 % (76/101) | 55.8 % (24/43) |
| **assessment** | **64.8 % (1318/2033)** | **83.1 % (304/366)** | 59.6 % (65/109) |
| calibration | 66.3 % (228/344) | 70.9 % (56/79) | 72.7 % (8/11) |
| certification | 39.0 % (252/646) | 76.5 % (39/51) | 66.7 % (10/15) |
| course | 12.7 % (109/858) | 83.9 % (26/31) | 16.4 % (9/55) |
| module | 18.2 % (33/181) | 80.0 % (8/10) | 44.4 % (4/9) |
| orgSync | 95.9 % (139/145) | 63.0 % (17/27) | 100 % (3/3) |
| platformConfig | 12.6 % (12/95) | 100 % (0/0) | 0 % (0/11) |
| reporting | 28.8 % (255/885) | 66.7 % (66/99) | 32.0 % (8/25) |
| retention | 86.3 % (63/73) | 76.5 % (13/17) | 90.9 % (10/11) |
| review | 48.6 % (227/467) | 60.5 % (26/43) | 45.0 % (9/20) |
| submission | 52.6 % (162/308) | 46.8 % (22/47) | 50.0 % (10/20) |
| user | 96.8 % (274/283) | 92.5 % (49/53) | 95.7 % (22/23) |

**Lesning:** Den rene assessment-/policy-kjernen (`assessment` 64.8 % linjer / 83.1 % grener,
`user` 96.8 %, `retention` 86.3 %, `orgSync` 95.9 %) er solid unit-vernet. Lave moduler
(`course`, `module`, `platformConfig`, `reporting`, `certification`) er i hovedsak rute-/repo-tunge
og dekkes av integration; ekte unit-hull bør tettes med karakteriseringstester *før* #596/#598 rører
dem.

### Anbefalt terskel (ennå ikke håndhevet)

Ingen CI-gate innføres i denne PR-en — kun måling. Anbefalt neste steg (§5 pkt. 3): per-modul
`verify`-gate «ikke under baseline» på modulene #596/#598 faktisk rører, med konkrete startverdier:

- `src/modules/assessment`: lines ≥ 64 %, branches ≥ 83 %.
- `src/modules/user`: lines ≥ 96 %, branches ≥ 92 %.
- Øvrige berørte moduler: frys på dagens tall over (avrundet ned til nærmeste hele %) og krev
  «ikke synkende». Hev terskelen etter hvert som karakteriseringstester lander.

Gaten bør kjøre på **kombinert** unit + integration coverage i CI (fersk DB), ikke unit alene —
ellers straffes rute-/repo-tunge moduler urettferdig.
