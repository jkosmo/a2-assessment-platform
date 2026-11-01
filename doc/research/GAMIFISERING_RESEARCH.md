# Gamifisering i A-2 læringsplattform – research

**Dato:** 2026-11-01 · **Type:** research før en ny epic (ikke design, ikke kode) · **Grunnlag:** produkteiers ideer 2026-11-01

Dokumentet er skrevet for produkteier. Det viktigste står først. Deretter kommer forskningen,
elementene ett for ett, Duolingo, tid brukt, e-post og til slutt juss og personvern. Kildelista står
nederst. Der noe er min tolkning og ikke en kilde, står det **(tolkning)**.

Ord som brukes mye:

- **Gamifisering:** å bruke elementer fra spill (poeng, nivåer, merker, poengtavler, rekker) i noe som
  ikke er et spill.
- **XP / erfaringspoeng:** poeng man samler for aktivitet, ofte med «nivåer» når man når visse summer.
- **Streak / rekke:** antall dager (eller uker) på rad man har vært aktiv.
- **Indre motivasjon:** å gjøre noe fordi det er interessant eller meningsfullt i seg selv. **Ytre
  motivasjon:** å gjøre det for belønningen, for å slippe straff eller for å se bra ut.
- **Metaanalyse:** en studie som slår sammen resultatene fra mange studier. Den sterkeste formen for
  evidens vi har her.
- **Effektstørrelse (g eller d):** hvor stor forskjellen er. Tommelfingerregel: 0,2 er liten, 0,5 er
  middels, 0,8 er stor.
- **Kontrolltiltak:** arbeidsmiljølovens ord for tiltak der arbeidsgiver kontrollerer eller følger med
  på ansatte. Krever saklig grunn, forholdsmessighet, drøfting med tillitsvalgte og informasjon.
- **DPIA:** vurdering av personvernkonsekvenser, et skriftlig risikoarbeid GDPR krever før visse
  typer behandling av personopplysninger.

---

## 1. Kort fortalt

### De viktigste funnene

