# Designdokument: Organisere moduler i kurs (#133)

> Historisk designnotat. Dette dokumentet beskriver opprinnelig MVP-design for kurs, men er ikke lenger fasit for implementasjonsstatus.
> Aktiv status, UX-beslutninger og restarbeid ligger i `doc/design/COURSE_133_FINISH_PLAN_2026-03-26.md`.

## Status

Current status note:
- This file is historical design context, not the active implementation tracker.
- The course capability is largely implemented across data model, admin flow, participant flow, course completion, and reporting.
- `#133` stays open until human verification and final closeout are recorded.
- Use `doc/design/COURSE_133_FINISH_PLAN_2026-03-26.md` as the active source of truth.
- The stale status text below is preserved only as historical context.

Aktiv status per 2026-03-27:
- Kurskapabiliteten er i hovedsak implementert i datamodell, adminflyt, deltakerflyt, kursbevis og rapportering.
- `#133` er fortsatt Ã¥pen fordi endelig menneskelig verifikasjon og closeout-gjennomgang gjenstÃ¥r.
- Aktiv sannhetskilde for status og avgrensning er `doc/design/COURSE_133_FINISH_PLAN_2026-03-26.md`.
- Historiske child issues: `#277` â†’ `#283`
- Aktive follow-up issues for ferdigstilling: `#284` â†’ `#287`

Beslutninger tatt, teknisk design klart, implementasjon ikke påbegynt.

Child issues: #277 (skjema) → #278 + #280 → #279 + #281 → #282 + #283

---

## Bakgrunn

Dagens løsning er modul-sentrisk. Moduler vises flatt uten overordnet kursstruktur. Dette gjør det vanskelig å støtte læringsløp med flere relaterte moduler, og umuliggjør kursbevis og kursrapportering.

---

## Beslutninger

| Spørsmål | Beslutning | Begrunnelse |
|---|---|---|
| Kan modul tilhøre flere kurs? | Ja (N:M) | Gjenbruk av innhold på tvers av kurs |
| Vises moduler i begge lister? | Ja — kursvisning og flat liste | Ikke bryte eksisterende flyt |
| Versjonspinning per kurs? | Nei — alltid aktiv versjon | Enkel modell, ingen versjonskompleksitet |
| Bestått-status ved moduloppdatering | Beholdes — tilknyttet modul, ikke versjon | Konsistent med CertificationStatus-modellen |
| Kursbevis? | Ja, separat fra modulbevis | Automatisk ved alle moduler bestått |
| Enrolment-modell? | Nei i MVP | Nevner i kursrapport = alle som har forsøkt minst én modul |

---

## Omfang

### Inkludert i MVP
- `Course`- og `CourseModule`-entiteter (N:M)
- Admin: opprette, redigere, publisere, arkivere kurs; knytte moduler med rekkefølge
- Deltaker: kurs som accordion i modullisten; permalink for kursvisning
- Kursbevis: automatisk generering og visning i `/participant/completed`
- Rapportering: beståttprosent per kurs med moduldrilldown

### Utenfor MVP
- Forutsetningslås (modul 2 krever bestått modul 1)
- Enrolment-modell
- Historisk versjonering av kursmedlemskap
- Neste anbefalte kurs

---

## Prisma-skjema

```prisma
model Course {
  id                 String             @id @default(cuid())
  title              String             // lokalisert JSON: {"en-GB":"...","nb":"...","nn":"..."}
  description        String?            // lokalisert JSON
  certificationLevel String?
  publishedAt        DateTime?
  archivedAt         DateTime?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  modules            CourseModule[]
  completions        CourseCompletion[]
}

model CourseModule {
  courseId   String
  moduleId   String
  sortOrder  Int
  course     Course  @relation(fields: [courseId], references: [id], onDelete: Cascade)
  module     Module  @relation(fields: [moduleId], references: [id], onDelete: Restrict)

  @@id([courseId, moduleId])
  @@index([moduleId])
}

model CourseCompletion {
  id                 String   @id @default(cuid())
  userId             String
  courseId           String
  completedAt        DateTime @default(now())
  certificateId      String   @unique @default(cuid())
  moduleSnapshotJson String   // JSON-array av moduleIds som inngikk ved fullføring
  user               User     @relation(fields: [userId], references: [id], onDelete: Restrict)
  course             Course   @relation(fields: [courseId], references: [id], onDelete: Restrict)

  @@unique([userId, courseId])
}
```

`Module` får tilleggsrelasjon:
```prisma
courseModules CourseModule[]
```

---

## Modulstruktur

Ny modul: `src/modules/course/`

```
courseRepository.ts        — Prisma-queries (les): kurs, CourseModule, CourseCompletion
courseCommands.ts          — Skriveoperasjoner: opprett/publiser kurs, sett moduler, utsted bevis
courseQueries.ts           — Forretningslogikk for les: progress-beregning, courseStatus
courseReadModels.ts        — Eksplisitte DTO-typer for API-svar (ikke Prisma-avledet)
courseCompletionService.ts — checkAndIssueCourseCompletions (trigger fra decision-layer)
index.ts                   — Eksporter
```

Følger samme konvensjoner som `src/modules/adminContent/` og `src/modules/certification/`.

---

## Integrasjonspunkter

### Kursbevis-trigger

`checkAndIssueCourseCompletions` kalles etter `upsertRecertificationStatusFromDecision`
i alle tre steder der en submission settes til COMPLETED:

