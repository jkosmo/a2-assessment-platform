# Incident: worker-rollen crashet ved oppstart (2026-07-18)

## Sammendrag
Etter prod-deploy av **1.6.33** (kurs-påminnelser, #497) klarte ikke **worker-rollen** å starte.
Web-appen var upåvirket hele tiden (frisk `/healthz`, brukere merket ingenting). Worker var nede
**~17:16–18:34 UTC (~75 min)** til den ble manuelt restartet — da kom den opp på nytt forsøk.

## Tidslinje (UTC)
- **17:14** — prod-deploy av 1.6.33 (code-only) trigget; worker-container starter på nytt.
- **17:16–18:07** — warmup-probe pinger; containeren blir aldri klar.
- **18:10** — `unhandled_rejection`: `AppealSlaMonitor.tick` → `prisma.appeal.findMany()` →
  «Timed out fetching a new connection from the connection pool (limit 10, timeout 20s)».
- **18:12** — `prisma.assessmentJob.findMany()` → «Can't reach database server …:5432».
- **18:15** — `Bus error (core dumped)` → container exit **135** → `ContainerTimeout` (600s) → Azure
  stopper worker-siten (auto-startet **ikke** på nytt).
- **~18:20** — «runtime errors»-e-post mottatt; diagnose startet.
- **18:31** — manuell `az webapp restart` av worker.
- **18:34** — «Site startup probe succeeded» + «workers started [role=worker]» → stabil.

## Rotårsak
Ved oppstart fyrte alle seks bakgrunns-monitorene (assessment-worker, appeal-SLA, pseudonymisering,
audit-retention, entra-synk, **+ ny kurs-påminnelses-monitor**) sin **første DB-spørring samtidig**.
Mot en **burstable Postgres** med **Prisma-pool på 10** ga dette en tilkoblings-storm: spørringer fikk
ikke tilkobling i tide, én propagerte som unhandled rejection, og under presset crashet Prisma-engine
med `Bus error` (SIGBUS). 1.6.33 la til én monitor til, som tippet en allerede skjør oppstart over.

Samme image startet fint ved restart → **ikke en deterministisk bug**, men en transient oppstartsstorm.

## Overvåkings-gap (viktigste lærdom)
Worker var nede i 75 min uten at vi visste det. Den eksterne tilgjengelighetstesten pinget kun
**web-appens** `/healthz` — som var frisk. Worker-rollen hadde **ingen ekstern overvåking**, så et
worker-havari var i praksis usynlig til noen tilfeldigvis fikk en e-post.

## Tiltak
1. **Herding (1.6.35, #769):**
   - `src/index.ts` sprer nå monitor-oppstarten (`WORKER_STARTUP_STAGGER_MS`, default 3000 ms) så
     første ticks ikke treffer DB samtidig.
   - `AppealSlaMonitor`, `PseudonymizationMonitor`, `AuditRetentionMonitor` fikk `catch` i `tick()`
     (en feilende tick logges nå i stedet for å bli en unhandled rejection).
2. **Overvåking (denne PR):** ekstern availability-test + alert på **worker-rollens** `/healthz`
   (`infra/azure/main.bicep`, speiler web-appens), så en worker-outage pager samme action group.

## Restlæring / oppfølging
- **DB-kapasitet:** burstable Postgres + Prisma-pool 10 er grunn-skjørheten. Herdingen fjerner
  *triggeren*, men vurder å heve pool/DB-takhøyde eller overvåke connection-metning under last.
- **SIGBUS:** exit 135 er en native Prisma-engine-crash under press; verdt å følge med på om det
  gjentar seg selv med spredt oppstart.

## Gjenoppretting hvis det skjer igjen
1. Bekreft web vs. worker: `/healthz`-availability på web grønn, men worker-alerten fyrer.
2. Verifiser DB er «Ready» (`az postgres flexible-server list`), så `az webapp restart` på worker.
3. Verifiser oppstart i loggene: «workers started [role=worker]», ingen `Bus error`/exit 135.
   (Prod-tenant: `az account set --subscription 5b3f760b-…` først.)
