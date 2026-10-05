# Design: skillet `a2-authoring-api`, og veien fra presentasjon til kurs (#1079)

> **Status: forslag, 2026-10-05. Ingenting her er besluttet eller bygget.** Produkteier leser og
> bestemmer. Sju valg, hvert med alternativer og en anbefaling. Beslutningene føres i
> `doc/DECISIONS.md` når de er tatt.

## Kort

Skillet har vokst ved at hver feil fikk sin regel. Det har aldri hatt et design. Resultatet er ett
skill som dekker seks oppgaver, med figurreglene i fem filer, historikk i instruksjonene, og ingen
vei for det forfatterne faktisk kommer med: en presentasjon. Da produkteier laget samme kurs i
ChatGPT og i Claude.ai 2026-10-05, fikk begge tre figurer av samme type, ingen av kildens ikoner og
ingen av kortene.

Anbefalingene, i én tabell:

| # | Valg | Anbefaling |
|---|---|---|
| 1 | Ett skill eller flere | **Ett skill å installere, delt i arbeidsganger inni.** «Fra presentasjon» blir en egen arbeidsgang, lest bare når kilden er en presentasjon |
| 2 | Gangen fra presentasjon til kurs | **Sju faste steg.** Skript gjør det som kan regnes ut, modellen gjør det som krever skjønn, forfatteren godkjenner på tre steder |
| 3 | Hvordan modellen får se lysarkene | **Forfatteren laster opp presentasjonen og en PDF av den.** Skriptet leser fila; modellen ser på PDF-en |
| 4 | Hva skillet får levere til plattformen | **Fire innholdsblokker skrevet som vanlig tekst** (utheving, prompt, kort, ikon), som også kan leses uten plattformen. Bilder krympes av plattformen |
| 5 | Hva som står hvor i skillet | **Hovedfila er en oversikt på under 200 linjer.** Hver regel står ett sted. Ferdige eksempler. Historikken flyttes til repoet |
| 6 | Personopplysninger og rettigheter | **Et bilde fra kilden tas aldri med stilltiende.** Standard er å la det være ute; forfatteren må si ja for hvert |
| 7 | Hvordan vi måler | **De tre testtilfellene, etter hver endring som betyr noe**, i begge produktene. Et tall som går ned, krever en forklaring |

Bærende prinsipper, begge fra produkteier tidligere:

- **Standardveien, ikke taket.** Skillet beskrives etter hva det lager når ingen ber om noe
  spesielt. Grenser er sikkerhetsnett.
- **Ikke kod forfatterdialogen.** I skillet står det plattformen leser eller håndhever, og det som
  er skjørt. Resten hører til samtalen mellom forfatteren og modellen.

Det andre prinsippet er grunnen til at skillet bør bli *kortere*, ikke lengre: mye av det som står
der i dag, forteller modellen hvordan den skal føre en samtale den fint klarer selv.

---

## Hva vi vet

**Skillet i dag** (`skills/a2-authoring-api/`, 2.82.2): én hovedfil på 289 linjer med ti
nummererte regler og seks porter, sju referansefiler på til sammen 1400 linjer, elleve skript i
Node. Portene er: kilde → læringsmål → struktur → hvert element → uavhengig kontroll → produksjon.

