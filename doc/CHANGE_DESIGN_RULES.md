# Designregler for endringer

Skrevet 30.08.2026, etter at #1027 tok seks QA-runder og fire versjoner. Fem av rundene fant feil
som ble innført i runden før.

Reglene er ikke generelle gode råd. Hver av dem svarer på en feil som faktisk har skjedd, og
nevner den.

---

## 1. Designnotat før enhver ikke-triviell endring

Før første kodelinje, skriv ned tre ting. Femten til tjue minutter.

**a) Rekkevidde.** Ikke «hvilke filer nevner dette», men **hvem leser dataene**. List hver flate,
hver leser, hver parser.

**b) Mønsteret.** Én måte å løse det på, som skal brukes overalt. Ikke én løsning per sted.

**c) Testformen.** Hvordan ser en test ut som blir rød hvis dette brytes? Skriv formen før koden.

> ⚠️ #1027 ble beskrevet som tre flater. Det var seks flater, fire klientparsere, to søkefiltre og
> en dokumentert kontrakt. Jeg fant dem én om gangen, over fem QA-runder. Listen kunne vært skrevet
> på tjue minutter.

---

## 2. Samme feil på N steder gir samme kode på N steder

Løses samme problem flere steder, skal det være **den samme koden**. Er den ulik, skal forskjellen
begrunnes i en kommentar på stedet.

> ⚠️ #1027 runde 3: `review.js` fikk en ordentlig språkvakt, `results.js` fikk bare et flagg. Samme
> feil, to flater, to kvaliteter på fiksen — og bare den ene ble prøvd.
>
> ⚠️ Runde 5: profilens *oppdatering* fikk kappløpsvakt, profilens *førstehenting* fikk den ikke.

---

## 3. Mutasjonsverifiser hver fiks for seg, med et tall per fiks

Ikke skriv «mutasjonsverifisert» om et sett. Skriv hvor mange røde hver enkelt fiks ga.

Disiplinen: ta **filkopi** først, mutér, krev rødt, gjenopprett **fra kopien**, kjør på nytt for å
bevise at gjenopprettingen virket.

> ⚠️ #1027 2.49.0 sa «alle mutasjonsverifisert». QA-porten fjernet språksjekken i vakta, og enhet
> 1306, DOM 6 og e2e forble grønne — ingen test åpnet `/results` overhodet. Jeg hadde verifisert de
> fiksene som *hadde* tester og generalisert til hele settet.
>
> Det gjentok seg i runde 5 (`titleSearch` på klienten, 285/285 grønt) og runde 6 (klagekøens
> filter, 289/289 grønt).

---

## 4. En test som aldri har vært rød, har ikke bevist noe

Skriv testen før fiksen der det går. Går det ikke, mutér etterpå — men aldri stol på at en grønn
test måler det den heter.

Kjente måter en test kan være grønn uten å måle noe, alle fra #1027:

- `if (x) expect(...)` — hopper over seg selv når data mangler
- en løkke over data testen ikke selv lager — tom liste er null runder, og null runder er grønt
- en CSS-velger som ikke finnes — `toHaveCount(0)` er sann uansett
- en duplisert test som aldri ble slettet
- en kappløpstest som måler før det **trege** svaret har landet
- en flate uten noen test i det hele tatt

---

## 5. Et funn i samme runde som en endring sjekkes mot `main`

Før noe meldes som en **eksisterende** svakhet: `git log -S '<uttrykket>'` eller diff mot `main`.

> ⚠️ #1039 ble skrevet som en gammel svakhet i mock-innloggingens standardroller. Kallstien kom med
> min egen commit i samme leveranse. Med ekte pålogging ga den 401 og rød feilmelding ved hver
> sidelasting, og lå ute på stage i tre versjoner.
>
> Sveipet spør «hvem andre gjør dette». Det må også spørre «lagde jeg dette nettopp».

---

## 6. Flytter du et ansvar, let etter lesere — ikke etter kallere

Når en endring flytter **hvem som eier en avgjørelse**, slutter kode som antok den gamle ordningen
stille å virke. Den kaller ikke nødvendigvis funksjonen du endret.

Og motsatt vei: fjerner du en bivirkning, sjekk hva som lente seg på den uten å si det.

> ⚠️ #1027 flyttet språkvalget fra klient til server. #736 hadde bygget en re-rendering fra cache
> nettopp for at tabellverdier skulle følge språket, og hvilte på at listene bar lagringsformatet.
> Etter flyttingen ble renderingen en no-op: samme rader inn, samme tekst ut. Ingenting ble rødt.
>
> To klientparsere fikk samtidig bare ferdige strenger. **En parser som ikke lenger har noe å parse,
> ser ut som om den gjør jobben sin.**

---

## 7. Én port per sak, ikke én per runde

QA-porten kjøres når saken er ferdig etter egen vurdering. Rester som **ikke** er regresjon eller
sikkerhet, blir oppfølgingssaker i stedet for en ny runde.

Unntaket er regresjon: fant porten noe vi selv innførte, rettes det og porten kjøres på nytt.

> ⚠️ #1027 brukte seks runder. Rundene 1–2 fant ekte hull i saken. Rundene 3–5 fant nesten
> utelukkende feil jeg innførte i runden før. Porten er ikke problemet — den er speilet.

---

## Hva reglene ikke løser

Reglene er disiplin. De veier opp for at frontend mangler en delt abstraksjon for tverrgående ting
— hver flate har sin egen språkhåndtering, feilvisning, kølasting og kappløpsvakt, så enhver
tverrgående endring må gjøres N ganger for hånd.

⚠️ **Arkitekturen krever perfekt disiplin N ganger per endring.** Det er ikke en holdbar kontrakt
med noe menneske eller noen agent. Disse reglene reduserer skaden; de fjerner ikke årsaken.

Se `doc/COMPLEXITY_SCAN.md` og saken om en delt ressursmodul for språk og henting.
