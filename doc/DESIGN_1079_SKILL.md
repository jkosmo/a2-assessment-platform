# Design: skillet `a2-authoring-api`, og veien fra presentasjon til kurs (#1079)

> **Status: besluttet av produkteier 2026-10-05, valg for valg. Ingenting er bygget.** Sju valg.
> På fem fulgte han anbefalingen. På to valgte han annerledes enn det første forslaget (3 og 6);
> teksten under er rettet etter det han bestemte. Beslutningene står også i `doc/DECISIONS.md`.

## Kort

Skillet har vokst ved at hver feil fikk sin regel. Det har aldri hatt et design. Resultatet er ett
skill som dekker seks oppgaver, med figurreglene i fem filer, historikk i instruksjonene, og ingen
vei for det forfatterne faktisk kommer med: en presentasjon. Da produkteier laget samme kurs i
ChatGPT og i Claude.ai 2026-10-05, fikk begge tre figurer av samme type, ingen av kildens ikoner og
ingen av kortene.

Beslutningene, i én tabell:

| # | Valg | Besluttet |
|---|---|---|
| 1 | Ett skill eller flere | **Ett skill å installere, delt i arbeidsganger inni.** «Fra presentasjon» blir en egen arbeidsgang, lest bare når kilden er en presentasjon |
| 2 | Gangen fra presentasjon til kurs | **Sju faste steg**, med en liste over hva hvert lysark blir til, som forfatteren godkjenner før noe skrives |
| 3 | Hvordan modellen får se det som står i bilder | **Forfatteren laster bare opp presentasjonen.** Skriptet henter ut bildene; modellen ser på dem |
| 4 | Hva skillet får levere til plattformen | **Fire innholdsblokker:** uthevet boks, prompt-boks, kort ved siden av hverandre, og ikon. Prøveside før noe bygges. Plattformen krymper store bilder |
| 5 | Hva som står hvor i skillet | **Hele skillet ryddes**, på en egen kopi: kort forside, hver regel ett sted, ferdige eksempler, historikken ut |
| 6 | Bilder med navn, ansikter eller interne sider | **Alle bilder tas med hvis forfatteren ikke sier nei.** Lista viser hvilke bilder som blir med |
| 7 | Hvordan vi måler | **Full runde ved to milepæler** (seks kurs: tre presentasjoner i to produkter): når skillet er bygget om, og når innholdsblokkene er på plass |

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
| 2 | **Se på bildene.** Det skriptet ikke kan se, føres på: tekst i bilder, hva et skjermbilde viser, om det er navn eller ansikter i det | – | ser og fører på | – |
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

## 3. Hvordan får modellen se det som står i bilder?

Skriptet kan lese tekst og former i presentasjonsfila. Det kan ikke lese det som står *inni* et
bilde: en prompt i et skjermbilde, eller en infografikk som er ett stort bilde.

**Besluttet: forfatteren laster bare opp presentasjonen.** Skriptet henter ut bildene som ligger i
den, og modellen ser på dem og fører på det som står der.

- Skjermbildene og infografikkene ligger allerede som bildefiler inni presentasjonen.
- Lysark som er tegnet med former (kort, flyt), leser skriptet selv: hvilke rammer som står ved
  siden av hverandre, overskrifter, ikoner, farger. Der trengs ikke et bilde for å forstå oppsettet.

Det første forslaget ba også om en PDF av presentasjonen, slik at modellen kunne se hele lysark.
Produkteier spurte hvorfor, og svaret var at det var en reserveløsning. Den er tatt ut: et ekstra
steg for hver forfatter skal ikke være standardveien.

**Målt 2026-10-05, i begge produktene:** produkteier lastet opp Møtearbeid-presentasjonen i en ny
samtale i ChatGPT og i Claude.ai og ba modellen pakke ut ett skjermbilde og si hva som sto i det
(valgt språk i en nedtrekksliste, og sju menyvalg). Teksten finnes bare inni bildet. Begge svarte
riktig på alt. Modellen kan altså se et bilde som et skript har hentet ut, og valget holder.

## 4. Hva får skillet levere til plattformen?

**Besluttet 2026-10-05:** kort og uthevede bokser blir innholdsblokker, ikke figurer.

**Anbefaling: fire blokker, skrevet slik at teksten også kan leses som helt vanlig markdown.**
Det siste er viktig: teksten vises i redigeringsfeltet, i eksportfiler og i forhåndsvisningen i
samtalen, og den skal gi mening alle stedene.

| Blokk | Skrives som | Uten plattformen ser den ut som |
|---|---|---|
| **Utheving** («Husk», «Tips», «Viktig») | et sitat som åpner med merkelappen i fet skrift: `> **Husk:** …` | et sitat med fet merkelapp |
| **Prompt** eller eksempel til å kopiere | en kodeblokk merket `prompt` | en kodeblokk |
| **Kort** ved siden av hverandre | en ramme `:::kort` rundt underoverskrifter, én per kort | overskrifter med punkter under |
| **Ikon** | et lite bilde først i en kortoverskrift, eller i en tabellcelle i en kolonne uten navn når minst én annen kolonne har navn | et bilde |

