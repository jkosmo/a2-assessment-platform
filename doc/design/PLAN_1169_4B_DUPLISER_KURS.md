# #1169 skive 4b — «Dupliser kurs»

Status: plan 28.11.2026, lest av en uavhengig agent samme dag (ingen blokkere; ti rettelser lagt inn, merket «Planlesing»). Bygget i 2.191.0; «Døp om» for kurs (§ 6) bygget i 2.192.0. Avgjørelsen er tatt (doc/DECISIONS.md, «Handlinger og merker i hoder og rader», punkt 2):
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

## 6. «Døp om» for kurs (skive 4c)

**Avgjort av produkteier 28.11.2026** («OK»): et publisert kurs får det nye navnet i utkastet, slik seksjonen (#1163) og kursets
utkast fra #1140. Et kurs som ikke er publisert, får navnet med en gang.

**Tjeneren: én ny rute,** `PATCH /api/admin/content/courses/:courseId/title` (eiervakta `requireContentOwnership`, som `PUT`).
Kroppen: `{ title: { nb, nn, en-GB }, expectedTitle }`. `title` er HELE språkkartet (lista slår sammen, som for seksjoner);
`expectedTitle` er den lagrede teksten raden viste i redigeringen. Funksjonen `renameCourse` (courseDraft.ts):

1. Kurset finnes ikke: `404`. Arkivert: `400 course_archived` (`assertNotArchived`).
2. Arbeidstittelen er utkastets tittel når et utkast finnes, ellers kursets. Er den ikke lik `expectedTitle`, har noen endret navnet
   siden lista ble lastet: `409 course_changed`, og ingenting er skrevet.
3. **Publisert kurs:** navnet skrives i utkastet med den vanlige lagringen (`saveCourseDraft`, samme sjekker og revisjonslogg).
   Finnes et utkast, får det ny tittel, og resten står. Finnes ikke et, lages et med bare `title` og kursets elementer slik de er
   (utkastet er delvis; visningen fyller resten fra kurset, `courseDraftView`). Når utkastet publiseres, endres bare navnet.
   `loaded` er det funksjonen leste: `{ draftId, revision }` eller `{ expectedRevision: contentRevision }`, så en lagring imellom gir
   `409` fra `saveCourseDraft`.
4. **Ikke publisert:** `updateCourse(courseId, { title }, actor, { expectedRevision: contentRevision })`, som skjemaets lagring.
   Et upublisert kurs med utkast (avpublisert etter at utkastet ble lagret) avvises av den vanlige vakta (`course_has_draft`),
   som i skjemaet.
5. Svaret: `{ renamedIn: "draft" | "course" }`. Revisjonsloggen: `course_draft_saved` eller `course_updated`, som før.

**Lista** får to felt per kurs: `draftTitle` (utkastets tittel, lagret tekst, bare når et utkast har en) og `title` som før.
Redigeringen starter fra `draftTitle ?? title`, så den som døper om, ser navnet som blir publisert.

**Klienten:** «Døp om» først i «Mer» i kurslista, for eieren, ikke for et arkivert kurs (som modul og seksjon). Samme felles
redigering i raden (`list-rename.js`, `startOmdoping`): Enter lagrer på språket lista viser, Escape avbryter. Meldingen: i utkastet
«Navnet er lagret i utkastet. Det vises for deltakerne når du publiserer utkastet.»; ellers den vanlige «Navnet er lagret».
`409 course_changed` tegner lista på nytt. Ikke i hodet: der endres navnet i skjemaet.

**Etter planlesingen (uavhengig agent 28.11.2026, ingen blokkere):**
- **Elementene i et nytt utkast bærer `discussionsEnabled`.** Publiseringen skriver `item.discussionsEnabled ?? true`, og
  rekkefølgen ser ikke på flagget: et utkast med bare id-er ville slått på diskusjonen igjen der den var av, uten varsel. Samme
  omforming som «Dupliser kurs» bruker, flyttes til én funksjon (`courseItemInputsFromRows`) og brukes begge steder.
- **Uendret navn skriver ingenting** (som seksjonen): ellers lager Enter på et publisert kurs et utkast med bare tittelen, og
  kurset står med «Nyere utkast» og stengt for andre lagringer til noen publiserer eller forkaster. Svaret: `renamedIn: "unchanged"`.
- **Ingen `checkUsable`** ved omdøping. Omdøpingen endrer ikke lista, og publiseringen sjekker alt på nytt. Med sjekken ville et
  arkivert element eller et slettet tema stoppet omdøpingen. Utkastet valideres med `courseDraftPayloadSchema` før det lagres, og
  tittelen lagres som språkkart.
- **Sammenligningen** er `sameLocalizedText(expectedTitle, arbeidstittel)` (courseVersioning.ts), der arbeidstittelen er
  `localizedTextCodec.serialize(utkast.title)` eller kursets lagrede tittel. Ikke `===`: gamle titler kan være ren tekst eller
  JSON med en annen rekkefølge. `expectedTitle` er påkrevd. Lista får `draftTitle` fra en ny funksjon i courseDraft.ts (ingen
  utenfor fila leser `payloadText`, `course-draft-guard`), med samme `serialize`. Et utkast som ikke kan leses, gir ingen
  `draftTitle`, og omdøpingen svarer `409 course_draft_unreadable`.
- **Under én lås.** Lesingen, valget (utkast eller kurs) og skrivingen skjer i samme `runContentWrite`: `saveCourseDraft` får en
  låst variant (`saveCourseDraftLocked(tx, …)`), og `updateCourse` tar transaksjonen (`lockedTx`). Ellers kunne en annen fane
  publisere kurset imellom, og navnet gått rett ut uten utkast (`publishCourse` øker ikke telleren).
- **Vakter:** ruta får en rad i `courseRows` (m2-content-read-by-producers-1165) og står i lista over ruter agent-tokenet ikke når
  (test/unit/agent-token-scope.test.ts).

**Kjente mangler (godtatt):** raden viser kursets publiserte navn, ikke utkastets, også etter omdøpingen (som før for kurs med
utkast); merket «Nyere utkast» sier at noe venter. Som for seksjoner endres bare språket lista viser; de andre språkene beholder
det gamle navnet til de oversettes. Et upublisert kurs med utkast (avpublisert etter at utkastet ble lagret) avvises med
`409 course_has_draft`, som i skjemaet. Eksisterende, ikke fra denne skiva: en publisering skriver elementene på nytt, og tråder
knyttet til et element flyttes da til kursets tavle (`DiscussionThread.courseItem` er `SetNull`); egen sak.

**Tester:** integrasjon gjennom ruta (upublisert: navnet er skrevet, telleren økt; publisert uten utkast: utkast med bare tittel og
samme elementer, kurset urørt, publisering endrer bare navnet; publisert med utkast: tittelen byttet, resten av utkastet urørt;
`expectedTitle` feil: 409, ingenting skrevet; arkivert: 400; en annen produsent: 403; en deltaker: 403). Vaktene: ruta i tabellen
over kursets skriveruter (`m2-content-read-by-producers-1165`) og i lista over ruter agent-tokenet ikke når. E2e: «Døp om» i
kurslista for upublisert og publisert kurs (meldingen, kroppen som sendes), Escape, og at en ikke-eier ikke har knappen.
Mutasjoner: dropp `expectedTitle`-sjekken, skriv rett i kurset for et publisert kurs, la utkastet miste et felt.

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
