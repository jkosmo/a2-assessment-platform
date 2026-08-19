# Test- og releasemetodikk

> **Formål.** Fange arbeidsmåten fra release 2.22.x, slik at neste runde ikke må gjenoppdage den.
> Hver teknikk er skrevet med **hva den fanget denne gangen** — ikke som prinsipp, men som bevis.
>
> Dette er en metodikk, ikke en sjekkliste. Sjekklistene er `doc/pilot/*`; de er ferskvare.
> Dette dokumentet skal holde lenger.

---

## 1 · Testtopologien: tre lag, tre forskjellige spørsmål

Vi hadde ett lag. Nå har vi tre, og de svarer på hver sin ting. Å vite hvilket lag som kan svare på
hva er halve tidsbesparelsen.

| Lag | Kommando | Svarer på | Kan IKKE svare på |
|---|---|---|---|
| **Mocket e2e** | `npm run test:e2e:admin-content` | Gjør klienten riktig, gitt en responsform vi selv skrev? | Om formen stemmer med virkeligheten |
| **Utrullet flate** | `npm run test:stage` | Er artefaktet som kjører det vi tror? | Noe som krever innlogging |
| **Reelle data** | `npm run stage:auth` → `npm run test:stage` | Hva finnes der faktisk? | Nettleser-UI, LLM-kvalitet |

**Den viktigste innsikten, fra produkteier:**

> «Gir det verdi for meg å teste der det er eksisterende e2e-tester?»

Ja — men bare der **mocken er antakelsen som testes**. Beviset kom samme dag: det finnes en grønn
e2e som bytter modultype fram og tilbake. Den er grønn fordi mocken bygger en modul som har alle
komponentene. Produkteiers modul hadde ikke det.

**Regel:** en mocket e2e kan aldri fange at mocken er feil. Manuell test og reelle data hører
hjemme nøyaktig der.

---

## 2 · Mutasjonsverifisering — den enkeltteknikken som ga mest

**Reverser fiksen. Se testen bli rød. Sjekk at den ble rød på riktig assertion.**

Ikke «kjør testen og se at den er grønn». En test som er grønn både med og uten fiksen er verre enn
ingen test, fordi den skaper tillit den ikke har fortjent.

Denne runden fanget den:

| Sak | Mutasjon | Signaturen som bekreftet |
|---|---|---|
| #927 kriterier | slo av `syncSettingsCriteriaToDraft` | `["Generert dybde", "Generert klarhet"]` der forfatterens skulle stått — **nøyaktig runde 2-feilen** |
| §6-porten | fjernet én av seks produsenter fra porten | rød på riktig produsent, ikke på en nabo |
| Innholdsspråk | byttet `contentLocale` → `currentLocale` | `en-GB` der `nb` skulle stått |
| Kursimport | droppet `heldBackByTranslationGate` | kurset ble publisert rundt den tomme seksjonen |
| Modultype-melding | gjeninnførte kravlisten | «task text» dukket opp igjen |

**Praktisk:** ta en `.bak`-kopi, muter med et lite skript, kjør, gjenopprett, verifiser med
`git diff --stat` at treet er rent igjen. Skriv i commit-meldingen at du gjorde det.

---

## 3 · Kontrollcasen — testen som avslører at testen din er feil

En test som bekrefter at noe blokkeres må ha en makker som bekrefter at det **riktige slipper
gjennom**. Ellers vet du ikke om du målte regelen din eller en helt annen.

Konkret denne runden: testen «kursimport skal ikke publisere rundt en tilbakeholdt seksjon» var
grønn. Kontrollcasen «et komplett kurs skal fortsatt publiseres» feilet — med
`Cannot publish a course with no modules`.

Pakken min hadde ingen modul. Kurset ble aldri publisert uansett, så blokkertesten bestod **av helt
feil grunn**. Uten kontrollcasen hadde jeg levert en test som aldri kunne feile.

---

## 4 · Vakt mot den tomme beståtte testen

Beslektet, og lettere å gå på: en test som løper gjennom null elementer og rapporterer grønt.

```ts
// Fant vi ingenting å måle, har vi ikke målt noe — og det skal ikke se grønt ut.
expect(checked, "fant ingen seksjoner å sjekke — testen målte ingenting").toBeGreaterThan(0);
expect(blank).toEqual([]);
```

