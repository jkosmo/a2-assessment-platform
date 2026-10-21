# Kompleksitetsskanning

Månedlig måling av om kodebasen samler opp slitasje. Mekanisme 4 i kompleksitetsbremsen.

> **Sist kjørt: 2026-10-21** · neste forfaller **2026-11-21**

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

**Trenden** — steder som SELV avgjør svaret (et kall til den kanoniske funksjonen teller ikke):

| Spørsmål | 2026-08-21 | 2026-10-21 | Kanonisk funksjon |
|---|---|---|---|
| Hva inneholder dette kurset? | 25 | **9** | `findCourseItemsForParticipant` / `findAllCourseItems` + `sectionAvailability.ts`; klient `participant-console-state.js` |
| Er brukeren privilegert nok? | 12 | **14** (tjener 5, klient 9) | `roleSets.ts` `hasAnyRole`, `capabilities.ts` `rolesFor` |
| Er dette forsøket bestått? | 8 | **3** | `submissionOutcome.ts` `isSettledSubmission` + siste vedtak; klient `outcome.js` |
| Er kurset synlig for deltakeren? | 8 | **7** | `enrollmentService` `filterVisibleCourseIds` / `isCourseVisibleToUser` |
| Er skjemaet endret? | 5 | **7** | `form-page.js` `state.dirty` / `markDirty` |
| Er kurset fullført? | 5 | **3** | `CourseCompletion`-raden (`enrollmentService.deriveStatus`) |
| Hvilken lokale gjelder nå? | 4 svar | **4 svar** (19 steder) | `requestLocale.ts`, `recipientLocale.ts`; klient `i18n-locale.js` |

⚠️ Nullpunktet listet ikke stedene, så august-tallene er talt på en ukjent måte. «Privilegert» er trolig
talt bare på tjeneren i august (da: 12 → 5). «Lokale» i august var antall ulike *svar* (reserver), ikke
steder. Fra 2026-10-21 står hvert sted under, så neste måned kan telle likt.

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
