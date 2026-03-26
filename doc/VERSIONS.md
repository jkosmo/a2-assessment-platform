# Versions

This document tracks release versions and what each version includes.

## Versioning Rules
- Use Semantic Versioning (`MAJOR.MINOR.PATCH`).
- Every push to remote must include a version bump.
- Every version bump must update this document.

## 0.9.71 - 2026-03-26

test/docs: sluttfør kursdekning og manuell verifikasjonspakke for #133
- la til integrasjonstest for admin-kursflyt: opprett, oppdater, modulrekkefølge, publisering og arkivering
- la til integrasjonstest for kursbevis-utstedelse og idempotens rundt `checkAndIssueCourseCompletions`
- utvidet workspace-/kontrakttester for kursflater i Admin Content og `/participant/completed`
- utvidet oversettelsestest for kursbevisnøkler
- la til manuell verifikasjonspakke i `doc/design/COURSE_133_MANUAL_VERIFICATION_2026-03-26.md`
- bumpet appversjon til `0.9.71` for ny deploy-kandidat

## 0.9.70 - 2026-03-26

feat: Kursoppfølging, dokumentasjon og CI-stabilisering for delt deploy-kandidat
- fullførte kursoppfølging i deltaker- og rapportflyt, inkludert bedre kursstatus og filtrering i resultater
- la til backlogg- og ferdigstillingsdokumentasjon for løsningsdesign og kurs-epic #133
- la til rolle-/workspace-dokumentasjon under `doc/roles/`
- stabiliserte `test/m2-reporting.test.ts` ved å isolere rapporttesten fra seed-data og delede MCQ-spørsmål
- bumpet appversjon til `0.9.70` slik at riktig deploy kan bekreftes i UI via `/version`

## 0.9.69 - 2026-03-25

