# Enrollment / tildeling / frister (#496, Tier 2 / EPIC #478) — designdokument

> Status: **beslutningsdokument** — venter på retningsvalg før dekomponering i issues + implementering.
> Låser opp #497 (påminnelser), #498 (lærer-dashboard). Relatert: #495 (Q&A, uavhengig).

## Problem / mål
I dag returnerer `GET /api/courses` **alle publiserte kurs til alle deltakere** — ingen tildeling,
ingen frister, ingen «hvem skal ta hva når». For at plattformen skal være et *kursforløp* (Tier 2),
trenger vi: en SMO/admin **tildeler** et kurs til deltakere (individuelt eller per avdeling), med
**frist**, og deltakeren ser **«mine tildelte kurs»** med status og forfall. Status (fullført)
utledes av eksisterende `CourseCompletion`; forfall av fristen.

## Datamodell (forslag)
Ny `CourseEnrollment`:

| Felt | Type | Notat |
|---|---|---|
| id | String cuid | |
| userId | String | FK User (onDelete: Cascade — GDPR) |
| courseId | String | FK Course (onDelete: Cascade) |
| assignedById | String? | FK User (SMO/admin som tildelte; null for selv-påmelding) |
| source | enum | `INDIVIDUAL` \| `DEPARTMENT` \| `SELF` |
| dueAt | DateTime? | frist (valgfri) |
| assignedAt | DateTime | default now |
| revokedAt | DateTime? | myk fjerning (behold historikk/audit) |
| @@unique([userId, courseId]) | | én enrollment per bruker+kurs |

**Status er avledet, ikke lagret** (single source of truth):
`COMPLETED` (CourseCompletion finnes) → ellers `OVERDUE` (dueAt < nå) → ellers `IN_PROGRESS`
(noen moduler bestått / seksjoner lest) → ellers `ASSIGNED`. Unngår status-drift mot completions.

## Tre designbeslutninger jeg trenger fra deg

### 1. Synlighetsmodell — den viktigste
Hva styrer hvilke kurs en deltaker ser?
- **(A) Per-kurs `enrollmentPolicy`: `OPEN` vs `RESTRICTED`** ⭐ *anbefalt*. `OPEN` = synlig for alle
  (dagens oppførsel, bakoverkompatibelt — eksisterende kurs defaulter hit). `RESTRICTED` = kun
  synlig/tilgjengelig for tildelte. Gir både åpent katalog-kurs og obligatorisk-tildelt-kurs uten å
  bryte dagens flyt.
- (B) Global streng enrollment: deltaker ser KUN tildelte kurs. Enkelt, men bryter dagens
  «alle ser alt» og krever backfill-tildeling av alle eksisterende kurs.
- (C) Additivt: åpent katalog + «tildelt»-seksjon, men ingen tilgangssperre. Minst kontroll.

### 2. Avdelings-/cohort-tildeling — snapshot vs dynamisk
«Tildel til hele avdeling X»:
- **(A) Materialiser ved tildeling** ⭐ *anbefalt*: lag én `CourseEnrollment` per bruker i avdelingen
  *der og da* (source=DEPARTMENT). Stabil frist, reviderbar, enkел status. Nye ansatte etter
  tildeling får den ikke automatisk (kjør tildeling på nytt).
- (B) Dynamisk regel: lagre «avdeling X → kurs Y», beregn medlemskap on-the-fly. Fanger nye ansatte,
  men frist/status blir vanskeligere og mindre reviderbart.

### 3. Selv-påmelding på `OPEN`-kurs
Skal deltaker kunne melde seg på et OPEN-kurs selv (source=SELF, for «mine kurs» + frist=null), eller
er OPEN bare fritt synlig uten enrollment-rad? *Anbefalt: tillat selv-påmelding* så «mine kurs» blir
meningsfullt også for åpne kurs.

## Tilgang / roller
- **Tildele/fjerne:** `SUBJECT_MATTER_OWNER` + `ADMINISTRATOR`.
- **Se egne enrollments:** `PARTICIPANT` (+ admin/reviewer som har deltaker-tilgang).
- Tildelings-UI hører hjemme i kurs-admin (`admin-content-courses`).

## Flater som berøres (surface-map-disiplin — endre alle i samme arc)
1. `GET /api/courses` (participant.js): filtrer på synlighet + flagg «tildelt» + frist.
2. `/participant` kurs-trekkspill: vis frist + status-badge (ASSIGNED/OVERDUE).
3. `/participant/completed`: uendret (completions), men kan vise «tildelt»-kontekst.
4. Kurs-admin: ny tildelings-UI (velg brukere / avdeling, sett frist).
5. (#497) påminnelser leser `dueAt`. (#498) dashboard aggregerer enrollment-status per cohort.

## Foreslått dekomponering (issues, opprettes etter godkjent retning)
- **EN-1 datamodell + migrasjon:** `CourseEnrollment` + `enrollmentPolicy` på Course + repo.
- **EN-2 backend API + authz:** assign (individuell + avdeling), revoke, list-mine, list-per-kurs; synlighets-filter i `GET /api/courses`.
- **EN-3 admin tildelings-UI:** velg deltakere/avdeling + frist, se/fjern tildelte.
- **EN-4 deltaker-UI:** «mine tildelte kurs» m/ frist + status-badge; OVERDUE-markering; (evt. selv-påmelding).
- **EN-5 docs + e2e:** API_REFERENCE + route-map + brukerguide; e2e for tildel→deltaker-ser→frist-status.

## Hensyn
- **Bakoverkompat:** eksisterende kurs default `enrollmentPolicy=OPEN` → dagens «alle ser alt» bevares; ingen backfill av enrollments nødvendig.
- **GDPR:** `CourseEnrollment.userId` Cascade på User-sletting; med i anonymisering.
- **Audit:** assign/revoke logges (auditEvent) — hvem tildelte hvem hva når.
- **Status avledet** (ikke lagret) for å unngå drift mot `CourseCompletion` — samme lærdom som backfill-buggen (#627).

## Beslutninger jeg trenger
1. Synlighetsmodell: **A (per-kurs OPEN/RESTRICTED)**, B (global streng), eller C (additivt)?
2. Avdelings-tildeling: **A (materialiser)** eller B (dynamisk)?
3. Selv-påmelding på OPEN: ja/nei?