- `src/modules/assessment/decisionService.ts` — linje ~152 (etter certification-kall)
- `src/modules/review/manualReviewService.ts` — tilsvarende punkt i override-kommando
- `src/modules/appeal/appealService.ts` — tilsvarende punkt i resolve-kommando

```typescript
// Inne i transaksjonsblokk, etter upsertRecertificationStatusFromDecision:
await checkAndIssueCourseCompletions({ userId, moduleId }, tx);
```

**Logikk:**
1. Finn alle publiserte kurs som inneholder `moduleId` (via `CourseModule`)
2. For hvert kurs: hent alle `moduleId`-er med `sortOrder`
3. Sjekk om bruker har `CertificationStatus.status = 'PASSED'` for samtlige moduler
4. Hvis ja og `CourseCompletion` ikke finnes → opprett (idempotent via `@@unique([userId, courseId])`)

**Feilhåndtering:** Trigger bør ikke blokkere beslutning ved feil.
Vurder `.catch()`-guard utenfor transaksjonen hvis streng isolering ønskes.

### Fremdriftsberegning (read-path)

Beregnes fra `CertificationStatus`, ikke fra `Submission`:

```
COMPLETED   — CertificationStatus.status = 'PASSED' for alle moduler i kurset
IN_PROGRESS — minst én bestått, ikke alle
NOT_STARTED — ingen bestått
```

Gjenbruker eksisterende certifikattabell. Ingen ny aggregering mot submissions.

---

## API-kontrakter

### Nye capabilities

```typescript
// src/config/capabilities.ts
{ id: "courses", prefix: "/api/courses",
  roles: [PARTICIPANT, SUBJECT_MATTER_OWNER, ADMINISTRATOR,
          APPEAL_HANDLER, REPORT_READER, REVIEWER] },
```

Admin-endepunkter legges under eksisterende `admin_content`-prefix — ingen ny capability.

### Deltaker-API

```
GET /api/courses
  → CourseListItem[] med courseStatus og progress per bruker

GET /api/courses/:courseId
  → CourseDetail med moduler i sortOrder, status per modul, courseStatus
```

**CourseListItem:**
```typescript
{
  id: string;
  title: string;           // lokalisert
  description: string | null;
  moduleCount: number;
  progress: {
    completed: number;
    total: number;
    courseStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  };
}
```

### Admin-API (`/api/admin/content/courses`)

```
POST   /api/admin/content/courses                    — opprett kurs
GET    /api/admin/content/courses                    — list alle kurs
GET    /api/admin/content/courses/:courseId          — hent kurs med moduler
PUT    /api/admin/content/courses/:courseId          — oppdater metadata
PUT    /api/admin/content/courses/:courseId/modules  — erstatt hele modullisten (courseId+moduleId+sortOrder[])
POST   /api/admin/content/courses/:courseId/publish  — publiser
POST   /api/admin/content/courses/:courseId/archive  — arkiver
```

Roller: `ADMINISTRATOR`, `SUBJECT_MATTER_OWNER` (arver fra `admin_content`).

### Rapport-API

```
GET /api/reports/courses
```

Returnerer per kurs: `enrolledParticipants`, `completedParticipants`, `completionRate`,
`moduleBreakdown[]` med `passRate` per modul.

Nevner (`enrolledParticipants`): alle brukere med minst én submission på minst én modul i kurset.

---

## UX-spesifikasjon

### Admin — Admin Content

- Ny **«Kurs»-fane** ved siden av «Moduler». Ingen ny side.
- Oppretting og redigering via modal/panel — ikke hel side.
- Modulvelger: søkefelt med chip-liste over valgte moduler.
- Rekkefølge: opp/ned-piler (ikke drag-and-drop i MVP).
- Publisering blokkert hvis kurs er tomt.
- Arkivering skjuler kurs for deltakere; moduler beholdes.

### Deltaker — `/participant`

Kurs vises som ekspanderbare seksjoner øverst, enkeltmoduler under:

```
▶  Kurs A  ·  2 av 4 bestått
   Modul 1 — Bestått ✓
   Modul 2 — Bestått ✓
   Modul 3 — Klar til å starte  →
   Modul 4 — (ikke påbegynt)

Enkeltmodul X  →
```

- Modulkort inni kurs er **identiske** med standalone-modulkort — ingen ny komponent.
- Klikk på modul → eksisterende modulflyt, uendret.
- Permalink `/participant/course/:courseId` eksisterer for deling, men er ikke primærflyt.

### Kursbevis

Vises automatisk i `/participant/completed` etter at siste modul er bestått.
Ingen ny navigasjonsflate — deltakeren oppdager det naturlig.

---

## Tilgjengelighetskrav

- Kursaccordion: tastaturstyrbar med korrekt ARIA-semantikk (`aria-expanded`, `aria-controls`)
- Rekkefølgeendring: opp/ned-piler (ikke drag-and-drop) — tilgjengelig uten pekeutstyr
- Alle skjemafelt: etiketter og hjelpetekster
- Status og progresjon: ikke kun farge
- Statustekster: annonsert via live regions
- Rapporttabeller: korrekt tabellesemantikk
- Fokusrekkefølge: manuell test i alle nye flyter før merge

---

## Implementasjonsrekkefølge

```
#277 Skjema (Prisma + migrasjon)
  ↓
#278 Admin API          #280 Deltaker API
  ↓                       ↓
#279 Admin UI          #281 Deltaker UI
  ↓                       ↓
       #282 Kursbevis
       #283 Rapportering
```
