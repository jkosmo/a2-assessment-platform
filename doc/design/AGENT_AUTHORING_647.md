# Agent Authoring — designnotat (AA-D1, #648 / EPIC #647)

Status: **vedtatt designgrunnlag** for AA-1…AA-6 (#649–#654).
Forfattet 2026-07-05. Bygger på omforente beslutninger i #647 og kartlegging av eksisterende
kontrakter i `src/modules/adminContent/adminContentSchemas.ts`, `src/routes/adminContent.ts`,
`src/routes/adminCourses.ts`, `src/routes/adminSections.ts` og `doc/design/CONTENT_LIFECYCLE.md`.

## 1. Mål og avgrensning

En agent (Claude/ChatGPT/Codex) skal kunne bygge et **upublisert kursgrunnlag** maskinelt:
seksjoner, moduler (alle tre `assessmentMode`), kurskomposisjon og rekkefølge. Publisering er
**alltid** en manuell handling i admin-UI og er **ikke** en del av Agent Authoring API-et.

API-et er en **tynn orkestrering over eksisterende admin-content-kommandoer** — ikke en ny
innholdsmodell. Ett nytt endepunkt (validate) + små utvidelser av eksisterende create/import-
responser. Ingen stor «execute package»-operasjon i MVP; skillen orkestrerer enkeltkall.

## 2. Kontrakt: `a2-authoring-package/v1`

En authoring package er agentens *plan* — den sendes til `validate` for dry-run, og brukes av
skillen som kilde for de enkelte create-kallene. Den er **ikke** et write-format serveren
persisterer som helhet.

```json
{
  "packageFormat": "a2-authoring-package/v1",
  "locale": "nb",
  "constraints": {
    "source": "samtale 2026-07-05 om GDPR-opplæring",
    "requirements": "6 fritekstmoduler, 2 læringsseksjoner, nivå FOUNDATION"
  },
  "objects": [
    {
      "clientRef": "intro",
      "type": "section",
      "payload": {
        "title": "Introduksjon til GDPR",
        "bodyMarkdown": "## Hva er GDPR\n..."
      }
    },
    {
      "clientRef": "module-1",
      "type": "module",
      "payload": {
        "module": {
          "title": "Behandlingsgrunnlag",
          "description": "Vurdering av behandlingsgrunnlag i praksis",
          "certificationLevel": "FOUNDATION"
        },
        "activeVersion": {
          "assessmentMode": "FREETEXT_ONLY",
          "taskText": "Beskriv hvilket behandlingsgrunnlag ...",
          "assessorExpectedContent": "...",
          "rubric": { "criteria": { "...": {} }, "scalingRule": {} },
          "promptTemplate": { "systemPrompt": "...", "userPromptTemplate": "..." }
        }
      }
    },
    {
      "clientRef": "course-main",
      "type": "course",
      "payload": {
        "course": {
          "title": "GDPR for saksbehandlere",
          "description": "…",
          "certificationLevel": "FOUNDATION"
        },
        "items": [
          { "type": "SECTION", "ref": "intro" },
          { "type": "MODULE", "ref": "module-1" }
        ]
      }
    }
  ]
}
```

Regler på package-nivå (håndheves av `validate`, AA-1):

- `packageFormat` er literal `"a2-authoring-package/v1"`.
- `clientRef` er unik innenfor pakken; kun `[a-z0-9-]{1,64}`.
- `type` ∈ `module | section | course`.
- `course.payload.items[].ref` må peke på en `clientRef` i samme pakke **eller** angi
  `moduleId`/`sectionId` for eksisterende innhold (blanding tillatt — agenten kan gjenbruke
  eksisterende moduler i et nytt kurs).
- Pakken må inneholde minst ett opprettbart objekt.
- `locale` er informativ (agentens primærspråk); leaf-payloads følger LocalizedText-reglene i §3.
- `constraints` er fritt JSON-objekt, kun for audit/debug (AA-5 logger den). Serveren tolker
  den aldri.
- **Ingen publiseringsfelt finnes i kontrakten.** Felt som `publishedAt`, `autoPublish` eller
  `audit` avvises av validate (`unknown_field`), slik at et agent-hallusinert publiseringsforsøk
  feiler høyt i stedet for å ignoreres stille.

### Forhold til `a2-content-export/v1`

Vi gjenbruker **leaf-kontraktene**, ikke konvolutten:

| Authoring-payload | Gjenbruker (adminContentSchemas.ts) | Avvik fra export |
|---|---|---|
| `module` | `moduleExportPayloadSchema` | `audit` **utelatt/forbudt** (agent har ingen publiseringshistorikk); ellers identisk, inkl. alle `assessmentMode`-regler |
| `section` | `sectionExportPayloadSchema` | `audit` utelatt/forbudt |
| `course.course` | `courseExportPayloadSchema.course`-metadata | `modules`/inline-items **erstattes** av `items[].ref` — authoring refererer per `clientRef`/eksisterende ID i stedet for å inline payloads |

Begrunnelse: export-formatet inliner hele modul-payloads i kurs (kopiér-et-kurs-semantikk),
mens authoring trenger *komposisjon av objekter som ennå ikke har server-ID*. `clientRef`
løser det uten å duplisere leaf-schemas.

LocalizedText: `localizedTextSchema` aksepterer ren streng (→ alle locales) — dette er
anbefalt agent-format. Objektform `{ "en-GB", "nb", "nn" }` (strict for modul-tittel, patch
for seksjon/kurs) støttes som i dag.

## 3. Endepunkter og skill-orkestrering

MVP-endepunkter (rekkefølgen skillen kaller dem i):

1. `POST /api/admin/content/agent-authoring/validate` — **nytt** (AA-1, #649). Dry-run av hele
   pakken, ingen DB-writes, returnerer rapport + execution plan (§5).
2. `POST /api/admin/content/modules/import` — **eksisterende**. Skillen syntetiserer en
   modul-scopet `a2-content-export/v1`-konvolutt per modul-objekt (`exportedAt: nå`,
   `audit: {}`, `mode: "createNew"`, `autoPublish: false`) → ett kall oppretter modul +
   rubrikk/prompt/mcq/versjon samlet, som draft. Returnerer `{ moduleId, moduleVersionId }`.
3. `POST /api/admin/content/sections` — **eksisterende**, utvides med draft-flagg (§4).
4. `POST /api/admin/content/courses` — **eksisterende**. Oppretter draft (`publishedAt: null`).
5. `PUT /api/admin/content/courses/:courseId/items` — **eksisterende**. Skillen oversetter
   `items[].ref` → server-ID-er fra stegene over.

AA-2 (#650) gjør create/import-responsene agentvennlige: hver 201-respons får `adminUrl`
(deep link, §7) og ekko av `clientRef` når den sendes inn. Inntil da kan skillen konstruere
URL-ene selv fra `doc/route-map.md`-mønstrene.

**Bevisst valgt bort:** et samlet `POST /agent-authoring/execute`-endepunkt. Begrunnelse:
(a) gjenbruk av eksisterende, godt testede kommandoer i stedet for en ny transaksjonell
composite; (b) partial failure blir eksplisitt og gjenopptakbar i skillen (§8) i stedet for en
lang server-transaksjon; (c) API-flaten forblir lik den mennesker/annen tooling bruker.
Kan revurderes post-MVP hvis orkestreringskostnaden i skills viser seg for høy.

## 4. Draft-only-invarianten

Livssyklusmodellen (to-akse, `CONTENT_LIFECYCLE.md`) gir følgende garanti-mekanismer:

| Entitet | Draft-garanti | Status i dag |
|---|---|---|
| Modul | Ikke kall publish → `activeVersionId = null` | ✅ holder allerede (import med `autoPublish: false` og tom `audit`) |
| Kurs | Ikke kall publish → `publishedAt = null` | ✅ holder allerede |
| Seksjon | — | ⚠️ **hull**: `createSection` auto-publiserer ved lagring (`activeVersionId` settes umiddelbart) |

**Beslutning (seksjonshullet):** `POST /sections` utvides med valgfritt `draft: true`
(default `false` = dagens oppførsel, ingen endring for UI). Med `draft: true` opprettes
versjonen uten at `activeVersionId` settes — samme tilstand som «restore lander i Utkast»
(invariant I3) allerede bruker. Landes i AA-2. Fallback hvis AA-2 forsinkes: skillen kaller
create + `unpublish` umiddelbart (fersk seksjon er ikke i noe kurs, så G2-bruklåsen blokkerer
ikke), men dette gir et kort publisert-vindu og et ekstra kall — flagget er riktig løsning.

Merk: en upublisert seksjon er uansett aldri deltaker-synlig (seksjoner eksponeres kun via
kurs), så hullet er lavrisiko — men invarianten skal holde *per objekt*, ikke via indirekte
resonnement.

Konsekvens for menneskelig publisering: kurs bygget av agent kan ikke publiseres før alle
items er publisert (I1/G1) — det er tilsiktet; SMO går gjennom og publiserer modul for modul,
deretter kurset.

Eierskap: alle objekter opprettes med `createdById = <autentisert bruker>` — agenten handler
*på vegne av* en SMO/admin, og modul-eierskapsmodellen (#528) gjelder uendret.

## 5. Valideringsrapport (AA-1)

`POST /api/admin/content/agent-authoring/validate` er `admin_content`-beskyttet
(ADMINISTRATOR + SUBJECT_MATTER_OWNER), gjør **ingen** DB-writes, og svarer **200 også når
pakken er ugyldig** — rapporten er resultatet, ikke en feil. (400 brukes kun når selve
requesten ikke er parsebar JSON / mangler `packageFormat`.)

Request: `{ "package": <a2-authoring-package/v1> }`.

Response:

```json
{
  "valid": false,
  "summary": { "errors": 2, "warnings": 1, "objects": 7 },
  "issues": [
    {
      "severity": "error",
      "path": "objects[2].payload.activeVersion.mcqSet",
      "code": "required_for_mode",
      "message": "assessmentMode MCQ_ONLY krever mcqSet."
    },
    {
      "severity": "error",
      "path": "objects[4].payload.items[1].ref",
      "code": "unknown_client_ref",
      "message": "ref 'modul-7' finnes ikke i pakken."
    },
    {
      "severity": "warning",
      "path": "objects[1].payload.module.title",
      "code": "possible_duplicate_title",
      "message": "En modul med tittelen 'Behandlingsgrunnlag' finnes allerede (id: m_abc123)."
    }
  ],
  "plan": [
    { "op": "create_section", "clientRef": "intro" },
    { "op": "create_module", "clientRef": "module-1" },
    { "op": "create_course", "clientRef": "course-main" },
    { "op": "set_course_items", "clientRef": "course-main" }
  ]
}
```

- `issues[].path` er en JSON-sti inn i pakken (agenten kan reparere presist).
- `code` er stabil og maskinlesbar; `message` er handlingsrettet tekst.
- Zod-issues fra leaf-schemas oversettes 1:1 (`path`-array → punktnotasjon, Zod `code` →
  stabil kode). Domenevalidatorer (`contentValidationService.ts`, f.eks. MCQ-distraktorer)
  gjenbrukes; deres `blocking` → `error`, `warning` → `warning`.
- `plan` returneres i topologisk rekkefølge (seksjoner/moduler før kurs, `set_course_items`
  sist) og er nøyaktig sekvensen skillen skal utføre. Plan genereres kun når `errors == 0`
  ellers utelates den (`plan: []`).
- Duplikat-tittel er **warning**, aldri error — jf. idempotensbeslutningen (§6): vi upserter
  ikke automatisk, men agenten/brukeren skal få vite om mulig dublett.

## 6. Idempotensmodell

Vurderte alternativer:

| # | Modell | Vurdering |
|---|---|---|
| 1 | Ingen idempotens | Agent-retry etter timeout/nettverksfeil dupliserer moduler. Uakseptabelt for maskinell bruk — avvist. |
| 2 | `Idempotency-Key` per create-kall | Trygg retry av *samme* operasjon uten dublett. Krever liten server-tabell. **Valgt.** |
| 3 | `clientRef` i pakken | Identitet kun i plan-/orkestreringfasen; ingen server-persistens. Komplementær, ikke alternativ. **Valgt.** |
| 4 | `externalId`/`sourceSystem`-upsert | Automatisk gjenfinnings-/overskrivingssemantikk. Kan overskrive feil draft og blande eierskap; krever egen konfliktmodell. **Utsatt** — eget issue når behovet er reelt. |

**Beslutning: 2 + 3.**

`Idempotency-Key`-semantikk (innføres på create/import-stiene i AA-2):

- Valgfri request-header på `POST /modules/import`, `POST /sections`, `POST /courses`.
- Unikhet scopet til `(userId, endepunkt, nøkkel)`; server lagrer nøkkel + payload-hash +
  serialisert respons med TTL 24 t.
- Replay med samme nøkkel + samme payload-hash → lagret respons (samme statuskode) uten ny write.
- Samme nøkkel + **annen** payload-hash → `409 { error: "idempotency_key_reuse" }`.
- `PUT .../items` trenger ingen nøkkel (naturlig idempotent — full erstatning av sekvensen).

`clientRef` persisteres **ikke** i DB i MVP. Skillen holder `clientRef → serverId`-mappingen i
sin egen kjøring og rapporterer den til brukeren (og i AA-5-audit). Mulige duplikater flagges
som warnings i validate (§5); eksisterende `mode: "replaceExisting"` + `targetId` på
modul-import dekker eksplisitt oppdatering der det trengs.

## 7. Auth-modell: intern vs. ekstern agent

Vurderte alternativer:

| # | Modell | Vurdering |
|---|---|---|
| 1 | Eksisterende app-auth (mock lokalt, Entra-JWT ellers) | Null ny angrepsflate; dekker repo-lokale agenter fullt ut i dag. **Valgt for MVP.** |
| 2 | Kortlivet agent-authoring-token utstedt av innlogget bruker | Riktig modell for ekstern ChatGPT/Claude → staging/prod: scopet (kun authoring-endepunktene), kort TTL (≤ 60 min), bundet til utstedende bruker (arver eierskap + audit), revokerbar. **Implementert i AA-3 (#651)** — se «AA-3-beslutning» under. |
| 3 | Statisk API-token/PAT | Ingen brukerbinding, lekkasje gir stående admin-innholdstilgang, ikke-revokerbar i praksis. **Avvist.** |
| 4 | OAuth/device-flow | Best UX for tredjeparts-agenter på sikt, men uforholdsmessig tungt nå. **Senere**, bygger evt. oppå 2. |

MVP-konsekvens: en lokal agent kjører mot `npm run dev` med `AUTH_MODE=mock` og
`x-user-roles: SUBJECT_MATTER_OWNER` (mock er allerede hard-blokkert i produksjon). Mot
staging/prod i MVP går agentarbeid via en bruker som selv skaffer Entra-token — ingen ny
mekanisme. Ekstern direktebruk er eksplisitt **utenfor MVP** til AA-3 er landet.

### AA-3-beslutning (implementert, #651 / v1.6.13)

Alternativ 2 er implementert som **Agent Authoring Session**, med multitenant som premiss
(tokens utstedes og verifiseres kun mot installasjonens egen database — aldri på tvers):

- **Utstedelse**: `POST /api/admin/content/agent-authoring/tokens` (`admin_content`-rolle,
  vanlig bruker-auth) → `aat_<48 hex>`-hemmelighet vist **én gang**; kun sha256-hash lagres
  (`AgentAuthoringToken`-tabellen). TTL 5–60 min (default 60). Liste/revokér via
  `GET .../tokens` og `POST .../tokens/:id/revoke` (eier eller ADMINISTRATOR).
- **Bruk**: `Authorization: Bearer aat_...` virker i begge auth-moduser; identitet/roller
  hentes fra utstederens brukerkonto (writes attribueres som brukeren, eierskap #528 arves).
- **Scope**: `enforceAgentTokenScope` (montert rett etter `authenticate`) tillater kun de
  fem draft-operasjonene skillen orkestrerer; alt annet → 403 `agent_token_scope`. Tokens
  kan ikke utstede/revokere tokens. Rutene herder i tillegg: import krever `createNew` +
  `autoPublish: false`, seksjoner krever `draft: true`, items kun på upubliserte kurs —
  ingen publish-kodevei er nåbar med token.
- **Audit**: utstedelse/revokering audit-logges (`agent_authoring_token_issued`/`_revoked`);
  selve writene bærer allerede `source: agent_authoring` + `agentRunId` (AA-5).

## 8. Rollback / partial failure (multi-call-orkestrering)

Prinsipp: **drafts er ufarlige** — draft-only-invarianten (§4) gjør at en avbrutt orkestrering
aldri etterlater deltaker-synlig innhold. Vi bygger derfor *ikke* server-side saga/rollback i
MVP; vi bygger gjenopptakbarhet i skillen:

1. Skillen utfører `plan` i rekkefølge og vedlikeholder `clientRef → serverId`-kartet.
2. Ved feil i steg *n*: stopp, ikke forsøk «kompenserende sletting» automatisk.
3. Rapportér til brukeren: hva som ble opprettet (med admin-URL-er), hva som feilet (med
   API-feilen), og hva som gjenstår.
4. Retry av feilet steg er trygt via `Idempotency-Key` (§6); allerede opprettede objekter
   gjenbrukes via kartet (pakken re-valideres ikke — planen fortsettes).
5. Opprydding er en **menneskelig beslutning**: forkastede drafts arkiveres + slettes i
   admin-UI (G4 tillater delete fra arkivert tilstand; ferske drafts uten avhengigheter kan
   alltid arkiveres). Skillen kan tilby å gjøre dette på forespørsel, aldri automatisk.

Begrunnelse for «ingen auto-cleanup»: delvis opprettet innhold representerer ofte reelt
arbeid (LLM-generert innhold brukeren vil beholde), og automatisk sletting ved transient feil
er verre enn hengende drafts. AA-5 (#653) legger strukturert audit/observability på hele
kjeden (pakke-hash, `constraints`, opprettede ID-er, feilsteg), slik at partial failures er
sporbare i ettertid.

## 9. Skillens execution-plan (eksempel, ende til ende)

Bruker: «Lag et kurs fra denne samtalen med 1 seksjon og 1 fritekstmodul.»

1. Skillen bygger `a2-authoring-package/v1` fra samtalekonteksten.
2. `POST .../agent-authoring/validate` → `valid: true`, plan med 4 steg.
3. `POST .../sections` `{ title, bodyMarkdown, draft: true }` + `Idempotency-Key: pkg7-intro`
   → `201 { section: { id: "s_1" }, adminUrl: "/admin-content/sections?id=s_1" }`.
4. `POST .../modules/import` (syntetisert modul-konvolutt, `autoPublish: false`) +
   `Idempotency-Key: pkg7-module-1` → `201 { moduleId: "m_1", moduleVersionId: "mv_1",
   adminUrl: "/admin-content/module/m_1/conversation" }`.
5. `POST .../courses` `{ title, ... }` + `Idempotency-Key: pkg7-course-main`
   → `201 { course: { id: "c_1" }, adminUrl: "/admin-content/courses/c_1" }`.
6. `PUT .../courses/c_1/items` `{ items: [ { type: "SECTION", sectionId: "s_1" },
   { type: "MODULE", moduleId: "m_1" } ] }` → `204`.
7. Skillen svarer brukeren med de tre admin-URL-ene og eksplisitt beskjed:
   «Alt er opprettet som utkast — gjennomgå og publiser manuelt i admin-UI.»

## 10. MVP vs. utsatt

**MVP (AA-1 + AA-2):**
- `validate`-endepunkt med rapport + plan (#649).
- `draft: true` på section-create; `clientRef`-ekko, `adminUrl` og `Idempotency-Key` på
  create/import-responsene (#650).
- Skill (repo-canonical + installerbar for Claude og ChatGPT/Codex) som orkestrerer §9 (#652).
- Auth: eksisterende modell (§7 alt. 1).

**Utsatt (egne issues, allerede i epicen):**
- Kortlivet agent-authoring-token — AA-3 (#651), *blokkerende for ekstern agentbruk*.
- Audit/observability/partial-failure-rapportering — AA-5 (#653).
- Docs/API-referanse/e2e- og kontraktstester — AA-6 (#654), men API_REFERENCE oppdateres
  løpende per endepunkt-PR (standing order).

**Utsatt (utenfor epicen, bevisste ikke-mål):**
- `externalId`/`sourceSystem`-basert upsert (§6 alt. 4).
- Composite `execute`-endepunkt (§3).
- Assets/media i seksjoner (export-formatet er markdown-only i dag; authoring arver det).
- Enhver form for auto-publisering — permanent ikke-mål, ikke bare utsatt.

## 11. Eksisterende API-er notatet bygger på

- Modul: `POST /api/admin/content/modules` (+ versjonskjeden) og
  `POST /api/admin/content/modules/import` (`importBodySchema`, `contentImportService.ts`).
- Seksjon: `POST /api/admin/content/sections` (`createSectionSchema`, `sectionCommands.ts`).
- Kurs: `POST /api/admin/content/courses`, `PUT /api/admin/content/courses/:courseId/items`
  (`setCourseItemsBodySchema`).
- Kapabilitet: `admin_content` i `src/config/capabilities.ts` (ADMINISTRATOR + SMO);
  nye authoring-ruter registreres under samme prefiks og kapabilitet.
- Livssyklus og guards: `doc/design/CONTENT_LIFECYCLE.md` (G1–G4, I1–I3).
- Admin-URL-mønstre: `doc/route-map.md`.
