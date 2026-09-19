# Design #997 — «bestått gjelder til modulen revideres»: hva er en revisjon?

Status: **avgjort av produkteier 2026-09-19** — se «Beslutningen» nederst. Notatet står som det
var da valget ble tatt; beslutningen er ført på slutten, ikke flettet inn, så begrunnelsen kan
etterprøves mot det som faktisk lå på bordet.

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

---

# Beslutningen (produkteier 2026-09-19)

**1. Hva teller som revisjon: A — forfatteren merker det.** Avkryssing ved publisering, av som
standard, med teksten som sier hva den gjør. Ingen utledning, heller ikke som forslag: terskelen er
en gjetning, og #928 avgjorde allerede at en gjetning skal stille et spørsmål, ikke handle.

**2. Tidligere bestått blir `SUPERSEDED`,** ikke slettet. Ny verdi i
`CertificationLifecycleStatus`, pluss `supersededByVersionId` på `CertificationStatus`.

⚠️ Den som bygger dette: verdien skal **ikke** legges til i `CERTIFICATION_PASSED_STATUSES`
(`certificationRepository.ts`). Lista er den ene kilden til «har hen bestått modulen», brukt av
kursbevisporten og rapportene; en verdi utenfor lista slutter å telle av seg selv. Lista er pinnet
av `test/unit/course-certificate-gate-invariant.test.ts` — utvid testen med `SUPERSEDED` som en
verdi som IKKE er bestått, ellers måler den ikke det nye tilfellet.

Ingen datamigrasjon utover enum-verdien og kolonnen: eksisterende rader endres først når noen
publiserer med valget på.

**3. Deltakeren får egen kategori OG e-post.** Produkteier valgte varsling, ikke bare stille
tilgjengeliggjøring:

- **I deltakerflaten:** modulen blir tilgjengelig igjen med «Modulen er revidert etter at du besto
  den. Ta den på nytt for at den skal telle i kursbeviset.»
- **I statusrapporten:** egen kategori «må tas på nytt», adskilt fra ikke bestått — ellers ser en
  innholdsoppdatering ut som at mange plutselig feiler.
- **E-post:** ett varsel per deltaker per revidert modul.

  ⚠️ E-posten skal gå gjennom **outboxen** (`OUTBOX_EVENT_TYPES`, ny `moduleRevisedNotification`),
  enqueuet i samme transaksjon som publiseringen. Grunnen står i #1007: ankevarslene gikk utenom
  outboxen, og et tapt varsel retter seg aldri av seg selv. Teksten følger **mottakerens** språk
  (#970 — ikke hardkodet bokmål), og leveringen er idempotent, så en gjenlevering etter krasj ikke
  sender to.

  ⚠️ Volum: publiserer forfatteren en revisjon av en modul 200 personer har bestått, går det 200
  e-poster på én knapp. Publiseringsdialogen må derfor si tallet før den sender: «N deltakere har
  bestått denne modulen og vil få beskjed.» Det er samme avveining som #989 fjernet
  resertifiseringsmaset for — forskjellen er at dette skjer én gang per revisjon, ikke på en
  kalender.

**Ikke besluttet, og bevisst utelatt:** en angrefunksjon (en senere versjon som gjenoppretter
tidligere bestått). Sjelden feil; administrator kan rette per person. Tas opp igjen bare hvis det
faktisk skjer.

## Rekkefølge når det bygges

1. Migrasjon: enum-verdi `SUPERSEDED` + `supersededByVersionId` (nullable). Ingen dataflytting.
2. Publiseringskommandoen: flagg på publiseringsforespørselen → sett `SUPERSEDED` på alle
   `ACTIVE`-rader for modulen, i samme transaksjon, og enqueue ett outbox-varsel per deltaker.
3. Kursbevisporten: ingen kodeendring (verdien står utenfor lista) — men utvid invariant-testen.
4. Deltakerens modulkort + statusrapportens kategori.
5. Publiseringsdialogen: avkryssing + antallet som vil få beskjed.

Skillet er uberørt: det publiserer aldri (#651).
