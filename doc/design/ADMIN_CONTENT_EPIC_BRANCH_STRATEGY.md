# Admin Content Epic – Branch og Deploy-strategi

**Dato:** 2026-04-15
**Status:** Vedtatt – gjeldende for all implementering av Admin Content-epicen

---

## Kontekst

Epicen er **#293 – Conversational Admin Content workspace with preview and chatbot**.

Den erstatter ikke dagens editor umiddelbart, men legger et konversasjonelt shell over eksisterende admin-kommandoer.
Endringen berører frontend-arkitektur, LLM-orkestrering, preview-state og sikkerhet rundt destruktive handlinger.

Sub-issues:

| Issue | Tittel | Type |
|-------|--------|------|
| #294 | Design: conversational shell, safety model, rollout plan | Design (prereq) |
| #295 | Build Admin Content shell: preview + chat pane + module picker | Frontend |
| #296 | Conversational source-material intake og LLM draft creation | Frontend + LLM |
| #297 | Conversational edit/apply loop med live preview-oppdatering | Frontend + LLM |
| #298 | Safe conversational CRUD, duplicate og publish | Frontend + backend |
| #299 | Testing, dokumentasjon og rollout-kriterier | Test + docs |

**#294 er en hard prereq** – ingen implementasjons-PR til epic-branchen åpnes før design er godkjent.

Sporene har bredt blast-radius i frontend, LLM-lag og admin-API, og kan ikke valideres bit for bit i produksjon.
Samlet stage-verifisering er påkrevd før epic-branchen merges til main.

---

## Multi-agent-kontekst

> **VIKTIG FOR ALLE AI-AGENTER (Claude, Codex, GitHub Copilot):**
> Dette prosjektet bytter mellom flere AI-kodingsagenter fortløpende innenfor samme epic.
> Denne filen er den autoritative kilden til branching- og deploy-strategi for Admin Content.
> Alle agenter MÅ følge reglene nedenfor uten å avvike basert på egne antakelser.

---

## Branching-modell

```
main
 └── epic/admin-content-redesign        ← lang-livet epic-branch
       ├── slice/135-H-dialog-infra      → PR inn i epic-branch
       ├── slice/135-A-module-details    → PR inn i epic-branch
       ├── slice/135-I-card-view         → PR inn i epic-branch
       └── ...

epic/admin-content-redesign → PR → main   (kun etter stage-verifisering)
```

### Regel 1 – Slice-branches merges inn i epic-branch, ikke main

Alle PRs for sub-issues under #135, #94, og #95 skal:
1. Branche ut fra `epic/admin-content-redesign`
2. Merges inn i `epic/admin-content-redesign` – ikke i `main`

### Regel 2 – Uavhengige issues går direkte til main

Issues som ikke tilhører #293-epicen følger normal workflow:
- Branch ut fra `main`
- PR inn i `main`
- Normal batched deploy til staging

### Regel 3 – Rebase epic-branch mot main ukentlig

Maksimal avvik fra main: **7 dager**.

```bash
git fetch origin
git rebase origin/main
# Løs eventuelle konflikter
git push --force-with-lease origin epic/admin-content-redesign
```

Dersom en AI-agent er i tvil om branchen er oppdatert, skal den kjøre:
```bash
git log --oneline origin/main..HEAD
git log --oneline HEAD..origin/main
```
og rapportere status til bruker før videre arbeid.

---

## Deploy-strategi

### Staging

Epic-branchen deployes til **staging** når en komplett delivery-slice er ferdig – ikke per sub-issue.

Definerte delivery-slices:

| Slice | Issues | Kan deployes til stage når... |
|-------|--------|-------------------------------|
| Slice 0 – Design | #294 | Designdokument ferdig og godkjent av bruker |
| Slice 1 – Shell | #295 | Slice 0 godkjent, shell med preview + chat bygd, CI grønn |
| Slice 2 – Draft creation | #296 | Slice 1 stage-verifisert |
| Slice 3 – Edit loop | #297 | Slice 2 stage-verifisert |
| Slice 4 – CRUD/publish | #298 | Slice 3 stage-verifisert |
| Slice 5 – Rollout | #299 | Slice 4 stage-verifisert |

Staging-deploy av epic-branchen skjer ved å opprette en PR fra `epic/admin-content-redesign` mot `main`
og triggere deploy manuelt til staging – **uten å merge PR til main** – eller via en staging-spesifikk branch/pipeline
dersom prosjektet konfigurerer det.

> Alternativt: deployer en midlertidig `staging/admin-content-<dato>`-branch laget fra epic-branchen.
> Konsulter bruker dersom det er uklart hvordan staging-deploy er konfigurert i dette prosjektet.

### Produksjon

Epic-branchen merges **aldri** til `main` uten at:
1. Minst en komplett delivery-slice er stage-verifisert av menneske
2. Alle akseptansekriterier i de relevante issues er sjekket av
3. Brukeren eksplisitt godkjenner merge til main

---

## Arbeidsflyt per slice for AI-agent

```
1. Sjekk at du er på epic/admin-content-redesign (eller branch ut fra den)
2. Implementer sub-issues i rekkefølgen definert i designdokumentet
3. Kjør lokale tester og CI
4. Opprett PR: slice/xxx → epic/admin-content-redesign
5. Merk sub-issue som "ready for review"
6. Når hele slice er ferdig: rapporter til bruker at slice er klar for stage-deploy
7. IKKE merge epic-branch til main – vent på brukers godkjenning etter stage-verifisering
```

---

## Referansedokumenter

| Dokument | Hva det beskriver |
|----------|-------------------|
| GitHub issue #293 | EPIC – overordnet mål, kontekst og realism-vurdering |
| `doc/design/CONVERSATIONAL_ADMIN_CONTENT_DESIGN.md` | Designdokument for epicen (opprettes under #294) |
| [ADMIN_CONTENT_DIALOG_REDESIGN.md](ADMIN_CONTENT_DIALOG_REDESIGN.md) | Ferdig implementert forgjenger (issue #135, lukket) |
| [AI_WORKFLOW.md](AI_WORKFLOW.md) | Generell AI-arbeidsflyt for prosjektet |

---

## Oppsummering – hurtigreferanse for AI-agenter

```
Jobber du med #294, #295, #296, #297, #298, eller #299?
  → Branch ut fra og PR inn i: epic/admin-content-redesign
  → IKKE start #295-#299 før #294 (design) er godkjent

Jobber du med et issue utenfor #293-epicen?
  → Normal workflow: branch ut fra og PR inn i: main

Skal du deploye?
  → Kun til staging, kun når en komplett slice er ferdig
  → Aldri til produksjon uten eksplisitt godkjenning fra bruker

Er epic-branchen mer enn 7 dager gammel?
  → Rebase mot main før du fortsetter
```
