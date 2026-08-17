# #896 — status mot kravspesifikasjonen

Gjennomgang 2026-08-16, verifisert mot kode i `dev` (v2.18.5), ikke mot hukommelse eller
commit-meldinger. Bakgrunnen er en riktig observasjon fra produkteier: rapportering slice for
slice sier lite om hvor mye av *helheten* som gjenstår.

## Kortversjonen

**Oppdatert 2026-08-16 (v2.18.8): §2 er nå ferdig.** Alle åtte feltene i Innstillinger er
redigerbare. Dermed er §3 — å fjerne Avansert-siden — ikke lenger blokkert av manglende
funksjonalitet; det som gjenstår der er sletting og opprydding.

Opprinnelig funn: Innstillinger hadde 5 av 8 redigerbare felt, og de tre som manglet var hele
underredigerere (kriterier, vurderingsinstruks, innsendingsskjema). Alle tre er flyttet, og
kriterieeditoren og instruksen deler nå kode med Rediger i stedet for å være en andre kopi.

| Del | Status |
|---|---|
| §1 Tre faner | ✅ Ferdig |
| §2 Feltkart | ✅ Ferdig — Innstillinger 8 av 8 |
| §3 Avansert oppløses | ⚠️ Ikke lenger blokkert. Gjenstår: fjerne dubletter, handoff, kalibreringsfane, identitetspanel |
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

### Innstillinger (oppsett) — 8 av 8

