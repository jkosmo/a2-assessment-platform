# Gamifisering — design (utkast til produkteier)

Status: **under bygging**. Første del, seilbåten på fremdriftslinja (#1137), og favicon ble bygget i
2.130.0. Bygger på `doc/research/GAMIFISERING_RESEARCH.md` og produkteiers svar 2026-11-01 og -02.
Skisse og karakterark: https://claude.ai/artifact/RhwPj7ANVfwobpmHtsucBZ (privat; deles fra siden).

Saker: #1137 seilbåten som fremdriftslinje · #1138 «Min statistikk» på profilen · #1139 ukentlig e-post
med avmelding · #1140 skillet kan oppdatere publiserte kurs via API.

## Målet

**Noe som er kjedelig, skal bli litt gøy** — og konsulenter skal prioritere kompetansebygging i
konkurranse med fakturering. Vi bruker virkemidlene som virker: en maskot som savner deg, tapsfrykt
(rekker), et felles mål med en ekte belønning, overraskelser og humor. Voksne mennesker, ikke snøflak.

## Det som er bestemt (produkteier 2026-11-01)

- **Arbeidsgiver ser bare resultat** (fullført, kursbevis, frist). Alt i gamifiseringen er for brukerens
  egen motivasjon og vises bare for brukeren selv. Det felles målet viser bare summen.
- **Ukentlig e-post** fra maskoten: på som standard, kan slås av. Ingen lenker (firmapolicy).
- **Tid brukt måles ikke.** Seksjoner viser anslått lesetid (fra antall ord).
- **Poengtavler venter.**
- **Ekstra poeng for å stille spørsmål og svare i diskusjonene.**
- **«Aktivitet»-fanen (#1099)** beholdes for å følge innføringen, men bare for administrator.

### Bestemt 2026-11-01/02: maskoten, fremdriftslinja og e-posten

- **Maskoten er seilbåten «Skuta»**, bygd på A-2-logoen. **Seilet er A-en:** en lukket trekant med én
  tynn, heltrukket tverrstrek (en spile i duken) om lag 60 % ned — ingen utsparing nederst, og streken
  skal aldri se ut som en bom nummer to. Ett seil, akter for masta; ingen forseil og ingen vimpel.
  2-tallet sitter til rors akterut til høyre, så baugen peker mot venstre. Ansiktet sitter over
  tverrstreken og krysser aldri en strek.
- **Bare portalens farger.** Messing på skroget er godtatt; logoens skifergrå er valgt bort
  («kjedelig»).
- **Størrelser:** hele båten fra 48 px; under det **merket** (rund mørk plate, hvitt seil med
  tverrstrek, messingskrog, hodet til 2-tallet som en liten sirkel inne i båten, tett bak seilet).
  Humøret må kunne leses fra 32 px; i 24 og 16 px skal merket bare kjennes igjen. Merket er også
  **favicon** (2.130.0, `public/static/favicon*.png|svg`, på alle sider).
- **Konfetti er animert**, og står stille som noen få lyse prikker når brukeren har slått av
  bevegelse.
- **Fremdriftslinja i «Mine kurs» (#1137, bygget i 2.130.0):** linja fylles fra **høyre mot venstre**
  — båten seiler mot venstre fordi 2-tallet styrer fra høyre, og det fylte er kjølvannet. Bare kurs
  **i gang** har båt (fra første steg). Ikke påbegynt: tom linje. Fullført: **hel grønn linje uten
  båt**. Under 30 % flatt seil og én fartsstripe, fra 30 % fullt seil og tre. Når kurset fullføres i
  økta, kommer båten i mål, feirer og glir ut; med redusert bevegelse vises den ikke.
- **Humørregelen** (profilen #1138, e-posten #1139, senere maskoten): aktivitet denne uka = mett,
  forrige uke = sulten, for to uker siden = sur, tre uker eller mer = dramatisk. Har brukeren meldt
  seg av e-posten, **ligger båten for anker** på profilen, uansett aktivitet.
- **Ukentlig e-post (#1139):** sendes **bare når noe er utestående** (kurs i gang, tildelt og ikke
  påbegynt, eller frist innen to uker), **mandag kl. 07:00**. **Siste linje forklarer hvordan man
  melder seg av** (Profil → bryteren, med samme navn som på profilen), siden lenker ikke er lov.
  Første utsending går **bare til produkteier**, styrt av en liste over tillatte mottakere. Avsender
  er inntil videre portalens Azure-adresse; `noreply.learning@a-2.no` venter på DNS hos
  driftsleverandøren (se #1139).
- **Bilder til e-post og feiring** lages med bildemotoren via Codex; ledetekstene (figur, regler og
  fem scener) ligger i skisseprosjektet som `MASKOT_PROMPTPAKKE.md`. Bildene er stemningsbilder —
  maskoten i portalen er SVG.

## Fem byggeklosser

### 1. Erfaringspoeng (XP) og nivåer

Poeng gis **én gang per ting**, når den er gjort. Aldri for innlogging, tid eller antall forsøk.

| Hva | XP | Merknad |
|---|---|---|
| Seksjon lest | 1 per anslått minutt, minst 5 | Lang seksjon gir mer |
| Modul bestått | 50 | Også etter et stryk — ingen straff for å prøve igjen |
| Kurs fullført | 100 | Bonus i tillegg |
| Spørsmål i en diskusjon | 15 | Høyst 3 per uke gir poeng |
| …og noen svarer på det | +10 | Belønner gode spørsmål, ikke mange |
| Svar i en diskusjon | 20 | Høyst 5 per uke gir poeng |
| Uke i rekka (se 4) | 25 | |

Nivåene har navn og blir gradvis lengre å nå: Lærling → Svenn → Mester → Guru → Legende (forslag).
Nytt nivå gir en liten feiring og låser opp noe til maskoten.

### 2. Maskoten — en tamagotchi du forer med kurs

Hver bruker har sin egen maskot. Den bor øverst i «Mine kurs».

- **Den spiser erfaringspoeng.** En metthetsmåler synker litt hver dag; alt du gjør, forer den.
- **Humør:** mett og fornøyd → sulten → sur → (etter to uker uten mat) dramatisk sulten. Den dør aldri.
  Den blir bare veldig, veldig teatralsk.
- **Den vokser med nivåene:** egg → unge → voksen → praktfull. Milepæler låser opp tilbehør (en hatt,
  briller, en kaffekopp) — og kurs med tema kan gi temautstyr (KI-kurs: en liten robotantenne).
- **Ferie:** en knapp som legger den i dvale, så ingen kommer tilbake til en sultestreik.
- **Tonen:** skyld og humor, aldri skam. «Jeg har begynt å spise på kontorplanten.» «Jeg vet du har
  det travelt. Jeg har det også travelt. Med å sulte.» Maskoten vet aldri noe om timeføring,
  prosjekter eller kalender — den kjenner bare kursene.
- **Valgt (produkteier 2026-11-01): seilbåten «Skuta» — storseilet A og rorsmann 2**, bygd på
  A-2-logoen. Se «Bestemt 2026-11-01/02» over for seilet, fargene og størrelsene. A trenger vind
  (erfaringspoeng); 2 bærer humøret. Sulten = stille vær; 2 henger over rorpinnen. **Vekst vises bare
  med størrelse** — samme båt, større. Seilet er like stort i alle humør; formen forteller (bukt,
  flatt, to store bitt i kanten, henger i folder med bommen sigende). Fartsstriper bak båten viser at
  den går fremover. Karakterarket (utkast 2.2) står i skissen; beskrivelser til bildegenerering i
  `doc/design/MASKOT_BESKRIVELSER.md` og ledetekstpakken (se over).
- **Navn:** åpent. Brukeren kan gi sin egen båt et navn, som båteiere gjør.

### 3. Felles mål — hele firmaet forer én stor maskot

Ved siden av den personlige finnes **firmaets maskot**, som alle forer sammen.

- Administrator setter et **månedsmål** i XP og en **belønning** i fritekst («Dessert på månedsmøtet»).
- Alle ser fremdriften mot målet, og **sin egen andel** markert i den («Du har gitt 340 av 4 120»).
  Ingen andre navn, ingen rangering.
- Når målet nås: konfetti for alle, maskoten feirer, og belønningen står på skjermen. Administrator får
  beskjed og ordner desserten.
- Hver måned målet nås, vokser firmamaskoten litt — et synlig minne om alle månedene vi klarte det.
- Administrator ser bare summen.

### 4. Rekker (streaks) — per uke, ikke per dag

- En uke teller når du har fått minst **50 XP** (omtrent én modul eller noen seksjoner).
- Rekka vises med maskoten («7 uker på rad!»). Å miste den gjør vondt — det er poenget.
- **Skjold:** hver fjerde uke i rekka gir et skjold som redder rekka én uke du ikke rakk det. Ferie
  stopper rekka uten å bryte den.

### 5. Ukentlig e-post fra maskoten — mandag morgen

På som standard, kan slås av på profilen. Ingen lenker. Innhold:

1. Maskotens humør, i én setning med humor.
2. Kursene du har i gang — og hvor mye som gjenstår.
3. Frister de neste to ukene, tydelig.
4. Rekka di, og om den er i fare denne uka.
5. Felles mål: «Vi er på 72 % — 1 150 XP til desserten.»

Er det ingenting utestående, **sendes ingen e-post** (produkteier 2026-11-02; kortversjonen er
droppet). Siste linje forklarer alltid hvordan man melder seg av. Punkt 4 og 5 kommer når rekker og
felles mål finnes. Spesifisert i #1139.

### Profilsiden: min statistikk

Bare for brukeren selv. Per uke, de siste 12 ukene (tomme uker vises): seksjoner lest, moduler
bestått, kurs fullført, anslått lesetid — og XP når XP finnes. Båten øverst i humøret fra humørregelen,
for anker når e-posten er slått av. Nivå, rekke, skjold og merker kommer med XP. Spesifisert i #1138.

**Bygget i 2.141.0** (produkteier 2026-11-07): profilen har konto først, så tre faner — «Statistikk»,
«Beståtte kurs», «Beståtte moduler» — så rettighetene. Statistikken viser båten med en maritim linje per
humør, de fire siste ukene, tolv uker som søyler (med en tabell for skjermlesere) og totalene. Bildene er
e-postbildene fra 2.138.0 (`/static/boat/`): mett = «vurdering bestått», sulten = «frist snart», sur =
«ikke bestått», dramatisk = «frist forfalt», ny = «kurs tildelt». Humørregelen er én funksjon på
serveren (`src/modules/gamification/boatMood.ts`). Anker er ikke bygget; det kommer med avmeldingen i
#1139, som en overstyring i den samme funksjonen.

### Merker (få, og morsomme)

Bare for ekte milepæler: første kurs, fem kurs, ti uker på rad, første svar i en diskusjon, ti svar,
første spørsmål noen svarte på, «Comeback» (tilbake etter fire uker borte). Overraskelsesmerker som
ikke står på lista i forkant.

## Det som holder grensen

- XP-hendelser lagres per bruker, men leses bare av brukerens egne flater og av summen for felles mål.
  Ingen rapport, ingen rolle og ingen eksport viser én persons poeng, nivå, rekke eller maskot.
- «Min statistikk» (2.141.0) leses bare gjennom `GET /api/me/stats`, som alltid svarer for den innloggede
  og aldri tar imot en bruker-ID. Integrasjonstesten (`test/me-stats-1138.test.ts`) prøver bruker-ID i
  spørrestrengen og adressen, også som administrator. Bekreftet: ingen rapport eller eksport leser
  `myStats.ts`.
- «Aktivitet»-fanen blir bare for administrator.
- E-posten har ingen sporing av hvem som åpner den.

## Åpne spørsmål til produkteier

1. **Navnet:** brukeren kan gi sin egen båt et navn; skal båten ha et fast navn i portalen («Skuta»)?
2. **Felles mål:** hele firmaet, eller per avdeling/klasse? (Per avdeling gir litt konkurranse mellom
   lag — uten å rangere personer.)
3. **Poengtallene:** er tabellen over riktig vektet?
4. **Hvem setter månedsmålet og belønningen** — administrator, eller en egen rolle?

## Rekkefølge (skiver)

0. **Gjort i 2.130.0:** seilbåten på fremdriftslinja (#1137) og favicon.
1. «Min statistikk» på profilen uten XP (#1138), og ukentlig e-post (#1139) — begge bygger på data
   som finnes. Deretter XP-hendelser (lagring, regler, tilbakefyll fra historikken), som gir
   statistikken en XP-kolonne.
2. Maskoten i «Mine kurs»: metthet, humør, vekst, ferie.
3. Felles mål og firmaets maskot; administrator setter mål og belønning.
4. (Ukentlig e-post er flyttet fram til skive 1, se #1139.)
5. Rekker, skjold og merker.
6. Diskusjonspoeng (spørsmål, svar, «noen svarte»).

Egen liten endring, før dette: «Aktivitet»-fanen bare for administrator.
