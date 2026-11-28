# #1169 skive 4b — «Dupliser kurs»

Status: plan 28.11.2026, lest av en uavhengig agent samme dag (ingen blokkere; ti rettelser lagt inn, merket «Planlesing»). Bygget i 2.191.0; «Døp om» for kurs (§ 6) gjenstår. Avgjørelsen er tatt (doc/DECISIONS.md, «Handlinger og merker i hoder og rader», punkt 2):
kopien er et **nytt kurs med de samme modulene og seksjonene**, ikke kopier av dem, og tar ikke med klasser, tildelinger eller
kursbevis. Kartleggingen bak planen: modellen, opprettelsen, de to dupliseringene som finnes (modul, seksjon) og vaktene.

## Kort fortalt

- Ny rute `POST /api/admin/content/courses/:courseId/duplicate`. Tjeneren lager kopien i én transaksjon: `createCourse`, så
  `setCourseItems` med kildens elementer i samme rekkefølge. Ingen eierskapsvakt (å lese kilden er åpent for alle produsenter,
  #1165, og kopien eies av den som kopierer), som for modul og seksjon.
- Kopien er et upublisert kurs på v1.0, begrenset («Bare for de som er tildelt»), med « (kopi)» på navnet i hvert språk.
- «Dupliser» i kursets rad og hode, under «Mer» (Døp om · Dupliser · Eksporter · …), også for den som ikke eier kurset. Ikke for et
  arkivert kurs (tjeneren nekter også). Etterpå åpnes kopien.
- «Døp om» for kurs tas i en egen, liten skive (4c) etter denne. Se § 6.

## 1. Hva kopien får

| Fra kilden | I kopien | Hvorfor |
|---|---|---|
| `title` | kopiert, « (kopi)» på hvert språk som har tekst | Som modul og seksjon (`content-duplicate.js`). Publiseringsporten (#1178) ser samme fullstendighet som i kilden. |
| `description`, `certificationLevel` | kopiert | Innhold og innstilling. |
| `discussionsEnabled`, `discussionOwnerNotifications` | kopiert | Innstillinger. Varslene går til kopiens eiere, det vil si den som kopierte. |
| temaene (`CourseThemeAssignment`) | kopiert, gjennom `createCourse({ themeIds })` | De grupperer kurs i «Mine kurs»; et kopiert kurs hører til samme sted. |
| elementene (`CourseItem`) | nye rader med **de samme** `moduleId`/`sectionId`, samme rekkefølge, samme `discussionsEnabled` | Avgjørelsen. Lest med `findAllCourseItems`, skrevet med `setCourseItems` (vaktene krever det). |
| `enrollmentPolicy` | **RESTRICTED** (`NEW_COURSE_ENROLLMENT_POLICY`) | Som et nytt kurs og «Importer som nytt kurs» (doc/DECISIONS.md, #1164). |
| `sortOrder` | tomt | En fast plass i «Mine kurs» er et valg for et publisert kurs, ikke noe en kopi arver. Bevisst forskjell fra «Importer som nytt kurs», som tar den fra fila. |
| `slug`, `publishedAt`, `archivedAt` | tomme | Kopien er upublisert. En slug ville gjort kurset «noen gang publisert» (`isCourseEverPublished`). |
| `versionMajor`/`versionMinor` | 1.0 (standard) | Kopien har ingen historikk; v3.2 uten `CourseVersion`-rader og kursbevis ville vært oppdiktet. |
| `contentRevision` | **1** etter at elementene er skrevet (`setCourseItems` øker telleren) | Planlesing: ikke 0. Ruta leser kurset på nytt før svaret. |

**Ikke med:** eierne (den som kopierer blir eneste eier, `createCourse`), utkastet (#1140), `CourseVersion`, klasser og tildelinger
(`CourseGroupAssignment`), påmeldinger (`CourseEnrollment`), kursbevis (`CourseCompletion`), varsler, diskusjoner og lesinger.

**Utkastet:** kopien lages av kursets **lagrede elementer** (`CourseItem`), ikke av et utkast som venter (#1140). For et publisert
kurs er det det deltakerne ser. Bekreftelsen sier det alltid (lista vet ikke om et avpublisert kurs har et utkast liggende): «Kopien
lages av det som er lagret i kurset. Et utkast som ikke er publisert, blir ikke med.» Å lese utkastet ville kreve en ny leser av `courseDraft.ts`, som vakta `course-draft-guard` holder liste
over, og det er ikke verdt det for en kopi.

**Modulkravet** (`CourseModuleRequirement.minModuleMajor`): `setCourseItems` setter det til modulens nåværende hovedversjon, som for
ethvert nytt kurs. Har kilden valgt «mindre» da en modul fikk ny hovedversjon, har kilden et lavere krav enn kopien; da teller et
gammelt bestått i kilden, men ikke i kopien. Planen tar dette som riktig for et nytt kurs og kopierer ikke kildens krav (det ville
trengt en ny skriver i `moduleVersioning.ts`). `shownModuleMajor` skrives ikke (vakta `participant-module-version-guard`).

## 2. Tjeneren

**Rute:** `POST /api/admin/content/courses/:courseId/duplicate` i `src/routes/adminCourses.ts`, med
`idempotency((req) => "courses.duplicate:" + req.params.courseId)` — nøkkelen må ha kildens id (Planlesing: kroppen er tom, så
samme nøkkel for to kilder ville gitt den første kopien igjen, #906). Idempotensen virker bare når klienten sender
`Idempotency-Key`; klienten gjør det (`duplicate-<kurs>-<tid>`). Det som hindrer to klikk i klienten, er dialogene (bekreftelsen
åpnes ikke to ganger, arbeidsdialogen er modal) og en sperre. Ingen `requireContentOwnership`. Rollevakta for admin-content gjelder (ADMINISTRATOR, SUBJECT_MATTER_OWNER).
Ikke i agent-tokenets liste (`agentTokenScope.ts`).

- Tom kropp. Svar `201 { course, links }`, som `POST /courses`, med kurset lest på nytt etter elementene. `401` uten bruker (som
  `/import`).
- `404 course_not_found` når kilden ikke finnes.
- `400 course_archived` for et arkivert kurs (Planlesing: `assertNotArchived` gir `DomainRuleError`, 400) (tjeneren nekter, ikke bare klienten — bedre enn #1151 for modul og seksjon, der
  tjeneren ikke kan skille en kopi fra en import).
- Er et av elementene arkivert (et gjenopprettet kurs der elementene ble liggende i arkivet), feiler `setCourseItems` med
  `course_item_archived` og `details.itemType`, og **ingenting** er laget (én transaksjon). Klienten viser grunnen.

**Tjenesten:** `duplicateCourse(sourceCourseId, actorId)` i `src/modules/course/courseCommands.ts` (ved `createCourse`), i
`runContentWrite`:
1. Les kilden (`course`), elementene (`createCourseRepository(tx).findAllCourseItems`) og temaene (med `tx`, ikke
   `findThemeIdsForCourse`, som leser utenfor låsen). `assertNotArchived(tx, { type: "COURSE", id: sourceCourseId })` — vakta i
   `setCourseItems` ser bare det nye kurset.
2. `createCourse({ title med (kopi), description, certificationLevel, discussionsEnabled, discussionOwnerNotifications, themeIds,
   actorId }, tx)` — den eneste opprettelsesveien (vakta `new-course-default-guard-1164`). Gir RESTRICTED, eieren og
   `course_created`.
3. `setCourseItems(copy.id, items, { actorId, revision: { expected: copy.contentRevision } }, tx)` — `assertContentUsableInCourse`,
   `syncModuleRequirements`, `course_items_updated`. Eldre data med samme element to ganger gir `400 course_duplicate_item`
   (oversatt); det godtas.
4. Revisjonslogg `course_duplicated { courseId, sourceCourseId, itemCount }`: ny handling i `auditActions.course` OG typen i
   `AuditMetadataByAction` (`auditEvents.ts`). `/duplicate` føres i `FORBIDDEN` i agent-token-testen.

## 3. Klienten

- **Kurslista:** «Dupliser» under «Mer» etter «Døp om» (når den kommer) og før «Eksporter». For alle som ser kurset, ikke for et
  arkivert.
- **Kursets hode:** «Dupliser» først under «Mer» (Dupliser · Eksporter · Forkast utkast · Avpubliser · Arkiver). Spør om ulagrede
  endringer først (som Publiser), siden kopien lages av det lagrede. Planlesing: `getCourseFormPage().leaveAnswered()` rett før
  `location.href`, og en sperre som står til den nye sida har tatt over (som modulens hode i 2.190.0).
- **Begge skrivebeskyttede greiner** får Dupliser (lista `!canManage`, hodet `courseIsReadOnly()`), med egen sjekk for arkivert, og
  `"duplicate"` i `handleListTableClick` (delegert, så omtegning av hodet ikke tar lytteren).
- **Bekreftelse:** sidas egen dialog (#1168, `confirmLifecycleStep`, ren tekst): «Dupliser «{navn}»?» og «Kopien får de samme
  modulene og seksjonene, så en endring i en modul gjelder begge kursene. Klasser, tildelinger og kursbevis blir ikke med, og et
  utkast som ikke er publisert, blir ikke med. Kopien er ikke publisert.» Nye tekster i tre språk; ikke `library.duplicatedToast`
  («Full kopi»), siden denne kopien deler innholdet.
- **Etterpå:** arbeidsdialogen «Lager kopien …» mens ruta går, så åpnes kopien (`/admin-content/courses/:nyId`) med meldingen «Kopi
  av «{navn}» opprettet.» (`queueToast`). Historikk: «Tilbake» går til lista eller kildekurset, der man kom fra. Etter en feil får
  «Mer» fokuset tilbake (arbeidsdialogen lar det stå på `body`).
- Feil: `apiErrorToast` med koden oversatt (`course_archived`, `course_item_archived`).

## 4. Følger av at innholdet deles (avgjørelsen, sagt rett ut)

- **Kursbevis:** et bestått i en modul og en lest seksjon teller i alle kurs som har dem. En lest seksjon teller bare når deltakeren
  ser kurset (#1156); et bestått i en modul teller **også når hen ikke ser det** (QA-gjennomgangen 2.191.0: regelen fra #1156 gjelder
  bare seksjoner). En kopi med bare moduler gir derfor kursbevis til alle som har bestått dem, så snart den er publisert. Kursbevis
  kan ikke trekkes tilbake. Lagt fram for produkteier før prod.
- **Bruksvakta:** så lenge kopien finnes (også som utkast), er de delte modulene og seksjonene «i bruk» i ett kurs til. Eieren av en
  modul kan ikke avpublisere eller arkivere den mens kopien har den (`content_in_use`), også når kopien tilhører en annen.
  «Brukt i kurs» teller den.
- **Versjoner:** en modul publisert på nytt gir mindre versjon også i kopien (når den er publisert), og en hovedversjon lister
  kopien blant kursene som berøres.
- **Arkivering og sletting:** arkiveres ett av kursene, blir de delte elementene stående (de er i bruk i det andre). Sletting med
  innhold (#762) sletter aldri et delt element.

## 5. Tester

- **Integrasjon** (`test/m2-course-duplicate-1169.test.ts`, gjennom ruta; `contentRevision` er 1): kopien har samme elementer i samme rekkefølge og samme
  `discussionsEnabled`; « (kopi)» på hvert språk; RESTRICTED, upublisert, v1.0, ingen slug, `sortOrder` tomt; temaene med; den som
  kopierer er eneste eier; ingen klasser, påmeldinger, kursbevis eller `CourseVersion`-rader; kilden er urørt (elementer, eiere,
  revisjon). En annen produsent kan duplisere (kontroll: en deltaker kan ikke). Arkivert kilde → `400 course_archived`, ingenting
  laget. Et arkivert element → `course_item_archived`, ingenting laget (tell kursene før og etter). Idempotens: samme nøkkel gir
  ett kurs, og samme nøkkel for to ulike kilder gir to kopier. 404 for et kurs som ikke finnes. Revisjonsloggen har `course_duplicated` med kilden.
- **Eldre e2e som må følge den nye rekkefølgen:** `header-slots-1169` (kurs publisert og annens), `row-slots-1169` (k-pub, k-utk,
  k-annen), `admin-content-readonly-others-1165` (kurs `["export"]`), `admin-content-course-draft-1140` (rekkefølgen i «Mer»).
- **E2e:** raden og hodet har «Dupliser» på riktig plass; dialogen sier det i § 3; etter ja åpnes kopien; arkivert kurs har ingen
  Dupliser; en annens kurs har Dupliser · Eksporter.
- **Mutasjoner:** at elementene kopieres (ikke tom liste), rekkefølgen, RESTRICTED, ingen slug, eieren, arkivert-vakta,
  transaksjonen (et feilende element lar ingenting stå igjen).

## 6. «Døp om» for kurs (skive 4c, egen plan-linje)

Modul og seksjon har «Døp om» i lista. For kurs må det følge #1140: et **publisert** kurs endres gjennom utkastet. Forslaget: for et
kurs som aldri er publisert, skriver «Døp om» navnet rett (`PUT /courses/:id` med `expectedRevision`); for et publisert kurs legges
navnet i utkastet (`PUT …/draft`), og meldingen sier at navnet er et utkast til det publiseres — som seksjonen (#1163). Lista mangler
`contentRevision` og utkastets teller; enten tar lista dem med, eller «Døp om» henter kursdetaljen først. Dette er nok til å trenge
egen gjennomgang, og bygges etter 4b.

## 7. Veier inn, samtidighet og utrulling

**Dokumentasjon:** `doc/API_REFERENCE.md` (ruta), `doc/FEATURE_SURFACE_MAP.md` (raden «Dupliser kurs | finnes ikke» blir en vei
inn; raden «Dupliser modul/seksjon» utvides), `doc/roles/admin-content.md` (hvordan, og følgene i § 4), VERSIONS. Kjent følge: en
kopi som publiseres før den får nytt navn, får « (kopi)» i delingslenka for godt (slug settes ved første publisering).

**Veier inn:** kurs opprettes bare gjennom `createCourse` (vakt); elementer skrives bare gjennom `setCourseItems`/`writeCourseItems`
(vaktene `course-archive-entry-guard`, `content-lock-write-guard`); kildens elementer leses bare med `findAllCourseItems`
(`course-items-accessor-guard`). Den nye ruta er den eneste veien til en kopi; agent-tokenet når den ikke. `duplicateCourse` skriver
ikke selv (bare gjennom `createCourse`/`setCourseItems`/revisjonsloggen), så `archived-is-readonly-guard` får **ingen** ny linje
(Planlesing: en linje uten skrivested gjør vakta rød). Ordet for utkastet nevnes ikke i den nye koden (`course-draft-guard`).

**Samtidighet:** to klikk → `idempotency("courses.duplicate")` gir ett kurs. Kilden endres mens kopien lages → kopien leses inne i
`runContentWrite` (innholdslåsen), så den ser enten før eller etter lagringen, aldri halvparten. Kilden arkiveres i samme øyeblikk →
låsen serialiserer: arkivert først gir `400 course_archived`; kopien først gir en kopi av et kurs som så arkiveres (riktig).

**Låsen:** arkiveres kilden først, får kopien `400 course_archived`. Kommer kopien først, finner en arkivering som venter (med
forhåndsvisning av elementer som «følger med»), at de nå er delt, og får `409 course_archive_preview_changed` — dialogen tegnes
på nytt (eksisterende, riktig).

**Gammel og ny:** en gammel fane har ingen Dupliser-knapp. En ny klient mot en gammel tjener (under utrulling) får 404 på ruta, og
`apiErrorToast` viser feilen; ingenting er laget. Ingen migrering (revisjonshandlingen er en streng). Ruta er ny og additiv. Klient
og tjener rulles ut sammen (deploy-app).

**Alvorlighetsregel for gjennomgangen:** NO-GO er det som er sannsynlig i vanlig bruk og gjør reell skade, eller sjeldent men
alvorlig og vanskelig å rette. Resten føres som kjent mangel. Avgjørelsene i § 4 (delt innhold og følgene av det) er produkteierens
og er ikke funn.
