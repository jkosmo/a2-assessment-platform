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
3. **Participant flow-gating:** karakteriser gate-state for hver modus (FREETEXT_PLUS_MCQ / MCQ_ONLY
   / FREETEXT_ONLY) — i dag kun indirekte. *(gjenstår)*
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