**Målt mot Anthropics råd for skills** (kilder og detaljer i #1079, kommentar 2026-10-05):

- Ingen testtilfeller fantes. De finnes nå: `skills/a2-authoring-api-evals/`.
- Styringen er omvendt av rådet: figurvalget, som krever skjønn, er låst til fire maler. Lesing av
  kilden, som er mekanisk, har verken skript eller fast framgangsmåte.
- Hovedfila er ikke en oversikt. Regel 7 og 9 er avsnitt på 19 og 25 linjer med rundt ti
  instruksjoner hver, som referansefilene gjentar.
- Samme regel står flere steder (figurer: fem filer). En endring må gjøres fem ganger, og en gammel
  kopi fortsetter å styre.
- Historikk, datoer og saksnumre står i instruksjonene. Fire kommandoer peker på stier som ikke
  finnes i pakka.
- Ett ferdig eksempel finnes (flyt med faser). Det er blitt malen for alt.

**De tre presentasjonene** (testtilfellene) viser fire slags innhold skillet ikke har noe svar på:

| Hva | Hvor | Hvorfor det er vanskelig |
|---|---|---|
| Kort, uthevede striper, ikonrader | Rapportskriving, 9 lysark | Plattformen har ikke noe å legge dem i |
| Prompter som står i skjermbilder | Møtearbeid, 5 lysark | Teksten er piksler. Den står også i notatene — hvis noen leser dem |
| Helsides infografikk som ett bilde | Tilbudsarbeid, 2 lysark | 2 MB hver, all tekst i bildet, kan ikke oversettes |
| Skjermbilder med navn på personer | Tilbudsarbeid, 2 lysark | Skal ikke inn i et kurs uten at noen har sagt ja |

**Nullpunktet** (Rapportskriving, skill 2.82.2): Claude.ai fikk innholdet fra 9 av 9 lysark med, og
4 av 9 i riktig form. ChatGPT 4 av 9 og 4 av 9. Begge: tre figurer, én form, ingen av 25 ikoner.

**Kjøreflatene:** Node 22 og Python 3.12/3.13 finnes i både ChatGPT og Claude.ai (målt av
produkteier 2026-10-05). Plattformen gjør en seksjons tekst om til HTML med `marked` og renser den
med DOMPurify (`src/modules/course/sectionContent.ts`).

---

## 1. Ett skill eller flere?

**I dag:** ett skill gjør alt.

| Alternativ | For | Mot |
|---|---|---|
| **A. Ett skill, arbeidsganger inni** (anbefalt) | Én ting å installere i to produkter. Portene, pakkeformatet, oversettelsen og eksporten er felles og står ett sted. Følger rådet «store arbeidsganger i egne filer, valgt etter oppgave» | Krever disiplin: hovedfila må forbli en oversikt |
| B. To skills: «presentasjon til kildepakke» og «kurs fra kilde» | Hvert skill er smalt, slik rådet helst vil | To installasjoner i to produkter. Det første må levere til det andre i et format vi må finne opp. Et skill kan ikke stole på at et annet er lest |
| C. Som i dag | Ingen jobb | Det er dette som ikke virker |

**Anbefaling: A.** Hovedfila sier hva skillet lager, de få harde reglene, portene, og hvilken
arbeidsgang som skal åpnes:

- `workflows/fra-presentasjon.md` — når kilden er en presentasjon.
- `workflows/fra-tekst.md` — når kilden er dokumenter, nettsøk eller forfatterens egne ord (dagens vei).

Fagfilene (tester, figurer, innholdsblokker, oversettelse, pakke og eksport, API) leses når
arbeidsgangen sender modellen dit. B tas opp igjen hvis hovedfila ikke lar seg holde kort.

## 2. Gangen fra presentasjon til kurs

**I dag:** presentasjonen behandles som tekst. Ingen leser fila.

**Anbefaling: sju steg, med fast rollefordeling.**

| Steg | Hva | Skript | Modellen | Forfatteren |
|---|---|---|---|---|
| 1 | **Les fila.** Per lysark: oppsett (flyt, kort, tabell …), tekst per ramme, tabeller, farger, notater. Ikoner og bilder hentes ut som filer | `pptx-extract` | – | laster opp |
| 2 | **Se på lysarkene.** Det skriptet ikke kan se, føres på: tekst i bilder, hva et skjermbilde viser, om det er navn eller ansikter i det | – | ser og fører på | – |
| 3 | **Behandling per lysark.** For hvert lysark med innhold: figur, innholdsblokk, tabell, bilde, prompt som tekst, tekst eller utelatt — med én linje begrunnelse | lager tabellen fra steg 1 og 2 | velger behandling | **godkjenner** |
| 4 | **Læringsmål og struktur**, fra lysarkene og notatene | – | foreslår | **godkjenner** (dagens port 2 og 3) |
| 5 | **Hvert element**: tekst, blokker og figurer sammen, vist ved siden av lysarket det kom fra | tegner figurer med kjent form; sjekker mål | skriver, og tegner fritt der formen ikke har skript | **godkjenner** (dagens port 4) |
| 6 | **Kontroll.** Har hvert lysark fått det tabellen i steg 3 sier? Pluss dagens uavhengige kontroll mot læringsmålene | `coverage-check` | leser kontrollen | – |
| 7 | **Produksjon**: oversettelse, validering, pakke | som i dag | som i dag | importerer |

Tre ting er nye i forhold til i dag:

- **Tabellen i steg 3 er skillets viktigste leveranse underveis.** Den snur spørsmålet fra «trenger
  denne seksjonen en figur?» til «hva gjør vi med hvert lysark?». Å utelate er lov, men det står i
  tabellen med en grunn.
- **Notatene er en kilde.** I Møtearbeid står hovedbudskap og alle promptene der.
- **Kontrollen i steg 6 er et skript**, ikke et løfte. Tabellen følger med pakka, så
  testtilfellene kan måle den.

Regler som forsvinner: «en figur der seksjonen ellers ville vært en tekstvegg», «bare disse fire
malene», «gjør det om til en flyt når noe beveger seg». Låsen på animasjon blir stående — den er
skjør og håndheves av plattformen — men den gjelder bare figurer som beveger seg.

## 3. Hvordan får modellen se lysarkene?

Skjermbildene og infografikkene kan bare leses med øynene.

| Alternativ | Virker i begge produktene? | Merknad |
|---|---|---|
| **A. Forfatteren laster også opp en PDF av presentasjonen** (anbefalt) | Claude.ai leser PDF-sider som bilder. For ChatGPT er det ikke målt, og kan avhenge av abonnement | Ett ekstra steg for forfatteren: «Lagre som PDF» |
| B. Skriptet tegner lysarkene | Ikke dokumentert at noen av flatene har et program som kan tegne en presentasjon. Ikke målt | – |
| C. Skriptet henter ut bildene, og modellen åpner dem | Ikke målt | Dekker skjermbilder, men ikke lysark som er tegnet med former |

**Anbefaling: A, med C som tillegg hvis prøven viser at det virker.** Skillet ber om begge filene
i steg 1. Mangler PDF-en, sier skillet hva det da ikke kan se, og går videre med det skriptet fant
— det later ikke som om det har sett.

**Må måles før dette bygges**, i ChatGPT og i Claude.ai, fem minutter i hvert:

1. Ser modellen bildene på en PDF-side (for eksempel teksten i et skjermbilde)?
2. Kan modellen åpne en bildefil som et skript har hentet ut av presentasjonen?

Svarene avgjør om A holder alene, om C trengs, eller om forfatteren må laste opp lysarkene som
bilder.

## 4. Hva får skillet levere til plattformen?

**Besluttet 2026-10-05:** kort og uthevede bokser blir innholdsblokker, ikke figurer.

**Anbefaling: fire blokker, skrevet slik at teksten også kan leses som helt vanlig markdown.**
Det siste er viktig: teksten vises i redigeringsfeltet, i eksportfiler og i forhåndsvisningen i
samtalen, og den skal gi mening alle stedene.

| Blokk | Skrives som | Uten plattformen ser den ut som |
|---|---|---|
| **Utheving** («Husk», «Tips», «Viktig») | et sitat som begynner med `[!HUSK]` (samme skrivemåte som GitHub bruker) | et sitat |
| **Prompt** eller eksempel til å kopiere | en kodeblokk merket `prompt` | en kodeblokk |
| **Kort** ved siden av hverandre | en ramme `:::kort` rundt underoverskrifter, én per kort | overskrifter med punkter under |
| **Ikon** | et lite bilde først i en kortoverskrift | et bilde |

- Blokkene er tekst. De oversettes, eksporteres og importeres som resten av seksjonen, uten
  endring i lagring eller pakkeformat.
- Plattformen tegner dem på tjeneren, samme sted som resten (`marked`), og renser resultatet.
- På telefon står kortene under hverandre.
- Flere blokker enn disse fire lages ikke før en presentasjon trenger dem.

**Bilder:** plattformen tar i dag imot bilder opp til 5 MB. Anbefaling: plattformen krymper bilder
ved import og opplasting til en fast største bredde, og avviser det som fortsatt er over 300 kB.
Da gjelder regelen også bilder lastet opp for hånd, og skillet trenger ikke et bildebibliotek.

**Figurer:** flere former enn flyt får tegneskript etter hvert som testtilfellene trenger dem.
Først matrise (Tilbudsarbeid, lysark 9) og tidslinje. Figurer som står stille, kan også tegnes
fritt.

**Prototype før bygging:** blokkene vises for produkteier som en side han kan se på, på PC og
telefon, med innholdet fra tre ekte lysark, før noe bygges i plattformen.

## 5. Hva står hvor i skillet?

**Anbefaling:**

```
SKILL.md                     under 200 linjer: hva skillet lager, de harde reglene,
                             portene, hvilken arbeidsgang som åpnes når
workflows/fra-presentasjon.md
workflows/fra-tekst.md
references/tester.md         én fil per fag, hver regel ETT sted,
references/figurer.md        innholdsliste øverst
references/innholdsblokker.md
references/oversettelse.md
references/pakke-og-eksport.md
references/api.md
examples/                    ferdige eksempler: en seksjon med to blokker og to
                             ulike figurer; lysark → behandling for hver form
scripts/                     som i dag, pluss pptx-extract og coverage-check
```

- **De harde reglene i hovedfila er få:** aldri finne på innhold, aldri publisere, ett språk, og
  portene. Alt annet er fag og står i fagfila.
- **Historikk, datoer og saksnumre flyttes** til `doc/` i repoet. Skillet sier hva som skal
  gjøres, ikke hvorfor vi fant det ut.
- **Stier regnes fra skillets rot.** Ingenting peker inn i repoet.
- **Beskrivelsen** får ordene som utløser skillet: presentasjon, PowerPoint, lysark, kurs, test.
- **Kravet** står øverst: Node 20 eller nyere.
- **En test i repoet** holder strukturen: ingen sti ut av pakka, ingen saksnumre, hovedfila under
  grensa.

## 6. Personopplysninger og rettigheter

To skjermbilder i Tilbudsarbeid viser navn på personer; ett viser en person vurdert mot en
kompetansematrise. Flere viser interne sider og dokumentnavn.

**Anbefaling:**

- **Et bilde fra kilden tas aldri med stilltiende.** Tabellen i steg 3 har en egen kolonne: viser
  bildet navn, ansikter eller interne sider?
- **Standard for slike bilder er «utelatt».** Innholdet de viser, føres som tekst (stegene,
  prompten) uten navnene. Forfatteren kan si ja til et bestemt bilde.
- **Bilder fra malen** (pyntebilder) tas ikke med.
- **Forfatteren bekrefter én gang** at materialet kan brukes i et kurs.
- Skillet kan ikke *garantere* at det ser et navn i et bilde. Regelen gjør at spørsmålet blir
  stilt; ansvaret er forfatterens, slik det er for alt annet innhold.

## 7. Hvordan måler vi?

- **De tre testtilfellene** kjøres etter hver endring som endrer hva skillet lager. Oppskriften
  står i `skills/a2-authoring-api-evals/README.md`: ny samtale, bare «godkjent» ved portene, tell.
- **Seks kjøringer per runde** (tre tilfeller, to produkter). De må kjøres av et menneske i
  ChatGPT og Claude.ai; det kan ikke jeg. Mellom rundene kan jeg kjøre skillet i Claude Code som
  en grov prøve — det er samme skill, men ikke samme flate.
- **Mål for første runde etter ombyggingen**, mot nullpunktet:

| | Nullpunkt | Mål |
|---|---|---|
| Lysark med innholdet i kurset | 9 av 9 og 4 av 9 | alle, i begge produktene |
| Lysark i forventet form | 4 av 9 | alle som ikke venter på innholdsblokker |
| Figurformer | 1 | minst 2 der kilden har det |
| Tekst fra bilder gjengitt som tekst | ikke målt | alle promptene |
| Bilder over 300 kB | ikke målt | ingen |
| Bilder med navn tatt med uten spørsmål | ikke målt | ingen |

---

## Rekkefølge, hvis anbefalingene følges

1. **Mål det som er uavklart:** kan modellen åpne et uthentet bilde (valg 3)?
2. **Bygg om skillet på en egen gren:** ny oppdeling (valg 5) og arbeidsgangen fra presentasjon
   (valg 2, 3 og 6), med `pptx-extract` og `coverage-check`. Dagens skill blir liggende urørt til
   det nye er målt.
3. **Kjør de tre testtilfellene** i begge produktene. Bytt ut skillet når tallene er bedre.
4. **Innholdsblokker** (valg 4): prototype, så bygging i plattformen, så lærer skillet å bruke dem.
5. **Flere figurformer**, etter hva testtilfellene viser at mangler.

Steg 2 og 4 kan gå samtidig. Steg 2 gir bedre kurs også før blokkene finnes: kortene blir da
tabeller eller lister, men de blir gjort rede for.

## Det dette ikke løser

- **Presentasjoner uten tekst og uten notater.** Skillet kan lese det som står. En presentasjon
  som bare er bilder og stikkord trenger forfatterens ord, eller et opptak.
- **Tegning på høyde med originalen.** Figurene blir enklere enn lysarkene. Målet er at innholdet
  og formen er bevart, ikke at kurset ser ut som presentasjonen.
- **Safari og forstørret skrift** for de nye blokkene må ses på ekte enheter, som figurene.
