# Enhetlig innholds-livssyklus — Kurs · Modul · Seksjon

> Status: vedtatt 2026-06-28. Erstatter den ujevne, per-entitet-implementerte livssyklusen
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
Aktiv viser **Arkiver**, Arkivert viser **Gjenopprett**. Slett er alltid synlig (men vaktet).

## 3. Fire vakter (de gjenkjennbare reglene)

### G1 — Fullstendighet ved publisering
Kan ikke publisere ufullstendig innhold.
- **Modul:** gyldig versjon (`validateModuleVersionForPublish` — blueprint/oppgave/innhold).
- **Kurs:** minst én modul.
- **Seksjon:** ikke-tomt innhold.

### G2 — Bruk-lås (modul/seksjon i kurs)  ⟵ *vedtatt: ALLE kurs*
En modul eller seksjon som ligger i **ethvert** kurs (publisert *eller* utkast) kan **ikke
avpubliseres, arkiveres eller slettes**. Feilmeldingen navngir kursene:

> «Modulen er i bruk i 2 kurs: «Arbeidsmiljø», «HMS-grunnkurs». Fjern den fra kursene
> først (eller avpubliser kursene).»

Dette gjør den eksisterende slett-vakta konsistent: alle tre tilbaketrekkende handlinger
(avpubliser/arkiver/slett) er beskyttet likt, ikke bare slett.

### G3 — Aktivitets-lås (kurs med påbegynt deltaker)  ⟵ *vedtatt: blokker hvis påbegynt*
Et kurs som har minst én deltaker som har **påbegynt men ikke fullført** kan ikke
**avpubliseres eller arkiveres**. «Påbegynt» = har lest minst én seksjon (`CourseSectionRead`)
eller levert minst ett forsøk (`Submission`) på en modul i kurset, uten en `CourseCompletion`.

### G4 — Slett-vern (historikk)
Kan ikke slette hvis det ødelegger bevarte registre — arkiver i stedet.
- **Kurs:** har `CourseCompletion` (utstedte sertifikat) → «Arkiver kurset i stedet».
- **Modul:** har versjoner/forsøk/sertifiseringsstatus, eller er i et kurs (G2).
- **Seksjon:** er i et kurs (G2) — dekker også leshistorikk (kun kurs-koblede seksjoner har lesinger).

## 4. Invarianter

- **I1 — Integritet:** Et publisert kurs inneholder aldri en modul/seksjon som ikke er
  tilgjengelig. Håndheves av G2 (innhold kan ikke trekkes vekk under et kurs). «Ikke
  tilgjengelig»-visningen i deltaker-UI (#502-followup) blir et rent sikkerhetsnett.
- **I2 — Symmetri:** Hver tilstand er reversibel én tilbake: Publiser↔Avpubliser,
  Arkiver↔Gjenopprett. Slett er den eneste terminale handlingen, og er vaktet (G4).
- **I3 — Arkivert ⇒ Utkast:** Å arkivere **auto-avpubliserer** atomisk (fjerner
  `activeVersionId`/`publishedAt` samtidig som `archivedAt` settes). Gjenopprett lander i
  **Utkast** — forfatteren re-publiserer bevisst. Dermed finnes ikke tilstanden «arkivert men
  fortsatt publisert».

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
- Kurs: ny `unpublishCourse`; `archiveCourse` + `unpublishCourse` får G3-vakt; arkiver
  auto-avpubliserer (I3). Slett beholder G4 (completions).
- Seksjon: nye `publishSection`/`unpublishSection`/`archiveSection`/`restoreSection`; G2-vakt
  på avpubliser/arkiver/slett.
- Delt hjelper: `findCoursesContainingModule/Section` (id+tittel, alle publiseringstilstander)
  for navngitte feilmeldinger; `countSectionCourses`.

**Frontend (samkjør de tre listene)**
- Felles status-merkelapp (Utkast/Publisert/Arkivert) med samme farger.
- Seksjonsliste: legg til status-merkelapp + Publiser/Avpubliser/Arkiver/Gjenopprett (har i dag
  bare Rediger/Slett).
- Kursliste: legg til Avpubliser (mangler i dag).
- Samme handlings-rekkefølge i alle tre lister.

Se også `doc/FEATURE_SURFACE_MAP.md` (livssyklus-handlinger = distribuert oppførsel på tre
flater) og `doc/API_REFERENCE.md` for endepunktene.
