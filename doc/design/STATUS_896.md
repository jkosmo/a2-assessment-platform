# #896 — status mot kravspesifikasjonen

Gjennomgang 2026-08-16, verifisert mot kode i `dev` (v2.18.5), ikke mot hukommelse eller
commit-meldinger. Bakgrunnen er en riktig observasjon fra produkteier: rapportering slice for
slice sier lite om hvor mye av *helheten* som gjenstår.

## Kortversjonen

**Alt som handler om datamodell, lagring og publisering er ferdig. Det som gjenstår er nesten
utelukkende UI — og det er den største enkeltbolken i hele epicen.**

Konkret: Innstillinger-fanen viser i dag **8 rader**, hvorav **5 er redigerbare**. Spesifikasjonen
krever **8 redigerbare**. De tre som mangler — kriterieeditoren, vurderingsinstruksen og
innsendingsskjemaet — er ikke småfelter, de er hele underredigerere. Så lenge de bare finnes i
Avansert, kan ikke Avansert fjernes, og «ett sted å gjøre hver ting» er ikke oppfylt.

| Del | Status |
|---|---|
| §1 Tre faner | ✅ Ferdig |
| §2 Feltkart | ⚠️ Rediger ferdig · Innstillinger 5 av 8 |
| §3 Avansert oppløses | ❌ Ikke startet — blokkert av §2 |
| §4 Lagringsmodell | ✅ Ferdig (inkl. #905, #906) |
| §5 Publiseringsgate | ✅ Ferdig |
| §6 Utkastversjoner | ⚠️ Versjonshistorikk ferdig · konflikthåndtering ikke startet |
| §7 Språk | ✅ Ferdig |
| §8 Faneadferd | ✅ Ferdig |
| §9 Eksport/import | ✅ Ferdig |
| §11 Ferdig-kriterier | ⚠️ 3 av 4 |

---

## §2 · Feltkart — der gapet er

### Rediger (innhold) — ferdig

| Felt | Status |
|---|---|
| Tittel | ✅ redigerbar |
| Beskrivelse | ✅ flyttet hit (S3b) |
| Scenario (`taskText`) | ✅ |
| Forventning (`assessorExpectedContent`) | ✅ |
| Rammer (`candidateTaskConstraints`) | ✅ |
| MCQ-spørsmål | ✅ |
| Eksport / import | ✅ (S6) |

### Innstillinger (oppsett) — 5 av 8

| Felt | Spesifisert | Faktisk i dag |
|---|---|---|
| Modultype | redigerbar, øverst | ✅ `settingsModuleType` |
| Terskler / poengregler | redigerbar | ⚠️ kun `mcqMinPercent`. `totalMin`, `practicalMinPercent` og `borderlineWindow` bæres videre urørt, men kan ikke endres |
| Gyldighet | redigerbar | ✅ `settingsValidFrom` / `settingsValidTo` |
| Sertifiseringsnivå | redigerbar | ✅ `settingsCertLevel` |
| **Vurderingskriterier (rubrikk)** | **redigerbar** | ❌ **kun lesevisning** — editoren finnes bare i Avansert (`editBtn_rubric`) |
| **Vurderingsinstruks (prompt)** | **redigerbar** | ❌ **kun versjonsnummer** — editoren finnes bare i Avansert (`editBtn_prompt`) |
| **Innsendingsskjema** | **redigerbar** | ❌ **kun feltantall** — editoren finnes bare i Avansert (`editBtn_submissionSchema`) |
| **Skaleringsregel** | redigerbar | ❌ **finnes ikke i Innstillinger i det hele tatt** |

De tre editorene er de tyngste i hele Avansert-siden. Kriterieeditoren alene er en
underredigerer med per-kriterium kort, vekting og maks-score.

---

## §3 · Avansert oppløses — ikke startet

Avansert-siden serverer fortsatt alt. Det som per spesifikasjon skal bort derfra:

| Funksjon | Nytt sted | Status |
|---|---|---|
| Kriterier, vurderingsinstruks, innsendingsskjema | Innstillinger | ❌ blokkert av §2 |
| Modultype, terskler, gyldighet, sertifiseringsnivå | Innstillinger | ✅ flyttet (dubletten i Avansert består) |
| Beskrivelse | Rediger | ✅ flyttet (dubletten består) |
| Eksport / import | Rediger | ✅ flyttet (dubletten består) |
| Opprett / dupliser / slett modul | Modul-lista | ❌ `duplicateModule`, `deleteModule` ligger fortsatt i Avansert |
| Kalibrering-fane | egen side finnes | ❌ dubletten `tabKalibrering` består |
| Identitetspanel (mock-bruker) | utviklerverktøy | ❌ `mock-identity-panel` ligger i forfatterflaten |
| `writeHandoff` / `openAdvancedEditor` | fjernes | ❌ 5 forekomster igjen |

**Rekkefølgen er tvungen:** ingenting her kan fjernes før de tre editorene finnes i Innstillinger.
Å fjerne Avansert nå ville tatt fra forfatteren muligheten til å redigere kriterier i det hele
tatt.

---

## §6 · Konflikt mellom samtale og felt — ikke startet

Versjonsdelen er ferdig (S5: liste + gjenopprett, append-only). Sesjonsdelen er ikke:

- **«Samtalen foreslår — den overskriver aldri.»** Når feltene har ulagrede endringer, skal et
  generert resultat lande som et *forslag* med «Bruk» / «Forkast». I dag skriver generering rett
  inn i utkastet.
- **Fanemerking.** Kriterier genereres asynkront og lander i Innstillinger. Fanen skal markeres når
  noe har endret seg i en fane forfatteren ikke ser på. Ingen slik markering finnes.

Dette er mindre enn §2/§3, men det er ekte UI-arbeid.

---

## §11 · Ferdig-kriterier

| Krav | Status |
|---|---|
| `admin-content-ui-contracts.test.js` skrevet om | ✅ refererer ikke lenger `previewEditConfirm` |
| #892 landet først | ✅ |
| Tittel-eierskap koordinert med #894 | ✅ |
| **E2E for begge flyter: ny modul og rediger eksisterende** | ⚠️ «rediger eksisterende» er godt dekket (163 e2e). «Ny modul» ende-til-ende gjennom den nye faneflaten er ikke festet som én sammenhengende test |

---

## Estimat på gjenstående

Grovt, i den rekkefølgen de må gjøres:

| Bolk | Omfang | Merknad |
|---|---|---|
| Kriterieeditor → Innstillinger | **Stor** | Underredigerer, ~150 linjer skal ut av `enterPreviewEditMode` og gjenoppbygges |
| Vurderingsinstruks → Innstillinger | Middels | System-prompt, mal, eksempler |
| Innsendingsskjema → Innstillinger | Middels | Begrenset til ett felt i UI (#901) |
| Skaleringsregel → Innstillinger | Liten | Finnes ikke noe sted i ny flate |
| Full `assessmentPolicy` redigerbar | Liten | 3 felt til ved siden av `mcqMinPercent` |
| **S3c: fjern Avansert** | Middels | Ren sletting når det over er gjort — men berører ruter, handoff og modul-lista |
| §6 forslag- og fanemerking | Middels | |
| E2E «ny modul» ende-til-ende | Liten | |

**Vurdering:** det gjenstår omtrent like mye UI-arbeid som er gjort i S3a+S3b til sammen. Epicen
er ikke i sluttfasen — den er i overgangen fra «ny flate finnes ved siden av den gamle» til «den
gamle kan fjernes».

---

## Kjente avvik som ikke er del av dette

Registrert underveis, med egne saker: **#901** (flerfelts innsendingsskjema), **#902**
(kriterielokalisering), **#903** (kurs-eierskap — akseptert og dokumentert), **#910**
(Avansert-fallback), **#914** (engelske valideringsmeldinger), **#915** (falsk kriteriedrift ved
gjenoppretting). **#905**, **#906**, **#912** og **#913** er løst.