| Felt | Spesifisert | Faktisk i dag |
|---|---|---|
| Modultype | redigerbar, øverst | ✅ `settingsModuleType` |
| Terskler / poengregler | redigerbar | ✅ alle fire: `mcqMinPercent`, `totalMin`, `practicalMinPercent`, `borderlineWindow` (v2.18.9). Tomt felt = ingen overstyring |
| Gyldighet | redigerbar | ✅ `settingsValidFrom` / `settingsValidTo` |
| Sertifiseringsnivå | redigerbar | ✅ `settingsCertLevel` |
| **Vurderingskriterier (rubrikk)** | **redigerbar** | ✅ **flyttet hit** (v2.18.6), og **bare hit** (v2.18.10 — editoren i Rediger og sammendragsraden er borte). Alltid utvidet; lagres som inline rubrikk |
| **Vurderingsinstruks (prompt)** | **redigerbar** | ✅ **flyttet hit** (v2.18.7). Ett språk om gangen, de andre flettes |
| **Innsendingsskjema** | **redigerbar** | ✅ **flyttet hit** (v2.18.8). Første felt redigerbart (#901); øvrige bæres uendret |
| **Skaleringsregel** | redigerbar | ✅ **praktisk vekt** flyttet hit (v2.18.8). `max_total` utledes av kriteriene og har bevisst ingen egen input |

De tre editorene var de tyngste i hele Avansert-siden. Kriterieeditoren og vurderingsinstruksen
**deler nå kode** med Rediger (`wireCriteriaEditor`, `buildEditorStateFromCriteriaRecord`,
`mergeLocaleInto`) i stedet for å være en andre kopi — å bygge nye editorer ved siden av de gamle
ville løst symptomet og lagt til problemet.

**Omlegging v2.18.10.** Å flytte tre editorer hit gjorde §2 komplett, men panelet ble en haug: elleve
rader og tre editorer uten nivåer, og kriteriene fantes fire steder fordi flyttingen bare var gjort
halvveis — editoren ble lagt til i Innstillinger uten å bli fjernet fra Rediger. Panelet er nå fire
blokker (**Modulen · Vurdering · Innsendingsskjema · Lagrede versjoner**) med én overskrift hver,
kriteriene ligger ett sted og står alltid åpne, og Lagre er flyttet til etter alle innstillingene og
før historikken. En e2e fester rekkefølgen og at kriterie-overskriften finnes nøyaktig én gang.

**Rettelse etter QA 2026-08-16:** en tidligere versjon av dette dokumentet påsto «8 av 8» mens
tabellen samtidig innrømmet at bare `mcqMinPercent` var redigerbar. Det var en overdrivelse.
De øvrige tre poengreglene kom i v2.18.9; først da ble påstanden sann.

---

## §3 · Avansert oppløses — ikke lenger blokkert

Avansert-siden serverer fortsatt alt. Det som per spesifikasjon skal bort derfra:

| Funksjon | Nytt sted | Status |
|---|---|---|
| Kriterier, vurderingsinstruks, innsendingsskjema | Innstillinger | ✅ flyttet (dubletten i Avansert består) |
| Modultype, terskler, gyldighet, sertifiseringsnivå | Innstillinger | ✅ flyttet (dubletten i Avansert består) |
| Beskrivelse | Rediger | ✅ flyttet (dubletten består) |
| Eksport / import | Rediger | ✅ flyttet (dubletten består) |
| Opprett / dupliser / slett modul | Modul-lista | ❌ `duplicateModule`, `deleteModule` ligger fortsatt i Avansert |
| Kalibrering-fane | egen side finnes | ❌ dubletten `tabKalibrering` består |
| Identitetspanel (mock-bruker) | utviklerverktøy | ❌ `mock-identity-panel` ligger i forfatterflaten |
| `writeHandoff` / `openAdvancedEditor` | fjernes | ❌ 5 forekomster igjen |

**Rekkefølgen var tvungen, og forutsetningen er nå oppfylt.** Alt forfatteren trenger finnes i den
nye flaten, så det som gjenstår er sletting: dublettene, handoff-mekanikken, kalibreringsdubletten
og identitetspanelet. Det er den siste store bolken i epicen.

Merk at dublettene er en **mellomtilstand, ikke en feil** — men den betyr at samme handling finnes
to steder. Rapporter det hvis de to gir ulikt resultat.

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
| ~~Kriterieeditor → Innstillinger~~ | ~~Stor~~ | ✅ v2.18.6 — deler kode med Rediger |
| ~~Vurderingsinstruks → Innstillinger~~ | ~~Middels~~ | ✅ v2.18.7 |
| ~~Innsendingsskjema → Innstillinger~~ | ~~Middels~~ | ✅ v2.18.8 |
| ~~Skaleringsregel → Innstillinger~~ | ~~Liten~~ | ✅ v2.18.8 (praktisk vekt) |
| ~~Full `assessmentPolicy` redigerbar~~ | ~~Liten~~ | ✅ v2.18.9 |
| **S3c: fjern Avansert** | **Middels** | Ren sletting nå — men berører ruter, handoff, modul-lista og e2e-er som navigerer dit |
| §6 forslag- og fanemerking | Middels | Samtalen skal foreslå, ikke overskrive; fanemerking ved asynkrone endringer |
| E2E «ny modul» ende-til-ende | Liten | |

**Vurdering (oppdatert 2026-08-16):** §2 er i havn. Det som gjenstår er **to bolker** — å fjerne
Avansert, og §6-konflikthåndteringen — pluss én e2e. Epicen har flyttet seg fra «ny flate finnes
ved siden av den gamle» til «den gamle kan fjernes».

---

## Kjente avvik som ikke er del av dette

Registrert underveis, med egne saker: **#918** (samtaleflyten fyller alle tre språk med kildetittelen,
så publiseringsgaten tror den er oversatt — #892-flaten), **#901** (flerfelts innsendingsskjema), **#903**
(kurs-eierskap — akseptert og dokumentert), **#910** (Avansert-fallback), **#914** (engelske
valideringsmeldinger), **#915** (falsk kriteriedrift ved gjenoppretting). **#902**, **#905**,
**#906**, **#912** og **#913** er løst.

**#902 ble løst i v2.18.10**, ikke fordi den sto for tur, men fordi omleggingen gjorde
kriterieeditoren til det eneste stedet kriterier redigeres — og alltid åpen. Å redigere ett språk
skrev tilbake en ren streng og slettet de to andre; eksponeringen gikk opp, ikke ned. Se
`doc/FEATURE_SURFACE_MAP.md` punkt 21 for regelen og fella i `captureLatestCriteriaState`.
