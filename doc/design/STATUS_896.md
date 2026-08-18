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
| §3 Avansert oppløses | ✅ **Ferdig** (v2.19.0) — siden er slettet, rutene redirigerer |
| §4 Lagringsmodell | ✅ **Ferdig** (#906 lukket 2026-08-18) — komponert lagring i én transaksjon, festet av `module-version-composer-atomicity.test.ts`. `ensure`-kallet står bevisst utenfor: det kan kalle LLM-en, og det er idempotent |
| §5 Publiseringsgate | ✅ Ferdig |
| §6 Utkastversjoner | ✅ **Ferdig** (#926 lukket 2026-08-18, v2.19.1) — samtalen foreslår i stedet for å overskrive, og fanen merkes ved asynkrone endringer |
| §7 Språk | ✅ Ferdig — UI-språk og innholdsspråk skilt (v2.18.12) |
| §8 Faneadferd | ✅ Ferdig |
| §9 Eksport/import | ✅ Ferdig |
| §11 Ferdig-kriterier | ✅ **Ferdig** (#927, v2.19.2) — ny-modul-e2e-en følger hele reisen |

**Restansen er tom. #906, #926 og #927 er lukket 2026-08-18, og #896 er ferdig etter sin egen
spesifikasjon.**

**Merk fra oppryddingen:** CI på `dev` hadde vært rød siden S3c ble merget 17. august — 21 tester
i 8 filer, alle pekende på filer S3c slettet. Grunnen til at det gikk upåaktet hen er at
QA-porten før deploy kjører `lint` + `test:unit` + `test:dom`, mens kontraktfilene bare lå i den
fulle `npm test`-kjøringen. De ni statiske kontraktfilene er nå med i `test:unit` (v2.19.1).

Saker som ble funnet under epicen men hører til nabokode, og som IKKE blokkerer lukking: #914
(engelske valideringsmeldinger), #915 (falsk kriteriedrift), #916 (seksjonseksport), #917 (markdown
i fritekstfelt), #918 (tittel-lokalisering i samtaleflyten), #919 (drift-dialogens språkfletting),
#920 (§7-vakt i Rediger ved språkbytte).

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

## §3 · Avansert oppløses — ferdig (v2.19.0)

Siden er slettet, og alle dublettene med den. 8 505 linjer: `admin-content.js`,
`admin-content-advanced.html`, begge handoff-modulene, hjelpeteksten og 1 309 oversettelser
ingenting kunne nå. Rutene svarer som permanente redirects inn i arbeidsflaten, siden de ligger i
bokmerker.

**Etterslep, ryddet 2026-08-18 (v2.19.1).** Slettingen etterlot mer enn ventet, og det ble ikke
oppdaget fordi CI var rød i et døgn uten at noen så det:

| Rest | Hva den var |
|---|---|
| «Åpne avansert redigering» | Synlig knapp i Innstillinger uten klikkhåndterer, med en setning over seg om at feltene «flyttes hit i neste leveranse» — usant siden v2.18.8 |
| `editAdvanced`, `openEditor`, `directEdit`, `pickAnother` | Handlingsnøkler modellene produserte, men som handlingskartet ikke lenger kjente. Filtrert bort i det stille |
| `.advanced-link` | CSS uten et eneste element |
| `adminContent.help.moduleOverview` / `.importOverview` | nb/nn-oversettelser uten en-GB-baseline |
| 21 tester i 8 filer | Leste filer som ikke finnes |

Lærdommen er verdt å skrive ned: QA-porten før deploy kjører `lint` + `test:unit` + `test:dom`,
mens kontraktfilene bare lå i den fulle `npm test`-kjøringen som krever Postgres. **En kontrakt som
bare kan brytes et sted man ikke ser, er ikke en kontrakt.** De ni statiske kontraktfilene er nå
med i `test:unit`.

---

## §6 · Konflikt mellom samtale og felt — ferdig (v2.19.1)

Versjonsdelen var ferdig fra før (S5: liste + gjenopprett, append-only). Sesjonsdelen kom i #926:

- **«Samtalen foreslår — den overskriver aldri.»** Alle fire genereringsstiene går gjennom
  `commitOrProposeGenerated`. Rent skjema → landes som før. Skittent skjema → parkeres i
  samtaleloggen med «Bruk»/«Forkast», og utkastet røres ikke.
- **Fanemerking.** `markTabAttention("settings")` når kriterier lander asynkront i en fane
  forfatteren ikke ser på. Dobbelt kodet: prikk, `aria-label`-suffiks og live-region-melding.
  Fjernes idet fanen åpnes.

Funnet underveis og rettet i samme runde: `populateSessionDraftCriteriaInBackground` kalte
`renderPreview()` ubetinget før den startet, og rev dermed et åpent Rediger-skjema. Samme klasse
som §6 selv — innhold som endrer seg uten at forfatteren ba om det.

---

## §11 · Ferdig-kriterier

| Krav | Status |
|---|---|
| `admin-content-ui-contracts.test.js` skrevet om | ✅ refererer ikke lenger `previewEditConfirm` |
| #892 landet først | ✅ |
| Tittel-eierskap koordinert med #894 | ✅ |
| **E2E for begge flyter: ny modul og rediger eksisterende** | ✅ **Ferdig** (#927, v2.19.2) — «ny modul» følger nå hele reisen: opprett i samtalen → åpne Innstillinger mens kriteriene genereres → rediger, legg til, fjern → tilbake til Rediger → lagre, og lagringspayloaden bærer nøyaktig forfatterens kriterier |

---

## Gjennomført

| Bolk | Levert |
|---|---|
| Kriterieeditor → Innstillinger | v2.18.6 — deler kode med Rediger |
| Vurderingsinstruks → Innstillinger | v2.18.7 |
| Innsendingsskjema → Innstillinger | v2.18.8 |
| Skaleringsregel (praktisk vekt) | v2.18.8 |
| Full `assessmentPolicy` redigerbar | v2.18.9 |
| Innstillinger omorganisert i fire blokker | v2.18.10 |
| UI-språk skilt fra innholdsspråk | v2.18.12 |
| Rediger-fanen redigerbar fra man åpner den | v2.18.13 |
| S3c: Avansert fjernet, høyresiden lagt om | v2.19.0 |
| §4 atomisitet festet · §6 forslag og fanemerking · opprydding | v2.19.1 |
| §11 ny-modul-e2e | v2.19.2 |

**Vurdering (2026-08-18):** epicen er ferdig etter sin egen spesifikasjon. Den gikk fra «ny flate
finnes ved siden av den gamle» via «den gamle kan fjernes» til «den gamle er borte, og restene
etter den også».

Det som gjenstår er ikke #896, men naboarbeid registrert underveis: se listen over åpne saker
øverst, og #925 (Seksjoner etter samme mønster), som produkteier selv har bedt om å ikke starte
før dette er lukket.

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
