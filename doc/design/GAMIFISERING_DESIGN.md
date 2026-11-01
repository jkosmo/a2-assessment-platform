# Gamifisering — design (utkast til produkteier)

Status: **utkast**, 2026-11-01. Ikke bygget. Bygger på `doc/research/GAMIFISERING_RESEARCH.md` og
produkteiers svar samme dag. Skisse: se artefakten som følger designet.

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
- **Navn:** forslag i skissen. Brukeren kan gi sin egen maskot et kallenavn.

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

Er det ingenting å si (ingen kurs i gang, ingen frister, rekka trygg), sendes kortversjonen.

### Profilsiden: min statistikk

Bare for brukeren selv. Per uke, de siste 12 ukene: XP, seksjoner lest, moduler bestått, kurs fullført,
anslått lesetid. Nivå, maskot, rekke, skjold og merker.

### Merker (få, og morsomme)

Bare for ekte milepæler: første kurs, fem kurs, ti uker på rad, første svar i en diskusjon, ti svar,
første spørsmål noen svarte på, «Comeback» (tilbake etter fire uker borte). Overraskelsesmerker som
ikke står på lista i forkant.

## Det som holder grensen

- XP-hendelser lagres per bruker, men leses bare av brukerens egne flater og av summen for felles mål.
  Ingen rapport, ingen rolle og ingen eksport viser én persons poeng, nivå, rekke eller maskot.
- «Aktivitet»-fanen blir bare for administrator.
- E-posten har ingen sporing av hvem som åpner den.

## Åpne spørsmål til produkteier

1. **Maskoten:** hvilket dyr eller vesen, og hvilket navn? (Forslag i skissen.)
2. **Felles mål:** hele firmaet, eller per avdeling/klasse? (Per avdeling gir litt konkurranse mellom
   lag — uten å rangere personer.)
3. **Poengtallene:** er tabellen over riktig vektet?
4. **Hvem setter månedsmålet og belønningen** — administrator, eller en egen rolle?

## Rekkefølge (skiver)

1. XP-hendelser (lagring, regler, tilbakefyll fra historikken) + «min statistikk» på profilen.
2. Maskoten i «Mine kurs»: metthet, humør, vekst, ferie.
3. Felles mål og firmaets maskot; administrator setter mål og belønning.
4. Ukentlig e-post fra maskoten (på som standard, kan slås av).
5. Rekker, skjold og merker.
6. Diskusjonspoeng (spørsmål, svar, «noen svarte»).

Egen liten endring, før dette: «Aktivitet»-fanen bare for administrator.
