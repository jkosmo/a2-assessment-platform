# Release 2.22.0 — testplan før produksjon

**Stage kjører 2.22.0.** Dette er testplanen som avgjør om vi tør ta den til prod.

Prod ligger **78 commits** bak. Det er ikke en vanlig ukesleveranse, og listen under er sortert
deretter: **prioritet 1 må bestås**, prioritet 2 bør sjekkes, prioritet 3 kan oppdages senere.

## Det som gjør denne trygg

- **Ingen Prisma-endringer i hele spennet.** `git diff origin/main..dev -- prisma/` er tom. Ingen
  migrasjon, ingen expand/contract-risiko, ingen skjemadrift mellom gamle og nye containere.
- **Ingen slettet data.** #923 skjuler diskusjon per element; API, felt og tråder ligger urørt.
- Automatisk dekning: **1 029 unit**, **6 DOM**, **199 e2e**, **481 integrasjon**, tsc rent.

## Det som gjør den risikabel

- **Tre av leveransene ble laget av parallelle agenter** og har ikke vært gjennom noen QA-runde ved
  siden av sine egne tester. Det er #921–#924 (deltakerflaten), #918/#919/#920
  (lokaliseringskontrakten) og #916 (seksjonseksport).
- **Prod har innhold laget under den gamle kontrakten** — titler kopiert til alle tre språk,
  seksjoner uten språkmerking. Publiseringsgaten gjelder nå også seksjoner.
- **Deltakere kan stå midt i et kurs** når lesevisningen legges om.

---

# Prioritet 1 — må bestås før prod

## 1.1 · Kan en SMO fortsatt publisere det som virket i går?

