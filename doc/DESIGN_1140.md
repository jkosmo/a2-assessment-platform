# #1140: kurset bestemmer hva deltakerne ser

Status: designnotat til produkteier, 2026-11-11, andre utgave. Ingenting er bygget. Erstatter første utgave (bare kursutkast)
og planutkastene fra samme kveld. Forklaring med flyt: artifakten «Klar kursoppdatering».

## Målbildet

Én regel: **det deltakerne ser i et kurs, endres bare når noen publiserer kurset.**

- Et kurs er en **utgave**: tittel, innstillinger, og en liste over innhold der hver modul står på en bestemt hovedversjon.
- Et publisert kurs kan ha ett **utkast**: neste utgave. «Lagre» skriver dit, «Publiser» gjør utkastet til den gjeldende
  utgaven, med ett spørsmål om mindre versjon eller hovedversjon av kurset.
- Å publisere en **modul** endrer ikke lenger kursene. En rettelse (mindre versjon) går til kursene som står på den
  hovedversjonen. En ny hovedversjon blir liggende klar; hvert kurs tar den i bruk når eieren publiserer kurset.
- **Skillet og kursfiler** skriver til kursets utkast.

Produkteier 2026-11-11: delt innhold er sjeldent i dag, så dette lønner seg ikke for tilfellet alene. Begrunnelsen er et
konsistent grunnlag med gjennomgående mønstre. Notatet måler seg derfor på **hva som kan fjernes** (se under).

## Slik er det i dag (kartlagt 2026-11-11)

- En modul har én publisert versjon (`Module.activeVersionId`). Alle kurs med modulen viser den. Publiseres en ny, endres alle
  kursene med en gang.
- #934 gjorde **«bestått»** til noe hvert kurs avgjør (`CourseModuleRequirement.minModuleMajor`, en terskel), men ikke
  **innholdet**. Et kurs som svarer «mindre» på en ny hovedversjon av en modul, viser likevel den nye teksten.
- Deltakerflyten har **ingen kurskontekst** for moduler: modulene hentes fra én felles liste, og en innlevering vet ikke hvilket
  kurs den gjelder.
- **Etter at innleveringen finnes, leser ingen «gjeldende versjon».** Flervalg, vurdering, vedtak, resultat og bestått følger
  innleveringens versjon. Gjeldende versjon leses bare når deltakeren åpner modulen og i det hen leverer. Det er seks filer.
- En modul har én rett historie: ny versjon får alltid nummer etter den høyeste. En eldre hovedversjon kan ikke få rettelser.
- Kurs har ingen utkast: «Lagre» skriver rett i det deltakerne ser.
- Seksjoner publiserer ved lagring, har ikke hovedversjoner, og figurene deres er felles for alle versjoner.

## Designet

### 1. Kurset står på en hovedversjon av hver modul

Raden som i dag holder kravet per kurs og modul (`CourseModuleRequirement`), får ett felt til: hovedversjonen kurset **viser**.
Da bor de to tingene kurset bestemmer om en modul, på samme sted: hva nye deltakere får, og hvilke beståtte som teller.
Vist versjon er alltid minst like høy som kravet.

Feltet står tomt til kurset tar en hovedversjon i bruk, og tomt betyr «følger modulens nyeste», som i dag. Alt ser likt ut
dagen etter innføringen, uten at noe må fylles inn. Ved vendingen (etappe 3) settes feltet for alle kurs.

### 2. Hvilken versjon en deltaker får

Én funksjon svarer (`participantModuleVersion.ts`), og deltakerflyten bruker den når modulen åpnes og i det den leveres:

> 1. **Kurset modulen åpnes fra, bestemmer.** Deltakersiden sier hvilket kurs. Har deltakeren tilgang til det kurset, og
>    inneholder det modulen, får hen hovedversjonen det kurset viser.
> 2. **Reserven**, når kurset ikke er kjent (lenke i e-post, frittstående modus) eller ikke gjelder: den høyeste hovedversjonen
>    blant kursene deltakeren har tilgang til som inneholder modulen.
>
> I begge: et kurs uten låst hovedversjon følger modulens nyeste, og innen hovedversjonen gis den nyeste publiserte versjonen.
> Uten noe kurs (forfatter som ser på modulen): modulens nyeste.

