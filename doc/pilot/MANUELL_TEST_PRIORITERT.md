# Manuell test — det som faktisk krever et menneske

Produkteier, 2026-08-19: *«Releasetest er svært omfattende og vil ta tid å gå gjennom. Vi trenger å
prioritere hvor det er viktigst at jeg gjør manuell test.»*

Riktig innvending. Den forrige planen listet alt som *kunne* testes. Denne lister bare det som
**ikke kan automatiseres** — og sier hvorfor for hvert punkt, så du kan overprøve vurderingen.

Alt annet er flyttet til automatiske suiter. Se nederst for hva som nå dekkes maskinelt.

---

## Regelen jeg har sortert etter

Vi har ~200 e2e. De kjører mot **mockede API-er**, og beviser at klienten gjør riktig *gitt en
responsform vi selv har skrevet*.

**De kan derfor aldri fange at antakelsen i mocken er feil.** Ditt eget modultype-funn er beviset:
det finnes en grønn e2e som bytter modultype fram og tilbake, og den er grønn fordi mocken bygger en
modul som har alle komponentene. Din modul hadde ikke det.

Så: **du bør teste der virkeligheten kan avvike fra mocken.** Det er fire ting — ekte data, ekte
LLM, ekte roller, og din egen dømmekraft om hva som er godt nok.

---

## 1 · Kan en SMO fortsatt publisere det som virket i går?

**Hvorfor du:** krever ekte innhold fra prod-lignende data. Ingen mock kan gjenskape hva som faktisk
ligger der.

Publiseringsgaten gjelder nå seksjoner (#916). Innhold skrevet før gaten fantes har ofte tittel på
ett språk.

- [ ] Åpne et **eksisterende** kurs med seksjoner. Prøv å publisere.
- [ ] Blir du blokkert: navngir meldingen felt og språk? Finnes det en vei videre?
- [ ] Virker **«Oversett det som mangler»**, og går publiseringen gjennom etterpå?

> Låses en SMO ute fra innhold som virket i går, uten farbar vei videre, er det **NO-GO for prod**
> uansett hva resten viser. Dette er det ene punktet som alene kan stoppe utrullingen.

## 2 · Deltakeren kan fullføre et kurs og få kursbeviset

**Hvorfor du:** hele reisen på tvers av moduler, seksjoner, vurdering og utstedelse — med ekte
LLM-vurdering i midten. E2e-ene dekker hvert ledd med mock, ingen dekker kjeden med ekte data.

- [ ] Gå gjennom et helt kurs som deltaker. Kursbeviset skal komme.
- [ ] Test særlig et kurs som **slutter med en seksjon** — det var der hullet oppsto.

## 3 · Samtalen foreslår, den overskriver ikke

**Hvorfor du:** krever ekte LLM. Mocken svarer med en fast streng; den kan ikke vise deg om
forslaget er *nyttig*, eller om det traff riktig språk.

- [ ] Skriv i oppgavetekst-feltet uten å lagre. Be om en revisjon i chatten.
      → Teksten din skal stå urørt, og du skal få **«Forslag klart»** med Bruk/Forkast.
- [ ] Samme med **«Endre tittelen til X»** og **«Oversett til nynorsk»**.
- [ ] Skriv på **bokmål**, bytt **menyspråket** til engelsk, be om en revisjon.
      → Den norske teksten skal revideres, ikke oversettes bort. *(Dette var en ekte feil i går.)*

## 4 · Eierskap på tvers av to ekte brukere

**Hvorfor du:** krever to ekte Entra-kontoer. Stage bruker `authMode: entra`, og mock-headere
ignoreres — det kan ikke automatiseres uten ekte innlogging.

- [ ] Som `<PROD_ADMIN_UPN>`: prøv å åpne en seksjon `<STAGING_ADMIN_UPN>` eier. Forventet **403**.
- [ ] Seksjonslista skal ikke vise **Eksporter** på rader du ikke eier.

## 5 · Ser det riktig ut?

**Hvorfor du:** dømmekraft. En test kan si at et element finnes og er synlig, men ikke om det ser
rimelig ut.

- [ ] **Personvernvarselet** på Rediger: luft mellom ⚠️ og overskriften, andrelinja henger inn.
- [ ] **Handlingslinja** blinker ikke som en tom stripe ved innlasting.
- [ ] **Fanemerket** (prikken) på Innstillinger — synlig, og ikke i veien for etiketten.
- [ ] Nynorsk og engelsk: ingen rå `shell.*`-nøkler noe sted.

---

# Det jeg har flyttet til maskinen

Ikke test dette manuelt — det kjøres nå automatisk, og oftere enn du ville orket.

## Ny: `npm run test:stage` — mot **utrullet** stage, ikke mot mock

15 tester som treffer det ekte miljøet. Dette er den halvdelen av forespørselen din som ikke krever
innlogging, og den dekker en klasse ingen mocket e2e kan nå: **at artefaktet som kjører er det vi
tror**.

| Dekker | Hvorfor det ikke kan mockes |
|---|---|
| `/version`, `/healthz` | selve miljøet |
| Begge `/advanced`-rutene 301-er | ruting skjer i Azure, ikke i testserveren |
| Seks endepunkter svarer **401** uten innlogging | #903 oppsto fordi en rute gikk i prod uten vakt |
| Mock-headere gir **ikke** tilgang | ville fanget at noen satte `AUTH_MODE=mock` på stage |
| `authMode: entra`, `debugMode: false` | kjøretidskonfigurasjon, ikke kildekode |
| Utrullet HTML har fanene, mangler `settingsOpenAdvanced` | en feilslått build ser identisk ut i git |
| Layout ligger i **klasser**, ikke inline `style` | begge variantene av `.hidden`-fella var ekte feil |
| i18n-bundlet har nøklene shell-en slår opp | én rå nøkkel nådde brukeren i denne leveransen |
| Shell-en har §6-porten, mangler `translateLocalizedText` | at oppryddingen faktisk er utrullet |

## Fra før: ~200 e2e mot mock

Faneadferd, vakter mot ulagrede endringer, forslagsmekanikken, lokaliseringskontrakten,
kursfokus og lesevisningen, kriterieredigering, publiseringsgatens klientside.

**De er verdifulle, men de tester klienten mot en antakelse.** Der antakelsen er det usikre — ekte
data, ekte roller — står punktet i lista over i stedet.

---

# Kjent, ikke feil — ikke bruk tid på det

| Sak | Hva |
|---|---|
| **#928** | Drift-varselet er ikke synlig i noen fane. Det finnes ikke å finne |
| **#929** | Ingen knapp på siste element; stille lesemarkering er midlertidig |
| **#930** | Gaten navngir feil to språk hvis du jobber på engelsk |
| **#931** | Syv QA-funn som ikke blokkerte |
| **#932** | Vilkåret før prod — SQL-tellingene |
| **#914** | Valideringsmeldinger som ikke er oversettelseshull er engelsk servertekst |
| **#917** | Markdown i modulens fritekstfelt vises som råtekst |

---

# Fortsatt før prod, uavhengig av testingen

**#932** — de tre SQL-spørringene mot prod. Den ene har et vindu som lukker seg: tell
`DiscussionThread` med `courseItemId IS NOT NULL` **før** noen SMO lagrer et kurs, ellers er tallet
ikke sant lenger.
