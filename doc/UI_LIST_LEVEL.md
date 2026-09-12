# Listesidene: bruttoliste over det som kan gjøres likt

*Visuell gjennomgang 2026-09-12 av skjermbildene fra stage (galleriet for #1046). Bare listenivået —
det som vises før man åpner et element. Neste nivå (åpnet element) tas etterpå. Kolonnen «Forslag»
er den nyeste/mest gjennomarbeidede utgaven der det finnes en, ikke noe nytt design.*

Sidene som er sett: Moduler, Kurs, Seksjoner, Klasser, Vurderingskvalitet (forfatter); Manuell
behandling, Resultater, Kullstatus (behandling); Mine kurs, Fullførte, Profil (deltaker);
Plattforminnstillinger (admin).

## A. Sidehodet: tittel, forklaring og hovedknapper

| # | Element | Slik er det nå | Forslag til én måte |
|---|---|---|---|
| A1 | Forklaringslinje under tittelen | Finnes på Klasser, Vurderingskvalitet, Mine kurs, Fullførte, Resultater, Manuell behandling, Plattform. Mangler på Moduler, Kurs, Seksjoner. | Alle sider har én linje under tittelen. |
| A2 | Ordet for «lag ny» | «Opprett ny modul», «Opprett nytt kurs», «+ Ny seksjon», «+ Ny klasse». | Ett verb og én form: «Ny modul», «Nytt kurs», «Ny seksjon», «Ny klasse» — uten «+», eller med på alle. |
| A3 | Rekkefølge og vekt på hovedknappene | Moduler: [Opprett (fylt)] [Importer (ramme)] [Rydd (rød tekst)]. Kurs: [Opprett (fylt)] [Importer (ramme)]. Seksjoner: [Importer (bare tekst)] [Ny (fylt)]. Klasser: [Importer (ramme)] [Synk (ramme)] [Ny (fylt)]. | Fylt hovedknapp alltid ytterst til høyre, sekundære til venstre for den, samme knappestil (ramme) for alle sekundære. |
| A4 | Import-knappens tekst | «Importer modul-pakke (.json)» (to linjer), «Importer kurs-pakke (.json)», «Importer seksjons-pakke» (uten filtype), «Importer brukere fra fil». | «Importer …» uten filtypen i knappen; filtypen står i dialogen. Én linje. |
| A5 | Rydd-knappen | Bare Moduler har «Rydd upubliserte», med rød tekst blant hovedknappene. | Destruktive handlinger som gjelder flere elementer hører ikke blant hovedknappene; legg den i en «Flere»-meny eller nederst. |

## B. Filtre og søk

| # | Element | Slik er det nå | Forslag |
|---|---|---|---|
| B1 | Søkefelt | Moduler har det (over filterknappene). Kurs, Seksjoner, Klasser har ikke. Manuell behandling har «Søk i kø» inne i kortet. | Alle lister med mer enn ~10 rader får søkefelt på samme sted (over filterknappene, venstrejustert). |
| B2 | Filterknappene (Alle/Aktive/…) | Moduler: Alle, Aktive, Har upublisert utkast, Publiserte, Arkiverte. Kurs/Seksjoner: Alle, Aktive, Publiserte, Arkiverte. Klasser: **Aktive, Arkiverte, Alle** (annen rekkefølge). | Samme rekkefølge overalt, «Alle» først. |
| B3 | Valgt filter-utseende | Forfattersidene: hvit knapp med brun ramme og brun tekst. Manuell behandling: helt brun fylt knapp. | Én stil for «valgt» på alle sider. |
| B4 | Kursfilteret | Moduler: egen linje under, med «Kurs:»-etikett. Seksjoner: på samme linje som filterknappene. Kurs: finnes ikke. Vurderingskvalitet: i et eget kort med overskrift «BRUKT I KURS». | Samme plassering (på linje med filterknappene, til høyre) og samme etikett. |
| B5 | Filter som krever knappetrykk | Resultater: fyll ut filter og trykk «Last resultater» (full bredde). Mine kurs: «Oppdater kurslista» (full bredde, ramme) øverst i lista. Alle andre filtrerer med en gang. | Filtrer med en gang overalt; fjern «last»-knappene, eller behold dem bare der en henting er tung. |
| B6 | Vurderingskvalitet uten valg | Siden er tom under filteret til man velger modul og trykker «Vis kvalitet» — ingen tekst som sier det. Kullstatus sier «Velg et kurs for å se kohort-status.» | Samme tomtilstand med forklaring. |

## C. Selve lista

| # | Element | Slik er det nå | Forslag |
|---|---|---|---|
| C1 | Bakgrunn | Moduler, Kurs, Seksjoner, Profil, Manuell behandling: tabell inne i hvitt kort. **Klasser: rader rett på sidebakgrunnen, uten kort.** Fullførte: kort inne i kort. Mine kurs: trekkspill-rader inne i kort. | Alle lister ligger i samme hvite kort med samme kant og skygge. |
| C2 | Kolonneoverskrifter | Forfattersidene: STORE BOKSTAVER, små, grå. Profil og Manuell behandling: **Fete, vanlige bokstaver**. | Én stil. |
| C3 | Sortering | Bare Moduler har sorteringspiler (MODULNAVN ↑, SIST ENDRET ↕). | Sortering på alle tabeller med dato/navn, eller ingen steder. |
| C4 | Navn på første kolonne | «MODULNAVN», «TITTEL» (kurs, seksjoner), «NAVN» (klasser), «Modul» (profil). | Ett ord: «Navn» eller «Tittel». |
| C5 | Datoformat | Moduler/Kurs: «18. aug. 2026». Seksjoner: «28.8.2026». Profil/Manuell: «6. sep. 2026, 20:41». Plattform: «26. aug., 21:43» (uten år). | Én dato-hjelper: «18. aug. 2026», med klokkeslett bare der det betyr noe. |
| C6 | Overskrift over handlingskolonnen | Moduler og Kurs har «HANDLINGER». Seksjoner og Klasser har tom overskrift. | Likt (tom, eller «Handlinger») overalt. |
| C7 | Sertifiseringsnivå-kolonnen | Moduler: kolonne 2. Kurs: kolonne 3 (etter status). Seksjoner: ikke relevant. | Samme rekkefølge: Navn · Status · Nivå · … |
| C8 | Versjonsvisning | Seksjoner: egen kolonne «VERSJON» (v1). Moduler: «Nyere utkast»-merke ved siden av status. | Én måte å vise «det finnes et nyere utkast» på. |

## D. Handlingene på hver rad

| # | Element | Slik er det nå | Forslag |
|---|---|---|---|
| D1 | Verbet for å åpne | «Åpne» (moduler), «Rediger» (kurs, seksjoner), «Administrer» (klasser). | Ett verb. «Åpne» er det nyeste og det mest nøytrale (du åpner, så velger du hva du gjør). |
| D2 | Rekkefølge | Moduler: Åpne · Dupliser · Eksporter · Avpubliser · Arkiver. Kurs: Rediger · Avpubliser · Eksporter · Arkiver · Slett. Seksjoner: Rediger · Eksporter · Avpubliser · Arkiver. Klasser: Administrer · Arkiver. | Fast rekkefølge: Åpne · Dupliser · Eksporter · Publiser/Avpubliser · Arkiver · Slett. |
| D3 | Hvilke handlinger som finnes | Dupliser: bare moduler. Slett: bare kurs («Slett kurs og ubrukt innhold», rød ramme). Seksjoner og klasser kan ikke slettes fra lista. | Avgjørelse per type: skal seksjoner kunne dupliseres og slettes? Skal kurs dupliseres? Det som er mulig, skal se likt ut. |
| D4 | Utseende på «Arkiver» | Vanlig knapp på moduler/kurs/seksjoner. **Rød tekst på klasser.** | Én stil for arkiver (den er reversibel; rød bør bare brukes på slett). |
| D5 | Knappene bryter til to linjer | Fem knapper per rad gjør radene høye (moduler, kurs). | Enten færre synlige knapper (Åpne + «Mer»-meny), eller mindre knapper på én linje. |
| D6 | Antall handlinger i lista mot i det åpnede elementet | Moduler har fem i lista og flere inne. Klasser har to i lista. | Regel: i lista står Åpne og det man gjør ofte uten å åpne; resten inne. |

## E. Toppmenyen (må sjekkes med ekte innlogging)

| # | Observasjon |
|---|---|
| E1 | Samme bruker (administrator) ser ulikt antall knapper i toppmenyen: Moduler-siden viser fire (Mine kurs, Innholdsforvaltning, Deltakere, Plattforminnstillinger), Manuell behandling viser to, Mine kurs og Fullførte viser ingen, Profil mangler både knappene og «Profil». **Galleriet ble tatt med testriggens innloggingsmåte**, så dette kan være riggen — eller det kan være at sidene henter rollene ulikt (inventaret sier at bare noen sider bruker `applyRoleBasedVisibility`). Må verifiseres i nettleser med vanlig innlogging før det telles som funn. |
| E2 | Manuell behandling viser to varsler («Anker oppdatert: 0», «Vurderinger oppdatert: 2») idet siden åpnes. Ingen andre sider varsler at de har lastet. |
| E3 | Språkvelgeren står på samme sted på alle sider (bra); på Profil er den lenger til høyre fordi «Profil»-knappen mangler. |

## Det som IKKE står her

- Det åpnede elementet (kursdetalj, seksjonsredigering, modulsamtale, klasse-detalj) — neste runde.
- Fargevalg, skrifttype og avstander i seg selv: de er like på tvers (samme `shared.css`); ulikhetene
  over er komposisjon og ord, ikke stil.
- Tekster på ett språk — dekket av `UI_INVENTORY.md`.

## Forslag til rekkefølge

1. **Ord** (A2, C4, D1): billigst, størst effekt på gjenkjenning. Én dag.
2. **Rekkefølge og plassering** (A3, B2, C7, D2): ingen ny kode, bare flytting.
3. **Bakgrunn og overskrifter** (C1, C2, C6): Klasser og Profil/Manuell inn i samme kort- og
   overskriftsstil som resten.
4. **Dato** (C5): én hjelper (`format-display.js` finnes), brukt overalt.
5. **Handlinger** (D3–D6): krever avgjørelser om hva som skal være mulig per type — ta dem i én
   omgang, så bygges lista likt etterpå.
6. **Filtre** (B1–B6) og **tomtilstander** (B6).

---

# Anbefalt variant per punkt

*Lagt til 2026-09-12 (kveld). Regelen fra sakens metode: den nyeste utgaven er referansen, med
mindre det finnes en grunn — og da står grunnen her. Datoene er første commit der varianten kom
inn (`git log -S`).*

## A. Sidehodet

| # | Anbefalt | Hvorfor |
|---|---|---|
| A1 | Én forklaringslinje under tittelen på alle sider. | Alle sidene laget etter juni har den; Moduler/Kurs/Seksjoner (april) er de eldste. Tekst: hva siden er for, i én setning — som «Følg fremdriften din på tvers av kursene dine». |
| A2 | «Ny modul», «Nytt kurs», «Ny seksjon», «Ny klasse». Uten «+», uten «Opprett». | «Opprett ny …» er april-formen (Moduler, Kurs). «+ Ny …» kom i juni (Seksjoner, Klasser) og er nyest, men plusstegnet gjør ingenting knappen ikke alt sier. Behold den korte formen, dropp tegnet. |
| A3 | Fylt hovedknapp ytterst til høyre; sekundære (Importer, Synk) til venstre for den med ramme. | Seksjoner og Klasser (juni) har hovedknappen til høyre — nyest. Moduler og Kurs (april) har den til venstre. Én stil på de sekundære: ramme, som på Klasser. |
| A4 | «Importer modul», «Importer kurs», «Importer seksjon», «Importer brukere». Én linje. Filtypen står i dialogen. | Ingen av dagens fire er like; «(.json)» er informasjon for dialogen, ikke for knappen. |
| A5 | Flytt «Rydd upubliserte» ut av sidehodet — inn i en «Flere handlinger»-meny ved hovedknappene, eller nederst på siden. | Den er destruktiv og gjelder mange elementer på én gang; den skal ikke stå som en tredje hovedknapp. Fra mai, bare på Moduler. |

## B. Filtre og søk

| # | Anbefalt | Hvorfor |
|---|---|---|
| B1 | Søkefelt på alle lister med mer enn ti rader, over filterknappene, venstrejustert (som Moduler). | Moduler har det eneste søkefeltet på listenivå; det er også den lista som faktisk er lang (50+). Kurs og Seksjoner vil bli like lange. |
| B2 | Rekkefølge: Alle · Aktive · Publiserte · Arkiverte (+ «Har upublisert utkast» der det finnes). «Aktive» forhåndsvalgt. | Tre av fire sider har denne rekkefølgen; Klasser (juli) avviker uten grunn. |
| B3 | «Valgt» = hvit knapp med brun ramme og brun tekst (forfattersidenes stil). | Det er stilen på flest sider. Manuell behandlings fylte brune knapp er flervalg (flere statuser kan være på samtidig) — det er en annen kontroll og kan beholde fylt stil, men da bør den se ut som en bryter, ikke som en filterknapp. |
| B4 | Kursfilteret på samme linje som filterknappene, til høyre, med etiketten «Kurs:» (som Seksjoner). | Seksjoner (juni) er nyest. Legg det til på Kurs også — der er det ikke, men det er like relevant. |
| B5 | Filtrer med en gang; fjern «Last resultater» og «Oppdater kurslista». | Alle andre lister filtrerer ved endring. Resultater-siden er den eneste som krever et knappetrykk, og «Oppdater kurslista» er en rest fra da lista ikke lastet seg selv (#921 fjernet klikket, knappen ble stående). |
| B6 | Tomtilstand med forklaring, som Kullstatus: «Velg en modul for å se kvaliteten.» | Vurderingskvalitet er tom uten et ord i dag. |

## C. Lista

| # | Anbefalt | Hvorfor |
|---|---|---|
| C1 | Alle lister i det hvite kortet med samme kant og skygge. Klasser rettes. | Elleve av tolv sider har kortet. Klasser-lista tegnes av skriptet uten kort — glemt, ikke valgt. |
| C2 | Kolonneoverskrifter i STORE BOKSTAVER, små, grå (forfattersidenes stil). | Det er stilen i `shared.css` (`text-transform: uppercase`) og på flest sider. Profil og Manuell behandling har egne tabellstiler fra mars; de er de eldste. |
| C3 | Sortering på navn og dato på alle tabeller. | Moduler har det (april) og er den eneste lista der det er nødvendig i dag — men Kurs og Seksjoner vokser. Én tabell-hjelper med sortering, brukt av alle. |
| C4 | «Navn» som første kolonne overalt. | «Tittel» er riktig for kurs og seksjoner, «Navn» for klasser og moduler — men brukeren ser ikke forskjellen, og én overskrift er verdt mer enn presisjonen. |
| C5 | «18. aug. 2026» overalt; klokkeslett bare der det betyr noe (innlevert, vurdert). Én hjelper: `createDateFormatter` i `format-display.js` (juni). | Hjelperen finnes; Seksjoner («28.8.2026») og Plattform («26. aug., 21:43», uten år) har ikke tatt den i bruk. |
| C6 | Tom overskrift over handlingskolonnen. | «HANDLINGER» sier ikke noe knappene ikke sier selv. Seksjoner/Klasser (nyest) har tom. |
| C7 | Rekkefølge: Navn · Status · Nivå · (typens egne tall) · Sist endret · handlinger. | Kurs (status før nivå) er den som leses lettest: status er det man ser etter først. Moduler bytter til samme. |
| C8 | «Nyere utkast»-merke ved status (som Moduler); dropp versjonskolonnen på Seksjoner. | Versjonsnummeret betyr ingenting for forfatteren i lista; «det finnes et nyere utkast» gjør det. Moduler-varianten er fra august og nyest. |

## D. Handlingene på raden

| # | Anbefalt | Hvorfor |
|---|---|---|
| D1 | «Åpne» overalt. | Nyest (Moduler, 18.08.2026), og det eneste av de tre ordene som ikke lover noe om hva du skal gjøre etterpå. «Rediger» (april/juni) og «Administrer» (juni) er begge eldre. |
| D2 | Åpne · Dupliser · Eksporter · Publiser/Avpubliser · Arkiver · Slett. | Fra det ufarlige til det farlige, venstre mot høyre. Moduler har nesten denne rekkefølgen alt. |
| D3 | **Avgjørelse trengs:** Dupliser på kurs og seksjoner? Slett på seksjoner og klasser? | Ikke en standardisering, men et produktvalg. Forslag: Dupliser på alle tre innholdstypene (det er en vanlig forfatterhandling); Slett i lista bare for det som ikke er brukt noe sted — regelen som alt finnes for kurs («… og ubrukt innhold»). |
| D4 | «Arkiver» som vanlig knapp overalt; rød bare på «Slett». | Arkivering er reversibel. Rød på Klasser er fra juni og står alene. |
| D5 | I lista: «Åpne» + de to–tre vanligste; resten under «Mer» (⋯). Én knapperad. | Fem knapper som bryter til to linjer gjør radene dobbelt så høye på Moduler og Kurs. Hva som er «vanligst» leses av loggen når vi har den; til da: Åpne · Dupliser · Mer. |
| D6 | Regel: lista viser det man gjør uten å åpne; det åpnede elementet viser alt. | Følger av D5. |

## E. Toppmenyen

| # | Anbefalt | Hvorfor |
|---|---|---|
| E1 | Ikke et funn: ulikt antall knapper i galleriet skyldtes testriggens innloggingsmåte. Med vanlig innlogging er toppmenyen lik (bekreftet av produkteier 12.09, prod og stage). | — |
| E2 | Fjern «oppdatert: N»-varslene ved lasting på Manuell behandling. | Ingen annen side varsler at den har lastet; det er «toast-bruk»-kandidaten fra sakens egen liste. |
| E4 (ny) | Nivå to skal tegnes først når rollene er kjent — ikke tegnes fullt og så fjerne lenker. | Produkteier så «Manuell behandling» blinke og forsvinne som SMO. `deltakere-subnav.js` er «fail-open»: alle lenker først, fjern etterpå. Skjul lenkene til rollene er hentet (maks ett sekund), vis så de riktige. |

## Første runde (forslag)

Det som ikke trenger produktvalg og kan gjøres i én omgang, side for side, med galleriet som fasit:

1. **Ord:** A2, A4, C4, D1.
2. **Plassering:** A3, B2, B4, C7, D2.
3. **Kort og overskrifter:** C1 (Klasser), C2 (Profil, Manuell behandling), C6.
4. **Dato:** C5 — én hjelper.
5. **Nivå to:** E4.

Så B5/B6 og A1. D3 og D5 venter på avgjørelsen om hvilke handlinger hver type skal ha.

## Status 12.09.2026

| Punkt | Status | Merknad |
|---|---|---|
| A1 | Gjort | Forklaringslinje under tittelen på Moduler, Kurs, Seksjoner og Klasser. |
| A2, A4, C4, D1 | Gjort | Ordene er like på alle fire forfattersidene. |
| A3, A5 | Gjort | Hovedknapp til høyre; «Rydd upubliserte» nederst på Moduler. |
| B1 | Ikke gjort | Søkefelt på Kurs og Seksjoner venter til listene faktisk er lange. |
| B2 | Gjort | Klasser og Moduler har samme rekkefølge; Moduler har «Har upublisert utkast» sist. |
| B3 | Ikke gjort | Manuell behandlings flervalgsknapper er en annen kontroll; står som den er. |
| B4 | Gjort på Moduler | Kursfilteret står på samme linje som filterknappene, som på Seksjoner. Anbefalingen om å legge et kursfilter på Kurs-sida var feil — et kursfilter på kurslista gir ingen mening. |
| B5 | Gjort | «Last resultater» (Rapporter), «Vis kvalitet» (Vurderingskvalitet) og «Oppdater kurslista» (Mine kurs) er borte; sidene henter selv, og filtrene virker ved endring. |
| B6 | Gjort | Vurderingskvalitet sier «Velg en modul for å se kvaliteten.» til en modul er valgt. |
| C1, C2, C6 | Gjort | |
| C3 | Ikke gjort | Sortering på Kurs/Seksjoner venter, som B1. |
| C5 | Gjort | Seksjoner og Plattform bruker den felles datohjelperen. |
| C7, D2, D4 | Gjort | |
| C8 | Ikke gjort | Versjonskolonnen på Seksjoner står; «Nyere utkast»-merket hører til neste runde. |
| D3, D5, D6 | Venter på avgjørelse | Se over. |
| E2 | Gjort | Ingen varsler ved lasting på Manuell behandling. |
| E4 | Gjort | |