Bare åpning og levering trenger kurset. Alt etter innleveringen følger innleveringens egen versjon, og en bestått teller i et
kurs etter kravet der (en terskel), uansett hvilket kurs modulen ble åpnet fra.

**Endret samme kveld.** Første avgjørelse var bare reserven («den høyeste blant kursene deltakeren har»). Planlesingen viste at
alle har tilgang til åpne kurs og kurs tildelt «Alle deltakere», så ett slikt kurs på en høyere hovedversjon ville gitt ALLE
den, også i kurs som har låst en lavere. Da holdt ikke målbildet. Antakelsen om at kurset måtte følge med gjennom alt
deltakeren gjør i en modul, var også feil: det gjelder to steder.

### 3. Modulens historie er én rett linje

Eldre hovedversjoner fryses når en nyere finnes: de vises til kursene som står på dem, men får ikke nye rettelser. Den som vil
endre en eldre linje, publiserer endringen som ny hovedversjon. Ingen forgrening.

### 4. Publisere en modul

- **Mindre versjon** (rettelse): går til alle kurs som står på den hovedversjonen, og de får en mindre kursversjon, som i dag.
  Bare modulens eiere og administrator.
- **Hovedversjon:** ingen kurs endres. Eierne av kursene som bruker modulen, får beskjed, og kursbyggeren viser «Ny
  hovedversjon tilgjengelig».
- Dialogen spør bare om mindre eller hoved for **modulen**. Spørsmålene per berørt kurs forsvinner.

### 5. Kursutkastet og publisering av kurset

Som i første utgave av notatet: tabellen `CourseDraft` ved siden av de levende radene, i kursskjemaets eget format, og bare
kursbyggeren leser den. Avgjort av produkteier: utkastet omfatter **alt** i kursskjemaet. Lista over innhold bærer også
hvilken hovedversjon hver modul skal stå på.

«Publiser» er ett steg og én transaksjon: innhold som er nytt i kurset publiseres, kursets felt og liste skrives med dagens
kode, hovedversjonene kurset tar i bruk settes, og kursets versjon avgjøres **én** gang:

- **Mindre kursversjon:** nye deltakere får det nye; beståtte og kursbevis står.
- **Hovedversjon av kurset:** kravet heves til det kurset nå viser, e-post til dem med kursbevis, endrede seksjoner leses på
  nytt. Som #934.

«Forkast utkast» fjerner utkastet. Alle som kan redigere kurset, kan lagre, publisere og forkaste.

### 6. Innhold forfatteren ikke eier

Løsningen på spørsmål 3: den som eier et kurs, kan lage en **ny hovedversjon** av en modul som ligger i kurset, også når noen
andre eier modulen. Den tas bare i bruk av dette kurset. Modulens eier og eierne av andre kurs med modulen får beskjed, og kan
ta den i bruk. Ingen kopi, og beståtte følger modulen.

Mindre versjoner av andres moduler kan kurseieren ikke publisere: de ville endret andres kurs.

### 7. Kursfil og skillet

`updateExisting` skriver til kursets utkast, fra portalen (avgjort) og fra skillet med agent-tokenet. Endret innhold blir
utkast til ny versjon av modulen eller seksjonen; nye moduler legges inn i utkastet på riktig plass. Tokenet når aldri
publisering.

### 8. Seksjoner

Samme mønster, i en egen etappe til slutt: seksjoner får lagring som utkast og hovedversjoner, og kurset står på en
hovedversjon. Før det må figurene undersøkes: de er i dag felles for alle versjoner av en seksjon, så en eldre versjon kan
miste bildene sine. Til etappen er bygget, virker seksjoner som i dag.

## Dette fjernes

