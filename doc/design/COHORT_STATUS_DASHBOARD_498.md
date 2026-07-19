# #498 — Teacher/SMO cohort-status dashboard (design writeup)

Status: bygget, stage-deployet (ikke prod). For review. Siste «Done når»-pilar i Epic #478 (Tier 2 LMS).

## Mål
Gi en lærer/SMO ett blikk på **hvor kohorten står** på et kurs: hvor mange deltakere er **Tildelt /
Påbegynt / Forfalt / Fullført**, totalt og per klasse.

## Beslutninger

1. **Egen side under «Deltakere», ikke utvidelse av `/results`.**
   - `/results` bruker en *submission/modul-basert* status (NOT_STARTED/IN_PROGRESS/COMPLETED) og en
     submission-avledet «enrolled»-populasjon. #498 trenger **enrollment-status-modellen**
     (ASSIGNED/IN_PROGRESS/OVERDUE/COMPLETED fra `deriveEnrollmentStatus`) over den **effektive
     audience** (CourseEnrollment + klasse-ekspandert). Å blande to semantisk ulike status-akser i samme
     tabell ville forvirret.
   - Målgruppe: **SMO** (+ ADMIN + REPORT_READER). `/api/reports` er kun ADMIN+REPORT_READER; «Deltakere»-
     sub-navet er allerede rollegated for nettopp SMO/ADMIN/REPORT_READER — så en ny «Status»-fane der
     passer IA + rollegating uten å utvide `reports`-rollene.

2. **Effektiv audience = individuell + klasse-ekspandert, én rad per (bruker, kurs).**
   - Individuell: `CourseEnrollment` (aktive, ikke-revokerte).
   - Klasse: `CourseGroupAssignment` → MANUAL-klassers `ClassMember` + system-klassen «Alle deltakere»
     (alle aktive deltakere). ENTRA-klasser hoppes over (medlemskap ikke oppløsbart read-time — speiler
     påminnelses-jobben).
   - **Presedens:** individuell vinner over klasse; blant klasser vinner tidligste frist. Dette er read-
     time-analogen av påminnelses-jobbens `gatherCandidates` — men kurs-scoped og **uten dueAt-filter**
     (dashboardet viser alle, med eller uten frist). Bevisst *ikke* delt kode med reminderen ennå: de er
     ulikt scoped (global/dueAt vs. kurs/alle); en felles `resolveCourseAudience` kan ekstraheres senere
     hvis en tredje forbruker dukker opp.

3. **Status utledes med eksisterende `deriveStatus`** (COMPLETED→OVERDUE→IN_PROGRESS→ASSIGNED).

## Kjente MVP-avgrensninger (bevisste)
- **N+1:** `deriveStatus` kjører 1–2 spørringer per deltaker (completion-oppslag + started-probe). Greit
  for typiske kohorter; batch completion/started-oppslagene hvis kohorter blir store.
- **Individuelle enrollments filtreres ikke på aktiv/anonymisert** (klasse-medlemmer gjør det, via
  member-select). Symmetri kan legges til hvis inaktive individuelt-tildelte skal utelates.
- **Per-klasse-breakdown teller kun deltakere hvis *effektive* kilde er klassen** (en bruker som er
  både individuelt tildelt og klasse-medlem vinner individuell → ikke i klasse-bøtta). Bevisst: bøtta =
  «deltakere som er her *via* denne klassen».
- **Ingen drill-down til deltaker-liste** i v1 (kun aggregat + per-klasse). Naturlig neste steg.

## Overflate
- Backend: `src/modules/course/cohortStatusService.ts` (`resolveCourseAudience`, `getCohortStatus`),
  `classRepository.findCourseGroupAssignmentsForCourse`, `src/routes/cohortStatus.ts`, capability
  `cohort_dashboard` i `capabilities.ts`, mount i `app.ts`.
- Frontend: `public/cohort-status.html` + `cohort-status.js` + `i18n/cohort-status-translations.js`,
  «Status»-fane i `deltakere-subnav.js` (+ baren på de andre Deltakere-sidene), rute `/deltakere/status`.
- Tester: `test/m2-cohort-status.test.ts` (integrasjon) + `test/e2e/cohort-status.spec.ts`.

## Neste steg (etter review)
- Drill-down: klikk en status/klasse → deltaker-liste (gjenbruk `listCourseEnrollments`-mønsteret).
- Batch `deriveStatus` hvis kohorter vokser.
- Vurder felles `resolveCourseAudience` delt med reminder-jobben.