1. **Gamifisering virker litt, men utformingen avgjør nesten alt.** Metaanalyser finner små til
   middels positive effekter på læring (g ≈ 0,46–0,50), men effektene på motivasjon og atferd er
   ustabile, og de fleste studiene er gjort på studenter over noen få uker
   ([Sailer & Homner 2020](https://doi.org/10.1007/s10648-019-09498-w);
   [Bai, Hew & Huang 2020](https://doi.org/10.1016/j.edurev.2020.100322);
   [Huang m.fl. 2020](https://doi.org/10.1007/s11423-020-09807-z)). Effekten avtar ofte etter
   rundt fire uker ([Rodrigues m.fl. 2022](https://doi.org/10.1186/s41239-021-00314-6)). Én
   kontrollert studie fant at poengtavle og merker over et semester ga *lavere* motivasjon og
   dårligere eksamen ([Hanus & Fox 2015](https://doi.org/10.1016/j.compedu.2014.08.019)).
   Forskning på gamifisering i arbeidslivet er tynn og sprikende
   ([Journal of Workplace Learning 2025](https://www.emerald.com/jwl/article/37/9/206/1326647/Exploring-the-impact-of-gamification-on-employee)).

2. **Poeng og poengtavler gir mer *mengde*, ikke bedre *kvalitet*.** Poeng, nivåer og poengtavler
   økte hvor mye folk gjorde, men ikke den indre motivasjonen
   ([Mekler m.fl. 2017](https://doi.org/10.1016/j.chb.2015.08.048)). Poengtavler gjorde folk raskere,
   men ikke mer nøyaktige ([Kratochvíl m.fl. 2025](https://www.muni.cz/en/research/publications/2495997)).
   En stor metaanalyse over 40 år fant at belønninger forutsier *mengde*, mens indre motivasjon
   forutsier *kvalitet* ([Cerasoli m.fl. 2014](https://doi.org/10.1037/a0035661)). For en
   læringsplattform der målet er kompetanse, er det kvaliteten vi bryr oss om. Poeng for
   aktivitet inviterer til å klikke seg gjennom.

3. **Det som trygt støtter motivasjonen, er følelsen av å mestre noe og å velge selv.** Å følge med
   på egen fremgang øker sjansen for å nå mål (d ≈ 0,40)
   ([Harkin m.fl. 2016](https://doi.org/10.1037/bul0000025)). Fremdriftsgrafer, merker og
   tilbakemelding styrker følelsen av mestring
   ([Sailer m.fl. 2017](https://doi.org/10.1016/j.chb.2016.12.033)). Dette krever verken rangering
   eller maskot.

4. **Frivillighet avgjør i arbeidslivet.** I et felteksperiment på en arbeidsplass ga spill de ansatte
   hadde sagt ja til, bedre trivsel. Spill som ble påtvunget, ga *dårligere* trivsel og litt dårligere
   resultater ([Mollick & Rothbard 2014](https://papers.ssrn.com/abstract=2277103)). Poengtavler
   passer for dem som liker å konkurrere, og belaster dem som ligger nederst
   ([Höllig m.fl. 2020](https://doi.org/10.1016/j.jbusres.2018.10.046);
   [Bai m.fl. 2021](https://doi.org/10.1016/j.compedu.2021.104297)).

5. **Juss: skillet går mellom hva den ansatte ser om seg selv og hva arbeidsgiver ser.** Statistikk
   som bare den ansatte selv ser, er lite problematisk. Når administrator, rapportleser eller
   fagansvarlig kan se innsats per person (poeng, tid, aktivitet, plassering), er det trolig et
   **kontrolltiltak** etter arbeidsmiljøloven kapittel 9. Det kan også treffe **forbudet mot å
   overvåke ansattes bruk av elektronisk utstyr** i e-postforskriften § 2 **(tolkning)**. Da kreves
   saklig grunn, forholdsmessighet, drøfting med tillitsvalgte, informasjon på forhånd og sannsynligvis
   en DPIA. Samtykke fra ansatte er som hovedregel ikke gyldig grunnlag
   ([Datatilsynet](https://www.datatilsynet.no/regelverk-og-verktoy/rapporter-og-utredninger/sjefen-ser-deg-overvaking-og-kontroll-av-arbeidstakeres-digitale-aktiviteter/rad-til-arbeidsgiveren/);
   [EDPB 05/2020 pkt. 21–22](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf)).
   Datatilsynets egen sandkasse vurderte et lignende opplæringsverktøy (Secure Practice). Der var
   konklusjonen at kartleggingen bare var lovlig fordi **arbeidsgiver ikke fikk se tall for den
   enkelte ansatte** ([sluttrapport 2022](https://www.datatilsynet.no/contentassets/081aa7894f2546c48abd32752d207d96/sluttrapport_secure-practice.pdf)).

6. **«Tid brukt» bør ikke måles.** Tid i nettleser kan ikke måles presist, og valget av metode endrer
   resultatene merkbart ([Kovanović m.fl. 2015](https://doi.org/10.18608/jla.2015.23.6)). Tidsmåling
   belønner den som er treg, straffer den som kan stoffet fra før, og er den målingen som ligner mest
   på overvåking. Mål på inaktiv tid var blant grunnene til at Amazon i Frankrike fikk en bot på
   32 millioner euro ([CNIL / Le Club des juristes](https://www.leclubdesjuristes.com/en-bref/condamnation-de-amazon-france-logistique-afl-pour-surveillance-des-salaries-4535/)).
   Et trygt alternativ er **anslått lesetid** for innhold man har fullført, regnet ut fra antall ord.

7. **Duolingo øker bruken, men måler ikke læring, og tonen har fått mye kritikk.** Rekker, ligaer og
   varsler ga målbart mer bruk (for eksempel 17 % mer læringstid med ligaer)
   ([Mazal 2023](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth)). Tallene
   Duolingo selv publiserer, er tall for bruk og ikke for læring. Kritikken gjelder skyldfølelse,
   angst for å miste rekka og at folk jager poeng i stedet for å lære
   ([Mogavi m.fl. 2022](https://arxiv.org/abs/2203.16175)). Vi kan ta med oss lav terskel, en rekke
   som kan repareres, sparsomme varsler som stoppes når de ikke virker, og at vi «beskytter
   kanalen». Vi bør la være skyld, frykt for å tape og daglig rytme.

8. **En ukentlig e-post kan virke uten lenker hvis den er kort, nyttig og frivillig.** Den bør
   inneholde frister og kurs i gang, sendes på mandag, holdes i en nøktern tone, kunne slås av og
   stoppe av seg selv når den ikke virker. Ikke «vi savner deg», og ingen måling av hvem som åpner
   e-posten. Forvent små effekter: påminnelser og planleggingshjelp hadde langt mindre effekt i stor
   skala enn i små forsøk ([Kizilcec m.fl. 2020](https://doi.org/10.1073/pnas.1921417117)).

### Anbefalt retning

**«Mestring for meg selv, ikke konkurranse om meg.»** Det betyr:

- Bygg først det som er **privat og informativt**: egen fremgang og egen statistikk over tid, mål man
  velger selv, merker for ekte milepæler og en valgfri ukentlig oversikt på e-post.
- Gi poeng (hvis vi vil ha poeng) **for innhold man har fullført og moduler man har bestått, én gang
  per element**. Aldri for tid, antall forsøk eller innlogginger.
- Hold **all innsatsstatistikk utenfor ledernes og rapportlesernes syn.** Arbeidsgiver ser fortsatt
  *om* pliktige kurs er fullført innen fristen (resultat), men ikke *hvor mye, hvor lenge eller hvor
  ofte* den enkelte har jobbet (innsats).
- **Vent med poengtavler.** Hvis vi vil ha sammenligning, bør det første steget være et felles mål for
  klassen («klassen har fullført 70 %») uten at noen blir rangert.
- **Ikke mål tid brukt.** Vis anslått lesetid i stedet.
- **Maskot bare med en varm og nøytral tone, og uten skyld.** Ikke la den være bærebjelken. Den er
  lett å gjøre barnslig i en rådgivningskontekst.

### Prioritert liste

| # | Element | Verdi | Risiko | Anbefaling |
|---|---|---|---|---|
| 1 | Egen fremgang og statistikk per uke (seksjoner, moduler, kurs, kursbevis), bare synlig for en selv | Høy | Lav | **Gjør** |
| 2 | Tydelig fremdrift per kurs og «fortsett der du slapp» | Høy | Lav | **Gjør** |
| 3 | Ukentlig oversikt på e-post (frister og kurs i gang), valgfri, nøktern, uten lenker | Middels | Lav–middels | **Gjør**, med avmelding og automatisk stopp |
| 4 | Merker for ekte milepæler (kursbevis, tema fullført, bestått etter revisjon) | Middels | Lav | **Gjør**, få og meningsfulle |
| 5 | Mål man velger selv (for eksempel «2 seksjoner i uka»), som kan slås av | Middels | Lav | **Gjør**, valgfritt |
| 6 | Erfaringspoeng og nivåer, private, for fullført og bestått | Lav–middels | Middels (klikke seg gjennom) | **Gjør med vilkår** (se 4.1) |
| 7 | Rekke på ukenivå («aktiv 3 av de siste 4 ukene»), uten tap | Lav–middels | Middels | **Vent / test** |
| 8 | Felles klassemål (kollektiv fremgang, ingen rangering) | Middels | Lav–middels | **Fase 2**, etter drøfting |
| 9 | Gratulasjoner og kudos, valgfritt og bare der man selv har valgt å vise noe | Lav | Lav–middels | **Fase 2** |
| 10 | Maskot | Lav (usikker) | Middels (barnslig, skyld) | **Valgfritt, bare med nøytral tone** |
| 11 | Repetisjonsspørsmål fra fullførte kurs | Høy for læring | Lav | **Vurder**, støttes av sterk læringsforskning |
| 12 | Poengtavle uten navn, bare egen plassering | Lav | Middels–høy | **Unngå nå** |
| 13 | Poengtavle med navn, eller «ligaer» | Lav | Høy | **Unngå** |
| 14 | Måling og visning av tid brukt | Lav | Høy | **Unngå**, bruk anslått lesetid |
| 15 | Ledere eller rapportlesere ser poeng, tid, aktivitet eller plassering per person | Negativ | Høy (juss og tillit) | **Unngå** |
| 16 | Daglig rekke med tap, varsler som spiller på skyld, «savner deg» | Negativ | Høy | **Unngå** |

### Bør unngås

- Navngitte poengtavler, og alt som lar ledere eller kolleger rangere enkeltpersoner.
- Å vise eller lagre «tid brukt» per person.
- Poeng for innlogging, tid, antall forsøk eller klikk på «lest» alene.
- Daglige rekker som nullstilles, og tekster som «Du mister rekka di!».
- En maskot som er skuffet, trist eller «savner deg» (skyld og press).
- Å straffe feil (som Duolingos «hjerter»), eller ekstrapoeng som gjør at folk ikke tør å prøve.
- Å spore om e-posten blir åpnet (sporingspiksler).
- Å gjenbruke poeng eller statistikk i medarbeidersamtaler, til lønn eller til bemanning uten at den
  ansatte selv tar dem med.

### Spørsmål produkteier må ta stilling til før design

1. **Hvem ser hva?** Godtar vi prinsippet om at arbeidsgiver (administrator, rapportleser,
   fagansvarlig) ser *resultat* på tildelte kurs (fullført, bestått, frist), men aldri *innsats* (poeng,
   aktivitet, tid, plassering)? Det gjelder også rapportlesere i rollen som mentor i
   medarbeidersamtaler.
2. **Poengtavler:** Vil vi i det hele tatt ha sammenligning med andre? Hvis ja: bare for dem som
   velger det selv, bare klassen sett under ett, og fra hvilken klassestørrelse?
3. **Tid brukt:** Kan vi droppe målingen og vise anslått lesetid i stedet?
4. **Frivillighet:** Skal spillelementene være *av* til man slår dem på, eller *på* med en tydelig
   bryter for å slå dem av? Skal den ukentlige e-posten kunne slås av? (Fristvarsler for pliktige kurs
   er noe annet og kan fortsatt sendes.)
5. **Formål på papir:** Er vi villige til å skrive ned at innsatsdata bare skal hjelpe den ansatte
   selv, og ikke brukes til vurdering, lønn, bonus eller bemanning?
6. **Drøfting og informasjon:** Har selskapet tillitsvalgte? Hvem drøfter med dem, hvem informerer
   de ansatte, og hvem eier DPIA-en og involverer personvernombudet, hvis det finnes ett?
7. **Hva skal gi poeng?** Fullført seksjon, bestått modul, bestått etter revisjon? Skal fritekstsvar
   vurdert av KI gi poeng? (Det kan friste noen til å «lure» KI-vurderingen.)
8. **Maskot:** Vil vi ha en personlighet i plattformen, og passer den i en rådgivningskultur? Hvem
   skriver tonen, på tre språk?
9. **Den eksisterende «Aktivitet»-fanen (#1099):** Rapportleser ser allerede «sist sett» og hendelser
   for alle. Den juridiske vurderingen i kapittel 8 gjelder den også. Skal den vurderes i samme runde?
10. **Hvordan vet vi om det virker?** Hvilke målinger på gruppenivå (for eksempel andel tildelte kurs
    fullført innen frist) skal avgjøre om vi beholder et element, uten at vi følger med på
    enkeltpersoner?

---

## 2. Hva sier forskningen?

### 2.1 Effekter på læring, motivasjon og atferd

| Kilde | Hva | Funn |
|---|---|---|
| [Sailer & Homner 2020](https://doi.org/10.1007/s10648-019-09498-w) ([åpen versjon](https://opus.bibliothek.uni-augsburg.de/opus4/frontdoor/index/index/docId/109056)) | Metaanalyse, *Educational Psychology Review* | Læring g = 0,49, motivasjon g = 0,36, atferd g ≈ 0,25. Effekten på læring holdt i de beste studiene. Effektene på motivasjon og atferd var **mindre stabile**. Fortelling (game fiction) og konkurranse kombinert med samarbeid styrket effekten på atferd. |
| [Bai, Hew & Huang 2020](https://doi.org/10.1016/j.edurev.2020.100322) | Metaanalyse, 24 studier, ca. 3 200 deltakere | Læring g = 0,50. Typen spillelement og antall elementer betydde lite. |
| [Huang m.fl. 2020](https://doi.org/10.1007/s11423-020-09807-z) | Metaanalyse, *ETR&D* | Læring g = 0,46 (liten til middels). |
| [Hamari, Koivisto & Sarsa 2014](https://doi.org/10.1109/HICSS.2014.377) | Litteraturgjennomgang | Stort sett positive, men blandede resultater. Avhenger av kontekst og brukere. |
| [Hanus & Fox 2015](https://doi.org/10.1016/j.compedu.2014.08.019) | Kontrollert studie, ett semester | Poengtavle og merker ga **lavere** indre motivasjon, tilfredshet og eksamensresultat. |
| [Rodrigues m.fl. 2022](https://doi.org/10.1186/s41239-021-00314-6) | 14 uker, programmeringskurs | Effekten falt etter ca. 4 uker (nyhetseffekt) og tok seg delvis opp igjen etter 6–10 uker. |
| [Kizilcec m.fl. 2020](https://doi.org/10.1073/pnas.1921417117) | 250 000 studenter, 247 nettkurs | Påminnelser og hjelp til å planlegge ga mer aktivitet de første ukene, men **ikke flere som fullførte**. Effektene var omtrent ti ganger mindre enn i små forsøk. |
| [JWL 2025-gjennomgang](https://www.emerald.com/jwl/article/37/9/206/1326647/Exploring-the-impact-of-gamification-on-employee) | 49 studier om ansatte | Effekten avhenger av utforming, kultur og hvem som lærer. Feltet er «fragmentert». |

**Hva dette betyr for oss:** Tallene gjelder «gamifisering» i snitt, mest blant studenter i korte
forsøk og ofte målt rett etterpå. De sier lite om et frivillig verktøy over flere år blant voksne
fagfolk. Den mest robuste delen (læring) kommer trolig like mye av bedre struktur, tilbakemelding og
øving som av poengene i seg selv **(tolkning)**. At typen element betyr lite i snitt, men mye i
enkeltstudier, er et tegn på at det er utformingen som avgjør.

### 2.2 Selvbestemmelsesteori: mestring, valgfrihet og tilhørighet

Selvbestemmelsesteorien ([Ryan & Deci 2000](https://doi.org/10.1037/0003-066X.55.1.68)) er den
mest brukte teorien for å forstå motivasjon. Den sier at indre motivasjon vokser når tre behov
oppfylles:

- **Mestring (kompetanse):** «Jeg blir flinkere, og jeg ser det.»
- **Valgfrihet (autonomi):** «Jeg velger selv. Ingen styrer meg.»
- **Tilhørighet:** «Jeg er en del av noe sammen med andre.»

Spillelementer virker forskjellig på de tre behovene. I et kontrollert forsøk økte merker,
poengtavler og fremdriftsgrafer følelsen av mestring. Lagkamerater og en fortelling økte tilhørighet.
**Ingen av elementene økte følelsen av valgfrihet**
([Sailer m.fl. 2017](https://doi.org/10.1016/j.chb.2016.12.033)). Valgfriheten må altså komme fra
hvordan vi innfører elementene (frivillig, kan slås av, mål man velger selv), ikke fra elementene selv.

### 2.3 Når belønning svekker lysten (overjustering)

Klassisk forskning viser at en forventet belønning kan gjøre at noe man likte, blir «noe man gjør for
belønningen». Når belønningen forsvinner, forsvinner også lysten
([Lepper, Greene & Nisbett 1973](https://doi.org/10.1037/h0035519)). En metaanalyse av 128 forsøk
fant at **forventede, materielle belønninger knyttet til å gjøre eller fullføre en oppgave svekket
indre motivasjon**, mens **positiv tilbakemelding styrket den**
([Deci, Koestner & Ryan 1999](https://doi.org/10.1037/0033-2909.125.6.627)). Funnet er omstridt i
detaljene, men hovedmønsteret står seg godt.

Poeng og merker er ikke penger, og de svekker ikke nødvendigvis lysten. I flere forsøk økte de
mengden uten å endre indre motivasjon, verken opp eller ned
([Mekler m.fl. 2017](https://doi.org/10.1016/j.chb.2015.08.048);
[Kyewski & Krämer 2018](https://doi.org/10.1016/j.compedu.2017.11.006)). Men de *kan* oppleves som
kontroll, særlig når andre ser dem og når de brukes til å vurdere folk. Det skjedde i
[Hanus & Fox 2015](https://doi.org/10.1016/j.compedu.2014.08.019).

Den viktigste regelen fra denne forskningen: **Belønning som forteller deg noe («du har mestret
dette»), styrker motivasjonen. Belønning som styrer deg («gjør dette for å få poeng og ikke havne
bakerst»), svekker den.** Den samme poengsummen kan virke på begge måter, avhengig av hvem som ser
den og hva den brukes til.

### 2.4 Mengde mot kvalitet

[Cerasoli, Nicklin & Ford 2014](https://doi.org/10.1037/a0035661) (183 studier, over 200 000
personer, skole, jobb og idrett):

- Indre motivasjon forutsier **kvalitet** best. Belønninger forutsier **mengde** best.
- Når belønningen er direkte knyttet til prestasjonen, betyr indre motivasjon mindre. Det er en form
  for «fortrengning».

Det samme mønsteret ser vi i gamifiseringsforskningen: poengtavler gjør folk raskere, men ikke mer
nøyaktige ([Kratochvíl m.fl. 2025](https://www.muni.cz/en/research/publications/2495997)). Poeng
gir flere bidrag, men ikke mer motivasjon ([Mekler m.fl. 2017](https://doi.org/10.1016/j.chb.2015.08.048)).
I en læringsplattform der vi vil ha forståelse og ikke bare flest mulig fullførte seksjoner, er dette
kanskje det viktigste enkeltfunnet.

### 2.5 Å «lure systemet»

Når poeng måler noe som er lett å gjøre uten å lære, lærer folk å samle poeng. Forskning på
digitale læringsverktøy har lenge beskrevet hvordan elever «lurer systemet»: de klikker seg videre
eller gjetter for å komme fram uten å lære, og de som gjør det mest, lærer minst
([Baker m.fl. 2005](https://learninganalytics.upenn.edu/ryanbaker/BCKR2005Final.pdf)). Blant
Duolingo-brukere er det beskrevet at folk gjentar lette leksjoner for å samle XP og klatre i ligaen.
Det tar tid fra læringen og går ut over resultatene ([Mogavi m.fl. 2022](https://arxiv.org/abs/2203.16175)).

I vår plattform er de mest åpenbare måtene å lure systemet på **(tolkning)**:

- å markere seksjoner som lest uten å lese dem, hvis «lest» gir poeng
- å prøve flervalgstester mange ganger, hvis forsøk gir poeng
- å prøve å påvirke KI-vurderingen av fritekstsvar, hvis bestått gir mange poeng
- å la fanen stå åpen, hvis tid gir poeng

Regelen er gammel og kjent som Goodharts lov: *når et mål blir et mål i seg selv, slutter det å være
et godt mål.*

### 2.6 Voksne på arbeidsplassen

- **Frivillighet (samtykke i hverdagslig forstand):** I et felteksperiment med over 200 selgere ga
  spill de ansatte hadde sagt ja til, mer positive følelser på jobb. Spill uten slik aksept ga mindre
  positive følelser og noe svakere resultater. Følelsen av at spillet var legitimt og at man selv
  hadde kontroll, var avgjørende
  ([Mollick & Rothbard 2014](https://papers.ssrn.com/abstract=2277103);
  [Wharton-omtale](https://knowledge.wharton.upenn.edu/article/gamification-powering-game/)).
- **Ulike personer reagerer ulikt:** Konkurranselystne liker poengtavler. Lagbaserte tavler passet
  bedre for dem som er opptatt av egen utvikling. Én løsning for alle fungerer dårlig
  ([Höllig, Tumasjan & Welpe 2020](https://doi.org/10.1016/j.jbusres.2018.10.046)).
- **Etikk:** Gamifisering på jobb kan bli utnyttelse eller manipulasjon når den brukes til å få folk
  til å gjøre mer enn de ellers ville valgt, uten at de ser det
  ([Kim & Werbach 2016](https://doi.org/10.1007/s10676-016-9401-5)). Nyere arbeid hevder at poeng
  og tavler på jobb kan svekke følelsen av å gjøre noe fordi det er riktig, ikke fordi det gir poeng
  ([Kim 2026, omtale](https://www.cmu.edu/tepper/news/stories/workplace-gamification-erodes-moral-agency)).
  Dette er filosofiske argumenter, ikke målinger.
- **Hvordan ansatte opplever innsyn:** I Datatilsynets undersøkelse sa 55 % at de har lite eller
  ingen innsikt i hva arbeidsgiver samler inn om dem gjennom digitale verktøy, og seks av ti var
  negative til å bli overvåket mens de jobber eller studerer
  ([Datatilsynet, «Sjefen ser deg?»](https://www.datatilsynet.no/regelverk-og-verktoy/rapporter-og-utredninger/sjefen-ser-deg-overvaking-og-kontroll-av-arbeidstakeres-digitale-aktiviteter/hva-opplever-arbeidstakerne/)).
  I Secure Practice-sandkassen pekte fokusgrupper (med fagforeningen Negotia) på at ansatte svarer
  mindre ærlig når de tror arbeidsgiver kan se svarene
  ([sluttrapport](https://www.datatilsynet.no/contentassets/081aa7894f2546c48abd32752d207d96/sluttrapport_secure-practice.pdf)).
  Det gjelder sannsynligvis også for læring: Den som tror leder ser poengene, velger trygge kurs og
  unngår å feile **(tolkning)**.

### 2.7 Hva er solid evidens, og hva er bransjepåstander?

| Ganske solid (metaanalyser, kontrollerte studier) | Svakere (enkeltstudier, korte forsøk) | Bransjepåstander (ikke uavhengig kontrollert) |
|---|---|---|
| Små til middels gjennomsnittseffekter på læring | Effekter av enkeltelementer (merker, poengtavler) | «Gamifisering øker engasjementet med X %» fra leverandører |
| Belønninger øker mengde mer enn kvalitet | Konkrete regler for poengtavler (relative, anonyme) | Duolingos tall for bruk (ekte A/B-tester, men bare bruk, ikke læring, og ikke uavhengig kontrollert) |
| Å følge med på egen fremgang hjelper | At rekker kan reparere bortfall | At en maskot øker gjennomføring |
| Forventede materielle belønninger svekker indre motivasjon | Arbeidsplasseffekter (få studier) | Tall som «72 % jobber hardere med gamifisering» (fant ingen sporbar kilde) |
| Testing og repetisjon gir bedre læring (se 4.10) | | |

---

## 3. Duolingo og andre plattformer

### 3.1 Duolingo: hva de gjør, og hva vi vet

**Uglen «Duo».** En maskot med tydelig personlighet, brukt i varsler, i appen og i markedsføring.
Tonen er bevisst «litt passiv-aggressiv». Den ble et internettfenomen der brukere overdrev den til
trusler ([Daily Dot](https://www.dailydot.com/irl/duolingo-owl-memes/)). Når påminnelsene ikke
virker, sender appen etter hvert noe som «These reminders don't seem to be working. We'll stop
sending them for now.» Mange opplever det som skyldbelagt
([uxdesign.cc, «20 days of emotional blackmail»](https://uxdesign.cc/20-days-of-emotional-blackmail-from-duolingo-4f566523e3c5);
[TU/e Cursor, «Guilt-tripped by an owl»](https://cursor.tue.nl/en/opinion/alain-starke/guilt-tripped-by-an-owl)).
Dette er meningsartikler, ikke forskning.

**Rekker (streaks).** Antall dager på rad med minst én leksjon.

- Duolingo fant at et høyt daglig mål hindret folk i å bygge en vane. Etter at én leksjon ble nok til
  å holde rekka, steg andelen med rekke på 7+ dager med over 40 %, og 14-dagers retensjon steg med
  3,3 %. Ulempen var at færre nådde det daglige målet sitt
  ([Duolingo-bloggen 2020](https://blog.duolingo.com/improving-the-streak)).
- De som når 7 dagers rekke, er 2,4 ganger så tilbøyelige til å komme tilbake neste dag (samme kilde).
  Det er en sammenheng, ikke bevis for årsak. Tidligere produktsjef skriver selv at funnet kan
  skyldes at de mest motiverte velger seg ut
  ([Mazal 2023](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth)).
- «Rekkefrys» (en dag fri uten å miste rekka), varsel sent på kvelden når rekka er i fare, kalender
  og animasjoner. Andelen daglige brukere med rekke på 7+ dager nesten tredoblet seg (samme kilde).
  Duolingo har kjørt over 600 forsøk bare på rekka
  ([Lenny's Podcast med Jackson Shuttleworth](https://www.lennysnewsletter.com/p/behind-the-product-duolingo-streaks)).

**Ligaer.** Ukentlige grupper på rundt 30 brukere med omtrent samme aktivitetsnivå forrige uke. De
beste rykker opp, de nederste ned (detaljene varierer, og kildene er sekundære)
([Mazal 2023](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth);
[Deconstructor of Fun](https://duolingo.deconstructoroffun.com/mechanics/leagues)). Ligaene ga
**17 % mer læringstid** og tredoblet antall «svært engasjerte» (minst en time om dagen fem dager i
uka). Folk ble automatisk meldt inn. Merk: «engasjert» er målt i tid, ikke i hva de kan.

**Varsler.** Duolingo bruker en algoritme som velger blant mange varseltekster. Den tar hensyn til at
en tekst mister kraft når den gjentas, og at nye tekster virker sterkere en kort stund. Resultatet var
+0,5 % daglige brukere og +2 % retensjon hos nye brukere
([Yancey & Settles 2020](https://research.duolingo.com/papers/yancey.kdd20.pdf)). En viktig regel
hos Duolingo var å **«beskytte kanalen»**: å øke antall varsler krevde sterk begrunnelse og
toppsjefens godkjenning. De viste til Groupon, som mistet e-post som kanal fordi folk meldte seg av
for godt ([Mazal 2023](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth)).

**Kritikk:**

- **Poengjakt framfor læring.** Studie av ni års forumdiskusjoner og 15 intervjuer: brukere blir så
  opptatt av XP, ligaer og rekker at de kaster bort tid og lærer dårligere. Årsakene er blant annet
  konkurranse, for mye lek og flokkatferd ([Mogavi m.fl. 2022, Learning @ Scale](https://arxiv.org/abs/2203.16175)).
- **Skyld og manipulasjon.** Tonen i varslene kalles «guilt marketing» i populærpressen. Forskning på
  skyldappeller viser små effekter, og eksplisitt skyld kan slå tilbake
  ([Peng m.fl. 2023, metaanalyse](https://www.frontiersin.org/articles/10.3389/fpsyg.2023.1201631)).
- **Brutte rekker.** Når rekka brytes, faller mange fra. Det er sterkest når man gir seg selv skylden,
  og svakere når rekka kan repareres ([Silverman & Barasch 2023](https://doi.org/10.1093/jcr/ucac029)).
  Forskeren sier at meldinger som peker på at du feilet, typisk ikke virker
  ([CU Boulder-omtale](https://www.colorado.edu/business/faculty-research/2023/04/19/or-track-how-broken-streaks-affect-consumer-decisions)).
- **Manipulerende design.** Forbrukerrådet var tidlig ute med å kartlegge manipulerende design
  («dark patterns») i digitale tjenester
  ([Deceived by Design 2018](https://storage02.forbrukerradet.no/media/2018/06/2018-06-27-deceived-by-design-final.pdf)).
  Grepene som oftest nevnes om Duolingo, er skyldbelagte meldinger, frykt for å miste noe og
  «hjerter» som begrenser hvor mange feil man får gjøre.

### 3.2 Hva kan overføres til en arbeidsplass?

| Fra Duolingo | Overførbart? | Hvorfor |
|---|---|---|
| Lav terskel for å «telle» (én leksjon er nok) | **Ja** | Gjør det lett å komme i gang, uten krav om mye. |
| Rekka kan repareres, eller man kan ta fri | **Ja, hvis vi har rekker** | Reduserer frafall etter brudd ([Silverman & Barasch 2023](https://doi.org/10.1093/jcr/ucac029)). |
| «Beskytt kanalen»: få meldinger, stopp når de ikke virker | **Ja** | Ansatte får mange e-poster. Én melding de lærer å overse, er tapt for godt. |
| Variasjon i tekstene | **Ja, enkelt** | Samme tekst hver uke slites ut ([Yancey & Settles 2020](https://research.duolingo.com/papers/yancey.kdd20.pdf)). |
| Daglig rytme | **Nei** | Kursene her er fagstoff i arbeidstiden, ikke en daglig vane. Uke passer bedre. |
| Ligaer og konkurranse om XP | **Nei** | Kolleger er ikke anonyme fremmede. Det gir sosialt press og jakt på poeng. |
| Skyld, trist ugle, «du skuffer Duo» | **Nei** | Oppleves som press fra arbeidsgiver, ikke som humor. |
| Automatisk påmelding til konkurranse | **Nei** | Påtvungen moro senker trivselen ([Mollick & Rothbard 2014](https://papers.ssrn.com/abstract=2277103)). |
| Begrenset antall feil («hjerter») | **Nei** | Straffer det å prøve. Feil er nyttige for læring ([Metcalfe 2017](https://doi.org/10.1146/annurev-psych-010416-044022)). |

### 3.3 Andre eksempler

- **Microsoft Learn:** XP for hver modul og enhet, nivåer, merker for moduler og trofeer for
  læringsstier. Profilen er offentlig ([Microsoft Learn FAQ](https://learn.microsoft.com/en-us/training/support/faq)).
  Ingen poengtavle mellom brukere. Dette er det nærmeste forbildet for poeng uten konkurranse.
- **Trailhead (Salesforce):** Poeng, merker og nivåer («ranks»). Flervalgsquiz gir 100 poeng ved
  første riktige svar, 50 etter ett feil og 25 etter to. Praktiske oppgaver gir mer. «Superbadges»
  krever at man løser et realistisk problem med lite veiledning
  ([Trailhead-terminologi](https://help.salesforce.com/s/articleView?id=005299079&type=1&language=en_US);
  [Superbadge](https://help.salesforce.com/s/articleView?id=005299049&language=en_US&type=1)).
  Lærdom: belønn det som er vanskelig å fake (anvendt ferdighet). Trekket for feil er vanlig, men
  kan gjøre folk forsiktige (se 4.10).
- **Khan Academy:** «Energy points» måler innsats og sier uttrykkelig at de *ikke* måler mestring.
  Mestring måles for seg ([Khan Academy hjelpesenter](https://support.khanacademy.org/hc/en-us/articles/202487710-What-are-energy-points-)).
  Skillet mellom innsats og mestring er nyttig for oss.
- **LinkedIn Learning:** Man velger selv et ukemål i minutter (15, 30, 60 eller 120) og kan endre
  eller fjerne det ([LinkedIn hjelp](https://www.linkedin.com/help/linkedin/answer/a704926)).
  Ukemål er en god idé. Målet i minutter krever tidsmåling, som vi fraråder (kapittel 5).
- **Microsoft Productivity Score (2020):** viste navn og aktivitet per ansatt for administratorer.
  Etter sterk kritikk for å være et overvåkingsverktøy fjernet Microsoft navnene og gikk over til tall
  på organisasjonsnivå ([PCWorld](https://www.pcworld.com/article/393770/microsoft-tweaks-its-productivity-score-removing-employee-names-to-preserve-privacy.html)).
  **Microsoft Viva Insights** viser ledere bare samlede tall, og bare for grupper på minst fem
  ([Microsoft Learn](https://learn.microsoft.com/en-us/viva/insights/advanced/setup-maint/privacy-settings)).
  Dette er et godt bilde på hvor bransjen har landet når arbeidsgiver ser aktivitetsdata.

---

## 4. Element for element

Hvert element har samme oppsett: **hva**, **evidens**, **risiko**, **utforming hvis vi bruker det**
og **passer det hos oss?**

### 4.1 Erfaringspoeng (XP) og nivåer

- **Hva:** Poeng for fullført seksjon og modul, eventuelt nivåer («Nivå 4») ved visse summer.
- **Evidens:** Poeng og nivåer øker mengden aktivitet, men ikke indre motivasjon eller kvalitet
  ([Mekler m.fl. 2017](https://doi.org/10.1016/j.chb.2015.08.048);
  [Cerasoli m.fl. 2014](https://doi.org/10.1037/a0035661)). Ingen gode studier av poeng alene blant
  voksne ansatte.
- **Risiko:** Poengjakt (klikke «lest» uten å lese, gjøre de letteste modulene). Poeng som sammenlignes
  med andre, eller som leder ser, blir kontroll. Poengene kan også rangere kurs etter «hvor mye de er
  verdt» i stedet for hvor nyttige de er.
- **Utforming hvis vi bruker det:**
  - Poeng bare for **første** fullføring av hvert element. Ingen poeng for nye forsøk, innlogging
    eller tid.
  - Mest for **bestått modul**, lite for seksjon lest. Det gjør det mindre lønnsomt å klikke seg
    gjennom lesestoffet **(tolkning)**.
  - Vurder en liten bonus for **bestått etter revisjon** (se 4.10), ikke for «bestått på første forsøk».
  - Ingen poengtap.
  - **Bare synlig for en selv.**
  - Nivåer er valgfritt. Nivåer uten mening («Nivå 7») sier lite. Mer meningsfullt er det å knytte
    fremgang til **tema** («Prosjektledelse: 3 av 5 kurs»).
- **Passer det hos oss?** Ja, som en enkel, privat «oppsummering av hva jeg har gjort». Ikke som
  valuta eller konkurranse. Spørsmålet er om poeng sier noe mer enn tellingene av seksjoner, moduler
  og kurs gjør. Det er mulig at tellingene alene er nok **(tolkning)**.

### 4.2 Rekker (streaks) og vern av rekka

- **Hva:** Antall dager eller uker på rad med aktivitet.
- **Evidens:** Hele rekker øker videre aktivitet. Brutte rekker får mange til å slutte. Effekten er
  svakere når rekka kan repareres ([Silverman & Barasch 2023](https://doi.org/10.1093/jcr/ucac029)).
  Faste rutiner kan svekke vanedannelsen. Fleksible belønninger ga mer trening både under og etter
  forsøket ([Beshears m.fl. 2021](https://doi.org/10.1287/mnsc.2020.3706)). Belønning for å komme
  tilbake etter et opphold var det beste av 54 tiltak i en stor studie av treningssentre
  ([Milkman m.fl. 2021](https://doi.org/10.1038/s41586-021-04128-4)). Duolingos rekker øker bruken,
  men dataene er deres egne og måler bruk ([Duolingo 2020](https://blog.duolingo.com/improving-the-streak)).
- **Risiko:** Angst for å miste rekka, læring for å «redde» rekka i stedet for å lære
  ([Mogavi m.fl. 2022](https://arxiv.org/abs/2203.16175)). I en jobb med prosjekter, reiser, ferie
  og foreldrepermisjon brytes daglige rekker av helt legitime grunner. Rekka straffer altså livet,
  ikke latskap.
- **Utforming hvis vi bruker det:**
  - **Uker, ikke dager.**
  - **Fleksibelt:** «aktiv 3 av de siste 4 ukene» i stedet for «X uker på rad».
  - Rekka kan **pauses** (ferie, permisjon) uten å spørre noen.
  - **Ingen tap-melding.** Etter et opphold: en ny start («Ny uke, nye muligheter»), ikke «Du mistet
    rekka».
  - Bare synlig for en selv.
- **Passer det hos oss?** Usikkert. Det er det mest Duolingo-aktige elementet og det som lettest blir
  mas. Hvis det testes, bør det være i ukeform, uten tap.

### 4.3 Merker (badges)

- **Hva:** Et symbol for en milepæl («Første kursbevis», «Tema Bærekraft fullført»).
- **Evidens:** Blandet. Merker økte aktiviteten på en delingsplattform
  ([Hamari 2017](https://doi.org/10.1016/j.chb.2015.03.036)). I et nettkurs hadde de verken positiv
  eller negativ effekt ([Kyewski & Krämer 2018](https://doi.org/10.1016/j.compedu.2017.11.006)). De
  kan øke følelsen av mestring ([Sailer m.fl. 2017](https://doi.org/10.1016/j.chb.2016.12.033)).
- **Risiko:** Mange og billige merker («Logget inn 5 dager») blir støy og inviterer til jakt. Merker
  for kvantitet belønner mengde.
- **Utforming hvis vi bruker det:**
  - **Få merker, og bare for milepæler som sier noe om kompetanse.** Kursbevis finnes allerede, og
    merker kan bygge videre på dem: tema fullført, alle kurs i en klasse fullført, bestått etter
    revisjon.
  - Tydelig hvorfor man fikk merket.
  - Ingen merker for innlogging eller tid.
  - Den ansatte bestemmer selv om merker skal vises for andre.
- **Passer det hos oss?** Ja, i nøktern form. Kursbevis er allerede et «merke» med reell verdi.

### 4.4 Fremdrift og egen statistikk over tid

- **Hva:** Profilsiden viser hva jeg har gjort: seksjoner, moduler, kurs og kursbevis, per uke og over
  tid.
- **Evidens:** Det sterkeste vi har. Å følge med på egen fremgang øker sjansen for å nå mål (d ≈ 0,40
  på tvers av 138 forsøk). Effekten er større når fremgangen blir **registrert** (Harkin finner at den
  også er større når den blir **gjort offentlig**, men det bør vi ikke gjøre her)
  ([Harkin m.fl. 2016](https://doi.org/10.1037/bul0000025)). Fremdriftsgrafer øker følelsen av mestring
  ([Sailer m.fl. 2017](https://doi.org/10.1016/j.chb.2016.12.033)). Folk øker innsatsen når målet
  nærmer seg ([Kivetz, Urminsky & Zheng 2006](https://doi.org/10.1509/jmkr.43.1.39)).
- **Risiko:** Lav, så lenge bare den ansatte ser den. Uker med null kan oppleves som anklager.
- **Utforming:**
  - Bare synlig for en selv.
  - Vis det som er **gjort** (fullført, bestått), ikke tid (kapittel 5).
  - Sammenlign med **seg selv** («din beste uke»), ikke med andre.
  - Uker uten aktivitet vises nøytralt, uten røde markeringer.
  - Mulighet til å skjule statistikken helt.
  - Fremdrift per kurs («4 av 7 seksjoner, 1 av 2 moduler») er trolig mer nyttig i hverdagen enn
    ukestatistikk **(tolkning)**.
- **Passer det hos oss?** Ja. Dette er grunnmuren og bør komme først.

### 4.5 Mål og ukemål

- **Hva:** «Jeg vil fullføre 2 seksjoner i uka», eller «jeg vil bli ferdig med kurset før 1. desember».
- **Evidens:** Konkrete, utfordrende mål gir bedre resultater enn «gjør ditt beste»
  ([Locke & Latham 2002](https://doi.org/10.1037/0003-066X.57.9.705)). Poengtavler virker i stor grad
  *fordi* de fungerer som mål ([Landers, Bauer & Callan 2017](https://experts.umn.edu/en/publications/gamification-of-task-performance-with-leaderboards-a-goal-setting/)).
  Da kan vi få mye av gevinsten med mål og uten tavle **(tolkning)**. Høye faste mål kan hindre
  vanedannelse ([Duolingo 2020](https://blog.duolingo.com/improving-the-streak)). Mandag og andre
  «nye starter» gjør folk mer villige til å ta tak
  ([Dai, Milkman & Riis 2014](https://doi.org/10.1287/mnsc.2014.1901)).
- **Risiko:** Mål som arbeidsgiver setter eller ser, blir krav. Mål man ikke når, kan bli en kilde
  til dårlig samvittighet.
- **Utforming:** Mål man **velger selv** og kan endre eller fjerne når som helst (som LinkedIn
  Learning). Små standardvalg. Ingen standardmål for dem som ikke har valgt. Kursfrister fra
  arbeidsgiver er noe annet og skal være tydelig adskilt.
- **Passer det hos oss?** Ja, valgfritt.

### 4.6 Poengtavler (scoreboards)

Varianter vurdert hver for seg:

| Variant | Hva | Evidens | Risiko hos oss |
|---|---|---|---|
| **Absolutt med navn** | Alle i klassen rangert etter poeng | Kan øke mengde. Kan senke motivasjon og resultater over tid ([Hanus & Fox 2015](https://doi.org/10.1016/j.compedu.2014.08.019)). | **Høy.** Kolleger ser hverandre. De nederst blir synlige. Det er kontrolltiltak hvis arbeidsgiver ser tavla. |
| **Relativ / «liga»** | Du ser bare dem rett over og under deg | Toppen av en relativ tavle presterte bedre. Hvordan de nederst opplevde det, avhenger av om tavla var anonym ([Bai m.fl. 2021](https://doi.org/10.1016/j.compedu.2021.104297)). Duolingo: mer tid ([Mazal 2023](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth)). | **Høy.** En klasse på 10–30 kolleger er ingen anonym liga. |
| **Anonym (kallenavn)** | Rangering uten ekte navn | De nederst på en absolutt tavle foretrakk anonymitet ([Bai m.fl. 2021](https://doi.org/10.1016/j.compedu.2021.104297)). | **Middels–høy.** Lett å avsløre i små grupper (se 8.7). |
| **Bare egen plassering** («Du er nr. 4 av 12») | Ingen andre navn | Ingen direkte studier funnet. | **Middels.** Folk forteller hverandre plasseringen («jeg er nr. 1»), og da faller resten på plass. De nederst får et tall på at de ligger bakerst. |
| **Lag eller klasse mot klasse** | Grupper rangeres, ikke personer | Konkurranse kombinert med samarbeid styrket effekten på atferd ([Sailer & Homner 2020](https://doi.org/10.1007/s10648-019-09498-w)). Lagtavler passet flere personlighetstyper ([Höllig m.fl. 2020](https://doi.org/10.1016/j.jbusres.2018.10.046)). | **Middels.** Klassene kan være ulike i størrelse og arbeidspress. Kan gi press innad («du drar ned snittet»). |
| **Felles mål for klassen** (ingen rangering) | «Klassen har fullført 70 % av kursene» | Indirekte støtte fra tilhørighet ([Sailer m.fl. 2017](https://doi.org/10.1016/j.chb.2016.12.033)). | **Lav–middels**, hvis klassen er stor nok og ingen enkeltpersoner kan leses ut. |
| **Bare mot seg selv** | Denne uka mot forrige, beste uke | Støttes av forskning på å følge med på egen fremgang ([Harkin m.fl. 2016](https://doi.org/10.1037/bul0000025)). | **Lav.** |

Andre funn: Hvilke kolleger som ligger øverst, kan påvirke hvordan andre presterer. I én studie
presterte kvinner dårligere når andre kvinner dominerte toppen av tavla. Mekanismene er uklare
([Christy & Fox 2014](https://doi.org/10.1016/j.compedu.2014.05.005)).

**Vurdering:** Produkteiers egen tanke om «posisjon uten navn» peker riktig vei, men løser ikke
problemet i små klasser (se 8.7). Det tryggeste med noe av den samme sosiale kraften er et
**felles klassemål uten rangering**, eventuelt med valgfri deltakelse. Individuelle tavler bør vi la
være, i alle fall i første omgang.

### 4.7 Sosiale elementer (kudos og gratulasjoner)

- **Hva:** Gratulere en kollega med kursbevis, «tommel opp», «3 kolleger tar også dette kurset».
- **Evidens:** Tynn for læringsplattformer. Tilhørighet styrkes av samarbeid og fellesskap
  ([Sailer m.fl. 2017](https://doi.org/10.1016/j.chb.2016.12.033)). Ingen gode studier av kudos i
  bedrifts-LMS funnet.
- **Risiko:** Viser hvem som har gjort hva (personopplysninger til kolleger). Popularitetskonkurranse.
  De som ikke får gratulasjoner, merker det.
- **Utforming:** Bare der den ansatte selv har valgt å dele noe (for eksempel «vis kursbevisene mine
  for kolleger»). Bare positive handlinger, ingen tellere. Plattformen har allerede diskusjoner, og
  sosiale funksjoner kan bygge på dem.
- **Passer det hos oss?** Kanskje senere. Lav prioritet.

### 4.8 Maskot og personlighet

- **Hva:** En figur (som Duolingos ugle) som står for tonen i plattformen og e-postene.
- **Evidens:** Det finnes ingen god forskning på maskoter i læringsplattformer for voksne. Nærmeste
  er forskning på animerte «læringsagenter», som gir en liten, men målbar effekt på læring.
  Effekten er større for barn enn for voksne
  ([Schroeder, Adesope & Gilbert 2013](https://doi.org/10.2190/EC.49.1.a)). Duolingos ugle virker
  først og fremst som merkevare og markedsføring. Det er ikke dokumentert at den bidrar til læring.
  Skyldappeller har liten effekt og kan slå tilbake når de er eksplisitte
  ([Peng m.fl. 2023](https://www.frontiersin.org/articles/10.3389/fpsyg.2023.1201631)).
- **Risiko:** Barnslig for fagfolk i en rådgivningsbedrift. Lett å gli over i skyld («Duo er lei seg»).
  Avsenderen er arbeidsgiver, så skyld fra maskoten blir skyld fra arbeidsgiver **(tolkning)**. Må
  fungere på bokmål, nynorsk og engelsk.
- **Utforming hvis vi bruker det:**
  - Varm, saklig og litt humoristisk, aldri skuffet.
  - Brukes til å feire («Gratulerer med kursbeviset!») og til å gi oversikt, ikke til å mase.
  - Liten plass, lett å overse.
  - Test med noen ansatte før lansering.
- **Passer det hos oss?** Valgfritt, og ikke det første vi bør bygge. «Savner deg»-varianten frarådes.

### 4.9 Påminnelser og «vi savner deg»-meldinger

Se kapittel 6 for e-posten. Hovedpunkter:

- **Frekvens:** Én gang i uka er øvre grense for motivasjons-e-post. Fristvarsler kommer i tillegg,
  men bare når noe faktisk nærmer seg.
- **Tone:** Informativ, ikke skyld. Ingen «vi savner deg» og ingen «du har ikke vært her på X dager».
- **Utmattelse:** Samme tekst hver uke slites ut ([Yancey & Settles 2020](https://research.duolingo.com/papers/yancey.kdd20.pdf)).
  Stopp eller tynn ut automatisk når e-posten ikke fører til noe på flere uker (som Duolingo gjør).
- **Avmelding:** Den motiverende ukesoversikten bør kunne slås av. Fristvarsler for pliktige kurs er
  instruks fra arbeidsgiver og kan fortsette.

### 4.10 Kvalitet framfor kvantitet

Her er mulighetene for å belønne det som faktisk gir læring:

| Idé | Hva forskningen sier | Vurdering |
|---|---|---|
| **Poeng for bestått på første forsøk** | Feil er nyttige for læring, særlig med god tilbakemelding ([Metcalfe 2017](https://doi.org/10.1146/annurev-psych-010416-044022)). En bonus for første forsøk kan gjøre folk forsiktige, så de leser for mye eller utsetter testen. For KI-vurderte fritekstsvar kan det friste noen til å skrive «det KI vil ha». | **Frarådes.** |
| **Belønne revisjon etter tilbakemelding** («Bestått etter å ha forbedret svaret») | Tilbakemelding er blant det som påvirker læring mest, særlig når den brukes ([Hattie & Timperley 2007](https://doi.org/10.3102/003465430298487)). | **Anbefales**, for eksempel som et merke. |
| **Belønne å lese grundig** (minimumstid på seksjon) | Krever tidsmåling (kapittel 5), kan fakes og straffer raske lesere. | **Frarådes.** Bruk heller «Sjekk deg selv»-spørsmål som allerede finnes. |
| **Repetisjon og testing over tid** (spørsmål fra fullførte kurs etter noen uker) | Å hente fram det man har lært (testeffekten), er blant de best dokumenterte læringsstrategiene ([Roediger & Karpicke 2006](https://doi.org/10.1111/j.1467-9280.2006.01693.x); [Adesope m.fl. 2017, metaanalyse](https://doi.org/10.3102/0034654316689306)). | **Sterk kandidat**, også som innhold i ukesoversikten. Mer læringsforskning enn gamifisering. |
| **Mestring framfor innsats** (Khan Academys skille) | Innsatspoeng og mestringsmål bør holdes adskilt ([Khan Academy](https://support.khanacademy.org/hc/en-us/articles/202487710-What-are-energy-points-)). | **Anbefales** som prinsipp. |

### 4.11 Andre elementer verdt å vurdere

- **«Fortsett der du slapp»** og tydelig neste steg på forsiden. Å fjerne friksjon er ofte mer verdt
  enn å legge på motivasjon **(tolkning)**.
- **Fremdriftslinje per kurs.** Folk øker innsatsen når målet nærmer seg
  ([Kivetz m.fl. 2006](https://doi.org/10.1509/jmkr.43.1.39)).
- **Kompetansekart per tema.** Fremgang knyttet til tema i stedet for poeng gir mening og støtter
  medarbeidersamtaler, men bare hvis den ansatte selv velger å vise det.
- **Feiring ved ekte milepæler** (kursbevis, tema fullført). Positiv tilbakemelding styrker indre
  motivasjon ([Deci m.fl. 1999](https://doi.org/10.1037/0033-2909.125.6.627)).
- **Ny start mandag.** Ukesoversikt eller ukemål som begynner på nytt hver mandag
  ([Dai, Milkman & Riis 2014](https://doi.org/10.1287/mnsc.2014.1901)).
- **Felles klassemål** (se 4.6).
- **Ingen straff for feil.** Behold dagens anke og nye forsøk. Ikke innfør «liv» eller poengtap.
- **Ingen virtuell valuta, belønningsbokser eller butikk.** Gir ingenting for læring, og ligger nær
  det Forbrukerrådet har advart mot.

---

## 5. Tid brukt

### 5.1 Kan tid måles troverdig i en nettleser?

Kort svar: **Bare grovt, og med valg som endrer resultatet.**

- **Åpen fane er ikke lesing.** Nettleseren kan si om fanen er synlig
  ([Page Visibility API, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)),
  men ikke om personen leser, er i et møte, snakker med en kollega eller har gått for å hente kaffe.
- **Aktiv tid** (mus, tastatur, rulling) er bedre, men må bruke en grense for «inaktiv», for eksempel
  2, 5 eller 30 minutter. Den som leser en lang tekst uten å røre musa, blir «inaktiv». Den som
  flytter på musa uten å lese, blir «aktiv». Nettleserens egen måte å oppdage inaktivitet på krever
  tillatelse fra brukeren og er ikke tilgjengelig i alle nettlesere
  ([Idle Detection API, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Idle_Detection_API)).
- **Forskning:** Ulike måter å anslå tid på ga merkbart ulike konklusjoner i analyser av læring.
  Metoden blir sjelden rapportert ([Kovanović m.fl. 2015](https://doi.org/10.18608/jla.2015.23.6)).
- **Flere enheter, flere faner, utskrift og lesing i PDF** blir ikke fanget opp, eller blir telt
  dobbelt.

Feilmarginen er altså ikke bare noen prosent. Den kan være flere ganger den faktiske lesetiden, i
begge retninger **(tolkning, basert på kildene over)**.

### 5.2 Bør det måles eller vises?

**Anbefaling: nei.** Begrunnelse:

1. **Feil insentiv.** Tid belønner den som er treg og straffer den som kan stoffet. Det er det
   motsatte av det vi vil.
2. **Likner mest på overvåking.** Tid per ansatt er en klassisk «produktivitetsmåling»
   ([Datatilsynet om «bossware»](https://www.datatilsynet.no/personvern-pa-ulike-omrader/personvern-pa-arbeidsplassen/overvaking-av-ansattes-bruk-av-elektronisk-utstyr/nar-er-overvakingen-forbudt/)).
   Amazon ble bøtelagt i Frankrike blant annet for mål på inaktiv tid på håndskannere
   ([Le Club des juristes](https://www.leclubdesjuristes.com/en-bref/condamnation-de-amazon-france-logistique-afl-pour-surveillance-des-salaries-4535/)).
   Ifølge en fagkommentar ble boten senere satt ned til 15 millioner euro av Conseil d'État
   ([avgjørelse 23.12.2025](https://www.conseil-etat.fr/fr/arianeweb/CE/decision/2025-12-23/492830)).
   Den nøyaktige summen har jeg ikke bekreftet i selve avgjørelsen.
3. **Juss:** Hvis arbeidsgiver kan se tiden, er det trolig et kontrolltiltak, og det kan treffe
   overvåkingsforbudet i e-postforskriften (kapittel 8). Selv om bare den ansatte ser den, blir den
   lagret, og det må begrunnes (dataminimering).
4. **Lite å vinne.** Seksjoner, moduler og kurs sier mer om læring enn minutter.

**Alternativet: anslått tid.** Regn ut lesetid fra antall ord i seksjoner man har fullført (voksne
leser fagtekst i rundt 238 ord i minuttet, [Brysbaert 2019](https://doi.org/10.1016/j.jml.2019.104047)),
og legg til et fast anslag per modul. Da kan profilen si «ca. 3 timer læringsinnhold fullført denne
måneden» uten at noen blir målt. Det må tydelig stå at det er et anslag.

---

## 6. Ukentlig e-post uten lenker

### 6.1 Kan den virke uten lenker?

Ja, hvis den er en **nyttig oversikt** og ikke en invitasjon til å klikke. Uten lenker må e-posten
selv gi verdi: Hva har jeg i gang, hva har frist, hva er neste steg. Brukeren må vite hvor hen finner
plattformen («Åpne A-2 læringsplattform og gå til Mine kurs»). Det er sannsynlig at e-posten fører til
færre besøk enn en e-post med lenke. Det bør vi akseptere og måle på gruppenivå **(tolkning)**.

Forvent beskjedne effekter. Påminnelser og hjelp til å planlegge ga mer aktivitet de første ukene i
store nettkurs, men ikke flere som fullførte ([Kizilcec m.fl. 2020](https://doi.org/10.1073/pnas.1921417117)).

### 6.2 Anbefalinger

| Tema | Anbefaling | Grunnlag |
|---|---|---|
| **Frekvens** | Høyst én motiverende e-post i uka. Fristvarsler i tillegg, bare når en frist nærmer seg. | «Beskytt kanalen» ([Mazal 2023](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth)) |
| **Tidspunkt** | Mandag morgen, en «ny start» | [Dai, Milkman & Riis 2014](https://doi.org/10.1287/mnsc.2014.1901) |
| **Innhold** | 1) Frister de neste 14 dagene. 2) Kurs i gang med fremdrift («4 av 7 seksjoner»). 3) Eventuelt en ting å feire («Du fullførte kurset X»). 4) Eventuelt ett repetisjonsspørsmål. Kort. | Fremgang og nære mål motiverer ([Kivetz m.fl. 2006](https://doi.org/10.1509/jmkr.43.1.39)) |
| **Tone** | Nøytral og vennlig. Ingen skyld, ingen «savner deg», ingen «du har ikke vært innom på 3 uker». | [Silverman & Barasch 2023](https://doi.org/10.1093/jcr/ucac029); [Peng m.fl. 2023](https://www.frontiersin.org/articles/10.3389/fpsyg.2023.1201631) |
| **Personalisering** | Bare med den ansattes egne kurs og frister, på eget språk (outboxen gjør allerede det). Ikke sammenlign med kolleger. | |
| **Når ingenting er i gang** | Ikke send. Eventuelt en månedlig «nytt i katalogen». | Unngå støy |
| **Automatisk stopp** | Hvis e-posten ikke har ført til noe på for eksempel 4–6 uker: send sjeldnere, og si det i én nøytral setning. | Duolingos praksis, se 3.1 |
| **Avmelding** | Tydelig forklart i e-posten: «Du kan slå av denne oppsummeringen under Profil.» Fristvarsler for pliktige kurs kan ikke slås av, og det bør stå tydelig. | Frivillighet ([Mollick & Rothbard 2014](https://papers.ssrn.com/abstract=2277103)) |
| **Ingen sporing** | Ingen sporingspiksler eller måling av åpning. | Se under |
| **Variasjon** | Noen få ulike innledninger som byttes på. | [Yancey & Settles 2020](https://research.duolingo.com/papers/yancey.kdd20.pdf) |

**Sporing av åpning:** Det europeiske personvernrådet (EDPB) regner sporingspiksler i e-post som
omfattet av reglene om lagring av og tilgang til informasjon på brukerens utstyr
([EDPB Guidelines 2/2023, pkt. 47–51](https://www.edpb.europa.eu/system/files/documents/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf)).
I Norge står de reglene i ekomloven § 3-15. Å spore hvem som åpner e-post fra arbeidsgiver, ligner dessuten
på overvåking **(tolkning)**. Mål heller effekten på gruppenivå, for eksempel andel tildelte kurs
fullført innen frist før og etter.

### 6.3 Risiko for overvåking eller mas

- E-posten viser at plattformen *vet* hva den ansatte har gjort. Det er greit når det bare er den
  ansattes egne data sendt til den ansatte, men det bør stå i informasjonen til de ansatte.
- Den må ikke inneholde noe som tyder på at leder ser det samme («Lederen din har sett at …»).
- Ikke kopi til leder.
- Hvis e-posten nevner tid eller sammenligning med andre, blir den raskt opplevd som overvåking.

### 6.4 Eksempel på tone (bare for å illustrere, ikke design)

> **Uka di i A-2 læringsplattform**
>
> Frist snart: «Kvalitetssystemet vårt» – 15. november (2 seksjoner igjen)
>
> I gang: «Prosjektledelse grunnkurs» – 4 av 7 seksjoner, 1 av 2 tester
>
> Godt jobbet: Du fikk kursbevis i «Personvern i prosjekter» forrige uke.
>
> Du finner kursene under Mine kurs i A-2 læringsplattform.
> Vil du ikke ha denne oppsummeringen? Slå den av under Profil.

---

## 7. Hvordan måle om det virker, uten å overvåke

For å vite om et element virker uten å følge med på enkeltpersoner **(tolkning)**:

- Mål på **gruppenivå**: andel tildelte kurs fullført innen frist, andel påbegynte kurs som fullføres,
  beståtte moduler per måned. Ingen grupper under en minstestørrelse (for eksempel 10).
- Sammenlign før og etter, eller slå på for halvparten av klassene først. Det er også et
  kontrolltiltak hvis det er på personnivå, så hold det på gruppenivå.
- Spør de ansatte: en kort, anonym undersøkelse etter 2–3 måneder om de opplever det som nyttig,
  nøytralt eller mas.
- Planlegg for nyhetseffekten: Vurder først etter 8–12 uker
  ([Rodrigues m.fl. 2022](https://doi.org/10.1186/s41239-021-00314-6)).

---

## 8. Arbeidsrett og personvern i Norge

> Dette er ikke juridisk rådgivning. Kildene er lovtekst og veiledning fra Datatilsynet og
> Arbeidstilsynet. Der jeg anvender reglene på vår plattform, står det **(tolkning)**. Før vi bygger
> noe som lar arbeidsgiver se innsats per person, bør en jurist og personvernombudet (hvis selskapet
> har ett) vurdere det.

### 8.1 Kort svar

| Hvem ser hva | Kontrolltiltak (aml. kap. 9)? | E-postforskriften § 2? | GDPR |
|---|---|---|---|
| **Den ansatte ser egen statistikk, poeng og merker** | Trolig nei: arbeidsgiver kontrollerer ingen **(tolkning)** | Nei: arbeidsgiver har ikke tilgang ([Datatilsynet](https://www.datatilsynet.no/personvern-pa-ulike-omrader/personvern-pa-arbeidsplassen/overvaking-av-ansattes-bruk-av-elektronisk-utstyr/nar-er-overvakingen-forbudt/)) | Behandlingen må fortsatt ha grunnlag, formål og informasjon. Det er overkommelig. |
| **Kolleger ser plassering eller poeng** (tavle) | Usikkert. Arbeidsgiver driver systemet og *kan* se, og det er et styringssystem for arbeidet **(tolkning)** | Avhenger av om arbeidsgiver har tilgang | Deling med kolleger må ha grunnlag. Samtykke er tvilsomt i arbeidsforhold. |
| **Leder, rapportleser eller administrator ser innsats per person** (poeng, tid, aktivitet, plassering) | **Trolig ja** **(tolkning)** | **Kan treffes** (monitorering av bruk av elektronisk utstyr, arbeidsgiver har tilgang) **(tolkning)** | Krever berettiget interesse med en reell interesseavveining, informasjon, trolig DPIA |
| **Arbeidsgiver ser *om* pliktige kurs er fullført innen frist** | Ordinær oppfølging av instruks. Kan likevel være et kontrolltiltak, og bør i alle fall være drøftet og informert **(tolkning)** | Trolig ikke: det er resultatet av opplæringen, ikke bruk av utstyr **(tolkning)** | Berettiget interesse er naturlig |

### 8.2 Kontrolltiltak etter arbeidsmiljøloven kapittel 9

**Lovteksten:**

- [§ 9-1](https://lovdata.no/lov/2005-06-17-62/§9-1): Arbeidsgiver kan bare iverksette kontrolltiltak
  overfor arbeidstaker når tiltaket har **saklig grunn i virksomhetens forhold** og ikke innebærer en
  **uforholdsmessig belastning** for arbeidstakeren. Personopplysningsloven gjelder også.
- [§ 9-2](https://lovdata.no/lov/2005-06-17-62/§9-2): Arbeidsgiver skal **drøfte** behov, utforming,
  gjennomføring og vesentlige endringer med **tillitsvalgte så tidlig som mulig**. Berørte ansatte
  skal **informeres før tiltaket iverksettes** om formål, praktiske konsekvenser og antatt varighet.
  Behovet skal **evalueres jevnlig** sammen med tillitsvalgte.

**Hva er et kontrolltiltak?** Arbeidstilsynet sier at begrepet er ment å være vidt og omfatte et bredt
spekter av tiltak ([Arbeidstilsynet](https://www.arbeidstilsynet.no/arbeidstid-og-organisering/kontroll-og-overvakning/)).
Den felles veilederen fra Arbeidstilsynet, Datatilsynet, Petroleumstilsynet og partene i arbeidslivet
nevner blant annet **«produksjonskontroll og styringssystemer»** som eksempel
([veileder om kontroll og overvåking 2019](https://www.arbeidstilsynet.no/contentassets/04ec2eb566d44942bd6693e9e3a0c99e/veileder-om-kontroll-og-overvaking-2019.pdf)).
Saklighetskravet betyr at formålet må være forankret i driften, at tiltaket må være egnet, og at det
skal avsluttes når behovet er borte (samme veileder).

**Anvendt på oss (tolkning):** En oversikt der arbeidsgiver kan se hvor mye den enkelte har lært, hvor
ofte hen er innom, hvor lenge hen bruker eller hvor hen ligger i forhold til kolleger, er et verktøy
som er egnet til å kontrollere innsats. At formålet er «motivasjon», endrer ikke at tiltaket kan
brukes til kontroll. Det trekker mot at det er et kontrolltiltak. Det betyr ikke at det er forbudt,
men at kravene i § 9-1 og § 9-2 må oppfylles. Saklig grunn for å se *innsats* per person er vanskeligere
å begrunne enn for å se *om* pliktig opplæring er gjennomført.

**Andre regler i arbeidsmiljøloven:** Ansatte og tillitsvalgte skal holdes orientert om systemer som
brukes ved planlegging og gjennomføring av arbeidet, og medvirke i utformingen
([§ 4-2 første ledd](https://lovdata.no/lov/2005-06-17-62/§4-2)). Arbeidet skal legges til rette slik
at arbeidstakers integritet og verdighet ivaretas ([§ 4-3 tredje ledd](https://lovdata.no/lov/2005-06-17-62/§4-3)).
En navngitt poengtavle der noen havner sist blant kolleger, bør vurderes opp mot dette **(tolkning)**.

### 8.3 Forbudet mot å overvåke bruk av elektronisk utstyr (e-postforskriften § 2)

[E-postforskriften § 2 andre ledd](https://lovdata.no/forskrift/2018-07-02-1108/§2): Arbeidsgiver har
**ikke rett til å overvåke arbeidstakers bruk av elektronisk utstyr, herunder bruk av Internett**,
med mindre formålet er å administrere datanettverket eller å avdekke eller oppklare sikkerhetsbrudd.

Datatilsynet bruker tre vilkår. Er alle tre oppfylt, er hovedregelen at tiltaket er forbudt
([Datatilsynet](https://www.datatilsynet.no/personvern-pa-ulike-omrader/personvern-pa-arbeidsplassen/overvaking-av-ansattes-bruk-av-elektronisk-utstyr/nar-er-overvakingen-forbudt/)):

1. **Tiltaket er overvåking:** innsamling over tid eller gjentatt, for å kartlegge atferd. Logging kan
   være omfattet. En teoretisk mulighet er ikke nok.
2. **Det gjelder bruk av elektronisk utstyr:** PC, telefon, e-post, nettsider, programmer.
3. **Arbeidsgiver har tilgang til opplysningene.** Har arbeidsgiver ikke tilgang, gjelder ikke forbudet.

**Secure Practice-sandkassen er det nærmeste vi har en presedens.** Datatilsynet vurderte et
KI-verktøy for tilpasset sikkerhetsopplæring som blant annet registrerte **«aktivitet i
læringsplattformen»**. Konklusjonen var at kartleggingen *ikke* var omfattet av forbudet, og
Datatilsynet la **særlig vekt på de tekniske og juridiske tiltakene for at arbeidsgiver ikke skal få
tilgang til opplysningene om hver ansatt**. Statistikk til arbeidsgiver på gruppenivå «vil lettere
kunne oppleves som overvåking» og må utformes slik at enkeltpersoner ikke kan identifiseres. Det
anbefales også å drøfte den med de ansatte på forhånd. Rapporten tok ikke stilling til arbeidsmiljøloven
kapittel 9 ([sluttrapport 2022, kap. 4.2](https://www.datatilsynet.no/contentassets/081aa7894f2546c48abd32752d207d96/sluttrapport_secure-practice.pdf);
[engelsk sammendrag](https://www.datatilsynet.no/en/regulations-and-tools/reports-on-specific-subjects/reports/secure-practice-adapted-security-training/)).

**Anvendt på oss (tolkning):** Systematisk logging av tid, besøk og aktivitet per ansatt i
plattformen, som arbeidsgiverroller kan se, kan oppfylle alle tre vilkårene. Det er ikke avklart om
bruk av ett bestemt fagsystem regnes som «bruk av elektronisk utstyr» på samme måte som nettlesing
og e-post. Men Datatilsynet nevner selv måling av hvilke programmer som brukes, som eksempel på
«bossware» (samme side). Risikoen er reell nok til at vi bør unngå å gi arbeidsgiver innsyn i innsats
per person.

### 8.4 GDPR og personopplysningsloven

- **Rettslig grunnlag:** I arbeidsforhold er **berettiget interesse** ([art. 6 nr. 1 f](https://lovdata.no/lov/2018-06-15-38))
  det vanligste. Det krever en reell avveining der de ansattes interesser veier tungt på grunn av
  maktforholdet. I Secure Practice-saken sier Datatilsynet at hensynet til de ansatte «veier tungt»
  ([sluttrapport](https://www.datatilsynet.no/contentassets/081aa7894f2546c48abd32752d207d96/sluttrapport_secure-practice.pdf)).
- **Samtykke:** Arbeidsgiver kan som klar hovedregel ikke bruke samtykke
  ([Datatilsynet](https://www.datatilsynet.no/regelverk-og-verktoy/rapporter-og-utredninger/sjefen-ser-deg-overvaking-og-kontroll-av-arbeidstakeres-digitale-aktiviteter/hvilke-regler-gjelder/)).
  EDPB: Ansatte kan bare gi fritt samtykke i unntakstilfeller, **når det ikke får noen negative følger
  overhodet** om de sier ja eller nei. Eksempelet er et filmopptak der de som ikke vil være med, får en
  annen pult ([EDPB 05/2020, pkt. 21–23](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf);
  [WP29 Opinion 2/2017](https://ec.europa.eu/newsroom/article29/redirection/item/610169)).
  **Tolkning:** En helt valgfri funksjon (for eksempel å vise kursbevisene sine for kolleger) *kan*
  bygge på samtykke hvis det å si nei ikke har noen følger og ingen leder ser hvem som sa nei. Men det
  er tryggest å bygge på berettiget interesse og i tillegg gi de ansatte en reell **valgfrihet i
  løsningen** (bryter for å slå av). Frivillighet i løsningen er noe annet enn samtykke som
  rettslig grunnlag.
- **Formålsbegrensning:** Data samlet inn for ett formål kan ikke brukes til et nytt formål som ikke
  er forenlig. Datatilsynet bruker selv eksempelet at ansatte sjelden forventer at et program for å
  registrere arbeidstid blir brukt til å måle hvor effektive de er
  ([Datatilsynet](https://www.datatilsynet.no/regelverk-og-verktoy/rapporter-og-utredninger/sjefen-ser-deg-overvaking-og-kontroll-av-arbeidstakeres-digitale-aktiviteter/hvilke-regler-gjelder/)).
  **Tolkning:** Data som er samlet inn for å «hjelpe deg å lære», bør ikke senere brukes i
  medarbeidersamtaler eller vurdering uten et nytt grunnlag. Det bør stå skriftlig fra start. Det er
  verdt å merke seg at rapportleser i dag er beskrevet som en mentor som skal kunne følge opp
  kompetansemål fra medarbeidersamtaler (`doc/DECISIONS.md`). Hvis rapportleseren får se innsatsdata,
  ligger gjenbruk i vurdering nær.
- **Dataminimering:** Ikke samle mer enn formålet krever. Tid per person er vanskelig å begrunne når
  anslått tid gjør samme nytte (kapittel 5).
- **Innsyn og informasjon:** De ansatte skal informeres om hva som samles inn, hvorfor og hvem som ser
  det (art. 13), og har rett til innsyn i egne data (art. 15). En profilside med egen statistikk
  dekker en god del av innsynsretten i praksis.
- **Rett til å protestere:** Når grunnlaget er berettiget interesse, kan den ansatte protestere (art.
  21). Det må vurderes konkret ([sluttrapport Secure Practice](https://www.datatilsynet.no/contentassets/081aa7894f2546c48abd32752d207d96/sluttrapport_secure-practice.pdf)).
  En bryter for å slå av spillelementene gjør dette enkelt.
- **Innebygd personvern (art. 25):** Standardinnstillingen skal være den mest personvernvennlige.
  Datatilsynet ber arbeidsgivere om ikke å stole på at programvare er laget for norsk lov
  ([Datatilsynet, råd til arbeidsgiveren](https://www.datatilsynet.no/regelverk-og-verktoy/rapporter-og-utredninger/sjefen-ser-deg-overvaking-og-kontroll-av-arbeidstakeres-digitale-aktiviteter/rad-til-arbeidsgiveren/)).
- **DPIA:** Datatilsynets liste over behandlinger som **alltid** krever DPIA, har med
  **«systematisk monitorering av ansatte»** ([Datatilsynet](https://www.datatilsynet.no/rettigheter-og-plikter/virksomhetenes-plikter/vurdere-personvernkonsekvenser/vurdering-av-personvernkonsekvenser/nar-ma-man-gjennomfore-en-vurdering-av-personvernkonsekvenser/)).
  **Tolkning:** Innsatsstatistikk som arbeidsgiver ser, er trolig dette. Statistikk som bare den
  ansatte ser, er det trolig ikke, men en kort vurdering er uansett lur.

### 8.5 Hva Datatilsynet sier om måling og rangering av ansatte

- Ansatte har rett til personvern på jobb. Skjult overvåking er ulovlig. Arbeidsgiver må vurdere
  både personvernreglene og arbeidsmiljøloven, involvere personvernombud og tillitsvalgte og ikke stole
  på at programvaren er lovlig ([«Sjefen ser deg?»](https://www.datatilsynet.no/regelverk-og-verktoy/rapporter-og-utredninger/sjefen-ser-deg-overvaking-og-kontroll-av-arbeidstakeres-digitale-aktiviteter/rad-til-arbeidsgiveren/)).
- **Rangering spesifikt:** Jeg fant **ingen egen veiledning fra Datatilsynet om poengtavler eller
  rangering av ansatte.** Det nærmeste er Secure Practice-rapporten. Der advarte Likestillings- og
  diskrimineringsombudet mot at de med best score skulle bli «ambassadører», fordi det kunne gi dem
  bedre karriereutvikling hvis arbeidsgiver så hver enkelt score. Det kunne også gi indirekte
  diskriminering hvis verktøyet belønnet egenskaper som er vanligere i enkelte grupper
  ([sluttrapport, kap. 4.5](https://www.datatilsynet.no/contentassets/081aa7894f2546c48abd32752d207d96/sluttrapport_secure-practice.pdf)).
  **Tolkning:** Den samme risikoen gjelder poengtavler. Den som har mest tid (uten små barn, uten
  kundepress, i full stilling), får flest poeng.

### 8.6 Egen statistikk mot statistikk andre ser

| | Den ansatte ser sin egen | Kolleger ser | Leder eller arbeidsgiverrolle ser |
|---|---|---|---|
| Juridisk risiko | Lav | Middels | Høy |
| Tillit | Styrker («nyttig for meg») | Avhenger av om det er frivillig | Svekker («blir jeg målt?») |
| Motivasjonsforskning | Støtter mestring og valgfrihet | Sosial sammenligning hjelper noen og skader andre | Oppleves som kontroll, kan fortrenge indre motivasjon ([Deci m.fl. 1999](https://doi.org/10.1037/0033-2909.125.6.627)) |
| Hva kreves | Informasjon og formål | Grunnlag, valgfrihet, minstestørrelse | Saklig grunn, forholdsmessighet, drøfting, informasjon, evaluering, DPIA |

### 8.7 Anonym plassering i en liten klasse

GDPR gjelder opplysninger om personer som kan **identifiseres**, også indirekte, med midler som
«med rimelighet» kan tenkes brukt ([fortalepunkt 26](https://gdpr-info.eu/recitals/no-26/)).
**Tolkning** for «posisjon uten navn»:

- I en klasse på 8 der alle kjenner hverandre, avslører én samtale («jeg ligger på 1. plass») mye. To
  eller tre slike samtaler, og resten faller på plass.
- Den som ligger nederst, vet det selv. Det er nettopp den personen tavla belaster mest
  ([Bai m.fl. 2021](https://doi.org/10.1016/j.compedu.2021.104297)).
- Endringer over tid kan avsløre: «Kari var på kurs i går, og nå har noen hoppet tre plasser.»
- Den som administrerer plattformen, kan se alt i databasen uansett.
- Bransjen bruker minimum fem personer for å vise *samlede* tall til ledere
  ([Microsoft Viva Insights](https://learn.microsoft.com/en-us/viva/insights/advanced/setup-maint/privacy-settings)).
  Det gjelder gjennomsnitt, ikke rangering. En rangering er alltid opplysninger om enkeltpersoner.

Konklusjon: Anonym plassering i små klasser er **ikke anonym** i juridisk forstand, og i praksis heller
ikke. Felles klassemål uten rangering, med en minstestørrelse, er et tryggere alternativ.

### 8.8 Konsekvens for den eksisterende «Aktivitet»-fanen (#1099)

`doc/DECISIONS.md` (2026-10-15) sier at administrator og rapportleser ser «sist sett» og hendelsene til
hver deltaker, begrunnet med at «dette er et internt kompetanseverktøy, vi bruker persondata i
henhold til intensjon». **Tolkning:** Det er et godt utgangspunkt for et formål, men loven krever at
formålet er skrevet ned **før** innsamlingen, at de ansatte er **informert** om det, at et tiltak som
er egnet til kontroll er **drøftet** med tillitsvalgte, og at innsynet er **forholdsmessig**. «Sist
sett» og hendelseslogg per ansatt som arbeidsgiverroller kan se, ligger nær det Datatilsynet beskriver
som overvåking av bruk av elektronisk utstyr (8.3). Hvis gamifiseringen legger til poeng, tid eller
rangering i det samme synet, øker risikoen. Den bør i alle fall vurderes i samme runde. Jeg anbefaler
ikke å endre noe nå, bare at dette tas med i den juridiske vurderingen før design.

### 8.9 KI-forordningen (kort)

EUs KI-forordning regner KI-systemer som skal **vurdere læringsutbytte** (vedlegg III punkt 3 b), og
KI-systemer som skal **overvåke og vurdere ytelse og atferd hos ansatte** (punkt 4 b), som
høyrisiko ([vedlegg III](https://artificialintelligenceact.eu/annex/3/)). Forordningen er ikke norsk
lov ennå. Ifølge sekundærkilder ventes den tidligst i 2027
([CMS](https://cms.law/no/nor/publikasjon/teknologinytt-hva-er-kunstig-intelligens-reguleringen-ai-act-og-naar-blir-den-norsk-lov)).
**Tolkning:** Plattformen bruker allerede KI til å vurdere fritekstsvar. Hvis resultatene fra
KI-vurderingen blir grunnlag for poeng eller rangering som arbeidsgiver ser, nærmer vi oss
punkt 4 b. Det er ett argument til for å holde poengene private. Dette bør undersøkes nærmere hvis
det blir aktuelt, og er utenfor denne researchen.

### 8.10 Hva er tolkning, og hva er avklart?

- **Avklart i lov og veiledning:** kravene i aml. §§ 9-1 og 9-2; forbudet i e-postforskriften § 2
  og Datatilsynets tre vilkår; at samtykke som hovedregel ikke holder i arbeidsforhold; at systematisk
  monitorering av ansatte står på DPIA-lista; formålsbegrensning.
- **Tolkning (min):** at innsatsstatistikk som arbeidsgiver ser, er et kontrolltiltak; at det kan treffe
  e-postforskriften; at statistikk som bare den ansatte ser, går klar; at anonym plassering i små
  klasser er personopplysninger; at sporingspiksler i intern e-post er omfattet av ekomloven § 3-15.
- **Ikke funnet:** veiledning fra Datatilsynet om poengtavler eller rangering; norske avgjørelser om
  gamifisering på jobb; studier av poengtavler som ledere ser i en LMS for ansatte.

---

## 9. Kilder

### Forskning: gamifisering, motivasjon og læring

- Adesope, O. O., Trevisan, D. A. & Sundararajan, N. (2017). Rethinking the use of tests: A meta-analysis of practice testing. *Review of Educational Research*. https://doi.org/10.3102/0034654316689306
- Bai, S., Hew, K. F. & Huang, B. (2020). Does gamification improve student learning outcome? Meta-analysis. *Educational Research Review*. https://doi.org/10.1016/j.edurev.2020.100322
- Bai, S., Hew, K. F., Sailer, M. & Jia, C. (2021). From top to bottom: How positions on different types of leaderboard may affect fully online student learning performance, intrinsic motivation, and course engagement. *Computers & Education* 173. https://doi.org/10.1016/j.compedu.2021.104297
- Baker, R. S., Corbett, A. T., Koedinger, K. R. & Roll, I. (2005). Detecting when students game the system, across tutor subjects and classroom cohorts. https://learninganalytics.upenn.edu/ryanbaker/BCKR2005Final.pdf
- Beshears, J., Lee, H. N., Milkman, K. L., Mislavsky, R. & Wisdom, J. (2021). Creating exercise habits using incentives: The trade-off between flexibility and routinization. *Management Science* 67(7). https://doi.org/10.1287/mnsc.2020.3706
- Brysbaert, M. (2019). How many words do we read per minute? A review and meta-analysis of reading rate. *Journal of Memory and Language*. https://doi.org/10.1016/j.jml.2019.104047
- Cerasoli, C. P., Nicklin, J. M. & Ford, M. T. (2014). Intrinsic motivation and extrinsic incentives jointly predict performance: A 40-year meta-analysis. *Psychological Bulletin* 140(4). https://doi.org/10.1037/a0035661
- Christy, K. R. & Fox, J. (2014). Leaderboards in a virtual classroom: A test of stereotype threat and social comparison explanations for women's math performance. *Computers & Education* 78. https://doi.org/10.1016/j.compedu.2014.05.005
- Dai, H., Milkman, K. L. & Riis, J. (2014). The fresh start effect. *Management Science* 60(10). https://doi.org/10.1287/mnsc.2014.1901
- Deci, E. L., Koestner, R. & Ryan, R. M. (1999). A meta-analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation. *Psychological Bulletin* 125(6). https://doi.org/10.1037/0033-2909.125.6.627
- Hamari, J. (2017). Do badges increase user activity? A field experiment on the effects of gamification. *Computers in Human Behavior* 71. https://doi.org/10.1016/j.chb.2015.03.036
- Hamari, J., Koivisto, J. & Sarsa, H. (2014). Does gamification work? A literature review of empirical studies on gamification. *HICSS*. https://doi.org/10.1109/HICSS.2014.377
- Hanus, M. D. & Fox, J. (2015). Assessing the effects of gamification in the classroom: A longitudinal study. *Computers & Education* 80. https://doi.org/10.1016/j.compedu.2014.08.019
- Harkin, B. m.fl. (2016). Does monitoring goal progress promote goal attainment? A meta-analysis of the experimental evidence. *Psychological Bulletin* 142(2). https://doi.org/10.1037/bul0000025
- Hattie, J. & Timperley, H. (2007). The power of feedback. *Review of Educational Research* 77(1). https://doi.org/10.3102/003465430298487
- Höllig, C. E., Tumasjan, A. & Welpe, I. M. (2020). Individualizing gamified systems: The role of trait competitiveness and leaderboard design. *Journal of Business Research* 106. https://doi.org/10.1016/j.jbusres.2018.10.046
- Huang, R. m.fl. (2020). The impact of gamification in educational settings on student learning outcomes: a meta-analysis. *ETR&D* 68. https://doi.org/10.1007/s11423-020-09807-z
- Kim, T. W. & Werbach, K. (2016). More than just a game: ethical issues in gamification. *Ethics and Information Technology* 18(2). https://doi.org/10.1007/s10676-016-9401-5
- Kim, T. W. (2026). When work becomes a game: the moral costs of gamified labor (omtale). https://www.cmu.edu/tepper/news/stories/workplace-gamification-erodes-moral-agency
- Kivetz, R., Urminsky, O. & Zheng, Y. (2006). The goal-gradient hypothesis resurrected. *Journal of Marketing Research* 43(1). https://doi.org/10.1509/jmkr.43.1.39
- Kizilcec, R. F. m.fl. (2020). Scaling up behavioral science interventions in online education. *PNAS* 117. https://doi.org/10.1073/pnas.1921417117
- Kovanović, V. m.fl. (2015). Does time-on-task estimation matter? Implications on validity of learning analytics findings. *Journal of Learning Analytics* 2(3). https://doi.org/10.18608/jla.2015.23.6
- Kratochvíl m.fl. (2025). Gamified goal-setting: leaderboards effects differ across quantitative, qualitative, and perceived performance. *Learning and Individual Differences*. https://www.muni.cz/en/research/publications/2495997
- Kyewski, E. & Krämer, N. C. (2018). To gamify or not to gamify? An experimental field study of the influence of badges on motivation, activity, and performance in an online learning course. *Computers & Education*. https://doi.org/10.1016/j.compedu.2017.11.006
- Landers, R. N., Bauer, K. N. & Callan, R. C. (2017). Gamification of task performance with leaderboards: A goal setting experiment. *Computers in Human Behavior* 71. https://experts.umn.edu/en/publications/gamification-of-task-performance-with-leaderboards-a-goal-setting/
- Lepper, M. R., Greene, D. & Nisbett, R. E. (1973). Undermining children's intrinsic interest with extrinsic reward. *Journal of Personality and Social Psychology* 28(1). https://doi.org/10.1037/h0035519
- Locke, E. A. & Latham, G. P. (2002). Building a practically useful theory of goal setting and task motivation. *American Psychologist* 57(9). https://doi.org/10.1037/0003-066X.57.9.705
- Mekler, E. D., Brühlmann, F., Tuch, A. N. & Opwis, K. (2017). Towards understanding the effects of individual gamification elements on intrinsic motivation and performance. *Computers in Human Behavior* 71. https://doi.org/10.1016/j.chb.2015.08.048
- Metcalfe, J. (2017). Learning from errors. *Annual Review of Psychology* 68. https://doi.org/10.1146/annurev-psych-010416-044022
- Milkman, K. L. m.fl. (2021). Megastudies improve the impact of applied behavioural science. *Nature* 600. https://doi.org/10.1038/s41586-021-04128-4
- Mogavi, R. H. m.fl. (2022). When gamification spoils your learning: A qualitative case study of gamification misuse in a language-learning app. *Learning @ Scale '22*. https://arxiv.org/abs/2203.16175
- Mollick, E. & Rothbard, N. (2014). Mandatory fun: Consent, gamification and the impact of games at work. SSRN. https://papers.ssrn.com/abstract=2277103 (omtale: https://knowledge.wharton.upenn.edu/article/gamification-powering-game/)
- Peng, L. m.fl. (2023). When guilt works: a comprehensive meta-analysis of guilt appeals. *Frontiers in Psychology*. https://www.frontiersin.org/articles/10.3389/fpsyg.2023.1201631
- Rodrigues, L. m.fl. (2022). Gamification suffers from the novelty effect but benefits from the familiarization effect. *IJETHE* 19. https://doi.org/10.1186/s41239-021-00314-6
- Roediger, H. L. & Karpicke, J. D. (2006). Test-enhanced learning. *Psychological Science* 17(3). https://doi.org/10.1111/j.1467-9280.2006.01693.x
- Ryan, R. M. & Deci, E. L. (2000). Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being. *American Psychologist* 55(1). https://doi.org/10.1037/0003-066X.55.1.68
- Sailer, M. & Homner, L. (2020). The gamification of learning: a meta-analysis. *Educational Psychology Review* 32. https://doi.org/10.1007/s10648-019-09498-w (åpen versjon: https://opus.bibliothek.uni-augsburg.de/opus4/frontdoor/index/index/docId/109056)
- Sailer, M., Hense, J. U., Mayr, S. K. & Mandl, H. (2017). How gamification motivates: An experimental study of the effects of specific game design elements on psychological need satisfaction. *Computers in Human Behavior* 69. https://doi.org/10.1016/j.chb.2016.12.033
- Schroeder, N. L., Adesope, O. O. & Gilbert, R. B. (2013). How effective are pedagogical agents for learning? A meta-analytic review. *Journal of Educational Computing Research* 49(1). https://doi.org/10.2190/EC.49.1.a
- Silverman, J. & Barasch, A. (2023). On or off track: How (broken) streaks affect consumer decisions. *Journal of Consumer Research* 49(6). https://doi.org/10.1093/jcr/ucac029 (omtale: https://www.colorado.edu/business/faculty-research/2023/04/19/or-track-how-broken-streaks-affect-consumer-decisions)
- Gjennomgang av gamifisering for ansatte (2025). *Journal of Workplace Learning* 37(9). https://www.emerald.com/jwl/article/37/9/206/1326647/Exploring-the-impact-of-gamification-on-employee

### Duolingo og andre plattformer

- Duolingo-bloggen (2020). Improving the streak. https://blog.duolingo.com/improving-the-streak
- Mazal, J. (2023). How Duolingo reignited user growth. *Lenny's Newsletter*. https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth
- Shuttleworth, J. (Lenny's Podcast). Behind the product: Duolingo streaks. https://www.lennysnewsletter.com/p/behind-the-product-duolingo-streaks
- Yancey, K. P. & Settles, B. (2020). A sleeping, recovering bandit algorithm for optimizing recurring notifications. *KDD '20*. https://research.duolingo.com/papers/yancey.kdd20.pdf
- Deconstructor of Fun: Duolingo leagues (sekundærkilde). https://duolingo.deconstructoroffun.com/mechanics/leagues
- Daily Dot: Duolingo owl memes. https://www.dailydot.com/irl/duolingo-owl-memes/
- uxdesign.cc: 20 days of emotional blackmail from Duolingo (meningsartikkel). https://uxdesign.cc/20-days-of-emotional-blackmail-from-duolingo-4f566523e3c5
- TU/e Cursor: Guilt-tripped by an owl (meningsartikkel). https://cursor.tue.nl/en/opinion/alain-starke/guilt-tripped-by-an-owl
- Forbrukerrådet (2018). Deceived by Design. https://storage02.forbrukerradet.no/media/2018/06/2018-06-27-deceived-by-design-final.pdf
- Microsoft Learn FAQ (XP, nivåer, merker, trofeer). https://learn.microsoft.com/en-us/training/support/faq
- Salesforce Trailhead: terminologi og poeng. https://help.salesforce.com/s/articleView?id=005299079&type=1&language=en_US ; Superbadge. https://help.salesforce.com/s/articleView?id=005299049&language=en_US&type=1
- Khan Academy: What are energy points? https://support.khanacademy.org/hc/en-us/articles/202487710-What-are-energy-points-
- LinkedIn Learning: ukemål. https://www.linkedin.com/help/linkedin/answer/a704926
- Microsoft Viva Insights: personvern og minste gruppestørrelse. https://learn.microsoft.com/en-us/viva/insights/advanced/setup-maint/privacy-settings
- PCWorld (2020): Microsoft fjerner navn fra Productivity Score. https://www.pcworld.com/article/393770/microsoft-tweaks-its-productivity-score-removing-employee-names-to-preserve-privacy.html

### Tidsmåling

- MDN: Page Visibility API. https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- MDN: Idle Detection API. https://developer.mozilla.org/en-US/docs/Web/API/Idle_Detection_API

### Lov, forskrift og veiledning (Norge og EU)

- Arbeidsmiljøloven § 9-1. https://lovdata.no/lov/2005-06-17-62/§9-1
- Arbeidsmiljøloven § 9-2. https://lovdata.no/lov/2005-06-17-62/§9-2
- Arbeidsmiljøloven § 4-2 og § 4-3. https://lovdata.no/lov/2005-06-17-62/§4-2 og https://lovdata.no/lov/2005-06-17-62/§4-3
- Forskrift om arbeidsgivers innsyn i e-postkasse og annet elektronisk lagret materiale (FOR-2018-07-02-1108) § 2. https://lovdata.no/forskrift/2018-07-02-1108/§2
- Personopplysningsloven med personvernforordningen (GDPR). https://lovdata.no/lov/2018-06-15-38
- GDPR fortalepunkt 26 (identifiserbarhet). https://gdpr-info.eu/recitals/no-26/
- Arbeidstilsynet: Kontroll og overvåking. https://www.arbeidstilsynet.no/arbeidstid-og-organisering/kontroll-og-overvakning/
- Arbeidstilsynet, Datatilsynet, Petroleumstilsynet og partene i arbeidslivet (2019). Veileder om kontroll og overvåking i arbeidslivet. https://www.arbeidstilsynet.no/contentassets/04ec2eb566d44942bd6693e9e3a0c99e/veileder-om-kontroll-og-overvaking-2019.pdf
- Datatilsynet: Når er overvåkingen forbudt? https://www.datatilsynet.no/personvern-pa-ulike-omrader/personvern-pa-arbeidsplassen/overvaking-av-ansattes-bruk-av-elektronisk-utstyr/nar-er-overvakingen-forbudt/
- Datatilsynet: «Sjefen ser deg?» – Hvilke regler gjelder? https://www.datatilsynet.no/regelverk-og-verktoy/rapporter-og-utredninger/sjefen-ser-deg-overvaking-og-kontroll-av-arbeidstakeres-digitale-aktiviteter/hvilke-regler-gjelder/
- Datatilsynet: «Sjefen ser deg?» – Hva opplever arbeidstakerne? https://www.datatilsynet.no/regelverk-og-verktoy/rapporter-og-utredninger/sjefen-ser-deg-overvaking-og-kontroll-av-arbeidstakeres-digitale-aktiviteter/hva-opplever-arbeidstakerne/
- Datatilsynet: «Sjefen ser deg?» – Råd til arbeidsgiveren. https://www.datatilsynet.no/regelverk-og-verktoy/rapporter-og-utredninger/sjefen-ser-deg-overvaking-og-kontroll-av-arbeidstakeres-digitale-aktiviteter/rad-til-arbeidsgiveren/
- Datatilsynet (2022). Sluttrapport fra sandkasseprosjektet med Secure Practice. https://www.datatilsynet.no/contentassets/081aa7894f2546c48abd32752d207d96/sluttrapport_secure-practice.pdf (engelsk sammendrag: https://www.datatilsynet.no/en/regulations-and-tools/reports-on-specific-subjects/reports/secure-practice-adapted-security-training/)
- Datatilsynet: Når må man gjennomføre en vurdering av personvernkonsekvenser? (DPIA-lista). https://www.datatilsynet.no/rettigheter-og-plikter/virksomhetenes-plikter/vurdere-personvernkonsekvenser/vurdering-av-personvernkonsekvenser/nar-ma-man-gjennomfore-en-vurdering-av-personvernkonsekvenser/
- EDPB (2020). Guidelines 05/2020 on consent, pkt. 21–23. https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf
- EDPB Guidelines 2/2023 on the technical scope of Art. 5(3) of the ePrivacy Directive (sporingspiksler). https://www.edpb.europa.eu/system/files/documents/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf
- Artikkel 29-gruppen (2017). Opinion 2/2017 on data processing at work (WP249). https://ec.europa.eu/newsroom/article29/redirection/item/610169
- KI-forordningen, vedlegg III. https://artificialintelligenceact.eu/annex/3/
- CMS: Når blir AI Act norsk lov? https://cms.law/no/nor/publikasjon/teknologinytt-hva-er-kunstig-intelligens-reguleringen-ai-act-og-naar-blir-den-norsk-lov
- CNIL mot Amazon France Logistique (omtale). https://www.leclubdesjuristes.com/en-bref/condamnation-de-amazon-france-logistique-afl-pour-surveillance-des-salaries-4535/ ; Conseil d'État 23.12.2025, nr. 492830. https://www.conseil-etat.fr/fr/arianeweb/CE/decision/2025-12-23/492830

### Internt

- `doc/DECISIONS.md`: «Aktivitet» under Deltakere (#1099), rollene SMO og REPORT_READER (2026-08-23), «Tilgangen står åpen mens den måles» (#1000).
- `doc/FEATURE_SURFACE_MAP.md`: rollesett (`REPORT_READERS`, `SUBMISSION_AUDIT_READERS`), profilsiden.
