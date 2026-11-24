# Plan #1192 punkt 1 og 2: bestått modul overalt, og ny frist etter ny hovedversjon

Avgjort av produkteier 2026-11-24 (`doc/DECISIONS.md`, «Fire avgjørelser fra kompleksitetsskanningen»). Punkt 3 og 4 er bygget i
2.181.5. Denne planen gjelder de to som endrer hva «bestått» og «fullført» betyr flere steder, og leses av Codex før noe bygges.

Felles prinsipp: ett sted avgjør, alle flater leser derfra. Kuren som har holdt i dette repoet er å flytte avgjørelsen til én
funksjon (#958-formen), ikke å rette utregningen på hvert sted.

---

## Del 1: «Har deltakeren bestått modulen?»

### Regelen vi vil ha (finnes allerede)

`src/modules/course/moduleCredit.ts`: en `ModulePass`-rad teller når `invalidatedAt` er null og passets hovedversjon
(`ModuleVersion.versionMajor`) er minst kravet (`CourseModuleRequirement.minModuleMajor` per kurs). `ModulePass` skrives bare av
`recordModulePassFromDecision`: et bestått lager raden, et senere ikke bestått på SAMME innlevering (overprøving, anke) sletter
den, og et ikke bestått på en annen innlevering rører den ikke. Brukes av kursets framdrift, kursbeviset, kursrapporten, «Mine
kurs», den ukentlige e-posten og sletteskjermene.

### Steder som svarer annerledes (kartlagt 2026-11-24)

| | Sted | Regel nå | Flate |
|---|---|---|---|
| A | `completionReport.getCompletionReport` | siste forsøk, status `COMPLETED` (uansett utfall) | Resultater «Fullføring per modul», CSV `completion`, `module-summary` |
| B | `completionReport.getPassRatesReport` | siste forsøk, siste vedtak | «Bestått»-kolonnen, CSV `pass-rates` |
| C | `getCompletionLearnerReport`, `getModuleLearnersReport` (`deriveLearnerSubmissionStatus`) | siste forsøk | detaljvisningen, CSV `module-learners` |
| D | `CertificationStatus` (`certificationStatusService`) | siste vedtak med en vakt; ingen versjon; et omgjort bestått står som ACTIVE | `GET /api/reports/recertification`, CSV `recertification`. Ingen side i klienten |
| E | `findPassedCertificationsForModule` | `CertificationStatus` | tall i publiseringsdialogen (`/modules/:id/passed-count`, `coursePublishService.ts:676`) |
| F | `myStats.ts` + `activityReport.passedAt()` | ethvert bestått, noen gang, uten versjon | `/profile` «Moduler bestått», ukestall |
| H | `participant.js` `continueModuleFlow` | siste vedtak | autostart av flervalgsmodul utenfor kurs |
| I | `formatModuleStatusSummary`, `buildModuleCardViewModels` | siste innlevering `COMPLETED` | modulkort; trolig ikke nåbart etter #952 |

Utenfor: G (aktivitetsloggen) og J (flervalgsanalysen) teller forsøk og hendelser, ikke tilstand. De forblir per forsøk.

### Hva «revidert» betyr når det ikke finnes et kurs

Kursflatene har et krav per kurs (`minModuleMajor`). Modulflatene A–F har ikke det. **Forslag:** på modulnivå er en bestått
gjeldende når passet er på modulens nyeste hovedversjon (`currentModuleMajor`) og ikke er ugyldiggjort. Når en rapport er
filtrert på ett kurs, brukes kursets krav. Forskjellen: et kurs som valgte «mindre versjon» da modulen fikk ny hovedversjon,
godtar fortsatt det gamle passet; modulrapporten uten kursfilter gjør ikke det. Det er riktig: modulen ER revidert, kurset har
valgt å ikke kreve det.

### Skiver

1a. **Én funksjon for modulnivå** i `moduleCredit.ts`: `findModuleStanding(client, { moduleIds, userIds?, courseId? })` →
    per (person, modul): `PASSED` (gjeldende pass), `REVISED` (pass bare på eldre hovedversjon), `NOT_PASSED`. Med `courseId`:
    kursets krav. Legges til i `PROGRESS_READERS` i `test/content-lock-write-guard.test.js`.
1b. **Rapportene A–C** leser utfallet derfra. «Fullføring per modul» teller fortsatt personer én gang. Utfallet per person:
    - `PASSED` (gjeldende pass): bestått, uansett hva senere forsøk ga.
    - `REVISED` (pass bare på en eldre hovedversjon, eller pass som er ugyldiggjort): **ikke bestått**, vist som «må ta ny
      versjon». Et gammelt bestått-vedtak overstyrer aldri dette (Codex HØY 2: dagens reserve ville gitt `PASS`).
    - `NOT_PASSED`: siste forsøk **på gjeldende hovedversjon** avgjør som i dag (under vurdering / ikke bestått / i gang).
    «Forsøk»-kolonnen står. Statusfilteret og utfallsfilteret følger samme regel. CSV-feltnavnene står.
    **Datofilteret** (valgt, Codex 7): som i dag velger det personer med en innlevering i perioden (`submittedAt`); utfallet er
    personens ståsted nå. Rapporten svarer «hvordan står de som var aktive i perioden», ikke «hvem besto i perioden».
1c. **Profilen (F):** «Moduler bestått» og tallene leser gjeldende pass. Et pass på en revidert modul vises ikke som bestått.
    Ukestallene («bestått denne uka») er hendelser og blir per hendelse, men bare for pass som fortsatt finnes i `ModulePass`
    (et omgjort bestått telles ikke).
1d. **`/recertification` (D), tallene i E og slettedialogen** (`adminContentCommands.ts:494`, Codex LAV) leses fra `ModulePass`
    på modulnivå. `CertificationStatus` skrives fortsatt, men leses ikke av noen flate etterpå. Fjerning av tabellen er en egen
    sak (kontrakt etter utrulling, #811).
1e. **Klienten (H, I):** H bruker serverens svar (`retakeRequired`/standing) også utenfor kurs; I fjernes hvis det beviselig ikke
    er nåbart, ellers samme kilde.

### Veier inn (skrivere av det leserne ser)

`recordModulePassFromDecision` (vedtak: vurdering, overprøving, anke, flervalg), tilbakefyllingen (`invalidatedAt`),
`raiseModuleRequirementInCourse`, `syncModuleRequirements`, publisering av ny hovedversjon (`resolvePublishNumber`). Ingen nye
skrivere i del 1.

### Utrulling

Bare lesere endres; ingen migrering. Gammel fane mot ny tjener: samme felt i svarene, bare andre tall. Ny klient mot gammel tjener
(H/I): klienten må tåle at det nye feltet mangler.

### Tester som fester den gamle regelen og må endres

`test/completion-per-person.test.ts` (siste forsøk), `test/unit/reporting-service.test.ts:56,114`, `test/m2-reporting.test.ts`,
`test/e2e/results-per-person.spec.ts`, `test/unit/certification-status-service.test.ts` (bare hvis D-leseren byttes),
`test/m2-certification-status-flow.test.ts`, `test/m2-module-credit-934-5a2.test.ts:543,569`, `test/unit/my-stats-1138.test.ts`,
`test/me-stats-1138.test.ts`, `test/e2e/profile-stats-1138.spec.ts`, `test/participant-console-state.test.js`.

---

## Del 2: ny frist etter ny hovedversjon

### I dag

- `deriveStatuses` (`enrollmentService.ts:240`): et kursbevis for HVILKEN SOM HELST hovedversjon gir `COMPLETED`. Brukes av
  `/api/courses/enrollments`, administrators liste, Status (`cohortStatusService`) og påminnelsene (hopper over `COMPLETED`).
- Den ukentlige e-posten: ethvert kursbevis tar kurset ut.
- Kursrapporten: eldre bevis og kravet ikke oppfylt → `NEEDS_NEW_VERSION` («Må ta ny versjon»), uten å se på frist.
- Tildelingse-posten: eldre bevis får e-post («nytt kurs») når kurset eller medlemskapet kom etter den nye hovedversjonen
  (DECISIONS 2026-11-10, «En ny frist er fortsatt ikke et nytt kurs»).
- **Ingen tabell lagrer når en frist ble satt.** `CourseEnrollment` har `assignedAt` (oppdateres også ved samme dato),
  `CourseGroupAssignment` bare `createdAt`. Revisjonssporet har ikke `dueAt`.

### Regelen

En person med kursbevis bare for en eldre hovedversjon er **utestående** når den gjeldende fristen for personen (individuell
foran klasse, ellers den tidligste fra aktive klasser, som i dag) ble satt etter at kursets nåværende hovedversjon ble publisert
(`CourseVersion.publishedAt` for `Course.versionMajor`). Ellers er kurset fullført, som i dag.

### Skiver

2a. **Migrering (bare tillegg):** `dueSetAt DateTime?` på `CourseEnrollment` og `CourseGroupAssignment`. Skrives når `dueAt`
    settes eller endres (`enrollmentRepository.ts:22-34`, `classRepository.ts:110-117`), og ved opprettelse med frist. Ikke når
    samme dato sendes på nytt. Ingen tilbakefylling (se spørsmål B). **Atomisk** (Codex 6): sammenligningen og skrivingen skjer i
    samme `UPDATE` (`dueSetAt = CASE WHEN "dueAt" IS DISTINCT FROM $ny THEN now() ELSE "dueSetAt" END`), så to samtidige lagringer
    ikke kobler feil tidspunkt til fristen. Kjent mangel under utrullingen: gammel kode som endrer en frist i de minuttene,
    beholder et eldre `dueSetAt`.
2b. **Én funksjon for den gjeldende fristen** (Codex HØY 1): `effectiveDeadline({ individual, classRows })` → `{ dueAt, dueSetAt }`.
    I dag slår fire steder sammen fristene hver på sin måte: `getClassAssignedCourseDueDates`, `cohortStatusService.ts:39,63-66`
    (en individuell rad UTEN frist vinner), `courseReminderService.ts:182,241-243` (individuelle frister utenfor
    påminnelsesvinduet er filtrert bort FØR klassefristene flettes inn) og `weeklyDigestContent.ts:99` (`??`, så en individuell
    rad uten frist taper mot klassen). Alle fire skal bruke den nye funksjonen, og påminnelsene skal velge fristen FØR de
    filtrerer på vinduet. Regelen: en individuell tildeling vinner, også uten frist (som Status i dag); ellers den tidligste
    fristen fra aktive klasser. **Lik dato** (Codex 5, valgt): det seneste `dueSetAt` følger med, så en ny frist ikke skjules av
    en gammel med samme dato. Dette er et eget lite skritt som kan rulles ut før regelen: det retter at Status, påminnelsene og
    ukeposten i dag kan vise ulike frister for samme person.
2c. **`deriveStatuses`** bruker regelen: eldre bevis + ny frist → `ASSIGNED`/`IN_PROGRESS`/`OVERDUE` etter framdriften på den nye
    versjonen; ellers `COMPLETED`. Da følger `/enrollments`, Status og påminnelsene automatisk.
2d. **Ukentlig e-post:** `certifiedCourseIds` tar ikke ut et kurs som er utestående etter regelen.
2e. **Kursrapporten:** `NEEDS_NEW_VERSION` bare når regelen sier utestående; ellers `COMPLETED` (med versjonsmerket som i dag).
    **Sammendraget også** (Codex 3): fullføringstallet og prosenten (`courseReport.ts:183`) teller i dag bare bevis for nåværende
    hovedversjon. De skal telle de samme som detaljen kaller fullført.
2f. **«Mine kurs»:** det frivillige merket «Ny versjon» står; et utestående kurs vises som ikke fullført, med fristen.
2g. **Tildelingse-posten:** se spørsmål C.

### Veier inn (skrivere av fristen)

`POST /api/admin/content/courses/:courseId/enrollments` → `assignEnrollments`; `POST /api/admin/content/classes/:classId/courses`
→ `assignCourseToClass`; fristendring på klassens kurs (samme repository); kursimport/agent-API hvis de setter frist (sjekkes);
`selfEnroll` (alltid uten frist). Lesere: de tre sammenslåingene over, `deriveStatuses`, `weeklyDigestContent`, `courseReport`,
`courseAssignmentNotice` (fristen i e-posten).

### Samtidighet og utrulling

Migreringen er bare tillegg (#811). Gammel kode skriver ikke `dueSetAt` i minuttene under utrullingen: en frist satt da regnes som
gammel. Godtatt. Ny hovedversjon publisert samtidig med en fristendring: tidsstemplene avgjør; samme sekund regnes som «ikke
etter».

### Tester som fester den gamle regelen

`test/m2-course-versions-934.test.ts:117-129` (eldre bevis + passert frist = `COMPLETED`; beholdes som kontroll med frist satt FØR
versjonen), `:87-115`, `:529`, `test/m2-module-pass-per-course-934-5a3.test.ts:1112`, `test/e2e/course-versions-934.spec.ts:134-154`,
`test/unit/weekly-digest-content-1139.test.ts:74`, `test/m2-course-assignment-email-1142.test.ts:1026-1064`.

---

## Spørsmål til produkteier før bygging

**Besvart 2026-11-24: ja på A, B og C** (forslagene under gjelder).

**A. Modulnivå:** er en bestått modul «revidert» i modulrapportene og profilen når modulen har fått en nyere hovedversjon, også
om et kurs har valgt å ikke kreve den? Forslag: ja (se over).

**B. Frister som finnes i dag:** regnes som satt FØR den nye versjonen (ingen endring for noen ved utrulling). Alternativet er å
bruke `createdAt`/`assignedAt` som anslag, som kan gjøre kurs utestående og sende påminnelser samme dag som utrullingen.
Forslag: regnes som gamle.

**C. Tildelingse-posten til en med eldre kursbevis:** i dag går «nytt kurs» når kurset eller medlemskapet kom etter den nye
hovedversjonen, også uten frist. Forslag: e-post bare når tildelingen gjør kurset utestående etter regelen (en frist satt etter
den nye versjonen), med teksten «ny versjon av et kurs du har fullført», ikke «nytt kurs». Uten frist er den nye versjonen
frivillig, og det sendes ingenting. **En ren fristendring på en tildeling som finnes, gir ingen e-post** (Codex 4), som i dag
(«Endres fristen på et tildelt kurs, får ikke klassen e-post», 2026-11-07). Den som får et kurs utestående på den måten, ser det
i «Mine kurs», i påminnelsene og i den ukentlige e-posten.

**Valgt i planen, ikke spørsmål:** lik dato på to frister (det seneste tidspunktet følger med), datofilteret i modulrapportene
(personer aktive i perioden, ståsted nå), og at en individuell tildeling uten frist vinner over klassens frist (som Status i dag).

## Planlesing (Codex, 2026-11-24)

To HØY: påminnelsene filtrerte individuelle frister før sammenslåingen (rettet med 2b), og «ellers siste forsøk» kunne gi bestått
tilbake etter revisjon (rettet med utfallene i 1b). Fem MIDDELS rettet i 1b, 2a, 2b, 2e og spørsmål C; én LAV i 1d. Codex: bare
1a og 2a kan rulles ut hver for seg uten videre; resten må aktiveres samlet per del, med klient og API sammen.

## Rekkefølge

Del 1 og del 2 endrer to ulike begreper («bestått modul» og «fullført kurs»), men begge treffer kursrapporten. De bygges etter
hverandre, del 1 først (bare lesere, ingen migrering), hver som egen versjon gjennom testrunde, QA-port og stage.
