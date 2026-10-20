# Læringsseksjoner — brukerguide

> Bruker- og forfatterveiledning for læringsseksjoner i kurs (#476). Teknisk referanse:
> [API_REFERENCE.md](API_REFERENCE.md); design/IA: [DESIGN_476_LMS_SECTIONS_IA.md](DESIGN_476_LMS_SECTIONS_IA.md).

## Hva er en læringsseksjon?

En **læringsseksjon** er lesestoff (markdown med tekst, bilder, lenker og evt. embedded video)
som kan legges **mellom moduler i et kurs**. Der en modul tester og vurderer deltakeren, er en
seksjon innhold deltakeren leser før hen går videre. Seksjoner er **gjenbrukbare** — samme
seksjon kan brukes i flere kurs (et bibliotek, slik moduler fungerer).

Et kurs blir dermed et **forløp** av elementer: moduler (vurdert) og seksjoner (lest), i den
rekkefølgen forfatteren bestemmer.

---

## For forfattere (SMO/administrator)

### 1. Opprett eller rediger en seksjon

1. Gå til **Innholdsforvaltning → Seksjoner**.
2. **«+ Ny seksjon»** (eller **«Rediger»** på en eksisterende).
3. Skriv en **tittel** og innholdet i **Markdown**-feltet. **Forhåndsvisningen** til høyre
   viser hvordan deltakeren ser det (samme sanitisering som i deltaker-visningen).
4. Klikk **«Lagre ny versjon»**. Hver lagring oppretter en ny, immutabel versjon — historiske
   visninger påvirkes ikke (siste versjon vises til nye lesere).

> **Tips — markdown:** overskrifter (`#`), lister, **fet**/_kursiv_, lenker `[tekst](url)`,
> bilder og kodeblokker støttes. Skript og utrygge elementer fjernes automatisk.

### 2. Flere språk (nb / nn / en-GB)

- Bruk **språk-fanene** øverst i editoren til å skrive hvert språk manuelt.
- **«Oversett fra dette språket»** bruker KI til å oversette tittel + innhold til de andre
  språkene (markdown bevares). **Se alltid over** resultatet før du lagrer — du eier teksten;
  oversettelse er et utgangspunkt, ikke en automatisk sannhet.
- En deltaker ser seksjonen på sitt profilspråk; mangler et språk, faller visningen tilbake til
  et utfylt språk (aldri tomt).

> **Publisering krever alle tre språk (#916).** En seksjon er lesestoff deltakeren møter direkte,
> så et språkhull har samme konsekvens som i en modul — og samme regel gjelder: **tittel** og
> **innhold** må finnes på `nb`, `nn` og `en-GB` før seksjonen kan bli synlig for deltakere.
>
> Du kan fortsatt **lagre** når som helst — arbeidet ditt går aldri tapt. Men når noe mangler,
> lagres versjonen **uten å bli publisert**, og du får en melding som sier nøyaktig hvilket felt
> som mangler hvilke språk («Lagret, men ikke publisert — seksjonen mangler innholdet (nynorsk)»).
> Bruk **«Oversett fra dette språket»**, lagre på nytt, og seksjonen publiseres.
>
> Det samme gjelder alle veier inn til publisering: **Publiser**-knappen, publisering av et kurs
> som inneholder seksjonen, og lagring som ellers ville publisert. En seksjon som allerede er
> publisert fortsetter å vise den siste komplette versjonen — deltakerne mister aldri innhold
> midt i et kurs.

### 3. Bilder og SVG-tegninger

- **«Last opp bilde»** legger et bilde inn i seksjonen (`![alt](asset:…)`). Støttede formater:
  **PNG, JPEG, GIF, WebP og SVG** (maks 5 MB). Alt-tekst er påkrevd (universell utforming).
- **SVG saneres automatisk** ved opplasting: skript, hendelseshåndterere og utrygge elementer
  fjernes, så bare selve tegningen lagres. Du trenger ikke gjøre noe — det skjer i bakgrunnen.
- **Tekst i SVG oversettes med «Oversett fra dette språket».** Når en SVG-tegning har tekst-etiketter,
  genererer oversett-handlingen lokaliserte varianter (én per språk) der etikettene er oversatt.
  Deltakeren ser tegningen på sitt eget språk. **Verifiser hvert språk visuelt** i forhåndsvisningen:
  oversatt tekst kan bli lengre/kortere, og SVG-tekst flyter ikke om automatisk — kontroller at den
  fortsatt får plass. (Tegningen må være lagret før den kan oversettes.)

### 3b. Blokker i teksten

Noen former i teksten tegnes som egne blokker. De skrives som vanlig tekst, så de oversettes,
eksporteres og importeres som resten. Hjelpen i seksjonseditoren (spørsmålstegnet) viser alle.

- **Uthevet boks** (`> **Husk:** …`), **prompt med kopiknapp** (` ```prompt `), **kort ved siden av
  hverandre** (`:::kort`), **«tenk først»** (`:::tenk Spørsmål?`) og **«sjekk deg selv»**
  (`:::sjekk Spørsmål?` med `- [ ]`/`- [x]`).
- **Steg for steg** (#1075): en prosess deltakeren blar gjennom ett steg av gangen.

  ```markdown
  :::steg Slik behandler du en innsynsbegjæring
  ### Registrer begjæringen
  Før den inn i saksarkivet samme dag.

  ### Finn dokumentene
  Søk i arkivet etter alt begjæringen gjelder.
  :::
  ```

  Én `###`-overskrift per steg, minst to (helst tre til sju). Et steg kan ha en figur. Deltakeren ser
  «Steg 1 av 4» med **Forrige** og **Neste**, og kan bla med piltastene.
- **Skriv selv** (#1076): en kort skriveoppgave med eksempelsvar og sjekkliste.

  ```markdown
  :::skriv Skriv vedtakspunktet for at styremøtene flyttes fra tirsdag til torsdag.
  **Vedtak:** Styremøtene flyttes fra tirsdag til torsdag kl. 09.00, gjeldende fra 1. november.

  - [ ] hva som ble bestemt, med dag og klokkeslett?
  - [ ] fra når det gjelder?
  :::
  ```

  Oppgaven står på første linje. Eksempelsvaret er teksten under; sjekklista er `- [ ]`-linjene til
  slutt (den kan sløyfes). Deltakeren skriver i et tekstfelt, åpner **Vis eksempelsvar** og krysser
  av. Ingenting sendes eller teller; teksten deltakeren skrev, blir bare i nettleserfanen hens og forsvinner når fanen lukkes.
- **Repetisjonskort** (#1078): begrep på forsiden, forklaring på baksiden.

  ```markdown
  :::repetisjon Fagord i møtearbeid
  ### Vedtak
  Det møtet bestemte, med ansvarlig og frist.

  ### Referent
  Den som skriver referatet.
  :::
  ```

  Én `###`-overskrift per kort, minst to (helst fire til ti). Deltakeren snur kortene, markerer
  **Kunne det** eller **Øv mer**, og kan øve på «øv mer»-kortene igjen etterpå. Ingenting lagres.
  `:::kort` er noe annet: kort ved siden av hverandre.
- **Finn parene** (#1107): deltakeren kobler begreper med forklaringer.

  ```markdown
  :::par Koble begrepet med forklaringen
  - Hjemmel = Lovbestemmelsen et vedtak bygger på
  - Merinnsyn = Innsyn selv om dokumentet kunne vært unntatt
  - Klagefrist = Tiden parten har til å klage på vedtaket
  :::
  ```

  Én linje per par, `- begrep = forklaring` (delt ved første « = »), minst tre par og ingen like
  begreper eller forklaringer. Deltakeren velger et begrep og så forklaringen; et riktig par blir grønt
  og står, et feil blinker rødt. Forklaringene stokkes hver gang. Ingen tidtaker, ingenting lagres.
- **Case** (#1110): en situasjon fra jobben og ett til tre «sjekk deg selv» om hva deltakeren gjør. En
  innrykket linje (to mellomrom) rett under et alternativ er **følgen** av det valget, og vises når
  deltakeren velger det:

  ```markdown
  En innbygger ringer og vil se dokumentene i saken om naboens byggesøknad.

  :::sjekk Søknaden inneholder naboens personnummer. Hva gjør du?
  - [ ] Avslår hele innsynet
    For mye. Bare opplysningen som skal unntas, kan holdes tilbake.
  - [x] Sladder personnummeret og gir innsyn i resten
    Riktig. Du unntar det som må unntas.
  :::
  ```

  Saken deler seg ikke etter valget; et dårligere valg vises med følgen, og deltakeren går videre.
  Uten følger ser «sjekk deg selv» ut som før.

**Bare i seksjoner (2.96.1):** steg for steg, skriv selv, repetisjonskort og finn parene tegnes ikke i en moduls
oppgavetekst eller veiledning — der står de som vanlig tekst. Oppgaveteksten er det deltakeren svarer
på, og et «skriv selv»-felt rett over svarfeltet fikk deltakeren til å skrive på feil sted. Legg
øvelsen i seksjonen før modulen. «Tenk først», «sjekk deg selv», kort, prompt og uthevet boks virker
begge steder.

Felles regler: **en blank linje over hver ramme**, og **ingen ramme inni en annen** (første `:::`
lukker). Er formen feil — for eksempel bare ett steg, eller ingen eksempelsvar — tegnes ingen blokk,
og forhåndsvisningen viser teksten som den er. På de andre språkene står markørordene (`:::steg`,
`:::skriv`, `:::repetisjon` …), `- [ ]`/`- [x]` og overskriftene urørt; «Oversett fra dette språket»
holder dem slik.

### 4. Embedded video

Du kan lime inn en `<iframe>` mot **betrodde video-verter** (YouTube, youtube-nocookie, Vimeo).
Andre iframes fjernes av sikkerhetshensyn.

### 5. Legg seksjonen inn i et kurs

1. **Innholdsforvaltning → Kurs** → åpne kurset.
2. Under **«Innhold i kurset»**: bruk nedtrekkslista nederst og **«Legg til seksjon»** (velg fra
   biblioteket). Seksjoner vises med **blått [SEKSJON]-merke**, moduler med [MODUL].
3. Bruk **↑/↓** for å plassere seksjonen i ønsket rekkefølge mellom modulene.
4. **«Lagre kurs»**, deretter **«Publiser kurs»**.

### 6. Eksport / import

Kurs-eksport (**«Eksporter»** på et kurs) tar med seksjonene og rekkefølgen i pakkefila, og
**«Importer kurs-pakke»** gjenskaper dem i målmiljøet. (Eldre pakker uten seksjoner importeres
fortsatt.)

**En enkelt seksjon kan også reise alene (#916).** På **Seksjoner**-lista:

- **«Eksporter»** på en rad laster ned seksjonen som en JSON-pakke — tittel, innhold på alle
  språk, og figurene (også de oversatte SVG-variantene). Du kan bare eksportere seksjoner du
  eier; administrator kan eksportere alle.
- **«Importer seksjons-pakke»** øverst på siden leser en slik fil og oppretter seksjonen her.
  **Den lander alltid som «Utkast»** — du går gjennom den og publiserer selv. Det er den samme
  regelen som for modul-import: ingenting blir synlig for deltakere før et menneske har sett på
  det i dette miljøet.
- Du blir **eier** av seksjonen du importerer.
- Figurene følger med og får nye referanser automatisk — du trenger ikke laste opp bildene på nytt.
- En seksjons-pakke som er løftet ut av en kurs-pakke fungerer også, og omvendt: det er samme
  format.

---

## For deltakere

- **Mine kurs** viser kurslista ferdig utfoldet: kurs, fremdrift og eventuelt kursbevis, uten at du
  trenger å klikke deg fram til det (#921).
- Klikk et kurs → kurset får skjermen alene, og de andre kursene forsvinner. Det er lesevisningen,
  og den skal ha så lite som mulig som konkurrerer om oppmerksomheten. **«← Alle kurs»** øverst til
  venstre (eller nettleserens tilbakeknapp) fører deg tilbake til lista (#922).
- I kurset vises seksjoner i forløpet med **«Les»** og et **«Ikke lest»/«Lest»**-merke.
- Klikk en seksjon → innholdet åpnes i en lesevisning (mobilvennlig).
- Nederst står **én** knapp: **«Marker seksjon lest, og gå videre»**. Den registrerer lesningen og
  åpner neste element i kurset i samme klikk. Er neste element en test, sier knappen det —
  **«Marker seksjon lest, og gå til testen»** — for da er det dit du skal, ikke forbi (#924).
- I teksten kan det stå små øvelser som ikke teller: «tenk først», «sjekk deg selv», **steg for
  steg** (bla med Neste/Forrige eller piltastene), **skriv selv** (skriv, se eksempelsvaret og kryss av;
  teksten blir bare i nettleserfanen din til du lukker den), **repetisjonskort** (snu kortet med klikk, mellomrom eller
  Enter, og marker «Kunne det» eller «Øv mer») og **finn parene** (velg et begrep og så forklaringen). I
  «sjekk deg selv» kan du få en egen tilbakemelding på valget du gjorde.
- **Siste element i kurset har ingen knapp.** Det er ingenting å gå videre til; lesningen
  registreres av systemet når du åpner seksjonen.
- **Fremdrift** teller **alle elementer**: en seksjon som er lest og en modul som er bestått
  teller likt mot «X/Y fullført».

---

## Begrensninger / på vei

- **SVG-tekstlayout per språk:** oversatte SVG-etiketter flyter ikke om — ved store lengdeforskjeller
  må tegningen justeres manuelt. Verifiser hvert språk visuelt (#657).
- **Versjons-pinning per deltaker** (at en deltaker midt i kurset beholder en bestemt versjon)
  kommer senere; nå vises siste versjon.
