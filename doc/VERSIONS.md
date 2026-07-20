# Versions

This document tracks release versions and what each version includes.

## 2.1.3 - 2026-07-19

fix(privacy): #806 — slutt å skrive person-PII (e-post) i evig-lagret audit-metadata (GDPR)

Pseudonymisering skrubber User-raden, men audit-metadata beholdt original e-post i evig-lagrede
AuditEvent-rader → en «pseudonymisert» brukers e-post var fortsatt direkte søkbar (bryter
u-lenkbarhet). Forward-fix — nye hendelser lagrer kun stabil id, ikke e-post/navn:

- **recertification_reminder_sent/failed** (`recertificationService.ts`): fjernet `recipientEmail`
  fra metadata; beholder `userId` (+ certificationId, moduleId, kanal, leveringsstatus). E-posten
  brukes fortsatt til å SENDE påminnelsen — den persisteres bare ikke.
- **org_sync_record_failed** (`orgSyncService.ts`): fjernet `email` fra metadata; `externalId`
  identifiserer den feilede posten uten PII (matcher allerede den deklarerte metadata-typen).

Operasjonell logg (`console.log`, begrenset oppbevaring) beholder e-post for leveringsfeilsøking —
ikke den evig-lagrede audit-tabellen. Historisk skrubb av eksisterende rader er egen sak (henger
sammen med payloadHash-invalidering, #D2/#806-oppfølger). Ingen leser e-post ut av audit-metadata,
så ingen lese-side påvirkes.

Tester: unit-assertions på at recert-metadata ikke har recipientEmail/recipientName. tsc + berørte
unit-suiter grønne. Backend-only.

## 2.1.2 - 2026-07-19

fix(ui): QA runde 6 — ekte slank eier-stripe, forklart bestått-avvik, klasse-rader i stedet for chips

- **Eier-stripa faktisk slank** (QA #1): r5-fiksen tapte kaskaden mot side-nivå `.detail-section`-padding
  (side-styles lastes etter shared.css og vinner ved lik spesifisitet). Padding settes nå inline fra
  owner-panel.js (vinner alltid), og «Rediger»-knappen fikk `min-height:0` (global
  `button{min-height:40px}` blåste opp høyden). Målt: 36px (var ~54+). Permanent boundingBox-assertion
  (≤52px) i e2e piner fiksen.
- **«Bestått 100 % men ingen består» forklart** (QA #2): Bestått-andel-kortet viser den LAGREDE andelen
  (avgjørelsene da svarene ble scoret). Når den avviker fra hva dagens grense ville gitt, viser kortet nå
  eksplisitt «Ved dagens grense (70) ville bare 0 % av de lastede svarene bestått» — og oppdateres live
  når grensa endres.
- **Klasse-detalj: rader i stedet for grå chips** (QA #3): Studenter og Tildelte kurs bruker nå samme
  rad-språk som eier-panelet (navn + meta, skillelinje, slank «Fjern» til høyre).

**Prosess:** visuell verifikasjon lokalt før deploy (headless render + måling + skjermbilder inspisert)
er nå standard for CSS/layout-endringer — stage brukes som akseptanse, ikke feilsøking.

e2e: avviks-notis-assertions + stripe-høyde; alle 106 grønne.

## 2.1.1 - 2026-07-19

fix(ui): QA runde 5 — tynn eier-stripe, modul-navigasjon/tittel, MCQ-bevisst Vurderingskvalitet, klasse-kort

- **Eier-stripa vesentlig tynnere** (QA #1): verts-kortet slankes til en stripe i kompakt modus
  (`.owner-host--compact`, 6px padding). Navn får e-post-tooltip (to eiere med samme navn er to ulike
  brukere, f.eks. mock- + Entra-identitet).
- **«← Tilbake til modulliste»** (QA #2): begge modul-editorene har nå back-link øverst, som Kurs.
- **Tittel-plassering** (QA #3): back-link + «Modul»-tittel (+ Samtale/Avansert-bryter) står nå øverst
  under sub-nav-en — før status-rail, eiere og GDPR-notis — i stedet for strandet midt på siden.
- **Vurderingskvalitet er modus-bevisst** (QA #4): for **MCQ-moduler** avgjøres bestått av MCQ-prosenten
  (mcqMinPercent, standard 70) — lagret totalScore er MCQ-en skalert inn i vektings-båndet sitt, så
  total-histogrammet/grensa var misvisende («Bestått 100 %» men søyle under grensa). MCQ-moduler viser nå
  MCQ-minimum-regelen med forklarende notis; histogram/total/preview skjules. Publisering beholder
  totalMin uendret og sender redigert mcqMinPercent. Signal-kortet fikk også en notis om at bestått-andelen
  bygger på lagrede avgjørelser (reglene ved scoring-tidspunkt).
- **Klasse-kort med hvit bakgrunn** (QA #5): `.detail-section` på klasse-siden fikk surface-bakgrunn + skygge.

e2e: ny MCQ-only-test i `vurderingskvalitet.spec.ts`; alle 106 admin-content-e2e grønne.

## 2.1.0 - 2026-07-19

feat(quality): #836 «Vurderingskvalitet» — rebrand + konsolidering av kalibrering

Erstatter den forvirrende «Kalibrering»-flata (som lovde et slider/what-if-verktøy som aldri ble bygget)
med et ærlig **vurderingskvalitet-dashboard**. Interaksjonsdesign godkjent av produkteier; fire
beslutninger + eier/kurs-filter låst.

- **Én flate** (`/admin-content/calibration`, rebrandet «Vurderingskvalitet»). Foreldet `/calibration`
  (prototyp uten nav-lenke) **fjernet** → 301 til den kanoniske flata. Avansert-editorens kalibrerings-fane
  ble skjult i 2.0.16.
- **Eier- + kurs-filter** på modul-velgeren (default «Mine moduler») så lista holdes kort. Backend:
  `listLibraryModules` returnerer nå `ownedByMe` (join `ContentOwner`), drevet av innlogget bruker (#787 #5).
- **Signal-kort** med farge (bra/se-på/kritisk) + ren tekst i stedet for `<pre>`-dump og rå flagg-koder.
- **Poengfordeling-histogram** med bestått-grensa tegnet inn.
- **Kontekstuelle terskler** — total alltid; MCQ-/praktisk-minimum kun når modulens policy bruker dem.
- **Klient-side konsekvens-preview** — «X av Y siste svar består ved ny grense», med delta.
- **Versjons-nedtrekk** (ikke fritekst-CUID), **publiser-med-konsekvens**-bekreftelse, og **fikset** den rå
  i18n-nøkkelen på suksess-toasten. Referanse-svar: lenke inn i modul-editoren.
- **Bug fikset:** `getHeaders` var et objekt, så `apiFetch(url, getHeaders, {method,body})` slapp POST-body
  (publisering sendte en tom GET). `getHeaders` er nå en funksjon.

Ny e2e `test/e2e/vurderingskvalitet.spec.ts` (filtre → last → signaler → histogram → preview → publiser →
lokalisert toast; + access-denied). 105 admin-content-e2e + 2 nye grønne; tsc rent.

## 2.0.16 - 2026-07-19

fix(ui): #787 QA runde 4 — fjern dobbel-meny i Avansert + kompakt eier-panel

- **Dobbel meny i Avansert** (QA #1): den nye innholds-sub-nav-en (2.0.15) kolliderte med Avansert-editorens
  gamle interne fane-rad (Moduler/Kurs/Kalibrering). De interne fanene er utdatert — Kurs og Kalibrering
  har egne ruter nådd via topp-nav-en. Fane-raden skjules nå (`display:none`), så Avansert er rent
  modul-editoren. (Konsoliderer også bort Avansert sin kalibrerings-fane, jf. #836.)
- **Kompakt eier-panel** (QA #2): «Eiere» er nå en slank én-linje som standard («Eiere: Navn A, Navn B»)
  med en «Rediger»-lenke; hele legg-til/fjern-UI-et utvides kun ved behov. Eierskap vises ofte, endres
  sjelden — panelet tar nå minimalt med plass til det faktisk skal endres.

e2e (`content-owner-surfaces` + `content-owner-panel`) oppdatert for kompakt-standard (verifiser kompakt
visning, utvid for administrasjon). 44 berørte specs grønne.

## 2.0.15 - 2026-07-19

fix(ui): #787 QA runde 3 — konsistens på innholds-flatene (tittel, sub-nav, eier-plassering)

- **Modul-editor-titler** (QA #1/#2): «Innholdsarbeidsrom» (samtale) og «Arbeidsflate for innholdsoppsett»
  (avansert) → **«Modul»** (som Kurs/Klasse bruker innholdstype-navnet). Redigeringsmodus vises allerede
  av Samtale/Avansert-bryteren, og modulnavnet av state-rail-en.
- **Innholds-sub-nav** (QA #3): begge modul-editorene får nå samme topp-meny som Kurs/Seksjoner
  (Kurs · Moduler · Seksjoner · Kalibrering), med «Moduler» aktiv. Kalibrering-lenken er rolle-gated
  likt de andre sidene (både samtale-shell og avansert).
- **Eier-plassering** (QA #4): «Eiere» står nå **øverst** på alle fire flatene. Kurs og Modul var alt
  øverst; Seksjon og Klasse flyttet fra bunn til topp for konsistens.

Kalibrering (QA #5) tas som eget interaksjons-design-spor (#836) — ikke i denne releasen.

Ny e2e-dekning i `content-owner-surfaces.spec.ts` (sub-nav aktiv-state + tittel på avansert). Ingen
regresjon i de 61 berørte admin-content-e2e-ene.

## 2.0.14 - 2026-07-19

fix(auth): #787 QA runde 2 — owner-panel på de faktisk manglende flatene + kompakt GDPR-varsel

QA-runde 1 (2.0.13) trodde modul-avansert var dekket, men **avansert-editoren kjører `admin-content.js`**
(egen `updateStateRail`), ikke samtale-shellen (`admin-content-shell.js`) — så owner-panelet ble aldri
rendret der. Denne runden fikser de tre gjenstående flatene, hver bevist med en Playwright-e2e som
driver den ekte front-end-JS-en:

- **Modul-avansert** (`admin-content.js`): owner-panel rendres nå fra `setSelectedModule` inn i
  `#moduleOwnerPanelHost` (én gang per modul-id), uavhengig av om modul-status er ferdig hentet. QA #1.
- **Klasse** (`admin-content-classes.js`): owner-panel i `openClass`-detaljvisningen — klasser var aldri
  koblet for eierskap. QA #2.
- **Seksjon**: e2e bekrefter at editor-visningen allerede rendrer panelet for eksisterende seksjoner
  (åpne en seksjon via `?id=`); panelet vises i editoren, ikke i liste-visningen. QA #3.
- **GDPR-varsel**: gjort kompakt (én linje, mindre skrift, lettere ramme) på begge modul-editorene så
  det ikke dominerer arbeidsflaten. QA #5 (plassering/størrelse).

Ny e2e: `test/e2e/content-owner-surfaces.spec.ts` (3 tester). Ingen regresjon i de 55 berørte
admin-content-e2e-ene.

## 2.0.13 - 2026-07-19

feat(auth): #787 QA #2/#4 — owner-panel på modul- + seksjon-flatene

Kobler det gjenbrukbare owner-panelet (samme som kurs) inn på de resterende innholds-flatene:
- **Seksjon-editor** (`admin-content-sections.js`): panel for eksisterende seksjoner (nye har ingen id enda).
- **Modul-arbeidsflate** (`admin-content-shell.js` + `admin-content.html` + `admin-content-advanced.html`):
  panel under «Modulstatus»-raden når en modul er lastet — dekker BÅDE samtale- og avansert-modus (begge
  bruker samme shell/`updateStateRail`). Rendres én gang per modul (guardet), skjules når ingen modul.

Inert (eksponerer bare eier-API-et). Panel-logikken er e2e-dekket (kurs-spec); wiringen er mekanisk +
syntaks-verifisert, og eksisterende admin-content-e2e-specs fanger side-brudd. → `deploy-app.yml`.

## 2.0.12 - 2026-07-19

fix(auth): #787 QA #6 — eiere er lesbare for enhver SMO/admin (panelet vises på innhold du ikke eier)

GET-eiere var gated på eierskap, så åpnet du et kurs du ikke eide fikk owner-panelet 403 og viste ikke.
Nå: enhver content-admin kan SE eiere (transparens); kun eier/admin kan ENDRE (POST/DELETE gated).
GET returnerer `canManage` så UI-en skjuler legg-til/fjern for ikke-eiere.

- `contentOwners.ts`: GET capability-gated + `canManage`. `owner-panel.js`: skjul kontroller når
  `!canManage`. Tester (integrasjon + e2e read-only) oppdatert.

## 2.0.11 - 2026-07-19

fix(ui): #787 — owner-panel styling matcher design-systemet (liten «Fjern»-knapp, design-tokens)

Rettet at «Fjern» ble full-bredde (global `button { width: 100% }`-felle) + brukte ad-hoc-farger. Nå:
design-tokens (`--color-*`, `--space-*`), `btn-secondary` + `width:auto` på knappen, ryddig rad-layout.
Kun CSS + én klasse → `deploy-app.yml`.

## 2.0.10 - 2026-07-19

feat(auth): #787 skive 5 — owner-forvaltnings-UI (gjenbrukbart panel, koblet på kurs-siden)

Femte skive. **Inert** — eksponerer bare eier-API-et (`/api/admin/content-owners`) i UI-et; endrer ingen
redigerings-oppførsel. Lar admins/eiere *se og forvalte* eiere (og verifisere backfill-en) **før**
håndhevelsen (skive 4) slår inn.

- **`public/static/owner-panel.js`:** gjenbrukbart panel — lister eiere, søk-og-legg-til (via
  `/users/search`), fjern-per-eier, med human-readable feilmeldinger (siste-eier osv.). Tar container +
  contentType + contentId, så samme komponent kan dryppes på seksjon/klasse/modul-flatene senere.
- **`admin-content-courses.js`:** koblet inn i kurs-detaljvisningen (`#ownerPanelHost`).
- **`shared.css`:** minimal styling. **`test/e2e/content-owner-panel.spec.ts`:** last → render → søk-legg-
  til → fjern (mot mocket API).

**Utrulling:** kun klient-kode → `deploy-app.yml`. Ingen migrasjon, ingen atferdsendring. Neste (skive 4):
håndhevelse — koble guarden på skrive-/slette-stiene (den eneste atferdsendringen).

## 2.0.9 - 2026-07-19

chore(auth): #787 — backfill kurs/seksjon-eiere fra «opprettet»-audit (før håndhevelse)

Forberedelse til eierskaps-håndhevelsen (skive 4). Kurs/seksjoner mangler `createdById`, så uten dette
ville de vært eierløse → admin-only når håndhevelsen slår inn. Denne data-migrasjonen utleder eier fra
den tidligste `course_created`/`section_created` audit-eventens aktør.

- **Migrasjon `20260719140000_backfill_course_section_owners`:** INSERT eier per kurs/seksjon fra audit-
  aktør (ikke-null actorId ⇒ gyldig User, siden actor-FK er SetNull). Idempotent (NOT EXISTS). Innhold
  uten «created»-audit forblir eierløst (admin-styrt) — bevisst.

**Utrulling:** data-only migrasjon (kun INSERT i `ContentOwner`), kjøres ved oppstart → `deploy-app.yml`.
Kjører mot tomme tabeller i CI (0 rader), mot ekte data på stage/prod. **Stage først.** Neste: håndhevelse.

## 2.0.8 - 2026-07-19

feat(auth): #787 skive 3 — eier-forvaltnings-API (`/api/admin/content-owners`)

Tredje skive. **Nye endepunkter** (ingen eksisterende oppførsel endres):
- `GET /:contentType/:contentId` — list eiere (med navn/e-post)
- `POST /:contentType/:contentId` `{ userId }` — legg til med-eier (idempotent)
- `DELETE /:contentType/:contentId/:userId` — fjern eier (siste-eier-beskyttet)

To-lags authz: mount krever `admin_content` (SMO/ADMIN), og hver handler kaller `assertContentOwnership`
så bare en eier (eller admin) av *det* objektet kan forvalte dets eiere. Siste-eier kan ikke fjernes av
ikke-admin (hindrer foreldreløst innhold); admin kan (→ eierløst = admin-styrt). Alle mutasjoner
audit-logges (`content_owner_added`/`_removed`).

- **`src/routes/contentOwners.ts`** (Zod-validert), mount i `app.ts`, `src/modules/content/
  contentOwnershipService.ts` (add/remove/list), audit-actions/entity-type i `auditEvents.ts`.
- **`test/m2-content-owners-api.test.ts`:** eier + admin forvalter; ikke-eier blokkert; siste-eier
  beskyttet; eierløst → admin-only. Agent-tokens blokkeres (global `enforceAgentTokenScope`).

**Utrulling:** kun nye endepunkter → `deploy-app.yml`. Ingen migrasjon. Neste (skive 4): koble guarden
på eksisterende skrive-/slette-stier (den eneste atferdsendringen — grundig stage-QA der).

## 2.0.7 - 2026-07-19

feat(auth): #787 skive 2 — eierskaps-guard (`assertContentOwnership`)

Andre skive. **Inert** — ingenting kaller guarden enda (skive 4 kobler den på skrive-/slette-stiene), så
ingen atferdsendring. Generaliserer den gamle single-eier `assertModuleOwnership` til multi-eier-settet.

- **`src/modules/content/contentOwnershipService.ts`:** `decideOwnershipAccess` (ren beslutning: admin
  alltid tillatt; ellers må aktør være i eier-settet; tomt sett → eierløst = admin-only), pluss
  `listContentOwnerUserIds` + `assertContentOwnership` (kaster `ForbiddenError` `content_ownership` /
  `content_unowned`).
- **`test/unit/content-ownership.test.ts`:** hele tilgangs-matrisen (kjørt lokalt, ingen DB).

**Utrulling:** kun ny (ubrukt) kode → `deploy-app.yml`. Ingen migrasjon, ingen atferdsendring.
Neste skive: eier-API (`GET/POST/DELETE /owners`).

## 2.0.6 - 2026-07-19

feat(auth): #787 skive 1 — `ContentOwner`-tabell + backfill (multi-eier-fundament)

Første skive av eierskaps-funksjonen (design: `doc/design/CONTENT_OWNERSHIP_787.md`). **Rent additivt —
ingenting leser tabellen enda** (guard/API/UI kommer i senere skiver), så ingen atferdsendring.

- **`prisma/schema.prisma` + migrasjon `20260719130000_add_content_owner`:** polymorf `ContentOwner`
  (contentType + contentId + userId, unik per (type,innhold,bruker), FK userId→User onDelete Cascade),
  enum `ContentOwnerType {COURSE, SECTION, CLASS, MODULE}`, `User.contentOwnerships` back-relasjon.
- **Backfill (Q3: oppretter = første eier):** `Class.createdById` + `Module.createdById` → første eier.
  Course/CourseSection har ingen `createdById` → forblir eierløse (admin-styrt til eier tildeles).
- **`test/m2-content-owner.test.ts`:** modell + unikhet + cascade.

**Utrulling:** additiv migrasjon (ny tabell, ingen endring på eksisterende), kjøres ved web-oppstart →
`deploy-app.yml`. **Stage først; hvis sunn → prod.** Rollback: DROP TABLE + TYPE. Neste skive: guard.

## 2.0.5 - 2026-07-19

perf(data): #800 — additive secondary indexes on hot assessment/course fact tables

Første migrasjon fra arkitektur-gjennomgangen (epic #780). MCQAttempt/MCQResponse/LLMEvaluation/
CourseCompletion/CertificationStatus hadde ingen sekundær-indekser; foreign keys lager ikke disse
automatisk, så hot-spørringer (last en innleverings MCQ-forsøk/-svar/LLM-evalueringer; kurs-fullførings-
tellinger per kurs; sertifiserings-tellinger per modul/status) skannet voksende barn-tabeller.

- **`prisma/schema.prisma` + migrasjon `20260719120000_add_hot_table_indexes`:** 5 additive indekser —
  `MCQAttempt(submissionId, completedAt)`, `MCQResponse(mcqAttemptId)`, `LLMEvaluation(submissionId,
  createdAt)`, `CertificationStatus(moduleId, status)`, `CourseCompletion(courseId, completedAt)`.

**Utrulling:** additiv DB-migrasjon (ingen data-/atferdsendring). Migrasjonen kjøres ved web-oppstart
(`prisma migrate deploy` i `startup.mjs`), så **`deploy-app.yml`** holder — ingen Bicep-endring. Additivt
→ rekkefølge web/worker er uproblematisk. **Stage først; hvis sunn → prod.** Tabellene er små, så
CREATE INDEX er umiddelbar (bruk CONCURRENTLY i fremtidig migrasjon hvis de vokser). Rollback: DROP INDEX.

## 2.0.4 - 2026-07-19

fix(security): #786 — content-asset object-level authorization (IDOR)

Epic #778, andre skive. `getSectionAssetContent` hentet asset kun på ID uten å sjekke seksjon/kurs/
enrollment, så enhver innlogget bruker med en asset-ID kunne hente media fra en restricted/upublisert
seksjon.

- **`src/modules/course/enrollmentService.ts`:** ny `isSectionInAccessibleCourse` — er seksjonen del av
  et publisert kurs deltakeren har tilgang til (via `CourseItem.sectionId` → synlighet).
- **`src/modules/course/assetCommands.ts` + `src/routes/contentAssets.ts`:** `getSectionAssetContent`
  tar nå en `viewer`; deltaker må ha tilgang til seksjonens publiserte kurs, forfattere (SMO/ADMIN)
  bypasser for draft-preview. 404 (ikke 403) ved nekt.
- **Tester:** ny `test/m2-section-asset-authz.test.ts` (uinnmeldt→404, innmeldt→200, forfatter-bypass på
  kursløs seksjon→200). Eksisterende `m2-section-assets.test.ts`: de tre deltaker-serve-casene lenker nå
  seksjonen inn i et publisert OPEN-kurs (den realistiske stien) — gammel oppførsel serverte assets fra
  kursløse seksjoner, som var nettopp sårbarheten.

**Utrulling:** kun app-kode → `deploy-app.yml`. Ingen skjemaendring. Rollback: fjern `viewer`-sjekken.
Lukker #786.

## 2.0.3 - 2026-07-19

fix(security): #785 — restricted-course authorization on direct endpoints (IDOR)

Arkitektur-gjennomgangens topp-prioritet (epic #778). Kurs-LISTE-endepunktet filtrerte RESTRICTED-kurs
på enrollment/klasse-synlighet, men de direkte endepunktene (detalj, seksjonsinnhold, marker-lest) gated
kun på `publishedAt` — så en innlogget, uinnmeldt deltaker med en RESTRICTED kurs-ID kunne lese hele
sekvensen + seksjonsinnhold og skrive lese-progresjon.

- **`src/modules/course/enrollmentService.ts`:** ny `isCourseVisibleToUser` — enkelt-kurs-synlighet
  (OPEN kortslutter; RESTRICTED krever enrollment ELLER klasse-tildeling), speiler liste-logikken.
- **`src/routes/courses.ts`:** guard på `GET /:courseId`, `GET /:courseId/sections/:sectionId`, og
  `POST /:courseId/sections/:sectionId/read` — 404 (ikke 403) når ikke synlig.
- **`test/m2-course-restricted-visibility.test.ts`:** uinnmeldt → 404 ×3 (og ingen lese-rad skrevet);
  innmeldt → 200/200/204; OPEN uendret (200).

**Utrulling:** kun app-kode → `deploy-app.yml`. Ingen skjemaendring. Rollback: fjern guardene.
`enrollmentPolicy` defaulter til OPEN, så eksisterende kurs er upåvirket. Lukker #785. (#786 asset-IDOR
kommer som egen PR — bredere test-endring.)

## 2.0.2 - 2026-07-19

fix(security): nøytraliser CSV-formel-injeksjon i rapporteksport

Andre findings→action fra arkitektur-gjennomgangen (`doc/design/ARCHITECTURE_REVIEW_2026-07-19.md`,
CONFIRMED i Fase 4). `escapeCsvValue` håndterte anførselstegn/skilletegn men lot celler som starter med
`=`, `+`, `-`, `@`, tab eller CR stå urørt. Eksportene inneholder forfatter-/deltaker-kontrollert tekst
(modul-/kurstitler, navn), så en tittel som `=HYPERLINK(...)` kjøres som formel når en report-reader
åpner CSV-en i Excel/Sheets (CWE-1236 → phishing/eksfiltrering fra deres maskin).

- **`src/modules/reporting/csvExport.ts`:** prefiks apostrof på **string-celler** som starter med en
  formel-trigger (spreadsheets tolker det som «tving tekst» og skjuler det). Kun string-celler, så
  tall (f.eks. negative `-5`) og datoer forblir urørt.
- **`test/csv-formula-injection.test.ts`:** dekker triggere, ekte `=HYPERLINK`, og at tall/datoer og
  vanlig tekst ikke korrumperes.

**Utrulling:** kun app-kode → `deploy-app.yml`. Rollback: fjern formel-guarden.

## 2.0.1 - 2026-07-19

fix(security): sett `trust proxy` — hindre at anonym IP-basert rate-limiting kollapser til én delt bøtte

Første findings→action fra arkitektur-gjennomgangen (`doc/design/ARCHITECTURE_REVIEW_2026-07-19.md`).
Rate-limiterne (`src/middleware/rateLimiting.ts`) nøkler anonyme kall på `req.ip`. Uten `trust proxy`
bak Azure App Services front-end blir `req.ip` proxy-ens IP — lik for alle — så alle anonyme klienter
deler én bøtte, og én støyende klient gir `429` til alle andre anonyme deltakere (selv-påført throttle).

- **`src/app.ts`:** `app.set("trust proxy", 1)` — stol på nøyaktig ett proxy-hopp, så `req.ip` løses
  fra `X-Forwarded-For` til den reelle klienten. `1` (ikke `true`) hindrer at en klient spoofer XFF.
- **`test/trust-proxy.test.ts`:** guard-test som feiler hvis innstillingen fjernes.

**Utrulling:** kun app-kode → `deploy-app.yml`. Lavrisiko atferdsendring (påvirker `req.ip`-utledning
for logging + rate-limit-nøkkel). Rollback: fjern linja.

## 2.0.0 - 2026-07-19

**Milepæl — Tier 2 LMS komplett (#478): fra assessment-motor til kursforløp.** Med kohort-status-
dashboardet (#498) er alle «Done når»-pilarene i Epic #478 levert (innhold ✓ vurdering ✓ progresjon ✓
varsling ✓ dashboard ✓). Major-bump markerer at plattformen har utviklet seg fra en ren
vurderings-motor til en kurs-basert LMS.

feat(dashboard): #498 — lærer/SMO kohort-status-dashboard (siste Tier 2-pilar, lukker #478)

Ny «Status»-fane under «Deltakere»-området (`/deltakere/status`): velg et kurs → se deltakernes
enrollment-status (**Tildelt / Påbegynt / Forfalt / Fullført**) aggregert over kursets **effektive
audience** (individuelle CourseEnrollment + klasse-tildelte medlemmer), med per-klasse-breakdown.
Siste «Done når»-pilar i Epic #478 (Tier 2 LMS).

- **Backend:** `cohortStatusService.ts` — `resolveCourseAudience(courseId)` (kurs-scoped, individuell +
  klasse-ekspandert audience, presedens individuell>klasse/tidligste klasse-frist, MANUAL + «Alle
  deltakere», hopper over ENTRA) + `getCohortStatus` (status-count-aggregat + per-klasse via
  `deriveStatus`). Ny `classRepository.findCourseGroupAssignmentsForCourse` (kurs-scoped, uten
  dueAt-filter). Read-time-analog av påminnelses-jobbens audience-ekspansjon.
- **API:** ny capability `cohort_dashboard` (`/api/cohort-status`, roller SMO/ADMIN/REPORT_READER) +
  `cohortStatus.ts`-router: `GET /courses` (publiserte kurs-picker) + `GET /course/:id` (aggregat).
- **UI:** `cohort-status.html` + `cohort-status.js` + `cohort-status-translations.js` (nb/nn/en).
  Ny «Status»-fane i `deltakere-subnav.js` (rollegated) + i de andre Deltakere-sidenes bar.
- **Tester:** integrasjon (aggregat med individuell+klasse-ekspansjon, per-klasse, /courses-picker,
  403 for PARTICIPANT) + e2e (picker→last→status-kort+per-klasse, aktiv fane, rollegating). tsc grønn.
- **Design-writeup:** `doc/design/COHORT_STATUS_DASHBOARD_498.md` (beslutninger + trade-offs + neste
  steg) for review.

**Kjent MVP-avgrensning:** `deriveStatus` kjører 1–2 spørringer per deltaker (N+1); greit for typiske
kohorter, batch ved store. Individuelle enrollments filtreres ikke på aktiv/anonymisert (klasse-medlemmer
gjør det). Detaljer i writeup-en.

**Utrulling:** kun server+klient-kode, ingen migrasjon. **Går kun til stage foreløpig** (ikke prod).

## 1.6.37 - 2026-07-18

chore(observability): #497-incident — ekstern availability-test + alert på worker-rollens /healthz

Oppfølging etter worker-startup-hendelsen: worker var nede ~75 min uten at vi visste det, fordi den
eneste eksterne tilgjengelighetstesten pinget kun web-appens `/healthz`. Worker-rollen eksponerer samme
`/healthz`, men hadde ingen ekstern overvåking.

- **`infra/azure/main.bicep`:** ny `workerHealthzAvailabilityTest` (webtest, EMEA ×2) + `workerHealthz
  AvailabilityAlert` (metric-alert, failedLocationCount 2/2) som pinger worker-appens `/healthz` og
  pager samme action group som web-testen. Speiler det eksisterende web-mønsteret (#405); additiv,
  rører ingen identitet/KV/credential/parent-invariant.
- **`doc/ops/WORKER_STARTUP_STORM_2026-07-18.md`:** incident-retro — tidslinje, rotårsak (oppstarts-
  tilkoblingsstorm mot burstable DB), tiltak (herding 1.6.35 + denne overvåkingen), restlæring
  (DB-kapasitet), og gjenopprettings-steg.

**Utrulling:** infra-endring → **full deploy** (`deploy-azure.yml`) + prod what-if først. Additiv og
lavrisiko (kun to nye Insights-ressurser, gated på `createObservabilityActionGroup`). Rollback:
fjern de to ressursene. **Ingen app-atferdsendring.**

## 1.6.36 - 2026-07-18

feat(participant): #767 — «Mine kurs»-område (Pågående/Fullførte) + kurs-fokusert UI på deltaker-sidene

Fokuset er kurs, ikke moduler. Toppmeny-punktet «Deltaker» var modul-sentrisk og kolliderte med det nye
«Deltakere»-området (#765). De to deltaker-sidene er nå samlet og kurs-innrammet.

- **Toppnav:** «Deltaker» → **«Mine kurs»** (nb «Mine kurs» / nn «Kursa mine» / en «My courses»). Løser
  entall/flertall-forvirringen mot «Deltakere».
- **Undernavigasjon:** «Fullførte moduler» er ikke lenger et eget toppmeny-punkt. Ny felles sub-nav
  (`public/static/mine-kurs-subnav.js`): **Pågående** (`/participant`) · **Fullførte**
  (`/participant/completed`). Aktiv fane settes ut fra URL (mest spesifikke path vinner).
- **Overskrifter/terminologi (modul→kurs der riktig):** `/participant` H1 → «Mine kurs» + deltaker-
  vennlig undertittel; `/participant/completed` H1 → «Fullførte», leder med «Mine kursbevis», deretter
  «Fullførte moduler»-tabellen. Beholdt «modul» der det gjelder moduler inne i et kurs.
- **«Min historikk» fjernet fra Pågående-siden** — den overlappet med «Fullførte»-fanen (som nå er
  hjemmet for det man har gjort); Pågående-kurs-trekkspillet viser allerede per-modul-status.
- **Dev-scaffolding:** allerede skjult i prod (mock-identitetskort / modul-liste / debug).
- **Tester:** e2e (sub-nav aktiv-fane + prefix-matching, kurs-innramming) + oppdatert oversettelses-
  parity. tsc grønn. route-map oppdatert.

Kun server+klient-kode, ingen migrasjon. **Går kun til stage foreløpig.**

## 1.6.35 - 2026-07-18

fix(worker): herd oppstart mot connection-pool-storm som crashet prod-worker (#497-incident)

**Hendelse (2026-07-18):** etter prod-deploy av 1.6.33 klarte ikke worker-rollen å starte. Ved oppstart
fyrte alle seks bakgrunns-monitorene sin første DB-spørring samtidig → Prisma connection-pool (limit 10)
gikk tom mot den burstable Postgres-en → `Bus error (core dumped)` / exit 135 → warmup-timeout → Azure
stoppet worker-siten. Web-appen var upåvirket (frisk `/healthz`). Mitigert med worker-restart (kom opp
på nytt forsøk — transient storm). Denne fiksen hindrer gjentakelse.

- **Spredt oppstart:** `src/index.ts` starter nå de seks monitorene med en forsinkelse mellom hver
  (`WORKER_STARTUP_STAGGER_MS`, default 3000 ms), så første tick ikke treffer DB samtidig. Assessment-
  workeren starter først (ingen forsinkelse) så køprosessering begynner raskt. Spredningen hopper over
  monitorer hvis prosessen allerede stenger ned.
- **Feil-svelging:** `AppealSlaMonitor`, `PseudonymizationMonitor` og `AuditRetentionMonitor` manglet
  `catch` i `tick()` — en feilende tick propagerte som en unhandled rejection. Alle tre logger nå og
  fortsetter (samme mønster som de andre monitorene). Påminnelses-monitorens tick er allerede spredt
  til sist av stagger-en, så den beholder sin oppstarts-kjøring uten å bidra til stormen.
- **Config:** ny `WORKER_STARTUP_STAGGER_MS` i env (default 3000, 0 = ingen spredning).
- **Tester:** unit — «tick-feil svelges + fortsetter å ticke» (AppealSla). tsc grønn.

**Utrulling:** kun server-kode, ingen migrasjon. **Bør til prod før neste feature-deploy**, siden hver
deploy restarter workeren og kan trigge stormen på nytt. **Rollback:** reverter koden (worker-restart
er uansett en trygg gjenoppretting).

## 1.6.34 - 2026-07-18

feat(nav): #765 — nytt «Deltakere»-toppmeny som samler Klasser + Manuell behandling + Resultater

«Klasser» lå som en fane under Innholdsforvaltning, men handler om personer, ikke innhold. De tre
person-/utfalls-orienterte flatene (Klasser, Manuell behandling, Resultater) er nå samlet under ett
toppmeny-punkt **«Deltakere»** med en felles, rollegated undernavigasjon. Innholdsforvaltning står
igjen som en ren innholds-gruppe (Kurs/Moduler/Seksjoner/Kalibrering).

- **Toppnav (`capabilities.ts`):** fjernet de frittstående `review`- og `results`-punktene; nytt
  `deltakere`-punkt (path `/deltakere/klasser`, `requiredRoles` = union SMO/ADMIN/REVIEWER/
  APPEAL_HANDLER/REPORT_READER). Vises hvis brukeren har tilgang til minst én underfane.
- **Undernavigasjon:** ny `public/static/deltakere-subnav.js` — selvstendig, rollegater underfanene
  klient-side (Klasser: SMO/ADMIN; Manuell behandling: REVIEWER/APPEAL_HANDLER/ADMIN; Resultater:
  SMO/ADMIN/REPORT_READER), setter aktiv fane ut fra URL, fail-open hvis rolle-oppslag feiler. Baren
  ligger på klasse-, review- og results-sidene. `.content-area-nav`-stilen sentralisert i `shared.css`.
- **Ruter (`app.ts`):** ny `/deltakere/klasser` (server klasse-siden); `/admin-content/classes`
  301-redirecter dit. `/review` + `/results` beholder URL-ene (re-foreldret kun i nav).
- **Innholds-nav:** «Klasser»-fanen fjernet fra de 4 admin-content-sidene (Kurs/Moduler/Seksjoner/
  Kalibrering).
- **i18n:** ny `nav.deltakere` (nb «Deltakere» / nn «Deltakarar» / en «Participants») i participant- +
  profile-translations.
- **Tester:** e2e (klasse-sidene lastes fra `/deltakere/klasser`; ny sub-nav rollegating + aktiv-fane;
  module-library bekrefter at Klasser IKKE lenger er en innholds-fane); backend (ny rute serveres +
  301-redirect fra gammel URL). route-map oppdatert.

**Merk:** det finnes fra før et `/participant`-punkt merket «Deltaker» (deltakerens egen arbeidsflate).
Nytt «Deltakere» (administrasjon) står ved siden av; entall/flertall-skillet vurderes på stage.

**Utrulling:** kun server+klient-kode, ingen migrasjon. **Går kun til stage foreløpig** (ikke prod).

## 1.6.33 - 2026-07-18

feat(course): #497 — automatiske kurs-frist-påminnelser (frist nærmer seg + forfalt) via daglig
bakgrunnsjobb, for både individuelle OG klasse-tildelte frister

Siste «Done når»-pilar i Epic #478 (Tier 2 LMS): innhold ✓ + vurdering ✓ + progress ✓ + **varsling**.
Deltakere med kurs-frister får nå automatiske e-post-påminnelser, uten at læreren følger opp manuelt.
Kloner recert-påminnelses-mønsteret: audit-basert dedup gjør re-kjøring idempotent og restart-trygg.

- **Ny orkestrator:** `runCourseReminderSchedule({ asOf, sendImpl? })`. **due-soon** fyrer på
  konfigurerbare offsets (standard 7 og 1 dag før), **overdue** fyrer én gang etter passert frist.
  Hopper over fullførte (`deriveStatus === COMPLETED`), avmeldte, deaktiverte/anonymiserte brukere og
  tildelinger uten frist.
- **To frist-kilder:**
  - **Individuelle** `CourseEnrollment.dueAt` (eksplisitt tildelte deltakere).
  - **Klasse-tildelte** `CourseGroupAssignment.dueAt` — ekspandert til medlemmer: **MANUAL**-klasser
    (`ClassMember`-rader) + system-klassen **«Alle deltakere»** (alle aktive deltakere). **ENTRA**-
    klasser kan ikke oppløses i en bakgrunnsjobb (ingen token/lagrede medlemskanter) og hoppes over,
    på samme måte som tildelings-e-posten.
  - Per (bruker, kurs) beregnes **én effektiv frist**: individuell vinner over klasse; ved flere
    klasse-frister vinner den tidligste. Dedup + presedens hindrer dobbel-varsling.
- **Ny monitor:** `CourseReminderMonitor` — env-gated `setInterval`-klasse (daglig,
  `COURSE_REMINDER_INTERVAL_MS`), kjører kun i worker-rollen når `PARTICIPANT_NOTIFICATION_CHANNEL !=
  disabled`; tick-feil logges og velter aldri workeren. Wiret i `src/index.ts` (kjører også én gang
  umiddelbart ved worker-oppstart).
- **Gjenbruk:** ACS-send via `sendViaAcs`, statusutledning via `deriveStatus`, audit via
  `recordAuditEvent`. Nye audit-actions `course_reminder_sent` / `course_reminder_failed`. Nye repo-
  spørringer `findCourseGroupAssignmentsWithDueDate` (classRepository) + `findActiveParticipants`
  (userRepository, for «Alle deltakere»).
- **E-post:** `getCourseReminderNotificationMessage` (nb/nn/en-GB), ingen lenker (#688 — «Logg inn
  på plattformen selv»).
- **Config:** `courseReminders.reminderDaysBefore` (standard `[7, 1]`) i assessment-rules.
- **Tester:** integrasjon (native pg) — individuell due-soon/overdue-matching; klasse MANUAL-
  ekspansjon; «Alle deltakere»-systemklasse; presedens (individuell > klasse, tidligste klasse vinner);
  ENTRA-skip; ingen send for fullført/avmeldt/inaktiv/uten-frist; idempotent re-kjøring. Unit — monitor
  env-gate/feil-svelging, e-post-copy i alle tre språk uten lenker. tsc grønn.

**UI-testbar:** klasse-tildeling har en frist-datovelger (Klasser → tildel kurs), så hele funksjonen
kan testes ende-til-ende i UI. Individuell frist-tildeling har ennå ingen egen datovelger (kun API).

**Klasse-UI-forbedringer (samme arc):** (1) datofeltet ved kurs-tildeling har nå en synlig etikett
«Frist (valgfri)» + hjelpetekst om at fristen driver påminnelser (var før kun en tooltip — uklart hva
datoen betød); (2) tildelte kurs-chips viser nå fristen («Frist: DD.MM.YYYY» / «Ingen frist») i stedet
for bare tittelen. Formateres fra dato-delen (UTC) så vist dag aldri forskyves av tidssone. E2e utvidet.

**Klasse-livssyklus konsistent med #705:** klasser hadde ingen vei tilbake fra arkivert (verken UI eller
backend) og arkiverte klasser var usynlige. Nå:
- Nytt backend-endepunkt `POST /api/admin/content/classes/:id/restore` (+ `classService.restoreClass` +
  `classRepository.restoreClass` + audit-action `class_restored`). Systemklassen kan ikke gjenopprettes
  (den arkiveres aldri).
- `listClasses` returnerer nå både aktive og arkiverte klasser med `archivedAt` (+ `kind`), sortert
  system → aktive → arkiverte.
- Klasselista fikk **Aktive/Arkiverte/Alle-filter** (default Aktive), en **Type-kolonne**
  (System/Manuell/Entra), en **«Arkivert»-status-badge**, og en symmetrisk **Gjenopprett**-handling —
  samme mønster som kurs/seksjon/modul-listene.
- Tester: integrasjon (archive→restore, liste eksponerer archivedAt/kind, system kan ikke gjenopprettes,
  audit-spor) + e2e (filter, Type-kolonne, status-badge, Gjenopprett-handling).

**Utenfor scope:** gjentatte overdue-purringer (v1 = én gang), opt-out (ingen modell finnes), ENTRA-
klasse-medlemskap i bakgrunnsjobb, in-app/SMS-kanaler.

**Utrulling:** kun server-kode, ingen migrasjon. Monitoren er env-gated og trygg å merge før den slås
på i prod. **Rollback:** ingen datamigrasjon — reverter koden.

## 1.6.32 - 2026-07-18

fix(course): #502 — drop den deprecated CourseModule-join-tabellen (lukker #502)

Fullfører expand-contract-en fra #480: `CourseItem` har vært eneste sannhetskilde for et kurs' ordnede
moduler+seksjoner siden lese- og skrive-cutover-en (bekreftet: alle lesninger deriveres fra
`CourseItem` itemType=MODULE, alle skrivninger går via `CourseItem`; CourseModule-rader ble kun ryddet
ved sletting). Nå fjernet den døde tabellen.

- **Schema:** fjernet `model CourseModule` + relasjonene `Module.courseModules` og `Course.modules`.
- **Kode:** fjernet de to gjenværende opprydnings-`tx.courseModule.deleteMany` (deleteCourse +
  cascade-delete) og `"courseModule"`-literalen i to tx-klient-type-unioner. Ryddet utdaterte
  «CourseModule-join»-kommentarer.
- **Migrasjon:** `20260718000000_drop_course_module` → `DROP TABLE "CourseModule"` (ren join-tabell,
  ingen innkommende FK-er, så PK/FK/indeks dropper med den).
- **Verifisert:** prisma-klient regenerert, tsc grønn, native reset replayer alle migrasjoner inkl.
  DROP rent, tabellen borte (`to_regclass` = null), 18 kurs-/completion-tester grønne.

**Utrulling:** krever migrasjons-deploy. Destruktiv men trygg — tabellen var død (ingen les/skriv som
sannhet). **Rollback:** gjenopprett tabellen fra create-migrasjonen (`20260325000002`); ingen tap av
registerdata siden CourseItem er kilden. Ingen server-atferdsendring.
## 1.6.31 - 2026-07-18

fix(skill): #757 — genererte figurer bruker sans-serif (lukker #757)

Kosmetisk: SVG-`<text>` arvet nettleserens default serif-font (stygg mot plattform-UI-et), fordi
`figure-design.md`-malene satte kun `font-size`, ingen `font-family`. Lagt til
`font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"` på **rot-`<svg>`** i alle
fire maler (arves av alle etiketter), + ny hard-regel 7. Verifisert at `font-family` overlever
`sanitizeSvg` (round-trip mot DOMPurify SVG-profil). Kun skill-doc; når ChatGPT via ny zip.

(Versjoner 1.6.28–30 er reservert til #758/#705 — egne parallelle PR-er.)
## 1.6.30 - 2026-07-18

fix(lifecycle): #705 — seksjonslista lastet ikke (feil oversetter-navn i badge-kallet)

Regresjon fra 1.6.29 Del B: `admin-content-sections.js` sin admin-oversetter heter `tNav` (ikke `t`
som i kurs-/bibliotek-filene), men den delte badgen ble kalt med `t` → ReferenceError ved lasting →
Seksjoner-fanen hang på «Laster…». Fikset til `tNav`. Kurs/bibliotek var upåvirket (de har `t`).

Klasse-lærdom (CLAUDE.md): de tre admin-listenes *last*-sti er ikke dekket av automattester (DOM-
testen dekker kun editoren), så feilen var usynlig for tsc/DOM/supertest. Følges opp med e2e-dekning
for at hver av de tre listene faktisk laster.

## 1.6.29 - 2026-07-14

fix(lifecycle): #705 — konsistens-opprydding + samkjørt status-badge (lukker #705)

Kjernen i den enhetlige innholds-livssyklusen (`doc/design/CONTENT_LIFECYCLE.md`) ble bygget i
v1.5.0–v1.6.1 (#706–#709); issuet var bare aldri lukket. Denne lukker de gjenværende residualene.
(Versjon 1.6.28 er reservert til #758 asset-blob-reclaim, egen åpen PR.)

**Del A — backend-konsistens:**
- deleteCourse logget en sletting som `course_archived`; ny `course.deleted`-audit-handling brukes nå.
- Modul-publisering hadde en uvoktet fallthrough (G1/`validateModuleVersionForPublish` kjørte kun
  hvis versjonsdata fantes i bundelen). Nå: ukjent versjon → 404 `module_version_not_found`, G1
  kjører alltid — ikke omgåelig.
- Modul-slett brukte en avvikende telle-melding; bruker nå den delte navngitte-kurs-meldingen
  (`inUseMessage`, eksportert) som avpubliser/arkiver — beholder 409/`module_in_use`/`courseCount`.
- `CONTENT_LIFECYCLE.md` §6 reconciled (kun `archiveCourse` har G3; `findCoursesForSections`).

**Del B — samkjørt status-badge (design §6):**
- Ny delt `public/static/content-status-badge.js` (`lifecycleStatusBadge`/`moduleLibraryStatusBadge`)
  + i18n-nøkler `adminContent.lifecycle.status.{draft,published,archived}` (nb/nn/en-GB). Kurs-, seksjons-
  og modul-listene rendrer nå ÉN badge med samme tre-tilstands-vokabular.
- Kurs-badgen var hardkodet norsk (en-GB/nn så «Publisert») → nå delt i18n.
- Modul-bibliotekets 5-tilstand (`deriveLibraryStatus`) kollapses til 3 + en «nyere utkast»-`.status-chip`
  på `published_with_draft`, så ingenting går tapt. Detalj-panelet beholder sin rikere visning.
- `.status-chip`-stil i shared.css. Handlings-rekkefølge/«Slett kun for arkiverte» var alt samkjørt (#708/#709).

**Tester:** backend — `course_deleted`-audit, 404 på ukjent versjon, 409+navngitt melding (modul-slett);
frontend — `content-status-badge`-unit (3-tilstands-vokabular + 5→3-kollaps + chip); i18n-nøkler
verifisert i alle tre språk. DOM-suite grønn. Server-kode + statiske assets → krever deploy.
## 1.6.28 - 2026-07-14

feat(assets): #758 — reklamer blob-lagring når seksjoner/kurs slettes

Del av #478 (Tier 2 livssyklus). Til nå ble `SectionAsset`-rader cascade-slettet med seksjonen
(`onDelete: Cascade`), men **selve blobene ble aldri slettet** — `assetStorage` hadde ingen slette-
funksjon, og ingen kode slettet en blob. Foreldreløse figur-/bilde-blober hopet seg opp i Azure
Blob Storage og ble betalt for i det uendelige. Prioritert nå fordi video / høyoppløselige bilder
gjør hver lekket blob dyr — fokus på å sikre framtidige slettinger (ikke rydde eksisterende backlog).

- **`assetStorage.deleteAsset(blobPath)`** — Azure `deleteIfExists` / fs `rm --force`. Idempotent
  (manglende blob er ikke feil), så dobbel-slett/allerede-borte er trygt.
- **`assetCommands.collectSectionAssetBlobPaths(sectionIds)`** — samler hver seksjons base-blob +
  `localizedBlobPaths`-varianter, hentet **før** DB-slettingen (radene cascader bort). Dedup.
- **`assetCommands.reclaimAssetBlobs(paths)`** — best-effort, kjøres **etter** commit (aldri før: en
  rullet-tilbake transaksjon må ikke miste blober for en seksjon som fortsatt finnes). Feil logges,
  velter aldri slettingen.
- Koblet inn i begge choke points: `deleteSection` og `courseCascadeDeleteService` (#748-cascaden).
  Størrelse-/type-agnostisk — virker likt for framtidig video/hi-res.
- Tester: `deleteSection` fjerner base + varianter fysisk (verifisert via `getAsset` som kaster);
  cascade-slett rydder eksklusive seksjoners blober. Bredere asset-suite grønn (ingen regresjon).

Bevisst UTENFOR scope (lav prio, backlog lite nå): mark-and-sweep GC for eksisterende foreldreløse
blober + andre kilder (import-feil, fjern-figur-uten-slett-seksjon, erstattede sertifikat-bilder).

Server-kode. Ingen Prisma-migrasjon. Krever deploy for å tre i kraft.

## 1.6.27 - 2026-07-13

docs(skill): #756 — håndhev komplett tre-språklig innhold (nb/nn/en-GB) ved produksjon

Oppfølging fra samme import-test: et ChatGPT-produsert kurs fikk seksjons-`title`/`bodyMarkdown`
kun på bokmål. Årsak: `section.title`/`bodyMarkdown` bruker `localizedTextPatchSchema` (delvis
objekt tillatt), så en ren-bokmål seksjon avvises ikke ved import — i motsetning til kurs/modul-
titler som krever alle tre. Manglende språk må da oversettes sentralt via plattformens on-demand
LLM-lokalisering (token-kostnad); oversettes det én gang ved produksjon, unngås dette.

`checkLocalization` (`localization-check.mjs`) fanger allerede manglende locale på seksjoner
deterministisk — men den kan ikke kjøre i en ChatGPT-økt, så kravet må bæres av instruksjonene.
Innstramming (skill-doc, ingen kodeendring):

- **SKILL.md regel 8:** eksplisitt at levert fil MÅ være komplett i nb/nn/en-GB, **seksjoner
  inkludert**; partial-skjemaet er ikke en snarvei (ren-bokmål seksjon = ufullstendig levering, ikke
  gyldig kurs); token-begrunnelsen «oversett én gang her, unngå sentral kostnad».
- **package-schema.md:** ny «⚠️ deliver all three»-note under «Localized text» med token-rasjonalet,
  og seksjons- + figur-**eksemplene gjort tre-språklige** (de modellerte nb-only og var dermed feil
  mal). Figur-eksempelet viser nå `localizedVariants` for både nn og en-GB.
- **localization.md:** token-rasjonalet + skjema-asymmetrien (hvorfor ren-bokmål seksjon slipper
  gjennom import) forklart eksplisitt.

Kun skill-doc + versjon. Ingen kodeendring, ingen server-endring, ingen deploy — når ChatGPT via ny
zip (`a2-authoring-api-v1.6.27.zip`). Skill ompakket.

## 1.6.26 - 2026-07-13

fix(skill): #754 — ASCII-safe fallback-JSON + mojibake-guard i forfatter-flyten

Andre halvdel av #754-verdikjeden. Ved feilsøking av det ChatGPT-produserte importkurset var de
norske tegnene mojibake (`ø`→`Ã¸`, `æ`→`Ã¦`, `å`→`Ã¥`) — UTF-8-bytes tolket som Latin-1 et sted i
generér→last ned→importér-kjeden. Plattformen kan ikke trygt reversere garble som først har «bakt
seg inn» som ekte codepoints, så fiksen hører hjemme **ved kilden** (skillen), ikke ved import.

- **`export-validate.mjs`:** ny `asciiSafeStringify` (escaper alt ikke-ASCII som `\uXXXX`) brukes nå
  når fallback-fila skrives, så den leverte fila er **ren ASCII** og immun mot enhver
  nedlasting/editor/transfer-omkoding. Ny `findMojibake` + navngitt round-trip-sjekk
  `encoding-integrity` som **nekter å levere** en fil som allerede inneholder dobbelt-kodet tekst
  (base64-blober hoppes over). `describeChecks` navngir sjekken.
- **Instruksjoner (det som når ChatGPT):** SKILL.md (regel 7), `package-schema.md` (Fallback),
  `authoring-playbook.md` (§Fallback) og `export-validation.md` krever nå ASCII-safe `\uXXXX`-JSON,
  med begrunnelse. SVG-figurtekst er upåvirket (bruker XML-entiteter som `&#248;`).
- **Tester:** unit-dekning for `asciiSafeStringify` (ren-ASCII output, round-trip), `findMojibake`
  (fanger garble, ren tekst passerer, hopper over base64, riktig path), og round-trip (leverer ren
  norsk tekst ASCII-safe / nekter mojibaket kilde). Real-schema round-trip fortsatt grønn (`\uXXXX`
  dekoder korrekt).
- Kun skill-script + skill-doc + test. **Ingen server-endring, ingen deploy.** Fiksen når ChatGPT
  ved å laste den nye zip-en (`a2-authoring-api-v1.6.26.zip`) inn i GPT-en/prosjektet. Skill ompakket.

## 1.6.25 - 2026-07-13

fix(content): #754 — figurer med bindestrek-/understrek-sourceId brytes ved kurs-import

Bruker-rapportert: et ChatGPT-produsert kurs (skill v1.6.24) med to SVG-figurer importerte
tilsynelatende OK, men figurene vistes ikke. Rotårsak er en **grammatikk-mismatch** på asset-ref:
`sourceId`/ref-grammatikken er `[a-zA-Z0-9_-]{1,64}` (authoring-schema + `figure-design.md`), og
agenter lager lovlige id-er med bindestrek (`fig-styringslogikker`). To flater brukte en for smal
regex `[a-zA-Z0-9]+`:

- `contentImportService.ts` (kurs-import-remap) matchet bare `asset:fig`, fant ingen mapping og lot
  referansen peke på kilde-tokenet → dinglende ref.
- `sectionContent.ts` (render-omskriving) samme; `asset:fig-…` ble ikke omskrevet til
  `/api/content-assets/…`, og DOMPurify strippet den ukjente `asset:`-scheme → `<img>` uten `src`
  (blank figur). De to andre flatene (validate `ASSET_REF_RE`, `/sections`-remap) var allerede brede
  — derfor virket agent-`/sections`-stien, mens **fallback-fil-importen** feilet.

- **Fix:** begge smale regexene utvidet til den kanoniske `[a-zA-Z0-9_-]+`.
- **Tester:** integrasjon `(f)` i `m2-content-export-import-assets` — kurs-import med
  bindestrek/understrek-`sourceId` verifiserer remap + at rendret HTML resolver hver figur (ingen
  `asset:`-ref igjen); unit-case i `section-content-markdown` for id med `-`/`_`. Begge feilet før
  fiksen, grønne etter.
- **Merk:** allerede-importerte kurs må **re-importeres** etter deploy (lagret markdown ble ikke
  remappet ved den opprinnelige importen). Ingen Prisma-migrasjon. Krever deploy (server-kode).

## 1.6.24 - 2026-07-13

fix(skill): #749 (Layer B) — CLI-orkestratoren videresender seksjonsfigurer

Tetter et hull mellom endepunktet og referanse-orkestratoren funnet under test-forberedelse:
`POST /api/admin/content/sections` tok imot `assets[]` (v1.6.23), men skill-skriptet
`import-package.mjs` sitt `create_section`-steg sendte bare `title/bodyMarkdown/draft/clientRef/
agentRunId` — **ikke** `assets`. En full CLI-import av en pakke med figurer validerte grønt og
rapporterte «ok», men opprettet seksjonen **uten** figuren: markdownen beholdt en dinglende
`asset:<sourceId>`-referanse uten blob. Bare selve endepunktet (og kurs-eksport/import, Lag A) bar
figurer gjennom — agent-flyten via referanse-CLI-en gjorde det ikke.

- **Fix:** `create_section` videresender nå `object.payload.assets` når den finnes (utelates for
  ren-tekst-seksjoner), og eksponerer endepunktets `sourceId→assetId`-`assetMap` på den opprettede
  seksjonen. Serveren gjør resten (opprett `SectionAsset`, saniter SVG, remap `asset:<sourceId>`→ny
  id i lagret markdown). `import-package.d.mts` fikk `assetMap?` på `AuthoringCreatedObject`.
- **Test (CLI-dekning):** ny ende-til-ende-case i `test/agent-authoring-skill-import.test.ts` som
  kjører en figur-pakke gjennom `importPackage` og verifiserer at `SectionAsset`-raden opprettes,
  blobben er lesbar + sanitert, markdown-referansen remappes fra kilde-token til ny id, `assetMap`
  bobler opp, og seksjonen forblir utkast. Regresjonsvakt for nettopp dette hullet.
- **Doc-gjeld i `package-schema.md` lukket samtidig:** seksjonseksempelet sa «markdown only, no
  assets», og figur-transport-avsnittet påsto at skillen «does not yet design figures (Layer B, a
  later phase)» — begge motsagt av kanonisk SKILL.md + figure-design.md (Layer B er levert).
  Referansen dokumenterer nå authoring-pakkens valgfrie `assets[]` (klient-valgt `sourceId`,
  ref/remap, `assetMap`-ekko, validate-kodene) og at figurer designes i strukturporten.
- Ingen server-/schema-endring (endepunktet støttet allerede `assets[]`). Ingen Prisma-migrasjon.
  Ingen deploy — skill-script + doc + test. Skill ompakkes til v1.6.24.

## 1.6.23 - 2026-07-11

feat(figures): #749 Lag B — skill-assistert figur-design + assets i agent-flyten

Bygger på Lag A (asset-transport, v1.6.22). To sider:

- **Plattform:** `a2-authoring-package/v1` seksjons-payload får valgfri `assets[]` (`sourceId` =
  klient-ref-token som markdown refererer via `asset:<sourceId>`); `POST /api/admin/content/sections`
  tar imot `assets[]`, importerer dem (gjenbruker `importSectionAssets` — sanitér + mime/størrelse-
  vakter), remapper `asset:<sourceId>`→ny id i markdown før lagring, og returnerer `sourceId→assetId`.
  Egen større body-parser for /sections. Validate-endepunktet (AA-1) sjekker figur-konsistens per
  seksjon: hver `asset:<ref>` ↔ en `assets[]`-post (`missing_asset`/`unreferenced_asset`), mime i
  allowlist, dekodet størrelse ≤ `MAX_ASSET_BYTES`, SVG saniterer ikke til tomt, unik `sourceId`.
- **Skill:** ny `references/figure-design.md` med kjerneprinsippet **«én figur, ett poeng»** og et
  lite mal-sett (flyt, tre, bokser-og-piler, merket diagram — kun disse med mindre forfatter ber om
  fri-form), SVG-only (agenten lager aldri raster), figurer grunnet i godkjent tekst/kilde,
  oversettbar `<text>`. SKILL.md/playbook: figurer foreslås i Struktur-porten (én enkel figur per
  visuelt poeng) og tegnes med teksten i Per-element-porten. Lokaliseringskontrollen dekker nå
  figur-`<text>` (alle tre språk, etikett-antall bevart, token-bevaring, ingen blind-kopi); bevarings-
  kontrollen behandler en godkjent figur som unikt innhold «fjern redundans» aldri kan droppe.
- Tester: validate-asset-regler (unit), `/sections`+SVG-asset (integrasjon), localization/course-state
  figur-utvidelser (unit). 762 unit + 3 integrasjon grønne. Skill ompakket til v1.6.23.

## 1.6.22 - 2026-07-11

feat(content): #749 (Layer A) — carry section figures/images through export AND import

Section figures/images (`SectionAsset`, blobs in storage referenced from markdown as
`![alt](asset:<id>)`) now travel with a course through **export and import**, so figures survive a
cross-environment round-trip and the `a2-authoring-api` skill's fallback file. Before this, export
was markdown-only — the blobs were dropped and imported figures broke. This is the transport
foundation (**Layer A**) for `doc/design/COURSE_FIGURES_AND_ASSETS.md`; the skill-assisted figure
*design* (Layer B) is a later phase and is NOT included here.

- **Schema (additive, no version-marker change):** `sectionExportPayloadSchema` gains an OPTIONAL
  `assets[]` — `{ sourceId, filename, mimeType, sizeBytes, contentBase64, sourceLocale?,
  localizedVariants?: [{ locale, contentBase64 }] }`. Old asset-less `a2-content-export/v1` files
  import unchanged.
- **Export** inlines each `SectionAsset` blob (+ #657 localized SVG variants) as base64. Caps:
  5 MB per asset and a **25 MB total-decoded-asset budget per envelope** — export throws
  `400 validation_error` if exceeded (never silently drops a figure).
- **Import** decodes each asset, enforces the mime allowlist + per-asset cap, **re-sanitises SVG**
  (base + variants, defence in depth), stores to a fresh blob under the new section, creates the
  `SectionAsset` row (preserving `sourceLocale`/variants), then rewrites the section's active
  `bodyMarkdown` so every `asset:<sourceId>` points at the new id (create-section → create-assets →
  re-save remapped markdown; the persisted active version never references source ids). A failing
  asset surfaces a clear error naming the section/asset — no silent skip.
- **Body limit:** the course-import route gets a route-specific 35 MB `express.json` parser (covers
  the 25 MB asset budget after base64 inflation); every other endpoint stays at 5 MB. Module import
  is unchanged (modules carry no sections/assets).
- **Skill (docs only this phase):** `skills/a2-authoring-api/references/package-schema.md` documents
  the optional `assets[]` and the ref/remap contract; `scripts/export-validate.mjs`'s bundled
  validator + the real-schema round-trip test now cover `assets[]`.
- **Tests:** new integration file `test/m2-content-export-import-assets.test.ts` (round-trip raster +
  SVG-with-localized-variant, import-side SVG sanitisation, disallowed-mime/oversized rejection,
  over-25 MB export rejection, asset-less v1 unchanged); unit coverage that the schema accepts the
  optional `assets[]`; the skill round-trip test now carries an asset.

No Prisma migration (uses the existing `SectionAsset` model). No deploy.

## 1.6.21 - 2026-07-11

chore(skill): a2-authoring-api #762 — preserve approved content, import-compatible fallback export, full three-language localization

Hardens the repo-canonical **`skills/a2-authoring-api/`** skill (EPIC #647) against three
observed failure modes, keeping the existing gates (Source→Objectives→Structure→Per-element→
External QA→Produce), security rules, one-language rule and the never-publish rule intact. Depth
moved to three NEW reference files; deterministic logic moved to three NEW repo-unit-tested
scripts (node stdlib, imported the same way `test/agent-authoring-skill-import.test.ts` imports
`import-package.mjs`).

**Issue 1 — preserve approved course content.** The skill now maintains an authoritative
**course state + master** (full last-approved text per element; a "remove redundancy" request may
only drop repeated explanation, never unique examples/formulas/steps/caveats/tasks/criteria).
`scripts/course-state.mjs` (`reviewRevision`, `auditExport`, `checkGate6Readiness`): reductions
>20 % need approval; any loss of a mandatory example/formula/template/task/assessment-criterion
blocks regardless of %; a pre-export loss audit classifies preserved/moved/deliberately-removed/
**unexpectedly-missing** (last blocks); Gate 6 requires a complete master in final order; a
schema-valid-but-incomplete export is an error. `references/content-preservation.md`.

**Issue 2 — import-compatible fallback export.** A fallback file with `exportedAt`
`…+00:00`/microseconds was rejected by A2's import but had been called "validated".
`scripts/export-validate.mjs` normalises `exportedAt` and every `audit.publishedAt` to
`Date.toISOString()` (Zod `.datetime()` rejects offsets + microseconds), runs the real round-trip
(generate → write → read back → parse → validate → deliver only on pass), carries a bundled
structural validator mirroring `exportEnvelopeSchema`, and names each check (JSON parsing /
export-schema / import-schema / content-integrity / API dry-run / actual import) — never a
generic "validated". Headline rule added to SKILL.md. `references/export-validation.md`.

**Issue 3 — full localization to nb, nn, en-GB.** After the primary language is approved the
skill produces **real translations** (not the primary copied into every locale) for every
student-facing localized field. `scripts/localization-check.mjs` (`checkLocalization`) verifies
all three languages present, equal structure, MCQ correct-answer mapping unchanged across
locales, formulas/URLs/identifiers preserved, and flags blind copies; it documents that
`rubric.criteria` is not a localized datatype (no API-contract change). `references/localization.md`.

Tests (all green, `npx tsc --noEmit` clean): `test/unit/agent-authoring-course-state.test.ts`,
`test/unit/agent-authoring-export-validate.test.ts`,
`test/unit/agent-authoring-export-schema-roundtrip.test.ts` (imports the **real**
`exportEnvelopeSchema`/`importBodySchema` and runs the generator output — incl. bad-datetime
cases — through them), `test/unit/agent-authoring-localization.test.ts`. Repackage:
`npm run skill:package` → `dist/skills/a2-authoring-api-v1.6.20.zip`. Known limitation: A2 has
**no import dry-run endpoint** (course import writes), so live schema validation against the
platform is not possible; a `courses/import?dryRun=true` endpoint is a recommended follow-up.
No src/runtime/API-contract changes; skill + tests only.

## 1.6.20 - 2026-07-11

feat(courses): #762 ADMINISTRATOR-only «Slett kurs og ubrukt innhold» (cascade delete)

**Hva.** Et destruktivt, **kun-ADMINISTRATOR** oppryddingsverktøy for test-innhold: slett et kurs
sammen med de modulene og seksjonene som **kun** det kurset eier — uten noen gang å ødelegge ekte
vurderings-/prestasjonsdata.

**Sikkerhetsmodell (bærende).** En modul/seksjon er *eksklusiv* for kurs C når C er det eneste kurset
som refererer den (via `CourseItem`). Delt innhold **spares** — kun koblet fra C, aldri slettet.
*Bevarte poster* slettes aldri: en eksklusiv modul med `submissions > 0` ELLER
`certificationStatuses > 0`, eller et kurs med `completions > 0`, blir **blokkeringer**. Operasjonen
er **alt-eller-ingenting**: finnes én blokkering, kastes en `ValidationError` (400) som navngir dem
og ingenting slettes.

**FK-rekkefølge (bærende, speiler bulk-purge).** I én transaksjon: (1) slett C sine `CourseItem`- +
`CourseModule`-rader (kobler fra så `CourseItem`-Restrict ikke blokkerer); (2) per eksklusiv modul:
nullstill `activeVersionId`, slett `ModuleVersion` (Restrict-refererer rubric/prompt/mcq-versjoner),
så `MCQQuestion`, så `MCQSetVersion`/`RubricVersion`/`PromptTemplateVersion`, så modulen; (3) per
eksklusiv seksjon: nullstill `activeVersionId`, slett `CourseSectionVersion`, så seksjonen
(reads/assets cascader); (4) slett kurset.

**API.** `GET /api/admin/content/courses/:courseId/cascade-delete-preview` (forhåndsvisning:
deletableModules/deletableSections/sparedModules/sparedSections/blockers) og
`POST /api/admin/content/courses/:courseId/cascade-delete` (kjør; 200 med sammendrag, eller 400 med
`details.blockers`). Begge **kun ADMINISTRATOR** (403 `forbidden` ellers) — per-rute-vakt over
`admin_content`-mounten som slipper inn SMO+ADMIN.

**UI.** Ny **ADMINISTRATOR-only** rad-handling «Slett kurs og ubrukt innhold» i kurs-arbeidsflaten
(`/admin-content/courses`), synlig kun når `/api/me`-rollene inkluderer ADMINISTRATOR. Åpner en
bekreftelsesdialog som lister hva som slettes, hva som beholdes (delt innhold med kursene de ligger
i) og eventuelle blokkeringer; bekreft-knappen vises kun når det ikke finnes blokkeringer.

**Revisjon.** `course_cascade_deleted`-hendelse (sammendrag av slettede/sparte id-er) + per-modul
`module_deleted` (`source: course_cascade_delete`).

**Tester.** Integrasjon (native Postgres): sletter kurs + eksklusive moduler (m/versjoner) +
seksjoner; sparer delt modul (koblet kun fra det slettede kurset); blokkerer på modul-submission og
på kurs-completion; preview rapporterer deletable/spared/blocked; SMO får 403 på begge endepunkter.
e2e: handlingen skjult for SMO, synlig for ADMINISTRATOR; dialog lister preview; bekreft sender
delete-POST; bekreft-knapp skjult ved blokkeringer.

Ingen skjema-/migreringsendring (bruker eksisterende tabeller).

## 1.6.19 - 2026-07-10

feat(admin-content): #744 «Åpne»-lenker i kursbyggeren + #745 kurs-filter i modul-/seksjonsbibliotekene

**#744 — åpne et element fra kursbyggeren.** Innholdslista i kursbyggeren
(`admin-content-courses.js`, `/admin-content/courses/:courseId`, seksjonen «Innhold i kurset
(moduler og seksjoner)») hadde ingen vei inn til det enkelte elementets editor. Hver rad får nå en
**«Åpne»**-lenke ved siden av «Fjern» som åpner editoren i **ny fane** (`target="_blank"
rel="noopener"`), så kursbyggeren ikke går tapt: modul → `/admin-content/module/<id>/conversation`,
seksjon → `/admin-content/sections?id=<id>`. Hardkodet norsk «Åpne» for å matche naboene
(«Fjern»/«Diskusjon»), gjenbruker eksisterende rad-/knapp-CSS.

**#745 — filtrer bibliotekene på kurs.** Modul-biblioteket (`admin-content-library.js`) og
seksjons-biblioteket (`admin-content-sections.js`) er flate lister som blir lange under
agent-masseproduksjon. Begge får nå en **kurs-nedtrekksmeny** («Kurs:») ved siden av filter-linja:
**«Alle kurs»** (default, ingen filtrering) + ett valg per distinkt kurs (dedupe på `course.id` på
tvers av elementenes `courses`-arrayer, sortert på tittel) + **«Ikke i noe kurs»** (elementer uten
kurs). Filteret er rent klientside — gjenbruker `courses`-dataene som «Brukt i kurs»-popoveren
allerede har, ingen backend-endring. Det komponerer med status-filter + søk + sortering (ekstra
predikat), og dropdownen bygges på nytt hver gang dataene lastes. In-memory-valg (ingen persistering
på tvers av reload), som øvrige filtre. Hardkodet norske etiketter.

Tester: `test/e2e/admin-content-course-links-library-filter.spec.ts` (e2e) — #744 modul-/seksjonsrad-
lenker (href + `target=_blank`); #745 kurs-filter i modul- og seksjonsbiblioteket
(«Kurs A» viser X/skjuler Y, «Ikke i noe kurs» viser Y/skjuler X, «Alle kurs» viser begge) + at
filteret komponerer med søk. Ingen skjemaendring, ingen rute-endring.

## 1.6.18 - 2026-07-07

feat(courses): #734 kaskade-publisering — publiser aldri et kurs med upublisert innhold

Publisering av et KURS sørget ikke for at kursets moduler/seksjoner var publisert. `publishCourse`
avviste bare kurs uten moduler; et kurs kunne dermed gå live med utkast-moduler/-seksjoner, og
deltakere møtte «modul ikke tilgjengelig» (brudd på innholds-livssyklus-invariant I1,
`doc/design/CONTENT_LIFECYCLE.md`).

Nå: `GET /api/admin/content/courses/:id/publish-preview` rapporterer hvilke elementer som er
upublisert og om hvert er publiserbart (modul → `validateModuleVersionForPublish`; seksjon →
har innhold). `POST …/publish` tar `{ publishItems?: boolean }`: uten flagget når det finnes
upubliserte elementer → `409 course_has_unpublished_items`; med `publishItems:true` kaskade-
publiseres elementene (elementer → kurs). Kan et element ikke publiseres (modul feiler validering /
mangler innhold, arkivert element) → `422 course_publish_blocked_by_items` og INGENTING publiseres
(atomisk-ish; kurset blir aldri «publisert med ødelagt innhold»). Kurs-UI (`admin-content-courses.js`)
åpner en bekreftelsesdialog som lister de upubliserte elementene og tilbyr «Publiser kurset og alt
innhold» (kaskade) + «Avbryt»; er alt allerede publisert publiseres direkte uten dialog; er noe ikke
publiserbart forklarer dialogen hvorfor og blokkerer (ingen «kun kurs»-utvei — det ville brutt I1).

Sikkerhet: agent-tokens kan fortsatt ikke publisere — publish/publish-preview er utenfor
`agentTokenScope`-allowlisten (uendret). Ingen skjemaendring (Prisma-fri kodesti). Tester:
`test/m2-course-cascade-publish.test.ts` (integrasjon) + `test/e2e/admin-content-course-cascade-publish.spec.ts` (e2e).

## 1.6.17 - 2026-07-07

fix(ux): #736 profilsiden — blandet locale i fullførte-tabellene + fjernet statusprikk

- **Blandet locale (Bestått/Vis bevis):** rotårsak var at språkbytte i nedtrekksmenyen kun
  re-kjørte `applyTranslations()` på statiske `data-i18n`-etiketter, mens de dynamisk bygde
  modul-/kurs-radene (rendret via `t()`) ikke ble re-rendret — så verdiene ble hengende på
  forrige språk mens overskriftene byttet. Fiks: cache siste modul-/kursdata og re-render
  `renderProfile`/`renderModules`/`renderCourses` ved språkbytte. E2e-guard som bytter locale
  og asserterer at verdicellene følger med.
- **Statusprikk «●»:** fjernet `::before`-dekoren på `.outcome--pass/--review/--fail` i
  shared.css (typografisk et list-glyph; den fargede teksten formidler status alene). Treffer
  alle tre flatene samtidig (profil, deltaker, fullførte moduler).

## 1.6.16 - 2026-07-07

fix(i18n): manglende `nav.review`-nøkkel i profil-toppmenyen

Review-nav-elementet (capabilities.ts `labelKey: "nav.review"`) rendret rå nøkkel
«nav.review» i toppmenyen på profilsiden fordi `profile-translations.js` bare hadde
`nav.manualReview`, ikke `nav.review`. Lagt til `nav.review` på en-GB/nb/nn med samme
kanoniske verdi som `participant-translations.js` («Manual review» / «Manuell behandling» /
«Manuell handsaming»). Kosmetisk; ikke tidskritisk å deploye. (Jf. FEATURE_SURFACE_MAP #14 —
«render aldri item.labelKey rått».)

## 1.6.15 - 2026-07-07

fix(auth): #651 agent-token 403 på stage — frys utstederens roller på tokenet

Stage-test av agent-tokenet ga `403 forbidden` («Requires one of roles: ADMINISTRATOR,
SUBJECT_MATTER_OWNER») selv om tokenet ble utstedt av en admin/SMO. Rotårsak: i Entra-modus
er de effektive rollene DB-roller ∪ JWT-app-rollekrav, men JWT-kravrollene persisteres ikke
som `RoleAssignment`. Token-auth utledet rollene på nytt med `getActiveRoles` (kun
persisterte) → SMO/admin-rollen forsvant → 403. (Lokale/seedede brukere har persisterte
roller, derfor grønt i test og lokalt.)

Fiks: utstederens effektive roller (fra det autentiserte request-et som allerede passerte
`admin_content`-vakta) fryses på tokenet ved utstedelse (`AgentAuthoringToken.rolesJson`,
migrasjon 20260707100000) og gjenbrukes ved token-auth. Deterministisk, uavhengig av
rollekilde, og hindrer at tokenet eskalerer roller senere. Eldre tokens uten snapshot
faller tilbake til persisterte roller. Ny regresjonstest: bruker med rolle kun i
request-konteksten (0 persisterte roller) utsteder token → validate gir 200, ikke 403.

## 1.6.14 - 2026-07-06

feat(ux): #731 «Agent-tilgang» på profilsiden — utsted/vis én gang/liste/revokér agent-tokens

Gjør AA-3-tokens (#651) tilgjengelige for ikke-tekniske brukere — ingen API-kall eller
env-variabler nødvendig:

- Ny rollegatet seksjon på **/profile** (kun SUBJECT_MATTER_OWNER/ADMINISTRATOR; gating på
  `/api/me`-roller, skjult via `setHidden`): merkelapp + TTL (15/30/60 min) → «Lag token» →
  hemmeligheten vises **én gang** med kopiér-knapp (clipboard-API med select-fallback) og
  tydelig advarsel, tabell over egne tokens (opprettet/utløper/sist brukt/status) med
  «Trekk tilbake»-knapp for aktive.
- Profilsiden var tidligere uten rollegatede seksjoner — dette er den første; valgt fremfor
  admin-platform fordi tokens er personlige og SMO-er (ikke bare administratorer) skal ha dem.
- i18n: `agentTokens.*` på en-GB/nb/nn.
- Ny brukerguide `doc/AGENT_ACCESS_GUIDE.md` (flyt, sikkerhet, FAQ).
- E2e (Playwright, samme PR per standing order): skjult for PARTICIPANT; SMO utsteder
  (POST-body verifisert), ser `aat_`-hemmeligheten, lista re-rendres, revokerer (POST +
  status «Revoked», handlingsknapp borte). 80/80 e2e grønne totalt.

## 1.6.13 - 2026-07-06

feat(auth): #651 AA-3 — kortlivede, scopede agent-authoring-tokens (multitenant)

Alternativ 2 fra designnotatet («Agent Authoring Session») implementert; åpner for trygg
direkte agentbruk (ChatGPT/Claude) mot delte installasjoner:

- **Ny tabell `AgentAuthoringToken`** (migrasjon 20260706100000): kun sha256-hash lagres,
  hemmeligheten (`aat_<48 hex>`) vises én gang. TTL 5–60 min (default 60), revokerbar,
  `lastUsedAt` spores. Per installasjon — tokens kan aldri brukes på tvers (multitenant).
- **Endepunkter** under `/api/admin/content/agent-authoring/tokens`: utsted (POST), liste
  (GET, aldri hemmeligheten), revokér (POST :id/revoke — eier eller ADMINISTRATOR).
  Utstedelse/revokering audit-logges.
- **Auth**: `Authorization: Bearer aat_...` virker i begge auth-moduser; identitet/roller
  hentes fra utstederens brukerkonto — writes attribueres som brukeren og arver
  eierskapsmodellen (#528). Mock-headere kan aldri overstyre token-identiteten.
- **Scope-vakt** (`enforceAgentTokenScope`, montert rett etter authenticate): token-requests
  kan kun kalle de fem draft-operasjonene (validate, modules/import, sections, courses,
  courses/:id/items); alt annet → 403 `agent_token_scope`. Tokens kan ikke utstede/revokere
  tokens. Rute-herding: import krever `createNew` + `autoPublish: false`, seksjoner krever
  `draft: true`, items kun på upubliserte kurs — ingen publish-kodevei er nåbar med token.
- Skillen er uendret i praksis (`A2_AUTH_BEARER` tar nå helst et `aat_`-token); SKILL.md,
  api-flow og API_REFERENCE oppdatert; designnotatet §7 har beslutningen.
- Tester: 6 nye integrasjonstester (utstedelse/liste uten hemmelighet, full orkestrering
  med token + bruker-attribusjon, allowlist-avslag inkl. publish og self-mint, rute-herding,
  expiry/revoke/ukjent token → 401, rollekrav for utstedelse).

## 1.6.12 - 2026-07-06

feat(admin-content): #653 AA-5 — audit-spor og partial-failure-rapportering for agent authoring

- **`agentRunId`** (valgfri, `[a-zA-Z0-9._-]{1,64}`) på `POST /sections`, `POST /modules/import`,
  `POST /courses` og `PUT /courses/:id/items`: én ID per orkestreringskjøring, stemples i
  audit-metadata sammen med `source: "agent_authoring"` + `clientRef` — spør audit på
  `agentRunId` for å rekonstruere nøyaktig hva en kjøring opprettet (også ved delvis feil).
  Ingen server-side run-ledger (designbeslutning: audit-events + skillens klientlogg holder).
- **Nye audit-hendelser**: `section_created` (med `draft`-flagg) og `course_items_updated` —
  seksjonsoppretting og item-sekvens var uauditerte writes; nå logges de for både mennesker
  og agenter (agent-markøren settes kun ved clientRef/agentRunId).
- **Skill-scriptet** genererer runId automatisk, sender den på alle writes, og returnerer
  standard partial-failure-rapport: `steps[]` med done/failed/skipped per plan-steg + `runId`.
- Fix: fjernet shebang fra `import-package.mjs` — `#!` + CRLF (git-checkout på Windows) brakk
  vite-nodes transform når tester importerer scriptet (CI på Linux/LF var upåvirket).
- Tester: 3 nye integrasjonstester (audit-spor for vellykket kjøring, mid-flow-feil med
  bevarte ID-er/links/steps, og at manuelle creates auditeres uten agent-markør).

## 1.6.11 - 2026-07-05

feat(admin-content): #650 AA-2 — agentvennlige create/import-responser + draft-seksjoner

Andre API-steg i EPIC #647 (design: `doc/design/AGENT_AUTHORING_647.md` §3–§4):

- **`links` i 201-responser**: `POST /modules`, `POST /modules/import` (conversation/advanced),
  `POST /courses`, `POST /courses/import` (kursbygger) og `POST /sections` (editor) returnerer
  admin-UI-deep-links (`adminUiLinks.ts`, kanoniske ruter fra `doc/route-map.md`) slik at
  skillen kan gi brukeren gjennomgangs-URL-er.
- **`clientRef`-ekko**: samme kall aksepterer valgfri `clientRef` (`[a-z0-9-]{1,64}`) som
  ekkoes i responsen (aldri persistert) — skillen mapper plan → server-ID-er uten egen bokføring.
- **`draft: true` på `POST /sections`**: tetter seksjonshullet i draft-only-invarianten —
  seksjonen opprettes i Utkast (`activeVersionId` forblir null; innholdet ligger som versjon 1
  og publiseres via eksisterende `publish`). Default-adferd (auto-publiser ved lagring) uendret.
- Idempotency-Key (krever ny tabell) utskilt til #726 slik #650 åpner for.
- Tester: ny integrasjonssuite kjører hele skill-sekvensen (import i alle tre assessmentMode →
  draft-seksjon → kurs → mixed items) som både ADMINISTRATOR og SUBJECT_MATTER_OWNER og
  verifiserer at ingenting blir live underveis. API_REFERENCE oppdatert.

## 1.6.10 - 2026-07-05

feat(admin-content): #649 AA-1 — Agent Authoring validate-endepunkt med detaljert rapport

Første API-steg i EPIC #647 (designnotat: `doc/design/AGENT_AUTHORING_647.md`, landet i #724):

- **Ny kontrakt `a2-authoring-package/v1`** (`agentAuthoringSchemas.ts`): agentens plan for
  drafts av seksjoner/moduler/kurs. Gjenbruker `a2-content-export/v1`-leaf-schemas uten
  `audit`; alle objekter er strict, så publiserings-/audit-felt avvises som `unknown_field`
  i stedet for å ignoreres stille (draft-only-invarianten håndheves strukturelt).
- **`POST /api/admin/content/agent-authoring/validate`** (`admin_content`-beskyttet):
  dry-run uten DB-writes. Returnerer 200 med `{ valid, summary, issues[{severity, path,
  code, message}], plan }` også for ugyldige pakker; `plan` (topologisk rekkefølge) kun når
  `errors == 0`. Dekker alle tre `assessmentMode` (`required_for_mode`/`forbidden_for_mode`),
  clientRef-regler (duplikat/ukjent/type-mismatch), eksisterende-ID-sjekk mot DB, og
  warnings for mulig duplikat-tittel og modul-løse kurs.
- Tester: 12 unit (regelsettet, injiserbare lookups) + 5 integration (endepunktkontrakt,
  ingen-writes-garanti, rollevern). API_REFERENCE oppdatert.

## 1.6.9 - 2026-06-30

fix(infra): #405 produksjonsvern — subscription-guard + ekstern oppetids-ping (lås verifisert)

Tre vern mot May-2026-incidentklassen (staging-workflow traff prod og slettet det meste):

- **Del 1 — CanNotDelete-lås (verifisert):** `rg-production-do-not-delete` er aktiv i prod (lå
  allerede i Bicep; nå bekreftet live via `az lock list`). Blokkerer all sletting i prod-RG-en.
- **Del 2 — subscription-guard:** `activate-`/`deactivate-staging-app-layer.yml` avbryter hardt
  etter Azure-login hvis konteksten er prod-subscription (5b3f760b), før noen Azure-mutasjon.
- **Del 3 — ekstern oppetids-ping:** Application Insights standard availability-test mot `/healthz`
  fra West Europe + North Europe hvert 5. min, + `metricAlert` (begge lokasjoner nede) →
  observability action group. Ekstern → fyrer **selv om** App Service slettes (ulikt dagens
  HealthCheckStatus). Opprettes der det finnes en alarm-mottaker (`createObservabilityActionGroup`).

NB: action group krever `OBSERVABILITY_ALERT_EMAIL` (GitHub-var) — settes for stage + prod. Det
wirer samtidig dagens alarmer (latency/llmfail/health/runtime-errors) som i dag varsler ingen.
Bicep validert: ren build + begge webtest-lokasjons-IDer bekreftet mot Azure. Deploy via
`deploy-azure.yml` med prod what-if; stage først for å teste alarm-kjeden ende-til-ende.

## 1.6.8 - 2026-06-30

fix(ux): ROT-ÅRSAK for «Brukt i kurs»-skjevhet — global `button { width: 100% }` (#710)

Verifisert med headless-render (Playwright) av den faktisk deployede CSS-en: teller-**knappen**
(`<button class="course-count-btn">`) arvet den globale skjema-regelen `button { width: 100% }`
og ble dermed **cellebred (~169px)**, mens «0» (`<span>`) forble smal (~29px). Med
`text-align: center` havnet «1» midt i den brede knappen → ~70px til høyre for «0».
`min-width`/`text-align` fra 1.6.7 kunne aldri vinne mot `width: 100%`.

Fiks: `width: auto` på `.course-count-btn`/`.course-count-zero` → shrink-to-fit, identisk
29px-boks, sifrene perfekt over hverandre (målt glyf-senter-diff: 0.01px). Lærdom: CSS-fiks
bør renderes og måles før deploy, ikke verifiseres manuelt på stage i flere runder.

NB: foreløpig kun ment for **staging**-verifisering.

## 1.6.7 - 2026-06-30

fix(ux): «Brukt i kurs»-tall sentreres i fast boks → robust linjering på tvers av rader (#710)

Etter 1.6.6 var «0» og tall-lenken fortsatt ikke på samme vertikale linje for noen brukere.
Deployet 1.6.6-CSS var korrekt (lik padding/inline-block), så restproblemet var enten en
`<button>` vs `<span>`-renderingsforskjell eller et cachet stilark. Robust fiks:
`.course-count-btn`/`.course-count-zero` får nå `min-width: 2.25em` + `text-align: center` +
`margin: 0`, slik at sifferet sentreres i en identisk boks uansett element-type, glyf-bredde
eller button-quirks. Endringen gir også nytt ETag → tvinger frisk stilark-henting (cache-bust).

NB: foreløpig kun ment for **staging**-verifisering.

## 1.6.6 - 2026-06-30

fix(ux): kurselement-lista harmonisert med admin-oversiktene + reell #710-fiks på modul-biblioteket

Oppfølging etter stage-verifisering av 1.6.4/1.6.5 (#714/#710):

- **#710 (egentlig fiks):** «Brukt i kurs»-linjeringen var fortsatt skjev på **Moduler**-siden.
  Årsak: `admin-content-library.html` hadde en lokal `<style>`-override av
  `.course-count-btn`/`.course-count-zero` som manglet `display:inline-block`/`vertical-align`/
  `line-height` og dermed vant over shared.css (senere i dokumentet). Override fjernet → begge
  sider styres nå av shared.css og «0»/tall ligger på samme linje. Seksjoner-siden var alt riktig.
- **#714 (oppfølging, kosmetisk):** deltakerens oversikt over kurselementer er gjort lik
  admin-oversiktene: hver tilstand er nå en **pille** (ikke bare «Bestått») — grå «ikke startet /
  ikke lest», blå «påbegynt», grønn «bestått/lest», dempet «ikke tilgjengelig». Luftigere rader,
  fet tittel, dempet handlingsverb som type-hint, status til høyre. Inline badge-stiler flyttet
  til CSS (`.module-status-badge`).

NB: foreløpig kun ment for **staging**-verifisering.

## 1.6.5 - 2026-06-29

fix(security): re-implementer security-scan-funn på dagens main (#527/#528); #526 var alt fikset

Tre eldre codex-genererte security-PR-er (2026-06-17) ble vurdert. #526 (SSRF via redirect-kjeder)
var allerede fikset i main (`urlFetchService` bruker `redirect:manual` + per-hop-validering) → lukket.
De to andre stod fortsatt åpne og er re-implementert ferskt:

- **#528 (autz):** `POST /api/admin/content/modules/import` med `mode=replaceExisting` sjekker nå
  eierskap på `targetId` (`assertModuleOwnership`) før import. Tettet hull der en SMO kunne importere
  (og auto-publisere) en ny versjon inn i en modul de ikke eier. Verken rute eller service sjekket
  dette før. Regresjonsvakt i `m2-content-export-import`.
- **#527 (vurderings-integritet):** generert rubrikk-skala låst — `maxScore` må være eksakt 4 (matcher
  assessor-skalaen 0–4) og 3–6 kriterier, i både zod-skjema og generation-prompt. Hindrer LLM-styrt
  nevner-drift i scoringen. (Manuelle slidere er fortsatt forfatter-kontroll, utenfor dette scope.)

NB: ment for **staging**-verifisering foreløpig.

## 1.6.4 - 2026-06-29

feat/ux: deltaker-kursspiller — «fortsett der du slapp», riktig telling, + småfiks (#492/#714/#710)

- **#492 (resume):** kurs-spilleren viser nå «Fortsett der du slapp» / «Start kurset» som hopper rett
  til neste uferdige element (ulest seksjon / ikke-bestått tilgjengelig modul), og uthever det neste
  elementet i lista. Per-element-status fantes fra før (Lest/Bestått/Påbegynt).
- **#714 (telling):** «X/18 moduler» var misvisende (18 = moduler + seksjoner). Backend
  (`/api/courses` + `/api/courses/:id`) returnerer nå per-type tall, og deltaker-UI viser
  «Moduler x/y · Seksjoner x/y». Regresjonsvakt i `m2-course-section-read`.
- **#710:** «0» og tall i «Brukt i kurs»-kolonnen (seksjon-/modul-lister) ligger nå på samme linje
  (felles boks-geometri på `.course-count-btn`/`.course-count-zero`).

NB: foreløpig kun ment for **staging**-verifisering.

## 1.6.3 - 2026-06-29

fix(ux): skjul dev-only «mock-identity»-kort til auth-modus er kjent (ingen flash i prod)

Det dev-only «Testbruker / Dev only»-kortet (mock-identitet + rolle-velger) blinket i et par
sekunder før den normale siden i prod/stage (entra), fordi sidene starter med standard `authMode:
"mock"` og først skjuler kortet etter at `/participant/config` er lastet — synlig når DB/last er treg.

- Ikke en sikkerhetssvakhet: i entra-modus ignorerer `authenticate()` mock-headerne fullstendig
  (roller kommer fra Entra-tokenet), så rolle-velgeren kan ikke endre tilgang server-side. Men dev-UI
  skal ikke vises for ekte brukere.
- Fiks: sidene starter med `<body class="auth-resolving">` + `shared.css` skjuler
  `.mock-identity-card` mens den klassen er på. JS fjerner `auth-resolving` etter at config er lastet,
  så kortet vises kun i ekte mock-modus (lokal dev), aldri som et blink i prod/stage.
- Berørte sider: participant, admin-content (+ advanced), admin-platform, calibration.

## 1.6.2 - 2026-06-29

fix(infra): øk Prisma connection pool (connection_limit=10) — fra prod-incident

Første reelle samtidige deltaker-last i prod ga `PrismaClientKnownRequestError P2024` («Timed out
fetching a connection from the connection pool», limit 3) → 500 på `/api/me`, `/api/courses` og
manglende toppmeny. Prisma defaulter poolen til `cores*2+1` = **3** på 1-kjerne B1-appen, som ikke
holder når SPA-en fyrer flere parallelle `/api`-kall + auth kjører gruppe-synk per request.

- Bicep `postgresConnectionString` får nå `&connection_limit=10&pool_timeout=20` (web+worker+parser
  = 3×10 = 30, godt under Postgres `max_connections=50`).
- Prod ble hotfikset live ved å oppdatere KV-secret `DATABASE-URL` direkte + restart (ingen full
  deploy nødvendig); denne Bicep-endringen persisterer fiksen for fremtidige deploys.
- **(A) Strupet Entra gruppe-synk:** `syncEntraGroupRoles` kjørte DB-arbeid (findMany + reconcile) på
  HVERT autentisert request i Entra-modus, som la latens på alle API-kall (prod-vs-stage-deltaen,
  siden stage har synk av). Nå strupet per bruker med 5-min in-memory TTL (web = én prosess).
  `getActiveRoles` leser fortsatt DB hvert kall, så tildelte roller er alltid ferske; vi hopper kun
  over den idempotente re-synkroniseringen innenfor vinduet. `resetGroupSyncThrottle()` for tester.

## 1.6.1 - 2026-06-29

fix(ux): admin-liste-polish fra staging-gjennomgang av v1.6.0 (#705-UX)

- **Slett vises nå kun for arkiverte elementer** (kurs/modul/seksjon). Sletting er det terminale
  steget *etter* arkivering — aktive rader viser Arkiver i stedet. Konsistent på tvers, og rydder
  opp i de aktive radene. Moduler fikk dermed også en (vaktet) Slett — kun når arkivert.
- **Felles knappestil:** `.row-action-btn` + `.row-actions` er nå kanonisk i `shared.css`. Seksjoner
  og Klasser hadde egne, litt avvikende definisjoner (font/padding) — fjernet, arver nå felles.
- **Seksjonslista layout:** tittel-kolonnen var `width:100%` og handlings-cellen var `display:flex`,
  som klemte de andre kolonnene og stablet knappene vertikalt. Nå fleksibel tittel (min-width) +
  vanlig handlings-celle → knappene ligger horisontalt og skjermbredden utnyttes som i Kurs/Moduler.

## 1.6.0 - 2026-06-29

feat(ux): samkjørt innholdsforvaltning — Kurs/Moduler/Seksjoner/Klasser likere (#705-UX)

UI-konsistens-runde etter staging-gjennomgang av de fire admin-listene:

- **(D) Klasser-toppnav viste råe i18n-nøkler** («nav.participant» …) — klasser-siden manglet
  i18n-oppslag. Lagt til oversettelse (tNav) + språkvelger. E2e-guard bruker nå en ekte nøkkel.
- **(H) Kalibrering-fanen manglet** på Seksjoner og Klasser — lagt til (vises rollestyrt, likt
  Kurs/Moduler).
- **(E) «Innholdsforvaltning» åpner nå på Kurs** (ikke modul-biblioteket). Modul-biblioteket er
  fortsatt på /admin-content via «Moduler»-fanen.
- **(A) Filter-piller** (Alle/Aktive/Publiserte/Arkiverte) på Kurs og Seksjoner, samme uttrykk som
  modul-biblioteket (erstatter «Vis arkiverte»-toggelen). Delt `.list-filter-btn` i shared.css.
- **(B) Felles knapperad** (`.row-actions`) i alle listene.
- **(F) Kurslista viser «Påbegynt»** — antall deltakere midt i kurset (samme signal som G3-vakta).
- **(G) Seksjonslista viser «Brukt i kurs»** med popover (samme som modul-biblioteket).
- **(C)** Kurslista viste allerede «Antall moduler» (uendret).
- Småavvik: Klasser fikk språkvelger; delt status-/popover-CSS flyttet til shared.css.
- Nye API-felt: `inProgressCount` på kurslista, `courseCount`/`courses` på seksjonslista.

## 1.5.1 - 2026-06-28

fix: livssyklus-justeringer fra staging-gjennomgang av v1.5.0 (#705)

- **Seksjon-status viste alltid «Utkast» + Publiser-knapp uten effekt:** list-endepunktet
  `GET /api/admin/content/sections` utelot `activeVersionId`, så klienten kunne ikke utlede status.
  Nå inkludert. Regresjonsvakt i `m2-content-lifecycle`.
- **Seksjonseditoren manglet Publiser-knapp (slik moduler har):** lagt til status-merkelapp +
  Publiser/Avpubliser i editor-verktøylinja; status holdes i synk etter lagring.
- **Kurs-avpublisering er ikke lenger G3-låst:** avpublisering er reversibel «myk» nedtaking og
  tillates alltid; den harde G3-låsen gjelder kun **arkivering** (pensjonering). Feilmeldingen ved
  blokkert arkivering peker nå på Avpubliser som alternativ. (Aktivitets-signalet er varig, så en
  hard lås på avpublisering ville vært en blindvei.)

## 1.5.0 - 2026-06-28

feat: enhetlig innholds-livssyklus for kurs/modul/seksjon + tett integritets-hull (#705)

Bakgrunn: en publisert modul kunne arkiveres ved å først avpublisere den (arkiv-vakta sjekket
kun publiser-status, ikke kurs-referanser; avpubliser hadde ingen vakt) — slik kunne et publisert
kurs ende med en arkivert/avpublisert modul. Livssyklusen var dessuten ujevnt implementert
(seksjoner manglet arkiver/avpubliser helt, med et ubrukt `archivedAt`-felt).

Én gjenkjennbar modell for alle tre innholdstyper (se `doc/design/CONTENT_LIFECYCLE.md`):

- **Samme status overalt:** Utkast / Publisert / Arkivert, vist med felles `.status-badge`.
- **Samme handlinger, samme rekkefølge:** Publiser⇄Avpubliser · Arkiver⇄Gjenopprett · Slett.
- **G2 bruk-lås (alle kurs):** en modul/seksjon i ETHVERT kurs (publisert eller utkast) kan ikke
  avpubliseres/arkiveres/slettes. Feilmeldingen navngir kursene. Tetter integritets-hullet.
- **G3 aktivitets-lås:** et kurs med en påbegynt-men-ufullført deltaker kan ikke
  avpubliseres/arkiveres.
- **I3 arkiver auto-avpubliserer:** «arkivert men publisert» kan ikke oppstå; gjenopprett lander
  i Utkast.
- **Seksjoner:** ny publiser/avpubliser/arkiver/gjenopprett-symmetri (ruter + status-merkelapp +
  Vis arkiverte-veksling i seksjonslista).
- **Kurs:** ny Avpubliser (manglet) + status-kolonne i kurslista.
- Nye endepunkt: `POST /api/admin/content/courses/:id/unpublish`,
  `POST /api/admin/content/sections/:id/{publish,unpublish,archive,restore}`.
- Tester: `m2-content-lifecycle` (G2/G3/I3) + oppdatert `m2-module-archive` (arkiver auto-avpub.)
  + 2 nye e2e (kurs-avpubliser, seksjon-livssyklus).

## 1.4.6 - 2026-06-28

fix(ux): forenklet kurs-opprettelse — nivå-valg går rett til editoren (#506)

- **Kurs-opprettelse (samtale):** det mellomliggende modul-søk-steget er fjernet. Etter at
  forfatteren har skrevet tittel og valgt sertifiseringsnivå, opprettes kurset direkte (tittel +
  nivå, ingen moduler) og **kurs-editoren** åpnes — der både moduler OG seksjoner legges til og
  sekvensen redigeres. Færre steg, og moduler/seksjoner håndteres samme sted.
- Tester: oppdaterte conv-create-e2e (nivå-valg → editor, intet modul-søk-steg).

## 1.4.5 - 2026-06-28

fix(ux): kompakte modul-filtre + sertifiseringsmerke ser ikke ut som knapp

- **Modulbibliotek:** filter-fanene (Alle/Aktive/…) er nå kompakte piller på rad (`width:auto`
  overstyrer global `button{width:100%}`), ikke fullbredde stablet.
- **Kursliste:** sertifiseringsnivå-merket («Grunnleggende» o.l.) restylet til et flatt «tag»
  (liten radius, ingen kant, svak blåtone) så det ikke forveksles med handlingsknappene.

## 1.4.4 - 2026-06-28

fix(ux): bunt 2 — rapport-knapper, seksjoner ved opprettelse, avpublisert modul i kurs

Tre småforbedringer fra staging-verifisering av v1.4.3:

- **Rapport (#results):** eksport-knappene er nå kompakte og ligger på rad (overstyrer global
  `button{width:100%}` i `.export-row`).
- **Kurs-opprettelse:** etter «Opprett kurs» lander forfatteren nå i **kurs-editoren** (der
  seksjoner + sekvens redigeres), ikke i kurslista — så seksjoner kan legges til som neste steg.
- **Avpublisert modul i kurs:** course-detail eksponerer `available` per MODULE-element (publisert
  aktiv versjon, ikke arkivert); deltaker-UI viser «Ikke tilgjengelig» (ikke-klikkbar) i stedet for
  en blindvei-klikk som ga feilmelding.
- Tester: `m2-course-module-availability` + oppdaterte conv-create-e2e. tsc + 309 integrasjon + 75
  e2e grønt.

## 1.4.3 - 2026-06-28

refactor(course): CourseItem som eneste sannhetskilde — lese-cutover (#502, del 1)

Contract-fasen av #480: alle lesninger av kursets moduler går nå mot `CourseItem` (MODULE-elementer)
i stedet for `CourseModule`-join-en, og dual-write til `CourseModule` er fjernet.

- Repository: `findCourseById`, `findPublishedCourses`, `findPublishedCoursesWithModuleDetails`,
  `findPublishedCoursesContainingModule`, `listCourses` deriverer nå `modules`/`_count.modules` fra
  CourseItem (retur-shape uendret → konsumenter urørt). publishCourse-gate teller MODULE-elementer.
- `setCourseItems`/`setCourseModules` skriver kun CourseItem (ingen dual-write). adminContent
  (modul-i-N-kurs-guard, purge-kandidater) + enrollment (`isModuleInAccessibleCourse`,
  in-progress-probe) lest om til CourseItem.
- **CourseModule-tabellen beholdes** (ingen migrasjon) — selve `DROP` er et eget steg etter
  prod-soak (reverserbart; ingen data tapt siden CourseItem har alt).
- **Fix:** `.env.test` setter nå `PARTICIPANT_COURSE_ONLY=false` — gaten (v1.4.0) defaultet true i
  test og blokkerte frittstående-submission-tester, som gjorde **main-CI rød siden v1.4.0**. Gaten
  dekkes fortsatt av `m2-participant-course-only`. Oppdaterte tester som lagde CourseModule direkte.
- Verifisert: tsc + unit 689 + dom 5 + integrasjon 308 grønt.

## 1.4.2 - 2026-06-28

fix(sections): sticky bilde-toolbar festes under tab-baren (#679 oppfølging)

Den sticky pane-toolbaren (`.editor-pane-label`) lå bak den sticky workspace-tab-baren
(`.content-area-nav`, `top:0`), så «Last opp bilde» bare så vidt stakk fram. Forskjøvet til
`top: 46px` (under tab-baren) + høyere z-index, så hele toolbaren er synlig i høy editor.

## 1.4.1 - 2026-06-28

fix(ux): bunt med små deltaker-/forfatter-forbedringer (lav risiko)

- **Terminologi (deltaker):** fjernet «Modul»/«Seksjon»-begrepene i kursvisningen — handlingen bærer
  meningen: «Les» på seksjoner, «Gjennomfør» på moduler. Kun deltaker-overflaten; forfatter/admin
  beholder begrepene.
- **#656:** fullskjerm-veksling (⛶) i seksjonsleseren for deltaker.
- **#679:** «Last opp bilde»-toolbaren i seksjonseditoren er nå sticky i høy editor (CSS).
- **#673:** arkiverte kurs skjules fra standard kursliste; «Vis arkiverte (N)»-toggle + «Gjenopprett»
  (nytt `POST /api/admin/content/courses/:id/restore`).
- Tester: restore-integrasjon + oppdatert arkiv-e2e; e2e-suite 75 grønn.

## 1.4.0 - 2026-06-28

feat(participant): deltakere når moduler kun via kurs (PARTICIPANT_COURSE_ONLY)

Forenkling av deltaker-overflaten: én inngang (kurs) i stedet for både frittstående moduler og
kurs. Modul forblir authoring-/vurderings-primitivet; kun deltaker-tilgangen begrenses.

- Nytt flagg `PARTICIPANT_COURSE_ONLY` (env, **default `true`** — på i alle miljø). Eksponert i
  `/participant/config` som `courseOnly`.
- **Backend-gate:** `POST /api/submissions` krever at modulen ligger i et publisert kurs deltakeren
  har tilgang til (`isModuleInAccessibleCourse`), ellers `403 course_required`. Modul åpnet via
  course player passerer. SMO/ADMIN er unntatt. Hard grense — gjelder alle nye innleveringer; ingen
  datamigrasjon, historikk bevares.
- **Frontend:** den frittstående modul-seksjonen (`#moduleListSection`) skjules når `courseOnly`.
- Tester: `test/m2-participant-course-only.test.ts` (gate) + `test/e2e/participant-course-only.spec.ts`
  (UI skjuler/viser modul-lista). Escape-hatch: sett `PARTICIPANT_COURSE_ONLY=false`.

Markerer overgangen til Tier-2-leveransen (diskusjon #495 + kurs-only) — minor-bump til 1.4.0.

## 1.3.95 - 2026-06-28

fix(discussions): helhetlig fargekoding av status-badges (#495)

Rettet semantikken i diskusjons-badgene og samlet paletten i CSS-klasser (.disc-badge--*)
som gjenbruker app-ens etablerte badge-farger (jf. .sr-badge--*):

- **Åpen → gul** (trenger svar), **Løst → grønn** (fullført), **Låst → rød** (lukket).
  (Var tidligere semantisk bakvendt: Åpen=grønn, Løst=blå.)
- **Spørsmål → blå** (informasjon), **Diskusjon → grå** (nøytral kategori).
- **✓ Akseptert svar → grønn** (matcher Løst). **📌 Festet** = hvit m/gull kant (meta-markør).
- Fargene flyttet fra inline-hex i `discussion-panel.js` til `shared.css` for et temabart,
  helhetlig design.

## 1.3.94 - 2026-06-28

fix(discussions): UX-polish av diskusjonspanelet (#495)

- Fikset stablede fullbreddeknapper (arv fra global `button{width:100%}`) — egen scopet CSS gir
  kompakte verktøylinjer med auto-bredde-knapper.
- Panelet er nå en lett distinkt «sone» (ikon + tittel + venstre-aksent) som beholder app-ens
  designspråk, så det er gjenkjennelig men tydelig en egen modul.
- Moderering (Fest/Lås/Slett) samlet i en egen, dempet verktøylinje med fare-farge på Lås/Slett,
  klart adskilt fra deltaker-handlinger (abonnement, svar). «← Tilbake» som lenke; «Svar»
  høyrejustert primærknapp.
- Ren stil-/markup-endring i `discussion-panel.js` + `shared.css`; ingen API-endring. e2e oppdatert.

## 1.3.93 - 2026-06-27

feat(discussions): varsler + per-element toggle + brukerguide — #495 komplett (T-QA-5, T-QA-4, T-QA-6)

- **Varsler (T-QA-5):** nytt spørsmål → kursets SMO-er (aktive SUBJECT_MATTER_OWNER); nytt svar →
  trådens abonnenter. Locale-keyed templates (en-GB/nb/nn) i `notificationMessages.ts`, sendt via
  ACS-kanalen (`sendDiscussionNotification`). Best-effort (svelger feil), audit per varsel.
  Ingen lenker i e-post (#688). Preferanse-styring overlatt til #497.
- **Per-element toggle (resten av T-QA-4):** `CourseItem.discussionsEnabled` bæres i `PUT /items`
  + avkrysning per modul/seksjon i kurs-editoren. Default på.
- **Docs (T-QA-6):** `doc/DISCUSSIONS_GUIDE.md` (deltaker + forfatter); design-status satt til
  implementert.
- Tester: discussion-notifications (unit) + varsel-/per-element-audit (integrasjon).

Med dette er hele #495 (T-QA-1..6) implementert og lokalt verifisert.

## 1.3.92 - 2026-06-27

feat(discussions): forfatter av/på-toggle på kurset + API-dokumentasjon (#495/T-QA-4, T-QA-6)

- Kurs-master-toggle `discussionsEnabled` eksponert i admin-kurs-API-et (`POST`/`PUT
  /api/admin/content/courses`) + admin-kurs-detalj, og en avkrysningsboks i kurs-editoren
  (`admin-content-courses.js`). Default på.
- Integrasjonstest for admin round-trip (av → på).
- Docs: `doc/API_REFERENCE.md` (Discussions/Q&A-seksjon) + `doc/route-map.md`.

Merknad: per-element (per modul/seksjon) av/på-toggle i editoren gjenstår som en avgrenset
videreføring — datamodell/API støtter `CourseItem.discussionsEnabled` allerede (default på), og
deltaker-panelet respekterer det; kun forfatter-UI for per-element-bryteren mangler.

## 1.3.91 - 2026-06-27

feat(discussions): deltaker-UI i course player + inline moderering (#495/T-QA-3, delvis T-QA-4)

Gjenbrukbart diskusjonspanel (`public/static/discussion-panel.js`) montert på kurs-nivå (under
kurssekvensen) og per seksjon (i lese-overlayet), drevet av T-QA-2-API-et.

- Trådliste (festet/badge for type + status), trådvisning med flat svarliste, compose-boks,
  «marker som svar» for spørsmål, abonner/avslutt. UGC injiseres som server-sanitert `bodyHtml`.
- Inline moderering (pin/lås/slett andres) vises ut fra server-flaggene `canModerate`/`canDelete`
  /`canAccept` — samme panel for deltaker og SMO (dekker moderering-delen av T-QA-4).
- Course-detalj-DTO eksponerer nå `courseItemId` + `discussionsEnabled` per element og
  `discussionsEnabled` på kurset, så panelet kan festes per element og skjules når avskrudd.
- i18n: nye `discussion.*`-nøkler i alle tre locales (en-GB, nb, nn).
- e2e: `test/e2e/participant-discussions.spec.ts` (opprett tråd → list → åpne → svar) mot ekte
  participant.js + discussion-panel.js.

Gjenstår av T-QA-4: forfatter-av/på-toggles i kurs-editoren (datamodell/API støtter det allerede
via `discussionsEnabled`, default på).

## 1.3.90 - 2026-06-27

feat(discussions): backend API + authz + UGC-sanitering (#495/T-QA-2)

REST-API for diskusjon/Q&A under `/api/courses/:courseId/discussions`, montert på coursesRouter
så autorisasjon arver «har tilgang til publisert kurs». Fortsatt ingen UI (det er T-QA-3/4).

- Ruter: list/opprett tråd, tråd+svar, svar, rediger egen, moderering (pin/lås), aksepter svar,
  soft-delete (tråd/svar), abonner/avslutt. zod-validering på all input.
- Authz: les/skriv krever publisert-kurs-tilgang (OPEN for alle, RESTRICTED for enrolled/klasse;
  SMO/ADMIN alltid). Moderering + slett-andres krever SMO/ADMIN; aksepter svar = spørrer/moderator.
- Scope-håndheving: skriving blokkeres når `discussionsEnabled` er av på kurs/CourseItem, eller
  tråden er `LOCKED`. Soft-delete, aldri hard-delete.
- **Restriktiv UGC-render** (`renderDiscussionMarkdown`) — egen, strengere DOMPurify-allowlist
  uten iframe/rå-HTML/bilder, separat fra `renderSectionMarkdown`. Lenker tvinges til
  `rel=noopener noreferrer` + `target=_blank`.
- Dedikert `discussionWriteLimiter` (30/min), nye audit-typer/-handlinger, anonymiserte brukere
  vises uten navn.
- Tester: `test/unit/ugc-sanitizer.test.ts` (sanitering) + `test/m2-discussions-api.test.ts`
  (flyt, authz, scope/lock, soft-delete, sanitering, validering, tilgang).

## 1.3.89 - 2026-06-27

feat(discussions): datamodell + migrasjon for diskusjon/Q&A (#495/T-QA-1)

Første skive av diskusjonsfunksjonaliteten (epic #478, design i `doc/DISCUSSIONS_DESIGN.md`).
Kun datamodell — ingen API/UI ennå (det er T-QA-2..4). Ship-safe alene.

- Nye modeller: `DiscussionThread`, `DiscussionReply`, `DiscussionSubscription` + enums
  `DiscussionThreadKind` (QUESTION/DISCUSSION) og `DiscussionThreadStatus` (OPEN/RESOLVED/LOCKED).
- Av/på-toggle `discussionsEnabled Boolean @default(true)` på `Course` og `CourseItem`. Default
  `true` (besluttet 2026-06-27): eksisterende publiserte kurs får diskusjon på når feature lander;
  produsent kan opt-out per kurs/modul/seksjon. Effektiv regel:
  `Course.discussionsEnabled && CourseItem.discussionsEnabled`.
- UGC er énspråklig ren tekst (ikke lokalisert JSON). Soft-delete (`deletedAt`/`deletedById`),
  aldri hard-delete, for trådintegritet. `acceptedReplyId` er unikt (ett løsningssvar per tråd).
- Migrasjon er additiv og ikke-brytende (alle kolonner har DEFAULT, alle tabeller tomme).
- Integrasjonstest `test/m2-discussions-datamodel.test.ts` pinner defaults, unike constraints,
  soft-delete og cascade.

## 1.3.88 - 2026-06-26

fix(admin-content): prod-bugs på Klasser/Seksjoner — admin-knapper skjult + topp-nav borte (#690)

To prod-bugs oppdaget rett etter v1.3.87, begge fordi klient-koden leste roller/identitet fra
`identityDefaults` som KUN finnes i mock-rolle-modus (`participantConsole.ts` sender `undefined` i
prod/Entra):

1. **Admin-knapper skjult i prod** (Klasser): «Importer brukere fra fil» og «Synk brukere fra Entra»
   gates på `isAdministrator`, utledet fra `identityDefaults.contentAdmin.roles` → alltid `false` i
   prod. Nå hentes rollen fra `/api/me` (tokenets `user.roles`).
2. **Topp-menyen (workspace-nav) borte på Klasser OG Seksjoner**: nav-items filtreres på brukerroller.
   Klasser sendte feil argument (hele config-objektet som `navItems` → sanitert til `[]`); Seksjoner
   sendte `roles=""` (fra fraværende identityDefaults) → alle rolle-gatede nav-items skjult →
   `workspaceNav.hidden`. Begge henter nå roller fra `/api/me` og sender riktig `navigation.items`,
   som courses/library/calibration allerede gjorde.

**Hvorfor lokal test ikke fanget #1:** e2e-mock satte BÅDE identityDefaults OG /api/me, så prod-formen
(uten identityDefaults) ble aldri kjørt — testen tok den bekvemme stien, ikke den ekte brukerreisen.
Nye regresjonstester pinner prod-formen (identityDefaults fraværende, roller fra /api/me) for både
admin-knappene og topp-nav (classes + section-editor e2e).

## 1.3.87 - 2026-06-26

feat(orgsync): automatisk Entra-brukersynk for klasse-tildeling (#690)

Plattformen provisjonerer brukere just-in-time ved innlogging, så en ansatt er ikke søkbar/tildelbar
før hen har logget inn første gang. Ny **Entra-brukersynk** importerer medlemmene av ansatt-gruppa
«Alle i A-2 Norge» (~61, ikke de 246 tenant-objektene som mest er gjester) til `User`-tabellen via
Microsoft Graph (managed identity) → `applyOrgDeltaSync` (upsert, `externalId = oid`). On-demand:
admin-knapp **«Synk brukere fra Entra»** på Klasser-siden + `POST /api/admin/sync/org/entra`
(ADMINISTRATOR). Planlagt: `EntraUserSyncMonitor` i worker (default 24h), kun aktiv når
`ENTRA_USER_SYNC_GROUP_ID` er satt. ⚠️ Den automatiske Graph-pullen krever ett Entra-admin-steg: gi
app-ens managed identity Graph-permission `GroupMember.Read.All` (+ `User.Read.All`) med consent
(katalogrolle, ikke subscription-Owner). **Stopgap som virker uten consent:** admin-knapp **«Importer
brukere fra fil»** på Klasser-siden tar imot en JSON eksportert med admins egen delegerte tilgang
(`az ad group member list`) og kjører samme upsert via `POST /api/admin/sync/org/delta`. Se
`doc/ops/ENTRA_USER_SYNC_690.md`. Mapping-unit-tester + e2e (admin-only Graph-knapp + POST, fil-import).

## 1.3.86 - 2026-06-26

fix: stage-funn for v1.3.85 — MCQ-revise datatap, arkiverte kurs, e-post-lenke (#688)

Tre funn under stage-verifisering: (1) **MCQ-revise reduserte spørsmål** — «Endre alternativ 1b»
kollapset 10 → 1 spørsmål (LLM droppet de andre, heuristikken godtok det). For en målrettet endring
(eksplisitt mål) MÅ antallet nå bevares; ellers retry, så avvis med tydelig melding (ikke stille
datatap). (2) **Arkiverte kurs var tildelbare** i klasse-oversikten — nå filtrert bort i UI + backend-
vakt (`assignCourseToClass` avviser arkivert kurs med 400). (3) **E-post-lenke fjernet** —
firmapolicy forbyr e-post med lenker (spoofing); varselet ber nå bruker logge inn selv, og
`PUBLIC_APP_BASE_URL`-config er fjernet (#687 lukket). Unit-/integrasjons-/e2e-tester dekker alle tre.

## 1.3.85 - 2026-06-26

feat(classes): e-postvarsel til studenter når klassen tildeles et kurs (#684)

Når en MANUAL-klasse tildeles et kurs (#675), får hvert medlem en e-post med kursnavn, evt. frist og
lenke til deltaker-arbeidsflaten. **Unntak:** systemklassen «Alle deltakere» (ville spammet hele
organisasjonen) og ENTRA-klasser (ingen lagrede medlemsrader). Gjenbruker
`participantNotificationService` (kanal-dispatch: `log` i dev/test, `acs_email` på stage/prod).
**Fire-and-forget:** tildelingen lykkes og blokkeres aldri av e-post. Ny valgfri config
`PUBLIC_APP_BASE_URL` for absolutt kurs-lenke (uten den: e-posten ber bruker logge inn). Unit-tester
for varsel-bygging (emne/tekst/lenke + login-fallback).

## 1.3.84 - 2026-06-26

feat(course): synlighets-kontroll (Åpen / Begrenset) på kurs (#645/#496)

`enrollmentPolicy` (OPEN/RESTRICTED) lå i datamodellen (#646) men var ikke eksponert noe sted —
`updateCourse` ignorerte feltet, så alle kurs var låst til OPEN, og klasse-/enrollment-synlighet kunne
ikke testes ende-til-ende. Kurs-redigeringsskjemaet har nå en **«Synlighet: Åpen / Begrenset»**-velger
(create + update), API-et (`POST`/`PUT /courses`) tar imot `enrollmentPolicy`, og kurs-detalj-responsen
returnerer den. Et RESTRICTED-kurs er kun synlig for individuelt tildelte eller medlemmer av en klasse
kurset er tildelt (#645/CL-2). Playwright-e2e dekker å sette Begrenset.

## 1.3.83 - 2026-06-26

fix(authoring): samtale-basert MCQ-endring krasjet med 500 i prod (#682)

To kode-bugs i MCQ-revise-stien (`reviseMcqQuestions`), observert i prod:
1. **Over-produksjon av alternativer:** LLM-en returnerte av og til et spørsmål med >6 svaralternativer;
   codec-en tillater maks 6 → hard 500 («Array must contain at most 6 element(s)»), ingen retry. Nå
   **coerces** rå-svaret før validering — alternativer klippes til maks (riktig svar beholdes) via
   `clampMcqOptionCount`, rutet inn i generate/revise/localize.
2. **Heuristikk-hard-fail:** `hasMeaningfulMcqRevision` ga 500 («did not produce a material change») på
   falske negativer (endringen landet, men ikke på det parsede målet). Heuristikken styrer nå kun
   *retry*; bare en ekte no-op (revisjon identisk med kilden) gir feil — ellers returneres revisjonen
   for forfatter-gjennomgang.

Unit-tester for coercion (>6 → 6, riktig svar bevart). `tsc` rent.

## 1.3.82 - 2026-06-26

fix(nav): «Klasser»-fane på alle innholdsforvaltnings-sider (#645/CL-3 oppfølging)

CL-3 la «Klasser»-fanen kun til på kurs- og seksjons-sidene; den manglet på modul-biblioteket
(«Moduler») og kalibrering, så klasse-siden var uoppdagbar derfra. Fanen er nå på alle fem
content-area-nav-flatene (kurs, moduler/bibliotek, seksjoner, klasser, kalibrering). E2e i
modul-bibliotek-spec-en låser at fanen finnes.

## 1.3.81 - 2026-06-26

feat(course): klasser (kohorter) for kurstildeling (#645 / CL-1..CL-3)

Innfører **klasser** — plattform-eide, mange-til-mange grupper man tildeler kurs til samlet (#645,
besluttet i `doc/design/COHORT_GROUPING_645.md`). Datamodell `Class` + `ClassMember` +
`CourseGroupAssignment` (CL-1), service + admin-API + audit + **dynamisk** synlighet (CL-2): en
deltaker er tildelt et kurs hvis hen er medlem av en tildelt klasse, evaluert ved lesetid (aldri
materialisert). `GET /api/courses` og `/enrollments` reflekterer klasse-tildelinger (sistnevnte med
`source: "CLASS"`). Innebygd systemklasse **«Alle deltakere»** (alle med PARTICIPANT-rolle).
Admin-UI på `/admin-content/classes` (CL-3): opprett klasse, søk+legg til studenter, tildel kurs med
frist. Entra-koblede klasser (`kind=ENTRA`) er forberedt men gated bak `classEntraLinkingEnabled`
(default av, CL-5 — senere). Dekket av unit- + integrasjons- + Playwright-e2e-tester.

NB: `User.department`-sletting (CL-4, #677) ble **kansellert** — feltet er en kjerne-dimensjon i
rapportering (orgUnit-filter, cohort-analyse) og beholdes. Klasser dekker tildeling; department dekker
analyse. CL-5 (Entra-koblede klasser) er forberedt men utsatt (#678).

## 1.3.80 - 2026-06-25

fix(sections): markdown-input vokser til å matche forhåndsvisningens høyde (#662)

I seksjonseditoren sto markdown-`<textarea>` fast på sin 320px-minimumshøyde mens forhåndsvisnings-
panelet vokste med innholdet — så forfatteren redigerte i en liten boks ved siden av en høy preview.
Hver kolonne er nå en flex-kolonne, og textarea + preview fyller grid-raden (som strekker seg til den
høyeste). Resultat: input-feltet vokser til å matche forhåndsvisningen (og kan fortsatt dra-justeres).
Dekket av en Playwright-e2e som måler at textarea-høyden følger en høy preview.

## 1.3.79 - 2026-06-25

feat(course): Enrollment backend API + authz + synlighetsfilter (#641 / #496 EN-2)

Bygger videre på EN-1-datamodellen. Nye endepunkter: admin (SMO/ADMINISTRATOR) kan tildele kurs til
deltakere — enten en eksplisitt brukerliste (source=INDIVIDUAL) eller alle aktive i en avdeling
(source=DEPARTMENT, materialisert til individuelle rader ved tildeling) — med valgfri frist, samt
fjerne (soft-revoke) og liste tildelinger per kurs. Deltakere ser egne tildelinger
(`GET /api/courses/enrollments`, med derivert status) og kan selv-melde seg på OPEN-kurs
(`POST /api/courses/:courseId/enroll`, source=SELF; RESTRICTED avvises). `GET /api/courses` har nå et
**synlighetsfilter**: RESTRICTED-kurs vises kun for tildelte; OPEN for alle. Tildeling/fjerning
auditeres. Status er alltid DERIVERT (aldri lagret). Integrasjonstester dekker tildel/list/revoke,
synlighet, selv-påmelding, og at deltaker ikke kan tildele (403). NB (#645): avdelings-tildeling
finner ingen brukere før `User.department` er populert; individuell er primær til da.

## 1.3.78 - 2026-06-25

fix(course): «Arkiver»-knapp i kurslista (#660-oppfølging)

Slette-blokkeringen i #660 ber forfatteren arkivere kurset i stedet, men arkiv-funksjonen var ikke
eksponert i UI-et (kun i backend). Kurslista har nå en **«Arkiver»**-handling per kurs (wiret til det
eksisterende `POST /:courseId/archive`), med en lett bekreftelse. Arkiverte kurs vises med et
**«Arkivert»**-merke, og arkiver-knappen skjules for dem. Dekket av en Playwright-e2e.

## 1.3.77 - 2026-06-25

fix(shell): MCQ-only direkte-redigering bevarer modultype + skjuler fritekst-felt (#665)

Oppfølging til #655. I samtale-flyten mistet «Rediger direkte» modulens `assessmentMode` for en
lastet MCQ-only-modul (sessionDraft er null → den rekonstruerte draften falt tilbake til
FREETEXT_PLUS_MCQ), så påfølgende lagring/publisering feilet med «Utkastet må ha scenario/
oppgavetekst». Samtidig viste edit-skjemaet alltid tomme, redigerbare fritekst-felt (oppgavetekst/
føringer/veiledning) som en MCQ-only-modul ikke har. `enterPreviewEditMode` utleder nå
`assessmentMode` (+ MCQ-terskel) fra `sessionDraft ?? bundle.moduleVersion`, skjuler fritekst-felt +
kriterier for MCQ-only, og bevarer modustypen på den rekonstruerte draften. Ny Playwright-e2e dekker
direkte-redigerings-stien. (Rydder også bort en utilsiktet tom fil `0`.)

## 1.3.76 - 2026-06-25

fix(sections): SVG-localize hopper over uendrede tegninger (#663)

`localizeSectionAssets` re-oversatte alle SVG-tegninger hver gang «Oversett» ble trykket, selv om
tegningen var uendret — bortkastede LLM-kall og en mulig kilde til drift (LLM kan gi litt ulik
oversettelse). En asset sin base-SVG er uforanderlig (re-opplasting lager ny asset), så en asset som
allerede har varianter for alle målspråk fra samme kildespråk hoppes nå over. Endepunktet returnerer
`skippedAssetCount`, og frontend melder kun «oversatt» når noe faktisk ble oversatt. Integrasjonstest
dekker at andre localize-kall med samme kildespråk gir `localizedAssetCount=0` / `skippedAssetCount=1`.

## 1.3.75 - 2026-06-25

fix(course): tydelig feil ved sletting av kurs med fullføringer (#660)

Å slette et kurs som hadde fullføringer (utstedte kursbevis) ga en generisk 500 «An unexpected
error occurred» — `CourseCompletion.course` er `onDelete: Restrict` (bevisst — kursbevis er
prestasjons-poster), men `deleteCourse` slettet ikke completions, så `course.delete` feilet med
FK-violation. `deleteCourse` blokkerer nå med en tydelig 400-melding når kurset har fullføringer, og
peker på arkivering (soft-delete) i stedet for å slette kursbevis stilltiende. Integrasjonstest
dekker både blokkering (med completions) og vanlig sletting (uten).

## 1.3.74 - 2026-06-25

feat(sections): trygg SVG-opplasting + lokaliserte SVG-tegninger (#657)

Seksjonsbilder støtter nå SVG. SVG var tidligere bevisst utelatt (XSS-vektor, #483/F4); det er nå
tillatt fordi hver opplastede SVG **saneres server-side** med DOMPurify (`<script>`, `on*`-handlere,
`<foreignObject>`, `<a>`, `javascript:` fjernes) før den lagres, så bytene på disk er inerte. Bilder
rendres som `<img>` (kjører ikke script), og serve-endepunktet legger på `Content-Security-Policy: …;
sandbox` + `X-Content-Type-Options: nosniff` som dybdeforsvar mot direkte-navigering.

I tillegg: når en SVG inneholder tekst, genererer forfatterens **«Oversett»**-handling lokaliserte
varianter — `<text>`/`<tspan>`-etiketter ekstraheres, oversettes til hvert støttede språk (nb/nn/en-GB)
via samme LLM-localize som modultekst, og lagres som per-språk-varianter. Oversettelse er en **eksplisitt
handling** (aldri implisitt ved lagring), konsistent med lærer-locale-kontroll. Servering velger variant
etter leserens språk (`?locale=`, fallback til original). Geometrien er uendret, så forfatter må
verifisere layout per språk (oversatt tekst reflower ikke). Datamodell: `SectionAsset.sourceLocale` +
`localizedBlobPaths`. Dekket av unit-tester (sanering + XSS-vektorer + tekst-round-trip) og
integrasjonstester (opplasting saneres, serve-headers, localize→variant).

## 1.3.73 - 2026-06-25

fix(admin): MCQ-only-modul kan revideres i samtale + Modultype-radioer (#655)

To klient-lags-bugs i Avansert innholdsforfatting. (1) Radioknappene under «Modultype» arvet
`width:100%` fra base-input-stilen — bare `input[type=checkbox]` var unntatt (#546) — så radioen
strakk seg over hele panelet og dyttet labelen til høyre; nå får `input[type=radio]` samme
`width:auto`. (2) En MCQ-only-modul kunne ikke lagres når den ble revidert via «Fortsett å redigere
i chat»: `createSessionDraftFromLoadedModule` kopierte ikke `assessmentMode` fra den lastede modulen,
så lagrings-valideringen behandlet den som «Fritekst+flervalg» og krevde scenario/oppgavetekst som
MCQ-only aldri har. Draften bærer nå over `assessmentMode` + `mcqMinPercent`. Begge dekket av en ny
Playwright-e2e (`admin-content-mcq-only-revision.spec.ts`).

## 1.3.72 - 2026-06-25

feat(course): CourseEnrollment datamodel foundation (#640 / #496 EN-1)

Adds the enrollment persistence foundation for Tier 2 course assignment: `Course.enrollmentPolicy`
(`OPEN` by default for backward compatibility), `CourseEnrollment` with individual/department/self
sources, optional due date, soft revoke, and cascade cleanup for user/course deletion. Enrollment
status remains derived, not stored, using completion/progress/due-date precedence. The new repository
and status helper are exported from the course module and covered by unit tests.

## 1.3.71 - 2026-06-24

infra(openai): ta Azure OpenAI-konto + modell-deployment inn i Bicep (#607)

Azure OpenAI-kontoen + `gpt-4.1-mini`-deploymentet var ikke i IaC — TPM-kapasiteten (hevet manuelt
til 100 via `az` under #479) var verken dokumentert eller reproduserbar. `main.bicep` deklarerer nå
`Microsoft.CognitiveServices/accounts` + `/deployments` med navn som matcher de eksisterende
ressursene EKSAKT (`a2-assessment-<stg|prod>-openai-weu-<suffix>` — eget env-token `stg`/`prod`, ikke
envCode `stg`/`prd`), så en Incremental-deploy ADOPTERER dem. `capacity` er nå en parameter
(default 100). **Deployes ikke før what-if er gjennomgått** (verifiser Modify/NoChange, aldri Create).

## 1.3.70 - 2026-06-24

feat(admin): advarsel ved bildetungt/lav-tekst kildemateriale (#601 Fase 1)

Bildetunge PPT/PDF (der innholdet *er* diagrammer/skjermbilder) ga nesten ingen tekst, og
forfatteren fikk ingen indikasjon på hvorfor modulen ble tynn. Ny `assessSourceMaterialTextDensity`
flagger stor binær-doc med lite tekst; `lowTextDensity` bæres gjennom parse-resultatet til frontend,
som viser en (ny) warning-toast ved opplasting — fila aksepteres fortsatt. Deteksjon-først; ingen
LLM-kost. Fase 2 (Claude multimodal vision bak terskel + rasterizer + personvern-gate) gjenstår.
Se doc/design/SOURCE_MATERIAL_VISION_601.md. Tester: unit + Playwright-e2e (begge grønne lokalt).

## 1.3.69 - 2026-06-24

fix(infra): backup-vault role-assignment feiler hardt på ekte feil (#468, invariant #6)

De to `az role assignment create | Out-Null` i backup-vault-seksjonen av
`deploy-environment.ps1` undertrykte både success-JSON OG feil — et brudd på infra-invariant #6.
Erstattet med `Invoke-IdempotentRoleAssignment` som fanger stdout+stderr og feiler deployen hardt
på ekte feil, men tolererer den idempotente `RoleAssignmentExists`-re-runen (samme unntak som
ARM-siden via `Test-DeploymentFailureIsIdempotent`). Beslutningslogikken er den unit-testede
`Test-RoleAssignmentSucceeded`-helperen. PS-4-oppføringene fjernet fra `.lint-infra-allowlist`.

## 1.3.68 - 2026-06-24

fix(assessment): 429/5xx-retry i assessment-LLM-klienten (#603)

`llmAssessmentService` manglet retry på transient Azure OpenAI 429 (TPM-kvote) / 5xx — en
forbigående rate-limit feilet en deltaker-vurdering. Retry-policyen fra authoring-pipelinen
(#479, v1.3.54) er ekstrahert til en delt `src/modules/llm/azureOpenAiRetry.ts`
(`fetchAzureOpenAiWithRetry` + Retry-After-parsing + capped exponential backoff m/ jitter) og
brukes nå av begge klientene. Parameter-fallbacken (token-param/temperatur) i assessment-klienten
er urørt; den overordnede timeout-signalen begrenser total tid på tvers av retries. Ny unit-test
dekker Retry-After-parsing, backoff-grenser og retry/exhaust-oppførsel.

## 1.3.67 - 2026-06-24

fix(participant): auto-last kursbevis på «Fullførte moduler»-siden (#580)

«Mine kursbevis» på `/participant/completed` viste alltid «Ingen kursbevis ennå», selv når et
bevis fantes (Profil viste det). Årsak: `loadCourseCertificates()` ble kun kalt ved klikk på
«Last fullførte moduler»-knappen (som gjelder moduler) — aldri ved sidelasting. Bevis hentes nå
automatisk når siden åpnes (etter console-config så identitet/headers er klare i mock-auth; entra
bruker Bearer via apiFetch). Ny Playwright-e2e dekker auto-last + tom-tilstand.

## 1.3.66 - 2026-06-24

fix(certificate): hold midten-nederst fri for diplom-segl (#580)

Diplom-bakgrunnen har et sentrert A2-segl nederst i midten. Bevis-malens meta-rad
hadde tre sentrerte kolonner, og den midterste (sertifiseringsnivå) lå rett oppå
seglet. Sertifiseringsnivå er flyttet opp som en linje under kurstittelen, og
bunn-raden har nå kun to elementer (fullført-dato til venstre, moduler til høyre)
med `space-between` — midten-nederst holdes fri for seglet. Bilde-uavhengig.

## 1.3.65 - 2026-06-24

fix(course): utsted kursbevis for lese-/seksjonskurs uten moduler (#580)

**Bug (bruker-rapportert, forts.):** etter 1.3.64 vistes fortsatt ingen kursbevis for «Fullførte»
kurs. Årsak: et kurs **uten assessment-moduler** (LMS Tier 2, markdown-først, #476) vises som
«Fullført» når alle seksjoner er lest, men `evaluateCourseCompletion` bailet på
`moduleIds.length === 0` (gammel `if (total === 0) return` telte kun moduler) og utstedte aldri
bevis. Porten regner nå **både moduler og seksjoner**: bevis utstedes når alle moduler er bestått
OG alle seksjoner lest, så lenge kurset har minst ett element. Dette fikser både live-utstedelse
(seksjon-lest-event) og backfill via avstemmingen. Avstemmingen isolerer nå hvert kurs i try/catch
så ett dårlig kurs ikke kan blanke hele bevis-lista eller 500-e `/api/courses/completions`.

## 1.3.64 - 2026-06-24

fix(course): backfill manglende kursbevis + «Fullførte moduler» i menyen (#580)

**Bug (bruker-rapportert):** kurs viste «Fullført» i kurs-lista, men ingen kursbevis fantes → 404
ved åpning av bevis, og «Ingen kursbevis ennå». Årsak: kurs-listas «Fullført» er seksjons-inklusiv
(alle moduler bestått + alle seksjoner lest) — nøyaktig samme porter som bevis-utstedelse — men
utstedelsen er **hendelsesdrevet** (fyres når siste modul bestås / siste seksjon leses) **uten
avstemming**. Om hendelsen ble bommet (data fra før logikken, en sti som ikke fyrte, eller en
svelget fire-and-forget) ble beviset aldri opprettet.

- **Avstemming:** ny idempotent `reconcileCourseCompletionsForUser` kjøres når deltakeren åpner
  «Mine kursbevis» (`GET /api/courses/completions`) og backfiller alle bevis hvis porter er møtt.
- **Nav:** la til «Fullførte moduler» (`/participant/completed`) i workspace-navigasjonen (manglet;
  `nav.completedModules`-labelen fantes allerede ubrukt).
- **Test:** integrasjonstest (porter møtt uten utløser → `GET /completions` backfiller); nav-config-
  kontrakt grønn.

## 1.3.63 - 2026-06-24

fix(certificate): hev diplom-bakgrunn-grense 5 → 15 MB (#580)

5 MB avviste legitime print-kvalitets-diplomer (A4 @ 300 DPI). Hevet til 15 MB
(`CERTIFICATE_BACKGROUND_MAX_BYTES` — samme konstant binder både service-validering og multer-
opplastingsgrensen). UI-hint + docs oppdatert. Merk: bildet lastes av hver deltaker som åpner
beviset, så et optimalisert bilde laster raskere.

## 1.3.62 - 2026-06-23

feat(certificate): plattform-bredt diplom-bakgrunnsbilde (#580)

En ADMINISTRATOR kan laste opp ett felles bakgrunnsbilde som vises bak alle kursbevis (diplom-
identitet). Reuser F4 blob-lagring (`putAsset`/`getAsset`) + plattform-KV-config for referansen —
**ingen ny modell/migrasjon**.

- **Backend:** `certificateBackgroundService` (set/get/clear, mime+5 MB-validering).
  `POST`/`DELETE /api/admin/platform/certificate-background` (ADMINISTRATOR, multipart). Bildet
  serveres **uautentisert** på `GET /certificate-background` (ikke-sensitiv branding; 404 når ikke
  satt) så CSS-`background-image`/`<img>` kan laste det uten auth-headers. `GET /api/admin/platform`
  får `certificateBackground: boolean`; completions-responsen får `certificateBackgroundUrl`.
- **Frontend:** admin-platform-side får opplasting + forhåndsvisning + fjern (umiddelbar effekt).
  `certificate.js`/`.html` rendrer bildet bak teksten, print-trygt (`print-color-adjust: exact`).
  i18n en-GB/nb/nn.
- **Test:** unit (service, mocket blob+KV, 5) + e2e (bevis rendrer bakgrunn + negativ-assertion).
- **Docs:** API_REFERENCE + COURSE_CERTIFICATES_GUIDE (admin-seksjon).

## 1.3.61 - 2026-06-22

refactor(frontend): siste #596-rester — escapeHtml-varianter + kort-dato (EPIC #595)

Avslutter #596-dedupliseringen.

- **escapeHtml (divergerende):** `static/admin-content-preview.js`, `static/admin-content-shell.js`,
  `static/loading.js` brukte `String(x)` uten `?? ""`. Nå importert fra `html-escape.js` (kanonisk).
  Eneste atferdsendring: null/undefined → `""` i stedet for `"null"`/`"undefined"` (latent bugfix).
  `static/admin-content-sections.js` lar vi stå — den escaper også `'` (attributt-kontekst-sikkerhet),
  som er en legitim forskjell, ikke et duplikat.
- **Kort-dato:** ny `createDateFormatter` i `format-display.js`; de **2 identiske** `formatDate`-kopiene
  (`static/admin-content-courses.js`, `static/admin-content-library.js`, `toLocaleDateString` numerisk)
  bruker den nå. (Ternæren `currentLocale === "en-GB" ? "en-GB" : currentLocale` var == `currentLocale`.)
  Én-av-sitt-slag-formaterne (certificate `dateStyle:"long"`, profile.formatDate `medium`,
  admin-content NaN-guard) er distinkte formater, ikke duplikater — bevisst latt stå.

**#596 ferdig:** ~40 dupliserte kopier eliminert på tvers av 6 skiver (1.3.56–1.3.61), hver bak én
testet kilde-til-sannhet. Surface-map oppdatert.

## 1.3.60 - 2026-06-22

refactor(frontend): konsolider renderWorkspaceNavigation — #596 skive 5 (EPIC #595)

Den største enkelt-dupliseringen fra arkitektur-gjennomgangen (#611): `renderWorkspaceNavigation` lå
i 14 filer. En delt `renderWorkspaceNavigationWithProfile` fantes allerede i
`public/static/workspace-nav.js`, men kun 6 filer brukte den. De resterende **7** (`participant.js`,
`participant-completed.js`, `profile.js`, `calibration.js`, `results.js`, `review.js`,
`admin-platform.js`) hadde egne fulle implementasjoner — nå erstattet av tynne wrappere som kaller
den delte funksjonen. Alle 13 sider deler nå én implementasjon.

No-op: de lokale versjonene satte inline `.locale-picker`-styling (display:flex/align/gap) som
allerede ligger i `shared.css` (redundant). `profile.js` utelot bevisst profil-lenken → migrert med
`localePicker: null` (samme oppførsel). Den delte funksjonen legger i tillegg til `aria-current` på
profil-lenken og rydder en foreldet lenke — rene a11y-forbedringer. Surface-map §9 oppdatert.

## 1.3.59 - 2026-06-22

refactor(frontend): single source of truth for date-time formatting — #596 skive 4 (EPIC #595)

Fjerde skive. `public/static/format-display.js` får `createDateTimeFormatter(getLocale, placeholder)`
(samme lazy-locale-factory som tall). De 7 `formatDateTime`/`formatDateTimeValue`-kopiene
(`participant.js`, `participant-completed.js`, `profile.js`, `calibration.js`, `review.js`,
`results.js`, `static/admin-content-calibration.js`) erstattes av
`const formatDateTime = createDateTimeFormatter(() => currentLocale)`.

No-op: alle 7 gjorde `Intl.DateTimeFormat(currentLocale,{dateStyle:"medium",timeStyle:"short"})` med
falsy-guard + `try/catch → String(value)`. Eneste forskjell var placeholderen (`"-"` for 5, em-dash
`"—"` for results/profile — bevart via param). Dato-varianter med annen form (`dateStyle`
long/medium-only, `toLocaleDateString` numerisk, og admin-content.js sin NaN-guard-variant) er
bevisst latt stå til senere skiver. Unit-test pinner factory + placeholder + catch-fallback.

## 1.3.58 - 2026-06-22

refactor(frontend): single source of truth for resolveInitialLocale — #596 skive 3 (EPIC #595)

Tredje skive i frontend-dedupliseringen. Ny ES-modul `public/static/i18n-locale.js` med
`resolveInitialLocale(supportedLocales)`. De **9** kopiene (`review.js`, `admin-content.js`,
`calibration.js`, `participant.js`, `participant-completed.js`, `profile.js`, `results.js`,
`certificate.js`, `admin-platform.js`) erstattes av importen + `resolveInitialLocale(supportedLocales)`
(supportedLocales sendes inn siden hver side importerer sin egen identiske liste).

No-op for de 8 atferdslike (lagret locale > browser-prefix nb/nn/en > en-GB; `certificate.js` sin
manglende `en`-gren ga samme output som default). `results.js` brukte en `find()`-match uten
null-guard — folding inn her fjerner en latent throw på null `navigator.language` (samme output for
enhver reell browser-streng). Unit-test pinner resolusjonen.

## 1.3.57 - 2026-06-22

refactor(frontend): single source of truth for formatNumber — #596 skive 2 (EPIC #595)

Andre skive i frontend-dedupliseringen. Ny ES-modul `public/static/format-display.js` med en
**factory** `createNumberFormatter(getLocale, placeholder = "-")`. De 7 nær-identiske `formatNumber`-
kopiene (`participant.js`, `participant-completed.js`, `profile.js`, `calibration.js`,
`admin-content.js`, `review.js`, `static/admin-content-calibration.js`) erstattes av
`const formatNumber = createNumberFormatter(() => currentLocale)` — kall-stedene er urørt.

Factory fordi `formatNumber` er koblet til hver fils egen muterbare `currentLocale`: getteren leses
**lazy** ved kall-tid, så locale-byttet fortsatt reflekteres. No-op: alle 7 gjorde
`Intl.NumberFormat(currentLocale,{min:0,max})` + ikke-tall-guard; eneste forskjell var placeholderen
(6 brukte `"-"`, `profile.js` brukte em-dash `"—"` — bevart via placeholder-param). Unit-test pinner
factory + lazy locale + placeholder.

(Locale-koblingen her motiverer en kommende `i18n-resolve`-skive — `currentLocale`/locale-fallback
er selv duplisert på tvers av filene.)

## 1.3.56 - 2026-06-22

refactor(frontend): single source of truth for HTML-escaping — #596 skive 1 (EPIC #595)

Første skive i frontend-dedupliseringen (jf. arkitekturgjennomgangen #598/#611): ny ES-modul
`public/static/html-escape.js` med én `escapeHtml`, importert av de **6 byte-identiske** kopiene
(`admin-content.js`, `participant.js` (escapeHtmlP), `participant-completed.js` (escapeHtmlC),
`results.js` (escapeHtmlR), `static/admin-content-courses.js`, `static/admin-content-library.js`).
Ren no-op: alle seks gjorde `String(x ?? "")` + samme 4-tegns escape, og kanonisk versjon matcher
eksakt (importert med alias så kall-stedene er urørt). Unit-test pinner oppførselen.

**Bevisst utenfor skiven (hver er en reell atferdsforskjell → egen oppfølging):**
`admin-content-preview.js`/`admin-content-shell.js`/`static/loading.js` bruker `String(x)` uten
`?? ""`-vakten (null→"null"), og `static/admin-content-sections.js` escaper også `'`. Disse 4
kopiene står igjen til senere skiver.

## 1.3.55 - 2026-06-22

fix(authoring): chunket komprimering så LLM-forespørsler holder seg under TPM-kvoten (#479)

Retry (v1.3.54) var nødvendig men ikke nok: en *enkelt* for stor forespørsel får aldri plass i
deployment-ets tokens-per-minutt-kvote (staging **20K**, prod **40K** TPM), så den 429-er for alltid
uansett retry. Frontend tillater opptil 1M tegn kildemateriale ≈ 250K tokens — komprimerings-kallet
sendte alt i **ett** kall (12× over kvoten) og kvalte seg selv før det fikk krympet noe; fallbacken
sendte da det fulle materialet videre → garantert 429 i vurderingsplan + utkast.

`condenseSourceMaterial` deler nå materiale > 30K tegn i biter (~7,5K tokens hver, trygt under TPM),
komprimerer hver bit sekvensielt (callLlm-retryen sprer dem over minutter så minuttbudsjettet
respekteres), og slår sammen — med ett ekstra pass hvis summen fortsatt er stor. Da lykkes
komprimeringen, og de nedstrøms kallene (vurderingsplan/utkast/MCQ) får et lite, krympet input.

`splitIntoChunks` (grense-bevisst splitter) eksportert + unit-testet; chunked condense dekket
ende-til-ende med mocket fetch. **Anbefaling:** hev TPM-kapasiteten (staging 20→ ?, prod 40→ ?) for
raskere authoring — chunking gjør store crawls *mulige*, men trege ved 20K TPM.

## 1.3.54 - 2026-06-22

fix(authoring): retry Azure OpenAI 429/5xx i innholds-genereringen (#479)

Utløst av Slice B (crawl): crawl kan produsere mye større kildemateriale, som fanner ut i flere
store LLM-kall (komprimer → vurderingsplan → utkast → MCQ) på sekunder og sprenger Azure OpenAI sin
tokens-per-minutt-kvote → `429 too_many_requests`. `callLlm` gjorde **ett** kall og kastet umiddelbart,
så en transient 429 stoppet hele pipelinen — og komprimerings-fallbacken sendte da det **fulle**
(for store) materialet nedstrøms, som garanterte flere 429.

`callLlm` retryer nå 429/500/502/503/504 med opptil 4 forsøk: ærer serverens `Retry-After`-header,
ellers eksponentiell backoff (1→2→4→8 s, cap 20 s) med jitter. Eksporterte `parseRetryAfterMs` +
`computeLlmBackoffMs` er unit-testet. Samme mangel i assessment-LLM-klienten spores i #603.

## 1.3.53 - 2026-06-22

feat(ingest): same-domain crawl av kildemateriale (#479 Slice B)

Ny «Crawl nettsted»-knapp på kilde-steget i Samtale. Gitt en start-URL følges lenker på **samme
vertsnavn**, inntil **20 sider** og **2 hopp**, og hovedteksten fra hver side slås sammen til
**én** kilde-chip merket med vertsnavn + antall sider.

- **Backend:** `crawlUrlAsSourceMaterial` i `urlFetchService.ts` — BFS med dedup, robots.txt-
  respekt (egen minimal parser, longest-match + Allow-vinner-ved-lik-lengde), 300 ms høflighets-
  pause, samlet 10 MB byte-budsjett. Hver side re-valideres mot private/interne IP-er (gjenbruker
  `assertSafeUrl` + den pinnede SSRF-dispatcheren fra #520). Egen, strengere rate-limit (3/min).
- **Route:** `POST /api/admin/content/source-material/crawl-url` → `{ startHostname, pages[],
  pagesCrawled, pagesSkipped, totalBytes, truncated }`; `422 crawl_empty` når ingenting kunne hentes.
- **Tester:** unit (robots-parser, longest-match, url-normalisering, crawl-orkestrering med mocket
  fetch + jsdom, rate-limit) + Playwright-e2e (kilde-steg → prompt → crawl → kombinert chip).
- **Docs:** `doc/SOURCE_MATERIAL_INGEST_GUIDE.md` (ny bruker-guide) + API_REFERENCE source-ingest-tabell.

## 1.3.52 - 2026-06-22

fix(ingest): parser-worker body-grense delt med hoved-app (#479 Slice A oppfølging)

Tredje «ufullstendig flate» i samme kjede: parser-workeren (`src/parserApp.ts`) er en **egen
tjeneste** med sin egen `express.json`-grense som sto hardkodet på 4 MB. En 5,6 MB PPTX (base64
~7,5 MB) ble derfor avvist med `413 Payload Too Large` fra parser-workeren, selv om klient + hoved-
app + fil-cap var hevet til 10 MB.

**Strukturell fiks (såer #596):** ny delt konstant `SOURCE_MATERIAL_UPLOAD_BODY_LIMIT_BYTES`,
**utledet** fra `SOURCE_MATERIAL_MAX_BYTES` (base64 4/3 + JSON-envelope-headroom), konsumert av
**både** hoved-appens extract-rute (`app.ts`) og parser-workeren (`parserApp.ts`). De tre tallene
kan ikke lenger drifte fra hverandre. En **synk-vakt-test** asserterer at grensen alltid rommer en
maks-fil sin base64.

## 1.3.51 - 2026-06-22

fix(ingest): klient-filgrense 2 → 10 MB (#479 Slice A oppfølging)

Slice A (v1.3.50) hevet server-grensen, express-body-grensen og UI-tekstene til 10 MB, men
**klient-vakten** `SOURCE_MATERIAL_MAX_BYTES` i `public/static/admin-content-shell.js` sto igjen
på 2 MB. Resultat: en 2,6 MB-fil ble avvist i nettleseren med meldingen «… opptil 10 MB» (riktig
tekst, feil grense) før opplasting i det hele tatt skjedde. Konstanten er nå 10 MB, med en
kommentar som binder den til server-konstanten. Regresjons-e2e laster opp en ~3 MB-fil og krever
at den aksepteres.

Klassisk «riktig fiks, ufullstendig flate» — fanget av e2e-laget.

## 1.3.50 - 2026-06-22

feat(ingest): kildemateriale-grense 2 → 10 MB (#479 Slice A) + skjul irrelevante skåre-rader (#591)

**#479 Slice A — større filer:** per-fil-grensen for kildemateriale-opplasting er hevet fra 2 MB
til 10 MB (`SOURCE_MATERIAL_MAX_BYTES`). Base64-kodet JSON-body blir ~13,3 MB, så `/api/admin/content/
source-material/extract` får en egen `express.json({ limit: "16mb" })` registrert før den globale
5 MB-parseren — alle andre endepunkter beholder 5 MB. UI-hint og feilmeldinger (`admin-content-
translations.js`, alle locales) oppdatert til «10 MB».

**#591 — skjul irrelevante skåre-komponenter:** resultatsammendraget viser ikke lenger MCQ-poeng for
FREETEXT_ONLY-moduler eller praktisk poeng for MCQ_ONLY-moduler (alltid 0 → forvirrende). Prinsipp:
ikke vis brukeren informasjon hen ikke trenger.

## 1.3.49 - 2026-06-21

fix(assessment): rubrikk-maks utledes fra kriterier, ikke (utdatert) scalingRule.max_total (#578)

**Bug (funnet ved FREETEXT_ONLY-aksept):** en auto-generert rubrikk hadde 4 kriterier (maks 4×4=16),
men `scalingRule.max_total = 24`. Vurderingen rekomputerer rubrikk-skåren ved å klampe hvert
kriterium til [0,4] og summere — så et perfekt svar (16/16 ifølge LLM) ble regnet som 16/24 = 66,7 %.
For **FREETEXT_ONLY** (ingen MCQ å kompensere med) ga det auto-stryk av et perfekt svar; for
**FREETEXT_PLUS_MCQ** ble praktisk-skåren undervurdert (maskert av MCQ-bidraget).

**Fix:** `buildAssessmentInputContext` utleder nå `rubricMaxTotal` fra **faktisk kriterie-antall × 4**
(samme basis som rekomputeringen og som LLM-en bruker), og faller bare tilbake til
`scalingRule.max_total` når rubrikken ikke har kriterier. Gjelder alle fritekst-modi og alle
eksisterende rubrikker (ingen migrasjon nødvendig — skåringen er korrekt ved neste vurdering).

- **Tester:** regresjonstest (4 kriterier + max_total 24 → maks 16) + fallback-test; oppdatert
  eksisterende. 50/50 relevante unit grønne, tsc rent.

## 1.3.48 - 2026-06-21

feat(content): FREETEXT_ONLY import/eksport + docs (#578 slice 4 — fullfører #578)

- **Eksport:** `buildModuleExportEnvelope` krever ikke lenger MCQ-sett for FREETEXT_ONLY; emitter
  `activeVersion.mcqSet = null`. **Import:** `moduleExportPayloadSchema.activeVersion.mcqSet` er
  nullable; `contentImportService` hopper over MCQ-opprettelse for FREETEXT_ONLY og setter
  `mcqSetVersionId = null`.
- **Tester:** ny export-import-roundtrip for FREETEXT_ONLY (bevarer modus + mcqSet null; kjøres i CI
  verify mot fersk Postgres). tsc rent.
- **Docs:** `MCQ_ONLY_MODULES_GUIDE.md` generalisert til modultyper (3 typer) med egen Free-text-only-
  seksjon; `API_REFERENCE.md` dokumenterer `FREETEXT_ONLY`.
- **#578 «Kun Fritekst» er nå komplett** (backend + samtale + deltaker + Avansert + import/eksport +
  docs). Klar for samlet deploy.

## 1.3.47 - 2026-06-21

feat(author): 3-veis modultype-velger i Avansert editor (#578 slice 2b)

Avansert editor støtter nå alle tre modultyper (tidligere bare MCQ-only-checkbox).
- MCQ-only-checkboxen erstattet av en **3-veis radio**: «Fritekst + flervalg» / «Kun fritekst» /
  «Kun flervalg».
- Synlighet styres per modus: MCQ_ONLY skjuler fritekst-felt + rubrikk/prompt/submission + viser
  terskel; FREETEXT_ONLY skjuler MCQ-kort/-seksjon (beholder fritekst + rubrikk/prompt); FREETEXT_PLUS_MCQ
  viser alt.
- **Last leser `assessmentMode`** og setter radioen, så re-lagring bevarer typen (fjerner
  korrupsjonsrisikoen der en FREETEXT_ONLY-modul ble lagret som FREETEXT_PLUS_MCQ).
- Lagring: FREETEXT_ONLY hopper over MCQ-sett, sender `assessmentMode=FREETEXT_ONLY` med rubrikk +
  prompt + oppgavetekst (ingen mcqSet).
- i18n `adminContent.moduleType.*` i en-GB/nb/nn. **Tester:** MCQ-only-e2e oppdatert til radio + ny
  FREETEXT_ONLY-avansert-e2e. 42/42 admin-content e2e grønne, tsc rent.

## 1.3.46 - 2026-06-21

feat(participant): FREETEXT_ONLY deltaker-flyt (#578 slice 3)

Deltaker kan nå fullføre en «Kun fritekst»-modul ende-til-ende.
- Deltaker-visningen viser fritekst-felt + bekreftelse + oppgave-brief, og **skjuler MCQ-seksjonen**
  for FREETEXT_ONLY.
- **Vurdering uten MCQ-gate:** `deriveParticipantFlowGateState` tar nå `{ requiresMcq }` —
  FREETEXT_ONLY låser opp vurdering så snart fritekst-innleveringen finnes. Etter innlevering startes
  ikke et MCQ-forsøk (serveren ville 400); vurderingen kjøres direkte (auto, eller via «Start
  vurdering»-knappen som nå er tilgjengelig).
- **Tester:** ny participant-e2e (fritekst vist, MCQ skjult, vurdering kjøres uten MCQ-start) +
  gate-unit-test for `requiresMcq:false`. tsc rent.
- Med slice 1+2a+3 er FREETEXT_ONLY brukbar ende-til-ende (backend + samtale-authoring + deltaker).
  Gjenstår: Avansert editor (3-veis), import/eksport, docs.

## 1.3.45 - 2026-06-21

feat(author): «Kun fritekst» i samtale-flyten (#578 slice 2a)

Tredje modultype-valg i samtalen (bygger på FREETEXT_ONLY-fundamentet i 1.3.44).
- **Ny-modul + regen:** modultype-boblen får et tredje valg **«Kun fritekst»** (i tillegg til
  «Fritekst + flervalg» og «Kun flervalg»). Velges det, kjører scenario + vurderingsplan + fritekst-
  generering som normalt, men **MCQ-genereringen hoppes over**, og lagring sender
  `assessmentMode=FREETEXT_ONLY` med rubrikk + prompt + oppgavetekst, **uten mcqSet**.
- `freetextOnly` trådes gjennom scenario→cert→blueprint→confirmAndGenerate; `saveDraftBundleInBackground`
  hopper over MCQ-kravet og mcqSet-opprettelse for FREETEXT_ONLY.
- i18n `shell.moduleType.freetextOnly` (+ utvidet hint) i en-GB/nb/nn.
- **Tester:** to nye e2e (ny-modul + regen → «Kun fritekst» → ingen MCQ-steg, lagrer FREETEXT_ONLY
  uten mcqSet). 40/40 admin-content e2e grønne, tsc rent.
- Gjenstår i #578: forfatter-UI i Avansert editor (3-veis), deltaker-UI (fritekst u/MCQ), import/eksport, docs.

## 1.3.44 - 2026-06-21

feat(module): FREETEXT_ONLY — datamodell + vurderings-pipeline (#578 slice 1)

Fundamentet for «Kun Fritekst»-modultype (fritekst + LLM-vurdering, ingen MCQ). Kun backend —
forfatter-/deltaker-UI kommer i senere skiver.
- **Datamodell:** `AssessmentMode` += `FREETEXT_ONLY`; `ModuleVersion.mcqSetVersionId` (+ relasjon)
  gjort nullable (migrasjon `20260621120000_freetext_only_modules`, expand-contract).
- **Validering:** `moduleVersionBodySchema` — `mcqSetVersionId` valgfri + refine per modus
  (FREETEXT_ONLY krever taskText+rubrikk+prompt, ingen mcqSet; FREETEXT_PLUS_MCQ krever begge).
- **Pipeline:** `runAssessment` slipper MCQ-kravet for FREETEXT_ONLY og kjører LLM-stien;
  `resolveAssessmentDecision` får `freetextOnly`-flagg → rubrikk skaleres til 0–100, ingen
  MCQ-gate, rødflagg/manuell-vurdering beholdt. `createModuleVersion` validerer mcqSet kun for
  modi som har det.
- **Tester:** enhetstester for FREETEXT_ONLY-skåring (0–100, ingen MCQ-gate, manuell-vurdering
  bevart) + schema-validering. tsc rent. (Ende-til-ende-integrasjon + UI i senere skiver.)

## 1.3.43 - 2026-06-21

chore(process): `setHidden`-helper + «kartlegg full UI-flate»-stående ordre (retro)

Etter retrospektiv på 6 bugger/5 deploys (1.3.37→1.3.42), de fleste «riktig fiks, ufullstendig flate»:
- **Ny `public/static/dom-visibility.js` med `setHidden(el, hidden)`** — bruker `style.display`, robust
  mot den tilbakevendende `.hidden`/display-klasse-cascade-fellen. `participant.js` bruker den nå for
  oppgave-brief (adferds-identisk; e2e uendret grønn).
- **Ny stående ordre i CLAUDE.md + AGENTS.md:** «Map the full UI surface before building/fixing» —
  enumerér alle innganger/flater (grep label på tvers), e2e følger anbefalt brukerreise ikke kode-sti,
  grep søsken-sekvenser ved «flytt et steg», og bruk `setHidden` for betinget synlighet.
- Ingen brukerendring (refaktor + docs).

## 1.3.42 - 2026-06-21

fix(participant): MCQ-only resultat-visning — skjul tom oppgave-brief + diskret retry (#525-oppfølging)

To funn ved forfatter-test av MCQ-only-modul:
- **Tom OPPGAVE/VEILEDNING vist:** `selectedModuleBrief` (`.module-brief{display:grid}`) ble skjult
  via `.hidden`-klassen, men grid-regelen (definert senere i cascaden, ingen `!important`) overstyrte
  → en tom oppgave-brief vistes for MCQ-only (som ikke har `taskText`). Skjules nå via
  `style.display` (samme klasse-overstyrings-felle som tidligere). Gjelder også VEILEDNING-seksjonen.
- **Retry-knapp «helt borte»:** i MCQ-only-stien ble `flowState.resultStatus` satt til `null` og
  aldri synket etter at resultatet ble hentet → `hasResultStatus` forble false → «Slett innlevering
  og start på nytt» ble alltid skjult (også ved **stryk**). Nå synkes status + gating re-rendres, så
  knappen finnes igjen. Ved **bestått** nedtones den til en diskret sekundær-handling
  (`.reset-flow-discreet`) i stedet for prominent rød knapp.
- **Test:** utvidet `participant-mcq-only.spec.ts` (brief skjult for MCQ-only / synlig for fritekst;
  MCQ-only auto-bestått → diskret retry-knapp). 6/6 participant-e2e grønne.

## 1.3.41 - 2026-06-21

feat(author): modultype-valg i regenerer-flyten (#579)

- **Bugfiks/feature (forfatter-feedback):** Den anbefalte opprett-veien (biblioteks-dialogen, #348)
  oppretter modulen og lander i samtalens **«Generer nytt innhold»**-flyt — som *ikke* hadde
  modultype-steget fra #555. Forfatter så derfor aldri modultype i praksis. Regen-flyten spør nå
  modultype etter kilde, før scenario — samme som ny-modul-flyten.
- **Typebytte:** «Fritekst + flervalg» → uendret regen (scenario → vurderingsplan → MCQ).
  «Kun flervalg» → MCQ-only-generering, lagres som ny `MCQ_ONLY`-versjon (ingen scenario/rubrikk/
  prompt). Cert-nivå gjenbrukes fra modulen.
- «Kun Fritekst» kommer når #578 lander (tredje valg).
- **Test:** to nye e2e (regen: kilde → modultype → scenario; regen → «Kun flervalg» → MCQ-count
  uten scenario). 37/37 admin-content e2e grønne.

## 1.3.40 - 2026-06-21

fix(participant): «Vis bevis»-lenke i Profil → Fullførte kurs (#550-oppfølging)

- **Bugfiks (bruker-feedback):** Profil-sidens «Fullførte kurs»-tabell viste Bevis-ID som ren tekst
  uten lenke. Bevis-ID-kolonnen lenker nå til `/certificate?id=<id>` (åpnes i ny fane), på linje med
  bevis-banneret og «Mine kursbevis». i18n `profile.courses.view` i en-GB/nb/nn.
- **Test:** ny Playwright-e2e (profil-tabell → bevis-lenke med riktig href + i18n-label).

## 1.3.39 - 2026-06-21

fix(author): «Neste» deaktiveres mens kildemateriale hentes (#555-oppfølging)

- **Bugfiks (forfatter-feedback):** ved URL-henting (og fil-opplasting) var det meste av UI passivt,
  men **«Neste»-knappen var fortsatt klikkbar** — uklart hva som skjedde ved klikk midt i hentingen.
  «Neste» deaktiveres nå mens kilde hentes/ekstraheres og re-aktiveres når det er ferdig (begge
  stier: URL-fetch + fil-opplasting).

## 1.3.38 - 2026-06-21

feat(participant): utskrivbart kursbevis ved kursfullføring (#550)

- **Nytt bevis-view:** `/certificate?id=<bevis-ID>` viser et rent, utskrivbart kursbevis (kursnavn,
  deltakernavn, fullføringsdato, sertifiseringsnivå, antall moduler, bevis-ID) med «Skriv ut / lagre
  som PDF» (`window.print()` + print-CSS — dependency-fritt).
- **Backend:** `GET /api/courses/completions/:certificateId` (eier-scopet — 404 for andres bevis).
  Ny repo-metode `findCourseCompletionByCertificateId`.
- **Lenker:** «Vis bevis» fra bevis-banneret i kursvisningen (`participant.js`) og «Vis / skriv ut
  bevis» fra «Mine kursbevis» (`participant-completed.js`).
- Feiringen (konfetti + completion-toast + bevis-banner) fra #549/#550 var allerede på plass; denne
  skiva legger til selve det visbare/utskrivbare beviset.
- **Test:** 3 nye Playwright-e2e (render, ikke-funnet, manglende id) + backend-integrasjonstest
  (eier 200 + annen bruker 404). i18n i en-GB/nb/nn. Bruker-doc: `COURSE_CERTIFICATES_GUIDE.md`.

## 1.3.37 - 2026-06-21

fix(author): regenerer-flyt følger også kilde-først-rekkefølgen (#555)

- **Bugfiks (forfatter-feedback):** «Generer nytt innhold fra kildemateriale» på en *eksisterende*
  modul spurte fortsatt om scenario **før** kildemateriale — den gamle rekkefølgen #555 skulle
  fjerne. Regen-flyten følger nå samme enhetlige rekkefølge som ny-modul-flyten: **kilde →
  scenario → (cert) → vurderingsplan**.
- `askForScenarioMode` (scenario-først) erstattet av `askForScenarioModeRegen` (scenario etter
  kilde); `startGenerateDraftFlow` starter nå på kilde-steget.
- Ekstern-LLM-handoff skjer på kilde-steget, så scenario er ennå ukjent der → defaulter til «auto»
  (ekstern LLM avgjør). Dokumentert i koden.
- **Test:** ny e2e «shell regen flow asks for source material before scenario». 32/32 admin-content
  e2e grønne.

## 1.3.36 - 2026-06-21

feat(author): samordnet samtale-rekkefølge + MCQ-only via samtale (#555)

- **#555 enhetlig forfatter-rekkefølge:** samtale-shellen (`admin-content-shell.js`) følger nå
  samme IA som Avansert-editoren (#554): **Kilde → Modultype → Innhold → Publiser**. Kildemateriale
  er nå første spørsmål etter tittel; deretter velger forfatteren modultype.
- **Modultype-steg:** nytt valg «Fritekst + flervalg» vs «Kun flervalg» rett etter kilde.
  Fritekst-grenen fortsetter inn i den uendrede scenario → cert → vurderingsplan-flyten; scenario-
  spørsmålet er flyttet til *etter* kilde (var før kilde).
- **MCQ-only via samtale:** «Kun flervalg» oppretter en `MCQ_ONLY`-modul, hopper over
  scenario/vurderingsplan/rubrikk/prompt og går rett til MCQ-generering. Lagring sender
  `assessmentMode=MCQ_ONLY` + `assessmentPolicy.passRules.mcqMinPercent` (standard 70 %, kan
  overstyres i Avansert) — ingen taskText/rubrikk/prompt.
- **Tester:** to nye/oppdaterte samtale-e2e (ny rekkefølge for fritekst, samt ny MCQ-only-samtale
  som verifiserer `MCQ_ONLY`-payload). i18n-nøkler lagt til i alle tre locales (en-GB, nb, nn).
- Regen-flyten på eksisterende moduler er uendret (beholder scenario-først-rekkefølgen).

## 1.3.35 - 2026-06-21

feat+fix(author): MCQ length-cue-deteksjon (#551) + kurs-pakke-guard i modul-import

- **#551 MCQ-lengde-cue:** ny deterministisk `detectCorrectAnswerLengthBias` flagger sett der
  fasiten er lengst i ≥70 % av spørsmålene. Koblet inn i `generateMcqQuestions` (legges i
  `validationWarnings`), generate-MCQ-ruten returnerer det i `validation.issues`, og samtale-shellen
  viser nå MCQ-kvalitets-advarsler i «MCQ klar»-boblen (tidligere ble validation-issues ikke vist).
  Prompten hadde allerede en grundig «Option parity»-regel — den deterministiske sjekken fanger når
  LLM-en likevel bryter den.
- **Import-guard:** å importere en **kurs**-pakke via «Importer modul-pakke» ga rå
  `scope_mismatch`-400. Modul-importen sjekker nå `scope` klient-side og gir en handlingsbar
  melding («Dette er en kurs-pakke. Importer den fra Kurs-siden …»).

Test: 5 nye unit-tester (lengde-bias-heuristikk), eksisterende llm-gen (44) uendret, 30 e2e, tsc rent.

## 1.3.34 - 2026-06-21

fix(content): eksport utelater rationale:null → MCQ-spørsmål uten rationale kan re-importeres (#557)

Et MCQ-spørsmål uten `rationale` ble eksportert som `rationale: null`, men import-schemaet godtok
`string|object|undefined` (ikke null) → `validation_error` ved re-import. Eksporten utelater nå
`rationale`-nøkkelen når den mangler (i stedet for null), så import (optional) godtar fraværet.
(Valgte eksport-fiks framfor å nullbar-gjøre det delte `mcqQuestionSchema`, som ville kaskadert til
MCQ-revisjons-endepunktet.)

Test: export/import-roundtrip-testen bruker nå et spørsmål **uten** rationale (regresjonsvakt).
6 roundtrip-tester grønne, tsc rent.

## 1.3.33 - 2026-06-21

fix(author+participant): MCQ-only kort-gating + kurs-cache (staging-tilbakemelding runde 4)

- **#554 kort-gating:** «Vurderingskriterier»/«LLM-prompt»/«Innleveringsskjema»-kortene + rubric/
  prompt-seksjonene vistes fortsatt ved Kun MCQ — `.content-card`/`.card`-CSS overstyrer
  `[hidden]`-attributtet. Bruker nå `style.display` (samme gotcha som `.row`/`.inline` tidligere),
  + re-applyer gatingen etter innholds-refresh. e2e utvidet til å sjekke at kort faktisk skjules.
- **Kurs-cache (D):** etter bestått modul re-lastet kurs-lista accordion med ferske «Laster…»-
  containere, men `courseDetailCache` beholdt gammel oppføring → expand hoppet over ny-henting →
  placeholder hang. `loadParticipantCourses` tømmer nå cachen.

Logget: #563 (konsistens — kurs publiseres ikke vs modul krever publisering).

Test: 30 e2e (utvidet MCQ-only-author + section-reader), 49 kontrakt/i18n, tsc rent.

## 1.3.32 - 2026-06-21

sec(ingest): lukk DNS-rebinding/TOCTOU i URL-henting (#520)

`assertSafeUrl` validerte hostnavnets IP-er på forhånd, men `fetch` gjorde sitt eget DNS-oppslag —
en angriper med kort-TTL-record kunne returnere public IP ved sjekken og privat IP ved selve
tilkoblingen (DNS-rebinding) → SSRF-bypass.

- Ny `createValidatingLookup` brukes som `connect.lookup` i en undici `Agent` (dispatcher). Det er
  oppslaget fetch faktisk kobler til med, og det re-validerer hver resolved IP (avviser private/
  metadata/loopback) ved tilkoblingstidspunktet → rebinding-vinduet lukket.
- Global `fetch` beholdes (test-mockbar) med `dispatcher`-opsjon; `assertSafeUrl` (forhånds-sjekk)
  beholdt som første lag (defense-in-depth).
- `undici` lagt eksplisitt i `dependencies` (var transitiv).

Test: 8 nye unit-tester (rebinding/metadata/IPv6/mixed/fail-closed). Eksisterende url-fetch-tester
uendret (16 grønne totalt). tsc rent.

## 1.3.31 - 2026-06-21

feat(author): avansert-editor IA — fjern nummerering + modultype på topp (#554, del 1)

Første del av den omforente forfatter-IA-en (avansert-editoren):
- **Fjernet «N)»-nummereringen** fra alle seksjonstitler (import/modul/åpne/status/rubric/prompt/
  MCQ/modulversjon/publiser + JSON-fallback) på tvers av en/nb/nn. Nummereringen var hullete
  (betinget skjulte seksjoner) og fantes ikke andre steder i UI-et.
- **«Modultype» som egen topp-seksjon** (etter status, før innhold): MCQ-only-vekslingen + terskel
  flyttet ut av «Modulversjon»-seksjonen hit. Modultype gater nå innholdet.
- **MCQ-only skjuler fritekst-innhold:** rubric- og prompt-seksjonene (rå JSON) + rubric/prompt/
  innleveringsskjema-kortene i Innholdsoversikt skjules når Kun MCQ er valgt.

Test: 30 e2e grønne (inkl. MCQ-only-author-e2e), 63 admin-content kontrakt-/i18n-tester, tsc rent.

Gjenstår av omleggingen: #555 (samtale-shell skal følge samme rekkefølge — egen runde, krever
arbeid i tilstandsmaskinen `admin-content-shell.js`).

## 1.3.30 - 2026-06-21

fix(participant): MCQ-only 409 ved innlevering + fullførings-flyt (staging-tilbakemelding runde 3)

- **#2 (409 «already completed and passed»):** rotårsak — #8 sync-sensur fullfører MCQ-only-
  innleveringen ved mcq/submit, men UI kjørte likevel auto-assessment (`/assessments/:id/run`) →
  409 mot recert-vernet. `mcq/submit` returnerer nå `assessmentComplete`; UI hopper over auto-run
  og henter resultatet direkte. Auto-start (#7) fyrer heller ikke for en allerede bestått modul.
- **#3 seksjonsleser lukkes ikke:** «Marker som lest» lukker nå leseren (forventet) + re-laster
  kurs-oversikten.
- **#3 modul-status + kurs-konfetti:** kurs-lista re-lastes nå etter bestått modul og etter
  seksjons-lesing, så status oppdateres i kursoversikten og #550-konfettien fyrer ved fullført kurs.

Test: 30 e2e grønne (oppdatert section-reader-e2e: mark-read lukker leseren), mcq-service unit +
i18n/contract grønne, tsc rent.

Note: helhetlig forfatter-IA (#554/#555) — omforent design (felles rekkefølge Samtale+Avansert,
uten nummerering, modultype på topp) er festet på issuene; implementeres som egen runde.

## 1.3.29 - 2026-06-21

fix+feat(participant): MCQ-only-bugfikser + feiring ved bestått/fullført (#549, #550, +#1/#2-fiks)

Andre runde med staging-tilbakemelding på MCQ-only:
- **#1-fiks (auto-start):** «MCQ vises direkte» fungerte ikke via kurs-stien — auto-start-hooken lå
  bare i modul-kort-klikket, ikke i `openCourseModule`. Flyttet inn i `activateParticipantModule`
  så begge stier (kort + kurs) auto-oppretter besvarelse + starter MCQ.
- **#2-fiks (layout):** seksjon 8 var visuelt entangled — MCQ-only-vekslingen + terskel grupperes
  nå i et avgrenset «modultype»-delpanel, adskilt fra fritekst-feltene. (Full omlegging kommer i
  #554 der modultype velges ved opprettelse.)
- **#549 feiring bestått modul:** konfetti (lettvekts, dependency-fri, respekterer reduced-motion)
  + «🎉 Gratulerer — du bestod!»-banner på resultatet (én gang per innlevering).
- **#550 feiring fullført kurs:** konfetti + toast når et kurs blir fullført i økten (ikke for
  allerede-fullførte kurs ved innlasting). E-post ved kurs-fullføring gjenstår (backend/ACS) —
  sporet i #550; modul-bestått sender allerede resultat-e-post.

Test: 30 e2e grønne (inkl. oppdatert MCQ-only-author-e2e), i18n-nøkkel-vakt dekker de nye nøklene,
55 kontrakt-tester. tsc rent. (Feirings-banneret er dekorativt + i18n-vakt-dekket; visuell
verifisering på staging.)

## 1.3.28 - 2026-06-21

feat(content): MCQ-only import/eksport + bruker-doc (#547, #525)

Siste #525-skive. Modul-pakker støtter nå MCQ-only-moduler ende-til-ende:
- **Eksport** (`buildModuleExportEnvelope`): kaster ikke lenger på manglende rubric/prompt for
  MCQ-only; emitter `assessmentMode` + null rubric/prompt/taskText. Bundle-select + transform
  bærer `assessmentMode`.
- **Import** (`contentImportService`): MCQ-only-gren — hopper over rubric/prompt-opprettelse,
  valgfri taskText, setter `assessmentMode`.
- **Schema:** `moduleExportPayloadSchema.activeVersion` får `assessmentMode` + gjør
  `taskText`/`rubric`/`promptTemplate` valgfrie/nullbare.
- **Bonusfiks:** `assessmentPolicy.passRules.totalMin` gjort valgfri — MCQ-only-policy setter kun
  `mcqMinPercent`, og decisionService defaulter `totalMin`. (Dette var også en latent #546-bug:
  forfatter-lagring av MCQ-only sendte policy uten totalMin → ville blitt avvist.)
- **Bruker-doc:** `doc/MCQ_ONLY_MODULES_GUIDE.md` (forfatter-guide: opprett, deltaker-opplevelse,
  sertifisering, import/eksport).

Test: ny integrasjons-roundtrip-test (MCQ-only eksport→import bevarer assessmentMode, ingen
rubric/prompt). tsc rent. Logget separat: #557 (rationale:null eksport/import-bug, pre-eksisterende).

## 1.3.27 - 2026-06-21

fix(mcq-only): UX-batch fra staging-akseptanse + deterministisk MCQ-sensur (#525-oppfølging)

Tilbakemeldinger fra forfatter-/deltaker-test av MCQ-only på staging:
- **#4 Avrunding:** MCQ-resultat viser nå skår med 2 desimaler (66.67 % i stedet for 66.666…).
- **#5 Toppmeny-rekkefølge:** content-area-nav er nå **Kurs, Moduler, Seksjoner, Kalibrering**
  (4 admin-content-sider).
- **#3 Layout:** «Kun MCQ-modul»-avkrysningen arvet full-bredde tekst-input-styling →
  checkbox-reset i avansert editor.
- **#7 MCQ direkte:** å velge en MCQ-only-modul oppretter nå besvarelsen + starter MCQ automatisk
  (ingen «Opprett besvarelse»-klikk) — MCQ vises direkte.
- **#8 Deterministisk sensur:** MCQ-only-innlevering behandles nå **synkront** i submit
  (`processSubmissionJobNow`) — ingen LLM (var allerede skippet) og ingen async-jobb/poll-venting
  → umiddelbart resultat, lavere kost.

Design-saker logget for avklaring (ikke i denne): #554 (MCQ-only som førsteklasses opprettelses-
valg), #555 (samtale-rekkefølge scenario/kilde).

Test: oppdatert Playwright-e2e (auto-start ved MCQ-only-valg). tsc rent, 30 e2e + full vitest-suite
grønn.

## 1.3.26 - 2026-06-21

feat(author): MCQ-only forfatter-UI i avansert editor (#546, #525)

Tredje #525-skive (forfatter-UI). I avansert modul-editor (steg 8):
- Ny «Kun MCQ-modul»-veksling. Når aktivert: fritekst-feltene (oppgavetekst, vurderingsregler,
  vurderingsinstruks) skjules, og en MCQ-terskel-input (default 70 %) vises.
- Lagring sender `assessmentMode=MCQ_ONLY` med kun `mcqSetVersionId` +
  `assessmentPolicy.passRules.mcqMinPercent`; ingen rubric/prompt/taskText.
- «Save bundle» (steg 5-8) hopper over rubric- + prompt-generering for MCQ-only.
- Skjuling via `style.display` (klasse-CSS `.row`/`.inline` overstyrer `[hidden]`). Nye i18n-
  nøkler (en/nb/nn): `adminContent.moduleVersion.mcqOnly`, `adminContent.help.mcqOnly`,
  `adminContent.moduleVersion.mcqMinPercent`.

Test: ny Playwright-e2e (toggle skjuler fritekst + viser terskel; lagring sender MCQ_ONLY +
mcqMinPercent=80). tsc rent, 29 e2e grønne, admin-content kontrakt-/i18n-tester grønne.

Gjenstår: import/eksport + bruker-doc (#547).

## 1.3.25 - 2026-06-21

feat(participant): MCQ-only deltaker-flyt — hopp over fritekst-steg (#545, #525)

Andre #525-skive (deltaker-UI). For moduler med assessmentMode=MCQ_ONLY:
- Modul-lesemodellen eksponerer nå `assessmentMode` til deltakeren (moduleRepository-select +
  de tre byggerne i moduleService).
- Deltaker-konsollet skjuler fritekst-feltene + ansvars-bekreftelsen og viser en kort note;
  «Opprett besvarelse» sender en tom besvarelse (ack implisitt) → rett til MCQ → resultat.
- Fritekst-moduler (FREETEXT_PLUS_MCQ) er uendret.

Detalj: ack-`<input>` har `.inline`-klasse hvis CSS overstyrer `[hidden]`, så labelen skjules via
`style.display` (avdekket av e2e-en). Ny i18n-nøkkel `submission.mcqOnlyNote` (en/nb/nn).

Test: ny Playwright-e2e (MCQ-only skjuler fritekst+ack; fritekst-modul beholder dem). tsc rent,
29 e2e grønne, i18n-nøkkel-vakt grønn.

Gjenstår: forfatter-UI (#546), import/eksport + bruker-doc (#547).

## 1.3.24 - 2026-06-20

feat(module): MCQ-only moduler — backend-fundament + sertifiserings-invariant (#525, #476)

Backend-skive (CI-verifisert, ingen UI ennå). assessmentMode-diskriminator gjør at en modul kan
være ren MCQ uten fritekst/LLM-vurdering:

- **Datamodell:** `AssessmentMode { FREETEXT_PLUS_MCQ | MCQ_ONLY }` på `ModuleVersion`
  (default FREETEXT_PLUS_MCQ → bakoverkompatibelt). `taskText`/`rubricVersionId`/
  `promptTemplateVersionId` nullbare (på ModuleVersion + AssessmentDecision). 2 expand-migrasjoner.
- **Vurdering:** `MCQ_ONLY` hopper helt over LLM-pipelinen; bestått = MCQ-score ≥ terskel
  (`assessmentPolicy.passRules.mcqMinPercent`, default **70%**, forfatter-justerbar). Egen
  `resolveMcqOnlyDecision`/`createMcqOnlyDecision` + gate i `assessmentJobService`.
- **Authoring-API:** `POST .../module-versions` tar `assessmentMode`; validering gjør fritekst-
  feltene valgfrie for MCQ_ONLY (mcqSet alltid påkrevd).
- **Sertifiserings-invariant (#476/#525):** kurs-fullføring/sertifikat utstedes kun når
  **alle moduler er bestått OG alle læringsseksjoner er lest**. Tidligere ble seksjons-lesing
  ignorert ved sertifiserings-utstedelse — nå gates det, og sjekken trigges både ved modul-
  bestått og ved at en seksjon merkes lest.

Tester: 8 nye enhetstester (MCQ-only-beslutning + validering). tsc rent, 531 unit + 28 e2e grønne,
eksisterende kurs-fullføring/deltaker-integrasjonstester uendret.

Gjenstår (egne skiver med e2e): deltaker-UI (hopp over fritekst-steg), forfatter-UI (MCQ-only-
veksling), import/eksport av assessmentMode, bruker-dokumentasjon.

## 1.3.23 - 2026-06-20

fix(participant): herd dev-konsoll-race + e2e for deltaker-seksjonsleser (#541)

- **#541:** «Last kurs» var klikkbar før `loadParticipantConsoleConfig()` hadde fylt
  identitets-skjemaet → tidlig klikk sendte tom `x-user-id` → fallback til rolleløs
  `dev-user-1` → forvirrende 403. Knappen deaktiveres nå til config er lastet, og aktiveres
  når identiteten er satt.
- **Test:** ny Playwright-e2e for hele deltaker-flyten (last kurs → utvid kurs → åpne seksjon →
  bilde-hydrering til `blob:`-URL → «Marker som lest» POST). Dekker flyten som tidligere bare
  var manuelt testet.

Kun front-end + test. `tsc` rent, 28 e2e grønne.

## 1.3.22 - 2026-06-20

fix(course): rett opp LMS-flyt avdekket ved lokal mock-testing (#540, #542) + UX/dev-tooling

Første økt med lokal full-stack-kjøring (portable Postgres + `AUTH_MODE=mock`) avdekket to ekte
feil som var usynlige på staging fordi Entra-Bearer-token skjulte dem:

- **#542 (ekte produktfeil):** `participant.js` sendte header-*objektet* (`headers()`) til
  `apiFetch`, som forventer en *funksjon*. Objektet ble tolket som `options` og alle `x-user-*`-
  headere droppet. På Entra bærer Bearer-token identiteten, så det virket; i mock-modus forsvant
  identiteten → fallback til rolleløs `dev-user-1` → 403 på `/api/courses`, `/api/modules`,
  seksjons-lesing. Fikset alle 6 kall-steder (`headers()` → `headers`).
- **#540:** seksjons-/kurs-/bibliotek-konsollene manglet `initConsentGuard` → viste rå
  `403 consent_required` i innholdsområdet i stedet for samtykke-dialogen. Lagt til på alle tre.
- **UX:** bilde-opplasting krevde manuell lagring først. Ulagret seksjon auto-lagres nå stille
  før opplasting (`persistSection({ silent })`).
- **Dev-tooling:** `localizeSectionContent` returnerer nå deterministisk stub-output i
  `LLM_MODE=stub` (lokal/CI) i stedet for å kaste, så oversett-*flyten* kan testes uten LLM.
  Nytt `npm run dev:seed:consent` forhåndsgodkjenner samtykke for alle mock-identiteter på fersk DB.

Tester (skrevet med fiksene, kjørt lokalt): Playwright-e2e for samtykke-dialog (#540) og at
deltaker-flyten sender `x-user-*` i mock-modus (#542). Static-test-serveren serverer nå
`/participant`. `tsc` rent, alle 27 e2e grønne. (Dev-konsoll-race #541 logget separat, lav prio.)

## 1.3.21 - 2026-06-19

fix(course): begrens bilde-størrelse i deltaker-leser + sticky seksjons-nav (#483 follow-up)

To funn fra staging-test:
- **Bilde-størrelse:** deltaker-leseren manglet `max-width` på bilder → de viste i full
  px-oppløsning og sprengte visningen. La til `#sectionReaderBody img { max-width:100%; height:auto }`
  (editor-preview hadde det allerede).
- **Toppmeny under redigering:** content-area-nav (Moduler/Kurs/Seksjoner) scrollet av toppen i
  den lange editor-visningen. Gjort `position: sticky; top: 0` på seksjons-siden så den blir værende.

Kun front-end (HTML/JS). `node --check` rent.

## 1.3.20 - 2026-06-19

fix(course): asset-bilder rendres nå i preview + deltaker-visning (#483)

Etter at opplastings-500-en (1.3.19) var løst, ble bildet satt inn men vist brutt: resolver-en
lager `<img src="/api/content-assets/<id>">`, men et plain `<img>` kan ikke bære Bearer/console-
auth-headerne — serve-endepunktet svarte 401 → brutt bilde. (CSP-en manglet også `blob:`.)

- Ny `hydrateContentAssetImages(root, getHeaders)` i `api-client.js`: henter hvert
  `/api/content-assets/`-bilde via autentisert `fetch` og bytter til en lokal `blob:`-URL.
  Kalles etter render i seksjons-editorens preview + deltaker-leseren.
- CSP `img-src` utvidet med `blob:` (lokalt generert av vår egen JS; ingen ekstern last-vektor).

Klient + én CSP-direktiv. Regresjonsvakt i `security-headers.test.ts` (img-src blob:). `tsc` +
`node --check` rene. App-only deploy.

## 1.3.19 - 2026-06-19

fix(course): bilde-opplasting 500 — apiFetch sendte FormData med JSON Content-Type (#483)

Bilde-opplasting feilet med 500 fordi `buildConsoleHeaders` setter `Content-Type:
application/json`, og `apiFetch` slo den inn i FormData-opplastingen. Nettleseren satte da ikke
multipart-boundary, og server-ens `express.json()` prøvde å parse multipart-kroppen som JSON →
`SyntaxError: Unexpected token '-', "------WebK"...` → 500 (før requesten nådde multer/blob).

Fiks: `apiFetch` stripper nå `Content-Type` når `body` er `FormData`, så nettleseren setter
`multipart/form-data` med boundary selv. Klient-only.

CI fanget det ikke fordi integrasjonstesten bruker supertest `.attach` (korrekt multipart) i
stedet for `apiFetch` — nettopp UI-opplastings-gapet sporet i #524.

## 1.3.18 - 2026-06-17

feat(course): bilde-opplasting i seksjons-editor — U2 fase 3 (#489)

UI for asset-opplasting (bygger på F4 backend, #483). I seksjons-editoren:
- «Last opp bilde»-knapp over markdown-feltet + skjult fil-input (PNG/JPEG/GIF/WebP).
- Krever at seksjonen er lagret først (assets knyttes til seksjons-id) — ellers melding.
- Spør om **alt-tekst** (obligatorisk, a11y), laster opp via `POST /sections/:id/assets`,
  og setter inn `![alt](asset:<id>)` på cursor-posisjon i markdown. Live-preview viser bildet
  (resolver → `/api/content-assets/<id>`).

Kun front-end (`admin-content-sections.js` + i18n). `node --check` rent. Manuell test på staging
fullfører forfatter→deltaker-bildeflyten før prod.

## 1.3.17 - 2026-06-17

feat(course): asset-opplasting backend — F4 fase 2 (#483)

Backend for bilde-/asset-opplasting til læringsseksjoner. Bygger på fase 1-infra (#483, 1.3.16).

- Ny `SectionAsset`-modell (sectionId, filename, mimeType, blobPath, sizeBytes) + migrering.
- `assetStorage.ts`: blob-backend via web-app-MSI (`DefaultAzureCredential`, ingen nøkkel) når
  `COURSE_ASSETS_BLOB_ENDPOINT` er satt; ellers **filsystem-fallback** for lokal/CI.
- `POST /api/admin/content/sections/:id/assets` (multipart via multer; mime-allowlist **uten SVG**
  pga XSS; 5 MB cap; feil → 400) + `GET .../assets` (liste).
- Privat servering: `GET /api/content-assets/:id` (ny `content_assets`-kapabilitet — alle
  autentiserte innholds-lesere) streamer blob via appen; aldri public blob-tilgang.
- Resolver: `![alt](asset:<id>)` i markdown → `<img src="/api/content-assets/<id>">` ved render
  (før sanitisering; portabelt for export/import-remapping).

`@azure/storage-blob` + `@azure/identity` + `multer` i `dependencies`. Integrasjonstest
(opplasting→liste→servering + mime-avvisning + 404) + resolver-unit-tester. `tsc` rent.
Deployes app-only etter at fase 1-infra er oppe på staging. U2-UI = fase 3.

## 1.3.16 - 2026-06-17

feat(infra): course-asset blob storage — F4 fase 1 (#483)

Infra-fundament for bilde-/asset-opplasting til læringsseksjoner. **Kun infra — ingen app-kode
bruker det ennå** (fase 2 kommer separat, app-only).

- Ny `Microsoft.Storage/storageAccounts` (`a2<env>assets<suffix>`, Standard_LRS, StorageV2) +
  privat blob-container `course-assets`.
- **MSI-only:** `allowSharedKeyAccess=false` + `allowBlobPublicAccess=false` → ingen kontonøkkel
  eller SAS finnes; web-appens system-assigned MSI får **Storage Blob Data Contributor**
  (deterministisk-GUID role assignment, betinget på `!skipRoleAssignments`). Ingenting å rotere,
  i tråd med KV-RBAC-invariantene.
- App-settings `COURSE_ASSETS_BLOB_ENDPOINT` (endpoint, ikke secret) + `COURSE_ASSETS_CONTAINER`
  på web-appen.

Full deploy (`deploy-azure.yml`). `az bicep build` rent; ARM what-if (staging + prod) kjøres og
reviewes før merge (invariant #11).

**Rollback:** revert commit → storage account + container + role assignment + app-settings
fjernes. Ingen app-kode avhenger av dem ennå, så ingen runtime-påvirkning. (Merk: en allerede
opprettet storage account med data slettes ikke automatisk av en revert — men i fase 1 er den tom.)

## 1.3.15 - 2026-06-17

sec(ingest): re-valider redirect-mål mot SSRF-policy ved URL-henting (#504)

Tetter en aktiv SSRF-bypass i `fetchUrlAsSourceMaterial`: kun den opprinnelige URL-en ble
validert, men `redirect: "follow"` fulgte automatisk redirects — en angriper kunne sende inn en
public URL som redirecter til `127.0.0.1`/intern adresse, som vi så hentet + parset (med `jsdom`
i prod). Erstattet med `redirect: "manual"` + manuell løkke som re-validerer HVERT redirect-mål
med `assertSafeUrl` før det følges, capet på `MAX_REDIRECTS = 5` (`invalid_redirect` /
`too_many_redirects`). Ny unit-test: public start-URL som 302-redirecter til loopback blokkeres
(`private_address`). 8/8 url-fetch-tester grønne.

Portering av codex-PR #504 (var basert på v1.2.2, konfliktende) rent inn på main. Restrisiko
DNS-rebinding (fetch re-resolver etter sjekken) spores som eget oppfølger-issue.

## 1.3.14 - 2026-06-17

fix(course): retest-funn — liste-overflow, import av delvise locales, oversettelse-\n + GUI-lås

Fire funn fra manuell retest:
1. **Seksjons-liste horisontal scroll:** `row-action-btn` arvet shared.css `button{width:100%}`
   → full-bredde knapper sprengte tabellen. Satt `width:auto` + flex-actions-celle.
2. **Import av kurs med seksjon feilet (#512):** seksjons-payloaden brukte `localizedTextSchema`
   (krever alle tre locales), men seksjoner har ofte delvise locales (kun nb) → union-valideringsfeil
   ved import. Byttet til `localizedTextPatchSchema` (delvis objekt OK). Round-trip-testen bruker nå
   en kun-nb-seksjon for å dekke dette.
3. **Oversettelse la inn literal `\n` (nynorsk):** prompt-instruksjonen om «escaped newlines» fikk
   modellen til å skrive backslash-n. Forenklet prompten + la til `normaliseLiteralNewlines`-
   defensiv normalisering. Engelsk var allerede OK.
4. **GUI ikke låst under oversettelse:** editor-kontroller (input/faner/lagre/tilbake/oversett)
   deaktiveres nå mens LLM-kallet pågår.

`tsc` + unit-tester (44) rene. Mark-som-lest-404: ruten er bekreftet live (401 uautentisert) — bes
retestet; kunne ikke reproduseres fra koden.

## 1.3.13 - 2026-06-16

feat(course): auto-oversettelse-assist i seksjons-editor (#514)

Eksplisitt LLM-oversettelse av seksjoner (tittel + bodyMarkdown), på linje med kurs/moduler.
Per teacher-locale-prinsippet: eksplisitt handling, forfatter ser over resultatet før lagring.

- `localizeSectionContent` + `buildSectionLocalizationPrompts` i llmContentGenerationService —
  markdown-bevarende prompt (bevarer #-overskrifter, lister, lenker, kode, {{asset:...}};
  oversetter kun lesbar tekst)
- `POST /api/admin/content/sections/localize` (rate-limited, validerer source≠target)
- Editor: «Oversett fra dette språket»-knapp fyller de andre språk-fanene fra aktivt språk;
  forfatter reviewer/redigerer før lagring
- Unit-tester for prompt-byggeren (markdown/placeholder-bevaring + felt-utelatelse)

## 1.3.12 - 2026-06-16

feat(course): export/import tar med læringsseksjoner (#512)

Tetter datatap-gapet: kurs-eksport/-import håndterte kun moduler, så seksjoner forsvant ved
overføring mellom miljøer. Nå bevares den fulle modul/seksjon-sekvensen.

- Envelope-format (additivt, bakoverkompatibelt på `v1`): valgfri `items`-sekvens med
  diskriminert MODULE/SECTION; ny `sectionExportPayloadSchema` (lokalisert title + bodyMarkdown).
  `modules` beholdt (nå valgfri) som subset for v1-importører.
- Eksport (`buildCourseExportEnvelope`): bygger `items` fra `CourseItem` i rekkefølge, inliner
  hver seksjons aktive versjons markdown; emitterer både `items` + `modules`-subset.
- Import (`importCourseFromEnvelope`): foretrekker `items` (gjenskaper seksjoner via
  `createSection` + bevarer rekkefølge via `setCourseItems`); faller tilbake til legacy
  `modules`-vei for v1-filer.
- Assets (#483/F4) ennå ikke inlinet — markdown-only foreløpig (notert i #512).

Integrasjonstest: round-trip av kurs med interleaved seksjon (eksport → import → ny seksjon
gjenskapt i rekkefølge). `tsc` + CI mot Postgres rene.

Closes #512

## 1.3.11 - 2026-06-16

fix(course): UI-polish for seksjoner etter testtilbakemelding (#488/#490/#492 follow-up)

Batch av fem tilbakemeldingspunkter fra manuell staging-test:
1. «Seksjoner»-fanen lagt til i content-area-nav på Moduler- (library) og Kalibrering-sidene
   (manglet — var kun på Kurs/Seksjoner-sidene).
2. Seksjons-liste: fjernet 720px-tak som tvang horisontal scroll; tittel-kolonne tar slakk;
   «Ny seksjon»-knapp er ikke lenger full bredde.
3. (Auto-oversettelse av seksjoner → eget issue #514; manuell per-språk fungerer, deltaker-
   fallback gjør at innhold aldri vises tomt.)
4. Kursbyggeren fargekoder nå SEKSJON-rader (blå tint) for tydelig forskjell fra MODUL.
5. Seksjons-leser: eksplisitt «Marker som lest»-knapp + «Lukk» (i stedet for auto-marker-ved-
   åpning, som var utydelig); markering oppdaterer badge + progresjon ved lukk.

Kun front-end (HTML/JS/i18n). `node --check` rent.

## 1.3.10 - 2026-06-16

feat(course): seksjons-lese-progresjon — alle elementer teller, leste seksjoner markeres (#487/#492)

Snur progresjons-modellen: kurs-progresjon teller nå ALLE elementer (moduler + seksjoner),
ikke bare moduler. Moduler "fullføres" via bestått vurdering; seksjoner markeres som lest.

- Ny modell `CourseSectionRead` (userId, courseId, sectionId, readAt) + migrering
- `markSectionRead` (idempotent upsert) + `findReadSectionIds` i repository
- `POST /api/courses/:courseId/sections/:sectionId/read` (validerer kurs-tilhørighet)
- Deltaker-kurs-detalj + liste: `progress.total` = antall elementer, `completed` = bestått
  moduler + leste seksjoner; seksjons-items får `read`-flagg
- Deltaker-UI: seksjons-rad viser «Lest»/«Ikke lest»-badge; leser-overlay markerer lest ved
  åpning og oppdaterer visningen ved lukk

`CourseSectionRead` cascade-slettes med bruker/kurs/seksjon. Integrasjonstest dekker
mark-read (idempotent) + progresjons-opptelling + COMPLETED. `tsc` + CI mot Postgres rene.

Closes #487

## 1.3.9 - 2026-06-16

fix(course): manglende i18n-nøkler for seksjons-rader i deltaker-visning (#491 follow-up)

Deltaker-visningen viste rå nøkler (`courses.section.read`, `courses.section.label`) fordi
`t()` returnerer nøkkelen når den mangler — `|| fallback` slo aldri inn. La til
`courses.section.label/read/close/loading` i alle tre locales (en-GB/nb/nn) og pekte
leser-overlayen til `courses.section.close/loading`. «0/5 moduler» er uendret og korrekt
(modul-progresjon mot sertifisering; seksjoner vurderes ikke).

## 1.3.8 - 2026-06-16

fix(course): seksjons-editor sendte tomme språk-strenger → 400 ved lagring (#488 follow-up)

Editoren sendte alle tre locales (nb/nn/en-GB) ved lagring, også de uutfylte med tom
streng. `localizedTextPatchObjectSchema` er `.partial()` men hver *tilstedeværende* nøkkel må
ha minst 1 tegn, så tomme strenger ga `too_small`-valideringsfeil (400). La til
`nonEmptyLocales()` som kun sender locales forfatteren faktisk har fylt ut, + en klient-side
guard med melding hvis verken tittel eller innhold er fylt på noe språk.

## 1.3.7 - 2026-06-16

feat(course): deltaker-visning av læringsseksjoner — P1 (#491)

Åttende skive av #476 (Tier 2 LMS, epic #478). Fullfører forfatter→deltaker-løkka.

Backend:
- Deltaker-kurs-detalj (`GET /api/courses/:id`) returnerer nå `items` — den blandede
  modul/seksjon-sekvensen i rekkefølge (modul-status bevart, seksjoner med tittel)
- Nytt `GET /api/courses/:id/sections/:sectionId` — validerer at seksjonen tilhører det
  publiserte kurset, returnerer sanitisert HTML (F3/X1) + tittel i deltakerens locale

Front-end (`participant.js`):
- Kurs-detalj rendrer den blandede sekvensen; seksjons-rader åpner en mobil-først
  leser-overlay som viser server-rendret, sanitisert innhold (fallback til modul-only)

Integrasjonstest (`m2-course-section-participant.test.ts`): seksjon i sekvensen +
sanitisert HTML (script strippet) + 404 for seksjon utenfor kurset. `tsc` + `node --check`
+ CI mot Postgres rene.

Closes #491

## 1.3.6 - 2026-06-16

feat(course): kursbygger med blandede moduler + seksjoner — U3 (#490)

Syvende skive av #476 (Tier 2 LMS, epic #478). Kurs-detalj-byggeren håndterer nå en blandet
sekvens av moduler og læringsseksjoner:
- Innholdslista viser type-badge ([MODUL]/[SEKSJON]) og deler rekkefølge/flytt/fjern-kontroller
- Ny seksjons-velger (dropdown fra seksjons-biblioteket — «velg fra bibliotek», D1-valg a)
- Lastes via `GET /courses/:id/items`, lagres via `PUT /courses/:id/items` (B2) som også
  re-synker CourseModule server-side
- Fallback til legacy modul-only-form hvis items-endepunktet mangler

Kun front-end (`admin-content-courses.js` + badge-CSS). Samtale-baserte ny-kurs-flyten er
urørt. `node --check` + `tsc` + `build` rene. Manuell testing ved staging-deploy sammen med P1.

Closes #490

## 1.3.5 - 2026-06-15

feat(course): seksjons-editor (U1) + IA-design (D1) — #488, #484

Sjette skive av #476 (Tier 2 LMS, epic #478). Første UI for læringsseksjoner.

D1 (#484): `doc/DESIGN_476_LMS_SECTIONS_IA.md` — godkjent IA + wireframes (editor=laptop,
deltaker=mobil-først, eksplisitt språk-veksling i editor, «velg fra bibliotek» for seksjoner).

U1 (#488): ny «Seksjoner»-fane (`/admin-content/sections`):
- Liste over seksjoner (tittel/versjon/sist endret) + opprett/rediger/slett
- Editor med språk-faner (nb/nn/en-GB) — forfatter redigerer hvert språk manuelt
- Side-ved-side markdown + **live forhåndsvisning** via nytt
  `POST /api/admin/content/sections/preview` som rendrer med samme F3/X1-sanitiseringspolicy
  som deltaker-visningen vil bruke (server-side, ingen klient-side render-stack)
- «Seksjoner»-lenke lagt til i kurs-sidens content-area-nav

Ren additiv UI + ett lese-endepunkt. `tsc` + `build` rene. Manuell testing følger ved
staging-deploy sammen med U3 (#490) + P1 (#491).

## 1.3.4 - 2026-06-15

feat(course): blandet CourseItem-ordering-API — B2 (#486)

Femte skive av #476 (Tier 2 LMS, epic #478). API for å sette/lese den fulle ordnede
sekvensen av et kurs — moduler og læringsseksjoner om hverandre:
- `PUT /api/admin/content/courses/:courseId/items` — sett ordnet liste (sortOrder = posisjon);
  validerer at ids finnes og at modul/seksjon ikke gjentas
- `GET /api/admin/content/courses/:courseId/items` — les ordnet liste (med tittel/arkivstatus)

`setCourseItems` re-synker `CourseModule` fra MODULE-items i samme transaksjon, så de
ikke-cutover-de lese-pathene (#502) fortsatt stemmer under expand-contract. Integrasjonstest
(`m2-course-items.test.ts`) dekker interleaved sekvens + CourseModule-synk + validering
(ukjent id, duplikat). `tsc` rent; CI kjører mot Postgres. Ren backend — bygger på F1 (#480)
+ F2 (#481).

## 1.3.3 - 2026-06-15

feat(course): seksjon-CRUD-API — B1 (#485)

Fjerde skive av #476 (Tier 2 LMS, epic #478). REST-API for kurs-læringsseksjoner under
`/api/admin/content/sections` (arver `admin_content`-autorisasjon):
- `POST /` opprett (title + bodyMarkdown, begge lokaliserte) → seksjon + v1
- `GET /` liste, `GET /:id` detalj (med aktiv versjons bodyMarkdown)
- `PATCH /:id/title` oppdater tittel
- `PUT /:id/content` ny innholdsversjon (immutabel, versionNo++, latest-wins)
- `DELETE /:id` (blokkeres hvis seksjonen er knyttet til et kurs)

Kommandoer i `src/modules/course/sectionCommands.ts` speiler Module/ModuleVersion-mønsteret.
Integrasjonstest (`m2-admin-sections.test.ts`) dekker create→read→list→re-version→delete +
delete-blokkering ved kurs-tilknytning. `tsc` rent; CI kjører mot Postgres. Ren backend —
ingen UI ennå (U1 #488).

## 1.3.2 - 2026-06-15

feat(course): CourseItem-polymorfi + backfill + dual-write — F1 expand-fase (#480)

Tredje skive av #476 (Tier 2 LMS, epic #478). Innfører polymorf `CourseItem`
(courseId, itemType MODULE|SECTION, sortOrder, moduleId?/sectionId?) som skal erstatte
`CourseModule`-join og la moduler + læringsseksjoner interleaves i ett ordnet forløp.

Expand-contract (trygt, reversibelt): migrering `20260615000002_add_course_item` oppretter
tabellen, backfiller hver eksisterende `CourseModule` → `CourseItem(type=MODULE)` med bevart
`sortOrder` (gen_random_uuid for id), og har en XOR-CHECK som sikrer at nøyaktig én av
moduleId/sectionId er satt per itemType. `CourseModule` beholdes urørt; `setCourseModules`
dual-writer nå MODULE-items i parallell i samme transaksjon (SECTION-items bevares ved
re-ordering). Lese-pathene er UENDRET → null regresjon på eksisterende kurs-oppførsel.

Lese-cutover (flytt alle `course.modules`-konsumenter til `CourseItem`) + drop av
`CourseModule` følger som egen contract-fase. Integrasjonstest dekker dual-write +
SECTION-bevaring; CI kjører migrering + full suite mot Postgres. `tsc` + `prisma validate` rene.

## 1.3.1 - 2026-06-15

feat(course): CourseSection + CourseSectionVersion-modeller — F2 (#481)

Andre skive av #476 (Tier 2 LMS, epic #478). Additiv datamodell for læringsseksjoner:
`CourseSection` (id, title som lokalisert JSON, activeVersionId, archivedAt) +
`CourseSectionVersion` (immutabel versjon med `bodyMarkdown` som lokalisert JSON, versionNo,
publishedBy/At) — speiler `Module`/`ModuleVersion`-mønsteret slik at historiske visninger kan
fryses mot en versjon. Håndskrevet migrering `20260615000001_add_course_section_models`.

Rent additivt (to nye tabeller + FK-er, ingen endring på eksisterende tabeller) → kan ikke
brekke eksisterende kurs/moduler. Kobles til kurs via CourseItem (#480/F1) som kommer separat;
står frittstående inntil da. Offline-verifisert: `prisma validate` 🚀, `prisma generate` + `tsc`
rent. Runtime-migrering CI-verifisert (verify-jobben kjører migrering mot Postgres).

## 1.3.0 - 2026-06-15

feat(course): markdown-sanitiseringstjeneste for læringsseksjoner — F3 (#482) + embedded-video iframe-allowlist X1 (#493)

Første skive av #476 (Tier 2 LMS — læringstekster mellom moduler, epic #478). Ny ren
tjeneste `src/modules/course/sectionContent.ts`: `renderSectionMarkdown()` renderer
SMO-skrevet markdown via `marked` og saniterer server-side med DOMPurify (jsdom) før det
når en deltaker. `sanitizeSectionHtml()` eksponerer samme policy for live-preview-bruk.

Sikkerhet: script, inline event-handlers og `javascript:`-URLer fjernes. Iframes avvises
by default; embedded video tillates KUN fra en eksplisitt HTTPS-domene-allowlist
(`ALLOWED_VIDEO_IFRAME_HOSTS`: YouTube, youtube-nocookie, Vimeo player) via en
`uponSanitizeElement`-hook. `isAllowedVideoEmbed()` validerer protokoll + host.

`marked` + `dompurify` lagt i `dependencies` (importert i prod-kode), `@types/dompurify` i
devDeps. 13 vitest-enhetstester (positive + negative), tsc rent. Ingen DB/UI ennå — rent
backend-fundament, ship-safe alene.

## 1.2.38 - 2026-06-04

fix(admin-content): «Importer kurs-pakke»-knappen åpner nå fil-velgeren også når kurslisten ikke er tom

Klikk-handleren på `importCoursePackageBtn` ble kun wiret i tom-liste-renderingen av
kurslisten. I den populerte listeveien (minst ett kurs finnes) ble kun `change`-handleren
på fil-inputen registrert, så knappen ga ingen respons ved klikk. La til samme
`click → importCoursePackageFile.click()`-binding i den populerte veien
(`public/static/admin-content-courses.js`).

## 1.2.37 - 2026-05-29

sec(frontend): participant console hardening — same-origin redirect-restore + dokumentert config-eksponering (#355)

AC1 — `auth_intended_url`-restore validerer nå at lagret URL er same-origin + intern path
før navigering, så en eventuelt forgiftet sessionStorage-verdi ikke blir en open-redirect.
Ren funksjon `isSafeSameOriginRedirect(target, currentOrigin)` eksportert fra api-client.js
med dedikert vitest-enhetstest (6/6 grønne) som dekker same-origin/positive, javascript:/
data:/vbscript:-rejection, protocol-relative + relative path-rejection, port/scheme-mismatch,
malformed input, og tom currentOrigin.

AC2 — review av `/participant/config`: responsen er allerede minimal for et pre-auth-
endpoint. Mock-only-feltene (mockRolePresets, identityDefaults) er server-side gated på
`AUTH_MODE === "mock"` → tom/undefined i produksjon. Ingen gjenværende felt kan fjernes
uten å brekke SPA-startup eller post-login workspace-rendering. Ingen kodeendringer
trengtes; konklusjonen dokumenteres.

AC3 — ny seksjon i `doc/CONFIG_REFERENCE.md` ("Public exposure of /participant/config")
med per-felt-tabell: hvorfor hvert felt må være public, hva en uautentisert leser lærer.
Default-policy ved nye felt: «default til authenticated, ikke /participant/config».

Lukker #355.

## 1.2.36 - 2026-05-27

fix(infra): kodifiser deploy-SP Key Vault Secrets User-grant i Bicep (#470, #410-durabilitet)

#410-credential-guarden trenger lesetilgang til DATABASE-URL-secreten for å avgjøre om
skipPostgresUpdate er trygt. Deploy-SP-en hadde bare control-plane-roller (ikke KV data-plane
read) → guarden fikk `kvRead=secret-read-failed` og tvang PG-server-update på hver deploy
(ServerIsBusy-risiko). En manuell staging-grant (az rest PUT) bekreftet fiksen, men forsvinner
ved RG-recreate.

Kodifiserer grant-en i `infra/azure/main.bicep`: ny ressurs `deployPrincipalDatabaseSecretReader`
gir deploy-SP-en (param `deployPrincipalId`) **Key Vault Secrets User** scopet til DATABASE-URL-
secreten (least-privilege — guarden leser kun den). Betinget på `!skipRoleAssignments && !empty(deployPrincipalId)`.
Deploy-SP-en har User Access Administrator → oppretter assignment for seg selv.

Plumbing: `deployPrincipalId` param i Bicep ← `-DeployPrincipalId` i deploy-environment.ps1 ←
`${{ vars.DEPLOY_PRINCIPAL_ID }}` i deploy-azure.yml (begge miljø-jobber). GitHub env-vars satt:
staging=36b2fabb…, production=cba285e6…. What-if-workflowene passer også param-et.

Selvheling: pre-flighten kjører FØR Bicep, så første deploy med dette tvinger fortsatt update
(rollen finnes ikke ennå); Bicep oppretter den; påfølgende deploys leser og skipper. Idempotent
re-deploy dekkes av eksisterende RoleAssignmentExists-toleranse. Dekker både staging og prod.

Oppfølging: fjern den manuelle staging-assignmenten (guid 23be1dd0…) når Bicep eier grant-en.

Rollback: revert commit (grant forsvinner → guard over-fyrer igjen, men trygt — ingen drift).

## 1.2.35 - 2026-05-27

fix(infra): App Service-settings som separate child-ressurser etter KV + role assignments (#416)

Mai-2026-rotårsak: appSettings lå inline i app-ressursenes siteConfig, så de deployet i samme
ARM-operasjon som app-en — før KV-secrets og role assignments var ferdig provisjonert. MSI-
sidecaren kunne forsøke å resolve KV-referanser før read-rollen var på plass → app crashet ved
første boot.

Fiks: appSettings for webApp, workerApp og parserApp er trukket ut til separate
`Microsoft.Web/sites/config@2023-12-01`-child-ressurser (`name: 'appsettings'`) med eksplisitt
`dependsOn`:
- webApp/workerApp → [kvSecretAppRuntime, <app>RuntimeSecretReader] (begge refererer kun
  APP-RUNTIME-SECRETS-bundelen, #431 Stage 2)
- parserApp → [kvSecretParserWorkerAuthKey, parserAppParserAuthSecretReader]

Hvorfor child-ressurs og ikke `dependsOn` på selve app-en: role assignment-en trenger
app-ens MSI `principalId`, så app-en kan ikke avhenge av sin egen role assignment (syklus).
Child-config-ressursen opprettes etter app-en (identitet finnes) og etter role assignment-en,
så KV-referanser først resolves når rollen er på plass.

Settings-arrayene er flyttet VERBATIM (ikke gjenskrevet) og konvertert til den flate mappen
config-ressursen krever via `toObject(array, e => e.name, e => e.value)` — null risiko for
tapte settings fra manuell array→map-omskriving. Ingen `connectionStrings` finnes.
dependsOn på `!skipRoleAssignments`-betingede readers er trygt (Bicep ignorerer dependsOn på
ikke-deployet betinget ressurs — gjelder dagens prod SKIP_ROLE_ASSIGNMENTS=true).

Verifisert: `az bicep build` rent, infra-lint grønn, 3/3 config-ressurser, 0 gjenværende inline
appSettings. ARM what-if (staging + prod) reviewes før merge per invariant #11.

Rollback: revert Bicep-commit (inline-appSettings = nåværende prod-state).

## 1.2.34 - 2026-05-27

fix(infra): PG pre-flight uavhengig av App Service + credential-drift-guard (#411, #410)

Begge endrer PG-pre-flight-regionen i `scripts/azure/deploy-environment.ps1`, derav én PR.

**#411** — `$existingPgServer` resolves nå før `if ($existingWebApp -and $existingWorkerApp)`,
og PostgreSQL-property-pre-flighten (som setter `$skipPostgresUpdate`) er flyttet UT av den
App Service-guarden. Tidligere ble pre-flighten hoppet over på partial teardown (PG finnes,
App Services slettet) → ubetinget server-update risikerte ServerIsBusy-lås. Kjører nå når
PG-serveren finnes, uavhengig av App Services.

**#410** — credential-drift-guard. main.bicep skriver `kvSecretDatabaseUrl` ubetinget men
oppdaterer serveren kun når `!skipPostgresUpdate`. Korrigert premiss: workflowene passer en
*fast* `POSTGRES_ADMIN_PASSWORD`-secret (ikke generert per kjøring), så drift oppstår kun ved
en passord-rotasjon som treffer skip-pathen. Fiks: skip-beslutningen leser nåværende passord
fra DATABASE-URL-secreten — hvis ønsket ≠ nåværende (rotasjon tilsiktet) tvinges server-update
så server + Key Vault endres atomisk (invariant #12); ved match er skip trygt; ved usikkerhet
tvinges update (trygg retning). Ren logikk i `deploy-environment.helpers.ps1`
(`Get-PostgresPasswordFromConnectionString`, `Resolve-PostgresSkipForCredentialSafety`) med
Pester-tester. Ingen Bicep-endring.

Rollback: revert commit. Endringen legger kun til en sikkerhets-guard (tvinger server-update
ved rotasjon/usikkerhet) — verste utfall er en retbar ServerIsBusy, aldri credential-drift.

## 1.2.33 - 2026-05-27

sec(auth): vendre MSAL lokalt + CSP/security-headers (#393)

[Security][P2] Klienten lastet MSAL fra ekstern CDN (alcdn.msauth.net) uten SRI. En
kompromittert CDN-respons ville kjørt i vår origin og kunne lest tokens / kalt API-er
som offeret.

(1) **Vendret MSAL 2.38.0 lokalt**: `public/static/vendor/msal-browser-2.38.0.min.js`
(hentet fra npm, kanonisk provenans). api-client.js `loadMsalScript()` laster nå lokalt
med SRI-integrity (sha384) + crossorigin. Ingen ekstern CDN-avhengighet ved kjøretid.
Oppdateringsprosess dokumentert i `doc/MSAL_VENDORING.md`.

(2) **Security-headers-middleware** (`src/middleware/securityHeaders.ts`, mountet tidlig
i app.ts): CSP med strikt `script-src 'self'` — mulig fordi MSAL nå er lokal og appen
har null inline-script/event-handlers. style-src beholder 'unsafe-inline' (inline
<style>/style-attrs, lavrisiko). connect/frame/form-action tillater Entra-login-origin
for MSAL silent-token/redirect. Pluss X-Content-Type-Options: nosniff, X-Frame-Options:
DENY, Referrer-Policy.

Statisk verifisert før implementering: alle scripts lokale, ingen inline-script/handlers,
all CSS lokal, ingen eksterne https-referanser, ingen ekstern fetch. blob:-nedlastinger
bruker `download`-attr (ikke CSP-styrt). test/unit/security-headers.test.ts dekker
header-kontrakten.

Akseptansekriterier #393: (a) ingen ekstern CDN ✓ (b) versjon kontrollert av vendret
asset ✓ (c) CSP begrenser script-injeksjon ✓ (d) Entra-login i alle arbeidsflater —
gjenstår brukerverifisering.

## 1.2.32 - 2026-05-24

ux(admin): handoff-dialog copy + post-publish-flyt (#361/#442 follow-up)

To uavhengige UX-forbedringer i samme batch (jf. UX-batching):

(1) **Handoff-dialog copy** (option C, brukerfeedback): «Ulagrede endringer»-dialogen
ved Avansert→Samtale brukte «gå tilbake», men brukeren startet i Avansert — misvisende
retning. Endret til retningsnøytralt:
- saveFirst: «Lagre og gå tilbake» → «Lagre og fortsett» (en: «Save and continue»)
- discard: «Gå tilbake uten å lagre» → «Fortsett uten å lagre» (en: «Continue without saving»)
- brødtekst: «blir med tilbake til samtalen» → «blir med til samtalen» (en: «carry back» → «carry over»)
Oppdatert i alle tre locales (begge translation-sett) + HTML-fallback i
admin-content-advanced.html (som dessuten lå på pre-v1.2.28-tekst).

(2) **Post-publish-flyt**: etter publisering landet brukeren i full modul-velger
(«Velg en modul»), som er en unaturlig kontekst rett etter å ha jobbet med én modul.
publishLatestDraftInBackground nullstiller ikke lenger hele konteksten + startModulePicker,
men kaller `loadModule(moduleId)` — laster modulen på nytt (nå Live) og avslutter med
showModuleActions («Hva vil du gjøre med denne modulen?»). «Velg en annen modul» er
fortsatt tilgjengelig derfra. Samme mønster som unpublishModuleInBackground.

## 1.2.31 - 2026-05-24

fix(admin): modul-detaljer-dialog viser blank tittel etter reopen (#361 follow-up)

Bruker rapporterte: «Jeg går inn i Avansert og endrer tittel fra CLS til CLS3, lukker
dialogboks, åpner dialogboks igjen. Tittel er blank.»

Rotårsak: v1.2.29 byttet applyModuleDetailsDialog til setLocalizedEditorValue så
moduleTitleInput.value inneholder bare current-locale string + dataset.localeOriginal
har hele locale-objektet. Men openModuleDetailsDialog (admin-content.js L2591) leste
fortsatt rå .value via parseLocalizedSafe — som returnerer den enkle strengen, ikke
locale-objektet. Trace med currentLocale="nb" og {en-GB:"CLS3", nb:"", nn:""}:
.value = "" (nb verdi) → parseLocalizedSafe("") = "" → alle tabs vises blanke.

Fix: ny readLocaleSrc-helper i openModuleDetailsDialog leser dataset.localeOriginal
først, faller tilbake til parseLocalizedSafe(.value) hvis dataset ikke er satt.
Symmetrisk med readLocalizedFieldValue-pattern fra save-flyten.

Version-details og prompt dialogene har ikke samme issue fordi deres apply-funksjoner
fortsatt bruker formatEditorValue (JSON-stringify i .value) — de leser .value
direkte og det fungerer. Latent inconsistency, men ikke fikset i denne sliсen.

## 1.2.30 - 2026-05-24

fix(admin): handleSaveContentBundle leser ikke dataset.localeOriginal (v1.2.29 e2e-regresjon)

v1.2.29 endret `applyModuleDetailsDialog` til å bruke `setLocalizedEditorValue` —
input.value inneholder nå current-locale string, og dataset.localeOriginal lagrer hele
locale-objektet. Men `handleSaveContentBundle` (admin-content.js L2235) kalte
`normalizeLocalizedTitlePatchValue(moduleTitleInput.value, ...)` som bruker
`parseLocalizedTextField` (uten dataset-bevissthet). Resultat: lagring sendte
{en-GB: "X", nb: "X", nn: "X"} med en-GB-strengen kopiert til alle locales — andre
locales overskrevet. E2e-test "advanced editor persists a renamed module title when
saving content" fanget regresjonen (#nb verdi var "Renamed module" i stedet for
"Omdøpt modul").

Fix: handleSaveContentBundle bruker nå `readLocalizedFieldValue` (med required:false)
som merger dataset.localeOriginal med current-locale edit. Bevarer eksisterende
behavior når dataset ikke er satt (faller tilbake til normalizeLocalizedTitlePatchValue).

## 1.2.29 - 2026-05-24

fix(admin): handoff-tittel rendres som JSON-streng i Samtale-preview (#361 follow-up)

Bruker fanget diagnostic-log fra v1.2.28: `[handoff-apply-shell] {titleType:"string",
titlePreview:"{\n  \"en-GB\": \"CLS3\",\n  \"nb\": \"\",\n  \"nn\": \"\"\n}"...}`.
Det avslørte at moduleTitleInput.value inneholdt JSON-stringified locale-objekt med
2-space-indent — eksakt mønsteret `JSON.stringify(obj, null, 2)` produserer. Tre sammen-
hengende feil:

1. **Rotårsak**: `applyModuleDetailsDialog` (admin-content.js L2616-2619) brukte legacy
   stringify-pattern (`isMultiLocale ? JSON.stringify(obj, null, 2) : obj["en-GB"]`) som
   plasserte rå JSON i input.value uten å sette dataset.localeOriginal. Bypassed v1.2.22-
   invarianten om at locale-aware felt holder current-locale string i .value og lagrer
   hele locale-objektet på dataset. Fix: bruk `setLocalizedEditorValue` for title og
   description (locale-aware). certificationLevel beholdes på asValue-mønsteret.

2. **doWriteHandoff** (admin-content.js L4294) leste rå `moduleTitleInput?.value` — som
   etter dialog-bruk var JSON-strengen. Andre locale-felt (taskText, criteria-input)
   hadde samme svakhet. Fix: ny `readLocaleField`-helper bruker eksisterende
   `readLocalizedFieldValue` (required:false) for å hente locale-objektet fra dataset
   når det finnes, ellers plain string. Sender full locale-fidelity i handoff.

3. **localizeValueForLocale** (admin-content-preview.js L24) brukte `??`-coalesce i
   fallback-kjeden, så tom streng ("") for current-locale returnerte "" i stedet for å
   falle tilbake til en-GB. Med locale-objekt `{en-GB:"CLS3",nb:"",nn:""}` og preview-
   locale nb fikk bruker blank tittel selv om en-GB hadde innhold. Fix: ny
   `pickFirstNonEmpty`-helper med truthy-sjekk (whitespace trimmet).

Sammen sikrer fixene at: (a) dialog ikke korrumperer input, (b) handoff bærer full
locale-fidelity, (c) preview faller pent tilbake mellom locales. Diagnostic-logging
fra v1.2.28 fjernet (server-POST og console.log).

## 1.2.28 - 2026-05-24

fix+diag(admin): handoff dialog-copy oppdatert + diagnostic-log (#361 follow-up)

(1) Dialog-copy `handoff.unsaved.body` oppdatert i alle tre locales etter v1.2.26
utvidet handoff-settet. Tidligere tekst sa «kun oppgavetekst, veiledning og MCQ» —
nå reflektert at title, description, criteria også blir med, og spesifiserer hva som
IKKE blir med (rubric-vekting, prompt-mal, submission-skjema, vurderingspolicy).

(2) Diagnostic console.log på begge sider av handoff (`[handoff-write-advanced]` i
Avansert, `[handoff-apply-shell]` i Samtale) for å verifisere hva som faktisk
skrives/leses. Brukertest av v1.2.26/27 viste at title ikke kom gjennom selv om kode-
trace ser korrekt ut. Logging avklarer rotårsak. Fjernes etter neste verifisering.

## 1.2.27 - 2026-05-24

fix(admin): title/description fra handoff vises ikke i shell (#361 follow-up)

Brukertest av v1.2.26 viste at title-endring fra Avansert→Shell handoff ikke ble synlig
i Samtale-preview (kun MCQ kom igjennom). Rotårsak i `renderPreview` (shell.js ~L1009):

```js
title: mod.title,           // ← ignorerte activeDraft.title
description: mod.description,
taskText: hasDraft ? activeDraft.taskText : (cfg.moduleVersion?.taskText ?? ""),
```

Mens taskText og andre felt brukte `hasDraft ? activeDraft : bundle`-mønsteret, fulgte
ikke title/description samme prinsipp. Bundle.module.title vant alltid for loaded
moduler — så handoff'd title-endringer ble overstyrt av server-state.

Fix: title og description bruker nå samme `hasDraft && activeDraft.x ? activeDraft.x : mod.x`-
mønster som de andre feltene.

## 1.2.26 - 2026-05-24

feat(admin): full working-draft handoff shell ↔ Avansert (addresses #361)

Tidligere bare 4 felt (taskText, candidateTaskConstraints, assessorExpectedContent,
mcqQuestions). Roundtrip mistet title/description/criteria/blueprint hvis ulagrede.

**Endringer**:
- Shell→Avansert: handoff inkluderer nå title, description, criteria, assessmentBlueprint
  i tillegg til eksisterende sett. «Forkast utkastet og åpne Avansert»-knappen er
  re-labeled til «Ta utkastet med til Avansert (uten å lagre)» — den DEPRECATED å
  forkaste; nå carries draft som dirty state i Avansert.
- Avansert→Shell: handoff inkluderer nå title, description, criteria. Blueprint
  utelates (Avansert eksponerer ikke blueprint som textarea — shell henter fra modul-
  bundle).
- `applyHandoffFromShell` (Avansert) markerer riktig dirty-card per felt (moduleDetails,
  versionDetails, mcq, rubric).
- `applyHandoffDraft` (shell) bygger sessionDraft med utvidet patch.

**Eksplisitt utelatt** (Avansert-only — shell rendrer ikke, dokumentert i
admin-content-handoff.js):
- rubric.scalingRule, promptTemplate, submissionSchema, assessmentPolicy

## 1.2.25 - 2026-05-24

fix(reports): TS2783 duplicate courseId i course-learners-mapping (v1.2.24 CI-fix)

CI fanget TS2783 i `src/routes/reports.ts:344` etter v1.2.24 — `CourseLearnerRow`
inkluderer allerede `courseId`, så explicit `courseId: courseLearnerReport.selectedCourseId`
ble overskrevet av spread. Lokal tsc rapporterte falskt grønt (mistenker stale cache —
verifisert i CI etterpå). Fjernet den eksplisitte assignment-en.

Lærdom: TypeScript-feil som dukker opp i CI men ikke lokalt indikerer trolig en stale
`.tsbuildinfo` eller node_modules-cache. Trygt å stole på CI-tsc framfor lokal.

## 1.2.24 - 2026-05-23

feat(results): 4 nye scoped CSV-eksporter (closes #358)

Bygger på eksisterende `exportCsv`-mønster og legger til fire nye `type`-verdier i
`/api/reports/export`:

- **`module-summary`** — én rad per modul, aggregert. Reuser `getCompletionReport`.
- **`module-learners`** — én rad per (learner, modul) innen aktive filters. Ny
  `getModuleLearnersReport` i `completionReport.ts` (generaliserer
  `getCompletionLearnerReport` til å fungere uten moduleId-filter).
- **`course-summary`** — én rad per kurs, aggregert. Flatset
  `getCourseReport`-output med moduleCount; modul-breakdown forblir i UI-detalj-view.
- **`course-learners`** — én rad per (learner, kurs). Krever `courseId`-filter
  (returnerer tom CSV uten — iterering over alle kurs er ikke spec'd ennå).

Alle eksporter respekterer top-level filters (module, course, status, dateRange,
orgUnit). Eksisterende `completion`/`pass-rates`-buttons beholdes.

Frontend: fire nye knapper i Results-export-row + i18n for en-GB/nb/nn.

## 1.2.23 - 2026-05-23

feat(observability): intent-classification logging i Samtale (#357 Phase A, #466 sporer Phase B)

Beslutning på arkitektur for #357: hybrid (regler først, LLM-fallback når regler er
clarify/unsupported). Phase A: instrumentering. Phase B: implementasjon basert på
faktisk pilot-data.

**Endringer**:
- `POST /api/admin/content/intent-log` (`intentLogLimiter` 60/min/bruker): server-
  endepunktet logger structured JSON via `console.log` med prefiks `[intent-log]`.
  Ingen DB-tabell ennå; App Service log stream / Application Insights fanger payloaden.
- Frontend `logIntentClassificationToServer` i `admin-content-shell.js`: fire-and-forget
  fra `runUnifiedRevision` etter `classifyShellEditInstruction`. Sender `rawInput`,
  `intentKind`, `targets`, `locale`, `moduleId`, `hasDraft`, `hasMcq`. Feil i logging
  påvirker aldri brukerflyt.
- `rawInput` truncated til 500 tegn på server for safety.

**Phase B sporet i #466** — etter data-innsamling: utvide rule-set + bundet LLM-classifier-
fallback.

## 1.2.22 - 2026-05-23

slice: locale-aware textarea-display + kollaps modulliste (closes #462, closes #465)

**#462 — rå JSON i Avansert-textareas**

`formatEditorValue` viste locale-objekter som rå `{"en-GB":"...","nb":"..."}`-blob i
textarea-feltene. Fikset med to nye helpers i `admin-content.js`:

- `setLocalizedEditorValue(el, value)` — viser current-locale-verdi i textarea, lagrer
  original locale-objekt på `el.dataset.localeOriginal`. Aksepterer både locale-objekt
  direkte og JSON-encoded locale-objekt-string (legacy lagring fra Samtale).
- `readLocalizedFieldValue(el, fieldLabelKey, options)` — merger brukerens textarea-tekst
  inn i den lagrede originalen ved save (kun current-locale oppdateres, andre bevart).
  Hvis bruker har skrevet en JSON-blob manuelt, faller den tilbake til
  `parseLocalizedTextField` så multi-locale-edit via JSON fortsatt fungerer.

Anvendt på 8 locale-aware felt: moduleTitle, moduleDescription, mcqSetTitle,
moduleVersionTaskText, moduleVersionCandidateTaskConstraints,
moduleVersionAssessorExpectedContent, promptSystemPrompt, promptUserPromptTemplate.

Ikke-locale-felt (rubric-criteria, mcq-questions, assessment-policy) bruker fortsatt
`formatEditorValue` / rå JSON som før.

**Kjent begrensning**: locale-switching mid-edit oppdaterer ikke textarea-innholdet
automatisk. Bytte av locale påvirker bare nyåpnede moduler. Dokumentert som
follow-up-issue om det blir et reelt problem i bruk.

**#465 — kollaps modulliste i Participant**

Når deltakeren aktiverer en modul, kollapses modullisten (og hjelpeteksten) i
participant-UI-en så modul-innholdet får mer plass. Header + «Last moduler»-knappen
forblir synlig. Klikk på «Last moduler» ekspanderer listen igjen.

Implementert som CSS-klasse `.module-list-collapsed` på `#moduleListSection` med
`display: none` på `#moduleList` + `#moduleSelectionHint` + summary-hint.

## 1.2.21 - 2026-05-23

fix(admin): #464 borderlineWindow ble stripped av zod-schema på lagring

v1.2.20 implementerte borderlineWindow-logikken i decisionService, men brukertest
viste at vinduet ikke faktisk persisterte: oppgitt vindu 0-90, lagret, publisert,
deretter participant-innlevering med score i vinduet → fortsatt automatisk
pass/fail (avhengig av threshold), aldri manuell review. Ved re-åpning av Avansert
var vinduet borte.

**Root cause**: `assessmentPolicyBodySchema.passRules` i `adminContentSchemas.ts`
hadde kun `totalMin` som tillatt felt. Zod stripper ukjente nøkler stille uten
`.passthrough()`, så `borderlineWindow`, `mcqMinPercent` og `practicalMinPercent`
(alle tilbudt av UI-dialogen) ble fjernet fra payloaden før den nådde createModuleVersion.

**Fix**: utvidet schemaet til å akseptere alle feltene UI-en samler inn. Backward-
kompatibelt (alle nye felt er `.optional()`).

## 1.2.20 - 2026-05-23

slice: 5 backlog-issues + #462 utsatt (addresses #464, #460, #459, #461, #463)

**#464 — borderlineWindow brukes nå i decisionService**

Tidligere dead field. Nå: hvis `passRules.borderlineWindow.{min,max}` er satt og
`totalScore` er i intervallet, rutes innleveringen til manuell vurdering selv om
threshold-rules ellers gir auto-pass. `passFailTotal=false` for borderline-saker.
Decision-reason refererer eksplisitt til borderline-vinduet.

**#460 — Status-label split i to (`published_with_draft`)**

`deriveLibraryStatus` returnerer nå `published_with_draft` når `activeVersionId` er
satt men `latestVersion !== activeVersion`. Frontend viser «Live + utkast» (en-GB:
«Live + draft», nb/nn: «Live + utkast»). Grønn bakgrunn (publisert) + gul outline
(har upublisert draft). Filter «Har upublisert utkast» dekker både `unpublished_draft`
og `published_with_draft`. Filter «Publiserte» dekker både `published` og
`published_with_draft`.

**#459 — Avpubliser-knapp i modul-bibliotek-rad**

Ny `Avpubliser`-knapp synlig kun for moduler med status `published` eller
`published_with_draft`. Klikk → window.confirm-dialog med tydelig melding om
konsekvensene → POST `/modules/:id/unpublish` (samme endepunkt Avansert bruker) →
toast + refresh.

**#461 — Versjonsnummer i participant module-list**

Diskret «· vN»-tag etter modul-tittel i participant-modulvalg. Publiseringsdato vises
i tooltip. Diskret stilet (`font-size: 11px`, `color: meta`) så det ikke konkurrerer
med tittel-presentasjonen. Hjelper support/debug å reprodusere hvilken versjon en
deltaker fikk servert.

**#463 — Dirty-detection før publisering**

`handlePublishModuleVersion` sjekker nå `dirtyCards.size > 0` før POST. Hvis det er
ulagrede endringer, vises bekreftelses-dialog som lister hvilke cards som er dirty
og forklarer at publisering bruker SIST LAGRET versjon. Brukeren kan velge å avbryte
og lagre først, eller fortsette publisering uten ulagrede endringer.

**#462 — Utsatt**

Kvikkfix for rå JSON i Avansert-textareas ville introdusert data-tap (parser ville
overskrive locale-objekter med plain string ved første save fra Avansert). Krever
origin-tracking + merge-på-save. Bumpet til neste slice som dedikert oppgave.

## 1.2.19 - 2026-05-23

feat(review): decision-orientert case-detail layout (addresses #349, #354)

Review- og appeal-detail-paneler er omstrukturert fra «data dump + linear sections»
til en decision-stack:

1. **Header**: status-chip + SLA-chip + modul + kandidat (kort kontekst på toppen).
2. **Kandidatens innlevering**: oppgave, svar, refleksjon, innleveringstidspunkt — som
   en strukturert `<dl>` (ikke pre-formatert tekst).
3. **Beslutningshistorikk**: AI-vurdering → Vurderer-overstyring → Anke → Anke-beslutning,
   som en tidslinje med actor + tidspunkt + decision + begrunnelse.
4. **Din beslutning**: textareas + select + Krev oppdraget / Fullfør beslutning (samme
   form-felter som før, bare flyttet inn i sin egen seksjon med blå-toned bakgrunn).
5. **Tekniske detaljer**: collapsed `<details>`-seksjon med rå JSON / ID-er / timestamps —
   tilgjengelig, men ikke synlig i førsteinntrykk.

**#354** (interaction grammar): «Claim review»/«Claim appeal»/«Assign to me» → konsistent
«Krev oppdraget» (`case.action.claim`). «Finalize override»/«Resolve appeal» → «Fullfør
beslutning» (`case.action.finalize`). Begge knapper plassert i samme rekkefølge i begge
paneler. Eksisterende `manualReview.claim/override` og `appealHandler.claim/resolve`-keys
beholdes for bakoverkompatibilitet — `data-i18n` på knappene peker nå på `case.action.*`.

**Acceptance per #349**:
- ✅ Case detail-paneler kan forstås uten å lese hele raw data dump
- ✅ Viktigste decision-data først; teknisk metadata sekundær/collapsible
- ✅ Operator-hastighet uten endring i business rules (samme form-felter, samme submit-paths)

**Acceptance per #354**:
- ✅ Manual-review og appeal bruker samme interaction-grammar (claim → finalize)
- ✅ Rolle-spesifikke ord (Decision reason / Override note / Resolution note) beholdt
  der de er distinkte; standardiserte der de var asymmetriske uten grunn.

## 1.2.18 - 2026-05-23

slice: 3 endringer i modul-bibliotek (closes #457, closes #458, closes #352)

**#457 — STATUS_LABELS i18n**

`STATUS_LABELS` i `admin-content-library.js` var hardkodet norsk («Arkivert», «Upublisert
utkast», «Publisert», «Klargjort»). Brukere i en-GB/nn så norske labels. Erstattet med
i18n-keys (`library.status.archived` osv.) med oversettelser for alle tre locales.

**#458 — Import-dialog focus-restore på feil**

`importModulePackageFile`-change-handleren fokuserer nå tilbake til `importModulePackageBtn`
når import feiler, så tastatur-bruker kan re-trigge uten å Tab-e fra en tom file-input.
SR-bruker får allerede annonsering via toast.js (`role="alert"` for error-toasts).

**#352 — Retire transitional admin-content routes**

- `GET /admin-content?moduleId=X` → 301-redirect til canonical
  `/admin-content/module/X/conversation`.
- `GET /admin-content/advanced` (no module context) → 301-redirect til `/admin-content`
  (modul-bibliotek). Avansert-editoren ligger nå kun på `/admin-content/module/:id/advanced`.
- Interne client-refs (`buildAdminContentAdvancedUrl` fallback, shell.js error-recovery)
  oppdatert til canonical routes så vi ikke genererer 301-vekkredirects internt.
- `participant-console-config.test.ts` testene oppdatert til å bekrefte både redirects og
  canonical routes.

Bookmarks/eksterne lenker til legacy URLs fortsetter å virke via 301.

## 1.2.17 - 2026-05-23

fix(admin): Sertifiseringsnivå-kolonnen viste hardkodet engelsk + ugyldig "Foundation"

Modul-bibliotek-tabellen hadde et `CERT_LABELS`-objekt med fastlåst engelsk («Basic»,
«Intermediate», «Advanced») pluss en ugyldig «Foundation»-verdi som ikke finnes i
skjemaet (`certificationLevelSchema = enum["basic","intermediate","advanced"]`).

Fix:
- Erstatt `CERT_LABELS` med `CERT_I18N_KEYS` som mapper enum → i18n-keys
  (`adminContent.promptDialog.certificationLevelBasic|Intermediate|Advanced`). Bruker
  ser «Grunnleggende / Videregående / Avansert» i nb, «Grunnleggjande / Vidaregåande /
  Avansert» i nn, «Basic / Intermediate / Advanced» i en-GB.
- Fjern «Foundation» (dead code).
- Tolerer legacy-data der `certificationLevel` ble lagret som JSON-encoded locale-objekt
  — parser ut en kjent enum-verdi om mulig, ellers viser verdien rå (synlig signal at
  noe er feil og kan ryddes manuelt).


---

Older versions (v1.2.16 and earlier) are archived in [`archive/VERSIONS_archive.md`](archive/VERSIONS_archive.md) — flyttet 2026-05-29 for å holde denne fila lesbar.