feat: Kursbevis i deltaker-fullført-side og kursrapport i resultater (#282, #283)
- participant-completed.html: ny #courseCertSection for kursbevis
- participant-completed.js: renderCourseCertificates(), loadCourseCertificates() kalt automatisk ved lasting av fullførte moduler; henter fra GET /api/courses/completions
- participant-completed-translations.js: courseCert.* nøkler for en-GB/nb/nn
- results.html: ny seksjon "Kursgjennomføringsrapport" med tabell (#courseReportBody)
- results.js: renderCourseReport(), loadCourseReport() kalt automatisk via Last resultater-knappen; henter fra GET /api/reports/courses
- results-translations.js: results.courses.* nøkler for en-GB/nb/nn
- Backend for begge issues var allerede implementert: checkAndIssueCourseCompletions (review/appeal/assessment), getCourseReport, GET /api/courses/completions, GET /api/reports/courses

## 0.9.68 - 2026-03-25

fix: localizeContentValue håndterer JSON-kodet locale-streng i kurstittel

## 0.9.67 - 2026-03-25

feat: Deltaker UI for kursfremdrift (#281)
- participant.html: course accordion-seksjon over modulerlisten, CSS for accordion/progress/sertifikat
- participant.js: loadParticipantCourses(), renderParticipantCourseAccordion(), buildCourseAccordionItem(), lazy-load av kursdetaljer on expand, deep link via ?courseId=
- participant-translations.js: courses.* nøkler for en-GB/nb/nn

## 0.9.66 - 2026-03-25

feat: Admin UI for kursadministrasjon (#279)
- admin-content.html: Moduler/Kurs-fane, #coursesTab med kursliste og opprett-knapp, #dialogCourse med lokaliserte inputfelt og modulrekkefølge
- admin-content.js: aktiverTab(), loadCourses(), renderCourseList(), openCourseDialog(), saveCourseDialog(), modulrekkefølge-logikk
- admin-content-translations.js: adminContent.courses.* og adminContent.tab.* for en-GB/nb/nn
- adminCourses.ts: bruk localizedTextSchema + localizedTextCodec.serialize for title/description/certificationLevel

## 0.9.65 - 2026-03-25

feat: Kursbevis og kursrapportering (#282, #283)
- GET /api/courses/completions: deltakersiden henter sine CourseCompletion-poster
- GET /api/reports/courses: bestått-rate per kurs med moduldrilldown
- courseRepository: findUserCourseCompletions, countCourseCompletions, countDistinctEnrolledUsersForModules, countPassedUsersForModule, findPublishedCoursesWithModuleDetails
- src/modules/course/courseReport.ts: getCourseReport()

## 0.9.64 - 2026-03-25

feat: Admin-API og deltaker-API for kurs (#278, #280)
- src/routes/adminCourses.ts: POST/GET/PUT/archive/publish-endepunkter under /api/admin/content/courses
- src/routes/courses.ts: GET /api/courses og GET /api/courses/:courseId med fremdrift per bruker
- src/config/capabilities.ts: legg til courses-capability (alle roller)
- src/app.ts: mount coursesRouter
- src/routes/adminContent.ts: mount adminCoursesRouter under /courses
- courseRepository: legg til findUserCertificationStatusesForModules

## 0.9.63 - 2026-03-25

feat: Prisma-skjema og kursmodul for #277 (Course/CourseModule/CourseCompletion).
- prisma/schema.prisma: legg til Course, CourseModule, CourseCompletion; relasjon til Module og User
- prisma/migrations/20260325000002_add_course_models: SQL-migrasjon
- src/modules/course/: nytt modul med courseRepository, courseCommands, courseQueries, courseReadModels, courseCompletionService, index
- checkAndIssueCourseCompletions hookes inn i applyAssessmentDecision, manualReviewService og appealService
- auditEvents: course entity + created/published/archived/completionIssued actions
- operationalEvents: course.completionCheckFailed

## 0.9.62 - 2026-03-25

Refactor: harden runtime bootstrap og worker operability (#272, #273, #274).
- startup.mjs: fjern bootstrapSeed fra normal oppstartsbane; legg til npm run bootstrap:seed
- AppealSlaMonitor, PseudonymizationMonitor, AuditRetentionMonitor: legg til getStatus()
- src/index.ts: worker-heartbeat inkluderer now structured status for alle aktive loops
- OPERATIONS_RUNBOOK: oppdater startup-sekvens og dokumenter faktisk worker health-format
- Nye/oppdaterte enhetstester: appeal-sla-monitor.test.ts, worker-health.test.ts

## 0.9.61 - 2026-03-25

Docs: avled API/workspace-dokumentasjon fra capability contract (#269).
- API_REFERENCE.md: ny "Source of truth"-seksjon peker til API_ROUTE_CAPABILITIES; kalibrerings-unntaket er eksplisitt dokumentert
- GETTING_STARTED.md: workspace-notis oppdatert med eksplisitt referanse til capabilities.ts og kalibrerings-unntaket
- Ingen atferdsendring

## 0.9.60 - 2026-03-25

Refactor: gjør kalibrerings-tilgangen eksplisitt som contract override (#271).
- capabilities.ts: utvidet blokkkommentar beskriver calibration som eneste runtime-konfigurerbare unntak
- app.ts: kommentar ved /api/calibration-registrering forklarer at rolesFor() ikke brukes her
- participantConsole.ts: kommentar ved buildWorkspaceNavigationItems refererer til capabilities.ts
- Ingen atferdsendring; tsc --noEmit ren

## 0.9.59 - 2026-03-25

Docs: fjern maskinspesifikke lenker og rett startup-beskrivelse i runbooks (#270).
- Alle Windows-absolutte stier i OPERATIONS_RUNBOOK.md og OBSERVABILITY_RUNBOOK.md erstattet med repo-relative lenker
- Korrigert startup-sekvens: bootstrapSeed.mjs kjøres av startup.mjs (ikke src/index.ts) før appen importeres
- Oppdatert bootstrapSeed-note: seed kjøres uavhengig av rolle, gated av BOOTSTRAP_SEED=true

## 0.9.58 - 2026-03-25

Refactor: flytt feature-spesifikke spørringer ut av delt moduleRepository (#268).
- queryLatestSubmissionsForModules og queryCompletedSubmissionsForUser flyttet til submissionRepository (de spør submission-tabellen)
- getModuleWithActiveVersion flyttet til submissionRepository (eneste bruker er submissionService)
- moduleRepository inneholder nå kun rene modul/moduleVersion-spørringer
- Ingen endring i ekstern API; tsc --noEmit ren

## 0.9.57 - 2026-03-25

Refactor: modul-eide DTO-typer i read-models (#267).
- Fjernet `import type { ...repository }` fra submissionReadModels, manualReviewReadModels, appealReadModels
- Erstattet persistence-deriverte inputtyper med eksplisitte module-owned typer
- Oppdatert tester: fjernet alle `as never`-caster, lagt til manglende obligatoriske felt
- TypeScript-kompilering ren (tsc --noEmit)

## 0.9.56 - 2026-03-25

Refactor: eksplisitte kommandogrenser i review og appeal resolution (#264, #265).
- finalizeManualReviewOverrideCommand trekket ut i manualReviewService
- resolveAppealCommand trekket ut i appealService
- Begge er rene transaksjonskommandoer; notifikasjon og logging forblir utenfor

## 0.9.55 - 2026-03-25

Refactor: eksplisitt kommandogrense i createSubmission (#263).
- Trekker ut createSubmissionCommand (privat) som eier runInTransaction-blokken
- createSubmission blir ren orkestrator: validate → parse → command → side-effects
- Ingen endring i ekstern API eller testdekning

## 0.9.54 - 2026-03-25

Fiks CI: beskrivelsesfelt i arkivtest er nå en plain string (#258).
- `description` i `createBareModule`-hjelper var et ufullstendig lokalisert objekt (kun en-GB)
- Zod-skjema krever alle tre locale-nøkler for lokaliserte objekter — plain string brukes i stedet
- Alle 7 arkivtester forventet 201 men fikk 400 validation_error

## 0.9.53 - 2026-03-25

Arkivbibliotek i Admin Content (#258).
- Ny seksjon «Modularkiv» mellom «Åpne eksisterende modul» og «4) Modulstatus»
- Fritekstsøk på tittel, liste over arkiverte moduler med arkiveringsdato og nivå
- «Gjenopprett»-knapp per rad — oppdaterer modul-dropdown og arkivlisten automatisk
- Oversettelser for en-GB, nb, nn

## 0.9.52 - 2026-03-25

Frontend: arkiver-knapp i Admin Content (#258).
- «Arkiver modul»-knapp vises når modulen er avpublisert (ingen aktiv versjon)
- Bekreftelsdialog med forklaring — modulen kan gjenopprettes fra arkivbiblioteket
- Etter arkivering fjernes modulen fra dropdown og status nullstilles
- Oversettelser for en-GB, nb, og nn

## 0.9.51 - 2026-03-25

Fiks CI: oppdater assessment-worker-process-error test etter tick()-endring.
- `tick()` svelger nå feil eksplisitt (innført i v0.9.46) — `unhandledRejection` trigges ikke lenger
- Test oppdatert til å verifisere ny atferd: ingen `unhandled_rejection`-event når tick kaster

## 0.9.50 - 2026-03-25

Modularkivering (#258).
- `archivedAt` felt på Module-modellen — arkiverte moduler er ikke slettet, kun skjult
- Arkiverte moduler filtreres ut av hoved-listen i Admin Content automatisk
- `POST /modules/:id/archive` — krever at modulen er avpublisert (`activeVersionId === null`)
- `POST /modules/:id/restore` — gjenoppretter arkivert modul til hoved-listen
- `GET /modules/archive?search=...` — arkiv-bibliotek med fritekstsøk på tittel
- Audit events `module_archived` og `module_restored`
- 6 integrasjonstester (arkiver, gjenopprett, blokkering ved aktiv versjon, dobbeltarkivering, søk, audit)

## 0.9.49 - 2026-03-25

LLM-innholdsgenerering: scenario-instruksjon og distraktor-kalibrering (#245, #246).
- Modulgenereringsprompt instruerer LLM til selv å vurdere om kildematerialet egner seg for et scenario — genererer scenario øverst i `taskText` når egnet, utelater det ellers
- `includesScenario` boolean returneres i module draft-responsen
- MCQ-genereringsprompt sender `certificationLevel` eksplisitt og bruker nivåspesifikke distraktor-retningslinjer (basic/intermediate/advanced)
- Beslutning: separat MCQ-vanskelighets-input er ikke nødvendig — `certificationLevel` er tilstrekkelig for nå
- 9 nye unit-tester dekker scenario-instruksjon og per-nivå distraktor-retningslinjer

## 0.9.48 - 2026-03-25

Flytt bootstrap seed ut av web-oppstart (#256).
- `runBootstrapSeed()` er fjernet fra `index.ts` — ingen seed-sideeffekter ved normal prosessoppstart
- `startup.mjs` importerer `bootstrapSeed.mjs` som deploy-time steg (etter migrasjoner, før appstart)
- `resolveProcessRoleFlags` er eksportert fra `index.ts` og dekket av fokuserte unit-tester

## 0.9.47 - 2026-03-25

Innfør eksplisitte DTO-grenser for review og appeal workspace (#253).
- `toAppealWorkspaceView` og `toManualReviewWorkspaceView` bruker nå eksplisitt feltmapping i stedet for `...spread` — Prisma-formen lekker ikke lenger ukontrollert til API-kontrakten
- `moduleVersion: true` erstattet med `select: { id: true }` — fjerner store ubrukte blobbfelter (taskText, guidanceText, assessmentPolicyJson) fra workspace-responsen
- `llmEvaluations` får eksplisitt `select` i begge repositories — eliminerer `requestPayloadHash` og andre interne felter fra workspace-responsen

## 0.9.46 - 2026-03-24

Worker runtime hardening (#255).
- `AssessmentWorker` prosesserer jobb umiddelbart ved oppstart (ikke etter første interval)
- `lockedBy` bruker en prosess-unik UUID i stedet for `"default-worker"` — trygt i multi-instans-oppsett
- Worker-only health endpoint eksponerer `role`, `startedAt`, og worker `instanceId`/`lastCycleAt`
- `tick()` swallower feil slik at `void`-kalt tick ikke lager unhandled rejections
- 6 nye tester for immediate start, `getStatus()`, og feilhåndtering

## 0.9.45 - 2026-03-24

Legg til `off_topic_submission` rødt flagg (#243).
- Nytt kanonisk rødt flagg for besvarelser som er faglig korrekte men ikke svarer på oppgaven
- Beskrivelse skiller tydelig fra `insufficient_submission` (kvalitet/lengde) vs. emne-mismatch
- Ruter til manuell gjennomgang via `manualReview.redFlagCodes` og sekundær vurdering

## 0.9.44 - 2026-03-24

Fix: bruk mcqScaledScore 30 (full MCQ) i benchmark-cases (#144).
- totalScore = practical_score_scaled + 30, slik at sterke svar (~67/70 praktisk) gir totalScore ~97 og passerer totalMin=70

## 0.9.43 - 2026-03-24

Oppdater benchmark-cases til ny Bourdieu-modul (#144).
- Erstatter 6 gamle cases med 3 reelle nb-besvarelser fra modul `cmn45hjjc000kmbfg7kw3iqo5` (sterk/middels/svak)
- Legger til `promptTemplateSystem` og `promptTemplateUserTemplate` i `AssessmentBatchCase`-typen
- Passer prompt-feltene gjennom til `evaluatePracticalWithAzureOpenAi` i benchmark-scriptet

## 0.9.42 - 2026-03-23

Manuell avpublisering av modul (#258).
- Nytt API-endepunkt: `POST /api/admin/content/modules/:moduleId/unpublish` — nullstiller `activeVersionId`
- Knapp «Avpubliser modul» i admin-grensesnitt — vises kun når en aktiv versjon finnes
- Bekreftelsesdialog med modulnavn før handlingen utføres
- Revisjonslogg (`module_unpublished`) med `previousActiveVersionId`
- i18n-støtte for en-GB, nb og nn

## 0.9.41 - 2026-03-23

Forenkling av vurderingsmodell — én enkelt terskel (#257).
- Fjernet `practicalMinPercent`, `mcqMinPercent`, `borderlineWindow` fra alle skjemaer, konfig og beslutningslogikk
- Fjernet `passFailMismatch` fra disagreement-regler i sekundær-vurdering
- Beslutningen er nå: `totalScore >= totalMin` (pluss rød-flagg-gate) — ingen per-komponent-porter
- Grensesonesporing (`inBorderlineWindow`) fjernet fra `ResolvedAssessmentDecision`-type
- MCQ-passering hardkodet til ≥ 50 % (kun lagret som informasjon, ikke brukt i beslutning)
- Kalibreringsendepunkt forenklet: publiserer kun `totalMin`
- Alle berørte tester oppdatert (decision-service, secondary-assessment, mcq-service, assessment-rules-config)

## 0.9.40 - 2026-03-23

Vurdering: grounding-instruks — evaluer kun mot oppgave og guidance, ikke domenekunnskap.
- Ny «Scoring constraint» i assessorprompt: modellen skal ikke importere krav fra egen domenekunnskap
- Fraværet av noe oppgaven ikke ber om skal ikke straffes
- `improvement_advice` skal kun adressere hva oppgaveteksten faktisk ber om
- Test oppdatert for å verifisere constraintet er med i prompten

## 0.9.39 - 2026-03-23

fix: krav om kildereferanse-forbud i forfatterprompt
- taskText-krav omskrevet: innebygd innhold, ikke "fra kildeteksten"
- guidanceText-krav: skriv som om deltaker kun har sett taskText
- Ny "Self-containment rule"-seksjon forbyr fraser som "as described in the text" i alle deltakervendte felter
- MCQ rationales tillates å referere kilde (interne forfatternotater)

## 0.9.38 - 2026-03-23

Refaktor: samlet capability-katalog for API-ruter (#251).
- Ny `src/config/capabilities.ts` med `API_ROUTE_CAPABILITIES`-array og `rolesFor(id)` hjelpefunksjon
- `src/app.ts` bruker nå katalogen i stedet for inline rolle-arrays — eliminerer tredobbel duplisering
- `AppRole`-import fjernet fra `app.ts` (ikke lenger nødvendig der)
- `/api/calibration` beholder runtime-konfigurerbare roller fra `participant-console.json`

## 0.9.37 - 2026-03-23

Docs sync: workspace-ruter, monitorer og env-defaults (#254).
- `/manual-review` og `/appeal-handler` erstattet med `/review` i API_REFERENCE og GETTING_STARTED
- `/profile` og `/admin-platform` lagt til i workspace-tabellen
- Manglende API-ruter dokumentert: `/api/admin/modules`, `/api/admin/platform`, generate-endepunkter
- `PseudonymizationMonitor` og `AuditRetentionMonitor` lagt til i topology-tabell og worker-oppstartsbeskrivelse
- Stale `src/services/*`-stier rettet til `src/modules/*` i OPERATIONS_RUNBOOK
- `AZURE_OPENAI_TIMEOUT_MS` default rettet fra 30000 til 120000 i `.env.example` og GETTING_STARTED

## 0.9.36 - 2026-03-23

Codex: enhetstester og designdokumenter for LLM-innholdsgenerering.
- `test/unit/llm-content-generation-service.test.ts` — tester at prompts er selvstendige og ikke refererer til skjult kildemateriale
- `buildModuleDraftPrompts` og `buildMcqGenerationPrompts` eksportert for testbarhet
- Arkitektur- og refaktoreringsdokumenter lagt til i `doc/design/`

## 0.9.35 - 2026-03-23

MCQ-generering: krav om lengde- og detaljparitet mellom alternativer.
- Ny «Option parity»-seksjon i MCQ-prompten: alle 4 alternativer skal ha sammenlignbar lengde og spesifisitet
- Kandidaten skal ikke kunne gjette riktig svar basert på at ett alternativ er lengre eller mer detaljert
- Samme regel lagt til i clipboard-prompten (`buildAuthoringPrompt`)

## 0.9.34 - 2026-03-23

Admin-UI: sertifiseringsnivå-valg i forfatterprompt-dialogboksen.
- Ny `<select>` for certificationLevel (blank / grunnleggende / videregående / avansert)
- Nivået forhåndsutfyller `module.certificationLevel` i JSON-malen og legger til kalibreringsinstruks i prompten
- Oversettelser for alle tre lokaler (en-GB, nb, nn)

## 0.9.33 - 2026-03-23

LLM innholdsgenerering: modul-draft og MCQ (#245, #246).
- `POST /api/admin/content/generate/module-draft` — genererer `taskText`, `guidanceText` og `includesScenario` fra kildemateriale
- `POST /api/admin/content/generate/mcq` — genererer MCQ-spørsmål med distraktorkvalitet kalibrert til `certificationLevel`
- Scenario-avgjørelse delegert til LLM: inkluderes kun ved situasjonsanalyse/etikk/praktisk anvendelse
- Scenario plasseres øverst i `taskText` merket «Scenario:» dersom inkludert
- Distractor-retningslinjer: basic (tematisk relatert), intermediate (plausible misoppfatninger), advanced (ekspertnivå-forvirringer)
- Bruker `temperature: 0.4`, `max_completion_tokens: 4000`
- Zod-validering av LLM-respons

## 0.9.32 - 2026-03-23

fix: oppdater llm-assessment-service-test etter prompt-ordlyd-endring (v0.9.30)

## 0.9.31 - 2026-03-23

Benchmark: legg til reelle Bourdieu-caser fra staging (#144).
- `bourdieu_nb_pass` — tydelig PASS (totalScore 91.43), perfekt MCQ
- `bourdieu_nb_borderline_fail` — grenseland FAIL (totalScore 79.43), perfekt MCQ, svakt på praktisk
- `rubricCriteriaIds` valgfritt felt på `AssessmentBatchCase` — Bourdieu-casene bruker domenespesifikke kriterier
- `runModelComparisonBenchmark` sender `rubricCriteriaIds` til assessment-tjenesten

## 0.9.30 - 2026-03-23

Røde flagg: legg til semantiske beskrivelser i prompt-kontrakten (#243).
- `redFlagDescriptions` i `assessment-rules.json` — kriterier for hvert flagg (ikke bare kodenavn)
- `rulesSchema` oppdatert med valgfritt `redFlagDescriptions`-felt
- `buildAllowedRedFlagCodesForPrompt()` returnerer nå `"code — beskrivelse"`-strenger
- Prompt-instruksen presiserer: bruk kun flagg der kriteriene er tydelig oppfylt
- Adresserer nano-sensitive-data-gap og GenAI-spesifisitet i `responsible_use_violation`

## 0.9.29 - 2026-03-22
### Summary
chore: slett gamle benchmark-resultater for ny fullstendig kjøring (v0.9.29)

### Included
- **`doc/benchmarks/`**: Sletter ufullstendige resultater (chat hadde alle feil, rationale-logging manglet for runde 1-6).

## 0.9.28 - 2026-03-22
### Summary
fix: git pull --rebase før push i benchmark-workflow (v0.9.28)

### Included
- **`.github/workflows/benchmark-models.yml`**: Unngår push-konflikt når andre commits er pushet mens benchmark kjører.

## 0.9.27 - 2026-03-22
### Summary
fix: temperature-retry sjekker nå param/message i stedet for error-kode (v0.9.27)

### Included
- **`src/modules/assessment/llmAssessmentService.ts`**: `isUnsupportedTemperatureError` fjerner sjekk på `code === "unsupported_parameter"` — gpt-5.3-chat returnerer "Unsupported value" (ikke "Unsupported parameter"), med ulik error-kode.

## 0.9.26 - 2026-03-22
### Summary
feat: temperature auto-retry, responslogging og realistisk benchmark-case (v0.9.26)

### Included
- **`src/modules/assessment/llmAssessmentService.ts`**: Auto-retry uten `temperature` når modellen ikke støtter parameteren (samme mønster som `max_tokens`-retry). Fikser feil med gpt-5.3-chat.
- **`src/scripts/runModelComparisonBenchmark.ts`**: Logger nå `rubricScores`, `criterionRationales` og `redFlags` per kall i JSONL. Bruker `responseLocale` fra casen.
- **`src/scripts/assessmentBatchCases.ts`**: Legger til `responseLocale`-felt og ny case `snasa_nb_pass` — ekte nb-innlevering som fikk automatisk PASS i staging (totalScore 89.71). Mer realistisk test enn den generiske green_clear_pass-casen.

## 0.9.25 - 2026-03-22
### Summary
fix: slett feil benchmark-resultater og prøv nyere API-versjon (v0.9.25)

### Included
- **`doc/benchmarks/`**: Sletter feilaktig committede resultater fra tidligere kjøringer med feil endpoint.
- **`.github/workflows/benchmark-models.yml`**: API-versjon satt til `2025-01-01-preview` for kompatibilitet med Azure AI Foundry-ressurser.

## 0.9.24 - 2026-03-22
### Summary
fix: legg tilbake environment: staging i benchmark-workflow (v0.9.24)

### Included
- **`.github/workflows/benchmark-models.yml`**: `BENCHMARK_AZURE_OPENAI_ENDPOINT` og `BENCHMARK_AZURE_OPENAI_API_KEY` er scopet til staging-miljøet, ikke repo-nivå.

## 0.9.23 - 2026-03-22
### Summary
fix: benchmark-workflow bruker nå dedikerte repo-variabler og korrekte deployment-navn (v0.9.23)

### Included
- **`.github/workflows/benchmark-models.yml`**: Bytter til `BENCHMARK_AZURE_OPENAI_ENDPOINT`/`BENCHMARK_AZURE_OPENAI_API_KEY` (repo-nivå, ikke staging-miljø). Fjerner `environment: staging`. Oppdaterer default deployment-navn til faktiske navn på Foundry-ressursen.

## 0.9.22 - 2026-03-22
### Summary
fix: gi benchmark-workflow skrivetilgang for å committe rapport (v0.9.22)

### Included
- **`.github/workflows/benchmark-models.yml`**: Legger til `permissions: contents: write` — github-actions[bot] mangler skrivetilgang som standard.

## 0.9.21 - 2026-03-22
### Summary
fix: sett AZURE_OPENAI_DEPLOYMENT i benchmark-workflow (v0.9.21)

### Included
- **`.github/workflows/benchmark-models.yml`**: Legger til `AZURE_OPENAI_DEPLOYMENT: benchmark-override` — env.ts krever variabelen når `LLM_MODE=azure_openai`. Benchmarken sender faktisk deployment per kall via CLI-argumenter.

## 0.9.20 - 2026-03-22
### Summary
fix: bruk staging-miljø i benchmark-workflow for tilgang til vars/secrets (v0.9.20)

### Included
- **`.github/workflows/benchmark-models.yml`**: Legger til `environment: staging` — Azure OpenAI-variabler og secrets er scopet til staging-miljøet, ikke repo-nivå.

## 0.9.19 - 2026-03-22
### Summary
fix: bruk npx tsx i benchmark-workflow (v0.9.19)

### Included
- **`.github/workflows/benchmark-models.yml`**: `tsx` → `npx tsx` — tsx er ikke globalt installert på GitHub Actions runner.

## 0.9.18 - 2026-03-22
### Summary
fix: oppdater kontraktstester etter sletting av appeal-handler/manual-review-sider (v0.9.18)

### Included
- **`test/workspace-html-fallbacks.test.js`**: Erstatter `appeal-handler.html` og `manual-review.html` med `review.html` (begge ble konsolidert i v0.9.11).
- **`test/workspace-validation-accessibility.test.js`**: Peker nå til `review.html`/`review.js` for aria- og JS-kontrakter som tidligere lå i de slettede sidene.

## 0.9.17 - 2026-03-22
### Summary
ci: GitHub Actions workflow for model comparison benchmark (v0.9.17)

### Included
- **`.github/workflows/benchmark-models.yml`** (ny): `workflow_dispatch`-workflow som kjører `runModelComparisonBenchmark.ts` med Azure OpenAI-credentials fra repository vars/secrets. Støtter inputs `repeat`, `models` og `cases`. Laster opp resultater som artifact (90 dagers oppbevaring) og committer markdown-rapport tilbake til repo med `[skip ci]`.

## 0.9.16 - 2026-03-22
### Summary
feat: interleaved kjøreorden, progressiv JSONL-logging og markdown-rapport i benchmark-script (v0.9.16)

### Included
- **`src/scripts/runModelComparisonBenchmark.ts`**: Tre forbedringer:
  1. **Interleaved rekkefølge**: for hver runde kjøres full → mini → nano, slik at systematisk trafikk-bias unngås.
  2. **Progressiv JSONL-logging** (`--output=<sti>`): hvert resultat skrives til `.jsonl`-fil umiddelbart — crash-safe. Avbrutt kjøring kan gjenopptas automatisk.
  3. **Markdown-rapport**: skrives til `.md`-fil ved kjøringens slutt med tabeller for utfall, score-statistikk og latency per modell × case, pluss tomme seksjoner for funn og anbefaling.

## 0.9.15 - 2026-03-22
### Summary
feat: modell-sammenlignings-benchmark for scoring-konsistens (#144)

### Included
- **`src/scripts/runModelComparisonBenchmark.ts`** (ny): Kjører samme case(r) X ganger mot flere navngitte Azure OpenAI-deployments. Måler per modell × case: utfallsfordeling (PASS/FAIL/UNDER_REVIEW), score-statistikk (snitt, std.avvik, min, maks), og latency (snitt, std.avvik, min, maks).
- **`package.json`**: Ny `benchmark:models`-script. Bruk: `npm run benchmark:models -- --repeat=10 --models=label1:deployment1,label2:deployment2 --cases=yellow_sensitive_data,green_clear_pass`
- Caseutvalg: bruker eksisterende `assessmentBatchCases` — defaulter til alle ikke-FAIL-cases (gul og grønn) hvis `--cases` utelates.

## 0.9.14 - 2026-03-22
### Summary
refactor: dedikert GET /api/admin/modules for kalibreringssiden (v0.9.14)

### Included
- **`src/routes/adminModules.ts`** (ny): `GET /` returnerer alle moduler uten publiseringsfilter, gjenbruker `listModules` fra modules-domenet.
- **`src/app.ts`**: Monterer ny rute på `/api/admin/modules` med `requireAnyRole([ADMINISTRATOR, SUBJECT_MATTER_OWNER])`.
- **`public/calibration.js`**: `loadModuleOptions()` bruker nå `/api/admin/modules` — eget endepunkt i modules-domenet, ingen kryssavhengighet til adminContent.
- Rydder opp v0.9.13 som brukte feil domene-endepunkt.

## 0.9.13 - 2026-03-22
### Summary
fix: kalibreringssiden bruker nå admin-content-endepunktet for modullisten (v0.9.13)

### Included
- **`public/calibration.js`**: `loadModuleOptions()` bruker nå `/api/admin/content/modules` i stedet for `/api/modules?adminFacing=true`. Det nye endepunktet er alltid gatet bak ADMINISTRATOR/SUBJECT_MATTER_OWNER og returnerer alle moduler uten betinget rollelogikk.

## 0.9.12 - 2026-03-22
### Summary
refactor: splitt adminContent-service i commands, queries og projections (#239)

### Included
- **`src/modules/adminContent/adminContentCommands.ts`** (ny): Alle skrive-kommandoer fra `adminContentService.ts` flyttet hit.
- **`src/modules/adminContent/adminContentProjections.ts`** (ny): Projection-hjelperne `decodeLocalizedText`, `safeParseJson`, `decodeMcqOption`, `mapMcqSetVersion` ekstrahert fra `adminContentQueries.ts`.
- **`src/modules/adminContent/adminContentQueries.ts`**: Importerer nå hjelperne fra `adminContentProjections.js` i stedet for å definere dem lokalt.
- **`src/modules/adminContent/index.ts`**: Peker nå til `adminContentCommands.js` i stedet for `adminContentService.js`.
- **Slettet**: `src/modules/adminContent/adminContentService.ts`.

## 0.9.11 - 2026-03-22
### Summary
refactor: slett gamle manual-review/appeal-handler-sider, skjul detalj når kø er tom (v0.9.11)

### Included
- **`public/review.js`**: Detalj-seksjonen skjules automatisk når tilhørende kø er tom. Begge køer bruker nå `showEmpty()` for konsistent visuell tom-tilstand (midtstilt, lyseblå bakgrunn).
- **Slettet**: `public/manual-review.html`, `public/manual-review.js`, `public/appeal-handler.html`, `public/appeal-handler.js`.
- **`src/app.ts`**: Rutene `GET /manual-review` og `GET /appeal-handler` er fjernet.
- **`test/participant-console-config.test.ts`**: Oppdatert til å teste `/review` i stedet for de gamle sidene.

## 0.9.10 - 2026-03-22
### Summary
feat: samtykkeversjonering via admin-panel — admin kan kreve nytt samtykke uten redeploy (v0.9.10)

### Included
- **`src/modules/platformConfig/consentConfigService.ts`**: Ny `getActiveConsentVersion()` — leser aktiv samtykkeversjon fra `PlatformConfig` (nøkkel `consent.version`) med 60-sekunders cache, faller tilbake til hardkodet `CURRENT_CONSENT_VERSION`. Ny `bumpConsentVersion()` — auto-inkrementerer minor-versjon og lagrer til DB. Ny `invalidateConsentVersionCache()`.
- **`src/middleware/consentMiddleware.ts`**: Bruker nå `getActiveConsentVersion()` i stedet for hardkodet konstant — middleware plukker automatisk opp versjonsbump uten redeploy.
- **`src/routes/me.ts`**: Alle tre bruk av `CURRENT_CONSENT_VERSION` erstattet med `getActiveConsentVersion()` (GET /api/me, POST /api/me/consent).
- **`src/routes/adminPlatform.ts`**: GET returnerer nå `consentVersion`-feltet. PUT aksepterer nytt `bumpVersion: boolean`-felt — kaller `bumpConsentVersion()` hvis sant.
- **`public/admin-platform.html`**: Lagt til versjonvisning (`#consentVersion`) og «Krev nytt samtykke»-avkrysningsboks (`#bumpVersion`) i lagrelinjen.
- **`public/admin-platform.js`**: Kobler til nye DOM-elementer, sender `bumpVersion` i PUT, nullstiller avkrysning og laster innstillinger på nytt etter lagring.
- **`public/i18n/admin-platform-translations.js`**: Lagt til `adminPlatform.consent.currentVersion` og `adminPlatform.consent.bumpVersion` for alle tre lokaler.
- **`test/unit/consent-middleware.test.ts`**: Mock oppdatert til å mocke `getActiveConsentVersion` fra consentConfigService i stedet for `CURRENT_CONSENT_VERSION`.

## 0.9.9 - 2026-03-22
### Summary
feat: slå sammen manuell vurdering og ankebehandling til én /review-side (v0.9.9)

### Included
- **`public/review.html`**: Ny kombinert side med seksjon for fagvurdering (REVIEWER) og ankebehandling (APPEAL_HANDLER), rollebasert synlighet.
- **`public/review.js`**: Kombinert JS-logikk — laster begge køer parallelt, bruker separate formattere og feltnavn for MR og anke.
- **`public/i18n/review-translations.js`**: Samler oversettelser fra `manual-review-translations.js` og `appeal-handler-translations.js` med sidenivå-nøkler (`reviewPage.*`, `review.section.*`).
- **`config/participant-console.json`**: Navigasjonselement `manual-review` og `appeal-handler` erstattet med `review` (roller: REVIEWER, APPEAL_HANDLER, ADMINISTRATOR).
- **`public/i18n/participant-translations.js`**: Lagt til `nav.review` — nb: «Manuell behandling», nn: «Manuell handsaming», en-GB: «Manual review».
- **`src/app.ts`**: Lagt til rute `GET /review` → `review.html`.
- Alle side-JS-filer (`participant`, `calibration`, `admin-content`, `results`, `admin-platform`, `profile`, `manual-review`, `appeal-handler`, `participant-completed`): `defaultWorkspaceNavigationItems` oppdatert — `manual-review`, `appeal-handler` og `participant-completed` erstattet med `review`.
- **`test/participant-console-config.test.ts`**: Oppdatert forventede navigasjonselementer og lagt til test for `/review`-ruten. Fjernet `participant-completed` fra forventet nav (ble fjernet i v0.9.6).

## 0.9.8 - 2026-03-22
### Summary
fix: fjern gjentakelse i sidetittel/seksjonsoverskrift, redesign admin-platform (v0.9.8)

### Included
- **`public/i18n/calibration-translations.js`**: Omdøpt første seksjon h2 fra «Kalibreringsfilter» til «Filter» (alle lokaler) — fjerner gjentakelse med sidetittel «Kalibreringsarbeidsflate».
- **`public/i18n/participant-completed-translations.js`**: Omdøpt «Mine fullførte moduler» til «Mine moduler» — fjerner gjentakelse med sidetittel «Fullførte moduler».
- **`public/admin-platform.html`**: Seksjonsoverskrifter bruker nå standard `<h2>` (ikke liten versalisert stil). Fane-knapper for personverntekst følger nå understrek-mønsteret fra admin-content-dialoger. Knappeklasser normalisert til `btn-primary`/`btn-secondary`.

## 0.9.7 - 2026-03-22
### Summary
fix: øk avstand under gult varsel-banner i innholdsforvaltning (v0.9.7)

### Included
- **`public/admin-content.html`**: Lagt til `margin-bottom: var(--space-2)` på varsel-banner for særlige kategorier — gir samme avstand ned til neste seksjon som mellom andre seksjoner.

## 0.9.6 - 2026-03-22
### Summary
refactor: flytt Fullførte moduler til Profil og skjul nav for ren deltaker (v0.9.6)

### Included
- **`config/participant-console.json`**: Fjernet `participant-completed` fra workspace-nav — innholdet er allerede tilgjengelig som seksjon i Profil-siden.
- **`public/static/shared.css`**: Nav skjules automatisk (CSS `:has()`) når bruker kun har 0–1 synlige lenker — gir rent grensesnitt for deltakere med kun én rolle. `locale-picker` bruker `margin-left: auto` for konsistent høyre-justering uavhengig av nav-tilstand.

## 0.9.5 - 2026-03-22
### Summary
refactor: flytt workspace-nav øverst og versjonsnummer til høyre hjørne (v0.9.5)

### Included
- **`public/static/shared.css`**: Nye delte klasser: `.page-top-bar` (flex-rad med nav + locale-picker), `.page-top-bar > .workspace-nav` (fyller tilgjengelig bredde), `.locale-picker`, `.locale-select-compact`, `.version-badge`, `.sr-only` — fjernet fra alle individuelle sider.
- **Alle 9 HTML-sider** (`participant`, `manual-review`, `calibration`, `appeal-handler`, `results`, `participant-completed`, `admin-content`, `admin-platform`, `profile`): Workspace-navigasjon er nå øverst i en `page-top-bar`, versjonsnummer (`v0.x.x`) vises som liten tekst i locale-picker-hjørnet, og `<h1>` er plassert direkte over innholdet for tettere visuell kobling.
- **`public/admin-platform.js`**: Lagt til versjonshenting (`/version`) i boot-IIFE — vises nå konsistent med alle andre sider.

## 0.9.4 - 2026-03-22
### Summary
fix: versjonsnummer på profilsiden og CI-test for navigasjon (v0.9.4)

### Included
- **`public/profile.html`**: Versjonsnummer flyttet ut av `page-header-row` og ned under tittelen — samme plassering som alle andre sider.
- **`public/i18n/profile-translations.js`**: Lagt til `page.versionLabel` i alle tre lokaler (oversettelsen fantes ikke i den standalone filen, nøkkelen ble vist rå).
- **`test/participant-console-config.test.ts`**: Oppdatert forventet nav-liste med `admin-platform`-elementet som ble lagt til i `participant-console.json`.

## 0.9.3 - 2026-03-22
### Summary
fix: rettighetskortet i profil bruker nå vertikal layout (v0.9.3)

### Included
- **`public/profile.html`**: Fjernet flex-rad-layout på rettighetskortet. Knappene vises nå under beskrivelsesteksten. Unngår at teksten presses til ett ord per linje.

## 0.9.2 - 2026-03-22
### Summary
fix: legg til admin-platform i navigasjonskonfig (v0.9.2)

### Included
- **`config/participant-console.json`**: `admin-platform`-elementet manglet i navigasjonslisten. Server-config overstyrer JS-fallback, så lenken ble aldri synlig selv med ADMINISTRATOR-rollen.

## 0.9.1 - 2026-03-22
### Summary
fix: oppdater consent-middleware-tester etter path-endring (v0.9.1)

### Included
- **`test/unit/consent-middleware.test.ts`**: Exempt-path-tester brukte `/api/me` og `/api/me/consent`, men middleware sjekker relative stier etter Express-mount (`/me`, `/me/consent`). Testtitler oppdatert med forklaring.

## 0.9.0 - 2026-03-22
### Summary
fix: versjonsnummer på profilsiden (v0.9.0)

### Included
- **`public/profile.html`**: Lagt til `#appVersion`-element i sidetittelen.
- **`public/profile.js`**: Henter versjon fra `/version`-endepunktet ved oppstart og viser den.

## 0.8.99 - 2026-03-22
### Summary
feat: dedikert admin-plattform-side for systemnivå-konfigurasjon (v0.8.99)

### Included
- **`src/routes/adminPlatform.ts`** (ny): `GET /api/admin/platform` returnerer gjeldende plattformkonfigurasjon (platformName, dpoName, dpoEmail, consentBody per lokale). `PUT /api/admin/platform` lagrer endringer via `upsertConsentConfig`. Kun tilgjengelig for ADMINISTRATOR.
- **`src/app.ts`**: Registrert `adminPlatformRouter` med `requireAnyRole([AppRole.ADMINISTRATOR])`. Ny side-rute `GET /admin-platform`.
- **`public/admin-platform.html`** (ny): Fullstendig administrasjonsside med Generelt-seksjon (plattformnavn), DPO-seksjon (navn, e-post) og Personverntekst-seksjon med faner per lokale (nb/nn/en-GB). Samme layout som øvrige sider.
- **`public/admin-platform.js`** (ny): Henter og lagrer konfigurasjon via API. Følger samme boot-mønster som øvrige sider (loadConsoleConfig → initConsentGuard → loadSettings). Fane-logikk for samtykketekst.
- **`public/i18n/admin-platform-translations.js`** (ny): Utvider `participant-translations.js` med alle `adminPlatform.*`-nøkler for nb/nn/en-GB.
- **`public/i18n/participant-translations.js`**: Lagt til `nav.adminPlatform` i alle tre lokaler (kaskaderer til alle utvidende oversettelser).
- **`public/i18n/profile-translations.js`**: Lagt til `nav.adminPlatform` i alle tre lokaler.
- **Alle 8 side-JS-filer** (`participant.js`, `manual-review.js`, `calibration.js`, `admin-content.js`, `appeal-handler.js`, `results.js`, `participant-completed.js`, `profile.js`): `admin-platform`-navigasjonselement lagt til i `defaultWorkspaceNavigationItems`.

## 0.8.98 - 2026-03-22
### Summary
fix: UX-forbedringer samtykke og profil etter manuell testing (v0.8.98)

### Included
- **`src/config/consent.ts`**: Presisert advarselstekst — "personopplysninger" → "særlige eller sensitive personopplysninger" (alle tre lokaler).
- **`public/consent-guard.js`**: Lagt til språkvelger i samtykke-dialogen. Bruker kan velge norsk bokmål / nynorsk / English direkte i dialogen. Valg lagres i localStorage og siden lastes på nytt med riktig lokale.
- **`public/i18n/profile-translations.js`**: Fikset inkonsistent navngivning: "Vurderinger"/"Vurderingar" → "Deltaker"/"Deltakar". Datavisning-seksjonen "Profil" → "Mine data". Lagt til korte knappeoverskrifter (`profile.rights.*.btn`).
- **`public/profile.html`**: Rettighetskortet bruker nå kortere knappeoverskrifter og `align-items: center` for bedre layout. Knapper har `flex-shrink: 0; white-space: nowrap` for smalere knappekolonne.
- **`public/profile.js`**: Fikset fontfarge i datautdrag (eksplisitt `color: var(--color-text)` på `<pre>`).

## 0.8.97 - 2026-03-22
### Summary
fix: samtykke-dialog blokkert av consent-middleware, Profil-lenke flyttes til toppmenyen (v0.8.97)

### Included
- **`src/middleware/consentMiddleware.ts`**: Fikset feil i `CONSENT_EXEMPT_PATHS` — stiene må være relative til `/api`-mount-punktet (`/me`, `/me/consent`), ikke absolutte (`/api/me`). Denne feilen blokkerte samtykke-dialogen på alle sider og profil-innholdet.
- **`public/participant.js`**, **`manual-review.js`**, **`calibration.js`**, **`admin-content.js`**, **`appeal-handler.js`**, **`results.js`**, **`participant-completed.js`**: `renderWorkspaceNavigation()` skiller nå ut Profil-lenken og plasserer den ved siden av språkvelgeren (`.locale-picker`), ikke i workspace-navigasjonen.
- **`public/profile.js`**: Profil-lenken filtreres ut av workspace-nav (vises ikke på profil-siden). Lagt til try/catch rundt `loadProfileData()` i boot-IIFE for å vise feilmelding ved feil i stedet for tomt innhold.

## 0.8.96 - 2026-03-22
### Summary
fix: samtykke-dialog og Profil-lenke mangler på alle sider unntatt profil (v0.8.96)

### Included
- **`public/consent-guard.js`**: Gjort selvforsynt med innebygde oversettelser (en-GB/nb/nn) — fjerner avhengigheten av sideens `t()`-funksjon. Ny signatur: `initConsentGuard(getHeaders, locale)` (uten `t`-parameter).
- **`public/profile.js`**: Oppdatert kall til ny signatur.
- **`public/participant.js`**, **`participant-completed.js`**, **`manual-review.js`**, **`results.js`**, **`appeal-handler.js`**, **`calibration.js`**, **`admin-content.js`**: Lagt til `import { initConsentGuard }`, lagt til Profil-lenke i nav, og kalt `await initConsentGuard(headers, currentLocale)` etter `renderWorkspaceNavigation()` i `loadParticipantConsoleConfig()`.
- **`public/i18n/participant-translations.js`** og øvrige 6 i18n-filer: Lagt til `"nav.profile"` i alle tre lokaler (en-GB/nb/nn).

## 0.8.95 - 2026-03-22
### Summary
fix: legg til manglende Prisma-migrasjon for GDPR-schema (v0.8.95)

### Included
- **`prisma/migrations/20260322000001_add_gdpr_consent_and_deletion/migration.sql`** (ny): DDL for `DeletionRequestStatus`- og `DeletionTrigger`-enums, nye kolonner på `User` (`lastLoginAt`, `isAnonymized`, `anonymizedAt`), og nye tabeller `UserConsent`, `DeletionRequest`, `PlatformConfig` med indekser og fremmednøkler.

## 0.8.94 - 2026-03-22
### Summary
test: automatiserte tester for GDPR-samtykke og pseudonymisering

### Included
- **`test/unit/consent-middleware.test.ts`** (ny): 7 unit-tester for `requireConsent` — bypass i test-env, unntak for uautentiserte brukere og exempt paths, 403 ved manglende samtykke, videresendt DB-feil.
- **`test/unit/pseudonymization-service.test.ts`** (ny): 11 unit-tester for `pseudonymizeUser`, `requestPseudonymization` og `cancelPseudonymizationRequest` — no-op ved allerede pseudonymisert, feil ved manglende bruker, transaksjonsflyten med korrekte felter, deterministisk pseudo-e-post, grace-period vs. umiddelbar pseudonymisering.
- **`test/unit/pseudonymization-scanner.test.ts`** (ny): 9 unit-tester for `runPseudonymizationScan` — nulltellinger når ingenting er forfalt, fase 1 grace-period, fase 2 offboarding, fase 3 inaktivitet, feilmotstandsdyktighet, betinget loggføring.
- **`test/m3-gdpr-consent.test.ts`** (ny): Integrasjonstest for hele GDPR-flyten med dedikert testbruker — `GET /api/me`, `GET|POST /api/me/consent`, `GET /api/me/data`, grace-period-slettingsflyt og umiddelbar pseudonymisering.
- **`src/middleware/consentMiddleware.ts`**: `NODE_ENV=test`-bypass slik at eksisterende integrasjonstester ikke brytes av manglende samtykkerecord.

## 0.8.93 - 2026-03-22
### Summary
feat: GDPR consent, profil-side og pseudonymisering (#36)

### Included
- **`prisma/schema.prisma`**: Nye modeller `UserConsent`, `DeletionRequest`, `PlatformConfig`; `lastLoginAt`, `isAnonymized`, `anonymizedAt` på `User`; enums `DeletionRequestStatus`, `DeletionTrigger`.
- **`src/config/consent.ts`** (ny): `CURRENT_CONSENT_VERSION`, standard personverntekst (nb/en-GB/nn) med GDPR Art. 13-påkrevd informasjon inkl. Azure OpenAI-note.
- **`src/config/retention.ts`** (ny): Retensjonskonstanter — operasjonslogg 7 dager, grace period 30 dager, offboarding 90 dager, inaktivitet 2 år.
- **`src/middleware/consentMiddleware.ts`** (ny): Blokkerer alle `/api/*`-ruter uten gyldig samtykke; unntar `/api/me` og `/api/me/consent`.
- **`src/modules/user/pseudonymizationService.ts`** (ny): `pseudonymizeUser`, `requestPseudonymization`, `cancelPseudonymizationRequest`; SHA-256-hash som pseudonymisert e-post.
- **`src/modules/user/pseudonymizationScanner.ts`** (ny): Scanner for grace-period-utløp, Entra-offboarding (90 dager), og inaktivitetsbackstop (2 år).
- **`src/modules/user/PseudonymizationMonitor.ts`** (ny): 6-timers intervallmonitor.
- **`src/modules/retention/auditRetentionService.ts`** (ny): Sletter operasjonelle audit-events (org-sync, job-enqueue) eldre enn 7 dager.
- **`src/modules/retention/AuditRetentionMonitor.ts`** (ny): 24-timers intervallmonitor.
- **`src/modules/platformConfig/platformConfigRepository.ts`** (ny): CRUD for `PlatformConfig`.
- **`src/modules/platformConfig/consentConfigService.ts`** (ny): `getConsentConfig`, `upsertConsentConfig` per locale.
- **`src/routes/me.ts`** (ny): `GET /api/me`, `GET /api/me/consent`, `POST /api/me/consent`, `GET /api/me/data`, `POST /api/me/deletion`, `DELETE /api/me/deletion`.
- **`src/repositories/userRepository.ts`**: `lastLoginAt` satt ved alle upsert-stier i `upsertUserFromPrincipal`.
- **`src/db/prismaRuntime.ts`**: Eksporterer `DeletionRequestStatus` og `DeletionTrigger`.
- **`src/app.ts`**: `/profile`-rute, `requireConsent`-middleware, `meRouter`.
- **`src/index.ts`**: `PseudonymizationMonitor` og `AuditRetentionMonitor` startes med arbeidsprosessen.
- **`src/modules/certification/participantNotificationService.ts`**: Fjernet `recipientEmail` fra audit-metadata i varslingseventer.
- **`public/profile.html`** (ny): Profil-side med kontoseksjon, fullførte moduler, GDPR-rettigheter og slettingsdialog.
- **`public/profile.js`** (ny): JavaScript-logikk for profil-siden — laster brukerdata, moduler, innsyn, nedlasting og pseudonymiseringsflyt.
- **`public/consent-guard.js`** (ny): Delt modul for alle sider — sjekker samtykke ved sideinnlasting og viser blokkerende modal ved behov.
- **`public/i18n/profile-translations.js`** (ny): Oversettelser for profil, samtykke, sletting og datavisning (en-GB / nb / nn).
- **`public/admin-content.html`**: Advarsel om GDPR Art. 9 særkategoririsiko i fritekstbesvarelser.
- **`public/i18n/admin-content-translations.js`**: Oversettelsesnøkler for personvernadvarselen (en-GB / nb / nn).

## 0.8.92 - 2026-03-22
### Summary
refactor: splitt adminContentService i kommando- og spørringsfiler (#239)

### Included
- **`src/modules/adminContent/adminContentQueries.ts`** (ny): Inneholder `listAdminModules` og `getModuleContentBundle` med alle projection-hjelpere (`decodeLocalizedText`, `safeParseJson`, `decodeMcqOption`, `mapMcqSetVersion`). Les-modell-assemblering er nå atskilt fra kommandoorkestrering.
- **`src/modules/adminContent/adminContentService.ts`**: Fjernet query-funksjoner og projection-hjelpere. Nå rent kommandofil: `createModule`, `deleteModule`, `createRubricVersion`, `createPromptTemplateVersion`, `createMcqSetVersion`, `createModuleVersion`, `createBenchmarkExampleVersion`, `publishModuleVersion`, `publishModuleVersionWithThresholds`.
- **`src/modules/adminContent/index.ts`**: Eksporterer kommandoer fra service, spørringer fra queries.

## 0.8.91 - 2026-03-22
### Summary
fix: retake supersede-flyt er nå fullt atomisk og eksplisitt (#238)

### Included
- **`src/modules/review/manualReviewService.ts`**: `cancelSupersededReviews` → `supersedeEligibleReviewsForRetake(userId, moduleId, newSubmissionId, tx)`. Bruker nå `createManualReviewRepository(tx)` og sender tx til `recordAuditEvent`. Returnerer antall supersettede.
- **`src/modules/appeal/appealService.ts`**: `cancelSupersededAppeals` → `supersedeEligibleAppealsForRetake(userId, moduleId, newSubmissionId, tx)`. Tilsvarende.
- **`src/modules/review/index.ts`** / **`src/modules/appeal/index.ts`**: Eksporterer de nye navnene.
- **`src/modules/submission/submissionService.ts`**: `createSubmission` wrapper hele skrivesekvensen (create + audit + supersede review + supersede appeal) i én `prisma.$transaction()`. Legger til aggregert `retake_supersede_completed`-audit-event med counts når ≥1 sak supersettes. `logOperationalEvent` forblir utenfor.
- **`test/unit/submission-service.test.ts`**: Oppdatert for ny funksjonsnavn og transaksjonsmønster. Fire tester: ingen åpne saker, kun review, kun appeal, begge.
- **`test/unit/transactional-failure-injection.test.ts`**: Fem nye tester for retake supersede-transaksjonen: submission-create feiler → supersede ikke kalt; review-supersede feiler → appeal-supersede ikke kalt; appeal-supersede feiler; combined review+appeal; ingen åpne saker gir ingen supersede-audit.
- **`test/unit/appeal-service.test.ts`** / **`test/unit/manual-review-service.test.ts`** / **`test/unit/admin-content-service.test.ts`**: Oppdatert mocks og funksjonsnavn.

## 0.8.90 - 2026-03-21
### Summary
fix: supersede IN_REVIEW appeals and manual reviews on retake (#238)

### Included
- **`src/modules/appeal/appealRepository.ts`**: `findOpenByUserAndModule` now fetches both `OPEN` and `IN_REVIEW` appeals. `supersedeMany` guard also expanded to `{ in: ["OPEN", "IN_REVIEW"] }` — previously a claimed (IN_REVIEW) appeal was left dangling when the participant retook the module.
- **`src/modules/review/manualReviewRepository.ts`**: Same fix — `findOpenByUserAndModule` and `supersedeMany` both expanded to include `IN_REVIEW` manual reviews.

## 0.8.89 - 2026-03-21
### Summary
refactor: publishModuleVersionWithThresholds is now fully atomic (#237)

### Included
- **`src/modules/adminContent/adminContentRepository.ts`**: `publishModuleVersion` no longer wraps its 3 DB operations in an internal `client.$transaction()`. Client type narrowed to `Pick<...>` (no `$transaction` needed). The function now runs directly on whatever client (full prisma or tx) is passed in.
- **`src/modules/adminContent/adminContentService.ts`**: imports `createAdminContentRepository` and `prisma`. Standalone `publishModuleVersion` wraps the repo call in `prisma.$transaction()` to preserve atomicity. `publishModuleVersionWithThresholds` wraps `createModuleVersion` + `publishModuleVersion` in a single `prisma.$transaction()`, making create-then-publish atomic (previously two non-atomic calls — an orphaned unpublished version could be left if publish failed).

## 0.8.88 - 2026-03-21
### Summary
fix: appeal resolution email now includes outcome + resolution note, and uses submission locale.

### Included
- **`src/i18n/notificationMessages.ts`**: `getAppealNotificationMessage` accepts optional `resolution: { passFailTotal, resolutionNote }` for RESOLVED status. Email body now includes localized outcome line ("Outcome: Passed/Not passed" / "Resultat: Bestått/Ikke bestått") and the handler's resolution note before the standard guidance text.
- **`src/modules/certification/participantNotificationService.ts`**: `AppealNotificationInput` extended with optional `passFailTotal` and `resolutionNote`; passed to message builder.
- **`src/modules/appeal/appealService.ts`**: All three notification call sites (`createSubmissionAppeal`, `claimAppeal`, `resolveAppeal`) now use `normalizeLocale(submission.locale) ?? env.DEFAULT_LOCALE` instead of hardcoded `env.DEFAULT_LOCALE`. `resolveAppeal` passes `passFailTotal` and `resolutionNote` to the notification.
- **`src/modules/appeal/appealRepository.ts`**: `findAppealForClaim` select now includes `submission.locale` so `claimAppeal` can use the participant's locale.

## 0.8.87 - 2026-03-21
### Summary
UI: move locale picker inline with page title on all screens.

### Included
- **`public/admin-content.html`**, **`calibration.html`**, **`manual-review.html`**, **`appeal-handler.html`**, **`results.html`**, **`participant-completed.html`**: locale picker moved from a standalone card section into a `page-header-row` flex container beside the `<h1>`, matching the pattern already applied to `participant.html`. Label is now visually hidden (`sr-only`) and the select uses `locale-select-compact` styling.

## 0.8.86 - 2026-03-21
### Summary
Refactor: slim admin-content route — extract Zod schemas and mapper into dedicated files (issue #232).

### Included
- **`src/modules/adminContent/adminContentSchemas.ts`** (new): all Zod validation schemas for admin-content routes, plus `parseRequest` and `parseOptionalDate` helpers.
- **`src/modules/adminContent/adminContentMapper.ts`** (new): mapper functions (`toCreateModuleInput`, `toCreatePromptTemplateVersionInput`, `toCreateMcqSetVersionInput`, `toCreateModuleVersionInput`) handling codec serialization.
- **`src/routes/adminContent.ts`**: rewritten to thin route handlers — all validation and mapping delegated to schemas/mapper files.
- Service input types for `CreatePromptTemplateVersionInput` and `CreateMcqSetVersionInput` now accept `active?: boolean` (defaulted internally), resolving cross-module Zod type inference incompatibilities.
- `submissionSchemaFieldSchema.required` changed from `.default(false)` to `.optional()` for consistent cross-module type inference.

## 0.8.85 - 2026-03-21
### Summary
Refactor: migrate adminContent, module, orgSync, and decisionLineage to feature modules.

### Included
- **`src/modules/adminContent/`**: new module — `adminContentRepository.ts`, `adminContentService.ts`, `index.ts`. Replaces `src/services/adminContentService.ts` and `src/repositories/adminContentRepository.ts`.
- **`src/modules/module/`**: new module — `moduleService.ts`, `moduleCompletionPolicyService.ts`, `index.ts`. Replaces `src/services/moduleService.ts` and `src/services/moduleCompletionPolicyService.ts`.
- **`src/modules/orgSync/`**: new module — `orgSyncService.ts`, `index.ts`. Replaces `src/services/orgSyncService.ts`.
- **`src/modules/assessment/decisionLineageService.ts`**: moved from `src/services/decisionLineageService.ts` into the assessment module.
- `src/services/` now contains only shared infra: `auditService.ts`. All domain logic has been migrated to feature modules.
- All consumers (routes, modules, tests) updated to import from new module paths.

## 0.8.84 - 2026-03-21
### Summary
Refactor: migrate calibration, certification, and submission to feature modules.

### Included
- **`src/modules/calibration/`**: new module — `calibrationRepository.ts`, `calibrationWorkspaceService.ts`, `index.ts`. Replaces `src/services/calibrationWorkspaceService.ts` and `src/repositories/calibrationRepository.ts`.
- **`src/modules/certification/`**: new module — `certificationRepository.ts`, `participantNotificationService.ts`, `recertificationService.ts`, `index.ts`. Replaces `src/services/recertificationService.ts`, `src/services/participantNotificationService.ts`, and `src/repositories/certificationRepository.ts`.
- **`src/modules/submission/`**: new module — `submissionRepository.ts`, `submissionService.ts`, `index.ts`. Replaces `src/services/submissionService.ts` and `src/repositories/submissionRepository.ts`.
- All consumers (routes, modules, tests) updated to import from new module paths.

## 0.8.83 - 2026-03-21
### Summary
Fix: authoring prompt grounding constraints to prevent source-external framing (scenario/case drift).

### Included
- **`public/admin-content.js`**: `buildAuthoringPrompt` now includes explicit grounding constraints — two-phase instruction (identify concepts first, then build), prohibition on scenario/case/role framing unless source-supported, requirement that every substantive concept be traceable to the source material.

## 0.8.82 - 2026-03-21
### Summary
Feat: participant console renders submissionSchema placeholder as textarea placeholder text.

### Included
- **`public/participant.js`**: `getSubmissionFields` now passes `placeholder` through from schema fields. `renderSubmissionFields` sets `textarea.placeholder` using `localizePreviewText` (resolves locale object or plain string).

## 0.8.81 - 2026-03-21
### Summary
Fix: LLM authoring prompt now instructs model to populate placeholder field per locale.

### Included
- **`public/admin-content.js`**: `buildAuthoringPrompt` schema note now mentions `placeholder` (locale object with guidance text). JSON shape template includes empty `placeholder` stubs per field so the LLM knows the expected structure.

## 0.8.80 - 2026-03-21
### Summary
UI: move locale selector to compact top-right position in participant console.

### Included
- **`public/participant.html`**: locale select moved from standalone card to a small `locale-select-compact` in the top-right of the page header row. Label is visually hidden (`sr-only`) for screen readers. Old card removed.

## 0.8.79 - 2026-03-21
### Summary
Refactor (#210): migrate reporting services to src/modules/reporting/.

### Included
- **`src/modules/reporting/`** (new): 6 files moved from `src/services/reporting/`:
  `types.ts`, `csvExport.ts`, `completionReport.ts`, `reviewAppealReport.ts`, `mcqSemanticReport.ts`, `dataQualityReport.ts`.
- **`src/modules/reporting/index.ts`**: barrel export with identical public API as the old `reportingService.ts` facade.
- **Deleted**: `src/services/reporting/` directory and `src/services/reportingService.ts`.
- **`src/routes/reports.ts`**: updated import to `../modules/reporting/index.js`.
- **`test/unit/reporting-service.test.ts`**: updated import paths.
- Fixed one internal import in `reviewAppealReport.ts`: `../recertificationService.js` → `../../services/recertificationService.js`.
- No functional changes.

## 0.8.78 - 2026-03-21
### Summary
Feat: per-field placeholder/guidance text on submission form fields.

### Included
- **`src/codecs/submissionSchemaCodec.ts`**: added `placeholder?: LocalizedText` to `SubmissionSchemaField`.
- **`src/routes/adminContent.ts`**: added `placeholder: localizedTextSchema.optional()` to the submission schema field validation so admins can author per-field guidance.
- **`src/modules/assessment/AssessmentInputFactory.ts`**: `parseSubmissionFieldLabels` now accepts an optional locale and appends placeholder text as `"Label (guidance: …)"` in the LLM prompt context when a field has a placeholder defined.
- **`test/unit/assessment-input-factory.test.ts`**: two new tests — plain placeholder appended to label, localized placeholder resolved to correct locale.

## 0.8.77 - 2026-03-21
### Summary
Refactor (#208): migrate assessment hotspot to src/modules/assessment/.

### Included
- **`src/modules/assessment/`** (new): 17 files moved from `src/services/` and `src/repositories/`:
  - Services: `AssessmentWorker.ts`, `AssessmentJobRunner.ts`, `assessmentJobService.ts`, `staleLockScanner.ts`, `AssessmentEvaluator.ts`, `llmAssessmentService.ts`, `secondaryAssessmentService.ts`, `AssessmentDecisionApplicationService.ts`, `decisionService.ts`, `assessmentDecisionSignals.ts`, `assessmentRedFlagPolicy.ts`, `mcqService.ts`, `AssessmentInputFactory.ts`, `documentParsingService.ts`, `sensitiveDataMaskingService.ts`.
  - Repositories: `assessmentJobRepository.ts`, `mcqRepository.ts`.
  - `index.ts` exports public API: `AssessmentWorker`, `enqueueAssessmentJob`, `processAssessmentJobsNow`, `processSubmissionJobNow`, `processNextJob`, `startMcqAttempt`, `submitMcqAttempt`.
- **Deleted** old files from `src/services/` and `src/repositories/`.
- **Consumers updated**: `src/routes/assessments.ts`, `src/routes/modules.ts`, `src/index.ts`, `src/services/submissionService.ts`, `src/scripts/runAssessmentBatchRegression.ts`, all affected tests.
- No functional changes.

## 0.8.76 - 2026-03-21
### Summary
Feat (#238): cancel superseded manual reviews and appeals when a participant retakes a module.

### Included
- **`prisma/schema.prisma`**: added `SUPERSEDED` value to `ReviewStatus` and `AppealStatus` enums.
- **`prisma/migrations/20260321000002_add_superseded_status_to_review_and_appeal`**: PostgreSQL `ALTER TYPE ... ADD VALUE` migration.
- **`src/modules/review/manualReviewRepository.ts`**: `findOpenByUserAndModule`, `supersedeMany`; updated status array type to include `SUPERSEDED`.
- **`src/modules/appeal/appealRepository.ts`**: `findOpenByUserAndModule`, `supersedeMany`; updated status array type to include `SUPERSEDED`.
- **`src/modules/review/manualReviewService.ts`**: SUPERSEDED guard in `claimManualReview` and `finalizeManualReviewOverride`; new exported `cancelSupersededReviews(userId, moduleId, newSubmissionId)`.
- **`src/modules/appeal/appealService.ts`**: SUPERSEDED guard in `claimAppeal` and `resolveAppeal`; new exported `cancelSupersededAppeals(userId, moduleId, newSubmissionId)`.
- **`src/modules/review/index.ts`**, **`src/modules/appeal/index.ts`**: export new cancel functions.
- **`src/services/submissionService.ts`**: calls `cancelSupersededReviews` and `cancelSupersededAppeals` after creating a new submission.
- **`src/routes/reviews.ts`**, **`src/routes/appeals.ts`**: `SUPERSEDED` added as a valid queryable status filter.
- **`src/i18n/notificationMessages.ts`**: `SUPERSEDED` notification templates for all 3 locales.
- **Tests**: 7 new unit tests across submission-service, manual-review-service, appeal-service.

## 0.8.75 - 2026-03-21
### Summary
Fix: prevent stale manual-review FAIL from downgrading a certification earned by a newer passing submission.

### Included
- **`src/repositories/decisionRepository.ts`**: `findDecisionWithSubmissionIdentifiers` now selects `submittedAt` from the submission.
- **`src/repositories/certificationRepository.ts`**: added `findByUserAndModule(userId, moduleId)` lookup.
- **`src/services/recertificationService.ts`**: `upsertRecertificationStatusFromDecision` now checks, before writing NOT_CERTIFIED, whether the existing certification has a `passedAt` that post-dates the current decision's `submission.submittedAt`. If so, the downgrade is skipped and `recertification_downgrade_skipped` is emitted via `logOperationalEvent`.
- **`test/unit/recertification-service.test.ts`**: three new cases covering no-prior-cert FAIL, downgrade-skipped scenario, and FAIL applying correctly when submission is newer.

## 0.8.74 - 2026-03-21
### Summary
Refactor (#209): migrate review and appeal to feature modules under src/modules/.

### Included
- **`src/modules/review/`**: `manualReviewRepository.ts`, `manualReviewService.ts`, `index.ts` (public API).
- **`src/modules/appeal/`**: `appealRepository.ts`, `appealService.ts`, `appealSla.ts`, `AppealSlaMonitor.ts`, `appealSlaMonitorService.ts`, `index.ts` (public API).
- Old files removed: `src/services/manualReviewService.ts`, `src/services/appealService.ts`, `src/services/appealSla.ts`, `src/services/AppealSlaMonitor.ts`, `src/services/appealSlaMonitorService.ts`, `src/repositories/appealRepository.ts`, `src/repositories/manualReviewRepository.ts`.
- Consumers updated: `routes/reviews.ts`, `routes/appeals.ts`, `routes/submissions.ts`, `src/index.ts`, `services/reporting/reviewAppealReport.ts`, all affected unit and integration tests.
- No functional changes.

## 0.8.73 - 2026-03-21
### Summary
Refactor (#231): standardize route error handling — all catch blocks converge to next(error).

### Included
- **`src/routes/audit.ts`**: simplified catch → `next(error)`; removed unused `AppError` import.
- **`src/routes/appeals.ts`**: both claim and resolve handlers — simplified catch → `next(error)`; removed `AppError` import.
- **`src/routes/reviews.ts`**: both claim and override handlers — simplified catch → `next(error)`; removed `AppError` import.
- **`src/routes/submissions.ts`**: createSubmission and createAppeal handlers — simplified catch → `next(error)`; removed `AppError`/`ValidationError` imports.
- **`src/routes/calibration.ts`**: GET workspace and POST publish-thresholds — simplified catch → `next(error)`; added `next` param to POST handler; removed `AppError` import.
- **`src/routes/modules.ts`**: mcq/start and mcq/submit — added `next` param, simplified catch → `next(error)`.
- **`src/routes/orgSync.ts`**: added `next` param, simplified catch → `next(error)`.

## 0.8.72 - 2026-03-21
### Summary
Test (#234): trim low-signal assertions from workspace and contract tests.

### Included
- **`test/workspace-validation-accessibility.test.js`**: removed 3 negative `not.toContain` assertions that guarded against re-introduction of already-removed HTML elements; improved comments.
- **`test/participant-translations.test.js`**: removed explicit enumeration of 17 domain-specific `improvementAdviceValue` content keys; replaced with a group-presence check; key-parity check already enforces completeness per locale.

## 0.8.71 - 2026-03-21
### Summary
Test (#233): table-driven RBAC matrix tests — full route family coverage, missing route families added.

### Included
- **`test/unit/rbac-matrix.test.ts`**: rewritten to table-driven `it.each` format; added `/api/assessments`, `/api/audit`, and `/api/calibration` coverage; 10 new tests (285 total).

## 0.8.70 - 2026-03-21
### Summary
Fix (#229, #230): gjør createSubmissionAppeal atomisk; audit av øvrige multi-step writes.

### Included
- **`src/services/appealService.ts`**: `createSubmissionAppeal` wrapper nå `createAppeal`, `updateSubmissionStatus` og `recordAuditEvent` i én `prisma.$transaction`. Notifikasjon forblir utenfor transaksjonen.
- **`test/unit/appeal-service.test.ts`**: mock oppdatert til tx-mønsteret; ny test verifiserer at begge skrivene skjer innenfor én transaksjon.
- `publishModuleVersionWithThresholds` — trenger refaktor av `publishModuleVersion` i repository (nestede transaksjoner ikke støttet i Prisma). Ny follow-up issue opprettes.

## 0.8.69 - 2026-03-21
### Summary
Fix (#225): generaliser rubrikk-kriterier fra smal AI/LLM use case — LLM forventer ikke lenger iterasjon, QA eller ansvarlig AI-bruk i generelle besvarelser.

### Included
- **`src/services/llmAssessmentService.ts`**: `DEFAULT_CRITERIA_IDS` erstattet med generiske kriterier (`task_comprehension`, `quality_and_depth`, `evidence_and_examples`, `reasoning_and_reflection`, `clarity_and_structure`); stub og improvement_advice gjort domeneuavhengige.
- **`prisma/seedCore.ts`**: seed-rubrikk oppdatert med de samme 5 generiske kriteriene.
- **`public/i18n/admin-content-translations.js`**: `defaults.criteriaJson` oppdatert til generiske kriterier.
- **`config/assessment-rules.json`**: fjernet AI-spesifikke aliases (`missing_mcq_and_notes`, `missing_iteration_and_qa`, `missing_iteration_qa`) fra `insufficient_submission`-kanonisering.

## 0.8.68 - 2026-03-21
### Summary
Refactor (#224): generaliser hardkodede restanser fra opprinnelig smal AI/LLM use case — generisk innleveringsskjema, oversettelser, seed-data og batch-testcaser.

### Included
- **`public/participant.js`**: `DEFAULT_SUBMISSION_FIELDS` redusert til kun `response`-felt (fjernet reflection og promptExcerpt).
- **`public/i18n/participant-translations.js`**: reflection- og promptExcerpt-etiketter gjort generiske i alle tre lokaler (en-GB, nb, nn).
- **`public/i18n/admin-content-translations.js`**: standardtekster for oppgave, veiledning og eksempler gjort domene-agnostiske; "Utdrag fra oppgave" → "Støttemateriale"; hjelpe-tekst for submissionSchema oppdatert.
- **`public/admin-content.js`**: promptExcerpt-label i felt-byggeren gjort generisk ("Supporting material").
- **`prisma/seedCore.ts`**: reflection og promptExcerpt fjernet fra seed-innlevering; standard oppgavetekst gjort generisk.
- **`src/scripts/assessmentBatchCases.ts`**: AI-spesifikke testcaser erstattet med domene-agnostiske ekvivalenter.

## 0.8.67 - 2026-03-21
### Summary
Fix: worker App Service krasjet fordi `prisma migrate deploy` feilet; hopper nå over migrasjoner med `SKIP_MIGRATE=true`.

### Included
- **`scripts/runtime/startup.mjs`**: respekterer `SKIP_MIGRATE=true` — hopper over `migrate deploy` (worker trenger ikke kjøre migrasjoner siden web-appen gjør det).
- **`infra/azure/main.bicep`**: legger til `SKIP_MIGRATE=true` i worker App Service-innstillinger.

## 0.8.66 - 2026-03-21
### Summary
Refactor: split reportingService into dedicated sub-modules (closes #196, #197, #198, #199).

### Included
- **`src/services/reporting/types.ts`** (ny): felles `ReportFilters`-type.
- **`src/services/reporting/csvExport.ts`** (ny): `toCsv`, `normalizeFilters`, `round2`, `buildDateRangeWhere` — delt CSV-eksport og filter-hjelpere (lukker #199).
- **`src/services/reporting/completionReport.ts`** (ny): `getCompletionReport`, `getPassRatesReport` (lukker #196).
- **`src/services/reporting/reviewAppealReport.ts`** (ny): `getManualReviewQueueReport`, `getAppealsReport`, `getRecertificationStatusReport` (lukker #197).
- **`src/services/reporting/mcqSemanticReport.ts`** (ny): `getMcqQualityReport`, `getAnalyticsSemanticModel`, `getAnalyticsTrendsReport`, `getAnalyticsCohortsReport` (lukker #198).
- **`src/services/reporting/dataQualityReport.ts`** (ny): `getReportingDataQualityReport` (lukker #198).
- **`src/services/reportingService.ts`**: konvertert til re-eksport-fasade — alle eksisterende importer forblir uendret.

## 0.8.65 - 2026-03-21
### Summary
Fix: deploy-retry og #190 extract shared decision lineage utility.

### Included
- **`scripts/azure/deploy-environment.ps1`**: `Invoke-WebAppDeploy` med 5 forsøk og 15s pause — fikser transient 502 fra Kudu SCM etter Bicep-oppdatering.
- **`src/services/decisionLineageService.ts`** (ny): `appendDecisionWithLineage` — felles utility for create decision + updateSubmissionStatus + upsertRecertification + audit event. Lukker #190.
- **`src/services/manualReviewService.ts`**: bruker `appendDecisionWithLineage`.
- **`src/services/appealService.ts`**: bruker `appendDecisionWithLineage`.

## 0.8.64 - 2026-03-21
### Summary
Ops: `alwaysOn: true` for web-rolle, separat worker App Service med `PROCESS_ROLE=worker`. Lukker #202.

### Included
- **`infra/azure/main.bicep`**: `alwaysOn: true` på web app. `PROCESS_ROLE=web` lagt til web app. Ny `workerApp`-ressurs med `PROCESS_ROLE=worker`, `alwaysOn: true` og diagnostics.
- **`src/index.ts`**: Minimal health-endpoint (port 8080) i worker-modus så Azure App Service anser prosessen som kjørende.
- **`scripts/azure/deploy-environment.ps1`**: Deployer zip til både web og worker. Kjører `Wait-Healthy` mot begge.

## 0.8.63 - 2026-03-21
### Summary
Refactor: Lokalisering og JSON-parsing flyttes fra moduleRepository til moduleService. Lukker #188.

### Included
- **`src/services/moduleService.ts`** (ny): Eksporterer `listModules`, `getModuleById`, `getActiveModuleVersion`, `listCompletedModulesForUser`. Anvender `localizeContentText`, `assessmentPolicyCodec.parse` og `submissionSchemaCodec.parse` på rå query-resultater fra repository-laget.
- **`src/repositories/moduleRepository.ts`**: Redusert til rene Prisma-spørringsfunksjoner uten lokalisering eller codec-kall. Eksporterer `queryModules`, `queryLatestSubmissionsForModules`, `queryCompletedSubmissionsForUser`, `queryModuleById`, `queryModuleVersion`, `getModuleWithActiveVersion`.
- **`src/routes/modules.ts`**: Importerer `listModules`, `getModuleById`, `getActiveModuleVersion`, `listCompletedModulesForUser` fra `moduleService.ts` i stedet for `moduleRepository.ts`.

## 0.8.62 - 2026-03-21
### Summary
Refactor: Fjerner rå Prisma-inputtyper fra repository-grensesnitt. Lukker #189.

### Included
- **`src/repositories/decisionRepository.ts`**: Eksporterer ny `CreateAssessmentDecisionInput`-type. Erstatter `Prisma.AssessmentDecisionUncheckedCreateInput` i `createAssessmentDecision`.
- **`src/repositories/appealRepository.ts`**: Importerer `CreateAssessmentDecisionInput` fra `decisionRepository.ts`. Fjerner `Prisma`-import.
- **`src/repositories/manualReviewRepository.ts`**: Samme som appealRepository.
- **`src/repositories/assessmentJobRepository.ts`**: Definerer og bruker `CreateAssessmentJobInput` og `CreateLlmEvaluationInput`. Fjerner `Prisma`-import.
- **`src/repositories/submissionRepository.ts`**: Definerer og bruker `CreateSubmissionInput`. Fjerner `Prisma`-import.

## 0.8.61 - 2026-03-21
### Summary
Refactor: Typed JSON codecs for alle domenefelt – assessmentPolicy, submissionSchema, localizedText, LLM-respons og redFlags. Lukker #193, #194, #195.

### Included
- **`src/codecs/assessmentPolicyCodec.ts`** (ny): Eksporterer `ModuleAssessmentPolicy`-type og `assessmentPolicyCodec` med `parse`/`serialize`. Type flyttes hit fra `decisionService.ts`.
- **`src/codecs/submissionSchemaCodec.ts`** (ny): Eksporterer `SubmissionSchema`/`SubmissionSchemaField`-typer og `submissionSchemaCodec` med `parse`/`serialize`.
- **`src/codecs/localizedTextCodec.ts`** (ny): Eksporterer `LocalizedText`/`LocalizedTextObject`-typer og `localizedTextCodec` med `parse` (dekod lagret streng) og `serialize`.
- **`src/codecs/llmResponseCodec.ts`** (ny): Flytter `llmResponseSchema` og `LlmStructuredAssessment`-type hit fra `llmAssessmentService.ts`. Eksporterer `llmResponseCodec` med `parse` (Zod-validert, kaster ved ugyldig) og `serialize`.
- **`src/codecs/redFlagsCodec.ts`** (ny): Eksporterer `AssessmentRedFlag`-type og `redFlagsCodec` med `parse` (returnerer `[]` ved feil) og `serialize`.
- **`test/unit/codecs.test.ts`** (ny): 27 enhetstester for alle 5 codecs – roundtrip, feilhåndtering, kanttilfeller.
- **Oppdaterte kallsteder**: `decisionService.ts`, `adminContentService.ts`, `calibrationWorkspaceService.ts`, `AssessmentInputFactory.ts`, `AssessmentEvaluator.ts`, `llmAssessmentService.ts`, `assessmentRedFlagPolicy.ts`, `moduleRepository.ts`, `routes/adminContent.ts`, `routes/submissions.ts` – alle ad-hoc `JSON.parse`/`JSON.stringify`-kall for disse feltene er erstattet med codec-kall.

## 0.8.60 - 2026-03-21
### Summary
Fix: Setter AUTH_MODE=mock i vitest.unit.config.ts for å løse 34 RBAC-testfeil.

### Included
- **`vitest.unit.config.ts`**: Legger til `env: { AUTH_MODE: "mock" }` i test-konfigen. Hindrer `dotenv/config`-import i `env.ts` fra å overskrive `AUTH_MODE` med verdien fra `.env` (`entra`), som forårsaket at alle RBAC-tester fikk 401 (Bearer-token mangler) i stedet for 403 (`requireAnyRole`).

## 0.8.59 - 2026-03-21
### Summary
Feat: Operasjonelt varsel for assessment-jobber som henger i RUNNING. Lukker #205.

### Included
- **`src/services/staleLockScanner.ts`**: Ny `alertOnStuckJobs()`-funksjon. Finner `RUNNING`-jobber der `lockedAt < now - ASSESSMENT_JOB_STUCK_THRESHOLD_MS` og emitterer ett `assessment_job_stuck_alert`-event på `"error"`-nivå per jobb, med `correlationId` (= jobId) i payload. Azure Monitor kan konfigureres til å varsle på dette event-navnet fra loggstrøm.
- **`src/config/env.ts`**: Legger til `ASSESSMENT_JOB_STUCK_THRESHOLD_MS` med standardverdi 600 000 ms (10 min).
- **`src/repositories/assessmentJobRepository.ts`**: Legger til `findLongRunningJobs(lockedBefore)`.
- **`src/services/AssessmentJobRunner.ts`**: Kaller `alertOnStuckJobs()` per poll-syklus (etter stale-lock reset).
- **`test/unit/stale-lock-scanner.test.ts`**: 3 nye tester for `alertOnStuckJobs`.
- Oppdaterte mock-definisjoner i `assessment-job-runner.test.ts`, `stale-lock-recovery.test.ts`, `assessment-job-service.test.ts`, `assessment-worker-process-error.test.ts`.

## 0.8.58 - 2026-03-21
### Summary
Test: Recovery-sti-tester for stale-lock-deteksjon og reset. Lukker #206.

### Included
- **`test/unit/stale-lock-recovery.test.ts`**: 5 nye integrasjonstester som simulerer hele recovery-stien: jobb stikker i RUNNING med utløpt lease → scanner resetter den → `processNextJob` plukker den opp og fullfører. Dekker også: max attempts → FAILED og ikke plukket opp, scanner-feil propagerer sikkert.
- **`test/unit/assessment-job-runner.test.ts`**: Oppdatert mock med `findExpiredRunningJobs` (returnerer `[]`) og `resetExpiredJob` slik at eksisterende tester ikke forstyrres av scanner-kallet.
- **`test/unit/assessment-job-service.test.ts`**: Samme mock-oppdatering.
- **`test/assessment-worker-process-error.test.ts`**: Samme mock-oppdatering.

## 0.8.57 - 2026-03-21
### Summary
Feat: Stale-lock scanner resetter utløpte RUNNING-jobber. Lukker #204.

### Included
- **`src/services/staleLockScanner.ts`**: Ny `scanAndResetStaleJobs()`-funksjon. Finner `RUNNING`-jobber der `leaseExpiresAt < now`, resetter dem til `PENDING` (eller `FAILED` hvis `attempts >= maxAttempts`), nullstiller låsfelter, og skriver audit-event + operasjonell logg per jobb.
- **`src/repositories/assessmentJobRepository.ts`**: Legger til `findExpiredRunningJobs(now)` og `resetExpiredJob(jobId, data)` (nullstiller `lockedAt`, `lockedBy`, `leaseExpiresAt`).
- **`src/services/AssessmentJobRunner.ts`**: Kaller `scanAndResetStaleJobs()` i starten av hver `processNextJob`-syklus.
- **`test/unit/stale-lock-scanner.test.ts`**: 4 nye enhetstester.

## 0.8.56 - 2026-03-21
### Summary
Feat: leaseExpiresAt på AssessmentJob og oppdatert lock-anskaffelse. Lukker #203.

### Included
- **`prisma/schema.prisma`**: Legger til `leaseExpiresAt DateTime?` på `AssessmentJob`-modellen, med ny index `@@index([status, leaseExpiresAt])` for stale-lock-scanner-query (#204).
- **`prisma/migrations/20260321000001_add_lease_expires_at_to_assessment_job/`**: Ny migrasjons-SQL (`ALTER TABLE "AssessmentJob" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3)` + CREATE INDEX).
- **`src/config/env.ts`**: Legger til `ASSESSMENT_JOB_LEASE_DURATION_MS` med standardverdi 300 000 ms (5 minutter).
- **`src/repositories/assessmentJobRepository.ts`**: `tryLockPendingJob` setter nå `leaseExpiresAt = now + leaseDuration`. `markJobSucceeded` og `markJobForRetryOrFailure` nullstiller `leaseExpiresAt`.
- **`src/services/AssessmentJobRunner.ts`**: Beregner og sender `leaseExpiresAt` til `tryLockPendingJob`.
- **`test/unit/assessment-job-repository.test.ts`**: Oppdatert test for `tryLockPendingJob` med nytt `leaseExpiresAt`-argument.

## 0.8.55 - 2026-03-21
### Summary
Test: Failure-injection-tester for transaksjonelle kommandostier. Lukker #212.

### Included
- **`test/unit/transactional-failure-injection.test.ts`**: 11 nye tester som simulerer DB-feil midt i `prisma.$transaction` for `createAssessmentDecision`, `finalizeManualReviewOverride` og `resolveAppeal`. Verifiserer at ingen etterfølgende skrivinger kalles ved feil (ingen partial state), og at notifikasjons-feil etter vellykket transaksjon svelges korrekt.

## 0.8.54 - 2026-03-20
### Summary
Refactor: Ekstraher AssessmentDecisionApplicationService fra assessmentJobService. Lukker #186.

### Included
- **`src/services/AssessmentDecisionApplicationService.ts`** (#186): Ny dedikert modul som orkestrerer den siste fasen av en assessmentjobb: oppretter beslutning via `createAssessmentDecision` (allerede transaksjonell i `decisionService.ts`), sender deltakervarsling og skriver jobbberedningsevent til audit-loggen.
- **`src/services/assessmentJobService.ts`**: Er nå et tynt orkestreringssjikt som kobler `AssessmentJobRunner`, `AssessmentInputFactory`, `AssessmentEvaluator` og `AssessmentDecisionApplicationService`. Ingen adferdsendringer.
- **`test/unit/assessment-decision-application-service.test.ts`**: Nye enhetstester for `applyAssessmentDecision` — dekker varsling ved autovedtak, manglende varsling ved manuell gjennomgang, feilhåndtering av varsling (swallows) og videreføring av `forceManualReviewReason`.

## 0.8.53 - 2026-03-20
### Summary
Refactor: Ekstraher AssessmentEvaluator fra assessmentJobService. Lukker #185.

### Included
- **`src/services/AssessmentEvaluator.ts`** (#185): Ny dedikert modul som isolerer LLM-kallene, responsregistrering i databasen og sekundærvurderingslogikk. Eksporterer `runLlmEvaluationPipeline` som returnerer `EvaluationResult` (det endelige LLM-resultatet og valgfri `forceManualReviewReason`).
- **`src/services/assessmentJobService.ts`**: Bruker nå `runLlmEvaluationPipeline` i stedet for inlined LLM-kall og sekundærlogikk. Ingen adferdsendringer.
- **`test/unit/assessment-evaluator.test.ts`**: Nye enhetstester for `runLlmEvaluationPipeline` — dekker primærsti, sekundærtriggering, uenighetsrouting og feilhåndtering for begge passeringer.

## 0.8.52 - 2026-03-20
### Summary
Refactor: Ekstraher AssessmentInputFactory fra assessmentJobService. Lukker #184.

### Included
- **`src/services/AssessmentInputFactory.ts`** (#184): Ny dedikert modul som håndterer inndataforberedelse for LLM-evaluering: parsing av rubrikk-kriterie-IDer (`parseRubricCriteriaIds`), maksimal totalpoengsum (`parseRubricMaxTotal`), innsendingsfeltmerker (`parseSubmissionFieldLabels`), sensitiv dataforbehandling og lokaliseringsoppslag. Eksporterer `buildAssessmentInputContext` som produserer et komplett `AssessmentInputContext`-objekt.
- **`src/services/assessmentJobService.ts`**: Bruker nå `buildAssessmentInputContext` i stedet for inline parserhjelperere. Ingen adferdsendringer.
- **`test/unit/assessment-input-factory.test.ts`**: Nye enhetstester for parsere og `buildAssessmentInputContext` — dekker objektformat, arrayformat, ugyldige JSON, null-schema og policy-parsing.

## 0.8.51 - 2026-03-20
### Summary
Refactor: Ekstraher AssessmentJobRunner fra assessmentJobService. Lukker #183.

### Included
- **`src/services/AssessmentJobRunner.ts`** (#183): Ny dedikert modul for køpoll, joblåsing, retry-logikk og overordnet feilhåndtering. Eksporterer `enqueueAssessmentJob`, `processNextJob`, `processAssessmentJobsNow` og `processSubmissionJobNow` med injiserbar `AssessmentRunFn` for testbarhet.
- **`src/services/assessmentJobService.ts`**: Beholder samme offentlige API ved å re-eksportere fra `AssessmentJobRunner` og tilpasse de eksisterende funksjonene til å bruke den nye modulen. Ingen adferdsendringer.
- **`test/unit/assessment-job-runner.test.ts`**: Nye enhetstester for `AssessmentJobRunner` — dekker lås-mislykkelse, retry-planlegging, FAILED-markering og enqueueing av nye jobber.

## 0.8.50 - 2026-03-20
### Summary
Feat: Prisma $transaction-wrapping for kritiske domene-mutasjoner. Lukker #179, #180, #181, #182.

### Included
- **`src/services/decisionService.ts`** (#179): `createAssessmentDecision` er nå pakket inn i `prisma.$transaction`. Alle DB-skrivinger bruker `createDecisionRepository(tx)`; `recordAuditEvent` og `upsertRecertificationStatusFromDecision` mottar `tx` for å delta i samme transaksjon.
- **`src/services/manualReviewService.ts`** (#180, #182): `finalizeManualReviewOverride` bruker `prisma.$transaction` for `createOverrideDecision`, `resolveManualReview` og `updateSubmissionStatus`. `notifyAssessmentResult` kalles etter at transaksjonen er committed.
- **`src/services/appealService.ts`** (#181, #182): `resolveAppeal` bruker `prisma.$transaction` for `createResolutionDecision`, `markAppealResolved` og `updateSubmissionStatus`. Notifikasjon skjer allerede utenfor transaksjonsblokken.
- **`src/services/auditService.ts`**: `recordAuditEvent` aksepterer nå en valgfri `tx`-parameter for å delta i en aktiv transaksjon.
- **`src/services/recertificationService.ts`**: `upsertRecertificationStatusFromDecision` aksepterer nå en valgfri `tx`-parameter; bruker repository-factory-funksjoner internt.
- **`test/unit/`**: Oppdaterte tester for `decision-service`, `manual-review-service`, `appeal-service` og `recertification-service` — mocker `prisma.$transaction` og repository-fabrikkfunksjoner; assertions bruker `expect.anything()` for `tx`-argumentet.

## 0.8.49 - 2026-03-20
### Summary
Feat: PROCESS_ROLE env var med web/worker/all-modus. Lukker #200, #201.

### Included
- **`src/config/env.ts`**: Legger til `PROCESS_ROLE: z.enum(["web","worker","all"]).default("all")`.
- **`src/index.ts`**: Startup er nå betinget — `web` starter kun HTTP + bootstrapSeed; `worker` starter kun AssessmentWorker + AppealSlaMonitor; `all` er eksisterende atferd. Graceful shutdown bruker optional chaining siden workers kan være null.
- **`.env.example`**: Dokumenterer `PROCESS_ROLE=all` med kommentar.

## 0.8.48 - 2026-03-20
### Summary
Fix: MCQ-dialog viste norsk tittel på EN-GB-fane.

### Included
- **`public/admin-content.js`**: `openMcqDialog` bruker nå `parsed["en-GB"]` i stedet for `localizeContentValue` for å hente tittelen fra et lokaliseringsobjekt — sikrer at en-GB-verdien alltid vises i det enkle tittfeltet, uavhengig av `currentLocale`.

## 0.8.47 - 2026-03-20
### Summary
Fix: MCQ-dialog viste rå JSON i tittelfelt når tittel var et lokaliseringsobjekt.

### Included
- **`public/admin-content.js`**: `openMcqDialog` parser nå `mcqSetTitleInput.value` som JSON og trekker ut det lokaliserte tittelen via `localizeContentValue` i stedet for å vise den rå JSON-strengen (f.eks. `{"en-GB":"...","nb":"...","nn":"..."}`). Lagring fortsetter å fungere som normalt — plain string lagres tilbake til `mcqSetTitleInput` ved apply.

## 0.8.46 - 2026-03-20
### Summary
Fix: i18n-paritetsfeil — `adminContent.moduleVersion.fillDefaultPolicy` manglet i en-GB baseline.

### Included
- **`public/i18n/admin-content-translations.js`**: La til manglende `adminContent.moduleVersion.fillDefaultPolicy` ("Fill in defaults") i `adminContentBase`. nb og nn hadde nøkkelen; en-GB manglet den, noe som brøt `admin-content-translations.test.js` paritetssjekktest med 479 vs 478 nøkler.

## 0.8.45 - 2026-03-20
### Summary
UX: Fjernet X-knapp øverst i dialogbokser, tydeligere slette-knapper, kompakt tittellinje.

### Included
- **`public/admin-content.html`**: Fjernet `field-dialog-close` X-knapp fra alle 7 dialoger — Cancel-knappen nedst er nok. Slette-knapper (`mcq-q-remove`, `mcq-opt-remove`, `prompt-ex-remove`, `ss-field-remove`) bruker nå `var(--color-error)` i stedet for `var(--color-meta)`; 0.7 opacity default, full opacity hover. Dialog-tittelen er nå 16px (var 18px) med `white-space: nowrap` og `text-overflow: ellipsis` — én linje alltid.

## 0.8.44 - 2026-03-20
### Summary
Refactor: Standardiserte API-feilresponser (#159) og ekstraherte delte query-parsere (#160).

### Included
- **`src/middleware/errorHandling.ts`**: Logger uventede feil med correlationId via `logOperationalEvent`; returnerer generisk melding `"An unexpected error occurred."` istedenfor `error.message`. Dekker issue #159.
- **`src/routes/*.ts`** (8 filer): Erstattet `error instanceof Error ? error.message : "fallback"` med den statiske fallback-strengen i alle catch-blokker. Interne feilmeldinger lekkes ikke lenger til klienten. Dekker issue #159.
- **`src/routes/helpers/queryParsing.ts`** (ny): `parseQueryDate` og `parseCsvFilter` — delte query-parameter-hjelpere. Dekker issue #160.
- **`src/routes/calibration.ts`** og **`src/routes/reports.ts`**: Bruker nå `parseQueryDate`/`parseCsvFilter` fra shared helper; duplikat `parseDate` og CSV-logikk fjernet.
- **`test/app-error-middleware.test.ts`**: Oppdatert test — verifiserer nå at intern feilmelding IKKE lekkes (det korrekte).

## 0.8.43 - 2026-03-20
### Summary
Docs: Fullstendig dokumentasjonsrydding — config-referanse, ops-runbook, GETTING_STARTED, API_REFERENCE, DOMAIN_LIFECYCLE, og README omskrevet til indeks. Lukker #217, #216, #214, #215.

### Included
- **`doc/CONFIG_REFERENCE.md`** (ny): Felt-for-felt referanse for alle 8 config-filer i `config/`. Dekker issue #217.
- **`doc/OPERATIONS_RUNBOOK.md`** (ny): Prosessmodell, oppstartssekvens, migrasjoner, seeding, worker-helse, vanlige feilstater (DB nede, LLM-feil, stale jobs, notification-feil), og correlationId-tracing. Dekker issue #216.
- **`doc/GETTING_STARTED.md`** (ny): Lokal setup, PostgreSQL-automatisering, testkommandoer, auth/LLM-modus, og manuelle workspace-gjennomganger for alle roller. Dekker hoveddelen av issue #214.
- **`doc/API_REFERENCE.md`** (ny): Alle API-ruter med metode, path og påkrevde roller i tabellformat. Dekker issue #214.
- **`doc/DOMAIN_LIFECYCLE.md`** (ny): Tilstandsmaskiner for submission, assessment job, manual review og appeal. Beslutningslinjen og immutabilitetsregelen. RBAC-eiermodellen med claim-ownership-regel. Dekker issue #215.
- **`README.md`** (omskrevet): Fra 424 linjer til kort indeks med lenker til alle doc-filer. Dekker issue #214.

## 0.8.42 - 2026-03-20
### Summary
Refactor: Replace over-specified HTML/CSS/JS assertions in workspace contract tests with smoke tests (issues #177, #178).

### Included
- **`test/workspace-validation-accessibility.test.js`**: Erstattet 7 over-spesifiserte assertions: CSS-selektorer med braces-format krav (`".hint {"`) → `.hint`; Unicode-encoding krav → sjekker `"\\2139"`; `classList.add("field-error")`-mønster → `"field-error"` (class name). Fjernet `"review?.reviewer?.email"` (implementasjonsdetalj). Negative assertions for fjernede elementer beholdt som regresjonsguarder.

## 0.8.41 - 2026-03-20
### Summary
Test: 36 negative config validation tests for `assessment-rules.json` zod schema (issue #213). Exports `rulesSchema` for direct unit-test access.

### Included
- **`src/config/assessmentRules.ts`**: Eksporterer `rulesSchema` (var privat).
- **`test/unit/assessment-rules-config.test.ts`**: 36 tester i 7 describe-blokker — baseline gyldighet, `thresholds` utenfor verdiområde, `weights` min(1)-brudd, `manualReview`-struktur (inkl. dokumenterte schema-gap: tom array og inverted borderline godtas), `mcqQuality`-begrensninger, `recertification`-begrensninger, manglende påkrevde seksjoner og `sensitiveData`-regelstruktur. Dekker issue #213.

## 0.8.40 - 2026-03-20
### Summary
Test: 21 nye unit-tester for `resolveAssessmentDecision` og 34 RBAC-denialtester uten DB-avhengighet.

### Included
- **`test/unit/decision-service.test.ts`**: Nye describe-blokker for score/practicalPercent-beregning, borderline-vindu (grenser, policy-override), practicalMinPercent/mcqMinPercent-porter via policy, red flag-ruting og decision-reason-strenger. Totalt 36 tester (+21 nye). Dekker issues #174, #175, #176.
- **`test/unit/rbac-matrix.test.ts`**: Ny testfil — 34 RBAC-denialtester for `/api/reviews`, `/api/appeals`, `/api/admin/content`, `/api/admin/sync/org`, `/api/reports`, `/api/submissions`. Kjøres uten database ved å mocke `userRepository`. Dekker issue #211.

## 0.8.39 - 2026-03-19
### Summary
Feat: Dialog-basert redigering for LLM-prompt (#153), flervalgsspørsmål (#148) og innleveringsskjema (#151) — alle JSON-seksjoner er nå kollapset i `<details>`-paneler.

### Included
- **`admin-content.html`**: Tre nye `<dialog>`-elementer (`dialogPrompt`, `dialogMcq`, `dialogSubmissionSchema`). Seksjonene 6 (Prompt), 7 (MCQ) og submissionSchema-feltet i seksjon 8 er pakket inn i `<details class="json-fallback-panel">`. Redigerings-knapper for prompt, mcq og submissionSchema kobler nå til dialogen i stedet for å scrolle.
- **`admin-content.js`**: `openPromptDialog`/`applyPromptDialog` med lokale tabs og dynamisk eksempelliste. `openMcqDialog`/`applyMcqDialog` med dynamisk spørsmålsliste, alternativer per spørsmål og lokale tabs. `openSubmissionSchemaDialog`/`applySubmissionSchemaDialog` med dynamisk feltliste og lokale tabs. Alle event-listeners koblet opp.
- **`i18n/admin-content-translations.js`**: Nye i18n-nøkler for alle tre dialoger i EN-GB, NB og NN.

## 0.8.38 - 2026-03-19
### Summary
UX: JSON-felter som er migrert til dialoger vises nå i kollapset `<details>`-panel — synkronisert med dialogverdiene.

### Included
- **`admin-content.html`**: Seksjon 5 (Rubrikk) er synlig igjen, men all JSON er pakket i `<details class="json-fallback-panel">`. I seksjon 8 er `moduleVersionTaskText`, `moduleVersionGuidanceText` og `moduleVersionAssessmentPolicy` pakket i eget `<details>`-panel; `moduleVersionSubmissionSchema` forblir åpent inntil dialog #151 er ferdig.
- **`i18n/admin-content-translations.js`**: Summary-tekster for collapse-panelene (EN-GB, NB, NN).
- Synkronisering er automatisk: dialogene leser fra og skriver til de samme textarea-inputs.

## 0.8.37 - 2026-03-19
### Summary
UX: Skjuler seksjon 5 (Rubrikk) nå som den er fullt erstattet av rubrikk-dialogen.

### Included
- **`admin-content.html`**: `sectionRubric` har fått `hidden` — inputs forblir i DOM for at dialogen skal fungere, men seksjonen er ikke lenger synlig.

## 0.8.36 - 2026-03-19
### Summary
Feat: Strukturert vurderingspolicy-dialog med tallfelter for vekting, beståttkrav og grenseområde (#152).

### Included
- **`admin-content.html`**: Ny `<dialog id="dialogAssessmentPolicy">` med tre seksjoner: vekting (practicalWeight, mcqWeight), beståttkrav (totalMin, practicalMinPercent, mcqMinPercent) og grenseområde (borderlineWindow min/max). Rediger-knapp på Vurderingspolicy-kortet har fått `id="editBtn_assessmentPolicy"`.
- **`admin-content.js`**: `openAssessmentPolicyDialog()` og `applyAssessmentPolicyDialog()` — parser og skriver tilbake til `moduleVersionAssessmentPolicyInput`. Validerer at totalMin er satt og innenfor 0–100.
- **`i18n/admin-content-translations.js`**: Nye nøkler for `adminContent.dialog.assessmentPolicy.*` (EN-GB, NB, NN).

## 0.8.35 - 2026-03-19
### Summary
Feat: Strukturert rubrikk-dialog — kriterieliste med add/remove, beståttregel og skaleringstregel (#149).

### Included
- **`admin-content.html`**: Ny `<dialog id="dialogRubric">` med dynamisk kriterieliste (ID, tittel, vekt per rad), beståttregel (minimumspoeng, alle-kriterier-over) og skaleringstregel (type, maksimumspoeng). CSS for `.dialog-section-label` og `.rubric-criterion-row`. Rediger-knapp på Rubrikk-kortet har fått `id="editBtn_rubric"`.
- **`admin-content.js`**: `openRubricDialog()`, `addRubricCriterionRow()`, `applyRubricDialog()` — parser eksisterende JSON, populerer DOM med strukturerte felter, serialiserer tilbake. Bevarer eksisterende `levels` fra scalingRule. Validering med i18n-feilmeldinger.
- **`i18n/admin-content-translations.js`**: Nye nøkler for `adminContent.dialog.rubric.*` (EN-GB, NB, NN).

## 0.8.34 - 2026-03-19
### Summary
Feat: Dialog for redigering av versjonsdetaljer (taskText / guidanceText) med lokaliseringsfaner (#150).

### Included
- **`admin-content.html`**: Ny `<dialog id="dialogVersionDetails">` med locale-faner (EN-GB / NB / NN) og to tekstfelter per lokale (oppgavetekst, veiledning). Rediger-knapp på Versjonsdetaljer-kortet har fått `id="editBtn_versionDetails"`.
- **`admin-content.js`**: `openVersionDetailsDialog()` og `applyVersionDetailsDialog()` — populerer og skriver tilbake til `moduleVersionTaskTextInput` / `moduleVersionGuidanceTextInput`. Event listeners for close/cancel/apply/tabs/Escape.
- **`i18n/admin-content-translations.js`**: Nye nøkler for `adminContent.dialog.versionDetails.*` (EN-GB, NB, NN).

## 0.8.33 - 2026-03-19
### Summary
Fix: `submissionSchemaJson` fra LLM-output ble ikke lest inn i skjemaet — felt-nøkkel stemte ikke med variabelnavnet i koden.

### Included
- **`admin-content.js`**: `applyImportDraftToForm` leser nå `moduleVersion.submissionSchemaJson ?? moduleVersion.submissionSchema` — håndterer både LLM-format (`submissionSchemaJson`) og API-serverformat (`submissionSchema`).

## 0.8.32 - 2026-03-19
### Summary
Fix: Prompt-instruksjon til LLM spesifiserer nå eksakt antall felt og feltID-er — forhindrer at LLM legger til ekstra innleveringsfelt.

### Included
- **`admin-content.js`**: `buildAuthoringPrompt` sin `schemaNote` nevner nå eksplisitt antall felt og alle felt-ID-er (f.eks. «MUST contain EXACTLY 1 field with id ["response"]»), slik at LLM-en ikke legger til `reflection` eller `promptExcerpt` når disse ikke er valgt.

## 0.8.31 - 2026-03-19
### Summary
Fix: `defaultValue` i innleveringsfelt er nå et lokalisert objekt — LLM genererer modulspesifikke eksempelsvar for alle lokaliteter.

### Included
- **`admin-content.js`**: `resolvePromptFields()` sender nå `defaultValue: {"en-GB": "", "nb": "", "nn": ""}` (lokalisert objekt) som feltmal til LLM-en i stedet for en tom streng. LLM instrueres til å fylle inn realistiske, modulspesifikke eksempeltekster for hver lokalitet.
- **`participant.js`**: `resetModuleDraftInputsToDefaultLocaleValues()` og `hasMeaningfulStoredDraft()` bruker nå `localizePreviewText(field.defaultValue)` for å håndtere både strenger og lokaliserte objekter som `defaultValue`.

## 0.8.30 - 2026-03-19
### Summary
UX: «Bruk utkast-JSON» oppretter modulen automatisk, og innholdskort oppdateres korrekt etter modulopprettelse.

### Included
- **`admin-content.js`**: `handleApplyImportDraft` oppretter nå modulen automatisk (via `handleCreateModule({ silent: true })`) når ingen modul er valgt og utkastet inneholder moduldetaljer. Eliminerer behovet for et separat «Opprett modul»-steg ved JSON-import. `handleCreateModule` kaller nå `renderContentCards()` etter at `savedVersionFields` er gjenopprettet, og markerer innholdskortene som ulagret — kortene viste feil «(not set)» selv om tekstfeltene hadde innhold.
- **`i18n/admin-content-translations.js`**: Ny nøkkel `adminContent.message.importAppliedWithModule` med veiledning om neste steg (alle lokaliteter).

## 0.8.29 - 2026-03-19
### Summary
Fix: Innleveringsskjema viser ikke lenger generiske hardkodede standardverdier — defaults er nå modulspesifikke og kommer fra submissionSchema.

### Included
- **`participant.js`**: Fjernet `defaultValueKey` fra `DEFAULT_SUBMISSION_FIELDS` — ingen forhåndsutfylte tekster for standardskjemaet. `getSubmissionFields()` sender nå `defaultValue` fra schema-felt videre. `resetModuleDraftInputsToDefaultLocaleValues()` og `hasMeaningfulStoredDraft()` bruker `field.defaultValue` (tom streng hvis ikke definert).
- **`admin-content.js`**: `resolvePromptFields()` inkluderer `defaultValue: ""` i feltmalen så LLM-en vet at den skal fylle inn modulspesifikke eksempelsvar. `buildAuthoringPrompt` instruerer LLM-en til å skrive realistiske og modulrelevante `defaultValue`-tekster.

## 0.8.28 - 2026-03-19
### Summary
UX: Vurderingspolicy auto-fylles med standard når feltet er tomt ved modul-last og draft-import.

### Included
- **`admin-content.js`**: `fillDefaultAssessmentPolicy()` kalles automatisk i `populateFormFromModuleExport()` og `applyImportDraftToForm()` når policy-feltet er tomt etter lasting. Fjernet eksplisitt «Fyll inn standard»-knapp (auto-fill er bedre UX).
- **`admin-content.html`**: Fjernet «Fyll inn standard»-knappen.

## 0.8.27 - 2026-03-19
### Summary
UX: Admin Content — tydelig ELLER-skille mellom startpunktene, samlet lagre-logikk, "Publiser siste versjon" i innholdsoversikten, og standardmal for vurderingspolicy.

### Included
- **`admin-content.html`**: Visuell "ELLER"-separator mellom seksjon 1 (import) og seksjon 2 (manuell opprettelse). "Fyll inn standard"-knapp ved vurderingspolicy-feltet i seksjon 8. "Publiser siste versjon"-knapp i innholdsoversikten (vises når en lagret modulversjon-ID finnes).
- **`admin-content.js`**: `fillDefaultAssessmentPolicy()` fyller ut standard policy basert på om MCQ er konfigurert (60/40 split med MCQ, 100/0 uten). Event listeners for de to nye knappene. `renderContentCards()` viser/skjuler publiser-knappen basert på om `publishModuleVersionId` er satt.
- **`i18n/admin-content-translations.js`**: Fikset feilaktig "steg 3-6" i `bundleSaved`-melding til "steg 5–8" (alle lokaliteter). Omdøpte `saveBundle`-knapp til "Lagre alle endringer" (matcher nå innholdsoversiktens knapp). Lagt til nøkler: `startPath.or`, `cards.publish`, `moduleVersion.fillDefaultPolicy`.

## 0.8.26 - 2026-03-19
### Summary
Fix: staging startup-krasj — prisma db push feilet på _manual_migrations-tabellen.

### Included
- **`package.json`**: `prestart` får nå `--accept-data-loss` slik at `prisma db push` ikke avbryter når den finner tabeller fjernet fra schema. Rotårsak: SQLite-filen `/home/site/data/app.db` er persistent og inneholdt `_manual_migrations` (7 rader) som ikke lenger finnes i schema.prisma — uten flagget krasjet Prisma og 503 på alle container-restarter etter første deploy.

## 0.8.25 - 2026-03-18
### Summary
MVP: Innholdskort-oversikt og dialog for moduldetaljer i Admin Content (#135 – #145, #146, #147).

### Included
- **`admin-content.html`**: Ny seksjon "Content overview" med 7 innholdskort (Moduldetaljer, Versjonsdetaljer, Vurderingsregler, Vurderingspolicy, LLM-prompt, Flervalgstest, Innleveringsskjema). Hvert kort viser read-only sammendrag + "Rediger"-knapp. Knapper for seksjonene uten dialog scroller til tilsvarende skjemafelt. Ny `<dialog id="dialogModuleDetails">` med lokaliseringsfaner (EN-GB / NB / NN) for tittel, beskrivelse og sertifiseringsnivå. CSS for kart-grid, dialog-modal og lokaliserings-faner. IDs lagt til eksisterende seksjoner 5–8 for scroll-navigasjon.
- **`admin-content.js`**: `dirtyCards`-sett for å spore ulagrede dialogendringer. `renderContentCards()` oppdaterer kortvisning fra eksisterende skjemainputs. `openModuleDetailsDialog()` / `applyModuleDetailsDialog()` håndterer fokus, faner og tilbakeskrivning til eksisterende inputs. `setActiveDialogLocaleTab()` og `closeFieldDialog()` med fokusretur til trigger. Scroll-til-seksjon for ikke-implementerte kort. "Lagre alle endringer"- og "Forhåndsvis"-knapper i kortvisningen kaller eksisterende `handleSaveContentBundle()` og `handleOpenParticipantPreview()`. `dirtyCards` ryddes ved modul-last, import og bundle-lagring. `renderContentCards()` kalles fra `applyTranslations()` og ved initialisering.
- **`i18n/admin-content-translations.js`**: Nye nøkler for kort og dialog i alle tre lokaliteter (en-GB, nb, nn).
- **`doc/design/ADMIN_CONTENT_DIALOG_REDESIGN.md`**: Designdokument for #135 (nytt).

## 0.8.24 - 2026-03-18
### Summary
Kompakt modullistevisning ved 6+ moduler (#136).

### Included
- **`participant.html`**: CSS for `.module-list.compact` — tettere gap, enkeltrad per kort med flex-layout, venstrebord på valgt modul, tittel avkortes med ellipsis, badges vises som minipills.
- **`participant.js`**: `renderModules()` setter `compact`-klassen automatisk ved ≥ 6 moduler. I kompakt modus skjules beskrivelse, statusmeta og selected-badge (valgt modul markeres med venstrebord). Alle `aria-pressed`/tastaturegenskaper bevares.

## 0.8.23 - 2026-03-18
### Summary
Fix: ACS e-postvarsler feilet pga. feil senderAddress-format — visningsnavn skal ikke embeddes i adressefeltet.

### Included
- **`participantNotificationService.ts`**: `senderAddress` settes nå til plain e-postadresse (`ACS_EMAIL_SENDER`). Den tidligere koden la visningsnavn inn som `"Navn <epost>"` — et format ACS-SDK-en ikke aksepterer i `senderAddress`-feltet. Rotårsak til alle `participant_notification_failed`-hendelser siden varsling ble aktivert.

## 0.8.22 - 2026-03-18
### Summary
Fix: beslutningsetikett viser nå "Automatisk bestått" / "Automatisk ikke bestått" i stedet for bare "Automatisk".

### Included
- **`participant.js`**: `localizeDecisionType` tar nå `passFailTotal` og velger `AUTOMATIC_PASS`/`AUTOMATIC_FAIL`-nøkkel for automatiske beslutninger.
- **`participant-translations.js`**: Nye nøkler `result.decisionValue.AUTOMATIC_PASS` og `AUTOMATIC_FAIL` i en-GB, nb, nn.

## 0.8.21 - 2026-03-18
### Summary
Fix: fargeindikatorer brukte feil felt (decisionType) — skal bruke passFailTotal.

### Included
- **`participant.js`**: `outcomeClass` tar nå `passFailTotal` (boolean) + status i stedet for `decisionType`-streng. DecisionType er alltid "AUTOMATIC" og skiller ikke mellom bestått/ikke bestått.

## 0.8.20 - 2026-03-18
### Summary
Diskrete fargeindikatorer (grønn/gul/rød) på evalueringsresultat i Participant-siden.

### Included
- **`shared.css`**: Nye klasser `.outcome--pass`, `.outcome--review`, `.outcome--fail` — farget tekst + diskret ●-punkt foran.
- **`participant.js`**: `appendSummaryRow` støtter valgfri `valueClass`; `outcomeClass(decisionType, status)` helper. Decision-raden i resultat-summary og historikk farges.
- **`participant-completed.js`**: Pass/fail-kolonnen i ferdigstilte moduler farges grønn/rød.

## 0.8.19 - 2026-03-18
### Summary
Calibration threshold UI reorganized into three sections (Total / Sone for manuell vurdering / Innlevering / Flervalgsspørsmål); "rubrikk"-terminologi fjernet; backend-fix: practicalMinPercent-porten hoppes over for moduler uten vurderingskomponent (rubricMaxTotal === 0).

### Included
- **`calibration.html`**: Threshold editor delt i tre seksjoner med `<h3>`-overskrifter: Total, Sone for manuell vurdering, Innlevering, Flervalgsspørsmål. Borderline-feltene flyttet under Total.
- **`calibration-translations.js`**: Ny seksjonsnøkler (`section.total`, `section.manualReview`, `section.practical`, `section.mcq`) i en-GB/nb/nn. Alle hjelpetekster oppdatert uten "rubrikk". MCQ-felt bruker nå "flervalgsspørsmål" i norsk.
- **`decisionService.ts`**: `practicalPercent` settes til `null` når `rubricMaxTotal === 0`; `passesThresholds` hopper over praktisk-porten når `null`. Fikser bug der moduler uten innleveringskomponent alltid feilet.

## 0.8.18 - 2026-03-18
### Summary
Calibration threshold tuning (#143) — per-module borderlineWindow, practicalMinPercent, mcqMinPercent via assessmentPolicyJson; publish-thresholds endpoint; calibration UI with live preview and publish action.

### Included
- **`decisionService.ts`**: Extended `ModuleAssessmentPolicy.passRules` with `practicalMinPercent`, `mcqMinPercent`, `borderlineWindow`. `resolveAssessmentDecision` now derives per-module-or-global values for all five threshold variables.
- **`calibrationRepository.ts`**: `findModuleSummary` now selects `activeVersionId` and full `activeVersion` (including `assessmentPolicyJson`).
- **`adminContentRepository.ts`**: New `findActiveModuleVersionForClone` method for cloning the active version when publishing thresholds.
- **`adminContentService.ts`**: New exported function `publishModuleVersionWithThresholds` — clones active version with merged threshold overrides in `assessmentPolicyJson`, publishes it, and records a `calibration_thresholds_published` audit event.
- **`calibrationWorkspaceService.ts`**: Computes `effectiveThresholds` (source: `module_policy` | `global_defaults`) from module policy + global rules; includes it in the snapshot response; includes `activeVersionId` in returned module object.
- **`routes/calibration.ts`**: New POST `/workspace/publish-thresholds` route with Zod validation, role guard (ADMINISTRATOR or SUBJECT_MATTER_OWNER), and cross-field refinements (borderlineMin ≤ borderlineMax ≤ totalMin).
- **`routes/adminContent.ts`**: Extended `assessmentPolicyBodySchema.passRules` with optional `practicalMinPercent`, `mcqMinPercent`, `borderlineWindow`.
- **`public/calibration.html`**: Threshold editor card (`thresholdEditorSection`) with five inputs, band preview, validation error, publish button, and result area — starts hidden.
- **`public/calibration.js`**: `renderThresholds`, `updateThresholdPreview`, `validateThresholds`, input event listeners, publish button handler (POST + workspace reload), integration in `renderWorkspace`.
- **`public/i18n/calibration-translations.js`**: All threshold translation keys added for en-GB, nb, and nn.

## 0.8.17 - 2026-03-18
### Summary
Modulvelger (nedtrekk) på kalibreringsside (#142) og fix av appeal-repository-test etter #140.

### Included
- **#142 Modulvelger**: `GET /api/modules?adminFacing=true` returnerer alle moduler for SMO/Admin. Kalibreringsside bruker nå nedtrekk populert på oppstart i stedet for fritekstfelt for modul-ID
- **i18n**: `calibration.filters.moduleSelectPlaceholder` lagt til for en-GB, nb, nn
- **Test**: `appeal-repository.test.ts` oppdatert med `module: { select: { title: true } }` i forventet Prisma-kall etter #140-endring

## 0.8.16 - 2026-03-18
### Summary
Fikser test-feil i appeal-service og manual-review-service unit-tester forårsaket av manglende `module`/`user`/`locale` i test-fixtures etter #140-implementasjon.

### Included
- **Test-fixtures**: `findOwnedSubmissionWithLatestDecision` og `findAppealForResolution` mock-verdier utvidet med `module.title`
- **Test-fixtures**: `findManualReviewForOverride` mock utvidet med `module.title`, `user`, `locale`, `id`, `moduleId`, `submittedAt`
- **Test-mocks**: `notifyAssessmentResult` og `logOperationalEvent` lagt til i `manual-review-service.test.ts`

## 0.8.15 - 2026-03-18
### Summary
Regresjonsfikser i manuell vurdering: modulnavn lokaliseres, besvarelsestekst vises, promptutdrag betinget, og LLM-detaljer/Systemsvar skjules uten `?debug=1`.

### Included
- **Modulnavn i liste**: `module.title` lokaliseres nå korrekt via `localizeContentText` med brukerens locale
- **Besvarelsestekst**: `responseJson` ekspanderes i workspace-ruten til `rawText`, `reflectionText`, `promptExcerpt` — felt som frontend allerede forventet
- **Betinget promptutdrag**: "Promptutdrag brukt" vises kun når modulen bruker dette feltet
- **Debug-modus**: `debugMode` defaulter til `false`; `?debug=1` aktiverer Systemsvar og LLM-detaljer (forbedringsråd, kriteriebegrunnelser)

## 0.8.14 - 2026-03-17
### Summary
Varslingsforbedringer: ACS-avsendernavn, manuell vurdering sender varsel, og e-post inneholder modulnavn og innleveringstidspunkt (#139, #140, #141).

### Included
- **#139 ACS-avsendernavn**: E-post sendes nå fra konfigurert visningsnavn (`ACS_EMAIL_SENDER_DISPLAY_NAME`) i stedet for standard DoNotReply-adresse.
- **#140 Varsel ved manuell gjennomgang**: Deltakere mottar nå e-post/webhook-varsel når manuell vurdering fullføres (override).
- **#141 Kontekstheader i e-post**: Alle varsler inneholder nå modulnavn og innleveringstidspunkt (for vurderingsresultat) øverst i meldingen.
- Alle tre varslingskanaler (log, webhook, acs_email) støtter de nye feltene.
- Tester oppdatert for nye signaturer i `getAppealNotificationMessage`, `getAssessmentResultNotificationMessage` og `notifyAssessmentResult`.

## 0.8.13 - 2026-03-17
### Summary
Fix: provider-registrering blokkerte deploy når service principal mangler subscription-rettigheter.

### Included
- **Ikke-fatal provider-sjekk**: Deploy-scriptet sjekker nå om `Microsoft.Communication` er registrert, forsøker registrering uten å feile hardt, og gir en tydelig advarsel hvis det feiler. Registrering må gjøres manuelt én gang av en bruker med subscription-rettigheter: `az provider register --namespace Microsoft.Communication --wait`.

## 0.8.12 - 2026-03-17
### Summary
Fix: deploy feilet med MissingSubscriptionRegistration for Microsoft.Communication når acs_email-kanal er aktivert.

### Included
- **Provider-registrering i deploy-script**: `deploy-environment.ps1` registrerer nå `Microsoft.Communication`-namespacet automatisk (med `--wait`) når `PARTICIPANT_NOTIFICATION_CHANNEL=acs_email`. Registreringen er idempotent og gjøres bare når ACS er konfigurert.

## 0.8.11 - 2026-03-17
### Summary
Bugfix: "Fullfør overstyring" i manuell vurdering og ankebehandler var deaktivert i Entra-modus selv om brukeren hadde tatt vurderingen.

### Included
- **Entra-identitet i vurderingsarbeidsrom**: `manual-review.js` og `appeal-handler.js` henter nå `email`, `externalId` og `name` fra `/api/me` i Entra-modus. Tidligere ble kun `roles` oppdatert, noe som førte til at identitetssammenligning feilet og override-knappen var utilgjengelig.
- **Testfikstur utvidet**: `buildSubmissionFixture()` i `assessment-job-service.test.ts` mangler `user`- og `module`-felter som ble lagt til for varslingsintegrasjon. Test-mock for `participantNotificationService` lagt til for å holde grensesnittet rent.
- Fjernet ubrukt `isDebugModeEnabled`-funksjon i `appeal-handler.js`.

## 0.8.10 - 2026-03-17
### Summary
LLM timeout raised to 120 s and participant poll settings tuned for long-running assessments.

### Included
- **LLM timeout** (#137): `AZURE_OPENAI_TIMEOUT_MS` default raised from 30 000 ms to 120 000 ms so assessments on slower models are not prematurely aborted.
- **Participant poll tuning** (#137): `flow.maxWaitSeconds` lowered from 180 to 150 (client waits for full LLM window); `flow.pollIntervalSeconds` raised from 2 to 3 (reduces server-side polling load during long jobs).
- Bicep, deploy script, and CI workflow fallback defaults updated to match.

## 0.8.9 - 2026-03-17
### Summary
Azure Communication Services email notifications for assessment results and recertification reminders.

### Included
- **ACS email channel** (#138): `PARTICIPANT_NOTIFICATION_CHANNEL=acs_email` activates email delivery via Azure Communication Services for assessment results, appeal status transitions, and recertification reminders.
- **Assessment result notification**: `notifyAssessmentResult()` fires after each automatic decision; messages are localized in en-GB, nb, and nn for pass, fail, and under_review outcomes.
- **Recertification reminder email**: `sendRecertificationReminder()` supports the `acs_email` channel alongside existing `log` and `webhook` channels.
- **Bicep automation**: ACS email service, AzureManagedDomain, and app settings are provisioned automatically when `participantNotificationChannel=acs_email` is passed to the deploy.
- **CSV module title fix**: All six report types in `reportingService.ts` now resolve locale-aware titles via `localizeContentText()` instead of returning raw JSON.

## 0.8.8 - 2026-03-17
### Summary
Results Workspace bugs resolved: module titles, system-response visibility, CSV export in Entra mode, and per-participant certification overview.

### Included
- **Module title in results**: `localizeTitle()` now parses JSON locale objects so module names render correctly instead of raw JSON.
- **System response hidden by default**: Raw LLM output section moved to a collapsible debug section hidden unless `?debug=1` is present.
- **CSV export in Entra mode**: Export calls now include `Authorization: Bearer` header via `getAccessToken()`.
- **Per-participant certification overview**: New recertification table added to the Results Workspace showing participant status, expiry dates, and CSV export.

## 0.8.7 - 2026-03-17
### Summary
Hotfix: toppmenyen viste ingen lenker i Entra-modus fordi roller ikke var tilgjengelige frontend-side.

### Included
- **Nav-fiks Entra-modus**: alle 6 workspaces henter nå roller fra `/api/me` etter MSAL-init og setter `rolesInput.value` slik at `renderWorkspaceNavigation()` filtrerer korrekt.

## 0.8.6 - 2026-03-17
### Summary
P2 accessibility fixes, MSAL frontend integration for Entra auth mode, authoring prompt dialog, Results Workspace epic created, bug report issue template for pilot users.

### Included
- **MSAL frontend integration** (#132): `api-client.js` loads MSAL dynamically, initializes via `getConsoleConfig()`, injects `Authorization: Bearer` in all API calls. New env vars: `ENTRA_CLIENT_ID`. Backend exposes `entra.clientId/authority/scopes` via `/participant/config`.
- **P2 a11y fixes**: color contrast (`--color-warning`), non-color selection indicator (`box-shadow` on `tr.selected`), non-color field status (`::before` content), `prefers-reduced-motion` fix in `toast.css`, scrollable table keyboard access (`tabindex`, `role="region"`), responsive tables (`min-width: 0` override), `autocomplete="off"` on identity fields, locked section contrast fix.
- **Authoring prompt dialog** (#125): native `<dialog>` with MCQ count, field checkboxes, custom JSON override, and dynamic prompt generation.
- **Usability findings F2/F7** (#126/#127): scroll-to-invalid on submission validation, scroll-to-status-card after module creation.
- **Results Workspace epic** (#128–#131): frontend report page for HR/SMO (backend APIs already exist).
- **Bug report issue template**: Norwegian GitHub issue template for pilot users.

## 0.8.5 - 2026-03-15
### Summary
Fixed W2/W5 bugs found in v0.8.4 testing, resolved two participant-completed UX issues, and standardized GUI elements (toast, pre-content) across all six workspaces.

### Included
- **W2 fix**: `submissionSchemaFieldSchema.label` now uses `localizedTextSchema` instead of `z.string()`, accepting locale objects `{"en-GB":"…","nb":"…"}`. `parseSubmissionFieldLabels` in assessmentJobService handles locale-object labels.
  - `src/routes/adminContent.ts`
  - `src/services/assessmentJobService.ts`
- **W5 fix — module name in appeal queue**: Added `resolveModuleTitle()` helper that parses stored locale JSON strings; used in both queue table and details panel.
  - `public/appeal-handler.js`
- **W5 fix — appeal details show submission content**: Added `parseResponseJsonFields()` to read fields from `submission.responseJson`; details panel now shows response/reflection/promptExcerpt correctly.
  - `public/appeal-handler.js`
- **W5 fix — default appeal reason in participant-completed**: `openAppealForm()` now pre-fills reason with `t("defaults.appealReason")`.
  - `public/participant-completed.js`
- **UX: participant-completed button and pre box**: `completedSubmitAppeal` gets `btn-primary` class; `#output pre` gets `pre-content` class.
  - `public/participant-completed.html`
- **UX: standardize toast across all workspaces**: `admin-content` migrated from inline `setMessage()` div to `showToast()`; `manual-review` and `appeal-handler` migrated from inline message divs to `showToast()`. Inline message divs removed from all three pages.
  - `public/admin-content.html`, `public/admin-content.js`
  - `public/manual-review.html`, `public/manual-review.js`
  - `public/appeal-handler.html`, `public/appeal-handler.js`
- **UX: pre-content class on all #output pre elements**: `participant.html`, `calibration.html`, `admin-content.html` were missing `class="pre-content"` — all output pres now use light background with scroll.
  - `public/participant.html`, `public/calibration.html`, `public/admin-content.html`

## 0.8.4 - 2026-03-15
### Summary
Admin-content message feedback is no longer silent on failure: errors are styled red, bundle-saved and published confirmations are styled green.

### Included
- `setMessage(text, type)` now accepts `"info"` (default), `"error"`, or `"success"`. Errors add `.field-error` (red); success adds `.field-success` (green); both classes are toggled exclusively.
- All `catch` blocks in button handlers now call `setMessage(message, "error")` — save/publish/load/delete failures are visually distinct from the neutral info messages that follow normal operations.
- Bundle-saved and module-version-published confirmations now call `setMessage(..., "success")` — the user sees green after a successful save and green after a successful publish, making the transition visible if they previously saw red.
  - `public/admin-content.js`

## 0.8.3 - 2026-03-15
### Summary
Fixed all remaining items from the v0.8.1 deferred test list: default field label i18n, timeout button gate, appeal from history, admin version count formatting, and dark pre boxes in review workspaces. Also added TC-PART-05b criterion name normalization.

### Included
- **TC-PART-07**: `DEFAULT_SUBMISSION_FIELDS` in participant.js now uses `labelKey` properties (`submission.rawText`, `submission.reflection`, `submission.promptExcerpt`). `renderSubmissionFields` resolves labels via `t(field.labelKey)` for default fields, `localizePreviewText(field.label)` for custom schema fields. Default field labels now render in the participant's locale.
  - `public/participant.js`
- **TC-PART-08**: Fixed "Sjekk framdrift" button being disabled after auto-assessment timeout. Two changes: (1) `renderFlowGating()` is now called in the timeout branch so button states update immediately; (2) `checkAssessmentButton.disabled` (and queue/result buttons) now uses `isAutoLoopActive = autoAssessmentEnabled && autoAssessmentTicker !== null` — buttons re-enable when the loop has stopped regardless of the `autoStartAfterMcq` setting.
  - `public/participant.js`
- **TC-PART-09**: Appeal button added to participant-completed.html for eligible past failures (COMPLETED status, passFailTotal=false). Clicking the button reveals an appeal form panel; on submit the form calls `POST /api/submissions/:id/appeals`.
  - `public/participant-completed.html`
  - `public/participant-completed.js`
  - `public/i18n/participant-completed-translations.js`
- **TC-PART-05b**: `localizeCriterionName` now normalises the criterion key to `snake_case` (handling both "Technical Accuracy" and "technicalAccuracy" → "technical_accuracy") before falling back. Common criterion translations added for `en-GB`, `nb`, `nn`: technical_accuracy, conceptual_understanding, application, clarity, communication, critical_thinking, problem_solving.
  - `public/participant.js`
  - `public/i18n/participant-translations.js`
- **TC-ADMIN-09**: "Lagrede versjoner" in admin-content now renders as a badge chain (same visual style as "Live nå") using `renderStatusChain`. Replaced plain `countsText` string with `versionsCountsChain` array in `deriveModuleStatusView`.
  - `public/admin-content.js`
- **TC-ADMIN-10**: `<pre>` elements displaying structured review/appeal details now use `.pre-content` CSS class (light background, readable contrast, max-height with scroll). Added to `#manualReviewDetails` and `#appealHandlerDetails`. Terminal-style debug `#output` pres unchanged.
  - `public/static/shared.css`
  - `public/manual-review.html`
  - `public/appeal-handler.html`

## 0.8.2 - 2026-03-15
### Summary
Fixed regression introduced in v0.8.1 where user input in submission fields was wiped on locale switch.

### Included
- `renderSubmissionFields` now preserves all existing textarea values before recreating DOM elements; values are restored by `data-field-id` after the re-render. This fixes both the input-loss regression and the disappearing default values on back-and-forth locale switching.
  - `public/participant.js`
- Deferred test log updated: TC-ADMIN-06r/07r, TC-ADMIN-08r, TC-PART-06r, TC-WCAG-01r all verified OK in v0.8.1; five new deferred items added from v0.8.1 session findings

## 0.8.1 - 2026-03-15
### Summary
Fixed three defects found during v0.8.0 manual testing: certificationLevel field layout, version field loss after module creation, and module titles not updating on locale switch.

### Included
- **DEF-01**: `certificationLevel` input changed to `<textarea rows="2">` in admin-content.html so locale JSON renders legibly alongside the other multi-line fields
- **DEF-02**: `handleCreateModule` now captures all version field content before calling `loadModules` and restores it afterwards — imported draft data (rubric, prompt, MCQ, task text, etc.) is preserved when the newly created module is selected and `clearVersionFields` fires
- **DEF-03**: `setLocale` in participant.js now fires a silent re-fetch of `/api/modules` when modules have previously been loaded; server-resolved titles, descriptions, and certificationLevel then reflect the new locale without disrupting flow state
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/participant.js`

## 0.8.0 - 2026-03-15
### Summary
Tier 2 WCAG accessibility batch: improved colour contrast for warning/success states, section-locked keyboard isolation, and responsive card-view for all queue and history tables.

### Included
- **#118 — Colour contrast**: `--color-warning` changed from `#e67e22` to `#b36200` (4.6:1 on white); `--color-success` changed from `#27ae60` to `#1a6b1a` (6.1:1 on white). Both now pass WCAG AA 4.5:1 for normal text.
  - `public/static/shared.css`
- **#122 — Section-locked keyboard isolation**: New `setSectionLocked(section, locked)` function in participant.js applies `tabindex="-1"` to all interactive elements (`button`, `input`, `textarea`, `select`, `a[href]`) inside a locked section, restoring their previous `tabindex` on unlock. Applied to `assessmentSection` and `appealSection`.
  - `public/participant.js`
- **#124 — Responsive card view**: Tables reflow to stacked cards at ≤ 600 px viewport width using `display: block` on `table/thead/tbody/tr/td` and `::before` pseudo-elements reading `data-label` for column headers. `data-label` attributes added to all dynamically-rendered `<td>` cells in all five table-rendering functions.
  - `public/static/shared.css`
  - `public/manual-review.js`
  - `public/appeal-handler.js`
  - `public/participant-completed.js`
  - `public/calibration.js`

## 0.7.7 - 2026-03-15
### Summary
Fixed three localization and accessibility defects found during v0.7.6 manual testing.

### Included
- `module.certificationLevel` now supports locale objects in the GPT authoring prompt template; the shape `{"en-GB":"","nb":"","nn":""}` is shown in the JSON skeleton and listed in the locale-object requirements
  - `public/admin-content.js`
- `submissionSchema.fields[].label` is now rendered via `localizePreviewText` in the participant workspace so Norwegian/Nynorsk labels display correctly when the participant switches locale; labels are also re-rendered on locale change
  - `public/participant.js`
- Skip-nav link now works in Microsoft Edge: added `clip: rect(0 0 0 0)`, `clip-path: inset(50%)`, and `white-space: nowrap` to the hidden state; corresponding resets in the `:focus` state
  - `public/static/shared.css`

## 0.7.5 - 2026-03-15
### Summary
Fixed a bug where "Load content" in admin-content.html populated the form from the active published version instead of the newest draft version, causing edits such as `assessmentPolicyJson` to be silently discarded on save.

### Included
- `getModuleContentBundle` now selects `moduleVersions[0]` (highest `versionNo`, ordered descending by repository query) as `selectedConfiguration` regardless of `activeVersionId`; source is `latestModuleVersion` when that version is not the active published one
  - `src/services/adminContentService.ts`
- Regression tests: new unit test asserting latest version is selected when a newer draft exists alongside a published version; new TC-ADMIN-06r/07r manual test cases documented in `doc/DEFERRED_TESTS.md`

## 0.7.4 - 2026-03-15
### Summary
Added per-module assessment policy scoring weights (`practicalWeight`, `mcqWeight`) surfaced in the admin-content UI; fixed MCQ option shuffling and unknown-criterion key formatting in results; batched WCAG accessibility improvements across workspaces.

### Included
- Assessment policy textarea in admin-content step 8 now accepts `scoring.practicalWeight` and `scoring.mcqWeight` alongside the existing `passRules.totalMin`
- MCQ options are now shuffled on each `startMcqAttempt` call so participants do not see a fixed option order
- Unknown rubric criterion keys are formatted readably in the result view rather than showing raw camelCase identifiers
- Cleared version-related form fields when the selected module changes in admin-content to prevent stale data leaking between module loads
- WCAG accessibility improvements across participant, manual-review, calibration, appeal-handler, and admin-content workspaces

## 0.7.3 - 2026-03-15
### Summary
Added dynamic submission forms: participant workspace renders schema-defined fields from `submissionSchemaJson`; admin preview renders the same schema; default 3-field form is used when no schema is present. Restored default placeholder text in submission fields after the dynamic-form refactor.

### Included
- Participant workspace reads `submissionSchema` from the module API and builds form inputs from `schema.fields`; falls back to the 3-field default when absent
  - `public/participant.js`, `public/participant.html`
- Admin content workspace previews the submission form defined in the draft version
  - `public/admin-content.js`, `public/admin-content.html`
- Restored default placeholder/label text that was stripped during the responseJson refactor
  - `public/participant.js`

## 0.7.2 - 2026-03-15
### Summary
Generalized the LLM schema and rubric structure to be domain-independent, removing AI-domain-specific field assumptions and replacing them with generic criterion/response patterns that work across certification domains (#111, #114).

### Included
- LLM assessment service: prompt builder and response parser updated to use generic criterion keys from the rubric rather than hard-coded field names
  - `src/services/llmAssessmentService.ts`
- Rubric and prompt-template structures no longer assume a fixed domain vocabulary; criterion definitions drive all scoring logic
  - `src/services/assessmentJobService.ts`
  - `src/repositories/adminContentRepository.ts`

## 0.7.1 - 2026-03-15
### Summary
Added `assessmentPolicyJson` and `submissionSchemaJson` to `ModuleVersion`, refactored submission storage to generic `responseJson`, and bumped to v0.4.0 marking completion of the UX improvement sprint (#109, #110, #115).

### Included
- `ModuleVersion.assessmentPolicyJson` — per-module scoring weight and pass-rule overrides; applied by `decisionService.resolveAssessmentDecision`
- `ModuleVersion.submissionSchemaJson` — per-module submission form schema; consumed by participant and admin UIs
- `Submission.responseJson` — replaces AI-domain-specific free-text fields with a generic key-value store
- Prisma migrations for all three schema changes

## 0.5.0 - 2026-03-14
### Summary
Added `assessmentPolicyJson` to `ModuleVersion` — admin can configure per-module scoring weights and pass rules; decision engine applies module-level `passRules.totalMin` override when present, falling back to global config (#115).

### Included
- Prisma: `assessmentPolicyJson String?` added to `ModuleVersion`
  - `prisma/schema.prisma`
  - `prisma/migrations/20260314205138_add_assessment_policy_json_to_module_version/`
- Admin content route: `assessmentPolicy` accepted in module version creation body (`{ scoring?: { practicalWeight, mcqWeight }, passRules?: { totalMin } }`)
  - `src/routes/adminContent.ts`
- Admin content service + repository: field passed through and persisted
  - `src/services/adminContentService.ts`
  - `src/repositories/adminContentRepository.ts`
- Module repository: `assessmentPolicyJson` included in all activeVersion selects; parsed and returned as `assessmentPolicy` object
  - `src/repositories/moduleRepository.ts`
- Decision service: `ModuleAssessmentPolicy` type exported; `resolveAssessmentDecision` accepts optional `assessmentPolicy` and uses `passRules.totalMin` to override global threshold
  - `src/services/decisionService.ts`
- Assessment job service: parses `assessmentPolicyJson` from module version and passes to `createAssessmentDecision`
  - `src/services/assessmentJobService.ts`
- Tests: 3 unit tests for policy override in `resolveAssessmentDecision`; 1 integration test for admin create + participant read of `assessmentPolicy`
  - `test/unit/decision-service.test.ts`
  - `test/m2-admin-content-publication.test.ts`

## 0.4.2 - 2026-03-14
### Summary
Added `submissionSchemaJson` to `ModuleVersion` — admin can now define per-module submission field schemas; participants receive the parsed schema from the module API (#110).

### Included
- Prisma: `submissionSchemaJson String?` added to `ModuleVersion`
  - `prisma/schema.prisma`
  - `prisma/migrations/20260314203606_add_submission_schema_to_module_version/`
- Admin content route: `submissionSchema` accepted in module version creation body (validated as `{ fields: [...] }`)
  - `src/routes/adminContent.ts`
- Admin content service + repository: field passed through and persisted
  - `src/services/adminContentService.ts`
  - `src/repositories/adminContentRepository.ts`
- Module repository: `submissionSchemaJson` included in all activeVersion selects; parsed and returned as `submissionSchema` object to callers
  - `src/repositories/moduleRepository.ts`

## 0.4.1 - 2026-03-14
### Summary
Refactored submission model to generic `responseJson` — removes AI-specific fields and replaces with domain-agnostic structured response storage (#109).

### Included
- Prisma schema: removed `rawText`, `reflectionText`, `promptExcerpt`, `responsibilityAcknowledged` from `Submission`; added `responseJson String @default("{}")`
  - `prisma/schema.prisma`
  - `prisma/migrations/20260314202206_refactor_submission_response_json/`
- Document parsing service: renamed to `resolveSubmissionResponseJson`, input/output updated to `Record<string, unknown>`
  - `src/services/documentParsingService.ts`
- Submission service and API route: updated to accept and store `responseJson`
  - `src/services/submissionService.ts`
  - `src/routes/submissions.ts`
- Sensitive data masking: rewrote to recursively mask string values inside `responseJson`
  - `src/services/sensitiveDataMaskingService.ts`
- LLM assessment service: `AssessmentContext` and prompt builder updated to use `responseJson`
  - `src/services/llmAssessmentService.ts`
- Assessment job pipeline: updated preprocessing and LLM calls to use `responseJson`
  - `src/services/assessmentJobService.ts`
- Batch regression script and cases updated
  - `src/scripts/assessmentBatchCases.ts`
  - `src/scripts/runAssessmentBatchRegression.ts`
- All test files and test support helpers updated to use `responseJson`

## 0.4.0 - 2026-03-14
### Summary
Minor version bump marking completion of the UX improvement sprint (issues #99–#107 all closed).

## 0.3.144 - 2026-03-14
### Summary
Hides the Test User (mock identity) panel in entra auth mode and adds a "Dev only" badge to clearly label it as a developer tool in mock mode.

### Included
- Hide `.mock-identity-card` on all workspace pages when `authMode === "entra"` via `body.auth-entra` CSS class set after config loads:
  - `public/participant.js`
  - `public/admin-content.js`
  - `public/calibration.js`
  - `public/appeal-handler.js`
  - `public/participant-completed.js`
  - `public/manual-review.js`
- Added `body.auth-entra .mock-identity-card { display: none; }` and `.mock-identity-dev-badge` badge style:
  - `public/static/shared.css`
- Added "Dev only" badge to `<summary>` on all 6 workspace HTML pages:
  - `public/participant.html`, `public/admin-content.html`, `public/calibration.html`, `public/appeal-handler.html`, `public/participant-completed.html`, `public/manual-review.html`
- Added `identity.devOnlyBadge` translation key (en-GB / nb / nn):
  - `public/i18n/participant-translations.js`

## 0.3.143 - 2026-03-14
### Summary
Expanded seed-module localization coverage and locked participant visibility after new module publication with local integration tests.

### Included
- Added fallback `nb`/`nn` content translations for the remaining seed-module assignment/guidance/MCQ strings so participant sees more of the seeded experience in the chosen locale:
  - `src/i18n/contentMessages.ts`
- Added a new i18n regression for the second seed module to ensure module brief and MCQ content localize correctly:
  - `test/m2-i18n-baseline.test.ts`
- Added a new publication regression to ensure previously completed modules remain visible to participant after a new module is created and published:
  - `test/m2-admin-content-publication.test.ts`

## 0.3.142 - 2026-03-14
### Summary
Participant now shows published modules even after completion, marks completed modules clearly, and keeps retake flow available from the same module list.

### Included
- Changed participant module loading to include completed modules and rendered completed/retake state directly on the module cards and selected-module summary:
  - `public/participant.js`
  - `public/participant.html`
  - `public/participant-console-state.js`
  - `public/i18n/participant-translations.js`
- Extended participant-facing module data with latest decision details so the module list can show the latest status/score context for completed modules:
  - `src/repositories/moduleRepository.ts`
- Added regression coverage for completed-module rendering, retake creation, and new participant UI strings/markup:
  - `test/m2-completed-modules.test.ts`
  - `test/participant-console-state.test.js`
  - `test/participant-console-config.test.ts`
  - `test/participant-translations.test.js`

## 0.3.141 - 2026-03-14
### Summary
Fixed the remaining admin-content list regression for locale-based module titles and localized the new insufficient-evidence auto-fail decision reason in participant results.

### Included
- Made the dedicated admin module list return locale-resolved strings and hardened frontend normalization so locale-object titles no longer disappear from the admin dropdown/list:
  - `src/routes/adminContent.ts`
  - `src/services/adminContentService.ts`
  - `public/admin-content.js`
  - `test/m2-admin-content-publication.test.ts`
- Added participant translation coverage for `Automatic fail due to insufficient submission evidence.` so the explanation is localized instead of leaking English in `nb`/`nn`:
  - `public/participant.js`
  - `public/i18n/participant-translations.js`
  - `test/participant-translations.test.js`

## 0.3.140 - 2026-03-14
### Summary
Followed up the first `0.3.139` staging round with three targeted fixes: locale-aware LLM response language instructions, a dedicated admin module-list endpoint that includes unpublished module shells, and a participant history cleanup that hides technical submission IDs unless debug mode is enabled.

### Included
- Added a dedicated admin-content module listing endpoint and switched the admin workspace to use it, so newly created modules appear immediately even before any version is published:
  - `src/routes/adminContent.ts`
  - `src/services/adminContentService.ts`
  - `src/repositories/adminContentRepository.ts`
  - `public/admin-content.js`
  - `test/m2-admin-content-publication.test.ts`
  - `test/participant-console-config.test.ts`
- Added locale-aware language instructions to the LLM prompt contract so natural-language result fields follow the selected UI language instead of defaulting to English:
  - `src/services/llmAssessmentService.ts`
  - `src/services/assessmentJobService.ts`
  - `src/scripts/runAssessmentBatchRegression.ts`
  - `test/llm-assessment-service.test.ts`
- Simplified participant history by showing submission timestamps as the primary history card label and reserving raw submission IDs for debug mode only:
  - `public/participant.js`
  - `test/m2-participant-results-history.test.ts`

## 0.3.139 - 2026-03-14
### Summary
Bundled three local-first improvements into one deploy candidate: a canonical red-flag reliability policy for LLM assessment routing, a new local integration test layer for policy/workspace regressions, and a UX cleanup batch that simplifies mock-mode identity panels and replaces raw participant result/history text with structured cards.

### Included
- Tightened assessment reliability by normalizing unstable LLM red-flag aliases into a canonical, configurable policy and documenting reliability as an explicit architecture requirement:
  - `config/assessment-rules.json`
  - `src/config/assessmentRules.ts`
  - `src/services/assessmentRedFlagPolicy.ts`
  - `src/services/assessmentDecisionSignals.ts`
  - `src/services/llmAssessmentService.ts`
  - `src/services/secondaryAssessmentService.ts`
  - `doc/ARCHITECTURE.md`
  - `doc/ASSESSMENT_DECISION_POLICY.md`
- Added a local integration suite and testcase map so policy/workspace regressions can be caught before staging:
  - `doc/AI_WORKFLOW.md`
  - `doc/LOCAL_INTEGRATION_TEST_SUITE_DESIGN.md`
  - `doc/LOCAL_TESTCASE_MAP.md`
  - `test/assessment-policy.integration.test.ts`
  - `test/support/participantFlow.ts`
  - `package.json`
  - `npm run test:integration:local`
- Added regression coverage for the normalized red-flag policy and stabilized seeded review/appeal test fixtures:
  - `test/llm-assessment-service.test.ts`
  - `test/secondary-assessment.test.ts`
  - `test/unit/decision-service.test.ts`
  - `test/m2-manual-review.test.ts`
  - `test/m2-appeal-flow.test.ts`
- Improved mock-mode usability by collapsing `Test User` panels by default across the workspace pages:
  - `public/participant.html`
  - `public/manual-review.html`
  - `public/admin-content.html`
  - `public/appeal-handler.html`
  - `public/calibration.html`
  - `public/participant-completed.html`
  - `public/static/shared.css`
- Replaced participant raw `<pre>` result/history blocks with structured cards, hid module IDs behind debug mode, and added overwrite confirmation before draft JSON import:
  - `public/participant.html`
  - `public/participant.js`
  - `public/admin-content.js`
  - `public/i18n/participant-translations.js`
  - `public/i18n/admin-content-translations.js`
- Extended static workspace contract coverage for the new UX structure:
  - `test/participant-console-config.test.ts`
  - `test/admin-content-translations.test.js`

## 0.3.138 - 2026-03-14
### Summary
Added a dedicated live-LMM batch regression harness for assessment policy changes, so red/yellow/green canonical cases can be run repeatedly against the configured model before staging instead of relying only on narrow unit tests.

### Included
- Refactored final assessment routing into a reusable pure decision helper that can be used outside the DB-persisting service path:
  - `src/services/decisionService.ts`
- Added reusable canonical batch cases for clear red, yellow, and green outcomes:
  - `src/scripts/assessmentBatchCases.ts`
- Added a new live batch regression runner with `--repeat` and optional `--case` filtering:
  - `src/scripts/runAssessmentBatchRegression.ts`
- Added npm command for manual batch runs:
  - `package.json`
  - `npm run test:assessment:batch -- --repeat=10`
- Updated implementation workflow so assessment-policy and LLM-contract changes explicitly require both focused unit tests and the live batch harness before push:
  - `doc/AI_WORKFLOW.md`

## 0.3.137 - 2026-03-14
### Summary
Broadened the insufficient-evidence fail policy to cover Azure payloads that use `incomplete_submission` and `extremely_low_content` high red flags, so obviously empty submissions no longer open manual review just because the model frames the problem as completeness rather than safety risk.

### Included
- Generalized the red-flag exception from one code to a broader insufficiency/completeness class:
  - `src/services/assessmentDecisionSignals.ts`
- Final decision routing now treats insufficiency/completeness red flags as automatic-fail signals instead of forcing manual review:
  - `src/services/decisionService.ts`
- Secondary assessment now skips the same insufficiency/completeness-only cases:
  - `src/services/secondaryAssessmentService.ts`
- Replaced the previous narrow regression with tests that mirror the exact `0.3.136` staging payload:
  - `test/unit/decision-service.test.ts`
  - `test/unit/assessment-job-service.test.ts`
  - `test/secondary-assessment.test.ts`
- Updated the written decision policy to document the broader insufficiency/completeness red-flag class:
  - `doc/ASSESSMENT_DECISION_POLICY.md`

## 0.3.136 - 2026-03-14
### Summary
Corrected assessment routing for Azure responses that mark extremely thin submissions with the `insufficient_submission` red-flag code, so those cases now stay automatic fail instead of opening manual review or secondary assessment.

### Included
- Added explicit helpers for treating `insufficient_submission` as an insufficient-evidence signal rather than a forcing safety/compliance red flag:
  - `src/services/assessmentDecisionSignals.ts`
- Final decision routing now ignores `insufficient_submission` when deciding whether a high-severity red flag should force manual review:
  - `src/services/decisionService.ts`
- Secondary assessment now skips the same `insufficient_submission`-only cases instead of spending a second pass:
  - `src/services/secondaryAssessmentService.ts`
- Added regression coverage for the exact staging-style payload where Azure returns `recommended_outcome = manual_review`, `manual_review_reason_code = red_flag`, and `red_flags = [{ code: "insufficient_submission", severity: "high" }]`:
  - `test/unit/decision-service.test.ts`
  - `test/unit/assessment-job-service.test.ts`
  - `test/secondary-assessment.test.ts`
- Updated policy documentation to describe `insufficient_submission` as an automatic-fail signal:
  - `doc/ASSESSMENT_DECISION_POLICY.md`

## 0.3.135 - 2026-03-14
### Summary
Completed the structured-LLM decision-metadata rollout by making secondary-assessment triggering and final decision routing prefer explicit machine-readable outcome fields, exposing those fields in participant result payloads, and updating the test suite and policy docs accordingly.

### Included
- Secondary-assessment triggering now skips explicit insufficient-evidence auto-fail cases and prefers structured metadata over confidence-note inference:
  - `src/services/secondaryAssessmentService.ts`
- Decision routing now prefers structured manual-review and insufficient-evidence signals before falling back to text heuristics:
  - `src/services/decisionService.ts`
  - `src/services/assessmentDecisionSignals.ts`
- LLM response contract and stub output now include explicit decision metadata:
  - `src/services/llmAssessmentService.ts`
- Participant result payload now returns decision metadata for inspection:
  - `src/routes/submissions.ts`
- Updated regression coverage across OpenAI adapter, secondary-assessment policy, decision service, assessment pipeline, participant results, and i18n baseline:
  - `test/llm-assessment-service.test.ts`
  - `test/secondary-assessment.test.ts`
  - `test/unit/decision-service.test.ts`
  - `test/unit/assessment-job-service.test.ts`
  - `test/m2-participant-results-history.test.ts`
  - `test/m2-i18n-baseline.test.ts`
- Updated assessment policy documentation:
  - `doc/ASSESSMENT_DECISION_POLICY.md`

## 0.3.134 - 2026-03-14
### Summary
Replaced string-first assessment routing with structured LLM decision metadata, so automatic fail, manual-review recommendation, and insufficient-evidence handling now prefer explicit machine-readable fields over fragile confidence-note phrasing.

### Included
- Extended the LLM response contract with explicit decision metadata fields:
  - `evidence_sufficiency`
  - `recommended_outcome`
  - `manual_review_reason_code`
  - `src/services/llmAssessmentService.ts`
- Stub LLM responses now emit structured decision metadata consistently:
  - `src/services/llmAssessmentService.ts`
- Decision building now prefers structured metadata and uses text-pattern fallback only when needed:
  - `src/services/assessmentDecisionSignals.ts`
  - `src/services/decisionService.ts`
- Secondary assessment is now skipped for explicit insufficient-evidence auto-fail cases instead of spending a second pass:
  - `src/services/secondaryAssessmentService.ts`
- Submission result payload now exposes the structured decision metadata for inspection:
  - `src/routes/submissions.ts`
- Added and updated regression coverage across Azure OpenAI parsing, secondary-assessment policy, decision service, assessment pipeline, participant result API, and i18n baseline:
  - `test/llm-assessment-service.test.ts`
  - `test/secondary-assessment.test.ts`
  - `test/unit/decision-service.test.ts`
  - `test/unit/assessment-job-service.test.ts`
  - `test/m2-participant-results-history.test.ts`
  - `test/m2-i18n-baseline.test.ts`
- Updated policy documentation to describe structured metadata as the primary assessment-routing source:
  - `doc/ASSESSMENT_DECISION_POLICY.md`

## 0.3.133 - 2026-03-14
### Summary
Closed the remaining insufficient-evidence gap by teaching the policy to recognise the exact staging phrase `additional material required for a reliable assessment`, and locked it down with both decision-layer and pipeline-layer regression tests.

### Included
- Expanded insufficient-evidence phrase matching for low-confidence minimal submissions:
  - `src/services/assessmentDecisionSignals.ts`
- Added a decision-service regression test for the exact staging phrase:
  - `test/unit/decision-service.test.ts`
- Added an assessment-pipeline regression test for the exact staging phrase so red submissions stay red even when secondary assessment runs:
  - `test/unit/assessment-job-service.test.ts`

## 0.3.132 - 2026-03-13
### Summary
Added traffic-light regression coverage for the assessment pipeline and changed secondary-disagreement handling so clearly insufficient submissions now stay automatic fail instead of being escalated to manual review just because primary and secondary differ.

### Included
- Added shared insufficient-evidence signal helpers used consistently by both decision building and secondary-assessment routing:
  - `src/services/assessmentDecisionSignals.ts`
- Secondary-assessment disagreement no longer forces manual review when both passes clearly indicate insufficient-evidence fail with no red flags:
  - `src/services/assessmentJobService.ts`
- Decision service now uses the shared insufficient-evidence helper instead of a private heuristic copy:
  - `src/services/decisionService.ts`
- Added pipeline-level traffic-light regression tests for known red and yellow outcomes:
  - `test/unit/assessment-job-service.test.ts`
- Updated the assessment decision policy documentation to reflect the new disagreement exception:
  - `doc/ASSESSMENT_DECISION_POLICY.md`

## 0.3.131 - 2026-03-13
### Summary
Hardened startup/bootstrap behavior after repeated staging SQLite incidents by removing a request/seed race, making principal-user upsert resilient to concurrent creates, and updating the PostgreSQL migration plan from optional backlog to pre-production requirement.

### Included
- `upsertUserFromPrincipal()` now recovers cleanly if another process creates the same user between lookup and create:
  - `src/repositories/userRepository.ts`
- Runtime bootstrap seed now uses the same race-safe user-create fallback:
  - `scripts/runtime/bootstrapSeed.mjs`
- App startup now waits for runtime bootstrap seed to complete before opening the HTTP listener, preventing request/seed collisions after reset or restart:
  - `src/index.ts`
- Added regression coverage for the concurrent-create recovery path:
  - `test/unit/user-repository.test.ts`
- Updated PostgreSQL migration planning to reflect repeated real staging incidents on SQLite/App Service:
  - `doc/POSTGRES_MIGRATION_PLAN.md`

## 0.3.130 - 2026-03-13
### Summary
Hardened mock-mode role handling and participant module visibility so the participant workspace no longer inherits broader stored roles or exposes unpublished module shells.

### Included
- Mock-mode authentication now honours explicit role hints from the workspace UI even when the backing user has broader role assignments:
  - `src/auth/authenticate.ts`
- Participant-facing module routes now always filter to published, date-valid participant modules:
  - `src/repositories/moduleRepository.ts`
  - `src/routes/modules.ts`
- Seed data now resets seed-user role assignments to an exact baseline instead of preserving stale extra roles:
  - `prisma/seed.ts`
- Added regression coverage for mock-role override behavior and participant module filtering:
  - `test/authenticate-middleware.test.ts`
  - `test/m0-foundation.test.ts`

## 0.3.129 - 2026-03-13
### Summary
Added a single explicit policy document for the assessment decision pipeline so automatic pass, automatic fail, manual review, secondary assessment, red flags, and borderline handling are now documented in one place.

### Included
- Added the consolidated assessment decision policy document:
  - `doc/ASSESSMENT_DECISION_POLICY.md`

## 0.3.128 - 2026-03-13
### Summary
Simplified the fail-vs-review policy so clearly failing submissions no longer open manual review solely because the LLM recommended review; manual review is now reserved for red flags, borderline scores, and explicitly forced review.

### Included
- Changed decision policy so `manual_review_recommended` by itself no longer escalates clearly failing submissions:
  - `src/services/decisionService.ts`
- Added regression coverage for low-score submissions that previously still opened manual review despite being obvious fails:
  - `test/unit/decision-service.test.ts`

## 0.3.127 - 2026-03-13
### Summary
Broadened the insufficient-evidence auto-fail heuristic so clearly non-substantive, low-confidence submissions that require additional materials now fail automatically instead of being routed to manual review.

### Included
- Expanded insufficient-evidence phrase matching in the assessment decision service:
  - `src/services/decisionService.ts`
- Added regression coverage for low-confidence non-substantive submissions that previously still opened manual review:
  - `test/unit/decision-service.test.ts`

## 0.3.126 - 2026-03-13
### Summary
Changed assessment decision policy so clearly insufficient, low-evidence submissions now fail automatically instead of being routed to manual review, unless separate red-flag, borderline, or forced-review conditions are present.

### Included
- Added insufficient-evidence auto-fail handling in the assessment decision service:
  - `src/services/decisionService.ts`
- Extended unit coverage for low-evidence automatic fail and red-flag override behavior:
  - `test/unit/decision-service.test.ts`

## 0.3.125 - 2026-03-13
### Summary
Fixed manual-review claim ownership matching so the reviewer workspace recognises the current mock reviewer even when the active identity form shows external user ID while the queue/details primarily show reviewer email.

### Included
- Updated reviewer-claim matching in the manual-review workspace to accept either reviewer ID or reviewer email:
  - `public/manual-review.js`
- Extended focused regression coverage for the manual-review claim gating hook:
  - `test/workspace-validation-accessibility.test.js`

## 0.3.124 - 2026-03-12
### Summary
Improved the first participant/reviewer UX batch from the `#47` expert review by clarifying flow progress, draft persistence, appeal follow-up, and manual-review action sequencing.

### Included
- Changed the participant progress indicator to start at `Select Module` instead of showing `Step 2 of 5` on first load:
  - `public/participant.html`
  - `public/participant.js`
- Added clearer participant draft persistence signals with module-card draft badges, a browser-local autosave note, and a toast when switching away from a module with saved work:
  - `public/participant.html`
  - `public/participant.js`
  - `public/i18n/participant-translations.js`
- Added post-appeal next-steps guidance after appeal submission in the participant flow:
  - `public/participant.html`
  - `public/participant.js`
  - `public/i18n/participant-translations.js`
- Gated manual-review override actions until the selected review is claimed by the current reviewer, and added explicit action-order guidance near the controls:
  - `public/manual-review.html`
  - `public/manual-review.js`
  - `public/i18n/manual-review-translations.js`
- Extended focused regression coverage for the updated participant and manual-review UI hooks:
  - `test/participant-console-config.test.ts`
  - `test/participant-translations.test.js`
  - `test/workspace-validation-accessibility.test.js`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-validation-accessibility.test.js test/participant-translations.test.js`

## 0.3.123 - 2026-03-12
### Summary
Kept the top-level draft JSON textarea at a fixed size while preserving auto-growing behavior for the rest of the admin-content textareas.

### Included
- Excluded importDraftJson from admin-content textarea autosizing so the top-level draft editor keeps its original footprint:
  - public/admin-content.js`r

### Verification
- 
pm run lint`r

## 0.3.122 - 2026-03-12
### Summary
Improved admin-content authoring ergonomics with a one-click prompt copy action and auto-growing textareas, and updated the `#47` usability artefacts to reflect the current import/preview/publish UI.

### Included
- Added `Copy authoring prompt` to admin-content so content authors can copy the module draft prompt directly to the clipboard, together with an explicit reminder to replace the source-material references at the end before sending it to an LLM:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Added textarea autosizing in admin-content so large JSON/prompt/task fields expand to fit their content during typing, import, and load-back:
  - `public/admin-content.html`
  - `public/admin-content.js`
- Updated the `#47` discovery pack to reflect the current admin-content UX, including top-level import, prompt copy, preview, and publish semantics:
  - `doc/PHASE2_USABILITY_TEST_PLAN.md`
  - `doc/UX_SESSION_NOTES_TEMPLATE.md`
  - `doc/UX_FINDINGS_REPORT_TEMPLATE.md`
- Extended focused regression checks for the new admin-content button/translation keys:
  - `test/admin-content-translations.test.js`
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/admin-content-translations.test.js test/participant-console-config.test.ts`

## 0.3.121 - 2026-03-12
### Summary
Bundled the participant-preview button copy refinement with a more execution-ready usability discovery pack for `#47`.

### Included
- Renamed the admin-content participant-preview action to simpler preview labels across locales:
  - `public/i18n/admin-content-translations.js`
- Added reusable templates for live moderated session notes and consolidated findings reporting:
  - `doc/UX_SESSION_NOTES_TEMPLATE.md`
  - `doc/UX_FINDINGS_REPORT_TEMPLATE.md`
- Updated the Phase 2 usability plan to reference the new execution templates and make the discovery workflow more operational:
  - `doc/PHASE2_USABILITY_TEST_PLAN.md`

### Verification
- Documentation and copy change.

## 0.3.120 - 2026-03-12
### Summary
Fixed admin-content module status rendering for localized module titles and corrected the status badge/summary shown for module shells that exist without any saved versions yet.

### Included
- Localized module title, description, and certification level when the module status payload contains locale objects, preventing `[object Object]` from appearing in the status card:
  - `public/admin-content.js`
- Added a dedicated `module shell only` status instead of reusing `No module selected` when a module exists but no draft/published versions have been created yet:
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`

### Verification
- `npm run lint`
- `npm test -- test/admin-content-translations.test.js test/participant-console-config.test.ts`

## 0.3.119 - 2026-03-12
### Summary
Added a non-persistent participant preview flow for admin-content drafts so content authors can open the current draft in a participant-like view without saving, submitting, or scoring anything.

### Included
- Added `Open participant preview` to the admin-content workspace, storing the current draft in browser storage and opening `/participant?preview=1` in a new tab:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Added participant preview mode with a draft banner, local module loading, local MCQ progression, and explicit no-persistence/no-scoring behavior:
  - `public/participant.html`
  - `public/participant.js`
  - `public/i18n/participant-translations.js`
- Added focused regression coverage for the new admin-content and participant preview controls/translations:
  - `test/admin-content-translations.test.js`
  - `test/participant-translations.test.js`
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/admin-content-translations.test.js test/participant-translations.test.js test/participant-console-config.test.ts`

## 0.3.118 - 2026-03-12
### Summary
Clarified module-level availability dates in admin-content and automatically refreshed the module list after module creation or draft-JSON application so localized module titles show correctly without a manual refresh.

### Included
- Updated admin-content to reload the server-backed module list after `Create module` and `Apply draft JSON`, preserving the current success message while reselecting the relevant module:
  - `public/admin-content.js`
- Clarified that `Available from date` / `Available until date` are module-level availability windows layered on top of published-version activation:
  - `public/admin-content.html`
  - `public/i18n/admin-content-translations.js`
- Added focused regression coverage for the new admin-content help text and translation-key presence:
  - `test/participant-console-config.test.ts`
  - `test/admin-content-translations.test.js`

### Verification
- `npm run lint`
- `npm test -- test/admin-content-translations.test.js test/participant-console-config.test.ts`

## 0.3.117 - 2026-03-12
### Summary
Moved admin-content draft import to the top of the authoring flow so JSON-based module creation is presented as a first-class entry path rather than a version-only step.

### Included
- Moved `Import draft JSON` ahead of manual module-shell creation in the admin-content workspace and renumbered the downstream steps to reflect the new flow:
  - `public/admin-content.html`
- Updated admin-content translations and help text so the top-level import path is described consistently across locales:
  - `public/i18n/admin-content-translations.js`
- Added a regression check that the import controls render before the manual module shell fields:
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/admin-content-translations.test.js test/participant-console-config.test.ts`

## 0.3.116 - 2026-03-12
### Summary
Clarified the LLM authoring prompt for module draft JSON so it supports both downloadable `.json` output and copyable code-cell output, with clearer multilingual guidance.

### Included
- Updated the module draft authoring prompt with explicit output-format guidance and clearer expectations for localized fields:
  - `doc/MODULE_DRAFT_JSON_AUTHORING_PROMPT.md`

### Verification
- Documentation-only change.

## 0.3.115 - 2026-03-12
### Summary
Added a persistent incident log and documented the staging SQLite corruption incident plus the requirement to record future incidents there.

### Included
- Added a dedicated incident history document with a reusable template and the 2026-03-12 staging SQLite corruption entry:
  - `doc/INCIDENTS.md`
- Updated the observability runbook so future operational incidents are recorded in the incident log:
  - `doc/OBSERVABILITY_RUNBOOK.md`

### Verification
- Documentation-only change.

## 0.3.114 - 2026-03-12
### Summary
Stopped authentication middleware from masking backend database/runtime failures as `401 unauthorized`, and added focused regression coverage for auth error handling.

### Included
- Split authentication failures from repository/runtime failures in the auth middleware, returning `401` only for actual credential problems and forwarding backend failures as `500`:
  - `src/auth/authenticate.ts`
- Added regression coverage for missing Bearer-token handling and backend failure handling in the auth path:
  - `test/authenticate-middleware.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/authenticate-middleware.test.ts test/mock-auth-identity-reconciliation.test.ts test/m0-foundation.test.ts`

## 0.3.113 - 2026-03-12
### Summary
Closed the follow-up gaps from staging on participant submission validation and admin-content draft/import UX, and documented numbered manual UI test steps in the workflow guide.

### Included
- Required non-empty participant submission text before a submission can be created:
  - `public/participant.js`
  - `public/i18n/participant-translations.js`
- Fixed admin-content draft status so saved unpublished module versions are shown correctly, and simplified the import flow to one file picker plus one apply action:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Updated the workflow guidance so manual UI test scripts are always numbered:
  - `doc/AI_WORKFLOW.md`
- Refreshed regression coverage for the updated participant/admin UI and translations:
  - `test/participant-console-config.test.ts`
  - `test/participant-translations.test.js`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-validation-accessibility.test.js test/admin-content-translations.test.js test/participant-translations.test.js test/m2-admin-content-publication.test.ts`

## 0.3.112 - 2026-03-12
### Summary
Improved participant submission UX, redesigned the admin content workspace around live/draft module status, and added draft JSON import plus LLM authoring guidance for content owners.

### Included
- Simplified participant submission labels and reduced field-clutter while showing selected-module description:
  - `public/participant.html`
  - `public/participant.js`
  - `public/i18n/participant-translations.js`
- Redesigned the top of the admin content workspace around module status, human-readable version chains, and clearer action grouping:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Added draft JSON import support for both exported module bundles and simpler authoring drafts:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Added design and authoring support documents for the new admin-content workflow:
  - `doc/PHASE2_ADMIN_CONTENT_WORKSPACE_V2_DESIGN.md`
  - `doc/MODULE_DRAFT_JSON_AUTHORING_PROMPT.md`
- Updated regression coverage for participant/admin workspace HTML and translations:
  - `test/participant-console-config.test.ts`
  - `test/workspace-validation-accessibility.test.js`
  - `test/admin-content-translations.test.js`
  - `test/participant-translations.test.js`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-validation-accessibility.test.js test/admin-content-translations.test.js test/participant-translations.test.js test/m2-admin-content-publication.test.ts`

## 0.3.111 - 2026-03-11
### Summary
Fixed the participant workspace so published module assignment text and submission guidance are shown before a participant creates a submission.

### Included
- Extended module list responses with localized active-version task and guidance text:
  - `src/repositories/moduleRepository.ts`
- Preserved selected module content in participant state helpers:
  - `public/participant-console-state.js`
- Added an assignment brief block to the participant submission step:
  - `public/participant.html`
  - `public/participant.js`
  - `public/i18n/participant-translations.js`
- Added regression coverage for participant state, translations, config HTML, and localized module payloads:
  - `test/participant-console-state.test.js`
  - `test/participant-translations.test.js`
  - `test/participant-console-config.test.ts`
  - `test/m2-i18n-baseline.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-state.test.js test/participant-translations.test.js test/participant-console-config.test.ts test/m2-i18n-baseline.test.ts`

## 0.3.110 - 2026-03-11
### Summary
Added admin-content readback/export support for saved module configuration and improved participant MCQ readability with clearer question grouping and option alignment.

### Included
- Added module export/readback support in the admin content backend:
  - `src/routes/adminContent.ts`
  - `src/services/adminContentService.ts`
  - `src/repositories/adminContentRepository.ts`
- Added `Load selected content` and `Export selected module` actions in the admin content workspace:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Improved MCQ presentation in the participant workspace with structured question cards and aligned answer options:
  - `public/participant.js`
  - `public/static/shared.css`
- Added regression coverage for module export/readback and participant/admin workspace assets:
  - `test/unit/admin-content-service.test.ts`
  - `test/m2-admin-content-publication.test.ts`
  - `test/admin-content-translations.test.js`
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/m2-admin-content-publication.test.ts test/unit/admin-content-service.test.ts test/admin-content-translations.test.js test/participant-console-config.test.ts`

## 0.3.109 - 2026-03-11
### Summary
Improved the admin content workspace for multilingual module setup by making the module title field JSON-friendly, and added guarded module deletion so empty modules can be cleaned up safely.

### Included
- Replaced the module title input with a multiline textarea in the admin content workspace:
  - `public/admin-content.html`
- Added delete-selected-module action in the admin content workspace UI:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
- Added guarded backend delete support for modules with dependency checks and audit logging:
  - `src/routes/adminContent.ts`
  - `src/services/adminContentService.ts`
  - `src/repositories/adminContentRepository.ts`
- Added regression coverage for translations, service behavior, and integration behavior:
  - `test/admin-content-translations.test.js`
  - `test/unit/admin-content-service.test.ts`
  - `test/m2-admin-content-publication.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/m2-admin-content-publication.test.ts test/unit/admin-content-service.test.ts test/admin-content-translations.test.js`

## 0.3.108 - 2026-03-11
### Summary
Added a V2 readiness checklist to support a go/no-go decision on whether the current platform state should stay in `0.3.x`, move to an internal-pilot `0.4.x`, or be promoted to a clearer V2 milestone such as `0.5.0`.

### Included
- Added release-readiness checklist covering:
  - functional end-to-end validation
  - auth/RBAC
  - content ownership
  - UX/usability validation
  - policy and retention readiness
  - deployment/observability
  - SQLite acceptance criteria
  - release decision outcomes
  - `doc/V2_READINESS_CHECKLIST.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.107 - 2026-03-11
### Summary
Updated the PostgreSQL migration backlog stance for `#91`: SQLite remains the chosen runtime for now, with PostgreSQL deferred to `Pri-4 / Version X` unless concrete operational symptoms appear.

### Included
- Extended PostgreSQL migration note with:
  - explicit defer decision for the current small, non-critical workload
  - symptom list that should trigger re-evaluation
  - `doc/POSTGRES_MIGRATION_PLAN.md`
- Updated architecture note to reflect the accepted temporary deferment:
  - `doc/ARCHITECTURE.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.106 - 2026-03-11
### Summary
Progressed `#91` with a repo-specific PostgreSQL migration plan covering Prisma provider alignment, script replacement, CI changes, Azure runtime wiring, rollback boundaries, and phased verification.

### Included
- Added PostgreSQL migration plan:
  - `doc/POSTGRES_MIGRATION_PLAN.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.105 - 2026-03-11
### Summary
Progressed `#47` with a moderated usability test plan covering participant and admin/reviewer journeys, module-switch/resume behavior, evidence capture, severity scoring, and backlog conversion guidance.

### Included
- Added usability test plan:
  - `doc/PHASE2_USABILITY_TEST_PLAN.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.104 - 2026-03-11
### Summary
Progressed `#36` with a retention/deletion policy hardening draft that maps current assessment data categories to proposed retention windows, technical controls, ownership, and implementation slices pending legal approval.

### Included
- Added retention policy hardening draft:
  - `doc/PHASE2_RETENTION_POLICY_HARDENING.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.103 - 2026-03-11
### Summary
Completed `#42` by finishing the Azure environment runbook with explicit redeploy, teardown, and cost-review procedures to match the existing IaC/workflow automation baseline.

### Included
- Extended Azure environment runbook with:
  - redeploy steps for staging and production
  - teardown commands for dedicated staging/production resource groups
  - recurring cost-review checklist
  - `doc/AZURE_ENVIRONMENTS.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.102 - 2026-03-11
### Summary
Progressed `#68` with a discovery note for composite certifications built from module sets, covering architecture options, risk/mitigation, phased rollout, rollback, complexity assessment, and recommended issue splitting.

### Included
- Added composite-certification discovery note:
  - `doc/V3_COMPOSITE_CERTIFICATIONS_DISCOVERY.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.101 - 2026-03-11
### Summary
Progressed `#69` with a design note for dynamic rubric criteria, including options/trade-offs, legacy migration strategy, phased rollout, rollback, complexity assessment, and test strategy.

### Included
- Added dynamic rubric criteria design note:
  - `doc/PHASE2_DYNAMIC_RUBRIC_CRITERIA_DESIGN.md`

### Verification
- Documentation-only change; no code-path behavior changed locally.

## 0.3.100 - 2026-03-11
### Summary
Completed `#76` by extending the HTML i18n fallback regression coverage to the `manual-review` workspace and confirming there are no remaining blank `data-i18n` elements across the current workspace HTML pages.

### Included
- Extended workspace HTML fallback regression coverage to include:
  - `public/manual-review.html`
  - `test/workspace-html-fallbacks.test.js`

### Verification
- `npm run lint`
- `npm test -- test/workspace-html-fallbacks.test.js test/participant-console-config.test.ts test/participant-translations.test.js test/workspace-validation-accessibility.test.js`

## 0.3.99 - 2026-03-11
### Summary
Implemented `#79` by adding an accessible step progress indicator to the participant assessment flow so users can see where they are in the sequence from identity to assessment.

### Included
- Added participant-only progress indicator markup and styles:
  - `public/participant.html`
- Updated participant flow rendering so the active/completed/pending step updates as the flow advances:
  - `public/participant.js`
- Added participant translation keys for step labels and progress summary text:
  - `public/i18n/participant-translations.js`
- Added regression coverage ensuring the progress indicator is present only on the participant page:
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/participant-translations.test.js test/workspace-html-fallbacks.test.js test/workspace-validation-accessibility.test.js`

## 0.3.98 - 2026-03-11
### Summary
Completed `#73` by locking accessible validation hint and error styling into the shared workspace CSS and adding regression tests for hint/error/ARIA wiring across participant, appeal-handler, and manual-review.

### Included
- Added a shared warning-state helper class alongside the existing hint, error, success, and invalid-field styles:
  - `public/static/shared.css`
- Added regression coverage verifying:
  - hint/error/success/invalid styles remain present in shared CSS
  - `aria-describedby` wiring remains intact for participant and reviewer validation fields
  - runtime code keeps `role="alert"` and invalid-field hooks for validation errors
  - `test/workspace-validation-accessibility.test.js`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-html-fallbacks.test.js test/participant-translations.test.js test/workspace-validation-accessibility.test.js`

## 0.3.97 - 2026-03-11
### Summary
Implemented `#74` by replacing default raw JSON output on the participant and appeal-handler pages with toast notifications, while keeping expandable raw response details for admin-content and calibration.

### Included
- Added shared toast assets:
  - `public/static/toast.css`
  - `public/static/toast.js`
- Replaced default participant response logging with toast notifications and moved raw response output behind `?debug=1`:
  - `public/participant.html`
  - `public/participant.js`
- Replaced default appeal-handler response logging with toast notifications and moved raw response output behind `?debug=1`:
  - `public/appeal-handler.html`
  - `public/appeal-handler.js`
- Kept admin-content and calibration raw responses as explicit expandable details:
  - `public/admin-content.html`
  - `public/calibration.html`
- Added regression coverage for toast assets, hidden debug output sections, and raw response summaries:
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-html-fallbacks.test.js test/participant-translations.test.js`

## 0.3.96 - 2026-03-11
### Summary
Implemented `#72` by adding reusable loading and empty-state feedback for data-fetching sections in the participant, appeal-handler, and calibration workspaces.

### Included
- Added shared loading helpers and styles:
  - `public/static/loading.css`
  - `public/static/loading.js`
- Added loading skeletons and empty-state messages to participant data-fetch sections:
  - module loading
  - assessment progress checks
  - submission history
- Added queue loading and empty-state rendering to the appeal-handler queue:
  - `public/appeal-handler.js`
  - `public/appeal-handler.html`
- Added loading and empty-state rendering to calibration signals, outcomes, and benchmark anchors:
  - `public/calibration.js`
  - `public/calibration.html`
- Added participant translation keys for initial and post-load module empty states:
  - `public/i18n/participant-translations.js`
- Added regression coverage for loading assets and workspace page linkage:
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-html-fallbacks.test.js test/participant-translations.test.js`

## 0.3.95 - 2026-03-11
### Summary
Implemented `#92` by removing the redundant manual queue-load controls from the appeal-handler and manual-review workspaces, keeping queue refresh automatic and filter-driven.

### Included
- Removed redundant queue-load buttons from:
  - `public/appeal-handler.html`
  - `public/manual-review.html`
- Kept queue loading automatic on page load and status-filter changes while preserving guarded reload behavior in:
  - `public/appeal-handler.js`
  - `public/manual-review.js`
- Updated workspace copy so it no longer implies a manual load step:
  - automatic-refresh hint text
  - queue empty-state messages
  - queue updated status messages
- Added markup regression checks ensuring the removed buttons do not reappear:
  - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/workspace-html-fallbacks.test.js test/participant-translations.test.js`

## 0.3.94 - 2026-03-11
### Summary
Implemented `#88` by adding inline `en-GB` fallback copy to workspace HTML so `data-i18n` content is legible on initial render before JavaScript runs.

### Included
- Updated static workspace HTML with inline English fallback copy:
  - `public/participant.html`
  - `public/admin-content.html`
  - `public/appeal-handler.html`
  - `public/calibration.html`
  - `public/participant-completed.html`
- Added regression coverage:
  - `test/workspace-html-fallbacks.test.js`
- Verified placeholder fallbacks for workspace filters that depend on `data-i18n-placeholder`

### Verification
- `npm run lint`
- `npm test -- test/workspace-html-fallbacks.test.js test/participant-console-config.test.ts`

## 0.3.93 - 2026-03-11
### Summary
Continued `#84` by adding unit coverage for `recertificationService.ts`, focusing on decision-driven status upserts, lifecycle status derivation, and scheduled reminder delivery with duplicate-send protection.

### Included
- New unit test:
  - `test/unit/recertification-service.test.ts`
- Added service-level unit coverage for:
  - missing-decision validation during recertification upsert
  - passing-decision recertification date/status computation
  - `deriveRecertificationStatus()` due-soon lifecycle behavior
  - reminder-schedule processing with sent/skipped counters and duplicate-send protection

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.92 - 2026-03-11
### Summary
Continued `#84` by adding unit coverage for `orgSyncService.ts`, focusing on delta-sync outcome counting, create/update behavior, strict conflict failure handling, and org-sync audit/operational logging.

### Included
- New unit test:
  - `test/unit/org-sync-service.test.ts`
- Added service-level unit coverage for:
  - create/update/re-key behavior during delta sync
  - strict conflict failure handling when email and external ID disagree
  - org-sync completion summary counts
  - failed-record audit logging and operational event logging

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.91 - 2026-03-11
### Summary
Continued `#84` by adding unit coverage for `calibrationWorkspaceService.ts`, targeting snapshot assembly, benchmark-anchor extraction, signal calculation, and calibration audit logging.

### Included
- New unit test:
  - `test/unit/calibration-workspace-service.test.ts`
- Added service-level unit coverage for:
  - missing-module validation
  - outcome mapping from submission data
  - benchmark-anchor extraction from prompt-template example payloads
  - calibration signal and threshold-flag computation
  - calibration workspace access audit logging

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.90 - 2026-03-11
### Summary
Continued `#84` by adding unit coverage for `adminContentService.ts`, focusing on validation, dependency checks, benchmark prompt enrichment, and publication auditing.

### Included
- New unit test:
  - `test/unit/admin-content-service.test.ts`
- Added service-level unit coverage for:
  - module date validation
  - module creation audit logging
  - module-version dependency mismatch validation
  - benchmark example prompt enrichment and audit logging
  - module-version publication audit metadata including previous active version

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.89 - 2026-03-11
### Summary
Continued `#84` by adding focused unit coverage for `reportingService.ts`, targeting service-layer aggregation, filtering, MCQ quality flagging, and CSV serialization behavior.

### Included
- New unit test:
  - `test/unit/reporting-service.test.ts`
- Added service-level unit coverage for:
  - pass-rate aggregation filtered by requested outcome
  - MCQ quality flagging for easy/low-discrimination questions
  - CSV export escaping for commas, quotes, and null values

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.88 - 2026-03-11
### Summary
Continued `#84` by adding focused unit coverage for `submissionService.ts`, especially the submission-creation path that combines module lookup, document parsing, persistence, audit logging, and operational logging.

### Included
- New unit test:
  - `test/unit/submission-service.test.ts`
- Added service-level unit coverage for:
  - validation failure when no published active module version exists
  - successful submission creation from parsed attachment text
  - propagation of locale, attachment, and submission status into repository persistence
  - audit and operational logging side effects after successful submission creation

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.87 - 2026-03-11
### Summary
Expanded `#84` with the first additional unit-test slice for workflow-heavy services by covering `appealService.ts` and `manualReviewService.ts`.

### Included
- New unit tests:
  - `test/unit/appeal-service.test.ts`
  - `test/unit/manual-review-service.test.ts`
- Added service-level unit coverage for:
  - appeal creation validation when the submission is missing
  - appeal creation happy path with notification failure tolerance
  - appeal claim conflict when a case is already assigned
  - appeal resolution happy path with immutable decision creation and recertification update
  - manual review claim validation for missing/already-assigned cases
  - manual review override validation when no decision exists
  - manual review override happy path with decision creation, completion update, and audit side effects

### Verification
- `npm run lint`
- `npm run test:unit`

## 0.3.86 - 2026-03-11
### Summary
Refactored background processing for `#90` so the assessment worker and appeal SLA monitor use injectable lifecycle classes instead of module-level singleton state in service files.

### Included
- New background lifecycle classes:
  - `src/services/AssessmentWorker.ts`
  - `src/services/AppealSlaMonitor.ts`
- Service-layer refactor:
  - `src/services/assessmentJobService.ts`
  - removed module-level worker timer/running state
  - exported `processNextJob()` for direct worker execution
  - `src/services/appealSlaMonitorService.ts`
  - removed module-level monitor timer/running state
- Bootstrap update:
  - `src/index.ts`
  - application startup now instantiates `AssessmentWorker` and `AppealSlaMonitor`
  - graceful shutdown stops the instantiated worker and monitor
- Test coverage:
  - `test/unit/assessment-worker.test.ts`
  - `test/unit/appeal-sla-monitor.test.ts`
  - `test/assessment-worker-process-error.test.ts`
  - updated to verify the new instanced worker contract
- Documentation update:
  - `doc/ARCHITECTURE.md`
  - background-processing section now reflects injectable lifecycle ownership

### Verification
- `npm run lint`
- `npm run test:unit`
- `npx dotenv -e .env.test -- vitest run --config vitest.integration.config.ts test/assessment-worker-process-error.test.ts test/m2-appeal-sla-monitor.test.ts test/m1-core-flow.test.ts`

## 0.3.85 - 2026-03-11
### Summary
Completed the service-layer repository migration in `#80`, so service files no longer import Prisma directly, and updated the architecture documentation to match the new data-access boundary.

### Included
- New repository:
  - `src/repositories/certificationRepository.ts`
- Additional repositories:
  - `src/repositories/reportingRepository.ts`
  - `src/repositories/calibrationRepository.ts`
  - `src/repositories/adminContentRepository.ts`
- Repository extensions:
  - `src/repositories/decisionRepository.ts`
  - `src/repositories/auditRepository.ts`
  - `src/repositories/userRepository.ts`
  - `src/repositories/appealRepository.ts`
- Service migrations:
  - `src/services/recertificationService.ts`
  - `src/services/orgSyncService.ts`
  - `src/services/appealSlaMonitorService.ts`
  - `src/services/reportingService.ts`
  - `src/services/calibrationWorkspaceService.ts`
  - `src/services/adminContentService.ts`
  - removed direct Prisma access from all remaining service files
  - routed recertification status reads/writes through repository boundaries
  - routed org delta sync user lookup/update/create through `userRepository`
  - routed SLA monitor backlog queries through `appealRepository`
  - routed reporting, calibration, and admin-content reads/writes through dedicated repositories
- Unit coverage:
  - `test/unit/certification-repository.test.ts`
- Documentation update:
  - `doc/ARCHITECTURE.md`
  - updated the data-access section to reflect that services now depend on repositories rather than direct Prisma imports

### Verification
- `npm run lint`
- `npm run test:unit`
- `npm run pretest`
- `npm run test:integration`
- `npx dotenv -e .env.test -- vitest run --config vitest.integration.config.ts test/m2-org-sync.test.ts test/m2-recertification-flow.test.ts test/m2-appeal-sla-monitor.test.ts`
- `npx dotenv -e .env.test -- vitest run --config vitest.integration.config.ts test/m2-reporting.test.ts`
- `npx dotenv -e .env.test -- vitest run --config vitest.integration.config.ts test/m2-calibration-workspace.test.ts test/m2-admin-content-publication.test.ts`

## 0.3.84 - 2026-03-11
### Summary
Clarified the verification split between Codex and the human reviewer in the AI workflow.

### Included
- Workflow documentation update:
  - `doc/AI_WORKFLOW.md`
  - added explicit verification responsibilities:
    - Codex verifies code structure, API behavior, and automated tests
    - human verifies UI behavior and browser-observed outcomes
    - mixed issues follow backend/API verification first, then final human UI verification

### Verification
- Documentation-only update; no code-path changes were made

## 0.3.83 - 2026-03-11
### Summary
Added a permanent architecture overview and clarified the README introduction so the system purpose and core functional scope are easier to understand.

### Included
- Documentation additions:
  - `doc/ARCHITECTURE.md`
  - added a stable architecture reference covering purpose, core domain flow, main components, workspaces, technologies/products/standards, deployment shape, and known architectural debt
- README clarification:
  - `README.md`
  - added explicit sections for solution purpose and core functionality
  - added a direct link to `doc/ARCHITECTURE.md`

### Verification
- Documentation-only update; no code-path changes were made

## 0.3.82 - 2026-03-11
### Summary
Expanded the unit-test path with SLA and decision-service coverage and added dedicated unit/integration Vitest entrypoints.

### Included
- Unit test additions:
  - `test/unit/appeal-sla.test.ts`
  - `test/unit/decision-service.test.ts`
  - `test/unit/submission-repository.test.ts`
  - `test/unit/appeal-repository.test.ts`
  - `test/unit/assessment-job-repository.test.ts`
  - `test/unit/manual-review-repository.test.ts`
  - `test/unit/mcq-repository.test.ts`
  - `test/unit/decision-repository.test.ts`
  - `test/unit/audit-repository.test.ts`
  - added SLA boundary coverage for on-track, at-risk, overdue, and resolved appeals
  - added mocked Prisma coverage for `createAssessmentDecision()`
- Repository migration slice:
  - `src/repositories/submissionRepository.ts`
  - `src/repositories/appealRepository.ts`
  - `src/repositories/assessmentJobRepository.ts`
  - `src/repositories/manualReviewRepository.ts`
  - `src/repositories/mcqRepository.ts`
  - `src/repositories/decisionRepository.ts`
  - `src/repositories/auditRepository.ts`
  - `src/repositories/moduleRepository.ts`
  - `src/services/submissionService.ts`
  - `src/services/appealService.ts`
  - `src/services/assessmentJobService.ts`
  - `src/services/manualReviewService.ts`
  - `src/services/mcqService.ts`
  - `src/services/decisionService.ts`
  - `src/services/auditService.ts`
  - migrated submission, appeal, assessment-job, manual-review, MCQ, decision, and audit data access out of services into repositories
- Test execution split:
  - `vitest.unit.config.ts`
  - `vitest.integration.config.ts`
  - `package.json`
  - added `test:unit` and `test:integration` scripts while leaving `test` unchanged

### Verification
- Focused unit validation planned for the new unit suite and related no-DB tests

## 0.3.81 - 2026-03-11
### Summary
Clarified the AI workflow so GitHub issues must be updated when work is partially implemented and only closed after human verification.

### Included
- Workflow policy updates:
  - `doc/AI_WORKFLOW.md`
  - added explicit issue-status hygiene rules before implementation, after partial implementation, and after completion
  - required the issue tracker to reflect actual implementation status rather than the original plan
  - clarified that human-verified complete issues should be updated and then closed

### Verification
- Documentation-only update; no code-path changes were made

## 0.3.80 - 2026-03-11
### Summary
Refreshed README documentation so the documented workspace routes, manual-review workflow, reviewer defaults, and participant auto-assessment behavior now match the current implementation.

### Included
- README accuracy updates:
  - `README.md`
  - corrected manual-review API action from `POST /api/reviews/:reviewId/resolve` to `POST /api/reviews/:reviewId/override`
  - added the dedicated `/manual-review` workspace route to the documented UI surface
  - added a manual testing section for the reviewer workspace
  - documented `manualReviewWorkspace.queuePageSize` and `identityDefaults.reviewer`
  - corrected participant auto-start documentation to reflect that manual fallback assessment controls remain visible

### Verification
- Documentation-only update; no code-path changes were made

## 0.3.79 - 2026-03-10
### Summary
Separated manual review from appeals into its own reviewer workspace, restored `appeal-handler` to an appeals-only queue, clarified the workspace scope in UI copy, and seeded a pending manual-review case so the reviewer queue is not empty in a standard environment.

### Included
- Dedicated manual review workspace:
  - `public/manual-review.html`
  - `public/manual-review.js`
  - `public/i18n/manual-review-translations.js`
  - added a standalone queue and detail workspace for `/api/reviews`
  - supports reviewer identity, queue filtering, claim, and override flows
- Runtime config and navigation:
  - `config/participant-console.json`
  - `src/config/participantConsole.ts`
  - `src/app.ts`
  - added `manual-review` navigation item, `manualReviewWorkspace` runtime config, reviewer identity defaults, and a `/manual-review` page route
- Appeal workspace clarification:
  - `public/appeal-handler.html`
  - `public/appeal-handler.js`
  - `public/i18n/appeal-handler-translations.js`
  - removed manual-review queue filtering from `appeal-handler`
  - clarified that appeal handling only covers appeals
  - simplified manual-review context in appeal details so submissions without manual-review history no longer show a full block of placeholder fields
- Appeal queue payload rollback:
  - `src/services/appealService.ts`
  - removed latest-manual-review data from the appeal queue list payload
- Seeded reviewer workflow visibility:
  - `prisma/seed.ts`
  - added explicit reviewer and appeal-handler users with role assignments
  - added one seeded pending `OPEN` manual review with supporting submission, MCQ, LLM evaluation, and decision data
- Tests:
  - `test/participant-console-config.test.ts`
  - `test/m2-manual-review.test.ts`
  - added route/config coverage for `/manual-review`
  - added assertion that seeded environments expose at least one pending manual review in the reviewer queue

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/participant-console-production-config.test.ts test/m2-manual-review.test.ts test/m2-appeal-flow.test.ts`

## 0.3.78 - 2026-03-10
### Summary
Made manual review state visible and filterable in the appeal handler queue so appeal handlers can find appeals tied to submissions that are under manual review.

### Included
- Appeal queue data expansion:
  - `src/services/appealService.ts`
  - queue payload now includes the latest manual review record for each submission in the appeal list
- Appeal handler queue UI:
  - `public/appeal-handler.html`
  - added a dedicated `Manual review status` filter group and a `Manual review` table column
  - expanded the queue toolbar layout to accommodate the extra filter controls
- Appeal handler queue logic:
  - `public/appeal-handler.js`
  - added local filtering by latest manual review status (`None`, `Open`, `In review`, `Resolved`)
  - included manual review status in queue search matching
  - rendered latest manual review status directly in the queue table
- Translation update:
  - `public/i18n/appeal-handler-translations.js`
  - added English fallback copy for the new queue filter, column, and manual review status labels

### Verification
- `npm run lint`
- `npm test -- test/m2-appeal-flow.test.ts test/m2-manual-review.test.ts`

## 0.3.77 - 2026-03-10
### Summary
Exposed manual review data inside the appeal handler detail panel so appeal handlers can see the latest manual treatment for the underlying submission.

### Included
- Appeal handler detail panel update:
  - `public/appeal-handler.js`
  - added a `Manual review` section to the selected appeal details
  - now shows latest manual review ID, status, trigger reason, reviewer ID, timestamps, and override outcome
- Translation update:
  - `public/i18n/appeal-handler-translations.js`
  - added English labels for the new manual review detail fields, used as fallback for other locales

### Verification
- `npm run lint`
- `npm test -- test/m2-appeal-flow.test.ts test/m2-manual-review.test.ts`

## 0.3.76 - 2026-03-10
### Summary
Moved `appeal-handler` resolve validation feedback into the resolve form itself so short input errors no longer surface in the generic system response area.

### Included
- Resolve form UX fix:
  - `public/appeal-handler.html`
  - `public/appeal-handler.js`
  - added inline validation message area for resolve fields
  - added client-side minimum-length checks for decision reason and resolution note
  - resolve-related `validation_error` responses now render inline near the form
- Translation update:
  - `public/i18n/appeal-handler-translations.js`
  - added English validation copy for the resolve fields, used as fallback for other locales

### Verification
- `npm run lint`
- `npm test -- test/m2-appeal-flow.test.ts`

## 0.3.75 - 2026-03-10
### Summary
Adjusted the participant assessment UX so auto-started assessments keep manual follow-up controls visible and wait longer before showing a timeout.

### Included
- Participant workspace fallback improvements:
  - `public/participant.js`
  - manual `Check progress` and `Check result` controls remain available even when auto-start after MCQ is enabled
- Assessment wait tuning:
  - `config/participant-console.json`
  - increased `flow.maxWaitSeconds` from `90` to `180`
- Participant copy update:
  - `public/i18n/participant-translations.js`
  - timeout text now points to the visible manual fallback controls below the status area
- Config verification update:
  - `test/participant-console-config.test.ts`
  - updated runtime-config expectation for the longer wait window

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/m1-core-flow.test.ts`

## 0.3.74 - 2026-03-10
### Summary
Extracted the duplicated frontend API/config fetch logic into a shared `api-client` module and migrated all five workspace pages to use it.

### Included
- Shared frontend API client:
  - `public/api-client.js`
  - added shared `apiFetch()`, `getConsoleConfig()`, and `buildConsoleHeaders()`
  - centralized response parsing and non-OK error normalization
  - cached `/participant/config` loading in-module
- Workspace page migration:
  - `public/participant.js`
  - `public/admin-content.js`
  - `public/appeal-handler.js`
  - `public/calibration.js`
  - `public/participant-completed.js`
  - removed local `api()` wrappers from all five files
  - replaced per-page `/participant/config` fetch logic with `getConsoleConfig()`

### Verification
- `npm run lint`
- `npm test -- test/participant-console-config.test.ts test/participant-console-production-config.test.ts`

## 0.3.73 - 2026-03-10
### Summary
Replaced string-coded service errors with a typed `AppError` hierarchy, removed route-level `error.message` decoding, and centralized HTTP status mapping in shared error middleware.

### Included
- Typed application error model:
  - `src/errors/AppError.ts`
  - added `AppError`, `NotFoundError`, `ConflictError`, `ValidationError`, and `ForbiddenError`
- Shared error middleware:
  - `src/middleware/errorHandling.ts`
  - `src/app.ts`
  - global middleware now maps `AppError` subclasses to their configured HTTP status and API error code
- Service migration away from string-coded domain errors:
  - `src/services/appealService.ts`
  - `src/services/manualReviewService.ts`
  - `src/services/submissionService.ts`
  - `src/services/auditService.ts`
  - `src/services/calibrationWorkspaceService.ts`
  - `src/services/orgSyncService.ts`
  - `src/services/recertificationService.ts`
  - removed string-coded `throw new Error("...")` contracts from the migrated services
- Route cleanup:
  - `src/routes/submissions.ts`
  - `src/routes/appeals.ts`
  - `src/routes/reviews.ts`
  - `src/routes/audit.ts`
  - `src/routes/calibration.ts`
  - removed route-level `error.message === "..."` decoding and delegated typed errors via `next(error)`
- Test coverage:
  - `test/app-error-middleware.test.ts`
  - added explicit middleware mapping tests for 400/403/404/409/500 behavior

### Verification
- `npm run lint`
- `npm test -- test/app-error-middleware.test.ts test/m2-appeal-flow.test.ts test/m2-manual-review.test.ts test/m2-audit-pipeline.test.ts test/m2-calibration-workspace.test.ts`

## 0.3.72 - 2026-03-10
### Summary
Removed direct database access from the assessments route so submission ownership checks and assessment-view queries now stay inside the service layer.

### Included
- Layering cleanup for assessments endpoints:
  - `src/routes/assessments.ts`
  - `src/services/submissionService.ts`
  - removed direct `prisma` import from `assessments.ts`
  - `POST /api/assessments/:submissionId/run` now uses `getOwnedSubmission()`
  - `GET /api/assessments/:submissionId` now uses the new `getSubmissionForAssessmentView()`
- Service extraction:
  - `src/services/submissionService.ts`
  - added `getSubmissionForAssessmentView(submissionId, userId)` for the assessment workspace response shape

### Verification
- `npm run lint`
- `npm test -- test/m1-core-flow.test.ts test/rate-limiting.test.ts`

## 0.3.71 - 2026-03-10
### Summary
Propagated participant locale into stored submissions and the LLM assessment pipeline, so localized module task and guidance context now follows the participant's actual request locale.

### Included
- Submission locale persistence:
  - `prisma/schema.prisma`
  - `prisma/migrations/2026031001_add_submission_locale/migration.sql`
  - `src/services/submissionService.ts`
  - `src/routes/submissions.ts`
  - added `Submission.locale` with default `en-GB`
  - submission creation now stores `request.context.locale ?? env.DEFAULT_LOCALE`
- LLM locale propagation:
  - `src/services/assessmentJobService.ts`
  - replaced hardcoded `en-GB` localization in assessment prompts with the stored submission locale
  - submission locale is normalized before task/guidance text localization
- Test coverage:
  - `test/m2-i18n-baseline.test.ts`
  - added assertion that `/api/submissions` stores `locale`
  - added integration coverage proving Norwegian submission locale reaches the Azure OpenAI request payload as localized task/guidance context

### Verification
- `npm run prisma:generate`
- `npm run lint`
- `npm test -- test/m2-i18n-baseline.test.ts test/m1-core-flow.test.ts`

## 0.3.70 - 2026-03-10
### Summary
Hardened runtime safety and abuse controls, added server-controlled debug-panel gating with Azure environment override support, and documented the new deployment-facing configuration.

### Included
- Runtime/process hardening:
  - `src/index.ts`
  - `src/process/processErrorHandlers.ts`
  - added structured logging for `unhandledRejection` and `uncaughtException`
  - graceful shutdown now stops background workers before exit
- API rate limiting:
  - `src/middleware/rateLimiting.ts`
  - `src/app.ts`
  - `src/routes/assessments.ts`
  - `src/routes/submissions.ts`
  - `src/routes/modules.ts`
  - added:
    - general API limiter
    - tighter limiter for assessment queueing
    - limiter for submission creation
    - limiter for MCQ submission
  - rate-limited responses now return HTTP `429` with `Retry-After`
- Debug output gating for workspace UIs:
  - `src/config/participantConsole.ts`
  - `public/participant.html`
  - `public/participant.js`
  - `public/appeal-handler.html`
  - `public/appeal-handler.js`
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/calibration.html`
  - `public/calibration.js`
  - `public/participant-completed.html`
  - `public/participant-completed.js`
  - `/participant/config` now includes `debugMode`
  - participant and appeal-handler pages hide raw JSON output when debug is disabled
  - admin-content and calibration pages now wrap raw responses in collapsible `<details>`
  - all workspace pages now show a lightweight status line even when raw JSON is hidden
- Azure/app-setting debug override:
  - `src/config/env.ts`
  - `.env.example`
  - `.azure/environments/staging.env.example`
  - `.azure/environments/production.env.example`
  - `README.md`
  - added `PARTICIPANT_CONSOLE_DEBUG_MODE=auto|true|false`
  - supports enabling debug panels in Azure staging while forcing them off in production
- Test coverage:
  - `test/process-error-handlers.test.ts`
  - `test/rate-limiting.test.ts`
  - `test/participant-console-config.test.ts`
  - `test/participant-console-production-config.test.ts`
  - added coverage for process error logging, rate limiting, and debug-mode config behavior

### Verification
- `npm run lint`
- `npm test -- test/process-error-handlers.test.ts test/rate-limiting.test.ts test/participant-console-config.test.ts test/participant-console-production-config.test.ts test/m1-core-flow.test.ts`

## 0.3.69 - 2026-03-10
### Summary
Replaced status multi-select controls with accessible checkbox-pill groups in appeal-handler and calibration workspaces while preserving existing API filter behavior.

### Included
- Replaced native multi-select status filters with pill-based checkbox groups (`#75`):
  - `public/appeal-handler.html`
  - `public/calibration.html`
  - both pages now use `<fieldset>` + `<legend>` + checkbox-pill container instead of `<select multiple>`
- Added shared pill-group styling in workspace stylesheet:
  - `public/static/shared.css`
  - new classes:
    - `.pill-group-fieldset`
    - `.pill-group`
    - `.pill-option`
  - includes checked-state styling and keyboard focus visibility for each pill option
- Updated appeal-handler filter logic for checkbox pills:
  - `public/appeal-handler.js`
  - reads selected statuses from checked checkboxes
  - preserves existing status query behavior (`status=<csv>`)
  - adds arrow-key navigation support between checkbox pills
- Updated calibration filter logic for checkbox pills:
  - `public/calibration.js`
  - reads selected statuses from checked checkboxes
  - preserves existing calibration status query parameter behavior
  - adds arrow-key navigation support between checkbox pills
- Updated status-filter helper text:
  - `public/i18n/participant-translations.js`
  - replaced legacy Ctrl/Cmd-click multi-select guidance with checkbox-based guidance (`en-GB`, `nb`, `nn`)
- Test and documentation updates:
  - `test/participant-console-config.test.ts`
    - validates that status filters are pill groups and that native multi-select ids are removed
    - validates `.pill-group` style presence in shared stylesheet
  - `README.md`
    - updated handler/calibration manual test notes to reflect checkbox pill filters and keyboard usage

### Verification
- `npm run lint`
- `npm test` (80 tests passing, 30 test files)

## 0.3.68 - 2026-03-10
### Summary
Implemented participant-form accessibility and validation UX hardening by adding explicit hint/error/success styles, ARIA hint linking, and field-level validation feedback.

### Included
- Added semantic validation text styles in shared workspace CSS:
  - `public/static/shared.css`
  - new classes:
    - `.hint`
    - `.field-error`
    - `.field-success`
    - `.is-invalid`
  - `.field-error` supports clear left-border error affordance for visual distinction
- Participant form hinting and ARIA linkage:
  - `public/participant.html`
  - added field-specific hint elements and `aria-describedby` links for:
    - `reflectionText`
    - `promptExcerpt`
    - `ack`
  - module selection hint upgraded to hint styling with base hint key metadata
- Participant validation behavior updates:
  - `public/participant.js`
  - submission validation now returns field/hint targets
  - introduced field-level invalid highlighting (`.is-invalid`)
  - introduced role-aware alerting on invalid hints (`role="alert"`)
  - validation summary now toggles between `.field-error` and `.field-success`
  - hint text resets to localized baseline when validation state changes
- Translation updates for new participant hint copy:
  - `public/i18n/participant-translations.js`
  - added:
    - `submission.hint.reflection`
    - `submission.hint.promptExcerpt`
    - `submission.hint.ack`
  - parity maintained for `en-GB`, `nb`, `nn`
- Test coverage updates:
  - `test/participant-console-config.test.ts`
  - validates participant page `aria-describedby` links and new shared CSS class markers
- Documentation:
  - `README.md` updated with participant validation-feedback note in manual flow section

### Verification
- `npm run lint`
- `npm test` (80 tests passing, 30 test files)

## 0.3.67 - 2026-03-10
### Summary
Implemented foundational UX/style refactor items by extracting shared workspace CSS, introducing brand design tokens, adding centered max-width layout containers, and applying semantic button variants across all workspace pages.

### Included
- Shared stylesheet extraction (`#70`):
  - added `public/static/shared.css`
  - all five workspace pages now link `/static/shared.css`
  - moved common rules out of inline `<style>` blocks (`body`, `.card`, `.row`, form controls, `.small`, workspace nav styles, `.button-busy`, `pre`, `.hidden`)
  - included responsive `@media (max-width: 900px)` row-collapse rule in shared stylesheet
- Static asset serving hardening:
  - `src/app.ts`
  - `/static` now serves `public/static` first and falls back to `public` to keep existing script paths stable
- Brand tokenization and card elevation (`#77`):
  - `public/static/shared.css`
  - added tokenized spacing/color/elevation model in `:root`
  - replaced legacy hardcoded color usage in workspace page-specific CSS with token variables
  - switched shared `.card` style from flat border to `box-shadow: var(--shadow-card)`
- Max-width layout container and responsive baseline (`#78`):
  - all five pages now wrap content in `.layout-container`
  - added centered max-width layout (`1100px`) and mobile padding override in shared CSS
  - enabled workspace nav horizontal overflow handling for small screens
- Semantic button variants (`#71`):
  - added `.btn-primary`, `.btn-secondary`, `.btn-danger` in shared CSS
  - mapped static buttons across all five pages to semantic variants
  - participant module selection cards (dynamic buttons) now include semantic secondary button class (`public/participant.js`)
- Tests and docs:
  - `test/participant-console-config.test.ts` extended to verify shared stylesheet linking/serving, layout container presence, tokenized stylesheet markers, and button class coverage
  - `README.md` updated with shared stylesheet/design-token/layout/button-variant notes

### Verification
- `npm run lint`
- `npm test` (80 tests passing, 30 test files)

## 0.3.66 - 2026-03-10
### Summary
Simplified the admin content authoring flow with one bundled save action, improved wording/help text and locale defaults, and extended LLM assessment context with explicit assignment and expected-answer guidance.

### Included
- Admin content flow simplification:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - removed intermediate save buttons in steps 2-4
  - added one combined save action in step 5 (`saveContentBundle`)
  - bundled save now creates rubric + prompt + test + module version in one flow
- Improved admin-content defaults and text clarity:
  - `public/i18n/admin-content-translations.js`
  - default JSON examples are now multiline/pretty-printed for readability
  - clearer helper text and field naming across locales
  - Norwegian wording updated to avoid `MCQ` label in UI copy
  - terminology aligned around `Innlevering`/`innlevering` for participant-facing task wording
- Locale-text parsing flexibility in admin content form:
  - `public/admin-content.js`
  - text fields now support plain text or locale JSON object input in a consistent parser path
- LLM context enrichment for better assessment grounding:
  - `src/services/assessmentJobService.ts`
  - `src/services/llmAssessmentService.ts`
  - assessment calls now include module assignment context (`taskText`) and expected-answer context (`guidanceText`)
- Norwegian charset/message cleanup:
  - `src/i18n/contentMessages.ts`
  - corrected mojibake/encoding artifacts in localized validation messages
- Documentation update:
  - `README.md`
  - reflects single bundled save flow in admin content setup
- Test updates:
  - `test/m2-admin-content-publication.test.ts`
  - `test/admin-content-translations.test.js`
  - `test/llm-assessment-service.test.ts`
  - coverage now includes locale-object payloads, new translation keys, and LLM context propagation

### Verification
- `npm run lint`
- `npm test` (79 tests passing, 30 test files)

## 0.3.65 - 2026-03-10
### Summary
Improved admin content usability with clearer field naming and helper guidance, and added explicit multi-locale content authoring support (including MCQ locale-aware answer matching).

### Included
- Admin content UX text revision and helper guidance:
  - `public/admin-content.html`
  - `public/i18n/admin-content-translations.js`
  - clearer section names, field labels, and instructional helper text
  - explicit guidance for plain text vs locale-JSON content format
  - clarified which field is participant-facing module task text
- Added inline locale-JSON content support:
  - `src/i18n/content.ts`
  - supports content values in format:
    - `{"en-GB":"...","nb":"...","nn":"..."}`
  - locale resolution now supports:
    - plain text + dictionary lookup
    - inline locale JSON values
  - added localized variant matching helper for answer equivalence
- Extended admin content API text-field flexibility:
  - `src/routes/adminContent.ts`
  - text inputs now accept plain text or locale JSON object for:
    - module create fields (`title`, `description`, `certificationLevel`)
    - prompt template fields (`systemPrompt`, `userPromptTemplate`)
    - MCQ fields (`title`, `stem`, `options`, `correctAnswer`, `rationale`)
    - module version fields (`taskText`, `guidanceText`)
  - values are serialized consistently for storage
- Fixed locale-aware MCQ correctness matching:
  - `src/services/mcqService.ts`
  - answer validation now accepts translated variants (not only exact source string)
- Documentation updates:
  - `doc/I18N.md`
  - `README.md`
  - added explicit admin content localization format and behavior
- Automated tests added/updated:
  - new `test/content-localization.test.ts`
  - updated `test/m2-i18n-baseline.test.ts` to verify localized MCQ submit correctness
  - updated `test/admin-content-translations.test.js` for new helper-label coverage

### Verification
- `npm run lint`
- `npm test` (79 tests passing, 30 test files)

## 0.3.64 - 2026-03-10
### Summary
Implemented admin content workspace enablement with end-to-end UI/API support for creating base modules and managing versioned rubric/prompt/MCQ/module content from a dedicated role-scoped page.

### Included
- Added base module creation to admin content API:
  - `POST /api/admin/content/modules`
  - `src/routes/adminContent.ts`
  - `src/services/adminContentService.ts`
  - validates optional validity dates and emits `module_created` audit event
- Added dedicated admin content workspace UI:
  - `public/admin-content.html`
  - `public/admin-content.js`
  - `public/i18n/admin-content-translations.js`
  - route `GET /admin-content` in `src/app.ts`
  - supports:
    - module creation
    - module loading/selection
    - rubric/prompt/MCQ version creation from JSON fields
    - module-version creation and publish
- Extended shared role-aware workspace navigation/config:
  - `config/participant-console.json`
  - `src/config/participantConsole.ts`
  - added `navigation.items[]` entry for `/admin-content`
  - added `identityDefaults.contentAdmin`
  - updated fallback nav in:
    - `public/participant.js`
    - `public/participant-completed.js`
    - `public/appeal-handler.js`
    - `public/calibration.js`
  - added shared i18n nav key `nav.adminContent` in `public/i18n/participant-translations.js`
- Added design/documentation updates:
  - `doc/PHASE2_ADMIN_CONTENT_WORKSPACE_DESIGN.md`
  - `README.md` updated with new UI/API/config/testing details
- Added/updated automated tests:
  - new translation parity test:
    - `test/admin-content-translations.test.js`
  - extended admin content integration coverage:
    - `test/m2-admin-content-publication.test.ts`
    - now creates module via API and verifies `module_created` audit event
    - includes date validation failure case for module create
  - updated runtime config/page route coverage:
    - `test/participant-console-config.test.ts`

### Verification
- `npm run lint`
- `npm test` (77 tests passing, 29 test files)

## 0.3.63 - 2026-03-10
### Summary
Implemented issue #66 with a dedicated participant completed-modules workspace, config-driven completion policy, and default filtering of completed modules from the active module list.

### Included
- Added central completion-policy config:
  - `config/module-completion.json`
  - keys:
    - `completedSubmissionStatuses`
    - `hideCompletedInAvailableByDefault`
    - `defaultCompletedHistoryLimit`
    - `maxCompletedHistoryLimit`
- Added completion config/policy runtime support:
  - `src/config/moduleCompletion.ts`
  - `src/services/moduleCompletionPolicyService.ts`
  - centralizes completed-status classification and include/limit resolution
- Updated module repository behavior:
  - `src/repositories/moduleRepository.ts`
  - `/api/modules` available list now excludes completed modules by default (config-driven)
  - added `listCompletedModulesForUser(...)` for module-level completion history with latest score/status
- Extended modules API:
  - `src/routes/modules.ts`
  - `GET /api/modules` now supports `includeCompleted=true|false` (explicit filter metadata in response)
  - new `GET /api/modules/completed?limit=<n>`
- Added participant completed-modules UI:
  - `public/participant-completed.html`
  - `public/participant-completed.js`
  - `public/i18n/participant-completed-translations.js`
  - new route `GET /participant/completed` in `src/app.ts`
- Navigation + i18n updates:
  - `config/participant-console.json`
  - `public/participant.js`
  - `public/appeal-handler.js`
  - `public/calibration.js`
  - `public/i18n/participant-translations.js` (`nav.completedModules`)
- Design/documentation updates:
  - `doc/PHASE2_PARTICIPANT_COMPLETED_MODULES_DESIGN.md`
  - `README.md` updated with new API/UI/config documentation
- Test updates:
  - new tests:
    - `test/m2-completed-modules.test.ts`
    - `test/module-completion-policy.test.ts`
    - `test/participant-completed-translations.test.js`
  - updated route/config coverage:
    - `test/participant-console-config.test.ts`
  - updated existing seed-module tests to use `includeCompleted=true` where required for deterministic baseline lookup:
    - `test/m0-foundation.test.ts`
    - `test/m1-core-flow.test.ts`
    - `test/m2-audit-pipeline.test.ts`
    - `test/m2-i18n-baseline.test.ts`
  - increased timeout for two long-running integration tests to stabilize full suite execution:
    - `test/m2-participant-results-history.test.ts`
    - `test/m2-reporting.test.ts`

### Verification
- `npm run lint`
- `npm test` (73 tests passing, 28 test files)

## 0.3.62 - 2026-03-10
### Summary
Implemented issue #67 (Phase A of #32) with a new read-only calibration workspace for SMEs/admins, including module-scoped historical outcomes, benchmark-anchor visibility, config-driven quality signals, and access auditing.

### Included
- New calibration workspace UI:
  - `public/calibration.html`
  - `public/calibration.js`
  - `public/i18n/calibration-translations.js`
  - route `GET /calibration` in `src/app.ts`
- New calibration API (read/analyze only):
  - `src/routes/calibration.ts`
  - `GET /api/calibration/workspace`
  - role-gated via config-driven access roles (`SUBJECT_MATTER_OWNER`, `ADMINISTRATOR`)
- New calibration data service:
  - `src/services/calibrationWorkspaceService.ts`
  - returns:
    - filtered module outcomes (`status`, `date`, `moduleVersion`)
    - benchmark anchor summary from prompt template examples
    - aggregate quality signals and threshold flags
  - records audit event:
    - `entityType=calibration_workspace`
    - `action=calibration_workspace_session_started`
- Config-driven calibration model extension:
  - `config/participant-console.json`
  - `src/config/participantConsole.ts`
  - new keys:
    - `calibrationWorkspace.accessRoles`
    - `calibrationWorkspace.defaults`
    - `calibrationWorkspace.signalThresholds`
    - `identityDefaults.calibrationOwner`
  - shared top-nav config expanded with `nav.calibration`
- Shared navigation + i18n updates:
  - `public/participant.js`
  - `public/appeal-handler.js`
  - `public/i18n/participant-translations.js`
- Documentation:
  - `doc/PHASE2_CALIBRATION_WORKSPACE_PHASE_A_DESIGN.md`
  - `README.md` (new UI/API endpoints and config keys)
- Automated tests:
  - `test/m2-calibration-workspace.test.ts`
  - `test/calibration-translations.test.js`
  - updated `test/participant-console-config.test.ts` for expanded runtime config contract

### Verification
- `npm run lint`
- `npm test` (66 tests passing, 25 test files)

## 0.3.61 - 2026-03-10
### Summary
Implemented issue #65 with a shared, config-driven top navigation for role-specific workspaces, including role-aware menu visibility and i18n labels.

### Included
- Added config-driven workspace navigation model:
  - `config/participant-console.json`
  - `src/config/participantConsole.ts`
  - new `navigation.items[]` runtime config (id/path/labelKey/requiredRoles)
- Added shared navigation resolution helpers:
  - `public/participant-console-state.js`
  - `sanitizeWorkspaceNavigationItems(...)`
  - `resolveWorkspaceNavigationItems(...)`
  - supports fallback menu behavior when configured items are invalid/missing
- Wired shared top nav into participant and appeal-handler pages:
  - `public/participant.html`
  - `public/appeal-handler.html`
  - `public/participant.js`
  - `public/appeal-handler.js`
  - both pages now render a top navigation bar based on current roles and locale
- i18n label support for navigation:
  - `public/i18n/participant-translations.js`
  - added `nav.participant` and `nav.appealHandler` in `en-GB`, `nb`, and `nn`
- Test coverage updates:
  - `test/participant-console-state.test.js`
    - added tests for navigation sanitization, role-based visibility, and fallback behavior
  - `test/participant-console-config.test.ts`
    - validates `/participant/config` includes `navigation` contract

### Verification
- `npm run lint`
- `npm test` (61 tests passing, 23 test files)

## 0.3.60 - 2026-03-10
### Summary
Refined participant assessment/result UX by removing redundant next-check messaging, improving localization coverage for additional OpenAI guidance text, and updating MCQ wording in Norwegian locales.

### Included
- Participant progress messaging:
  - `public/participant.js`
  - Removed UI display of `Next status check in ...` countdown during automatic assessment polling.
  - Progress now relies on clear status + prominent elapsed-seconds indicator.
- Extended localization mapping for OpenAI response text:
  - `public/participant.js`
  - Added normalization/mapping support for additional confidence variant:
    - `Low confidence in alignment due to sparse content; assessment based on limited cues.`
  - Added mapping coverage for additional improvement-advice phrases:
    - governance scope / risk owners / cadence
    - risk categories
    - QA checklist + independent review
    - data/privacy/retention/security controls
    - quality thresholds
    - iteration + versioning
    - escalation procedures + decision rights
    - artifacts/evidence
    - responsible AI + misuse safeguards
    - failure-mode examples + mitigations
- Translation resource updates:
  - `public/i18n/participant-translations.js`
  - Added matching translation keys in `en-GB`, `nb`, and `nn`.
  - Updated Norwegian MCQ wording:
    - section label: `Flervalgstest`
    - submit button: `Send test`
- Translation test coverage:
  - `test/participant-translations.test.js`
  - Added assertions for newly introduced translation keys.

### Verification
- `npm run lint`
- `npm test` (58 tests passing, 23 test files)

## 0.3.59 - 2026-03-10
### Summary
Fixed participant MCQ action state so `Send MCQ` becomes enabled immediately after MCQ questions are loaded.

### Included
- Participant UI flow-state fix:
  - `public/participant.js`
  - `renderQuestions()` now triggers `renderFlowGating()` after MCQ questions are rendered/cleared.
  - This ensures button enablement is recalculated from the updated `currentQuestions` state.

### Verification
- `npm run lint`
- `npm test` (58 tests passing, 23 test files)

## 0.3.58 - 2026-03-10
### Summary
Forenklet deltakerflyten videre ved å skjule ugyldige handlinger i riktig fase, gjøre nedtelling tydeligere, og forbedre konsistens/lokalisering i resultatoppsummering for manuell vurdering og OpenAI-råd.

### Included
- Participant UI flow gating hardening:
  - `public/participant.js`
  - `Opprett innlevering` skjules etter første vellykkede innlevering og vises igjen først etter reset.
  - `Send MCQ` skjules etter første vellykkede MCQ-innsending.
  - `Slett innlevering, og start på nytt` vises først når vurderingsresultat er mottatt (`UNDER_REVIEW`/`COMPLETED`/`SCORED`).
- Assessment progress visibility improvements:
  - `public/participant.html`
  - `public/participant.js`
  - lagt til tydelig, stor sekundteller under framdriftsstatus under automatisk vurdering.
- Result consistency + localization improvements:
  - `public/participant.js`
  - viser `Sendt til manuell vurdering` som beslutningstekst når status er `UNDER_REVIEW`, for å unngå konflikt mellom beslutning og begrunnelse.
  - utvidet lokalisering av kjente OpenAI confidence/improvement-tekster (nb/nn/en) med robust normalisering av strengmatching.
- Translation resource updates:
  - `public/i18n/participant-translations.js`
  - nye nøkler for manuell-vurdering-beslutning, lav konfidens og ekstra forbedringsråd.
- Added translation regression tests:
  - `test/participant-translations.test.js`
  - validerer nøkkelparitet mellom `en-GB`, `nb`, `nn` og at nye nøkler finnes i alle språk.

### Verification
- `npm run lint`
- `npm test` (58 tests passing, 23 test files)

## 0.3.57 - 2026-03-10
### Summary
Documented Azure OpenAI staging/production configuration profiles and operationalized the current staging runtime profile for `gpt-5-nano`.

### Included
- Documentation updates for OpenAI operations:
  - `doc/AZURE_ENVIRONMENTS.md`
  - added recommended runtime profiles for:
    - staging (`gpt-5-nano`)
    - production balanced
    - production quality
  - added production onboarding checklist for Azure OpenAI variables/secrets and verification steps
- README update:
  - `README.md`
  - added explicit `gpt-5-nano` compatibility guidance (`temperature=1`, `max tokens=4000`, token parameter `auto`)
- Staging environment runtime configuration applied:
  - `AZURE_OPENAI_TEMPERATURE=1`
  - `AZURE_OPENAI_MAX_TOKENS=4000`
  - `AZURE_OPENAI_TIMEOUT_MS=45000`
  - `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER=auto`

### Verification
- `npm run lint`
- `npm test` (56 tests passing, 22 test files)

## 0.3.56 - 2026-03-10
### Summary
Hardened Azure OpenAI token-limit compatibility by adding config-driven token parameter strategy (`max_tokens` / `max_completion_tokens` / `auto`) with automatic fallback for model-specific unsupported-parameter responses.

### Included
- Added new Azure OpenAI env/config key:
  - `AZURE_OPENAI_TOKEN_LIMIT_PARAMETER`
  - supported values: `max_tokens`, `max_completion_tokens`, `auto`
  - default: `auto`
- Implemented token-parameter strategy in Azure adapter:
  - `src/services/llmAssessmentService.ts`
  - request now uses configured token key
  - `auto` mode tries modern-first (`max_completion_tokens`) and retries with `max_tokens` when provider returns `unsupported_parameter`
- Updated runtime/deploy configuration wiring:
  - `src/config/env.ts`
  - `.env.example`
  - `.azure/environments/staging.env.example`
  - `.azure/environments/production.env.example`
  - `infra/azure/main.bicep`
  - `scripts/azure/deploy-environment.ps1`
  - `.github/workflows/deploy-azure.yml`
- Documentation updates:
  - `README.md`
  - `doc/AZURE_ENVIRONMENTS.md`
  - `doc/PHASE2_AZURE_OPENAI_INTEGRATION.md`
- Test coverage updates:
  - `test/llm-assessment-service.test.ts`
  - verifies `max_tokens` path, `max_completion_tokens` path, and `auto` fallback retry behavior

### Verification
- `npm run lint`
- `npm test` (56 tests passing, 22 test files)
- `npm run build`

## 0.3.55 - 2026-03-10
### Summary
Implemented Azure OpenAI assessment-provider integration for `LLM_MODE=azure_openai` with strict structured-output validation, versioned prompt-template context wiring, and deploy/runtime configuration support.

### Included
- Implemented Azure OpenAI adapter in LLM service:
  - `src/services/llmAssessmentService.ts`
  - added provider call for `chat/completions` deployment endpoint
  - added timeout handling, provider-error surfacing, JSON extraction/parsing hardening, and existing `zod` schema validation reuse
  - retained `stub` mode behavior unchanged
- Expanded env contract for Azure OpenAI runtime config:
  - `src/config/env.ts`
  - `.env.example`
  - keys:
    - `AZURE_OPENAI_ENDPOINT`
    - `AZURE_OPENAI_API_KEY`
    - `AZURE_OPENAI_DEPLOYMENT`
    - `AZURE_OPENAI_API_VERSION`
    - `AZURE_OPENAI_TIMEOUT_MS`
    - `AZURE_OPENAI_TEMPERATURE`
    - `AZURE_OPENAI_MAX_TOKENS`
  - added fail-fast validation when `LLM_MODE=azure_openai`
- Assessment orchestration updates:
  - `src/services/assessmentJobService.ts`
  - LLM call now includes versioned prompt-template context (`systemPrompt`, `userPromptTemplate`, `examplesJson`)
  - persisted `LLMEvaluation.modelName` now records configured Azure deployment in `azure_openai` mode
- Azure deploy/runtime configuration wiring:
  - `infra/azure/main.bicep`
  - `scripts/azure/deploy-environment.ps1`
  - `.github/workflows/deploy-azure.yml`
  - `.azure/environments/staging.env.example`
  - `.azure/environments/production.env.example`
- Documentation:
  - added design note `doc/PHASE2_AZURE_OPENAI_INTEGRATION.md`
  - updated `README.md`, `doc/AZURE_ENVIRONMENTS.md`, and `doc/M1_IMPLEMENTATION_DECISIONS.md`
- Test coverage:
  - added `test/llm-assessment-service.test.ts` for Azure adapter success/failure parsing paths

### Verification
- `npm run lint`
- `npm test` (54 tests passing, 22 test files)

## 0.3.54 - 2026-03-09
### Summary
Implemented issue #28 with an admin-driven HR/LMS delta sync pipeline for users/org metadata, configurable conflict strategy, and audit/observability-based recovery tracing.

### Included
- Added org sync config model:
  - `config/org-sync.json`
  - `src/config/orgSync.ts`
  - config-driven conflict and overwrite behavior
- Added org sync service:
  - `src/services/orgSyncService.ts`
  - delta upsert for user identity/org metadata
  - conflict handling strategies (`merge_by_email`, `skip_conflict`)
  - per-record failure capture and recoverable run summaries
  - observability events + audit events for run completion/failure
- Added admin API endpoint:
  - `POST /api/admin/sync/org/delta`
  - route implementation in `src/routes/orgSync.ts`
  - wired in `src/app.ts` (admin-only access)
- Documentation:
  - `doc/PHASE2_ORG_SYNC_DESIGN.md`
  - `doc/ORG_SYNC_CONFLICT_STRATEGY.md` (explicit conflict/override strategy)
  - README updated with endpoint and config references
- Test coverage:
  - `test/m2-org-sync.test.ts` (delta create/update, conflict handling, audit signal)

### Verification
- `npm run lint`
- `npm test` (50 tests passing, 21 test files)

## 0.3.53 - 2026-03-09
### Summary
Implemented issue #35 by adding benchmark example/anchor version management per module with prompt/module linking, configuration-based validation, and auditable publish flow integration.

### Included
- Added benchmark example config:
  - `config/benchmark-examples.json`
  - `src/config/benchmarkExamples.ts`
  - configurable limits/required fields for benchmark payloads
- Added benchmark version management API:
  - `POST /api/admin/content/modules/:moduleId/benchmark-example-versions`
  - route implementation: `src/routes/adminContent.ts`
- Added benchmark creation service:
  - `src/services/adminContentService.ts`
  - creates a new versioned prompt template from a base prompt template
  - supports optional link to a module version context
  - validates benchmark examples against config limits/required fields
  - stores enriched benchmark-anchor metadata in prompt examples payload
  - emits audit event `benchmark_example_version_created`
- Publish/linkage integration:
  - benchmark prompt versions are linked to module versions through existing `promptTemplateVersionId`
  - module versions referencing benchmark prompts are publishable via existing publish endpoint
- Design note and tests:
  - `doc/PHASE2_BENCHMARK_EXAMPLES_DESIGN.md`
  - expanded `test/m2-admin-content-publication.test.ts` to cover benchmark version creation, linkage, publish, and audit
- Documentation:
  - README updated with benchmark admin endpoint and config guidance

### Verification
- `npm run lint`
- `npm test` (49 tests passing, 20 test files)

## 0.3.52 - 2026-03-09
### Summary
Implemented issue #30 by adding an advanced analytics reporting layer with semantic KPI model endpoints, trend/cohort analysis, and configurable data-quality checks.

### Included
- Added analytics model configuration:
  - `config/reporting-analytics.json`
  - `src/config/reportingAnalytics.ts`
  - config includes KPI catalog metadata, trend/cohort dimensions, and data-quality thresholds
- Reporting service analytics extensions (`src/services/reportingService.ts`):
  - `getAnalyticsSemanticModel`
  - `getAnalyticsTrendsReport`
  - `getAnalyticsCohortsReport`
  - `getReportingDataQualityReport`
- New analytics API endpoints (`src/routes/reports.ts`):
  - `GET /api/reports/analytics/semantic-model`
  - `GET /api/reports/analytics/trends`
  - `GET /api/reports/analytics/cohorts`
  - `GET /api/reports/analytics/data-quality`
- CSV export support added for analytics report types:
  - `type=analytics-trends`
  - `type=analytics-cohorts`
- Design note:
  - `doc/PHASE2_ADVANCED_REPORTING_DESIGN.md`
- Test coverage:
  - expanded `test/m2-reporting.test.ts` for semantic model, trends, cohorts, data quality, and analytics CSV export
- Documentation:
  - README updated with analytics endpoints and config model details

### Verification
- `npm run lint`
- `npm test` (49 tests passing, 20 test files)

## 0.3.51 - 2026-03-09
### Summary
Implemented issue #27 with a config-driven recertification engine, pre-expiry reminder scheduling, and reportable recertification status.

### Included
- Added recertification policy config:
  - `config/assessment-rules.json`
  - `src/config/assessmentRules.ts`
  - keys:
    - `recertification.validityDays`
    - `recertification.dueOffsetDays`
    - `recertification.dueSoonDays`
    - `recertification.reminderDaysBefore[]`
- Added recertification service:
  - `src/services/recertificationService.ts`
  - upserts `CertificationStatus` from final decisions
  - derives lifecycle statuses (`ACTIVE`, `DUE_SOON`, `DUE`, `EXPIRED`, `NOT_CERTIFIED`)
  - executes reminder schedule with dedupe by `asOfDate` + reminder offset
  - logs and audits reminder outcomes
- Integrated certification updates into final-decision points:
  - `src/services/decisionService.ts` (automatic completed decisions)
  - `src/services/manualReviewService.ts` (manual override decisions)
  - `src/services/appealService.ts` (appeal resolution decisions)
- Added reporting and reminder endpoints:
  - `GET /api/reports/recertification`
  - `POST /api/reports/recertification/reminders/run?asOf=<ISO-date>`
  - implementation in `src/routes/reports.ts` and `src/services/reportingService.ts`
- Added design note + tests:
  - `doc/PHASE2_RECERTIFICATION_DESIGN.md`
  - `test/m2-recertification-flow.test.ts`
  - README updated with recertification config/endpoint guidance

### Verification
- `npm run lint`
- `npm test` (49 tests passing, 20 test files)

## 0.3.50 - 2026-03-09
### Summary
Implemented issue #34 by adding PDF/DOCX document parsing in submission intake with fallback handling, parser-quality logging, and clear user-facing parse errors.

### Included
- Added parser service for attachment intake:
  - `src/services/documentParsingService.ts`
  - supports format detection for PDF/DOCX (`mimeType` + filename fallback)
  - parses attachment payload from `attachmentBase64`
  - fallback behavior:
    - if parsing fails and `rawText` exists -> uses `rawText`
    - if parsing fails and no fallback text -> returns clear parse error
  - parser quality metadata (`status`, `format`, `quality`, `extractedChars`, `reason`)
- Submission API input support:
  - `src/routes/submissions.ts`
  - `POST /api/submissions` now accepts optional:
    - `attachmentBase64`
    - `attachmentFilename`
    - `attachmentMimeType`
- Submission pipeline integration:
  - `src/services/submissionService.ts`
  - parsed/fallback text is resolved before submission persistence
  - parser outcome added to submission audit metadata
  - operational parser-quality signal logged via `submission_document_parse`
- Dependencies:
  - added parsing libraries: `pdf-parse`, `mammoth`
- Tests/docs:
  - added unit tests: `test/document-parsing.test.ts`
  - updated audit integration test: `test/m2-audit-pipeline.test.ts`
  - design note: `doc/PHASE2_DOCUMENT_PARSING_DESIGN.md`
  - README updated with parser behavior and new submission fields

### Verification
- `npm run lint`
- `npm test` (48 tests passing, 19 test files)

## 0.3.49 - 2026-03-09
### Summary
Implemented issue #31 by adding config-driven secondary LLM assessment with trigger/disagreement rules, manual-review routing on disagreement, and end-to-end traceability.

### Included
- Added `secondaryAssessment` policy in assessment rules config:
  - `config/assessment-rules.json`
  - `src/config/assessmentRules.ts`
  - `enabledByDefault`, `moduleOverrides`
  - configurable `triggerRules` and `disagreementRules`
- Added secondary-assessment policy service:
  - `src/services/secondaryAssessmentService.ts`
  - evaluates when second pass should run
  - evaluates disagreement between primary/secondary outcomes
- Assessment orchestration updates:
  - `src/services/assessmentJobService.ts`
  - runs primary pass + optional secondary pass
  - stores separate LLM evaluations for each pass
  - emits audit events:
    - `secondary_assessment_triggered`
    - `secondary_assessment_completed`
  - forces manual-review routing when disagreement rules are hit
- Decision pipeline update:
  - `src/services/decisionService.ts`
  - supports forced manual-review reason for secondary-pass disagreement routing
- LLM stub support for pass context:
  - `src/services/llmAssessmentService.ts` now accepts `assessmentPass` context (`primary` / `secondary`)
- Tests/docs:
  - new unit tests: `test/secondary-assessment.test.ts`
  - updated integration assertions: `test/m2-audit-pipeline.test.ts`
  - design note: `doc/PHASE2_SECONDARY_ASSESSMENT_DESIGN.md`
  - README updated with secondary-assessment config guidance

### Verification
- `npm run lint`
- `npm test` (44 tests passing, 18 test files)

## 0.3.48 - 2026-03-09
### Summary
Implemented issue #29 with config-driven sensitive-data detection/masking before LLM evaluation, including per-module enablement and audit traceability.

### Included
- Added sensitive-data masking policy config in assessment rules:
  - `config/assessment-rules.json`
  - `src/config/assessmentRules.ts`
  - `sensitiveData.enabledByDefault`
  - `sensitiveData.moduleOverrides` (`moduleId -> enabled`)
  - `sensitiveData.rules[]` (`id`, regex `pattern/flags`, `replacement`)
- Added preprocessing service:
  - `src/services/sensitiveDataMaskingService.ts`
  - detects rule hits across submission text fields
  - conditionally masks payload before LLM call
  - returns structured decision metadata (`maskingEnabled`, `maskingApplied`, `ruleHits`, totals, fields)
- Integrated preprocessing into assessment pipeline:
  - `src/services/assessmentJobService.ts`
  - audit event `sensitive_data_preprocessed` recorded per assessment with metadata
  - LLM request payload hash now reflects the actual (possibly masked) payload
- Tests and docs:
  - new unit tests: `test/sensitive-data-masking.test.ts`
  - updated integration coverage: `test/m2-audit-pipeline.test.ts`
  - design note: `doc/PHASE2_SENSITIVE_DATA_MASKING_DESIGN.md`
  - README updated with `sensitiveData` configuration guidance

### Verification
- `npm run lint`
- `npm test` (41 tests passing, 17 test files)

## 0.3.47 - 2026-03-09
### Summary
Implemented issue #33 by adding MCQ quality analytics reporting with configurable difficulty/discrimination thresholds and low-quality item flags.

### Included
- New MCQ quality report endpoint:
  - `GET /api/reports/mcq-quality`
  - `src/routes/reports.ts`
  - supports existing report filters (`moduleId`, `dateFrom`, `dateTo`, `orgUnit`) and optional status filter (`FLAGGED`, `OK`).
- MCQ quality analytics logic:
  - `src/services/reportingService.ts`
  - computes per-question metrics from completed MCQ responses:
    - `attemptCount`
    - `correctCount`
    - `difficulty` (proportion correct)
    - `discrimination` (point-biserial against attempt percent score)
  - flags low-quality items via configurable rules:
    - `TOO_DIFFICULT`
    - `TOO_EASY`
    - `LOW_DISCRIMINATION`
    - `INSUFFICIENT_SAMPLE`
  - exposes totals for flagged and per-flag category counts.
- Config-driven thresholds:
  - `src/config/assessmentRules.ts`
  - `config/assessment-rules.json`
  - added `mcqQuality` config:
    - `minAttemptCount`
    - `difficultyMin`
    - `difficultyMax`
    - `discriminationMin`
- CSV export support:
  - `GET /api/reports/export?type=mcq-quality&format=csv`
  - `src/routes/reports.ts`
- Documentation and tests:
  - `README.md` API list updated with `/api/reports/mcq-quality`.
  - `test/m2-reporting.test.ts` expanded to validate:
    - `mcq-quality` report response
    - `mcq-quality` CSV export.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.46 - 2026-03-09
### Summary
Delivered additional participant/appeal workspace simplifications: auto-loaded appeal queue, localized status filter labels, streamlined participant controls, and automatic MCQ start on submission.

### Included
- Appeal-handler UX simplification:
  - `public/appeal-handler.js`
  - Auto-loads appeal queue on page load using configured default statuses (`OPEN`, `IN_REVIEW`) without clicking `Load appeals`.
  - Localizes status labels in status filter and queue/detail displays based on selected UI language.
  - Preserves selected statuses while re-rendering localized filter labels.
- Participant flow simplification:
  - `public/participant.html`
  - `public/participant.js`
  - Removed `Clear module draft` button from submission section.
  - Added `Delete submission and start over` action in assessment section:
    - clears module draft
    - resets flow state and related IDs
    - prepares module for new submission cycle
  - Removed `Start MCQ` button.
  - MCQ now starts automatically immediately after successful `Create submission`.
  - MCQ section visibility is now gated by submission creation (not just module selection).
- Translation updates:
  - `public/i18n/participant-translations.js`
  - `public/i18n/appeal-handler-translations.js`
  - Added wording for new reset action and updated module/MCQ hint/error text.
- Documentation:
  - `README.md` manual flow updated to reflect automatic MCQ start and appeal queue auto-load behavior.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.45 - 2026-03-09
### Summary
Expanded appeal-handler case details so handlers can review full submission context directly in the workspace: participant submission content, MCQ result metrics, and evaluation details.

### Included
- Appeal workspace detail panel expansion:
  - `public/appeal-handler.js`
  - Added structured detail sections:
    - `Appeal`
    - `Submission` (answer text, reflection, prompt excerpt, delivery type)
    - `MCQ` (latest attempt id, percent/scaled score, pass/fail, completed timestamp)
    - `Evaluation` (latest decision + latest LLM evaluation fields, improvement advice, criterion rationales)
    - `SLA`
  - Added safer formatting helpers for numbers, pass/fail values, multiline text, and LLM response parsing.
- UI text keys for detailed case fields:
  - `public/i18n/appeal-handler-translations.js`
  - Added detail-label translation keys in `en-GB` (used as fallback for `nb`/`nn`).

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.44 - 2026-03-09
### Summary
Fixed appeal-handler workspace state issues so resolved appeals disappear consistently from open queues and resolution form inputs reset when switching appeals.

### Included
- Appeal queue/selection UX fixes:
  - `public/appeal-handler.js`
  - Ensures resolved appeal is removed from current queue view immediately when current status filter does not include `RESOLVED`.
  - Clears selected appeal + details state correctly when queue becomes empty or filter has no rows.
  - Prevents stale details reload for appeals no longer present in current queue.
- Resolution form state reset:
  - `public/appeal-handler.js`
  - Added centralized reset for:
    - `Decision reason`
    - `Resolution note`
    - `Pass/fail total` (default `Pass`)
  - Inputs now reset when selecting a different appeal and after resolve-driven selection changes.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.43 - 2026-03-09
### Summary
Simplified participant assessment UX further by hiding redundant manual controls in auto mode and making auto-evaluation timer visibility explicit.

### Included
- Participant assessment auto-flow UX:
  - `public/participant.js`
  - When `flow.autoStartAfterMcq=true`, hides manual assessment buttons:
    - `Start assessment`
    - `Check progress`
    - `View result`
  - Hides manual check hint in auto mode.
  - Adds explicit elapsed seconds in assessment progress status while auto polling is running.
- Translations:
  - `public/i18n/participant-translations.js`
  - Added `assessment.auto.elapsedPrefix` in `en-GB`, `nb`, and `nn`.
- Documentation:
  - `README.md` now states that manual assessment buttons are hidden when auto-start is enabled.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.42 - 2026-03-09
### Summary
Simplified participant flow between MCQ and assessment by starting assessment automatically after MCQ submission, showing countdown-based progress, and auto-loading result when ready.

### Included
- Auto assessment flow in participant UI:
  - `public/participant.js`
  - After `Send MCQ`, UI now automatically:
    - starts assessment (`POST /api/assessments/:submissionId/run`)
    - polls status on interval
    - shows countdown/status text inline in assessment section
    - fetches and renders result automatically when ready
- Improved MCQ transition clarity:
  - keeps last `Attempt ID` visible after MCQ submit instead of resetting to `-`.
- New config-driven participant flow settings:
  - `src/config/participantConsole.ts`
  - `config/participant-console.json`
  - `flow.autoStartAfterMcq`
  - `flow.pollIntervalSeconds`
  - `flow.maxWaitSeconds`
- Localization updates for auto-assessment status texts:
  - `public/i18n/participant-translations.js` (`en-GB`, `nb`, `nn`)
- Documentation and tests:
  - `README.md` updated with new `flow.*` config keys.
  - `test/participant-console-config.test.ts` updated to verify `flow` runtime config payload.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.41 - 2026-03-09
### Summary
Hardened participant flow sequencing and feedback, localized more of the result summary, and made test-console identities config-driven per workspace.

### Included
- Participant UX flow hardening:
  - `public/participant.html`
  - `public/participant.js`
  - Clearer button pressed/busy feedback (`busy` styling + disabled-state clarity).
  - `Submission` button now has explicit availability validation/hints (module + reflection + instruction + acknowledgement).
  - `Assessment` progress now shows explicit inline state text (`not started`, `waiting`, `completed`, `under review`, `failed`) instead of only raw output logs.
  - `Appeal` action now follows progressive visibility rules:
    - only shown for negative results (or existing appeal)
    - hidden once appeal exists and replaced by submitted-status text with appeal ID.
  - Result/history status and decision labels now use localized values in UI.
- Result summary language improvements:
  - `public/i18n/participant-translations.js`
  - Added missing translation keys for validation messages, assessment progress, status/decision values, criterion labels, and known stub guidance phrases in `en-GB`, `nb`, and `nn`.
- Config-driven identity defaults per workspace:
  - `src/config/participantConsole.ts`
  - `config/participant-console.json`
  - `public/participant.js`
  - `public/appeal-handler.js`
  - Added optional `identityDefaults.participant` and `identityDefaults.appealHandler` to runtime config returned by `/participant/config`.
- Appeal status visibility in participant result API:
  - `src/services/submissionService.ts`
  - `src/routes/submissions.ts`
  - `GET /api/submissions/:submissionId/result` now returns `latestAppeal` for participant-side gating/status display.
- Documentation:
  - `README.md` updated with new `identityDefaults` config keys.
- Automated tests:
  - `test/m2-appeal-flow.test.ts` extended to verify `latestAppeal` in participant result payload after create/resolve.
  - `test/participant-console-config.test.ts` extended to verify `identityDefaults` in `/participant/config`.

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

## 0.3.40 - 2026-03-09
### Summary
Implemented UX text clarity improvements across participant and appeal-handler interfaces, with clearer actions, less technical wording, improved Norwegian readability, and more actionable appeal error messaging.

### Included
- Updated participant and workspace translation wording in:
  - `public/i18n/participant-translations.js`
  - `public/i18n/appeal-handler-translations.js`
- Text improvements include:
  - API/technical label cleanup (`Load /api/me` -> user-facing phrasing).
  - Replaced `Mock` terminology with plain test-user wording.
  - Simplified submission field labels (`Raw Text`, `Prompt Excerpt`).
  - Action-oriented assessment buttons and helper text.
  - Removed internal status-code wording (`COMPLETED`) from participant guidance.
  - Standardized claim/assignment wording in appeal workspace (especially `nb`/`nn`).
  - Improved appeal workspace subtitle, queue-limit wording, and empty-state guidance.
  - Renamed generic `Output` heading to clearer user-facing wording.
  - Corrected Norwegian character/transliteration issues in locale text.
- Updated appeal route error messages for clearer next-step guidance in:
  - `src/routes/appeals.ts`

### Verification
- `npm run lint`
- `npm test` (39 tests passing, 16 test files)

### Notes
- Scope is wording-only UX improvement; no API contract changes.

## 0.3.39 - 2026-03-09
### Summary
Refined phase-2 participant and appeal-handler UX by separating role-specific workspaces, hardening module-selection flow, and preventing duplicate button submissions.

### Included
- Issue #51 follow-up (`mock` role switch):
  - role-preset behavior reused in dedicated `/appeal-handler` workspace.
  - added busy-state protection on identity/API action buttons to prevent accidental repeated requests.
- Issue #49 follow-up (module selection UX hardening):
  - `/participant` now hides `Submission` and `MCQ` sections until a module is selected.
  - added explicit module-selection unlock hint in module section.
- Issue #50 follow-up (module-scoped drafts):
  - preserved module-scoped autosave/restore behavior while introducing module-dependent section visibility.
- Issue #52 follow-up (progressive flow gating):
  - async action buttons now use consistent in-flight busy/disabled state to reduce duplicate submissions/queue calls.
- Issue #48 follow-up (appeal handler workspace):
  - moved workspace out of `/participant` into dedicated `/appeal-handler` page.
  - added queue table with search/filtering, configurable queue fetch limit, and clearer participant/timestamp visibility.
  - added queue limit config key: `appealWorkspace.queuePageSize`.
- Runtime/config/documentation updates:
  - `src/app.ts` serves `/appeal-handler`.
  - `src/config/participantConsole.ts` + `config/participant-console.json` include `queuePageSize`.
  - docs updated in `README.md` and `doc/PHASE2_PARTICIPANT_UI_DESIGN.md`.
- Automated tests:
  - updated `test/participant-console-config.test.ts` for `queuePageSize`.
  - added route coverage for `/appeal-handler`.

### Notes
- Backend appeal APIs are unchanged; this release is UI/workspace and runtime-config hardening.

## 0.3.38 - 2026-03-09
### Summary
Hardened mock-identity reconciliation and non-production bootstrap seed resilience to recover from user identity conflicts and ensure module-seed completion.

### Included
- Mock auth user-upsert reconciliation hardening:
  - `src/repositories/userRepository.ts`
  - avoids failing auth when `externalId` and `email` map to different existing users by reconciling safely instead of throwing unique-key errors.
- Bootstrap seed identity hardening:
  - `scripts/runtime/bootstrapSeed.mjs`
  - same reconciliation logic applied for seeded users (`admin-1`, `participant-1`) so bootstrap can continue and ensure seeded modules.
- Automated regression test:
  - `test/mock-auth-identity-reconciliation.test.ts`
  - verifies `/api/me` remains functional under `externalId`/`email` conflict scenario in mock mode.

### Notes
- This release targets staging data-drift recovery and reliable non-production verification flows.

## 0.3.37 - 2026-03-09
### Summary
Implemented phase-2 participant test-console UX hardening across role switching, module selection clarity, draft persistence, progressive flow gating, and appeal-handler workspace actions.

### Included
- Config-driven participant console runtime settings:
  - `config/participant-console.json`
  - `src/config/participantConsole.ts`
  - `GET /participant/config`
- Issue #51 (`mock` role switch helper):
  - mock-role preset dropdown in participant identity section
  - Entra-aware disabled/read-only behavior while preserving manual role entry
- Issue #49 (module selection UX):
  - card-style module list with explicit selected state badge/highlight
  - selected module summary now shows localized human-readable title (id remains internal)
- Issue #50 (module-scoped drafts):
  - autosave/restore of `rawText`, `reflectionText`, `promptExcerpt`
  - optional in-progress MCQ draft persistence
  - config-driven draft storage key/TTL/max-module retention
  - manual clear-draft action and scoped restore/save status indicator
- Issue #52 (progressive flow gating):
  - assessment actions gated by submission + MCQ completion
  - `Check assessment` gated by queue action
  - appeal action gated by `COMPLETED` result status
  - inline locked-state hints and immediate UI transition updates
- Issue #48 (appeal handler workspace UI):
  - queue filtering/listing
  - claim and resolve actions
  - status/timestamp visibility (`createdAt`, `claimedAt`, `resolvedAt`)
  - actionable backend validation/error messaging in workspace
- Frontend state utilities + tests:
  - `public/participant-console-state.js`
  - `test/participant-console-state.test.js`
  - `test/participant-console-config.test.ts`
  - `test/m2-appeal-flow.test.ts` extended for resolved queue/timestamp checks
- Design/refactor gate notes:
  - `doc/PHASE2_PARTICIPANT_UI_DESIGN.md`

### Notes
- All targeted issue checks were validated locally before closeout; full lint/test/build validation is included in this release verification.

## 0.3.36 - 2026-03-09
### Summary
Implemented phase-2 participant notifications for appeal status transitions with config-driven delivery channels, localization baseline, and observability/audit coverage.

### Included
- Appeal transition notifications (`OPEN`, `IN_REVIEW`, `RESOLVED`, `REJECTED`):
  - `src/services/participantNotificationService.ts`
  - integrated into appeal lifecycle in `src/services/appealService.ts`
- Minimal template localization support:
  - `src/i18n/notificationMessages.ts` (`en-GB`, `nb`, `nn`)
- Config-driven channel model:
  - `PARTICIPANT_NOTIFICATION_CHANNEL` (`disabled` / `log` / `webhook`)
  - `PARTICIPANT_NOTIFICATION_WEBHOOK_URL`
  - `PARTICIPANT_NOTIFICATION_WEBHOOK_TIMEOUT_MS`
  - env schema validation updated in `src/config/env.ts`
- Deployment/config plumbing:
  - `infra/azure/main.bicep`
  - `scripts/azure/deploy-environment.ps1`
  - `.github/workflows/deploy-azure.yml`
  - `.azure/environments/*.env.example`
  - `.env.example`, `.env.test`
- Documentation:
  - `doc/PHASE2_APPEAL_NOTIFICATIONS_DESIGN.md`
  - `doc/APPEALS_OPERATING_MODEL.md`
  - `doc/OBSERVABILITY_RUNBOOK.md`
  - `doc/AZURE_ENVIRONMENTS.md`
  - `README.md`
- Automated tests:
  - `test/participant-notifications.test.ts`
  - `test/m2-appeal-flow.test.ts` updated for notification audit signal.

### Notes
- Notification pipeline is fail-safe: transition handling continues even if downstream delivery fails, while failures are logged and audited.

## 0.3.35 - 2026-03-09
### Summary
Extended non-production bootstrap seed to include two modules so module-switch scenarios can be verified in stage/local runtime.

### Included
- Runtime bootstrap seed update:
  - `scripts/runtime/bootstrapSeed.mjs` now upserts two module graphs:
    - `Generative AI Foundations`
    - `AI Governance and Risk Essentials`
  - Both modules include rubric, prompt template, MCQ set, and published module version.
- Documentation update:
  - `README.md` manual testing section now explicitly lists both seeded modules.
- Backlog update:
  - Created usability discovery issue `#47` covering moderated UX testing and module-switch behavior.

### Notes
- This change targets non-production bootstrap behavior (`BOOTSTRAP_SEED=true`) and does not alter production runtime behavior.

## 0.3.34 - 2026-03-09
### Summary
Added second seeded module for multi-module flow verification and created dedicated usability discovery backlog item.

### Included
- Seed data enhancement for multi-module testing:
  - `prisma/seed.ts` now seeds two published modules with independent rubric/prompt/MCQ/module-version bundles.
  - Existing baseline module (`Generative AI Foundations`) retained.
  - Added second baseline module (`AI Governance and Risk Essentials`) to support module-switch UX testing.
- Validation:
  - `npm run lint`
  - `npm test` (23 tests passing, 12 test files)
- Planning/backlog:
  - Created `#47` for usability analysis and moderated UX testing, including module-switch scenario.

### Notes
- No API contract changes; this release extends seed/test fixtures and discovery planning.

## 0.3.33 - 2026-03-08
### Summary
Validated automated test baseline and aligned README documentation with current MVP implementation and CI/CD reality.

### Included
- Documentation hardening:
  - Updated `README.md` to reflect current implemented scope beyond M1.
  - Added explicit `Automated Testing` section with local + CI execution paths.
  - Added deployment automation section (`staging` auto, `production` approval gate).
  - Expanded API endpoint overview to include reviews, appeals, reporting, audit, and admin content APIs.
- Validation run:
  - `npm run lint`
  - `npm test` (23 tests passing across 12 test files)

### Notes
- No runtime behavior changes in this version; this release is documentation and verification alignment only.

## 0.3.32 - 2026-03-08
### Summary
Implemented automated overdue-appeal escalation monitoring and Azure alert routing baseline.

### Included
- Added runtime appeal SLA monitor service:
  - `src/services/appealSlaMonitorService.ts`
  - emits `appeal_sla_backlog` snapshots on interval
  - emits `appeal_overdue_detected` error events when overdue threshold is breached
- Wired monitor lifecycle into app runtime:
  - `src/index.ts` now starts/stops appeal SLA monitor with worker lifecycle.
- Added configuration keys:
  - `APPEAL_SLA_MONITOR_INTERVAL_MS` (default `600000`)
  - `APPEAL_OVERDUE_ALERT_THRESHOLD` (default `1`)
  - reflected in `src/config/env.ts`, `.env.example`, `.env.test`, and Azure env examples.
- Extended Azure observability infrastructure:
  - `infra/azure/main.bicep` now provisions scheduled-query alert `Overdue appeals detected`
  - App Service settings now include monitor interval + overdue threshold
  - deploy pipeline wiring added in:
    - `scripts/azure/deploy-environment.ps1`
    - `.github/workflows/deploy-azure.yml`
- Documentation updates:
  - `doc/OBSERVABILITY_RUNBOOK.md`
  - `doc/AZURE_ENVIRONMENTS.md`
  - `doc/APPEALS_OPERATING_MODEL.md`
- Added automated test coverage:
  - `test/m2-appeal-sla-monitor.test.ts`
  - verifies backlog classification and overdue threshold breach logic.

### Notes
- This implements issue `#45` acceptance criteria for automated overdue appeal escalation signals and routing baseline.

## 0.3.31 - 2026-03-08
### Summary
Implemented explicit first-response tracking for appeals by adding `claimedAt` and wiring first-response duration/SLA metrics through queue and reporting.

### Included
- Data model hardening:
  - Added `claimedAt` to `Appeal` model.
  - Added migration `2026030803_appeal_claimed_at`.
  - Added index on `(appealStatus, claimedAt)` for operational queries.
- SLA engine update:
  - `src/services/appealSla.ts` now computes:
    - `firstResponseDurationHours`
    - first-response overdue using explicit `claimedAt` when available
    - fallback behavior for unclaimed/unresolved appeals
- Appeal runtime behavior:
  - `claimAppeal` now sets `claimedAt` on first claim and preserves it on subsequent claims.
  - queue/workspace responses include `claimedAt` and SLA snapshot.
- Reporting update:
  - appeals report rows now include `claimedAt` and `firstResponseDurationHours`.
  - existing SLA aggregate totals preserved.
- Tests updated:
  - `test/m2-appeal-flow.test.ts` verifies `claimedAt` is set and stable.
  - `test/m2-reporting.test.ts` verifies overdue open-appeal first-response SLA fields.

### Notes
- This implements follow-up issue #44 (first-response SLA hardening).

## 0.3.30 - 2026-03-08
### Summary
Implemented MVP post-appeal operating model baseline with SLA visibility in appeal queue/reporting and documented runtime process.

### Included
- Added appeal SLA classification utility:
  - `src/services/appealSla.ts`
  - states: `ON_TRACK`, `AT_RISK`, `OVERDUE`, `RESOLVED`
  - configurable thresholds via env:
    - `APPEAL_FIRST_RESPONSE_SLA_HOURS` (default `24`)
    - `APPEAL_RESOLUTION_SLA_HOURS` (default `72`)
    - `APPEAL_AT_RISK_RATIO` (default `0.75`)
- Added SLA fields to appeal operational APIs:
  - `GET /api/appeals` rows now include `sla`
  - `GET /api/appeals/{appealId}` now includes top-level `sla`
- Extended appeals reporting for operational triage:
  - `GET /api/reports/appeals` rows now include SLA/age fields
  - totals now include:
    - `onTrackAppeals`
    - `atRiskAppeals`
    - `overdueAppeals`
- Added/updated test coverage:
  - `test/m2-reporting.test.ts`
  - `test/m2-appeal-flow.test.ts`
  - verifies overdue visibility and SLA fields in queue/workspace/reporting
- Added process documentation:
  - `doc/APPEALS_OPERATING_MODEL.md`
  - includes lifecycle, RACI, SLA targets, escalation path, participant communication, staging checklist
- Created concrete follow-up issues from operating-model gaps:
  - `#44` first-response SLA hardening (`claimedAt`)
  - `#45` automated overdue escalation alerts
  - `#46` participant notification channel for appeal transitions

### Notes
- This addresses issue `#43` acceptance criteria for documented process + operational detectability of at-risk/overdue appeals.

## 0.3.29 - 2026-03-08
### Summary
Localized module titles and MCQ content (questions/options) for `nb` and `nn` with English fallback.

### Included
- Added backend content translation dictionaries:
  - `src/i18n/contentMessages.ts`
  - `src/i18n/content.ts`
- Localized module content responses by resolved request locale:
  - `GET /api/modules`
  - `GET /api/modules/:moduleId`
  - `GET /api/modules/:moduleId/active-version`
  - `GET /api/submissions/history` (module title in history rows)
- Localized MCQ start payload by locale:
  - `GET /api/modules/:moduleId/mcq/start` now localizes `stem` and `options` fields
- Added i18n regression test coverage for localized module title and MCQ payload:
  - `test/m2-i18n-baseline.test.ts`

### Notes
- Translation uses source-text mapping with fallback to original English content when no translation exists.

## 0.3.28 - 2026-03-08
### Summary
Fixed participant UI locale switching so default textarea values are updated when language changes.

### Included
- Updated `public/participant.js` locale logic:
  - default field values (`rawText`, `reflectionText`, `promptExcerpt`, `appealReason`) now re-localize on language switch
  - preserves user-entered text by only replacing values that are empty or still equal to previous/default localized values
- Removed one-time-only default assignment behavior that left stale language content after switching locale.

### Notes
- This addresses the reported UX bug where standard values did not change when switching language in `/participant`.

## 0.3.27 - 2026-03-08
### Summary
Eliminated remaining CI test flakiness caused by relying on `modules[0]` in parallel test execution.

### Included
- Updated core integration tests to select the seeded module by title (`Generative AI Foundations`) instead of the first returned module:
  - `test/m1-core-flow.test.ts`
  - `test/m0-foundation.test.ts`
  - `test/m2-reporting.test.ts`
  - `test/m2-participant-results-history.test.ts`
  - `test/m2-manual-review.test.ts`
  - `test/m2-appeal-flow.test.ts`
  - `test/m2-audit-pipeline.test.ts`

### Notes
- This addresses CI failures where concurrently-created/published modules changed module ordering and broke MCQ assertions.

## 0.3.26 - 2026-03-08
### Summary
Stabilized CI by fixing cross-test state mutation in admin content publication test.

### Included
- Updated `test/m2-admin-content-publication.test.ts` to create and use an isolated test module instead of mutating the seeded shared module.
- Removed flaky dependency where test order/parallelism could change active module version and break `test/m1-core-flow.test.ts`.

### Notes
- This resolves intermittent CI failures seen in `CI #31` for commit `12400c2`.

## 0.3.25 - 2026-03-08
### Summary
Implemented i18n baseline (`en-GB`, `nb`, `nn`) across participant UI and core API user-facing messages.

### Included
- Added locale model and resolution helpers:
  - `src/i18n/locale.ts`
  - supported locales: `en-GB`, `nb`, `nn`
  - resolution strategy: `x-locale` -> `Accept-Language` -> `DEFAULT_LOCALE` -> `en-GB`
- Added backend localized message catalog:
  - `src/i18n/messages.ts`
  - localized `unauthorized`, `missing_bearer_token`, `forbidden_requires_roles`, `module_not_found`
- Integrated locale-aware behavior in API:
  - `authenticate` now resolves locale and stores it in request context
  - role authorization (`requireAnyRole`) now returns localized forbidden messages
  - module not-found messages are localized
  - `GET /api/me` now returns `user.locale` and `supportedLocales`
- Implemented participant UI internationalization baseline:
  - externalized UI strings into `public/i18n/participant-translations.js`
  - added language selector (en-GB/nb/nn) with persistence in local storage
  - participant API calls send `x-locale`
  - result/history summaries now use locale-aware date/number formatting
- Added documentation:
  - `doc/I18N.md` (adding locales, translation workflow, backend/frontend responsibilities)
- Added regression tests:
  - `test/m2-i18n-baseline.test.ts`
  - verifies language switching/resolution and fallback behavior

### Notes
- This addresses issue #41 acceptance criteria for locale model, fallback, language switching, API localization baseline, formatting, tests, and documentation.

## 0.3.24 - 2026-03-08
### Summary
Implemented MVP admin content management and publication flow for module governance.

### Included
- Added admin content API (role-gated to `ADMINISTRATOR` and `SUBJECT_MATTER_OWNER`):
  - `POST /api/admin/content/modules/{moduleId}/rubric-versions`
  - `POST /api/admin/content/modules/{moduleId}/prompt-template-versions`
  - `POST /api/admin/content/modules/{moduleId}/mcq-set-versions`
  - `POST /api/admin/content/modules/{moduleId}/module-versions`
  - `POST /api/admin/content/modules/{moduleId}/module-versions/{moduleVersionId}/publish`
- Added content management service to:
  - auto-increment version numbers per module/content type
  - validate cross-module integrity when linking rubric/prompt/MCQ versions into module versions
  - publish module versions by updating active version pointer
- Added publication audit event:
  - action: `module_version_published`
  - entity: `module_version`
- Added integration test:
  - `test/m2-admin-content-publication.test.ts`
  - validates create -> link -> publish path and role access control
- Test stability hardening:
  - increased Vitest timeout to 20s for current end-to-end style suite
  - adjusted M0 module version assertion to support later published versions in shared test runtime

### Notes
- This addresses issue #23 acceptance criteria for admin-managed versioned content and auditable publication.

## 0.3.23 - 2026-03-08
### Summary
Implemented participant-facing result details and personal submission history for MVP transparency requirements.

### Included
- Enhanced result endpoint:
  - `GET /api/submissions/{submissionId}/result` now includes:
    - `statusExplanation`
    - `scoreComponents` (mcq/practical/total)
    - `participantGuidance` (decision reason, confidence note, improvement advice, criterion rationales)
- Added personal history endpoint:
  - `GET /api/submissions/history?limit=<n>`
  - returns only current authenticated user's records
  - includes module metadata, status, and latest decision/MCQ/LLM snapshots
- Updated participant UI test console:
  - result summary panel for status + score components + guidance
  - history panel to load and inspect participant's own submission history
- Added integration test:
  - `test/m2-participant-results-history.test.ts`

### Notes
- This addresses issue #20 acceptance criteria for result transparency and user-scoped history.

## 0.3.22 - 2026-03-08
### Summary
Implemented MVP reporting endpoints with filter support and CSV export for governance reporting.

### Included
- Added reporting API router with role-gated endpoints:
  - `GET /api/reports/completion`
  - `GET /api/reports/pass-rates`
  - `GET /api/reports/manual-review-queue`
  - `GET /api/reports/appeals`
  - `GET /api/reports/export?type=<...>&format=csv`
- Added report filtering support across report types:
  - `moduleId`
  - `status` (comma-separated, report-specific)
  - `dateFrom`
  - `dateTo`
  - `orgUnit` (department)
- Added CSV export utility for core report types.
- Added reporting service implementation that aggregates totals/rows from submissions, decisions, manual reviews, and appeals.
- Added automated integration test for reporting and CSV behavior:
  - `test/m2-reporting.test.ts`

### Notes
- Reporting access is restricted to `ADMINISTRATOR`, `REPORT_READER`, and `SUBJECT_MATTER_OWNER`.

## 0.3.21 - 2026-03-08
### Summary
Implemented MVP observability baseline for correlation IDs, operational logging signals, Azure alerts, and runbook documentation.

### Included
- Added request observability middleware:
  - propagates/creates `x-correlation-id` for all requests
  - returns `x-correlation-id` in response headers
  - logs structured request completion events (`http_request`)
- Added operational event logging in assessment orchestration:
  - `llm_evaluation_failed`
  - `assessment_queue_backlog`
- Extended Azure IaC with observability resources:
  - workspace-based Application Insights + Log Analytics workspace
  - App Service diagnostic settings to workspace
  - latency metric alert
  - scheduled query alerts for LLM failures and queue backlog
  - optional action group email support
- Extended deployment automation and environment templates with observability parameters.
- Added runbook: `doc/OBSERVABILITY_RUNBOOK.md`.
- Added test assertion for correlation header presence on API responses.

### Notes
- This addresses issue #26 acceptance criteria for baseline detection and first-response readiness.

## 0.3.20 - 2026-03-08
### Summary
Added visible runtime version metadata in participant UI and implemented participant appeal action in the test console.

### Included
- Added backend app metadata utility and public version endpoint:
  - `GET /version` returns app name/version.
  - `GET /healthz` now also includes `version`.
- Updated participant test console UI:
  - shows current app version and updates browser title to include `v<version>`.
  - added appeal section with reason input and `Create Appeal` button.
  - displays created `appealId` in UI.

### Notes
- This enables quick confirmation that stage is running the expected release before manual verification.

## 0.3.19 - 2026-03-08
### Summary
Implemented reviewer and appeal-handler workspace flows with immutable decision lineage, and stabilized synchronous assessment processing for deterministic behavior.

### Included
- Added manual review workspace API (`/api/reviews`) with:
  - queue listing and detail workspace
  - claim flow for reviewer assignment
  - override resolution that creates a new `MANUAL_OVERRIDE` decision layer linked by `parentDecisionId`
  - audit events for claim/resolve/override
- Added appeal workflow APIs:
  - participant endpoint to create appeals: `POST /api/submissions/{submissionId}/appeals`
  - handler/admin endpoints: `GET /api/appeals`, `GET /api/appeals/{appealId}`, `POST /api/appeals/{appealId}/claim`, `POST /api/appeals/{appealId}/resolve`
  - appeal resolution creates a new `APPEAL_RESOLUTION` decision layer linked by `parentDecisionId`
  - audit events for appeal create/claim/resolve and appeal-resolution decision creation
- Added deterministic sync assessment processing:
  - `sync: true` now processes until the specific submission job is completed (not just one arbitrary pending job)
  - removes flakiness in integration and audit flow verification
- Added/updated integration tests:
  - `test/m2-manual-review.test.ts`
  - `test/m2-appeal-flow.test.ts`
  - `test/m2-audit-pipeline.test.ts`

### Notes
- This closes core backend implementation scope for manual overprøving and anke handling in the M2 workflow set.

## 0.3.18 - 2026-03-08
### Summary
Hardened dev-tenant Entra onboarding and role-map handling based on real verification findings.

### Included
- Added robust role-map parser utility (`src/auth/entraRoleMap.ts`) that:
  - handles UTF-8 BOM safely
  - normalizes role names
  - rejects invalid JSON with explicit error
- Updated role sync repository to use the shared parser for both JSON env and file-based mappings.
- Added automated tests for role-map parsing edge cases:
  - BOM-prefixed JSON
  - invalid entries and normalization
  - invalid JSON input
- Hardened Entra bootstrap script (`scripts/entra/setup-dev-tenant-auth.ps1`):
  - improved tenant login flow compatibility
  - client app creation fallback for CLI variants
  - safer Graph API PATCH payload handling
  - writes generated files as UTF-8 without BOM
- Expanded onboarding troubleshooting guide with concrete fixes for consent, audience, groups claims, and BOM issues.

### Notes
- This directly reduces recurring setup failures in issues #38, #39, and #40.

## 0.3.17 - 2026-03-08
### Summary
Ignored local staging diagnostics artifacts so repository status stays clean.

### Included
- Updated `.gitignore` to ignore:
  - `staging-logs*/`
  - `staging-logs*.zip`
  - `fic-staging.json`

### Notes
- Prevents accidental tracking of downloaded operational logs and local export files.

## 0.3.16 - 2026-03-08
### Summary
Strengthened engineering process to enforce root-cause-first handling of deployment incidents.

### Included
- Updated `doc/AI_WORKFLOW.md` with a mandatory deploy/runtime RCA-first workflow:
  - single hypothesis first
  - fixed evidence order
  - artifact contract checks
  - one-change-per-iteration budget
  - post-deploy smoke gate
  - explicit escalation criteria
- Updated `.github/pull_request_template.md` with Deployment RCA guardrails for deploy/runtime changes.
- Added `.github/ISSUE_TEMPLATE/deployment-incident.yml` to standardize incident capture and closeout.

### Notes
- Goal is to reduce trial-and-error loops and improve convergence speed in staging/production incident work.

## 0.3.15 - 2026-03-08
### Summary
Fixed CI workflow database setup to use test environment variables consistently.

### Included
- Updated CI step "Run migrations and seed" to execute `db:reset`, `db:migrate`, and `prisma:seed` with `dotenv -e .env.test`.

### Notes
- Resolves CI failures on main caused by missing `DATABASE_URL` during workflow execution.

## 0.3.14 - 2026-03-08
### Summary
Made stage bootstrap seeding startup-safe by removing it from blocking prestart execution.

### Included
- Updated `prestart` to run only runtime migrations.
- Added background bootstrap seed trigger in `src/index.ts` after server listen.
- Kept bootstrap logic idempotent and environment-gated via `BOOTSTRAP_SEED`.

### Notes
- This avoids App Service warmup/startup timeouts caused by startup-blocking seeding while still ensuring non-prod data population.

## 0.3.13 - 2026-03-08
### Summary
Implemented automatic non-production bootstrap seeding so stage has testable data after deploy.

### Included
- Added `scripts/runtime/bootstrapSeed.mjs` with idempotent upserts for users, roles, module, rubric, prompt, MCQ set/questions, and active module version.
- Updated `prestart` to run migrations and then bootstrap seed.
- Added `BOOTSTRAP_SEED` app setting in Bicep (`true` for staging, `false` for production).

### Notes
- This enables repeatable stage data provisioning without running manual seed commands.

## 0.3.12 - 2026-03-08
### Summary
Fixed stage participant test console to send role headers required by API authorization.

### Included
- Added roles input field in `public/participant.html` (default `PARTICIPANT`).
- Updated `public/participant.js` to send `x-user-roles` on all API requests.

### Notes
- This resolves 403 responses from `/api/modules` in mock mode when testing via `/participant`.

## 0.3.11 - 2026-03-08
### Summary
Stabilized deployment result detection by replacing fragile App Service startup tracking with explicit health verification.

### Included
- Updated `az webapp deploy` invocation to use `--track-status false`.
- Added post-deploy `/healthz` polling in `deploy-environment.ps1` with retry and hard fail on timeout.

### Notes
- This avoids false-negative deployment failures where OneDeploy succeeds and site starts, but CLI startup tracking still times out.

## 0.3.10 - 2026-03-08
### Summary
Fixed deployment packaging to include hidden Prisma client artifacts required at runtime.

### Included
- Replaced wildcard `Compress-Archive` packaging in `deploy-environment.ps1` with platform-aware zip creation that includes hidden files.
- Linux/macOS packaging now uses `zip -r .` from artifact root, preserving `.prisma` directory in `node_modules`.
- Windows packaging uses .NET `ZipFile.CreateFromDirectory`.

### Notes
- This resolves runtime startup crash: `Cannot find module '.prisma/client/default'`.

## 0.3.9 - 2026-03-08
### Summary
Fixed Prisma ESM/CJS interop crash that prevented app startup on Azure App Service.

### Included
- Added runtime-safe Prisma adapter module (`src/db/prismaRuntime.ts`) using default import interop.
- Updated runtime enum/client imports to use the adapter instead of direct named imports from `@prisma/client`.
- Kept type-only Prisma imports where needed.

### Notes
- This resolves startup crash: `Named export 'PrismaClient' not found` from `dist/src/db/prisma.js`.

## 0.3.8 - 2026-03-08
### Summary
Resolved App Service startup permission failures by removing Prisma engine execution from startup path.

### Included
- Changed `prestart` to `node scripts/runtime/applyMigrations.mjs` (manual SQL migration runner).
- Ensured runtime migration script creates the SQLite database directory if missing.
- Moved `prisma` back to `devDependencies` because runtime startup no longer uses Prisma CLI binaries.

### Notes
- This avoids `EACCES` on Prisma schema engine binaries in run-from-package deployments.

## 0.3.7 - 2026-03-08
### Summary
Fixed App Service startup failures caused by non-executable Prisma CLI in deployment zip artifacts.

### Included
- Changed `prestart` to run Prisma migrate via `node ./node_modules/prisma/build/index.js migrate deploy` to avoid Linux execute-bit dependency.
- Explicitly set `appCommandLine` to empty string in Azure Bicep to clear stale custom startup commands from prior deployments.

### Notes
- This resolves startup crashes with `sh: 1: prisma: Permission denied` and prevents old runtime migration startup commands from persisting.

## 0.3.6 - 2026-03-08
### Summary
Replaced startup migration mechanism to avoid `node:sqlite` runtime incompatibility.

### Included
- Changed `prestart` from custom SQLite migration script to `prisma migrate deploy`.
- Moved `prisma` package to runtime dependencies to guarantee CLI availability in deployed app.

### Notes
- Startup no longer depends on Node built-in `node:sqlite`.

## 0.3.5 - 2026-03-08
### Summary
Fixed runtime entrypoint mismatch in deployment artifact.

### Included
- Updated `start` script from `node dist/index.js` to `node dist/src/index.js`.

### Notes
- Deployment artifact structure from TypeScript build places the entrypoint at `dist/src/index.js`.
- Previous mismatch could terminate app startup immediately in App Service.

## 0.3.4 - 2026-03-08
### Summary
Startup probe compatibility fixes for Azure App Service.

### Included
- Added root endpoint `GET /` returning `200` to satisfy warmup/startup probing.
- Added explicit App Service port settings (`PORT=8080`, `WEBSITES_PORT=8080`) in Bicep app settings.

### Notes
- This targets recurring “site failed to start” deployment failures despite successful package deployment.

## 0.3.3 - 2026-03-08
### Summary
App Service startup strategy updated to use platform default Node startup path.

### Included
- Added `prestart` script in `package.json` to run runtime migrations before app boot.
- Removed custom `appCommandLine` override in Bicep and delegated startup to default `npm start` behavior.

### Notes
- This avoids custom startup command edge cases and keeps migration logic tied to app lifecycle.

## 0.3.2 - 2026-03-08
### Summary
Startup command fix for App Service Linux deployment.

### Included
- Updated App Service startup command in Bicep to ensure execution happens from app root:
- `cd /home/site/wwwroot && npm run db:migrate:runtime && npm run start`

### Notes
- This targets startup failures where `npm` runs outside the deployed application directory.

## 0.3.1 - 2026-03-08
### Summary
Staging deployment reliability fixes for GitHub Actions and App Service startup.

### Included
- Deployment script hardening:
- Robust temp directory resolution in Linux/Windows runners.
- Explicit native command exit-code checks with fail-fast behavior.
- Build deployment artifact before packaging (`npm ci`, Prisma client generation, TypeScript build).
- Prune dev dependencies before zip to keep runtime package leaner.
- CI/CD workflow update:
- Added concurrency control to avoid overlapping staging deployments and Kudu deployment locks.

### Notes
- This release addresses deployment failures caused by missing built artifacts in Run-From-Package deployments.

## 0.3.0 - 2026-03-08
### Summary
Completed implementation of next-step tracks: dev-tenant auth hardening and Azure staging/production automation baseline.

### Included
- Dev-tenant auth enhancements:
- Hardened Entra bootstrap script with API scope + client delegated permission setup.
- Generated role-map file support for safer config-based mapping.
- Extended onboarding/smoke-test guide for testers.
- Added automated integration test for group-claim to role mapping.
- Azure provisioning/deployment automation baseline:
- Bicep template for cost-optimized App Service deployment per environment.
- End-to-end deployment script for dedicated RG per environment.
- Optional budget/alert cost-guardrail script.
- GitHub Actions workflow for staging auto-deploy and production manual approval gate.
- Azure environment plan and runbook docs.
- Runtime migration script for deployed environments.

### Notes
- Production approval enforcement depends on GitHub Environment protection settings.
- Dev-tenant auth issues remain open until tenant-side validation is completed.

## 0.2.0 - 2026-03-08
### Summary
Parallel implementation of track A (dev-tenant auth setup baseline) and track B (M1 core assessment flow).

### Included
- M1 core flow backend:
- submission creation API with required-field validation
- MCQ start/submit endpoints with deterministic scoring
- async assessment job queue/worker orchestration
- strict LLM structured assessment contract (stub mode)
- backend decision engine with config-driven thresholds and manual-review routing
- assessment/result endpoints
- Manual participant test console:
- `/participant` UI for module -> submission -> MCQ -> assessment -> result flow
- Dev-tenant auth setup baseline:
- Entra group-claim to app-role sync support (config-driven)
- bootstrap script for dev tenant app registrations/groups (`scripts/entra/setup-dev-tenant-auth.ps1`)
- onboarding and smoke-test documentation (`doc/DEV_TENANT_AUTH_ONBOARDING.md`)
- New config assets:
- `config/assessment-rules.json`
- `config/entra-group-role-map.example.json`
- Added M1 flow integration tests and kept M0 tests green.

### Notes
- `LLM_MODE=azure_openai` is scaffolded but not implemented yet.
- Follow-up hardening and rollout tracking remains in open issues.

## 0.1.1 - 2026-03-08
### Summary
Dev-tenant Entra authentication target design for shared development/testing.

### Included
- New design document for issue `#37`:
- `doc/DEV_TENANT_AUTH_TARGET_DESIGN.md`
- Defined target architecture (API app + client app, issuer/audience contract).
- Defined required Entra objects, naming conventions, and ownership model.
- Defined explicit dev/prod tenant separation policy.
- Defined rollout plan from `AUTH_MODE=mock` to `AUTH_MODE=entra`.
- Linked new design document from README.

### Notes
- Follow-up execution is tracked in `#40`, `#38`, and `#39`.

## 0.1.0 - 2026-03-08
### Summary
Initial M0 foundation release.

### Included
- Backend bootstrap with TypeScript + Express.
- Authentication and RBAC foundation (`mock` and `entra` mode).
- Core relational schema and migration baseline.
- Module and active-version read APIs.
- Seed data for local/test setup.
- M0 discovery decision for borderline/manual review routing.
- Basic CI workflow (lint, test, build).

### Notes
- Migration execution is done through repository migration scripts in this version.

