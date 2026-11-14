# Enhetlig innholds-livssyklus — Kurs · Modul · Seksjon

> Status: vedtatt 2026-06-28; implementert v1.5.0–v1.6.1 (#706–#709), konsistens-opprydding i #705.
> Erstatter den ujevne, per-entitet-implementerte livssyklusen
> som lot et publisert kurs ende opp med en arkivert/avpublisert modul (lappet i deltaker-UI
> via #502-followup, «Ikke tilgjengelig»). Målet er **én gjenkjennbar modell** for alle tre
> innholdstypene, slik at en forfatter lærer reglene én gang og kjenner dem igjen overalt.

## 1. To akser, samme ord for alle tre

Hvert innholdselement har **én status** sammensatt av to uavhengige akser:

| Akse | Verdier | Betydning |
|------|---------|-----------|
| **Redaksjonell** | Utkast ⇄ Publisert | Er innholdet synlig/brukbart for deltakere? |
| **Oppbevaring** | Aktiv ⇄ Arkivert | Er innholdet pensjonert (skjult i forfatter-lister, men bevart)? |

Vist som **én status-merkelapp** med samme tre ord overalt:

- **Utkast** — ikke publisert; usynlig for deltakere.
- **Publisert** — live.
- **Arkivert** — pensjonert; kan gjenopprettes. (Arkivert overstyrer; et arkivert element er
  alltid også upublisert — se invariant I3.)

### Hvordan akslene avbildes per entitet (datamodell)

| | Utkast | Publisert | Arkivert |
|---|---|---|---|
| **Modul** | `activeVersionId = null`, `archivedAt = null` | `activeVersionId` satt | `archivedAt` satt |
| **Kurs** | `publishedAt = null`, `archivedAt = null` | `publishedAt` satt | `archivedAt` satt |
| **Seksjon** | `activeVersionId = null`, `archivedAt = null` | `activeVersionId` satt | `archivedAt` satt |

Seksjoner **auto-publiseres ved lagring** (lavfriksjon — lagre = publiser), men eksponerer
samme Avpubliser/Arkiver-handlinger som de to andre. Slik får forfatteren samme vokabular og
samme knapper uten et ekstra obligatorisk publiser-klikk på den vanlige stien.

## 2. Samme handlinger, samme rekkefølge, samme etiketter

Alle tre entiteter viser nøyaktig samme handlingssett i samme rekkefølge:

```
Rediger/Åpne · Publiser ⇄ Avpubliser · Arkiver ⇄ Gjenopprett · Slett
```

Knappene veksler etter status: Publisert viser **Avpubliser**, Utkast viser **Publiser**;
Aktiv viser **Arkiver**, Arkivert viser **Gjenopprett**. **Slett vises bare på arkiverte elementer**
(vedtatt v1.6.1, se G4), og er vaktet.

## 3. Fem vakter (de gjenkjennbare reglene)

### G1 — Fullstendighet ved publisering
Kan ikke publisere ufullstendig innhold.
- **Modul:** gyldig versjon (`validateModuleVersionForPublish` — blueprint/oppgave/innhold).
- **Kurs:** minst én modul.
- **Seksjon:** ikke-tomt innhold.

### G2 — Bruk-lås (modul/seksjon i kurs)  ⟵ *vedtatt: aktive kurs; sletting: alle kurs (#1149)*
«I bruk» betyr at elementet ligger i et **aktivt** kurs: et kurs som ikke er arkivert, publisert
*eller* utkast. **Arkiverte kurs teller ikke som bruk** (produkteier 13.11.2026, #1149,
`doc/DECISIONS.md`). Sletting er unntatt:

| Handling på en modul eller seksjon | Stoppes av |
|---|---|
| Vises som «Brukt i kurs», i kursfilteret og i tematallet | bare aktive kurs teller |
| Avpublisere | aktive kurs. Et arkivert kurs stopper ikke |
| Arkivere | aktive kurs, **og lagrede utkast (#1140) til aktive kurs** (#1150). Et arkivert kurs, eller utkastet til et, stopper ikke |
| Slette | alle kurs, også arkiverte, **og lagrede utkast til aktive kurs** (#1152) |

**Utkastene teller ved arkivering (#1150 skive 2a-1).** Står et element i elementlista til et lagret utkast til et annet
aktivt kurs, kan det ikke arkiveres: utkastet ville ellers feilet først når det skal publiseres
(`course_draft_item_unusable`). Ett svar for all arkivering — for hånd, importens utbytting, og forhåndsvisningen av
kursarkiveringen: `findActiveUsesOfItems` i contentLifecycle.ts. Et utkast som ikke kan leses (skjemaet krever elementlista), betyr
«som publisert» og legger ikke til noe (det kan bare forkastes). **Avpublisering ser ikke utkastene:** den er reversibel, og et
utkast med et avpublisert element stoppes ved publisering. Feilkoden når et utkast stopper: `content_in_course_draft`
(«… I 1 av dem står den bare i et lagret utkast: «HMS 2025». Ta den ut av utkastet (eller forkast utkastet) og av kursene
først.»). Uten utkast er svaret `content_in_use` som før.

**Hvorfor sletting er unntatt:** `CourseItem` peker på modul og seksjon med `onDelete: Restrict`.
Så lenge raden i det arkiverte kurset finnes, kan databasen ikke slette elementet. Sletting av
innhold i arkiverte kurs hører til #1152, der kurset og innholdet slettes samlet.

Feilmeldingen navngir kursene. Avpublisering og arkivering (`content_in_use`):

> «Modulen er i bruk i 2 kurs: «Arbeidsmiljø», «HMS-grunnkurs». Fjern den fra kursene
> først (eller avpubliser kursene).»

Sletting der minst ett av kursene er arkivert (`content_in_archived_course`) sier hvilke:

> «Seksjonen kan ikke slettes fordi den ligger i 2 kurs: «Arbeidsmiljø», «HMS 2024». Arkiverte
> kurs (1): «HMS 2024». Et arkivert kurs beholder innholdet sitt.»
>
> Meldingen ber ikke forfatteren gjenopprette kurset og ta elementet ut: det arkiverte kurset ville mistet innholdet det
> skulle beholde. Veien er å slette kurset først (#1152); da er elementet fritt.

Sletting uten arkiverte kurs svarer som før: `content_in_use` for seksjoner, `module_in_use` (409)
for moduler.

**Når et arkivert kurs gjenopprettes** med et element som er avpublisert eller arkivert i
mellomtiden, lander kurset som utkast (I3). Et arkivert element stopper publiseringen
(`item_archived`) til det er gjenopprettet eller tatt ut av kurset; en avpublisert seksjon
publiseres sammen med kurset («Publiser kurs med innhold»). En avpublisert modul har vært ute før, så
«Publiser kurs med innhold» svarer `409 course_publish_has_republished_modules`, og «Publiser nye versjoner»
åpner seg for modulen. Deltakerne ser ingenting før kurset er publisert igjen: `restoreCourse` nullstiller
også `publishedAt`, så et kurs som var arkivert og publisert (eldre data), ikke går rett ut.

**Samtidighet:** arkivering av et element og gjenoppretting av et kurs skriver begge under
innholdslåsen (`runContentWrite`), og sjekken gjøres på den låste transaksjonen. Den som kommer
sist, ser hva den første gjorde: enten stoppes arkiveringen av det nå aktive kurset, eller kurset
gjenopprettes med et arkivert element og kan ikke publiseres før det er ryddet.

**G5 gjelder kursets egne felt og elementliste, ikke de delte elementene (#1151).** Et arkivert kurs kan ikke endres, men en
modul eller seksjon som også ligger i et aktivt kurs, kan fortsatt lagres, avpubliseres og arkiveres. Får den en ny versjon,
følger det arkiverte kurset med som før (ny mindre versjon, og ved en hovedversjon hevet krav og e-post som venter til kurset er
publisert igjen). Valgt i #1149 og bekreftet av produkteier 13.11.2026 (#1151, punkt A): et gjenopprettet kurs stiller
de samme kravene som de andre kursene modulen ligger i.

Regelen bor ett sted: `src/modules/course/contentLifecycle.ts`. De to svarene har hvert sitt navn,
`findActiveCoursesContaining…` og `findAllCoursesContaining…`, og `test/content-in-use-guard.test.js`
nekter en ny leser som svarer på spørsmålet utenom fila.

### G3 — Aktivitets-bekreftelse (kurs med påbegynt deltaker)  ⟵ *vedtatt: bekreft tallet (#1150)*
Et kurs som har minst én deltaker som har **påbegynt men ikke fullført** arkiveres (pensjoneres)
bare når forfatteren har **bekreftet tallet** (produkteier 13.11.2026). Før #1150 skive 2a-2 var det en
sperre. Forhåndsvisningen (`GET …/archive-preview`) viser `inProgressCount`; `POST …/archive` sender
det forfatteren så (`expected`), og arkiveringen regner tallet på nytt under innholdslåsen og svarer
`409 course_archive_preview_changed` hvis det er endret. Uten `expected` (en gammel fane, et direkte
kall) sperrer G3 som før: `400 course_has_active_participants`. Lesehistorikk, besvarelser og beståtte
beholdes; gjenopprettes og publiseres kurset, står fremdriften der.

En deltaker som har gjort alle stegene uten kursbevis, er ikke midt i. Arkiveringen utsteder de
manglende bevisene før kurset arkiveres (når kurset er publisert), ellers ville de aldri kommet: utstedelsen
hopper over arkiverte kurs.

**«Midt i» er det «Mine kurs» viser som «I gang» (#1150 skive 2a-1).** Deltakeren er midt i når hen
- ikke har kursbevis for kursets **nåværende** hovedversjon (et bevis for en eldre hovedversjon gjør
  ikke kurset fullført, #934), og ikke har gjort alle stegene (moduler som ikke er arkivert, og
  seksjonene deltakeren kan lese; beståtte fra `findModuleProgress`); og
- har begynt: en innlevering på en modul i kurset som ikke er arkivert, eller en lesing som teller
  for kursets nåværende hovedversjon.

Om kurset er publisert, og om deltakeren ser det (OPEN, tildelt), spørres ikke om: ellers ville et
avpublisert kurs alltid vært uten deltakere midt i. Tellingen bor i `findCourseInProgressParticipants`
(contentLifecycle.ts) og brukes av G3, kurslista (`inProgressCount`) og forhåndsvisningen av
arkiveringen (`GET …/archive-preview`), så de aldri svarer ulikt. Før #1150 telte alle med et kursbevis
som ferdige, og alle med en lesing eller innlevering i kurset som påbegynt.

⚠️ **En innlevering har ikke noe kurs.** En innlevering på en modul som ligger i flere kurs, gjør
deltakeren påbegynt i alle, også i «Mine kurs». Det telles i den trygge retningen.

**Avpublisering er bevisst unntatt fra G3** (justert etter staging-gjennomgang v1.5.1):
avpublisering er reversibel (republiser når som helst) og er den «myke» måten å ta et kurs ned på
mens noen er midt i det. Arkivering er pensjonering og forblir låst. Feilmeldingen ved blokkert
arkivering peker derfor på Avpubliser som alternativet. (Aktivitets-signalet er varig — det fjernes
ikke ved å trekke en påmelding — så en hard lås på avpublisering ville vært en blindvei.)

### G4 — Slett-vern (historikk)
**Bare et arkivert element kan slettes** (vedtatt v1.6.1 i klienten; **håndheves på tjeneren fra #1151**): sletting er det
terminale steget *etter* arkivering, likt for kurs/modul/seksjon. Aktive rader viser Arkiver i stedet. `DELETE` på et kurs, en
modul eller en seksjon som ikke er arkivert, svarer `400 delete_requires_archived` (`details.itemType`), før de andre vaktene.
Kaskadeslettingen (#762, administrator) krever at **kurset** er arkivert, i forhåndsvisningen og i slettingen; innholdet som
bare brukes i kurset, fulgte det inn i arkivet (#1150) — men ikke for kurs arkivert før 2.159.0, eller når et element er
gjenopprettet for hånd mens kurset var arkivert. **Fra #1152 (skive 4a-2) sletter kaskaden bare arkiverte elementer:** et aktivt
element som bare lå i kurset, blir stående og kobles bare fra, og forhåndsvisningen lister det for seg («Blir stående som før»,
`stays: "not_archived"`). **Unntak:** masseryddingen av upubliserte moduler («Rydd stage») er
motsatt regel: den sletter bare moduler som *ikke* er arkivert. I tillegg kan man ikke slette hvis det ødelegger bevarte
registre — da blir elementet stående arkivert.
- **Kurs:** har `CourseCompletion` (utstedte sertifikat) → `course_has_completions`, kurset blir stående arkivert. #1152 (skive
  4a-2), i denne rekkefølgen etter kursbevisene:
  - **Fullført uten kursbevis** (`course_has_completed_without_certificate`, `{ count }`): noen har oppfylt kravet mens kurset var
    arkivert (utstedelsen hopper over arkiverte kurs). Kurset må gjenopprettes og publiseres for at de skal få beviset.
  - **Venter på vurdering** (`course_has_pending_reviews`, `{ count }`): en besvarelse i en av kursets moduler venter på vurdering,
    manuell behandling (`UNDER_REVIEW`) eller anke. ALLE modulene i elementlista teller, også en delt modul som ble arkivert for seg
    etter kurset og derfor er ute av kravet under (QA-porten 4a). Går bort av seg selv når sakene er avgjort.

  **Kravet måles slik det var da kurset ble arkivert**, med reglene fra utstedelsen (kreditt per kurs med kravet til
  hovedversjon, lesingsregelen for nåværende hovedversjon, et tomt krav gjør ingen fullført), men det som ble arkivert
  **sammen med** kurset, teller: en modul som ikke er arkivert eller har `archivedWithCourseId` = kurset, og en seksjon deltakerne
  kan lese nå eller som ble arkivert med kurset og hadde en publisert versjon (`activeVersionIdBeforeArchive`). En modul arkivert
  for seg og en seksjon som aldri ble publisert, er ikke med; tvil gjør flere «fullført», og det beholder kurset. Måles før
  merkene nullstilles. **Låsene:** et vedtak tar bare deltakerlåsen, så slettingen tar deltakerlåsene for alle som har levert på
  en av kursets moduler, under innholdslåsen og før målingen (`lockCourseDeleteLearners`). Ikke `findCourseInProgressParticipants`:
  den ser bort fra arkiverte elementer og hører til arkiveringsdialogen. Kode: `courseDeleteGuard.ts`.
- **Modul (#1152):** er i et kurs, også et arkivert (G2); har innleveringer (`module_has_submissions`) eller
  sertifiseringsstatus (`module_has_certification`); eller står i et lagret utkast til et aktivt kurs
  (`delete_blocked_by_course_draft`). **Versjoner holder den ikke lenger igjen:** en arkivert modul uten deltakerhistorikk
  slettes med modulversjonene, flervalgsspørsmålene og -settene, kriteriene og ledetekstene, i den rekkefølgen
  fremmednøklene krever (skriverens `deleteModule`). Før #1152 nektet slettingen alt med versjoner, med den generelle
  `delete_module_failed`.
- **Seksjon:** er i et kurs, også et arkivert (G2) — dekker også leshistorikk (kun kurs-koblede
  seksjoner har lesinger) — eller inngår i et utstedt kursbevis (#938), eller (#1152) står i et lagret utkast til et aktivt
  kurs (`delete_blocked_by_course_draft`).

**Utkastene teller også ved sletting (#1152)**, med samme regel som arkiveringen (`findActiveUsesOfItems`), men bare utkastene:
kursenes egne lister har slettingen sin egen vakt (alle kurs). Utkastet til et arkivert kurs teller ikke (kjent mangel for kurs
arkivert mellom 2.156 og 2.159). Masseryddingen av upubliserte moduler hopper også over en modul i et utkast, både i
forhåndsvisningen og under låsen (`findCourseDraftUsesForDelete`). Den sletter bare modulene forhåndsvisningen viste som «slettes»
(`expectedModuleIds`, QA-porten 4a): en modul laget mens dialogen sto åpen, står. En side uten lista får
`409 purge_confirmation_outdated`.

**Én slettefunksjon per type, i to lag (#1152 skive 4a-2).** `deleteCourseInTx`, `deleteModuleInTx` og `deleteSectionInTx` tar
transaksjonen (som holder innholdslåsen), leser alt på nytt, vurderer og sletter; `deleteCourse`, `deleteModule` og `deleteSection`
åpner transaksjonen og gjør «finnes ikke» til 404. Finnes raden ikke lenger, svarer den indre `{ deleted: false, reason: "not_found" }`
i stedet for å kaste, så to workere (eller jobben i 4c og knappen) kan komme til samme rad. Kaskaden kaller de tre indre i én
transaksjon: deltakerlåsene og analysen først, så kurset (koblingene går med det), så hver eksklusive, arkiverte modul og seksjon,
med én hendelse i revisjonsloggen per element. Masseryddingen av upubliserte moduler er motsatt regel og sletter fortsatt selv.

**Eierradene (`ContentOwner`) går med innholdet (#1152).** De har ingen fremmednøkkel til kurs, modul eller seksjon, så hver
sletting rydder dem i samme transaksjon (`deleteContentOwnersOf`): «Slett» for alle tre, kaskaden (kurset og elementene den
sletter; delte elementer beholder sine) og masseryddingen. Vakt: `test/unit/content-owner-cleanup-1152-guard.test.js`.

**Fristen, og hva lista viser (#1152 skive 4b).** Et arkivert element uten deltakerhistorikk kan slettes **seks kalendermåneder**
(`ARCHIVED_CONTENT_RETENTION_MONTHS`, `src/config/retention.ts`) etter det seneste av `archivedAt` og **overgangstidspunktet**:
dagen regelen kom i miljøet, skrevet én gang av migreringen `20261114120000_archived_content_retention` som raden
`archived_content_retention_floor` i `PlatformConfig` (ISO 8601 i UTC; finnes den, står den urørt). Datoen er en kalenderdato i
Norge (Europe/Oslo), og blir siste dag i måneden når dagen ikke finnes der (31. august → 28. februar); regnestykket:
`src/modules/content/retentionDeadline.ts`. Gjenoppretting nullstiller `archivedAt`, ny arkivering starter fristen på nytt.
- **Ett svar per arkivert element** (`src/modules/content/archivedRetention.ts`): `{ deletesAt }`, `{ kept: { code, details } }`
  med koden «Slett» ville svart, eller `{ unknown: true }` når overgangsraden mangler eller ikke kan leses (ingen dato, aldri en
  gjetning). Kurslista, modulbiblioteket og seksjonslista viser det under «Arkiverte» («Slettes 13.05.2027» / «Beholdes: …»),
  og regner det bare når filteret velges (`?includeRetention=1`, 4b-2): ellers koster listene det de gjorde før.
- **Samme utregning som «Slett».** Kurset: `checkCourseDelete` (courseDeleteGuard.ts), som `deleteCourseInTx` kaster fra. Modul og
  seksjon: reglene står én gang (`moduleDeleteRules`, `sectionDeleteRules`); «Slett» leser dataene for ett element
  (`checkModuleDelete`, `checkSectionDelete`), lista for mange i én omgang (`checkModuleDeletes`, `checkSectionDeletes`).
- **Et element i et kurs som selv slettes** (planen, «Etter gjennomlesingen» punkt 7): jobben sletter kursene først, så lista
  vurderer elementet som om de arkiverte kursene som kan slettes, er borte, og viser den seneste av elementets og kursenes dato.
  Holdes det av et kurs som beholdes: «Beholdes: ligger i et kurs som beholdes» (`content_in_archived_course`).
- **Lista tar ingen lås.** Den er et forslag; «Slett» og jobben (4c) måler på nytt under låsene.

### G5 — Arkivert er urørlig (#1151)
Et arkivert kurs, en arkivert modul og en arkivert seksjon kan ikke endres eller brukes før de er gjenopprettet. **Lov** på et
arkivert element: gjenopprette (også med kurset, #1150), slette (G4), eksportere og lese, og endre eiere (eierpanelet, #1150
2b). For et arkivert kurs også: forkaste et utkast, fjerne en påmelding og fjerne en klassetildeling (opprydding, #1035).

**Alt annet avvises på tjeneren** med `400 course_archived`, `module_archived` eller `section_archived`, og ingenting er
skrevet: navn, innhold og innstillinger, nye versjoner (modulversjon, kriterier, ledetekst, flervalgssett, eksempelsvar, påfyll
av flervalg, gjenoppretting av en eldre versjon), publisering og avpublisering (også kaskaden, «Publiser nye versjoner» og
kalibreringen), kursets elementliste og kursutkast, bilder og figuroversetting, og import inn i et arkivert mål
(`replaceExisting`, `updateExisting`). Tildeling og påmelding sa det før (`course_archived`).

**Én vakt** for alle tre typene: `assertNotArchived` i `src/modules/content/archivedGuard.ts`. Den leser `archivedAt` på
transaksjonen som holder innholdslåsen; arkiveringen tar samme lås, så den som kommer sist av en arkivering og en skriving, ser
den andres resultat. Vakta står i samlepunktene (kurs: `claimCourseRevision`, `publishCourse`, publiseringene, utkastet, importen;
modul: kommandoene, ikke skriveren gjenopprettingen bruker; seksjon: kommandoene og `appendInactiveSectionVersion`). En
**forhåndssjekk** (`assertNotArchivedBeforeLock`) står foran de betalte kallene til språkmodellen og foran «Publiser
kurs»; den er et forslag, ikke svaret. Modulpubliseringsporten i ruta svarer som før med `item_archived` (422).

`test/archived-is-readonly-guard.test.js` finner hvert skrivested til et kurs, en modul eller en seksjon og krever vakta eller et
begrunnet unntak.

## 4. Invarianter

- **I1 — Integritet:** Et publisert kurs inneholder aldri en modul/seksjon som ikke er
  tilgjengelig. Håndheves av G2 (innhold kan ikke trekkes vekk under et aktivt kurs) og av
  publiseringsporten (`item_archived`), som stopper et gjenopprettet kurs med et arkivert element
  (#1149). «Ikke tilgjengelig»-visningen i deltaker-UI (#502-followup) blir et rent sikkerhetsnett.
- **I2 — Symmetri:** Hver tilstand er reversibel én tilbake: Publiser↔Avpubliser,
  Arkiver↔Gjenopprett. Slett er den eneste terminale handlingen, og er vaktet (G4). #1150: en
  kursarkivering tar modulene og seksjonene som ikke brukes andre steder med seg, og gjenopprettingen av
  kurset setter nøyaktig dem tilbake (de som fortsatt ligger i kurset og fortsatt er arkivert). Det
  husker elementet selv (`archivedWithCourseId`, `activeVersionIdBeforeArchive`). Elementer arkivert
  for hånd, av importen eller med et annet kurs, gjenopprettes hver for seg.
- **I3 — Arkivert ⇒ Utkast:** Å arkivere **auto-avpubliserer** atomisk (fjerner
  `activeVersionId`/`publishedAt` samtidig som `archivedAt` settes). Gjenopprett lander i
  **Utkast** — forfatteren re-publiserer bevisst. Dermed finnes ikke tilstanden «arkivert men
  fortsatt publisert».
  **Unntak (#1150, produkteier 13.11.2026):** en modul eller seksjon som fulgte et kurs inn i arkivet,
  kommer tilbake med kurset **publisert med samme versjon og samme nummer**. Kurset selv lander som utkast,
  og forfatteren trykker «Publiser»; ingenting er endret, så det blir ingen ny hovedversjon, og lesinger
  og beståtte teller som før. Gjenopprettes elementet alene, lander det som utkast som før. Finnes ikke
  versjonen lenger, lander det også som utkast, og svaret sier det.

## 5. Tilstandsdiagram (likt for alle tre)

```
            publiser (G1)
   Utkast ───────────────▶ Publisert
     ▲   ◀───────────────     │
     │      avpubliser         │
     │      (G2/G3)            │ arkiver (G2/G3, auto-avpubliser → I3)
     │                         │
     │   arkiver (G2/G3)       ▼
     └──────────────────▶ Arkivert
          ◀───────────────
            gjenopprett  (→ Utkast)

   Slett (G4): terminal, bare fra Arkivert, når vaktene tillater det (#1151).
   Arkivert (G5): ingen endring før Gjenopprett.
```

## 6. Hva endres i koden (oppsummering)

**Backend**
- Modul: `unpublishModule` + `archiveModule` får G2-vakt (slett har den alt). Arkiver
  auto-avpubliserer (I3).
- Kurs: ny `unpublishCourse`; **kun `archiveCourse` får G3** — avpublisering er bevisst unntatt
  fra G3 (se §3, justert v1.5.1). Arkiver auto-avpubliserer (I3). Slett beholder G4 (completions).
  #1150 skive 2a-2: `archiveCourse` og `restoreCourse` bor i `courseArchive.ts` og tar innholdet med
  seg (se `doc/FEATURE_SURFACE_MAP.md` §33c).
- Seksjon: nye `publishSection`/`unpublishSection`/`archiveSection`/`restoreSection`; G2-vakt
  på avpubliser/arkiver/slett.
- Delt hjelper (`contentLifecycle.ts`, #1149): `findActiveCoursesContainingModule/Section` (aktive
  kurs: det som vises som bruk og stopper avpublisering og arkivering) og
  `findAllCoursesContainingModule/Section` (alle kurs, også arkiverte: sletting). For listene:
  `findActiveCoursesForSections` og `findActiveCoursesForModules` (batch). Modul-slett bruker samme
  navngitte-kurs-melding som avpubliser/arkiver (G2), ikke en avvikende telle-melding.

**Frontend (samkjør de tre listene)**
- Felles status-merkelapp (Utkast/Publisert/Arkivert) med samme farger.
- Seksjonsliste: legg til status-merkelapp + Publiser/Avpubliser/Arkiver/Gjenopprett (har i dag
  bare Rediger/Slett).
- Kursliste: legg til Avpubliser (mangler i dag).
- Samme handlings-rekkefølge i alle tre lister.

Se også `doc/FEATURE_SURFACE_MAP.md` (livssyklus-handlinger = distribuert oppførsel på tre
flater) og `doc/API_REFERENCE.md` for endepunktene.