Skjedde denne runden: jeg leste `item.section.id`, feltet heter `sectionId`, løkka fant null
seksjoner, og testen bestod. **Legg alltid inn en nedre grense på hva som ble sjekket** når testen
itererer over data den ikke selv har laget.

---

## 5 · Dekningsvakt slår hardkodet liste

En liste over «alle stedene som må gjøre X» kan per definisjon ikke oppdage stedet ingen tenkte på.

Vi hadde en guard som itererte over fire genereringsprodusenter, med kommentaren «en femte
produsent lagt til uten porten er den sannsynlige regresjonen». **Den femte og sjette fantes
allerede i filen da kommentaren ble skrevet.**

Erstatningen finner kallerne selv:

```ts
// Finn hvert kall til commitSessionDraftPatch, slå opp hvilken funksjon det står i, og krev at
// funksjonen enten ER porten, står i produsentlista, eller er ført opp som begrunnet unntak.
const EXEMPT = { commitOrProposeGenerated: "the gate itself", … };
```

**Mønsteret:** når en regel gjelder «alle kallere av Y», la testen finne kallerne. Unntak skal være
eksplisitte og ha en grunn skrevet ned.

---

## 6 · Mål mot reelle data i stedet for å gjette — men sjekk at du måler det du tror

Spørsmålet «hvor mange forfattere låser den nye gaten ute?» kan ikke besvares av en mock. Det kan
besvares av en lesende test mot stage, på minutter.

**To målefeil jeg gjorde samme dag, begge med alarmerende utslag:**

1. `typeof title === "string"` → rapporterte **47 av 47** seksjoner som ettspråks. `title` er en
   TEKSTKOLONNE; et språkkart lagres som en JSON-streng, så uttrykket er sant for begge former.
   Riktig tall etter parsing: **24 ettspråks, 10 delvis, 11 komplett, 2 identiske kopier.**
2. Feil feltsti → «0 tomme seksjoner» av null sjekkede.

**Regel:** når et tall er urimelig, er målingen mistenkt før virkeligheten. 100 % av noe er nesten
alltid en målefeil.

**Hold suiten lesende.** Stage er der produkteier har innholdet hen faktisk tester med. En suite som
rydder «sitt eget» innhold er én feilslått filtrering unna å rydde noe annet. Trenger du å skrive,
bruk `publish-preview`-varianten av endepunktet — den beregner uten å endre.

---

## 7 · Autentisert testing mot et Entra-miljø

Stage kjører `authMode: entra`; mock-headere ignoreres. To ting som IKKE virker, og hvorfor:

- **Playwright `storageState`** — appen bruker MSAL med `cacheLocation: "sessionStorage"`
  (`public/api-client.js`), og `storageState` fanger cookies + localStorage.
- **Agent-tokens** — hvitelista er skriv-bare (`src/auth/agentTokenScope.ts`): validate, import,
  opprett seksjon/kurs. Ingen GET. De kan ikke lese eksisterende innhold, som er hele poenget.

Det som virker:

```
npm run stage:auth      # åpner ekte nettleser, du logger inn, tokenet hentes fra MSAL-cachen
npm run test:stage      # de autentiserte testene våkner
```

Reservevei hvis MSAL har byttet nøkkelformat: `npm run stage:token -- "eyJ…"` (DevTools →
Application → Session Storage → `secret`-feltet).

**Begge verifiserer tokenet mot `/api/me` før de skriver noe.** Et token med feil audience ville
ellers gitt en suite som feiler uten grunn. Fila er gitignorert og utløper av seg selv — en gammel
fangst kan ikke bli liggende og gi tilgang i det stille. Utløpt sesjon gir **skip med begrunnelse**,
aldri rødt.

---

## 8 · Parallelle agenter — og fella som rammet alle tre

Tre spor kjørte samtidig i hver sin git-worktree. Det virket, og sparte en kveld.

**Del opp etter filgrenser, ikke etter tema.** #918, #919 og #920 hører logisk sammen, men lever
alle i `admin-content-shell.js` — de måtte være ett spor. Deltakerflaten og seksjonsbackenden
delte ingen filer og kunne gå parallelt.

⚠️ **Alle tre worktreene ble opprettet fra feil base** — en fire dager gammel commit uten epicen.
To agenter oppdaget det selv og gjorde `git reset --hard dev`; den tredje rapporterte det, og jeg
rebaset. **Sjekk basen først:**

```
git worktree list          # skal vise samme SHA som dev
git merge-base <gren> dev
```