- **Bygget 2026-10-06 (2.84.0, grenen `innholdsblokker-1079`).** Merkelappen skrives i fet
  skrift, ikke som GitHubs `[!HUSK]`: en fet merkelapp leses riktig overalt, også der blokkene ikke
  tegnes, den oversettes som tekst, og kilden får beholde sin egen («Best praksis», «NB»). Tegnet i
  `src/modules/course/contentBlocks.ts` mens markdown blir til HTML — ingen DOM per forespørsel.
  Prøvekjøringen av skillet skrev allerede denne formen.
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

**Prøvesiden er godkjent** (produkteier, 2026-10-05): de fire blokkene vist med tre ekte lysark, på
PC og telefon. Tre avklaringer derfra:

- **Kortene får plattformens stil** (lys bunn, tynn ramme), ikke presentasjonens mørke stripe. Et
  kurs ser da likt ut uansett hvilken presentasjon det kom fra. Farger per kort tas ikke med.
- **Blokkene er som vist:** uthevet boks med ikon og fet merkelapp («Husk», «Tips», «Viktig» —
  den siste i varselfarge), prompt-boks med «Kopier»-knapp, kort som står under hverandre på
  telefon. En uthevet boks kan stå inni et kort.
- **Ingen flere blokker trengs nå.**

⚠️ Ikonene i Rapportskriving er hvite: de er tegnet for mørke striper. På lys bunn er de
usynlige. Leseskriptet gjør derfor ensfargede ikoner mørke når det henter dem ut.

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

## 6. Bilder med navn, ansikter eller interne sider

To skjermbilder i Tilbudsarbeid viser navn på personer; ett viser en person vurdert mot en
kompetansematrise. Flere viser interne sider og dokumentnavn.

**Besluttet: alle bilder tas med hvis forfatteren ikke sier nei.** Anbefalingen var det motsatte
(slike bilder ute som standard); produkteier valgte den raskeste veien. Ansvaret for innholdet er
forfatterens, som for alt annet.

- **Lista i steg 3 viser hvert bilde som blir med.** Forfatteren stryker dem som ikke skal med.
- **Lista merker bilder der modellen ser et navn eller et ansikt** — til opplysning, uten å spørre
  og uten å stoppe.
- **Bilder fra malen** (pyntebilder som ikke bærer innhold) tas ikke med. Det er ikke et spørsmål
  om personvern, men om at de ikke sier noe.
- Skillet kan ikke *garantere* at det ser et navn i et bilde.

## 7. Hvordan måler vi?

- **De tre testtilfellene** kjøres etter hver endring som endrer hva skillet lager. Oppskriften
  står i `skills/a2-authoring-api-evals/README.md`: ny samtale, bare «godkjent» ved portene, tell.
- **Seks kjøringer per runde** (tre tilfeller, to produkter). De må kjøres av et menneske i
  ChatGPT og Claude.ai. **Besluttet: full runde ved to milepæler** — når skillet er bygget om, og
  når innholdsblokkene er på plass. Mellom rundene kjøres skillet i Claude Code som en grov
  prøve: samme skill, men ikke samme flate.
- **Mål for første runde etter ombyggingen**, mot nullpunktet:

| | Nullpunkt | Mål |
|---|---|---|
| Lysark med innholdet i kurset | 9 av 9 og 4 av 9 | alle, i begge produktene |
| Lysark i forventet form | 4 av 9 | alle som ikke venter på innholdsblokker |
| Figurformer | 1 | minst 2 der kilden har det |
| Tekst fra bilder gjengitt som tekst | ikke målt | alle promptene |
| Bilder over 300 kB | ikke målt | ingen |
| Bilder fra kilden som står i lista forfatteren godkjente | finnes ikke | alle som er med i kurset |

---

## Rekkefølge, hvis anbefalingene følges

1. ~~Mål det som er uavklart: kan modellen åpne et uthentet bilde (valg 3)?~~ Målt 2026-10-05: ja,
   i begge produktene.
2. **Bygg om skillet på en egen kopi:** ny oppdeling (valg 5) og arbeidsgangen fra presentasjon
   (valg 2, 3 og 6), med `pptx-extract` og `coverage-check`. Dagens skill blir liggende urørt til
   det nye er målt.
3. **Milepæl 1:** produkteier kjører de tre testtilfellene i begge produktene (valg 7). Skillet
   byttes ut når tallene er bedre.
4. **Innholdsblokker** (valg 4): prøveside som produkteier godkjenner, så bygging i plattformen, så
   lærer skillet å bruke dem. **Milepæl 2:** full runde igjen.
5. **Flere figurformer**, etter hva testtilfellene viser at mangler.

Steg 2 og 4 kan gå samtidig. Steg 2 gir bedre kurs også før blokkene finnes: kortene blir da
tabeller eller lister, men de blir gjort rede for.

## Det dette ikke løser

- **Presentasjoner uten tekst og uten notater.** Skillet kan lese det som står. En presentasjon
  som bare er bilder og stikkord trenger forfatterens ord, eller et opptak.
- **Tegning på høyde med originalen.** Figurene blir enklere enn lysarkene. Målet er at innholdet
  og formen er bevart, ikke at kurset ser ut som presentasjonen.
- **Safari og forstørret skrift** for de nye blokkene må ses på ekte enheter, som figurene.
