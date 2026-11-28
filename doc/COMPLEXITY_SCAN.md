# Kompleksitetsskanning

Månedlig måling av om kodebasen samler opp slitasje. Mekanisme 4 i kompleksitetsbremsen.

> **Sist kjørt: 2026-11-23** · neste forfaller **2026-12-23**

⚠️ Datoen over er den eneste kilden. `AGENTS.md` og `CLAUDE.md` peker hit — de gjentar den ikke.
To kopier av samme faktum som må oppdateres i takt er nøyaktig feilklassen skanningen leter etter.

## Hvorfor månedlig, og hva tallet betyr

Verdien er ikke funnene alene — det er **trenden**. Gikk «hvor mange steder svarer på dette
spørsmålet» opp eller ned siden sist? Det er det eneste tallet som sier om bremsen virker.

En enkeltstående skanning forteller bare at kodebasen har slitasje. Det har alle kodebaser.

## Logg

| Dato | Funn | Områder | Toppfunn | Notat |
|---|---|---|---|---|
| 2026-08-21 | 48 | 6 av 6 | Kursimport uten eierskapssjekk (#942) | Første kjøring. Utløst av #938, ikke av rutinen. 45 saker under #941 |
| 2026-10-21 | 40 | 6 av 6 | Org-synken angrer pseudonymiseringen og kobler identitet på e-post | Andre kjøring (én måned forsinket). Fire tyngste verifisert for hånd. 4 trenger produkteiers avgjørelse. Første kjøring med steder per spørsmål (under) |
| 2026-11-23 | 41 | 6 av 6 | Modulsida publiserer uten å spørre om ulagrede endringer; rettelsen forsvinner | Tredje kjøring (to dager forsinket). 17 fra oktober står, 7 rettet, 4 avklart som beslutning; 24 nye. Fire verifisert for hånd. 4 nye trenger produkteiers avgjørelse. Funnene holder seg flate, men **«kursinnhold» og «fullført» vokste igjen**: de nye stedene kom med kursversjoner, kursutkast, arkivering og ukentlig e-post |

**Trenden** — steder som SELV avgjør svaret (et kall til den kanoniske funksjonen teller ikke):

| Spørsmål | 2026-08-21 | 2026-10-21 | 2026-11-23 | Kanonisk funksjon |
|---|---|---|---|---|
| Hva inneholder dette kurset? | 25 | 9 | **14** ↑ | `findCourseItemsForParticipant` / `findAllCourseItems` + `sectionAvailability.ts`; klient `participant-console-state.js` |
| Er brukeren privilegert nok? | 12 | 14 (tjener 5, klient 9) | **16** ↑ (tjener 5, klient 11) | `roleSets.ts` `hasAnyRole`, `capabilities.ts` `rolesFor` |
| Er dette forsøket bestått? | 8 | 3 | **2** ↓ | `submissionOutcome.ts` `isSettledSubmission` + siste vedtak; klient `outcome.js` |
| Er kurset synlig for deltakeren? | 8 | 7 | **7** (9 med to steder oktober ikke talte) | `enrollmentService` `filterVisibleCourseIds` / `isCourseVisibleToUser` |
| Er skjemaet endret? | 5 | 7 | **7** (12 med alle steder) | `form-page.js` `state.dirty` / `markDirty` |
| Er kurset fullført? | 5 | 3 | **8** ↑ | `CourseCompletion`-raden (`enrollmentService.deriveStatus`) |
| Hvilken lokale gjelder nå? | 4 svar | 4 svar (19 steder) | **4 svar (22 steder)** ↑; utvidet telling 5 svar / 51 | `requestLocale.ts`, `recipientLocale.ts`; klient `i18n-locale.js` |

Nytt spørsmål fra 2026-11-23, ikke talt før: **«Har deltakeren bestått modulen?» — 4 regler** (kurs/kursbevis: en bestått står til
modulen revideres, svar f; modulrapportene: siste forsøk; `CertificationStatus`: siste vedtak med vakt; profilen: ethvert bestått).

⚠️ Nullpunktet listet ikke stedene, så august-tallene er talt på en ukjent måte. «Privilegert» er trolig
talt bare på tjeneren i august (da: 12 → 5). «Lokale» i august var antall ulike *svar* (reserver), ikke
steder. Fra 2026-10-21 står hvert sted under, så neste måned kan telle likt.

### Steder 2026-11-23

- **Kursinnhold (14):**
  - Alle ni fra oktober står fortsatt: `myCoursesProgress.ts:82` (flyttet fra `courses.ts:85`), `routes/courses.ts:225`,
    `courseCompletionService.ts:70`, `courseReport.ts:172`, `:273-275`, `courseRepository.ts:221-227`, `courseCommands.ts:49-100`,
    `admin-content-courses.js:371-373`, `:1096`.
  - Nye: `admin-content-courses.js:2445`/`:2468` (tredje kopi av `moduleCount > 0`), `adminCourses.ts:574-613` (#1140),
    `courseDeleteGuard.ts:81-117` (#1152), `courseRepository.ts:115-121` `findLiveModuleIds` (#934),
    `courseRepository.ts:106-112` `findModuleItemsForCourses` (#1156, tar med arkiverte moduler for «påbegynt»).
- **Privilegert (16):**
  - Tjener (5): `appeals.ts:72`, `:94`, `reviews.ts:71`, `:93`, `reporting/scope.ts:33`.
  - Klient (11): `deltakere-subnav.js:10`, `results.js:312`, `review.js:360`, `:364`, `profile.js:503`,
    `admin-content-courses.js:90-91`, `admin-content-classes.js:657-660`, `admin-content-library.js:784`, `admin-content-shell.js:5011`.
  - Nye: `admin-content-themes.js:39` og `api-client.js:175`.
- **Bestått (2):**
  - Står: `calibrationWorkspaceService.ts:275` og `result-summary.js:59`.
  - Borte: `courseReport.ts` leser nå `moduleProgress` og `isSettledSubmission`.
- **Synlig (7 likt talt, 9 i alt):**
  - Står: `discussionService.ts:111-128`, `enrollmentService.ts:442-448`, `:526-532`, `courseReminderService.ts:229-235`,
    `routes/courses.ts:536`.
  - Nye: `learnerVisibility.ts:120-194` `findLearnersSeeingCourses` (andre utgave av regelen, ingen test mot
    `filterVisibleCourseIds`) og `courseAssignmentNotice.ts:169-199` (SQL, med vilje strengere, testet).
  - Ikke talt i oktober: `myCoursesProgress.ts:44-46` og `routes/courses.ts:86-94` `/enrollments`.
  - Borte: `courseCompletionService.ts:46`, `:140`.
- **Skjema endret (7 / 12):**
  - `admin-content-shell.js:3484`, `:2827`, `:3892`, `:4123-4128`, `admin-content-settings-tab.js:1131`, `:1075`.
  - Ny: `shell.js:3068-3077` `editFormSnapshot().changed` (andre definisjon ved siden av `hasOpenEditForm` `:4040`).
  - Med alle steder også: `:4040`, `:865`, `:5088`, `:3770`, `:4578`.
- **Fullført (8):**
  - Står: `courseQueries.ts:3-9`, `courseReport.ts:455-459`, `participant.js:4795-4796`.
  - Nye: `courseReport.ts:183` (bare bevis), `weeklyDigestContent.ts:94`/`:97` (#1139), `contentLifecycle.ts:635`/`:657-660` (#1150),
    `courseDeleteGuard.ts:205-213` (#1152), `courseAssignmentNotice.ts:179-180` (#1146).
- **Lokale (4 svar / 22 steder):**
  - De 19 fra oktober står, på nye linjer.
  - Nye: `courseArchive.ts:104`, `:168` (døde) og `api-error.js:123`.
  - Utvidet telling (5 svar / 51 steder) i rapporten fra område 6: blant annet `i18n-locale.js:22`, ti `setLocale`-vakter med `"en-GB"`,
    `contentValidationService.ts` (fire `sourceLocale = "nb"`) og `schema.prisma:347`.

### Funn 2026-11-23

**Rettet siden oktober (7):**
- org-synken (#1114);
- utboksen som merket feilet e-post som levert (#1115);
- kursrapportens egen bestått-regel (#1116);
- eksport/duplisering for ikke-eiere (#1165, #1180);
- I3 i `publishCourse` og i seksjonslagringen (#1151);
- benchmark-ruta uten eierskap (#1151).

**Avklart som beslutning (4):**
- arkivert klasse (DECISIONS 2026-11-08);
- klasse tildeler uten kurseierskap (#1166);
- G3 teller andre kurs (dokumentert, nå en bekreftelse);
- `CertificationStatus` uten versjon (kjente mangler #48/#49 i DESIGN_934).

**Nye (24).** ✔ = verifisert for hånd. ❓ = trenger produkteiers avgjørelse.

| Risiko | Område | Funn |
|---|---|---|
| middels ✔ | 5 | Modulsida: «Publiser»/«Avpubliser»/«Importer» spør ikke om ulagrede endringer (`admin-content-shell.js:3790-3801`, `admin-content-publish.js:599`). Den lagrede versjonen publiseres, og rettelsen i skjemaet er borte etter omtegning. Kurs lagrer først, seksjon og klasse spør. |
| middels ✔ | 3 | «Deltakere» i toppmenyen er synlig for vurderer, ankebehandler og rapportleser, men lander på `/deltakere/klasser` (`capabilities.ts:194-205`). Klasse-API-et gir 403, og undermenyen fjerner bare lenken. |
| middels ✔ | 6 | Klientens startspråk er en-GB for «no», «da» og «sv» (`i18n-locale.js:22`). Det lagres som `preferredLocale`, og den ukentlige e-posten går ut på engelsk hver uke (oktober-funn, nå tyngre). |
| middels ✔❓ | 4 | Arkivert klasse: dialogen lover at «påminnelsene stopper», men den ukentlige e-posten tar fristen fra alle klasser, også arkiverte (`classService.ts:420-427`, `weeklyDigestContent.ts:99`, `:109`). Det gir «Fristen har gått ut» hver mandag, og en tidligere frist fra den arkiverte klassen slår en senere aktiv. |
| middels ❓ | 1 | «Har deltakeren bestått modulen?» har fire regler etter svar f (se trenden). Kursrapporten sier bestått, modulrapportene sier `FAILED`, `/recertification` sier `NOT_CERTIFIED`, og profilen viser modulen som bestått, alt for samme person. |
| middels ❓ | 4 | Ny hovedversjon pluss ny frist: «frivillig til noen setter en ny frist» (DESIGN_934) er ikke bygget. Ethvert bevis gir COMPLETED for alltid. Tildelings-e-posten sier «nytt kurs», Status sier «Fullført», og Resultater sier «Må ta ny versjon». |
| middels ❓ | 2 | Kursbyggeren tilbyr upubliserte seksjoner til et publisert kurs, og lagringen godtar dem, men «Publiser utkastet» avviser dem (`adminCourses.ts:599-602`). Valgt under #1140, mot PO-beslutningen 2026-08-23. Importen (`updateExisting`) legger dem rett inn. |
| middels | 5 | Kriterier som legges til, fjernes eller genereres på nytt i Innstillinger, vises ikke som ulagret. Lukkes fanen, kommer ingen advarsel (`admin-content-criteria.js:111-150`, `form-page.js:233`). |
| lav–middels | 4 | E-posten om ny hovedversjon sjekker ikke om deltakeren fortsatt ser kurset (`courseMajorVersionEmail.ts:63-73`). Lenken gir 404. |
| lav–middels | 6 | Vakta fra #984 ser bare én skrivemåte. 8 rutesteder har egen reserve (`courses.ts:49` m.fl.), og `?locale=nb-NO` gir fortsatt 500. |
| lav–middels | 6 | Paritetstest finnes for 3 av 12 oversettelsestabeller. Ankebehandlerens tabell mangler fortsatt 64 nøkler på nb og nn. |
| lav–middels | 2 | Klienten skjuler «Publiser» for kurs uten moduler; tjeneren og #1001 tillater rene lesekurs (tre klientkopier). |
| lav | 1–6 | 12 til: Kalibreringens roller hardkodet to steder; `MODULE_ADMIN_READERS` lover mer enn brukerne får; rollevakta ser ikke `(roles ?? []).includes(`; org-synk-dokumentasjonen beskriver `merge_by_email`; dokumentasjon om `SUPERSEDED`-regelen som ble fjernet i 2.146.0; vakta mot nedgradering stanser alltid et stryk på samme innlevering; datakvalitetsrapporten flagger flervalgsvedtak; `completedSubmissionStatuses` uten leser; «fullført uten bevis» regnes ulikt ved arkivering og sletting; rå ACS-tekst ved «Send til meg»; to definisjoner av «skjemaet er endret»; utdaterte kommentarer (`participant.js:5615`, `courseArchive.ts:172`, `unsavedTabSwitchKind`) |

**Fra oktober, fortsatt åpne (17):**
- **Middels:**
  - «Rydd upubliserte» (delvis; fortsatt på tvers av eiere);
  - terskelkalibreringen over et ulagret utkast;
  - importerte brukere uten lagret rolle;
  - fristen i påminnelsene mot Status-siden (nå tre regler med den ukentlige e-posten);
  - datofilteret som viser sertifiserte som «Ikke startet»;
  - rå servertekst i deltakerflaten (2 steder);
  - modulredigereren lagrer reservespråket;
  - seksjonsredigereren og rene strenger (fem klientkopier, én svarer feil).
- **❓:**
  - Status mot Resultater;
  - forfalt-e-posten én gang for alltid;
  - publisert kurs med upublisert seksjon (se N1 over).
- **Lav:**
  - vurderingsvinduet tre steder;
  - agent-token ved rolleendring;
  - Resultater leser rolle fra et felt;
  - død «utilgjengelig»-gren;
  - startspråket (over);
  - `nb-NO` (over).

### Steder 2026-10-21

- **Kursinnhold (9):** `src/routes/courses.ts:85`, `:260`, `courseCompletionService.ts:52`,
  `courseReport.ts:145`, `:238` (fem egne filtre på arkiverte moduler — aksessorene `findCourseById`,
  `findPublishedCourses*` filtrerer ikke) · `courseRepository.ts:123` (`listCourses` teller arkiverte) ·
  `courseCommands.ts:412` (unntak, #992) · `admin-content-courses.js:367`, `:1339`.
- **Privilegert (14):** tjener `routes/appeals.ts:72`, `:94`, `routes/reviews.ts:71`, `:93`
  (`(roles ?? []).includes(` — `role-set-guard.test.js` ser ikke den formen), `reporting/scope.ts:33` ·
  klient `deltakere-subnav.js:10`, `results.js:311`, `review.js:360`, `:364`, `profile.js:375`,
  `admin-content-courses.js:85`, `admin-content-classes.js:566`, `admin-content-library.js:731`,
  `admin-content-shell.js:4486`.
- **Bestått (3):** `courseReport.ts:367-371` (svarteliste `=== "UNDER_REVIEW"`, og vedtaket i stedet for
  `CertificationStatus`) · `calibrationWorkspaceService.ts:275` (`!== "UNDER_REVIEW"`) ·
  `public/static/result-summary.js:59` (tredje kopi av avgjorte statuser).
- **Synlig (7):** `discussionService.ts:111`, `enrollmentService.ts:363`, `:422`,
  `courseReminderService.ts:233`, `routes/courses.ts:538` (selvinnmelding, dokumentert),
  `courseCompletionService.ts:46`, `:140`.
- **Skjema endret (7):** `admin-content-shell.js:3113` (`moduleDirtyKind`), `:3515`, `:2809`, `:3367`,
  `:3601`, `admin-content-settings-tab.js:1021`, `:1076`.
- **Fullført (3):** `courseQueries.ts:5` `computeCourseStatus` (brukt av `routes/courses.ts:103`, `:379`),
  `courseReport.ts:388`, `participant.js:3637` `isCourseCompleted`.
- **Lokale (4 svar / 19 steder):** svar `"en-GB"`, `"nb"`, `env.DEFAULT_LOCALE`, `sourceLocale = "nb"`.
  Ruter `routes/courses.ts:40`, `:166`, `:197`, `:240`, `:429` (`?? "en-GB"`), `adminPlatform.ts:135`,
  `cohortStatus.ts:23` (`?? "nb"`), `adminContent.ts:252`, `:1063`; read-modeller og tjenester
  `appealReadModels.ts:36`, `manualReviewReadModels.ts:58`, `submissionReadModels.ts:113`,
  `appealService.ts:124`, `calibrationWorkspaceService.ts:382`, `manualReviewService.ts:38`,
  `contentBlocks.ts:340-346`; klient `admin-content-calibration.js:32`, `toast.js:25`, `workspace-help.js:60`.

### Funn 2026-10-21

Risiko · område · tittel. ✔ = verifisert for hånd. ❓ = trenger produkteiers avgjørelse (ikke en defekt
før det er avgjort; hører i `DECISIONS.md` når det er bestemt).

| Risiko | Område | Funn |
|---|---|---|
| høy ✔ | 3 | Org-synken (`orgSyncService.ts:128-163`) sjekker ikke `isAnonymized` og skriver navn, e-post og `activeStatus` tilbake på en pseudonymisert bruker; standard `merge_by_email` kobler identitet på e-post, som påloggingen nekter (#386) |
| høy ✔ | 4 | Utboksen merker en feilet e-post som levert: `notifyAssessmentResult`/`notifyAppealStatusTransition` kaster ikke ved `delivered:false` — resultat-/ankevarsel går tapt; tidsfrist 20 s mot ACS' 30 s kan gi dobbel e-post |
| høy ✔ | 1, 4 | Kursrapporten har egen bestått-regel (`courseReport.ts:362-372`): svarteliste og vedtak i stedet for `CertificationStatus` — etter en revisjon (#997) viser detaljen «Fullført» der bevisporten nekter |
| middels–høy ✔ | 2 | «Rydd upubliserte» sletter alle moduler uten aktiv versjon som ikke er arkivert, ikke i kurs og uten innleveringer — også en fagansvarligs utkast med versjoner og avpubliserte moduler, på tvers av eiere; enkeltsletting nekter derimot en arkivert modul med versjoner |
| middels ✔ | 6 | Ankebehandlerens tabell (`appeal-handler-translations.js`) har 90 nøkler på en-GB, 26 på nb og nn — detaljpanelet og valideringen står på engelsk; ingen paritetstest |
| middels | 1 | Bestått-vedtak på en gammel versjon etter revisjon gjør deltakeren bestått igjen (`certificationStatusService.ts:47-49`) |
| middels | 2 | Terskelkalibrering publiserer en kopi av den aktive versjonen over et ulagret utkast (`adminContentCommands.ts:1220-1296`) |
| middels | 3 | Arkivert klasse gir fortsatt synlighet og frist, men telles ikke og gir ikke påminnelser (`classRepository.ts:103-105`) |
| middels | 3 | Importerte brukere (#690) uten lagret deltakerrolle får ikke påminnelser for «Alle deltakere» |
| middels | 3 | Kurs kan tildeles via klasse uten kurseierskap, men ikke enkeltvis (`adminClasses.ts:173` mot `adminCourses.ts:630`) |
| middels | 4 | Påminnelsesjobben og Status-siden velger ulik frist for samme person; «forfalt» på fristdagen regnes ulikt (UTC-midnatt) |
| middels | 4 | Detaljvisning med datofilter viser en sertifisert deltaker som «Ikke startet» |
| middels | 5 | Eksport/duplisering for ikke-eiere: tre regler i tre lister, i strid med beslutningen 2026-09-08 |
| middels | 5 | Modulimport og gjenoppretting ser ikke et åpent redigeringsskjema — ulagrede endringer forsvinner |
| middels | 5 | Deltakerflaten viser fortsatt rå servertekst når feilen mangler kode (`participant.js:1847-1862`) — ned fra 40+ til 2 steder |
| middels | 6 | Modulredigereren fyller felt med reservespråket og lagrer det som målspråket; seksjonsredigereren legger en ren streng under visningsspråket i stedet for nb (#892) — må verifiseres ved kjøring |
| middels | 6 | Klientens startspråk faller til en-GB, ikke organisasjonens nb — gir engelske e-poster til brukere med «no»/«da»/«sv» |
| ❓ | 1 | Et nytt forsøk som stryker, tar fra deltakeren en bestått modul («bestått forblir bestått» mot «bare siste forsøk teller») |
| ❓ | 2 | Kan et publisert kurs inneholde en upublisert seksjon? Ja (byggeren), nei (publiseringskaskaden), nei og kurset tas ned (import) |
| ❓ | 4 | Status-siden og Resultater teller ulike personer; kommentaren sier de er like |
| ❓ | 4 | Forfalt-e-posten sendes én gang per person og kurs, for alltid (også etter forlenget frist) |
| lav | 1–6 | 19 til: vurderingsvindu regnet to steder, utdaterte kommentarer (fraseliste, «minst én modul», `outstandingBeforeFinish`), I3 mangler i `publishCourse`/`updateSectionContent`, G3-vakta teller andre kurs, benchmark-ruta uten eierskap, agent-token trekkes ikke ved app-rolleendring, analyserapportene teller per forsøk, `?locale=nb-NO` gir 500, 422-begrunnelsen vises bare på seksjonssiden, Resultater leser rolle fra forhåndsutfylt felt, død «utilgjengelig»-gren |

Rammereglene (`contentBlocks.ts`, `frame-structure.mjs`, `produce-course.mjs`) er sammenlignet regel for
regel uten avvik; vakta fra 2.98.0 stopper en ny ramme som bare legges ett sted.

## Slik kjøres den

Seks agenter, ett område hver, samme leteinstruks. Kjør dem parallelt — de rører ikke hverandres
filer, og en samlet kjøring tar under ti minutter.

### Områdene

1. **Vurdering og poenggiving** — `src/modules/assessment/`, `src/modules/submission/`, `CertificationStatus`
2. **Modul- og innholdslivssyklus** — `src/modules/adminContent/`, publiseringsgater, `contentLifecycle.ts`
3. **Autorisasjon, roller, eierskap** — `src/auth/`, `contentOwnershipService.ts`, rollesjekker i `src/routes/`
4. **Varsling, rapport og kull** — påminnelser, `cohortStatusService.ts`, `courseReport.ts`, outbox
5. **Frontend-tilstand** — `public/participant.js`, `admin-content-*.js`, CSS-en i `participant.html`
6. **Lokalisering på tvers** — begge lag, `#892`-invarianten, nn-tabellene

### De seks mønstrene

Rekkefølgen er prioriteringen. Hvert mønster har et bevis fra første kjøring — ta dem med i
prompten, de gjør instruksen konkret i stedet for abstrakt.

| # | Mønster | Beviset fra 2026-08-21 |
|---|---|---|
| 1 | **Divergerende definisjoner** — samme spørsmål besvart flere steder med ulike regler | Porten filtrerer arkiverte seksjoner, kurskortet gjør det ikke (#938) |
| 2 | **Ueid policy** — aksessor som returnerer alt og overlater filtreringen til kallerne | `findCourseItems` henter `archivedAt` og filtrerer ingenting — 8 kallere, 5 regler |
| 3 | **Lag på lag** — en fiks oppå en fiks | `markFinalSectionReadSilently` som nødløsning for en manglende knapp |
| 4 | **Redundante eller unåbare vakter** | Tre innganger til bevisporten, hvorav en sveip begrunnet med at hendelsene «can miss» |
| 5 | **Servertekst vist rått** | 40+ kallere dumper hele JSON-kroppen i grensesnittet |
| 6 | **Løfter som ikke holdes** — kommentar eller felt som lover noe koden ikke gjør | `wrapped`-feltet som ble satt og aldri lest |

### Kravet til hvert funn

- **fil:linje for HVERT sted regelen er implementert.** «Dette finnes flere steder» uten liste er verdiløst
- **et konkret scenario** der uenigheten gir feil resultat for en bruker. Ingen funn uten dette
- **risiko** — høy / middels / lav

Maks 8 funn per område. Få og godt belagte slår mange svake.

## Etterarbeidet — dette er halve verdien

**1 · Verifiser de tyngste funnene selv.** Agentene leser koden, de kjører den ikke. Første kjøring
hadde ett funn som var feil: `EXPIRED` teller som bestått ble meldt som en bug, men er et bevisst
valg i #820. Det er en **udokumentert beslutning**, ikke en defekt — og forskjellen avgjør hva man
skal gjøre med den.

**2 · Skill defekt fra beslutning.** Alt som viser seg å være et valg hører hjemme i
`doc/DECISIONS.md`, ikke i en feilrapport.

**3 · Oppdater datoen og loggen over.** Det er «resetten»: uten den vet ingen når neste forfaller,
og uten funn-tallet finnes ingen trend.

## Når den forfaller

`scripts/ai-qa.ps1` leser datoen over og sier fra når skanningen er over en måned gammel. Den
**blokkerer ikke** — en forfalt skanning er ikke en grunn til å stoppe en deploy, bare til å vite det.

Porten kjøres uansett foran hver stage-deploy, så påminnelsen kommer der man allerede ser etter.
Det er med vilje: en rutine som krever sin egen rituelle sjekk blir ikke utført.
