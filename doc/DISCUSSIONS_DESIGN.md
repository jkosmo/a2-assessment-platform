# Discussions / Q&A — design (#495)

> Status: **implementert** (2026-06-27, v1.3.89–1.3.93). Tier-2-kapabilitet under epic #478.
> Datamodell, API, deltaker-UI, moderering, av/på-toggles og varsler er på plass.
> Brukerguide: `doc/DISCUSSIONS_GUIDE.md`. API: `doc/API_REFERENCE.md`.

## Mål

Q&A og diskusjon **i** plattformen, slik at et kurs kan levere et reelt læringsforløp uten at
deltakere må lenke ut. Tråder kan henge på **kurs-nivå** eller på en **konkret seksjon/modul** i
kurset. Innholdsprodusent kan skru diskusjon **av** per kurs, per modul og per seksjon.

## Besluttede valg

| # | Valg | Beslutning |
|---|------|-----------|
| 1 | Granularitet | Kurs-nivå **+** per `CourseItem` (seksjon/modul). Produsent kan skru av per kurs / modul / seksjon. |
| 2 | Semantikk | Tråd har `kind`: **SPØRSMÅL \| DISKUSJON**. Spørsmål kan markeres **RESOLVED** med ett akseptert svar (av spørrer eller SMO). Flat svarliste — ingen dyp nøsting (Tier 2). |
| 3 | Moderering | SMO/Admin: pin, lås, slett hvilket som helst innlegg (soft-delete), marker svar. Deltaker: opprett/svar + rediger/slett **egne**. |
| 4 | Varsling | Minimal: nytt **spørsmål** → kursets SMO; nytt **svar** → de som har deltatt i tråden (abonnement = «du postet her»). Gjenbruker ACS-infra. Preferanse-styring overlates til #497. |

## Prinsipper som *ikke* er til diskusjon

1. **Brukergenerert innhold er énspråklig.** Tråder/svar lagres som ren tekst på forfatterens
   språk — *ikke* `{en-GB,nb,nn}`-formen som authored content bruker. Locale styrer kun UI-chrome
   (knapper/labels), ikke selve innleggene.
