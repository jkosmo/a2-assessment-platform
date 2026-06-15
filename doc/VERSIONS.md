# Versions

This document tracks release versions and what each version includes.

## 1.3.5 - 2026-06-15

feat(course): seksjons-editor (U1) + IA-design (D1) — #488, #484

Sjette skive av #476 (Tier 2 LMS, epic #478). Første UI for læringsseksjoner.

D1 (#484): `doc/DESIGN_476_LMS_SECTIONS_IA.md` — godkjent IA + wireframes (editor=laptop,
deltaker=mobil-først, eksplisitt språk-veksling i editor, «velg fra bibliotek» for seksjoner).

U1 (#488): ny «Seksjoner»-fane (`/admin-content/sections`):
- Liste over seksjoner (tittel/versjon/sist endret) + opprett/rediger/slett
- Editor med språk-faner (nb/nn/en-GB) — forfatter redigerer hvert språk manuelt
- Side-ved-side markdown + **live forhåndsvisning** via nytt
  `POST /api/admin/content/sections/preview` som rendrer med samme F3/X1-sanitiseringspolicy
  som deltaker-visningen vil bruke (server-side, ingen klient-side render-stack)
- «Seksjoner»-lenke lagt til i kurs-sidens content-area-nav

Ren additiv UI + ett lese-endepunkt. `tsc` + `build` rene. Manuell testing følger ved
staging-deploy sammen med U3 (#490) + P1 (#491).

## 1.3.4 - 2026-06-15

feat(course): blandet CourseItem-ordering-API — B2 (#486)

Femte skive av #476 (Tier 2 LMS, epic #478). API for å sette/lese den fulle ordnede
sekvensen av et kurs — moduler og læringsseksjoner om hverandre:
- `PUT /api/admin/content/courses/:courseId/items` — sett ordnet liste (sortOrder = posisjon);
  validerer at ids finnes og at modul/seksjon ikke gjentas
- `GET /api/admin/content/courses/:courseId/items` — les ordnet liste (med tittel/arkivstatus)

`setCourseItems` re-synker `CourseModule` fra MODULE-items i samme transaksjon, så de
ikke-cutover-de lese-pathene (#502) fortsatt stemmer under expand-contract. Integrasjonstest
(`m2-course-items.test.ts`) dekker interleaved sekvens + CourseModule-synk + validering
(ukjent id, duplikat). `tsc` rent; CI kjører mot Postgres. Ren backend — bygger på F1 (#480)
+ F2 (#481).

## 1.3.3 - 2026-06-15

feat(course): seksjon-CRUD-API — B1 (#485)

Fjerde skive av #476 (Tier 2 LMS, epic #478). REST-API for kurs-læringsseksjoner under
`/api/admin/content/sections` (arver `admin_content`-autorisasjon):
- `POST /` opprett (title + bodyMarkdown, begge lokaliserte) → seksjon + v1
- `GET /` liste, `GET /:id` detalj (med aktiv versjons bodyMarkdown)
- `PATCH /:id/title` oppdater tittel
- `PUT /:id/content` ny innholdsversjon (immutabel, versionNo++, latest-wins)
- `DELETE /:id` (blokkeres hvis seksjonen er knyttet til et kurs)

Kommandoer i `src/modules/course/sectionCommands.ts` speiler Module/ModuleVersion-mønsteret.
Integrasjonstest (`m2-admin-sections.test.ts`) dekker create→read→list→re-version→delete +
delete-blokkering ved kurs-tilknytning. `tsc` rent; CI kjører mot Postgres. Ren backend —
ingen UI ennå (U1 #488).

## 1.3.2 - 2026-06-15

feat(course): CourseItem-polymorfi + backfill + dual-write — F1 expand-fase (#480)

Tredje skive av #476 (Tier 2 LMS, epic #478). Innfører polymorf `CourseItem`
(courseId, itemType MODULE|SECTION, sortOrder, moduleId?/sectionId?) som skal erstatte
`CourseModule`-join og la moduler + læringsseksjoner interleaves i ett ordnet forløp.

Expand-contract (trygt, reversibelt): migrering `20260615000002_add_course_item` oppretter
tabellen, backfiller hver eksisterende `CourseModule` → `CourseItem(type=MODULE)` med bevart
`sortOrder` (gen_random_uuid for id), og har en XOR-CHECK som sikrer at nøyaktig én av
moduleId/sectionId er satt per itemType. `CourseModule` beholdes urørt; `setCourseModules`
dual-writer nå MODULE-items i parallell i samme transaksjon (SECTION-items bevares ved
re-ordering). Lese-pathene er UENDRET → null regresjon på eksisterende kurs-oppførsel.

Lese-cutover (flytt alle `course.modules`-konsumenter til `CourseItem`) + drop av
`CourseModule` følger som egen contract-fase. Integrasjonstest dekker dual-write +
SECTION-bevaring; CI kjører migrering + full suite mot Postgres. `tsc` + `prisma validate` rene.

## 1.3.1 - 2026-06-15

feat(course): CourseSection + CourseSectionVersion-modeller — F2 (#481)

Andre skive av #476 (Tier 2 LMS, epic #478). Additiv datamodell for læringsseksjoner:
`CourseSection` (id, title som lokalisert JSON, activeVersionId, archivedAt) +
`CourseSectionVersion` (immutabel versjon med `bodyMarkdown` som lokalisert JSON, versionNo,
publishedBy/At) — speiler `Module`/`ModuleVersion`-mønsteret slik at historiske visninger kan
fryses mot en versjon. Håndskrevet migrering `20260615000001_add_course_section_models`.

Rent additivt (to nye tabeller + FK-er, ingen endring på eksisterende tabeller) → kan ikke
brekke eksisterende kurs/moduler. Kobles til kurs via CourseItem (#480/F1) som kommer separat;
står frittstående inntil da. Offline-verifisert: `prisma validate` 🚀, `prisma generate` + `tsc`
rent. Runtime-migrering CI-verifisert (verify-jobben kjører migrering mot Postgres).

## 1.3.0 - 2026-06-15

feat(course): markdown-sanitiseringstjeneste for læringsseksjoner — F3 (#482) + embedded-video iframe-allowlist X1 (#493)

Første skive av #476 (Tier 2 LMS — læringstekster mellom moduler, epic #478). Ny ren
tjeneste `src/modules/course/sectionContent.ts`: `renderSectionMarkdown()` renderer
SMO-skrevet markdown via `marked` og saniterer server-side med DOMPurify (jsdom) før det
når en deltaker. `sanitizeSectionHtml()` eksponerer samme policy for live-preview-bruk.

Sikkerhet: script, inline event-handlers og `javascript:`-URLer fjernes. Iframes avvises
by default; embedded video tillates KUN fra en eksplisitt HTTPS-domene-allowlist
(`ALLOWED_VIDEO_IFRAME_HOSTS`: YouTube, youtube-nocookie, Vimeo player) via en
`uponSanitizeElement`-hook. `isAllowedVideoEmbed()` validerer protokoll + host.

`marked` + `dompurify` lagt i `dependencies` (importert i prod-kode), `@types/dompurify` i
devDeps. 13 vitest-enhetstester (positive + negative), tsc rent. Ingen DB/UI ennå — rent
backend-fundament, ship-safe alene.

## 1.2.38 - 2026-06-04

fix(admin-content): «Importer kurs-pakke»-knappen åpner nå fil-velgeren også når kurslisten ikke er tom

Klikk-handleren på `importCoursePackageBtn` ble kun wiret i tom-liste-renderingen av
kurslisten. I den populerte listeveien (minst ett kurs finnes) ble kun `change`-handleren
på fil-inputen registrert, så knappen ga ingen respons ved klikk. La til samme
`click → importCoursePackageFile.click()`-binding i den populerte veien
(`public/static/admin-content-courses.js`).

## 1.2.37 - 2026-05-29

sec(frontend): participant console hardening — same-origin redirect-restore + dokumentert config-eksponering (#355)

AC1 — `auth_intended_url`-restore validerer nå at lagret URL er same-origin + intern path
før navigering, så en eventuelt forgiftet sessionStorage-verdi ikke blir en open-redirect.
Ren funksjon `isSafeSameOriginRedirect(target, currentOrigin)` eksportert fra api-client.js
med dedikert vitest-enhetstest (6/6 grønne) som dekker same-origin/positive, javascript:/
data:/vbscript:-rejection, protocol-relative + relative path-rejection, port/scheme-mismatch,
malformed input, og tom currentOrigin.

AC2 — review av `/participant/config`: responsen er allerede minimal for et pre-auth-
endpoint. Mock-only-feltene (mockRolePresets, identityDefaults) er server-side gated på
`AUTH_MODE === "mock"` → tom/undefined i produksjon. Ingen gjenværende felt kan fjernes
uten å brekke SPA-startup eller post-login workspace-rendering. Ingen kodeendringer
trengtes; konklusjonen dokumenteres.

AC3 — ny seksjon i `doc/CONFIG_REFERENCE.md` ("Public exposure of /participant/config")
med per-felt-tabell: hvorfor hvert felt må være public, hva en uautentisert leser lærer.
Default-policy ved nye felt: «default til authenticated, ikke /participant/config».

Lukker #355.

## 1.2.36 - 2026-05-27

fix(infra): kodifiser deploy-SP Key Vault Secrets User-grant i Bicep (#470, #410-durabilitet)

#410-credential-guarden trenger lesetilgang til DATABASE-URL-secreten for å avgjøre om
skipPostgresUpdate er trygt. Deploy-SP-en hadde bare control-plane-roller (ikke KV data-plane
read) → guarden fikk `kvRead=secret-read-failed` og tvang PG-server-update på hver deploy
(ServerIsBusy-risiko). En manuell staging-grant (az rest PUT) bekreftet fiksen, men forsvinner
ved RG-recreate.

Kodifiserer grant-en i `infra/azure/main.bicep`: ny ressurs `deployPrincipalDatabaseSecretReader`
gir deploy-SP-en (param `deployPrincipalId`) **Key Vault Secrets User** scopet til DATABASE-URL-
secreten (least-privilege — guarden leser kun den). Betinget på `!skipRoleAssignments && !empty(deployPrincipalId)`.
Deploy-SP-en har User Access Administrator → oppretter assignment for seg selv.

Plumbing: `deployPrincipalId` param i Bicep ← `-DeployPrincipalId` i deploy-environment.ps1 ←
`${{ vars.DEPLOY_PRINCIPAL_ID }}` i deploy-azure.yml (begge miljø-jobber). GitHub env-vars satt:
staging=36b2fabb…, production=cba285e6…. What-if-workflowene passer også param-et.

Selvheling: pre-flighten kjører FØR Bicep, så første deploy med dette tvinger fortsatt update
(rollen finnes ikke ennå); Bicep oppretter den; påfølgende deploys leser og skipper. Idempotent
re-deploy dekkes av eksisterende RoleAssignmentExists-toleranse. Dekker både staging og prod.

Oppfølging: fjern den manuelle staging-assignmenten (guid 23be1dd0…) når Bicep eier grant-en.

Rollback: revert commit (grant forsvinner → guard over-fyrer igjen, men trygt — ingen drift).

## 1.2.35 - 2026-05-27

fix(infra): App Service-settings som separate child-ressurser etter KV + role assignments (#416)

Mai-2026-rotårsak: appSettings lå inline i app-ressursenes siteConfig, så de deployet i samme
ARM-operasjon som app-en — før KV-secrets og role assignments var ferdig provisjonert. MSI-
sidecaren kunne forsøke å resolve KV-referanser før read-rollen var på plass → app crashet ved
første boot.

Fiks: appSettings for webApp, workerApp og parserApp er trukket ut til separate
`Microsoft.Web/sites/config@2023-12-01`-child-ressurser (`name: 'appsettings'`) med eksplisitt
`dependsOn`:
- webApp/workerApp → [kvSecretAppRuntime, <app>RuntimeSecretReader] (begge refererer kun
  APP-RUNTIME-SECRETS-bundelen, #431 Stage 2)
- parserApp → [kvSecretParserWorkerAuthKey, parserAppParserAuthSecretReader]

Hvorfor child-ressurs og ikke `dependsOn` på selve app-en: role assignment-en trenger
app-ens MSI `principalId`, så app-en kan ikke avhenge av sin egen role assignment (syklus).
Child-config-ressursen opprettes etter app-en (identitet finnes) og etter role assignment-en,
så KV-referanser først resolves når rollen er på plass.

Settings-arrayene er flyttet VERBATIM (ikke gjenskrevet) og konvertert til den flate mappen
config-ressursen krever via `toObject(array, e => e.name, e => e.value)` — null risiko for
tapte settings fra manuell array→map-omskriving. Ingen `connectionStrings` finnes.
dependsOn på `!skipRoleAssignments`-betingede readers er trygt (Bicep ignorerer dependsOn på
ikke-deployet betinget ressurs — gjelder dagens prod SKIP_ROLE_ASSIGNMENTS=true).

Verifisert: `az bicep build` rent, infra-lint grønn, 3/3 config-ressurser, 0 gjenværende inline
appSettings. ARM what-if (staging + prod) reviewes før merge per invariant #11.

Rollback: revert Bicep-commit (inline-appSettings = nåværende prod-state).

## 1.2.34 - 2026-05-27

fix(infra): PG pre-flight uavhengig av App Service + credential-drift-guard (#411, #410)

Begge endrer PG-pre-flight-regionen i `scripts/azure/deploy-environment.ps1`, derav én PR.

**#411** — `$existingPgServer` resolves nå før `if ($existingWebApp -and $existingWorkerApp)`,
og PostgreSQL-property-pre-flighten (som setter `$skipPostgresUpdate`) er flyttet UT av den
App Service-guarden. Tidligere ble pre-flighten hoppet over på partial teardown (PG finnes,
App Services slettet) → ubetinget server-update risikerte ServerIsBusy-lås. Kjører nå når
PG-serveren finnes, uavhengig av App Services.

**#410** — credential-drift-guard. main.bicep skriver `kvSecretDatabaseUrl` ubetinget men
oppdaterer serveren kun når `!skipPostgresUpdate`. Korrigert premiss: workflowene passer en
*fast* `POSTGRES_ADMIN_PASSWORD`-secret (ikke generert per kjøring), så drift oppstår kun ved
en passord-rotasjon som treffer skip-pathen. Fiks: skip-beslutningen leser nåværende passord
fra DATABASE-URL-secreten — hvis ønsket ≠ nåværende (rotasjon tilsiktet) tvinges server-update
så server + Key Vault endres atomisk (invariant #12); ved match er skip trygt; ved usikkerhet
tvinges update (trygg retning). Ren logikk i `deploy-environment.helpers.ps1`
(`Get-PostgresPasswordFromConnectionString`, `Resolve-PostgresSkipForCredentialSafety`) med
Pester-tester. Ingen Bicep-endring.

Rollback: revert commit. Endringen legger kun til en sikkerhets-guard (tvinger server-update
ved rotasjon/usikkerhet) — verste utfall er en retbar ServerIsBusy, aldri credential-drift.

## 1.2.33 - 2026-05-27

sec(auth): vendre MSAL lokalt + CSP/security-headers (#393)

[Security][P2] Klienten lastet MSAL fra ekstern CDN (alcdn.msauth.net) uten SRI. En
kompromittert CDN-respons ville kjørt i vår origin og kunne lest tokens / kalt API-er
som offeret.

(1) **Vendret MSAL 2.38.0 lokalt**: `public/static/vendor/msal-browser-2.38.0.min.js`
(hentet fra npm, kanonisk provenans). api-client.js `loadMsalScript()` laster nå lokalt
med SRI-integrity (sha384) + crossorigin. Ingen ekstern CDN-avhengighet ved kjøretid.
Oppdateringsprosess dokumentert i `doc/MSAL_VENDORING.md`.

(2) **Security-headers-middleware** (`src/middleware/securityHeaders.ts`, mountet tidlig
i app.ts): CSP med strikt `script-src 'self'` — mulig fordi MSAL nå er lokal og appen
har null inline-script/event-handlers. style-src beholder 'unsafe-inline' (inline
<style>/style-attrs, lavrisiko). connect/frame/form-action tillater Entra-login-origin
for MSAL silent-token/redirect. Pluss X-Content-Type-Options: nosniff, X-Frame-Options:
DENY, Referrer-Policy.

Statisk verifisert før implementering: alle scripts lokale, ingen inline-script/handlers,
all CSS lokal, ingen eksterne https-referanser, ingen ekstern fetch. blob:-nedlastinger
bruker `download`-attr (ikke CSP-styrt). test/unit/security-headers.test.ts dekker
header-kontrakten.

Akseptansekriterier #393: (a) ingen ekstern CDN ✓ (b) versjon kontrollert av vendret
asset ✓ (c) CSP begrenser script-injeksjon ✓ (d) Entra-login i alle arbeidsflater —
gjenstår brukerverifisering.

## 1.2.32 - 2026-05-24

ux(admin): handoff-dialog copy + post-publish-flyt (#361/#442 follow-up)

To uavhengige UX-forbedringer i samme batch (jf. UX-batching):

(1) **Handoff-dialog copy** (option C, brukerfeedback): «Ulagrede endringer»-dialogen
ved Avansert→Samtale brukte «gå tilbake», men brukeren startet i Avansert — misvisende
retning. Endret til retningsnøytralt:
- saveFirst: «Lagre og gå tilbake» → «Lagre og fortsett» (en: «Save and continue»)
- discard: «Gå tilbake uten å lagre» → «Fortsett uten å lagre» (en: «Continue without saving»)
- brødtekst: «blir med tilbake til samtalen» → «blir med til samtalen» (en: «carry back» → «carry over»)
Oppdatert i alle tre locales (begge translation-sett) + HTML-fallback i
admin-content-advanced.html (som dessuten lå på pre-v1.2.28-tekst).

(2) **Post-publish-flyt**: etter publisering landet brukeren i full modul-velger
(«Velg en modul»), som er en unaturlig kontekst rett etter å ha jobbet med én modul.
publishLatestDraftInBackground nullstiller ikke lenger hele konteksten + startModulePicker,
men kaller `loadModule(moduleId)` — laster modulen på nytt (nå Live) og avslutter med
showModuleActions («Hva vil du gjøre med denne modulen?»). «Velg en annen modul» er
fortsatt tilgjengelig derfra. Samme mønster som unpublishModuleInBackground.

## 1.2.31 - 2026-05-24

fix(admin): modul-detaljer-dialog viser blank tittel etter reopen (#361 follow-up)

Bruker rapporterte: «Jeg går inn i Avansert og endrer tittel fra CLS til CLS3, lukker
dialogboks, åpner dialogboks igjen. Tittel er blank.»

Rotårsak: v1.2.29 byttet applyModuleDetailsDialog til setLocalizedEditorValue så
moduleTitleInput.value inneholder bare current-locale string + dataset.localeOriginal
har hele locale-objektet. Men openModuleDetailsDialog (admin-content.js L2591) leste
fortsatt rå .value via parseLocalizedSafe — som returnerer den enkle strengen, ikke
locale-objektet. Trace med currentLocale="nb" og {en-GB:"CLS3", nb:"", nn:""}:
.value = "" (nb verdi) → parseLocalizedSafe("") = "" → alle tabs vises blanke.

Fix: ny readLocaleSrc-helper i openModuleDetailsDialog leser dataset.localeOriginal
først, faller tilbake til parseLocalizedSafe(.value) hvis dataset ikke er satt.
Symmetrisk med readLocalizedFieldValue-pattern fra save-flyten.

Version-details og prompt dialogene har ikke samme issue fordi deres apply-funksjoner
fortsatt bruker formatEditorValue (JSON-stringify i .value) — de leser .value
direkte og det fungerer. Latent inconsistency, men ikke fikset i denne sliсen.

## 1.2.30 - 2026-05-24

fix(admin): handleSaveContentBundle leser ikke dataset.localeOriginal (v1.2.29 e2e-regresjon)

v1.2.29 endret `applyModuleDetailsDialog` til å bruke `setLocalizedEditorValue` —
input.value inneholder nå current-locale string, og dataset.localeOriginal lagrer hele
locale-objektet. Men `handleSaveContentBundle` (admin-content.js L2235) kalte
`normalizeLocalizedTitlePatchValue(moduleTitleInput.value, ...)` som bruker
`parseLocalizedTextField` (uten dataset-bevissthet). Resultat: lagring sendte
{en-GB: "X", nb: "X", nn: "X"} med en-GB-strengen kopiert til alle locales — andre
locales overskrevet. E2e-test "advanced editor persists a renamed module title when
saving content" fanget regresjonen (#nb verdi var "Renamed module" i stedet for
"Omdøpt modul").

Fix: handleSaveContentBundle bruker nå `readLocalizedFieldValue` (med required:false)
som merger dataset.localeOriginal med current-locale edit. Bevarer eksisterende
behavior når dataset ikke er satt (faller tilbake til normalizeLocalizedTitlePatchValue).

## 1.2.29 - 2026-05-24

fix(admin): handoff-tittel rendres som JSON-streng i Samtale-preview (#361 follow-up)

Bruker fanget diagnostic-log fra v1.2.28: `[handoff-apply-shell] {titleType:"string",
titlePreview:"{\n  \"en-GB\": \"CLS3\",\n  \"nb\": \"\",\n  \"nn\": \"\"\n}"...}`.
Det avslørte at moduleTitleInput.value inneholdt JSON-stringified locale-objekt med
2-space-indent — eksakt mønsteret `JSON.stringify(obj, null, 2)` produserer. Tre sammen-
hengende feil:

1. **Rotårsak**: `applyModuleDetailsDialog` (admin-content.js L2616-2619) brukte legacy
   stringify-pattern (`isMultiLocale ? JSON.stringify(obj, null, 2) : obj["en-GB"]`) som
   plasserte rå JSON i input.value uten å sette dataset.localeOriginal. Bypassed v1.2.22-
   invarianten om at locale-aware felt holder current-locale string i .value og lagrer
   hele locale-objektet på dataset. Fix: bruk `setLocalizedEditorValue` for title og
   description (locale-aware). certificationLevel beholdes på asValue-mønsteret.

2. **doWriteHandoff** (admin-content.js L4294) leste rå `moduleTitleInput?.value` — som
   etter dialog-bruk var JSON-strengen. Andre locale-felt (taskText, criteria-input)
   hadde samme svakhet. Fix: ny `readLocaleField`-helper bruker eksisterende
   `readLocalizedFieldValue` (required:false) for å hente locale-objektet fra dataset
   når det finnes, ellers plain string. Sender full locale-fidelity i handoff.

3. **localizeValueForLocale** (admin-content-preview.js L24) brukte `??`-coalesce i
   fallback-kjeden, så tom streng ("") for current-locale returnerte "" i stedet for å
   falle tilbake til en-GB. Med locale-objekt `{en-GB:"CLS3",nb:"",nn:""}` og preview-
   locale nb fikk bruker blank tittel selv om en-GB hadde innhold. Fix: ny
   `pickFirstNonEmpty`-helper med truthy-sjekk (whitespace trimmet).

Sammen sikrer fixene at: (a) dialog ikke korrumperer input, (b) handoff bærer full
locale-fidelity, (c) preview faller pent tilbake mellom locales. Diagnostic-logging
fra v1.2.28 fjernet (server-POST og console.log).

## 1.2.28 - 2026-05-24

fix+diag(admin): handoff dialog-copy oppdatert + diagnostic-log (#361 follow-up)

(1) Dialog-copy `handoff.unsaved.body` oppdatert i alle tre locales etter v1.2.26
utvidet handoff-settet. Tidligere tekst sa «kun oppgavetekst, veiledning og MCQ» —
nå reflektert at title, description, criteria også blir med, og spesifiserer hva som
IKKE blir med (rubric-vekting, prompt-mal, submission-skjema, vurderingspolicy).

(2) Diagnostic console.log på begge sider av handoff (`[handoff-write-advanced]` i
Avansert, `[handoff-apply-shell]` i Samtale) for å verifisere hva som faktisk
skrives/leses. Brukertest av v1.2.26/27 viste at title ikke kom gjennom selv om kode-
trace ser korrekt ut. Logging avklarer rotårsak. Fjernes etter neste verifisering.

## 1.2.27 - 2026-05-24

fix(admin): title/description fra handoff vises ikke i shell (#361 follow-up)

Brukertest av v1.2.26 viste at title-endring fra Avansert→Shell handoff ikke ble synlig
i Samtale-preview (kun MCQ kom igjennom). Rotårsak i `renderPreview` (shell.js ~L1009):

```js
title: mod.title,           // ← ignorerte activeDraft.title
description: mod.description,
taskText: hasDraft ? activeDraft.taskText : (cfg.moduleVersion?.taskText ?? ""),
```

Mens taskText og andre felt brukte `hasDraft ? activeDraft : bundle`-mønsteret, fulgte
ikke title/description samme prinsipp. Bundle.module.title vant alltid for loaded
moduler — så handoff'd title-endringer ble overstyrt av server-state.

Fix: title og description bruker nå samme `hasDraft && activeDraft.x ? activeDraft.x : mod.x`-
mønster som de andre feltene.

## 1.2.26 - 2026-05-24

feat(admin): full working-draft handoff shell ↔ Avansert (addresses #361)

Tidligere bare 4 felt (taskText, candidateTaskConstraints, assessorExpectedContent,
mcqQuestions). Roundtrip mistet title/description/criteria/blueprint hvis ulagrede.

**Endringer**:
- Shell→Avansert: handoff inkluderer nå title, description, criteria, assessmentBlueprint
  i tillegg til eksisterende sett. «Forkast utkastet og åpne Avansert»-knappen er
  re-labeled til «Ta utkastet med til Avansert (uten å lagre)» — den DEPRECATED å
  forkaste; nå carries draft som dirty state i Avansert.
- Avansert→Shell: handoff inkluderer nå title, description, criteria. Blueprint
  utelates (Avansert eksponerer ikke blueprint som textarea — shell henter fra modul-
  bundle).
- `applyHandoffFromShell` (Avansert) markerer riktig dirty-card per felt (moduleDetails,
  versionDetails, mcq, rubric).
- `applyHandoffDraft` (shell) bygger sessionDraft med utvidet patch.

**Eksplisitt utelatt** (Avansert-only — shell rendrer ikke, dokumentert i
admin-content-handoff.js):
- rubric.scalingRule, promptTemplate, submissionSchema, assessmentPolicy

## 1.2.25 - 2026-05-24

fix(reports): TS2783 duplicate courseId i course-learners-mapping (v1.2.24 CI-fix)

CI fanget TS2783 i `src/routes/reports.ts:344` etter v1.2.24 — `CourseLearnerRow`
inkluderer allerede `courseId`, så explicit `courseId: courseLearnerReport.selectedCourseId`
ble overskrevet av spread. Lokal tsc rapporterte falskt grønt (mistenker stale cache —
verifisert i CI etterpå). Fjernet den eksplisitte assignment-en.

Lærdom: TypeScript-feil som dukker opp i CI men ikke lokalt indikerer trolig en stale
`.tsbuildinfo` eller node_modules-cache. Trygt å stole på CI-tsc framfor lokal.

## 1.2.24 - 2026-05-23

feat(results): 4 nye scoped CSV-eksporter (closes #358)

Bygger på eksisterende `exportCsv`-mønster og legger til fire nye `type`-verdier i
`/api/reports/export`:

- **`module-summary`** — én rad per modul, aggregert. Reuser `getCompletionReport`.
- **`module-learners`** — én rad per (learner, modul) innen aktive filters. Ny
  `getModuleLearnersReport` i `completionReport.ts` (generaliserer
  `getCompletionLearnerReport` til å fungere uten moduleId-filter).
- **`course-summary`** — én rad per kurs, aggregert. Flatset
  `getCourseReport`-output med moduleCount; modul-breakdown forblir i UI-detalj-view.
- **`course-learners`** — én rad per (learner, kurs). Krever `courseId`-filter
  (returnerer tom CSV uten — iterering over alle kurs er ikke spec'd ennå).

Alle eksporter respekterer top-level filters (module, course, status, dateRange,
orgUnit). Eksisterende `completion`/`pass-rates`-buttons beholdes.

Frontend: fire nye knapper i Results-export-row + i18n for en-GB/nb/nn.

## 1.2.23 - 2026-05-23

feat(observability): intent-classification logging i Samtale (#357 Phase A, #466 sporer Phase B)

Beslutning på arkitektur for #357: hybrid (regler først, LLM-fallback når regler er
clarify/unsupported). Phase A: instrumentering. Phase B: implementasjon basert på
faktisk pilot-data.

**Endringer**:
- `POST /api/admin/content/intent-log` (`intentLogLimiter` 60/min/bruker): server-
  endepunktet logger structured JSON via `console.log` med prefiks `[intent-log]`.
  Ingen DB-tabell ennå; App Service log stream / Application Insights fanger payloaden.
- Frontend `logIntentClassificationToServer` i `admin-content-shell.js`: fire-and-forget
  fra `runUnifiedRevision` etter `classifyShellEditInstruction`. Sender `rawInput`,
  `intentKind`, `targets`, `locale`, `moduleId`, `hasDraft`, `hasMcq`. Feil i logging
  påvirker aldri brukerflyt.
- `rawInput` truncated til 500 tegn på server for safety.

**Phase B sporet i #466** — etter data-innsamling: utvide rule-set + bundet LLM-classifier-
fallback.

## 1.2.22 - 2026-05-23

slice: locale-aware textarea-display + kollaps modulliste (closes #462, closes #465)

**#462 — rå JSON i Avansert-textareas**

`formatEditorValue` viste locale-objekter som rå `{"en-GB":"...","nb":"..."}`-blob i
textarea-feltene. Fikset med to nye helpers i `admin-content.js`:

- `setLocalizedEditorValue(el, value)` — viser current-locale-verdi i textarea, lagrer
  original locale-objekt på `el.dataset.localeOriginal`. Aksepterer både locale-objekt
  direkte og JSON-encoded locale-objekt-string (legacy lagring fra Samtale).
- `readLocalizedFieldValue(el, fieldLabelKey, options)` — merger brukerens textarea-tekst
  inn i den lagrede originalen ved save (kun current-locale oppdateres, andre bevart).
  Hvis bruker har skrevet en JSON-blob manuelt, faller den tilbake til
  `parseLocalizedTextField` så multi-locale-edit via JSON fortsatt fungerer.

Anvendt på 8 locale-aware felt: moduleTitle, moduleDescription, mcqSetTitle,
moduleVersionTaskText, moduleVersionCandidateTaskConstraints,
moduleVersionAssessorExpectedContent, promptSystemPrompt, promptUserPromptTemplate.

Ikke-locale-felt (rubric-criteria, mcq-questions, assessment-policy) bruker fortsatt
`formatEditorValue` / rå JSON som før.

**Kjent begrensning**: locale-switching mid-edit oppdaterer ikke textarea-innholdet
automatisk. Bytte av locale påvirker bare nyåpnede moduler. Dokumentert som
follow-up-issue om det blir et reelt problem i bruk.

**#465 — kollaps modulliste i Participant**

Når deltakeren aktiverer en modul, kollapses modullisten (og hjelpeteksten) i
participant-UI-en så modul-innholdet får mer plass. Header + «Last moduler»-knappen
forblir synlig. Klikk på «Last moduler» ekspanderer listen igjen.

Implementert som CSS-klasse `.module-list-collapsed` på `#moduleListSection` med
`display: none` på `#moduleList` + `#moduleSelectionHint` + summary-hint.

## 1.2.21 - 2026-05-23

fix(admin): #464 borderlineWindow ble stripped av zod-schema på lagring

v1.2.20 implementerte borderlineWindow-logikken i decisionService, men brukertest
viste at vinduet ikke faktisk persisterte: oppgitt vindu 0-90, lagret, publisert,
deretter participant-innlevering med score i vinduet → fortsatt automatisk
pass/fail (avhengig av threshold), aldri manuell review. Ved re-åpning av Avansert
var vinduet borte.

**Root cause**: `assessmentPolicyBodySchema.passRules` i `adminContentSchemas.ts`
hadde kun `totalMin` som tillatt felt. Zod stripper ukjente nøkler stille uten
`.passthrough()`, så `borderlineWindow`, `mcqMinPercent` og `practicalMinPercent`
(alle tilbudt av UI-dialogen) ble fjernet fra payloaden før den nådde createModuleVersion.

**Fix**: utvidet schemaet til å akseptere alle feltene UI-en samler inn. Backward-
kompatibelt (alle nye felt er `.optional()`).

## 1.2.20 - 2026-05-23

slice: 5 backlog-issues + #462 utsatt (addresses #464, #460, #459, #461, #463)

**#464 — borderlineWindow brukes nå i decisionService**

Tidligere dead field. Nå: hvis `passRules.borderlineWindow.{min,max}` er satt og
`totalScore` er i intervallet, rutes innleveringen til manuell vurdering selv om
threshold-rules ellers gir auto-pass. `passFailTotal=false` for borderline-saker.
Decision-reason refererer eksplisitt til borderline-vinduet.

**#460 — Status-label split i to (`published_with_draft`)**

`deriveLibraryStatus` returnerer nå `published_with_draft` når `activeVersionId` er
satt men `latestVersion !== activeVersion`. Frontend viser «Live + utkast» (en-GB:
«Live + draft», nb/nn: «Live + utkast»). Grønn bakgrunn (publisert) + gul outline
(har upublisert draft). Filter «Har upublisert utkast» dekker både `unpublished_draft`
og `published_with_draft`. Filter «Publiserte» dekker både `published` og
`published_with_draft`.

**#459 — Avpubliser-knapp i modul-bibliotek-rad**

Ny `Avpubliser`-knapp synlig kun for moduler med status `published` eller
`published_with_draft`. Klikk → window.confirm-dialog med tydelig melding om
konsekvensene → POST `/modules/:id/unpublish` (samme endepunkt Avansert bruker) →
toast + refresh.

**#461 — Versjonsnummer i participant module-list**

Diskret «· vN»-tag etter modul-tittel i participant-modulvalg. Publiseringsdato vises
i tooltip. Diskret stilet (`font-size: 11px`, `color: meta`) så det ikke konkurrerer
med tittel-presentasjonen. Hjelper support/debug å reprodusere hvilken versjon en
deltaker fikk servert.

**#463 — Dirty-detection før publisering**

`handlePublishModuleVersion` sjekker nå `dirtyCards.size > 0` før POST. Hvis det er
ulagrede endringer, vises bekreftelses-dialog som lister hvilke cards som er dirty
og forklarer at publisering bruker SIST LAGRET versjon. Brukeren kan velge å avbryte
og lagre først, eller fortsette publisering uten ulagrede endringer.

**#462 — Utsatt**

Kvikkfix for rå JSON i Avansert-textareas ville introdusert data-tap (parser ville
overskrive locale-objekter med plain string ved første save fra Avansert). Krever
origin-tracking + merge-på-save. Bumpet til neste slice som dedikert oppgave.

## 1.2.19 - 2026-05-23

feat(review): decision-orientert case-detail layout (addresses #349, #354)

Review- og appeal-detail-paneler er omstrukturert fra «data dump + linear sections»
til en decision-stack:

1. **Header**: status-chip + SLA-chip + modul + kandidat (kort kontekst på toppen).
2. **Kandidatens innlevering**: oppgave, svar, refleksjon, innleveringstidspunkt — som
   en strukturert `<dl>` (ikke pre-formatert tekst).
3. **Beslutningshistorikk**: AI-vurdering → Vurderer-overstyring → Anke → Anke-beslutning,
   som en tidslinje med actor + tidspunkt + decision + begrunnelse.
4. **Din beslutning**: textareas + select + Krev oppdraget / Fullfør beslutning (samme
   form-felter som før, bare flyttet inn i sin egen seksjon med blå-toned bakgrunn).
5. **Tekniske detaljer**: collapsed `<details>`-seksjon med rå JSON / ID-er / timestamps —
   tilgjengelig, men ikke synlig i førsteinntrykk.

**#354** (interaction grammar): «Claim review»/«Claim appeal»/«Assign to me» → konsistent
«Krev oppdraget» (`case.action.claim`). «Finalize override»/«Resolve appeal» → «Fullfør
beslutning» (`case.action.finalize`). Begge knapper plassert i samme rekkefølge i begge
paneler. Eksisterende `manualReview.claim/override` og `appealHandler.claim/resolve`-keys
beholdes for bakoverkompatibilitet — `data-i18n` på knappene peker nå på `case.action.*`.

**Acceptance per #349**:
- ✅ Case detail-paneler kan forstås uten å lese hele raw data dump
- ✅ Viktigste decision-data først; teknisk metadata sekundær/collapsible
- ✅ Operator-hastighet uten endring i business rules (samme form-felter, samme submit-paths)

**Acceptance per #354**:
- ✅ Manual-review og appeal bruker samme interaction-grammar (claim → finalize)
- ✅ Rolle-spesifikke ord (Decision reason / Override note / Resolution note) beholdt
  der de er distinkte; standardiserte der de var asymmetriske uten grunn.

## 1.2.18 - 2026-05-23

slice: 3 endringer i modul-bibliotek (closes #457, closes #458, closes #352)

**#457 — STATUS_LABELS i18n**

`STATUS_LABELS` i `admin-content-library.js` var hardkodet norsk («Arkivert», «Upublisert
utkast», «Publisert», «Klargjort»). Brukere i en-GB/nn så norske labels. Erstattet med
i18n-keys (`library.status.archived` osv.) med oversettelser for alle tre locales.

**#458 — Import-dialog focus-restore på feil**

`importModulePackageFile`-change-handleren fokuserer nå tilbake til `importModulePackageBtn`
når import feiler, så tastatur-bruker kan re-trigge uten å Tab-e fra en tom file-input.
SR-bruker får allerede annonsering via toast.js (`role="alert"` for error-toasts).

**#352 — Retire transitional admin-content routes**

- `GET /admin-content?moduleId=X` → 301-redirect til canonical
  `/admin-content/module/X/conversation`.
- `GET /admin-content/advanced` (no module context) → 301-redirect til `/admin-content`
  (modul-bibliotek). Avansert-editoren ligger nå kun på `/admin-content/module/:id/advanced`.
- Interne client-refs (`buildAdminContentAdvancedUrl` fallback, shell.js error-recovery)
  oppdatert til canonical routes så vi ikke genererer 301-vekkredirects internt.
- `participant-console-config.test.ts` testene oppdatert til å bekrefte både redirects og
  canonical routes.

Bookmarks/eksterne lenker til legacy URLs fortsetter å virke via 301.

## 1.2.17 - 2026-05-23

fix(admin): Sertifiseringsnivå-kolonnen viste hardkodet engelsk + ugyldig "Foundation"

Modul-bibliotek-tabellen hadde et `CERT_LABELS`-objekt med fastlåst engelsk («Basic»,
«Intermediate», «Advanced») pluss en ugyldig «Foundation»-verdi som ikke finnes i
skjemaet (`certificationLevelSchema = enum["basic","intermediate","advanced"]`).

Fix:
- Erstatt `CERT_LABELS` med `CERT_I18N_KEYS` som mapper enum → i18n-keys
  (`adminContent.promptDialog.certificationLevelBasic|Intermediate|Advanced`). Bruker
  ser «Grunnleggende / Videregående / Avansert» i nb, «Grunnleggjande / Vidaregåande /
  Avansert» i nn, «Basic / Intermediate / Advanced» i en-GB.
- Fjern «Foundation» (dead code).
- Tolerer legacy-data der `certificationLevel` ble lagret som JSON-encoded locale-objekt
  — parser ut en kjent enum-verdi om mulig, ellers viser verdien rå (synlig signal at
  noe er feil og kan ryddes manuelt).


---

Older versions (v1.2.16 and earlier) are archived in [`archive/VERSIONS_archive.md`](archive/VERSIONS_archive.md) — flyttet 2026-05-29 for å holde denne fila lesbar.
