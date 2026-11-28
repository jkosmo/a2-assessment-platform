# #1169 skive 4b — «Dupliser kurs»

Status: plan 28.11.2026, før bygging. Avgjørelsen er tatt (doc/DECISIONS.md, «Handlinger og merker i hoder og rader», punkt 2):
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
| `sortOrder` | tomt | En fast plass i «Mine kurs» er et valg for et publisert kurs, ikke noe en kopi arver. |
| `slug`, `publishedAt`, `archivedAt` | tomme | Kopien er upublisert. En slug ville gjort kurset «noen gang publisert» (`isCourseEverPublished`). |
| `versionMajor`/`versionMinor`, `contentRevision` | 1.0 og 0 (standard) | Kopien har ingen historikk; v3.2 uten `CourseVersion`-rader og kursbevis ville vært oppdiktet. |

**Ikke med:** eierne (den som kopierer blir eneste eier, `createCourse`), utkastet (#1140), `CourseVersion`, klasser og tildelinger
(`CourseGroupAssignment`), påmeldinger (`CourseEnrollment`), kursbevis (`CourseCompletion`), varsler, diskusjoner og lesinger.

**Utkastet:** kopien lages av kursets **lagrede elementer** (`CourseItem`), ikke av et utkast som venter (#1140). For et publisert
kurs er det det deltakerne ser. Klienten sier det i bekreftelsen når kilden har et utkast: «Kopien lages av det som er publisert.
Utkastet blir ikke med.» Å lese utkastet ville kreve en ny leser av `courseDraft.ts`, som vakta `course-draft-guard` holder liste
over, og det er ikke verdt det for en kopi.

**Modulkravet** (`CourseModuleRequirement.minModuleMajor`): `setCourseItems` setter det til modulens nåværende hovedversjon, som for
ethvert nytt kurs. Har kilden valgt «mindre» da en modul fikk ny hovedversjon, har kilden et lavere krav enn kopien; da teller et
gammelt bestått i kilden, men ikke i kopien. Planen tar dette som riktig for et nytt kurs og kopierer ikke kildens krav (det ville
trengt en ny skriver i `moduleVersioning.ts`). `shownModuleMajor` skrives ikke (vakta `participant-module-version-guard`).

## 2. Tjeneren

**Rute:** `POST /api/admin/content/courses/:courseId/duplicate` i `src/routes/adminCourses.ts`, med `idempotency("courses.duplicate")`
(to klikk gir ett kurs). Ingen `requireContentOwnership`. Rollevakta for admin-content gjelder (ADMINISTRATOR, SUBJECT_MATTER_OWNER).
Ikke i agent-tokenets liste (`agentTokenScope.ts`).

- Tom kropp. Svar `201 { course, links }`, som `POST /courses`.
- `404 course_not_found` når kilden ikke finnes.
- `409 course_archived` for et arkivert kurs (tjeneren nekter, ikke bare klienten — bedre enn #1151 for modul og seksjon, der
  tjeneren ikke kan skille en kopi fra en import).
- Er et av elementene arkivert (et gjenopprettet kurs der elementene ble liggende i arkivet), feiler `setCourseItems` med
  `course_item_archived` og `details.itemType`, og **ingenting** er laget (én transaksjon). Klienten viser grunnen.

**Tjenesten:** `duplicateCourse(sourceCourseId, actorId)` i `src/modules/course/courseCommands.ts` (ved `createCourse`), i
`runContentWrite`:
1. Les kilden (`course`) og elementene (`findAllCourseItems`) og temaene (`findThemeIdsForCourse`).
2. `createCourse({ title med (kopi), description, certificationLevel, discussionsEnabled, discussionOwnerNotifications, themeIds,
   createdBy: actorId }, tx)` — den eneste opprettelsesveien (vakta `new-course-default-guard-1164`). Gir RESTRICTED, eieren og
   `course_created`.
3. `setCourseItems(newId, items, { actorId, revision: … }, tx)` — `assertContentUsableInCourse`, `syncModuleRequirements`,
   `course_items_updated`. Revisjonen: et nytt kurs har 0; samme mønster som importen (`contentImportService.ts`, `createCourse` +
   elementer i samme transaksjon).
4. Revisjonslogg `course_duplicated { courseId, sourceCourseId, itemCount }` (ny handling i `auditEvents.ts`).

## 3. Klienten

- **Kurslista:** «Dupliser» under «Mer» etter «Døp om» (når den kommer) og før «Eksporter». For alle som ser kurset, ikke for et
  arkivert.
- **Kursets hode:** «Dupliser» først under «Mer» (Dupliser · Eksporter · Forkast utkast · Avpubliser · Arkiver). Spør om ulagrede
  endringer først (som Publiser), siden kopien lages av det lagrede.
- **Bekreftelse:** sidas egen dialog (#1168, ikke nettleserens): «Dupliser «{navn}»? Kopien får de samme modulene og seksjonene —
  en endring i en modul gjelder begge kursene. Klasser, tildelinger og kursbevis blir ikke med. Kopien er ikke publisert.» Med
  utkast: linja om utkastet over.
- **Etterpå:** arbeidsdialogen «Lager kopien …» mens ruta går, så åpnes kopien (`/admin-content/courses/:nyId`) med meldingen «Kopi
  av «{navn}» opprettet.» (`queueToast`). Fokus og historikk: åpne kopien med vanlig navigering (lista er siden man kom fra).
- Feil: `apiErrorToast` med koden oversatt (`course_archived`, `course_item_archived`).

## 4. Følger av at innholdet deles (avgjørelsen, sagt rett ut)

- **Kursbevis:** et bestått i en modul og en lest seksjon teller i alle kurs som har dem. Når kopien er publisert og en deltaker får
  se den, kan hen få kursbevis for kopien med en gang, uten å gjøre noe nytt. Kursbevis kan ikke trekkes tilbake. Dette følger av
  at innholdet deles, og skjer bare når kopien publiseres og tildeles.
- **Bruksvakta:** så lenge kopien finnes (også som utkast), er de delte modulene og seksjonene «i bruk» i ett kurs til. Eieren av en
  modul kan ikke avpublisere eller arkivere den mens kopien har den (`content_in_use`), også når kopien tilhører en annen.
  «Brukt i kurs» teller den.
- **Versjoner:** en modul publisert på nytt gir mindre versjon også i kopien (når den er publisert), og en hovedversjon lister
  kopien blant kursene som berøres.
- **Arkivering og sletting:** arkiveres ett av kursene, blir de delte elementene stående (de er i bruk i det andre). Sletting med
  innhold (#762) sletter aldri et delt element.

## 5. Tester

- **Integrasjon** (`test/m2-course-duplicate-1169.test.ts`, gjennom ruta): kopien har samme elementer i samme rekkefølge og samme
  `discussionsEnabled`; « (kopi)» på hvert språk; RESTRICTED, upublisert, v1.0, ingen slug, `sortOrder` tomt; temaene med; den som
  kopierer er eneste eier; ingen klasser, påmeldinger, kursbevis eller `CourseVersion`-rader; kilden er urørt (elementer, eiere,
  revisjon). En annen produsent kan duplisere (kontroll: en deltaker kan ikke). Arkivert kilde → `409 course_archived`, ingenting
  laget. Et arkivert element → `course_item_archived`, ingenting laget (tell kursene før og etter). Idempotens: samme nøkkel gir
  ett kurs. 404 for et kurs som ikke finnes. Revisjonsloggen har `course_duplicated` med kilden.
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

**Veier inn:** kurs opprettes bare gjennom `createCourse` (vakt); elementer skrives bare gjennom `setCourseItems`/`writeCourseItems`
(vaktene `course-archive-entry-guard`, `content-lock-write-guard`); kildens elementer leses bare med `findAllCourseItems`
(`course-items-accessor-guard`). Den nye ruta er den eneste veien til en kopi; agent-tokenet når den ikke. `archived-is-readonly-guard`
får den nye skriveren oppført som «nytt element».

**Samtidighet:** to klikk → `idempotency("courses.duplicate")` gir ett kurs. Kilden endres mens kopien lages → kopien leses inne i
`runContentWrite` (innholdslåsen), så den ser enten før eller etter lagringen, aldri halvparten. Kilden arkiveres i samme øyeblikk →
låsen serialiserer: arkivert først gir `409 course_archived`; kopien først gir en kopi av et kurs som så arkiveres (riktig).

**Gammel og ny:** en gammel fane har ingen Dupliser-knapp. En ny klient mot en gammel tjener (under utrulling) får 404 på ruta, og
`apiErrorToast` viser feilen; ingenting er laget. Ingen migrering (revisjonshandlingen er en streng). Ruta er ny og additiv. Klient
og tjener rulles ut sammen (deploy-app).

**Alvorlighetsregel for gjennomgangen:** NO-GO er det som er sannsynlig i vanlig bruk og gjør reell skade, eller sjeldent men
alvorlig og vanskelig å rette. Resten føres som kjent mangel. Avgjørelsene i § 4 (delt innhold og følgene av det) er produkteierens
og er ikke funn.