2. **Strammere sanitering enn seksjoner.** Seksjoner tillater iframe/YouTube (#482). UGC i
   diskusjoner **må** rendres med en **restriktiv DOMPurify-allowlist uten iframe/rå-HTML** — kun
   grunnleggende markdown-formatering (avsnitt, lister, lenker, kode, fet/kursiv). Egen
   render-funksjon, ikke `renderSectionMarkdown`.
3. **Soft-delete, aldri hard-delete.** Slettede innlegg beholder rad (for trådintegritet/audit),
   vises som «Slettet innlegg». Anonymiserte brukere (`User.isAnonymized`) vises som «Slettet bruker».

## Datamodell

Nye modeller (speiler eksisterende konvensjoner i `prisma/schema.prisma`):

```prisma
enum DiscussionThreadKind   { QUESTION DISCUSSION }
enum DiscussionThreadStatus { OPEN RESOLVED LOCKED }

model DiscussionThread {
  id              String                 @id @default(cuid())
  courseId        String
  courseItemId    String?                // null = kurs-nivå board; satt = per seksjon/modul
  authorId        String
  kind            DiscussionThreadKind   @default(DISCUSSION)
  title           String                 // énspråklig UGC
  bodyMarkdown    String
  status          DiscussionThreadStatus @default(OPEN)
  acceptedReplyId String?                @unique  // satt når et svar er «løsning»
  pinnedAt        DateTime?
  createdAt       DateTime               @default(now())
  updatedAt       DateTime               @updatedAt
  deletedAt       DateTime?
  deletedById     String?
  course          Course                 @relation(fields: [courseId], references: [id])
  courseItem      CourseItem?            @relation(fields: [courseItemId], references: [id])
  author          User                   @relation(fields: [authorId], references: [id])
  replies         DiscussionReply[]
  subscriptions   DiscussionSubscription[]
  @@index([courseId, courseItemId])
}

model DiscussionReply {
  id           String   @id @default(cuid())
  threadId     String
  authorId     String
  bodyMarkdown String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  deletedAt    DateTime?
  deletedById  String?
  thread       DiscussionThread @relation(fields: [threadId], references: [id])
  author       User             @relation(fields: [authorId], references: [id])
  @@index([threadId])
}

model DiscussionSubscription {
  id        String   @id @default(cuid())
  threadId  String
  userId    String
  createdAt DateTime @default(now())
  thread    DiscussionThread @relation(fields: [threadId], references: [id])
  @@unique([threadId, userId])
}
```

Av/på-toggle (additiv, ikke-brytende — default `true`):

```prisma
// Course
discussionsEnabled  Boolean @default(true)
// CourseItem
discussionsEnabled  Boolean @default(true)
```

**Effektiv regel:** diskusjon er tillatt på et item ⇔ `Course.discussionsEnabled && CourseItem.discussionsEnabled`.
Kurs-nivå board ⇔ `Course.discussionsEnabled`. Toggle ligger på **`CourseItem`** (kursets
plassering av modulen/seksjonen), ikke på den delte `Module`/`CourseSection` — så å skru av i ett
kurs påvirker ikke samme modul i et annet kurs.

> Default `true` betyr eksisterende publiserte kurs får diskusjon på når feature lander.
> Akseptabelt for Tier-2-engasjement; produsent kan opt-out. Vurder en migrasjons-flagg hvis vi
> heller vil rulle ut «av som standard» — avklares i datamodell-sub-issuen.

## API (deltaker + moderering)

Forankret under kurs-stien så autorisasjon kan gjenbruke «har tilgang til publisert kurs».

| Metode | Rute | Rolle | Beskrivelse |
|--------|------|-------|-------------|
| GET  | `/api/courses/:courseId/discussions?itemId=` | deltaker+ | List tråder (kurs-nivå hvis `itemId` mangler) |
| POST | `/api/courses/:courseId/discussions` | deltaker+ | Opprett tråd (`kind`, `title`, `bodyMarkdown`, valgfri `courseItemId`) |
| GET  | `/api/courses/:courseId/discussions/:threadId` | deltaker+ | Tråd + svar |
| POST | `/api/courses/:courseId/discussions/:threadId/replies` | deltaker+ | Svar (auto-abonnerer forfatter) |
| PATCH | `/api/courses/:courseId/discussions/:threadId` | forfatter/SMO | Rediger egen / lås·pin·resolve·accept (SMO) |
| PATCH | `/api/courses/.../replies/:replyId` | forfatter/SMO | Rediger egen / soft-delete |
| DELETE | `/api/courses/.../:threadId` / `/replies/:replyId` | forfatter/SMO | Soft-delete |

- **Authz:** les/skriv krever publisert-kurs-tilgang (samme rollesett som `/api/courses`).
  Moderering (pin/lock/resolve/slett andres) krever ADMIN/SMO. Skriving blokkeres hvis diskusjon er
  avskrudd på scope, eller tråden er `LOCKED`.
- **Validering:** zod-skjema; `bodyMarkdown`/`title` lengdegrenser; `kind`/`courseItemId` konsistens
  (item må tilhøre kurset).
- **Rate limiting:** gjenbruk `generalApiLimiter`; vurder egen post-limiter mot spam.

## UI / IA

- **Deltaker (course player):** diskusjons-panel på kursforsiden (kurs-nivå) + «Spør / diskuter»
  ved hver seksjon/modul som har det påskrudd. Trådliste (pinned først, så nyeste aktivitet),
  trådvisning med flat svarliste, compose-boks. Spørsmål viser OPEN/LØST-merke + «marker som svar».
- **Forfatter/SMO:** av/på-toggles i kurs-editor (kurs-master + per item) + moderering inline i
  trådvisning (pin/lås/slett/marker svar).
- **i18n:** UI-chrome i alle tre locales (samme mønster som `participant.js`/admin-content).

## Varsling (MVP, koordineres med #497)

- Nytt **spørsmål** på et kurs → kursets SMO(er) (ACS-epost via `participantNotificationService`).
- Nytt **svar** → alle med `DiscussionSubscription` på tråden (du abonnerer automatisk når du
  oppretter/svarer). Abonnement kan slås av per tråd.
- Nye notification-typer + locale-keyed templates i `notificationMessages.ts`. Audit via
  `recordAuditEvent` (entityType `discussion`/`discussion_reply`).
- Preferanse-/digest-styring er **ikke** i scope her — #497 eier varslings-preferanser.

## Sub-issue-dekomponering (under #478, refererer #495)

1. **T-QA-1 Datamodell + migrasjon** — Discussion*-modeller + `discussionsEnabled`-felter (expand-contract, default-beslutning).
2. **T-QA-2 Backend API + authz + UGC-sanitering** — ruter, zod, rollevakt, scope/lock-håndheving, restriktiv markdown-render.
3. **T-QA-3 Deltaker-UI** — trådliste/visning/compose i course player + e2e.
4. **T-QA-4 Forfatter/SMO** — av/på-toggles i kurs-editor + moderering (pin/lås/resolve/accept/slett) + e2e.
5. **T-QA-5 Varsler** — spørsmål→SMO, svar→abonnenter, templates + audit (koordiner #497).
6. **T-QA-6 Docs** — `API_REFERENCE.md`, `route-map.md`, brukerguide (deltaker + forfatter).

## Avhengigheter / merknader

- Bygger på `CourseItem`-polymorfien (#480). Verifiser at expand-contract-migreringen er ferdig nok
  til at `courseItemId`-FK er trygg før T-QA-1.
- Overlapper #497 (varsler) — hold varsling minimal her.
- Fremtid (Tier 3, ikke nå): @-mentions, reaksjoner, vedlegg, full søk, dype tråder.
