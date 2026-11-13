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

## 3. Fire vakter (de gjenkjennbare reglene)

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
| Slette | alle kurs, også arkiverte |

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
> Meldingen ber ikke forfatteren gjenopprette kurset og ta elementet ut: for en modul stopper slettingen
> likevel på versjonene (#1152), og det arkiverte kurset ville mistet innholdet det skulle beholde.

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
**Slett vises kun for arkiverte elementer** (vedtatt v1.6.1): sletting er det terminale steget
*etter* arkivering, likt for kurs/modul/seksjon. Aktive rader viser Arkiver i stedet. I tillegg
kan man ikke slette hvis det ødelegger bevarte registre — arkiver i stedet.
- **Kurs:** har `CourseCompletion` (utstedte sertifikat) → «Arkiver kurset i stedet».
- **Modul:** har versjoner/forsøk/sertifiseringsstatus, eller er i et kurs, også et arkivert (G2).
- **Seksjon:** er i et kurs, også et arkivert (G2) — dekker også leshistorikk (kun kurs-koblede
  seksjoner har lesinger) — eller inngår i et utstedt kursbevis (#938).

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

   Slett (G4): terminal, fra hvilken som helst tilstand når vaktene tillater det.
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
