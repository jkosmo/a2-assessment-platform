# Design #997 — «bestått gjelder til modulen revideres»: hva er en revisjon?

Status: **forslag, venter på produkteier** (2026-09-18). Dette er en produktbeslutning før det er
kode; notatet gir tre svar å velge mellom og én anbefaling.

## Situasjonen

#989 fjernet resertifisering: *«moduler bør være som de er til de blir revidert».* Publisering
av en ny modulversjon flytter `activeVersionId`, men rører ingen `CertificationStatus`. Alle som
besto v1 står som bestått etter v2 — også når v2 er en helt annen oppgave. Ingenting sier fra.

## Tre svar på «hva er en revisjon»

| | Hva teller | Hvem avgjør | Risiko |
|---|---|---|---|
| A. **Forfatteren sier det** ved publisering: «Denne versjonen erstatter tidligere bestått» (av som standard) | Det forfatteren merker | Forfatter | Glemmes; eller brukes som pisk |
| B. **Utledet**: oppgavetekst/rubrikk/flervalgsbank endret over en terskel | Innhold | Kode | Terskelen er en gjetning; en skrivefeil kan nulle folks status |
| C. **Ingen automatikk**; administrator kan nullstille bestått for en modul som handling | Ingenting av seg selv | Administrator | Skjer aldri |

**Anbefaling: A**, med tre rammer:

1. **Valget står ved publisering, ikke lagring**, og er av som standard. Teksten sier hva det gjør:
   *«Deltakere som har bestått tidligere versjoner, må bestå denne på nytt for at modulen skal
   telle.»* Samme sted som språkgaten stopper publisering (#896 S4).
2. **Statusen slettes ikke — den blir `SUPERSEDED`.** `CertificationStatus` får en ny
   livssyklusverdi (enum finnes: `CertificationLifecycleStatus`) og et felt `supersededByVersionId`.
   Rapportene ser fortsatt at personen besto v1 den datoen; kursbevisporten (#985) teller ikke
   `SUPERSEDED` som bestått. Ingen datamigrasjon: eksisterende rader endres ikke før noen
   publiserer med valget på.
3. **Deltakeren får vite det** der modulen vises: *«Modulen er revidert etter at du besto den. Ta
   den på nytt for at den skal telle i kursbeviset.»* Ingen e-post i første omgang — det er
   samme «mas» #989 fjernet; modulen dukker bare opp som tilgjengelig igjen.

## Hvorfor ikke B

B er det som *høres* riktig ut («systemet vet når innholdet er endret»), men vi har akkurat
bestemt for #928 at tekstendring skal gi et **spørsmål**, ikke en automatisk handling — fordi
terskelen er en gjetning. Å la den samme gjetningen ta fra folk en bestått status er verre enn å
la den foreslå regenerering av kriterier. Hvis A viser seg å bli glemt, er B et *forslag* i
publiseringsdialogen («innholdet er vesentlig endret — skal tidligere bestått erstattes?»), ikke
en regel.

## Hva det ikke løser

Kursbevis som allerede er utstedt (#985) trekkes ikke tilbake. Det er riktig: beviset sier hva
som var sant da det ble utstedt. Om et *nytt* bevis kan utstedes uten at den reviderte modulen er
bestått på nytt, avgjøres av kursbevisporten — og med `SUPERSEDED` utenfor «bestått» blir svaret
nei av seg selv.

## Spørsmål til produkteier

1. A, B eller C — eller A med B som forslag?
2. Skal valget kunne angres (publisere en ny versjon som *gjenoppretter* tidligere bestått)?
   Anbefalt: nei i første omgang; det er en sjelden feil, og administrator kan rette per person.
3. Skal `SUPERSEDED` telle som «ikke bestått» i statusrapportene (rød), eller få sin egen farge?
   Anbefalt: egen kategori «må tas på nytt», så en revisjon ikke ser ut som stryk i tallene.

## Omfang når det bestilles

Migrasjon (én enum-verdi + én nullable kolonne), publiseringskommandoen (`publishModuleVersion` →
sett `SUPERSEDED` når flagget står), kursbevisporten (ekskluder), deltakerens modulkort (tekst +
tilgjengelig igjen), statusrapport (ny kategori), skillet (publiserer aldri — uberørt). To kvelder.
