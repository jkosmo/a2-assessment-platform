# Skjemaskjermene: bruttoliste over det som kan gjøres likt

*#1046 nivå to. Laget 2026-09-12 av ekte skjermbilder fra stage (2.67.0 + alt som ligger på stage),
1280 px bredt, bokmål. Galleriet: se lenka i saken. Bilder: `test/stage/ui-gallery-forms.spec.ts`
(kjøres med `UI_GALLERY_DIR` satt).*

*Regelen er den samme som på listenivået: den nyeste utgaven er referansen, med mindre det finnes en
grunn — og da står grunnen her. Datoene er første commit der varianten kom inn (`git log -S`).*

## Skjermene som er med

| Bilde | Skjerm | Type |
|---|---|---|
| 20 | Ny modul | lage nytt — dialog oppå lista |
| 21 | Nytt kurs | lage nytt — egen side med ett spørsmål |
| 22 | Ny seksjon | lage nytt — editoren tom |
| 23 | Ny klasse | lage nytt — nettleserens `prompt()` |
| 30–32 | Modul: Rediger · Forhåndsvisning · Innstillinger | åpnet element, tre faner |
| 33 | Kurs | åpnet element |
| 34 | Seksjon | åpnet element (editor) |
| 35 | Klasse | åpnet element |
| 36 | Vurderingskvalitet med modul valgt | skjema (terskel) |
| 37 | Manuell behandling med sak valgt | skjema (beslutning) |
| 38 | Plattforminnstillinger | skjema |
| 39 | Profil | lesevisning |
| 40 | Deltaker: kurs åpnet («Gjennomfør») | deltakerens inngang til svarskjemaet |
| 41 | Status med kurs valgt | oppslag med nøkkeltall og tabell |
| 42 | Resultater med rad valgt | filter, nøkkeltall, tabell, eksport, detalj |

Deltakerens selve svarskjema (etter «Gjennomfør») er ikke med; deltakersida er nyest og bør heller
være fasit enn funn.

## A. Å lage noe nytt

| # | Hva er ulikt | Hvor |
|---|---|---|
| A1 | **Fire måter å lage nytt på.** Dialog oppå lista (modul, mai). Egen side med ett spørsmål og «Neste» (kurs, april). Editoren åpnes tom (seksjon, juni). Nettleserens `prompt()` (klasse, juni). | 20–23 |
| A2 | Hva man blir spurt om først: navn + nivå (modul), bare tittel (kurs), alt på én gang (seksjon), bare navn (klasse). | 20–23 |
| A3 | Knappen heter «Opprett modul» (dialog), «Neste» (kurs), «Lagre ny versjon» (seksjon), OK (prompt). | 20–23 |
| A4 | Feltet heter «Modulnavn», «Kurstittel…», «Tittel», «Navn på klassen». | 20–23 |

## B. Sidehodet på det åpnede elementet