**Versjonsnummer kolliderer.** Tre spor fikk 2.20.0, 2.21.0, 2.22.0 på forhånd, men rekkefølgen de
blir ferdige i er ikke rekkefølgen du fletter i. Enklest: **renummerer ved fletting**, i den
rekkefølgen de faktisk landes.

**Flett én om gangen, med full testkjøring mellom.** Ikke alle tre og så én kjøring.

---

## 9 · QA-gaten når kryssmodell ikke er tilgjengelig

`scripts/ai-qa.ps1` kjører Codex. Er den utilgjengelig (tom for kreditt denne gangen), kjør **samme
prompt** mot en lokal agent. Prompten ligger i skriptet (`$checklist`) og er verdt å gjenbruke ordrett
— den er finpusset mot repoets faktiske feilklasser.

**Verifiser funnene selv før du handler.** Agenten tok feil om nøyaktig ett punkt denne runden, og
hadde rett om resten — inkludert tre ting jeg selv hadde avfeid.

**Vær oppmerksom på forsinkede underagenter.** En underagent rapporterte åtte timer etter
hovedgjennomgangen, med funn basert på kode som var rettet i mellomtiden. Tre av fire funn var
allerede løst; ett var nytt og ekte. Sjekk alltid mot gjeldende kode før du «retter» noe.

---

## 10 · Dokumentasjon er en feilflate

Ikke en etterpå-oppgave. Denne runden:

- Flatekartet sa **«fire produsenter, én port»** mens koden hadde seks. Guarden speilet dokumentet,
  ikke koden — så begge var enige og begge tok feil.
- Brukerdokumentasjonen instruerte forfattere stegvis inn i en **slettet side**.
- Rutekartet listet en slettet side som **«Canonical»**.
- `smoke-web-runtime.mjs` sjekket en slettet fil. Workflowen er `workflow_dispatch` og hadde aldri
  kjørt, så feilen lå og ventet på den dagen noen kjørte den før en prod-utrulling.
- Konfliktmarkører fra en rebase ble committet inn i flatekartet.

**Regel:** når du sletter en flate, `grep` navnet på tvers av `doc/`, `scripts/` og `.github/` — ikke
bare `src/` og `public/`.

---

## 11 · Deploy og verifisering

- **Verifiser mot `/version`, aldri mot workflow-fargen.** Appen svarte 2.22.2 mens workflowen
  fortsatt sto `in_progress`; motsatt har en grønn workflow servert et ødelagt artefakt før.
- **Sjekk at CI dekker commiten du deployer** — `gh run view <id> --json headSha`.
- **Prefiks statusmeldinger med lokal tid.** Uten det er «deployen er ferdig» ikke etterprøvbart.
- **En rød CI kan stå upåaktet.** CI på `dev` var rød i et døgn fordi QA-porten før deploy kjører
  `lint` + `test:unit` + `test:dom`, mens kontraktfilene lå i den fulle `npm test`-kjøringen som
  krever Postgres. **En kontrakt som bare kan brytes et sted man ikke ser, er ikke en kontrakt** —
  de ni statiske kontraktfilene ligger nå i `test:unit`.

---

## 12 · Kjente flak — ikke jag dem

| Symptom | Sannhet |
|---|---|
| 5 unit-filer timer ut etter en Playwright-kjøring | Består isolert. Last, ikke logikk |
| `assessment-policy.integration` timer ut i full suite | Består 11/11 isolert; området er urørt av leveransen |

**Kjør på nytt isolert før du diagnostiserer.** Og skriv det i rapporten framfor å la noen oppdage
en rød kjøring uten forklaring.

---

## Rekkefølgen, kort

1. Bygg med tester som **kan feile** — verifiser ved mutasjon.
2. `lint` → `test:unit` → `test:dom` → `test:e2e:admin-content` lokalt.
3. Integrasjon mot ekte Postgres når backend er rørt (`npm run test:integration:native`).
4. QA-gaten — kryssmodell eller lokal agent, samme prompt. **Verifiser funnene.**
5. Deploy til stage. Verifiser `/version`.
6. `npm run test:stage` — uautentisert.
7. `npm run stage:auth` → `npm run test:stage` — mål mot reelle data.
8. Manuell test **kun** der mocken er antakelsen: ekte LLM, ekte roller, ekte data, dømmekraft.
9. Prod: tell først (#932-mønsteret), promoter en tagget, stage-verifisert commit.
