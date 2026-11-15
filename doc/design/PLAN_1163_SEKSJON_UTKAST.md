# «Lagre» på en seksjon blir et utkast (#1163) — plan

**Avgjort av produkteier 14.11.2026:** «La oss gjøre det likt». «Lagre» på en seksjon gjør det samme som på kurs og moduler:
et utkast; publisering er et eget steg. Tittel og innhold lagres i én transaksjon. (doc/DECISIONS.md, «Svar fra produkteier på
#1157, første runde».) Saken ber også om at modulen får stripen «Deltakerne ser versjon X …».

Kartlagt i koden 15.11.2026 (etter 2.164.1).

## Slik er det i dag

- **Deltakerne leser bare den publiserte versjonen** (`activeVersionId`): leseren, kursdetaljen, «Mine kurs», #934-øyeblikksbildene
  og lesereglene (#1156). Slutter lagringen å publisere, ser deltakerne ingenting før noen publiserer. **Ingenting på
  deltakersiden brekker.**
- **Publiseringssteget finnes:** `publishSection` peker seksjonen på nyeste versjon, med oversettelsesporten (422) og en
  mindre versjon i kursene. Kursets «Publiser nye versjoner» (#934) tar seksjonsutkast og stiller versjonsspørsmålet per kurs.
- **«Nyere utkast» finnes:** livsløpet `published_with_draft` og merket brukes alt for seksjoner som oversettelsesporten holdt
  igjen.
- **Det som lagrer og publiserer i dag:** `updateSectionContent` lager en ny versjon og publiserer den, med mindre porten
  holder den igjen; `createSection` publiserer som standard. Klienten lagrer i to kall (PATCH tittel, PUT innhold), uten
  revisjonssjekk. Tittelen er ikke versjonert (`CourseSection.title`), heller ikke for moduler.
- **Oversetting:** kurs, moduler og tema oversettes ved lagring; seksjonen har en egen knapp. Figuroversetting skriver rett
  på bildet (felles for alle versjoner).
- **Agent-API-et og skillen** lager alltid utkast (`draft:true`) og er ikke avhengige av at lagring publiserer.

## Forslag

1. **Én lagring:** nytt `PUT /api/admin/content/sections/:id` med tittel og innhold i én transaksjon under innholdslåsen, med
   `expectedVersionNo` (versjonen editoren lastet). Er det kommet en nyere versjon, svarer den `409 section_changed`, og
   ingenting skrives. Lagringen lager en ny, ikke publisert versjon. Den gamle PUT `/content` blir stående en utrulling for
   gamle faner, men publiserer ikke lenger.
2. **Ny seksjon i editoren lagres som utkast** (`draft:true`), som en ny modul («Utkast») og et nytt kurs. Standarden i API-et
   for `POST /sections` endres ikke: rundt 77 testfikstur og importen «nytt kurs» bruker den. (Agent-API-et krever alt
   `draft:true`.)
3. **Publiser** på seksjonen bruker `publishSection` uendret: porten, og en mindre versjon i kursene seksjonen står i, slik
   #934 bestemte for seksjoner (DESIGN_934: «Seksjonen selv får ikke eget versjonsvalg»). En hovedversjon tas fortsatt fra
   kursets «Publiser nye versjoner». Før publisering vises en dialog i samme mønster som kursets publiseringsdialog (#1164):
   hvilke kurs som får den nye teksten.
4. **Oversettelsesporten** gjelder bare publisering. Den røde meldingen «Lagret, men ikke publisert …» forsvinner; et utkast
   trenger ikke si noe om publisering.
5. **Stripen** «Deltakerne ser versjon X til utkastet er publisert» på seksjonen og modulen, med kursets tekst uten navn
   (`lineNoName`): ingen versjonstabell vet i dag hvem som lagret.
6. **Den mindre versjonen i kursene** flyttes fra lagring til publisering (`updateSectionTitle`, `updateSectionContent`).

## Etter gjennomlesingen (Codex, 15.11.2026: «ikke klar»)

Endringene går foran teksten over.

1. **Eksport og import må ikke publisere et utkast.** Eksporten tar i dag med nyeste versjon, også et upublisert utkast, og
   importen «nytt kurs» lager seksjonen publisert når kurset er publisert. Et fullstendig utkast ville da gått rett ut.
   **Endring:** eksporten tar med både den publiserte versjonen og utkastet når de er ulike; importen gjenskaper det slik det
   var (publisert versjon aktiv, utkastet upublisert over). Test: publisert kurs, seksjon v1 aktiv, v2 utkast, eksport, import
   som nytt kurs: v2 er ikke publisert.
2. **Revisjonssjekken må dekke tittelen.** «Døp om» i lista og masseoversettingen av titler endrer tittelen uten ny versjon,
   så `expectedVersionNo` alene ville latt en gammel fane overskrive en nyere tittel. **Endring:** lagringen sender også
   tittelen fanen lastet, og tjeneren svarer `409 section_changed` hvis den er endret siden (ingen ny kolonne). Test mot både
   «Døp om» og masseoversetting.
3. **Publiseringen gjelder versjonen du så.** «Publiser» sender `expectedVersionNo`; har det kommet en nyere versjon mens
   dialogen sto åpen, svarer den `409`. Figuroversetting endrer bildet uten ny versjon og er ikke med i sjekken.
4. **Versjonsbumpen:** en endret tittel går ut med en gang (forslag A) og gir fortsatt kursene en mindre versjon, også fra
   lista. Bare bumpen for innholdet flyttes til publisering.
5. **Gamle faner under utrullingen:** en gammel editor lager en ny seksjon uten `draft:true` (publiseres) og lagrer i to kall.
   Det godtas i utrullingsvinduet og står i versjonsnotatet; vurder å bruke den eksisterende «klienten er utdatert»-sjekken
   (`409 client_outdated`) for seksjonslagringen, så en gammel fane blir bedt om å laste på nytt uten å miste teksten.
6. **Stripen og oversettingen:** detaljen returnerer både den publiserte og den redigerbare versjonen (ellers ville stripen
   kalt utkastet «det deltakerne ser»); editoren oppdaterer revisjonen etter hver lagring. Figuroversettingen får en egen
   knapp hvis tekstoversettingen skjer ved lagring (B). Oversettingen kjører utenfor innholdslåsen, og revisjonen sjekkes ved
   lagring.
7. **Uendrede unntak, skrevet ned som regler:** oppretting uten `draft:true` publiserer fortsatt og har fortsatt porten;
   agent-API-et krever `draft:true`; gjenoppretting med kurset setter tilbake den forrige publiserte versjonen; kaskadene
   bumper selv. Tester for nøyaktig én bump per vei.
8. **Regresjonstester** gjennom leserne: tilgjengelighet, #934-øyeblikksbilder og leseregler, #1156 lesing på tvers,
   kursutkastet (#1140) med en ny seksjon som publiseres før utkastet.

## Spørsmål til produkteier

A. **Tittelen.** Moduler har levende tittel: endres tittelen, ser deltakerne den med en gang, også mens innholdet er et
   utkast. Forslag: **likt moduler** nå (tittelen lagres i samme transaksjon, men går ut straks). Å versjonere tittelen for
   både seksjoner og moduler er en egen, større sak (berører alle steder som viser tittelen, eksport og import).
B. **Oversetting ved lagring.** Kurs og moduler oversetter når man lagrer. Forslag: **likt** — seksjonens tekst oversettes ved
   lagring, og den egne knappen forsvinner. Figurene (bilder med tekst) oversettes fortsatt bare når man ber om det: det koster
   KI-kall, og en figur er felles for alle versjoner, så en oversatt figur går ut med en gang.
C. **«Forkast utkast».** Kurs har det, moduler har det ikke. Forslag: **ikke nå** for seksjoner, likt moduler; «Forkast utkast»
   for både moduler og seksjoner blir en egen sak (det betyr å slette de upubliserte versjonene).

## Skiver

Én pakke (alle fire testsamlingene i samme runde):
- Tjeneren: ny lagring med revisjon; lagring publiserer ikke; versjonsbumpen ved publisering; porten bare ved publisering;
  gammel PUT `/content` publiserer ikke.
- Klienten: én lagring, stripe, publiseringsdialog, oversetting ved lagring (etter svar på B), ny seksjon som utkast.
- Modulen: stripen.
- Testene som sier «lagring publiserer» skrives om i samme pakke: m2-course-versions-934 (645–661), m2-admin-sections,
  m2-mcq-cue-warnings-1119, m2-content-ownership-enforcement, port-testene (896, 916, 1089, 957), e2e for seksjonslagring
  (1128, 1154, 1095), og vaktene som lister skriverne (archived-is-readonly-guard, course-version-write-guard).

## Utrulling

- Ingen migrering. Seksjoner som alt har et utkast (holdt igjen av porten), er samme tilstand som før: «Nyere utkast».
- En gammel fane som lagrer under utrullingen, treffer den gamle PUT `/content`, som nå lager et utkast i stedet for å
  publisere. Det er den trygge retningen.
- **Følge for forfatterne fra dag én:** endringer i seksjoner når ikke deltakerne før de publiseres. Forfatterveiledningen og
  meldingen etter lagring må si det.

## Tester

- Gjennom rutene: lagring lager en upublisert versjon, deltakeren ser den gamle; publisering viser den nye og gir kursene en
  mindre versjon; `409 section_changed` ved utdatert versjon (kontroll: riktig versjon lagrer); porten bare ved publisering.
- Nettleser: lagre, se stripen, publiser via dialogen; ny seksjon er utkast; to faner.
- Stage-test: rediger en publisert seksjon i et kurs, sjekk at deltakeren ser den gamle teksten, publiser, sjekk den nye.
- Mutasjonssjekk av hver regel.