| # | Hva er ulikt | Hvor |
|---|---|---|
| B1 | **Tilbake-lenka:** understreket blå «← Tilbake til modulliste» (modul), grå «← Tilbake til kursliste» (kurs), grå «← Tilbake» (seksjon), grå «← Tilbake til klasser» (klasse). Tre stiler, fire tekster. | 30, 33, 34, 35 |
| B2 | **Tittelen:** «Modul» (typen, ikke navnet), kursets navn, ingen tittel (seksjon — navnet står bare i tittelfeltet), «Klasse» (typen). | 30, 33, 34, 35 |
| B3 | **Status:** egen tilstandslinje med fire felt (modul: du redigerer · live nå · endringer · preview viser); et merke ved tilbake-lenka (seksjon); ingen status i hodet (kurs, klasse). | 30, 34 |
| B4 | **Faner** bare på modul (Forhåndsvisning · Rediger · Innstillinger, øverst til høyre). Kurs har alt på én lang side; seksjon har forhåndsvisning ved siden av. | 30–32 |
| B5 | **Eiere-panelet** er likt på alle fire (august, #787) — det eneste som er gjort likt på dette nivået. | 30, 33, 34, 35 |
| B6 | Klasse mangler «?»-hjelpen øverst til høyre, og språkvelgeren har et annet utseende (større, annen ramme). | 35 |

## C. Språk i skjemaet

| # | Hva er ulikt | Hvor |
|---|---|---|
| C1 | **Språkvelgeren i skjemaet:** små piller med etiketten «Innholdsspråk:» (modul, august); tre store rammeknapper som fyller bredden (seksjon, juni); understrekede faner inne i kortet (kurs, april; plattform). | 30, 34, 33, 38 |
| C2 | **Rekkefølgen:** en/nb/nn (modul, kurs), nb/nn/en (seksjon), nb/nn/en (plattform). Bokmål er standard (#970/2026-09-11) — bør stå først overalt. | 30, 33, 34, 38 |
| C3 | Hva som markerer «påkrevd språk»: «English (UK) *» (kurs); ingenting (de andre). | 33 |
| C4 | Der språket byttes, byttes det for hele skjemaet (modul, seksjon) eller bare for tekstfeltene i ett kort (kurs, plattform). | 30, 33, 38 |

## D. Feltene

| # | Hva er ulikt | Hvor |
|---|---|---|
| D1 | **Etikettens plass og form:** små STORE BOKSTAVER over feltet (modul Rediger), vanlig tekst over feltet (kurs, seksjon, beslutning), etikett til venstre på samme linje (modul Innstillinger, profil), etikett venstre + verdi høyre som lesetekst (manuell behandling). | 30, 32, 33, 37, 39 |
| D2 | **Feltets bakgrunn:** beige (modul Rediger), hvit (alle andre). | 30 |
| D3 | **Påkrevd:** «*» etter etiketten (dialog), «(påkrevd)» i parentes (kurs), ingenting (resten). | 20, 33 |
| D4 | **Hjelp til feltet:** (i)-ikon med tooltip (modul Innstillinger), hjelpetekst under feltet (plattform, klasse-frist), informasjonsboks over feltgruppa (modul Vurdering), tekst i selve feltet (kurs «Hva skal kurset hete?»). | 32, 38, 35, 21 |
| D5 | **Gruppering:** små STORE overskrifter for grupper (MODULEN · VURDERING), kort per tema (plattform), ett langt kort (kurs), ingen gruppering (seksjon). | 32, 38, 33, 34 |
| D6 | Datofelt: to felt med «→» mellom (modul Gyldig), ett felt med «(valgfri)» i etiketten (klasse Frist). | 32, 35 |
| D7 | Tall med enhet: «100 – 200 ord — la stå tomt for nivåets standard», «70 (plattformstandard) %». To måter å si «tomt betyr standard». | 32 |

## E. Lagring

| # | Hva er ulikt | Hvor |
|---|---|---|
| E1 | **Lagre-knappen:** «Lagre kurs» i full bredde under alt + «Avbryt» som lenke (kurs); «Avbryt» + «Lagre» delt på to like knapper nederst i kortet (modul); «Lagre ny versjon» i full bredde + tre sekundære ved siden av (seksjon); **ingen lagre-knapp** — hver handling lagrer seg selv (klasse); «Fullfør beslutning» + «Krev oppdraget» (manuell behandling). | 33, 30, 34, 35, 37 |
| E2 | **Hva knappen heter:** Lagre · Lagre kurs · Lagre ny versjon · Fullfør beslutning · Opprett modul · Publiser (kvalitet). | alle |
| E3 | **Ulagrede endringer:** modul viser «✓ Alt lagret» i tilstandslinja og spør ved fanebytte. Kurs og seksjon sier ingenting; man kan gå tilbake og miste alt. | 30, 33, 34 |
| E4 | Hvor Avbryt står: lenke under knappen (kurs), knapp til venstre for Lagre (modul), finnes ikke (seksjon, klasse). | 33, 30 |
| E5 | Farlige knapper: «Fjern» rød ramme i lister (kurs, klasse); «Avpubliser» som vanlig knapp ved Lagre (seksjon) eller i sidepanelet (modul). | 33, 35, 34, 30 |

## F. Handlinger på det åpnede elementet

| # | Hva er ulikt | Hvor |
|---|---|---|
| F1 | **Hvor handlingene står:** sidepanel til høyre med fire knapper (modul: Generer, Fortsett i chat, Avpubliser, Eksporter, Importer); ved siden av Lagre nederst (seksjon: Oversett, Erstatt fra fil, Avpubliser); **ingen** på kurs og klasse — de ligger bare i lista. | 30, 34, 33, 35 |
| F2 | Dupliser/Eksporter/Arkiver finnes i lista, men ikke inne på elementet (kurs, klasse, seksjon delvis). D6 fra listenivået sa «det åpnede elementet viser alt». | 33, 34, 35 |
| F3 | Oversettelse: «Oversett fra dette språket» (seksjon) — modul og kurs har det ikke synlig på samme sted. | 34 |

## G. Lister inne i skjemaet

| # | Hva er ulikt | Hvor |
|---|---|---|
| G1 | **Radene:** kursets innhold har nummer, typemerke (SEKSJON/MODUL med farge), navn, ↑ ↓ Åpne Fjern i ramme; klassens tildelte kurs har navn, «Frist: dato», Fjern — uten ramme; modulens spørsmål er hele kort med felt. | 33, 35, 30 |
| G2 | **Legg til:** søkefelt + «Legg til modul» og nedtrekk + «Legg til seksjon» (kurs); søkefelt for personer og nedtrekk + dato + «Tildel kurs» (klasse). Samme jobb, to former. | 33, 35 |
| G3 | Fjern-knappen: rød ramme (kurs), brun ramme (klasse). | 33, 35 |

## H. Ord

| # | Hva er ulikt | Hvor |
|---|---|---|
| H1 | «Studenter» (klasse) — alle andre steder heter de deltakere. | 35 |
| H2 | «Tittel» (kurs, seksjon) mot «Modulnavn» og «Navn på klassen». Listenivået valgte «Navn». | 20, 33, 34 |
| H3 | «Sertifiseringsnivå» med verdier «Grunnleggende / Videregående / Avansert» (norsk) i skjema, men «Basic / Intermediate / Advanced» i Ny modul-dialogen. | 20, 32 |
| H4 | «Forhåndsvisning» (fane) / «FORHÅNDSVISNING» (kolonne) / «Preview viser» (tilstandslinje). | 30, 34 |

## I. Lesevisninger (ikke redigerbare)

| # | Hva er ulikt | Hvor |
|---|---|---|
| I1 | Etikett/verdi-lister: «Navn — Joakim Kosmo» med kolonner (profil), «Oppgave — Agentflyt» med kolonner (manuell behandling), tilstandslinje med små STORE etiketter (modul). Tre måter. | 39, 37, 30 |
| I2 | Nøkkeltall: tre kort med farget kant (kvalitet) — finnes ikke andre steder. | 36 |

## J. Status og Resultater (lagt til på produkteiers forespørsel)

| # | Hva er ulikt | Hvor |
|---|---|---|
| J1 | **Sidas navn er ikke menyens navn:** menyen sier «Status», sida «Kohort-status»; menyen sier «Resultater», sida «Resultatarbeidsflate». Forklaringslinja på Resultater sier «for HR og fagansvarlige». | 41, 42 |
| J2 | **Tre ord for samme ting:** «Kohort» (Status-sida), «Kull» (galleriet/eldre tekster), «Klasse» (resten av plattformen). | 41 |
| J3 | **Hva man filtrerer på:** Status har én nedtrekksliste med kursnavn. Resultater har fritekstfelt for «Modul-ID» og «Kurs-ID» — tekniske ID-er ingen bruker kjenner — pluss to datofelt. | 41, 42 |
| J4 | **Nøkkeltall vises på tre måter:** fem fliser med stort farget tall og STOR etikett, første flis beige (Status); tre kort med farget venstrekant og «Innenfor forventet»-tekst (Vurderingskvalitet); et rutenett med én flis per modul, «100 %» + «1 bestått av 1 avgjørelser» (Resultater). | 41, 36, 42 |
| J5 | **Tabellhodet:** små STORE BOKSTAVER (Status «Per klasse», forfatterlistene) mot vanlig skrift «Modul · Totalt · Fullført» (Resultater). | 41, 42 |
| J6 | **Tom tabell:** Status viser både teksten «Ingen klasse-tildelinger for dette kurset» OG et tomt tabellhode. Listesida viser bare teksten. | 41 |
| J7 | **Drilldown:** modulnavn som understreket lenke i tabellen, detalj i et eget kort langt under (Resultater); ingen drilldown på Status. Manuell behandling gjør det samme som Resultater (rad → detalj under). | 42, 37 |
| J8 | **Eksport:** seks knapper «Eksporter … (CSV)» på to linjer. Ingen annen side har mer enn én eksportknapp. | 42 |
| J9 | **Tall og tid:** «100 %» med mellomrom (Resultater) mot «100%» (Vurderingskvalitet); «Oppdatert: 12.9.2026, 20:57:59» med sekunder (Status) mot den felles datohjelperen ellers. | 42, 36, 41 |
| J10 | Prosent for «ingen data»: en tankestrek «—» i flisa (Resultater) — greit, men «Ingen avgjørelser ennå» står også under; to måter å si det samme i én flis. | 42 |

## Det som IKKE står her

- Innholdet i modulens Rediger-fane (spørsmålsbygger, kriterier) — det er modulens eget skjema, ikke et
  mønster som deles. Bare feltenes form (D) er med.
- Samtale-panelet (KI-dialogen) — fjernet 14.09 (se DECISIONS «Samtalen erstattes av to dialoger»).
- Dialoger for bekreftelse (slett/arkiver) — nettleserens `confirm()` de fleste steder, egen dialog for
  kurssletting. Det er et eget punkt, men hører til begge nivåene og er notert under A1/E5.

---

# Anbefalt variant per punkt

*Regelen: den nyeste utgaven er referansen (modulens arbeidsflate, august 2026, #896), med mindre det
finnes en grunn.*

## A. Å lage nytt — **avgjort 12.09: åpne et tomt element**

| # | Anbefalt | Hvorfor |
|---|---|---|
| A1–A4 | **Én måte:** en liten dialog oppå lista som spør om det minste som trengs (navn, og nivå der det finnes), med knappen «Opprett», og som så åpner elementet. | Dialogen (modul) er nyest av de fire og krever minst av forfatteren før hen ser noe. `prompt()` kan ikke oversettes eller stiles. Kursets egne side med ett spørsmål gjør det samme som dialogen, men koster en sidelasting. Seksjonens «åpne tomt» gir et tomt skjema uten navn i lista før første lagring. Feltet heter «Navn» (som på listenivået). |

## B. Sidehodet

| # | Anbefalt | Hvorfor |
|---|---|---|
| B1 | Én tilbake-lenke: grå «← Tilbake til [lista]» — «← Tilbake til moduler», «… kurs», «… seksjoner», «… klasser». | Grå er stilen på tre av fire; teksten sier hvor man havner. |
| B2 | **Tittelen er elementets navn**, ikke typen. Typen står som liten etikett over navnet («MODUL», «KURS» …). | Kurs (april) har det riktig. «Modul» og «Klasse» som tittel sier ingenting; seksjonen har ingen tittel i det hele tatt. |
| B3 | Tilstandslinja fra modul (august) på alle fire: status · live-versjon · lagret/ulagret. På kurs og klasse blir den kortere (ingen versjoner). | Nyest, og den eneste som svarer på «hva ser deltakerne nå» og «har jeg lagret». |
| B4 | Faner der elementet har mer enn ett skjema: modul (tre), kurs (Detaljer · Innhold · ev. Innstillinger). Seksjon og klasse har ett skjema og trenger ikke faner. | Faner er modulens mønster; kurset er i dag én side på ~1700 px. |
| B6 | «?»-hjelp og språkvelger fra det felles toppmeny-mønsteret på klassesida også. | Klasser er den eneste som avviker. |

## C. Språk

| # | Anbefalt | Hvorfor |
|---|---|---|
| C1 | Modulens piller med etiketten «Innholdsspråk:» overalt (seksjon, kurs, plattform). | Nyest (august). De store knappene på seksjon tar en hel linje for tre ord. |
| C2 | Rekkefølge **nb · nn · en** overalt. | Bokmål er standard (#970, DECISIONS 2026-09-11). |
| C3 | Påkrevd språk markeres likt: liten «påkrevd»-tekst i pillen, ikke «*». | «*» uten forklaring er det eneste stedet som bruker tegnet. |
| C4 | Språkbyttet gjelder hele skjemaet. | Kurs og plattform bytter bare inne i ett kort; resten av sida står i ett språk. |

## D. Feltene

| # | Anbefalt | Hvorfor |
|---|---|---|
| D1 | Etikett over feltet, vanlig skrift, som kurs/seksjon/beslutning. Små STORE BOKSTAVER bare for gruppeoverskrifter. | Flest sider har det; STORE etiketter på hvert felt (modul Rediger) gjør skjemaet tungt. Etikett til venstre (modul Innstillinger) fungerer bare når alle etiketter er korte. |
| D2 | Hvit bakgrunn i felt overalt. | Modul Rediger er den eneste med beige. |
| D3 | Påkrevd: «(påkrevd)» i etiketten, som kurs. | Ordet forklarer seg selv; «*» gjør det ikke. |
| D4 | Hjelp: én kort setning under feltet (som plattform). (i)-ikon bare når teksten er lang. | Tekst under feltet leses uten å måtte peke. |
| D5 | Gruppering: kort per tema med tittel (som plattform); inne i kortet små STORE gruppeoverskrifter når det trengs (som modul Innstillinger). | |
| D6/D7 | Én datoform (to felt med «→» for et intervall, ett felt ellers) og én måte å si «tomt betyr standard»: verdien som plassholder i grått, og «(standard)» etter. | |

## E. Lagring — **avgjort 12.09: Lagre-knapp overalt, med «Alt lagret / Ulagrede endringer» og spørsmål før man forlater**

| # | Anbefalt | Hvorfor |
|---|---|---|
| E1–E4 | **Én lagremodell:** eksplisitt «Lagre» nederst til høyre i kortet/sida, «Avbryt» som lenke til venstre for den, og tilstandslinjas «Alt lagret / Ulagrede endringer». Spør før man forlater med ulagret. | Modulens mønster (nyest). Klassens «alt lagrer seg selv» er annerledes, men også konsekvent — det er en avgjørelse om klasse skal bli som de andre eller om alle skal lagre fortløpende. |
| E2 | Knappen heter «Lagre». Ikke «Lagre kurs», ikke «Lagre ny versjon». Versjonsordet hører til tilstandslinja («Lagret som v3»). | |
| E5 | Farlige handlinger (Avpubliser, Arkiver, Slett) står ikke ved Lagre. De står i elementets handlingsrad (F). | Ved Lagre ligger de én tabulator fra den knappen man trykker oftest. |

## F. Handlinger på elementet

| # | Anbefalt | Hvorfor |
|---|---|---|
| F1–F2 | Én handlingsrad i sidehodet på alle fire, med de samme handlingene som lista har for elementet (Dupliser · Eksporter · Publiser/Avpubliser · Arkiver · Slett), pluss elementets egne (Importer pakke, Oversett). Samme «maks fire + Mer»-regel som lista. | D6 fra listenivået: «det åpnede elementet viser alt». Modulens sidepanel er nyest, men det tar en tredel av bredden for fem knapper. |

## G. Lister inne i skjemaet

| # | Anbefalt | Hvorfor |
|---|---|---|
| G1–G3 | Én «rad i skjema»-komponent: nummer (der rekkefølgen betyr noe), typemerke, navn, metadata i grått, handlinger til høyre med samme knappestil som listene (`row-action-btn`), «Fjern» rød. Brukes av kursets innhold, klassens kurs, klassens medlemmer. | Kursets rad (juni, #524) er den mest gjennomarbeidede. |
| G2 | Én «legg til»-linje: søk/velg + «Legg til». | |

## H. Ord

| # | Anbefalt | Hvorfor |
|---|---|---|
| H1 | «Deltakere», aldri «Studenter». | Hele resten av plattformen sier deltakere. |
| H2 | «Navn» overalt (som listenivået valgte). | |
| H3 | Nivåene på norsk også i Ny modul-dialogen. | Dialogen er den eneste med engelske verdier i et norsk skjema. |
| H4 | «Forhåndsvisning» overalt. | |

## I. Lesevisninger

| # | Anbefalt | Hvorfor |
|---|---|---|
| I1 | Én etikett/verdi-liste (som profil): etikett i grått til venstre, verdi til høyre. | |

## J. Status og Resultater

| # | Anbefalt | Hvorfor |
|---|---|---|
| J1 | Sidas tittel = menyens navn: «Status» og «Resultater». Forklaringslinja sier hva sida svarer på, ikke hvem den er for. | Det er det brukeren nettopp trykket på. «Arbeidsflate» og «Kohort» er våre ord. |
| J2 | «Klasse» overalt; «kohort» og «kull» går ut. | Klasser er det sidene i «Deltakere» heter, og det er ordet i lista. |
| J3 | Resultater filtrerer som Status: velg **kurs** i en nedtrekksliste, og valgfritt **modul** i en til (fylt av kurset). ID-feltene går ut. Datofeltene beholdes. | Ingen kjenner en ID. Status (juli) er nyest og gjør det riktig. |
| J4 | Ett nøkkeltall-kort: stort tall, etikett under i vanlig skrift, én farge for tallet som betyr noe (rød for forfalt/under mål, grønn for fullført/innenfor). Brukes av Status, Vurderingskvalitet og Resultater. Rutenettet «per modul» på Resultater blir en tabellkolonne i «Fullføring per modul» i stedet for 30 fliser. | Tre utgaver av samme byggekloss. Rutenettet skalerer ikke: 30+ fliser før tabellen som har samme tall. |
| J5 | Tabellene bruker `.list-table` fra listesida (STORE overskrifter, hvitt kort, sortering). | Én tabell, som på listenivået. |
| J6 | Tom tabell = bare teksten, ikke tabellhodet. | Som listesida. |
| J7 | Rad → detalj under er greit (Resultater, Manuell behandling), men raden markeres som valgt og detaljen får overskrift med navnet på det valgte. | I dag må man lete etter detaljen langt nede. |
| J8 | Én «Eksporter»-knapp med meny (samme «Mer»-mønster som listene) med de seks valgene. | Seks knapper på to linjer er en meny som ikke har fått lov til å være det. |
| J9 | «100 %» med mellomrom (norsk skrivemåte) overalt; tidspunkt gjennom den felles datohjelperen, uten sekunder. | |
| J10 | «—» alene når det ikke finnes data; forklaringen i title/hjelpetekst. | |

## Forslag til rekkefølge

1. **Ord og småting uten produktvalg:** H1–H4, J1, J2, J9, B1, B6, C2, D2, D3, G3, J6.
2. **Sidehodet:** B2 (navnet som tittel), B3 (tilstandslinja), F1 (handlingsraden).
3. **Feltene og språk:** C1, C3, C4, D1, D4, D5.
4. **Lister i skjema og nøkkeltall:** G1–G2 som én komponent; J4 (ett nøkkeltall-kort), J5, J8 (Eksporter-meny), J3 (kursvelger på Resultater).
5. Etter avgjørelse: **A** (én måte å lage nytt) og **E** (én lagremodell). Disse to endrer hvordan
   forfatteren jobber, ikke bare hvordan det ser ut — derfor sist, og først etter et ja.

Som på listenivået bør dette gjøres som én felles «skjemaside» (hode, tilstandslinje, handlingsrad,
språkvelger, kort, lagrelinje), ikke som fire rettelser.


## Status 13.09.2026 (formiddag)

Produkteier avgjorde 13.09: fanelinje som nivå to under hodet (variant A), eiere inn på Innstillinger,
tredelingen Rediger · Forhåndsvis · Innstillinger også på seksjoner, Resultater som liste.

| Punkt | Status |
|---|---|
| A (lag nytt) | Avgjort 1b og gjort for alle fire. Modul (13.09): «Ny modul» åpner `/admin-content/module/new/conversation` med tomt skjema; modulen lages på tjeneren ved første Lagre, og adressen byttes til den ekte. Dialogen med navn og nivå er borte; nivået settes under Innstillinger. |
| B1, B2, B3 | Gjort for alle fire. Modulens hode har samme typemerke, navn som tittel, statusmerke og «Alt lagret / Ulagrede endringer»; den gamle tilstandslinja er en liten tekstlinje under. |
| B4 | Gjort: fanelinje fra form-page.js. Modul og seksjon: Rediger · Forhåndsvisning · Innstillinger. Kurs og klasse: Rediger · Innstillinger. Eierne ligger under Innstillinger overalt. 13.09 kveld: fanebytte spør ikke på modulen heller — det skrevne følger med; ny modul åpner på Innstillinger (navn, type, nivå); navnet er et felt; lagring åpner ikke samtaleruta. |
| B6 | Gjort. |
| C1, C2, C3 | Gjort for klasse, seksjon, kurs (språkpiller, bokmål først, «(påkrevd)»). Bokmål er det påkrevde språket (DECISIONS). |
| D1–D7 | D1–D3 gjort (.form-field, hvite felt, «(påkrevd)»). 13.09: modulens etiketter i Rediger og Innstillinger står over feltet i vanlig skrift (ikke STORE, ikke til venstre); D4: hjelpen står som én setning under feltet, (i)-ikonene med popover er borte; D7: «70 (standard)» og «ord (tomt = nivåets standard)». D5 (kort per tema) og D6 (intervall med «→», ett felt ellers) var alt slik. |
| E (lagring) | Avgjort 2a og gjort for klasse, seksjon, kurs: «Lagre», Avbryt som lenke, «Alt lagret / Ulagrede endringer», spørsmål før man forlater. Modul har sin egen lagring, men samme merke i hodet. |
| F1, F2 | Gjort for alle fire: handlingsrad i hodet med «maks fire + Mer». Modulens sidepanel er borte. 13.09 (produkteier): Lagre og Avbryt først i raden med grønn/rød tone; korte ord på modulens handlinger (Publiser · Generer innhold · Be om endring · Mer). |
| E (lagring) 13.09 | Lagrelinja nederst er borte på alle fire; Lagre/Avbryt i hodet. Modul: én Lagre for Rediger, Innstillinger og utkast. |
| Hodet på modulen 14.09 | Modulens hode tegnes av `form-page.js` som de tre andre: tilbake-lenke, Lagre/Avbryt + handlinger på topplinja, typemerke, navn, statusmerker, «Alt lagret», språkpiller og fanelinje. Modulens egen HTML for dette (og egne id-er som `moduleSaveBtn`, `tabEdit`, `previewLocaleBar`) er borte; `#moduleFormHead` er festet. Piltaster i fanelinja og «forlate sida?»-vakten kom med form-page til alle fire. Avbryt på modulen = alt ulagret bort og modulen inn fra det lagrede (skjema og utkast er samme sak). |
| B3 modul 13.09 | Tilstandslinja er borte; «Publisert v2 · Utkast v4» som merker i hodet, «Forhåndsvisning viser …» i fanen. GDPR-varselet er én linje under oppgavefeltet. Samtaleruta vises bare når assistenten spør. 14.09: samtaleruta er fjernet — planen ligger i «Generer innhold»-dialogen, spørsmål i én valgdialog, framdrift som toast; skjemaet står i full bredde. |
| G1–G3 | Gjort 13.09: én «rad i skjema» (`.form-row` i shared.css) for kursets innhold, klassens kurs og klassens medlemmer — nummer, typemerke, navn, metadata i grått, handlinger til høyre som `row-action-btn`, «Fjern» rød. Én «legg til»-linje (`.form-add-row`). Sidenes egne kopier er slettet. |
| H1–H4 | Gjort. |
| J1, J2, J6, J8, J9 | Gjort (titler = menynavn, «klasse», tom tabell, Eksporter-meny, prosent/tid). |
| J3, J4, J5, J6, J7 | Gjort 13.09: Resultater og Status har samme hode og filterrad som listesidene (kursvelger med navn, søk over moduler; ID-feltene er borte). Nøkkeltall som én linje (`.kpi-line` i shared.css) — flisene og rutenettet per modul er borte, bestått-andelen står som kolonne med stolpe. Alle tabellene er `.list-table`; tom tabell skjules og teksten står alene (én `setTableEmpty` i stedet for tre utgaver). Detaljen har navnet på valgt modul/kurs. |
| J10 | Gjort i praksis: «—» alene i tabellen. |