| Fjernes | Hvorfor det finnes i dag |
|---|---|
| Spørsmål per berørt kurs når en modul publiseres (`findAffectedCourses`, `answersWithOwnership`, `expectedCourseIds`, og dialogen for flere kurs) | En modulpublisering endrer alle kurs |
| «Andres kurs får mindre versjon» ved ny hovedversjon | Samme |
| «Publiser nye versjoner» som eget steg, i to utgaver (`publishCoursePendingVersions`, `…Versioned`) | Kurset har ikke utkast |
| Bytte med kopi ved kursimport, med flytting av lesinger og arkivering av originalen | Kurseier kan ikke endre andres modul uten å endre andres kurs |
| «Ny modul i et publisert kurs legges utenfor kurset» | Kurset har ikke utkast |
| Kjent mangel 63 (#1144): kurseier kan ikke kreve nytt forsøk etterpå | Kravet kan bare heves i samme publisering som lager hovedversjonen |
| Versjonsspørsmålet i «Lagre» i kursbyggeren | Lagring og publisering er samme handling |

Det som står: bestått per innlevering (`ModulePass`), kravet som terskel, `applyCourseVersionChange`, reglene for lesing av
seksjoner, kursbevisene, innholdslåsen og vaktene rundt dem.

## Etapper

Hver etappe kan rulles ut alene, endrer så lite som mulig for brukerne, og blir ikke kastet av den neste.

| | Etappe | Merkes av brukerne |
|---|---|---|
| 1 | **Vist hovedversjon per kurs, og den ene funksjonen for hvilken versjon en deltaker får.** Feltet står tomt (følger modulens nyeste, som i dag). Deltakersiden sier hvilket kurs modulen åpnes fra. | Nei |
| 2 | **Kursutkast**, bak bryter: «Lagre» skriver til utkastet, «Publiser utkastet» skriver det til kurset med dagens lagring. «Publiser nye versjoner» står som egen knapp. Bryteren av i prod til etappe 3 (`doc/design/PLAN_1140_E2.md`). | Bare på stage |
| 3 | **Vendingen og den ene publiseringen:** ny hovedversjon av en modul endrer ikke kursene; «ta i bruk» i kursbyggeren; beskjed til eierne. «Publiser» sender ut utkastet og nye versjoner samlet, med ett svar. Det gamle maskineriet fjernes. Bryteren på i prod. | Ja |
| 4 | **Kursfil og skillet til utkast**, og ny hovedversjon av andres modul. | Ja |
| 5 | **Seksjoner** med samme mønster. | Ja |
| 6 | Skillet og dokumentasjonen følger etappe 4. | |

## Størrelse og risiko

- Omtrent som #934, som gikk over elleve versjoner. Etappe 2 og 3 er de tunge.
- **Kjernen i deltakerflyten** berøres i etappe 1, men bare på to punkter: når modulen åpnes, og i det den leveres. Alt etter
  innleveringen er urørt. Etappe 1 skal bevises med at ingenting endrer seg.
- **Publiseringen** i etappe 2 og 3 avgjør versjon, krav og e-post. Der må mutasjonstestene være tettest.
- **Overgangen:** alle kurs settes til modulens nåværende hovedversjon. Kurs med utkast finnes ikke før etappe 2.
- **Ikke undersøkt ennå:** forfatterklienten for moduler (statusmerker og publiseringsdialogen), hele bytte-logikken i
  importen, og om seksjonsfigurer overlever at en eldre versjon vises.

## Avgjort av produkteier (2026-11-11)

- Kursutkastet omfatter alt i kursskjemaet.
- Opplasting av kursfil i portalen går til utkastet.
- Bryter for utrullingen.
- Hvert kurs låser sin versjon, selv om delt innhold er sjeldent: for mønsterets skyld.
- Alt går under #1140, og ingenting bygges før det kan gjøres skikkelig.
- **Kurset modulen åpnes fra, bestemmer versjonen.** Uten kjent kurs: den høyeste blant kursene deltakeren har modulen i
  (første avgjørelse, nå reserven). En bestått teller i hvert kurs etter kravet der.
- **Eldre hovedversjoner fryses:** ingen rettelser i en gammel linje når en nyere finnes.
- **Kurseier kan lage ny hovedversjon av andres modul** for sitt kurs. Eierne av modulen og av andre kurs med modulen får
  beskjed på e-post og i kursbyggeren.
- **Seksjoner tas til slutt**, som egen etappe, og virker som i dag til da.
- **Vi går videre.** Plan for etappe 1: `doc/design/PLAN_1140_E1.md`.
