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