Dette er den viktigste testen i hele planen. Publiseringsgaten gjelder nå seksjoner (#916), og prod
er full av innhold fra før gaten fantes.

- [ ] Åpne et **eksisterende** kurs med seksjoner laget før i dag. Prøv å publisere det.
- [ ] Blir du **blokkert**, les meldingen: navngir den felt og språk, og finnes det en vei videre?
- [ ] Prøv **«Oversett det som mangler»** hvis den tilbys, og publiser på nytt.

> ⚠️ Blir en SMO låst ute fra å publisere innhold som fungerte i går, uten en farbar vei videre, er
> det **NO-GO for prod** uansett hva resten av listen viser.

## 1.2 · Deltakeren kan fullføre et kurs

- [ ] Gå gjennom et helt kurs som deltaker: åpne, les seksjoner, ta modul, fullfør.
- [ ] **Kursbeviset skal utstedes.** Test særlig et kurs som **slutter med en seksjon** — det var
      der hullet oppsto.
- [ ] Test også et kurs som slutter med en **modul**.

> Merk: siste seksjon markeres nå lest i det stille når den åpnes. Det er en midlertidig mekanisme
> som erstattes av «Avslutt kurset» i **#929**. Her tester du bare at beviset kommer.

## 1.3 · Ingen blindveier i lesevisningen

- [ ] Åpne et kurs → lista viker → **«← Alle kurs»** finnes og virker.
- [ ] **Nettleserens tilbakeknapp** gjør det samme.
- [ ] Åpne siste seksjon mens noe **annet gjenstår**. Får du vite hva som mangler, eller står du
      bare uten knapp? (Sistnevnte er kjent og dekkes av #929 — noter hvor ille det er.)

## 1.4 · Forfatteren mister ikke arbeid

- [ ] Skriv i oppgavetekst-feltet i Rediger uten å lagre. Be om en revisjon i chatten.
      → Teksten din skal stå **urørt**, og du skal få **«Forslag klart»** med Bruk/Forkast.
- [ ] Samme med **«Endre tittelen til X»** og **«Oversett til nynorsk»**. Begge skal foreslå, ikke
      overskrive. (Disse to var hullene QA fant i går.)
- [ ] Bytt **språk** med usparte endringer, i begge velgerne. Begge skal spørre først.
- [ ] Gjør det samme med et **urørt** skjema: ingenting skal spørres, og revisjonen skal lande rett
      inn. En vakt som alltid spør blir klikket bort.

---

# Prioritet 2 — bør sjekkes

## 2.1 · Seksjonsportabilitet (#916, helt ny funksjon)

- [ ] **Innholdsforvaltning → Seksjoner**: **Eksporter** på en rad du eier.
- [ ] Rader du **ikke** eier skal ikke ha knappen.
- [ ] **Importer seksjons-pakke** i sidehodet — importer fila du nettopp lastet ned.
- [ ] Den lander som **Utkast**, aldri publisert.
- [ ] Har seksjonen **figurer**, skal de følge med.
- [ ] Skriv en ny seksjon på **bare norsk** og lagre. Lagringen skal **gå gjennom** (som utkast) —
      for en seksjon er lagring publisering, så å avvise den ville gjort det umulig å skrive på ett
      språk om gangen.

## 2.2 · Arbeidsflaten etter opprydding

- [ ] **Ingen vei tilbake til Avansert** noe sted i UI-et.
- [ ] **Personvernvarselet** på Rediger: luft mellom ⚠️ og overskriften, og andrelinja henger inn
      under teksten — ikke under ikonet.
- [ ] **Fanemerking**: opprett ny modul, bli stående på Rediger mens kriteriene genereres.
      Innstillinger skal få en prikk, som forsvinner når du åpner fanen.

## 2.3 · Diskusjon kun på kursnivå (#923)

- [ ] Ingen diskusjonsboks i seksjonsleseren.
- [ ] Ingen avkrysning per element i kurseditoren.
- [ ] **Kursnivå-diskusjonen virker fortsatt** — opprett en tråd, svar på den.

> ⚠️ **Før prod-utrulling:** tell tråder med `courseItemId` i prod-databasen. Ingenting er slettet,
> men du sa du ville verifisere at funksjonen ikke er i aktivt bruk før den skjules.

---

# Prioritet 3 — greit å oppdage senere

- [ ] Alle punktene over på **nynorsk** og **engelsk**. Ingen rå `shell.*`-nøkler.
- [ ] Prikken på fanen ved **smal skjerm** (320–480 px) og **200 % zoom** — tar den borti etiketten?
- [ ] Eksport/import av **modul** (uendret av denne leveransen, men den deler kode med #916).

---

# Kjent, og ikke feil

| Sak | Hva |
|---|---|
| **#928** | Drift-varselet er ikke synlig i noen fane. **Ikke test det** — det finnes ikke å finne |
| **#929** | Ingen knapp på siste element; stille lesemarkering er midlertidig |
| **#930** | Publiseringsgaten navngir feil to språk hvis du jobber på engelsk. Den blokkerer riktig, men peker på feil språk |
| **#914** | Valideringsmeldinger som ikke er oversettelseshull er engelsk servertekst |
| **#917** | Markdown i modulens fritekstfelt vises som råtekst |
| **#903** | Kurseksport mangler eierskapssjekk — utsatt som ikke kritisk |

## Kjent flak i testsuiten

`test/assessment-policy.integration.test.ts` feiler på timeout når hele suiten kjøres samlet, og
består **11/11 isolert**. Området er urørt av leveransen (`git diff origin/main..dev` er tom for
`src/modules/assessment/`). Samme mønster som unit-suitens timeouts etter en Playwright-kjøring —
det er last, ikke logikk.

---

# Verifisert automatisk mot stage — trenger ikke manuell test

| Sjekk | Resultat |
|---|---|
| `/admin-content/module/:id/advanced` | 301 → `…/conversation` |
| `/admin-content/advanced` | 301 → `/admin-content` |
| `GET /api/admin/content/sections/:id/export-package` uten auth | 401 |
| `POST /api/admin/content/sections/import` uten auth | 401 |
| `.privacy-notice`-klassen i utrullet HTML | til stede |
| `settingsOpenAdvanced` i utrullet HTML | borte |
| `/version` · `/healthz` | 2.22.0 · ok |
