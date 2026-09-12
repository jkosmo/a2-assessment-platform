# Brukerflatene: hvordan gjøres de samme handlingene på tvers?

*Skrevet for hånd 2026-09-12 ut fra opptelling i koden (se «Slik er det målt» nederst). Del 2 av
inventaret for #1046; del 1 (`UI_INVENTORY.md`) handler om byggeklosser, denne om handlinger.
Ingen anbefaling — et grunnlag for å velge.*

## Bekreftelse før noe endres

Tre måter å spørre «er du sikker?» på, avhengig av hvilken side du står på:

| Måte | Hvor | Eksempel |
|---|---|---|
| Nettleserens egen boks (`window.confirm`) | klasser (arkiver, gjenopprett), kurs (arkiver, avpubliser), bibliotek (slett), seksjoner, kalibrering, samtale | «Arkivere kurset «X»? Det skjules for deltakerne …» |
| Egen dialog i siden (`<dialog>`) | kurs (slett, kaskade-publiser, kaskade-slett), bibliotek (rydd upubliserte), samtale (ulagrede endringer), profil (slett meg) | dialog med tittel, tekst og to knapper |
| Ingen bekreftelse | deltakersidene, sensor, rapporter, kullstatus | — (de har få destruktive handlinger) |

Samme handling — **slett** — er nettleserboks i biblioteket og egen dialog i kurs. **Arkiver** er
nettleserboks overalt. Nettleserboksen kan ikke oversettes av oss og ser ulik ut i hver nettleser.

## Å gi noe et navn

| Måte | Hvor |
|---|---|
| Nettleserens `window.prompt` | klasser («Navn på klassen:»), seksjoner, samtale (2 steder) |
| Felt i et skjema / dialog | bibliotek (opprett modul-dialog), kurs (kursdetaljen) |
| Gjennom samtalen med assistenten | samtale (omdøping av modul) |

## Å opprette noe nytt

| Side | Hvordan |
|---|---|
| Bibliotek | knapp «Ny modul» → dialog |
| Kurs | lenke til egen side `/courses/new` (samtaleveiviser) |
| Seksjoner | knapp → skjema i siden |
| Klasser | knapp → `window.prompt` |
| Samtale | gjennom dialog med assistenten |

Fire sider, fire måter.

## Søk og filter

| Side | Søk (fritekst) | Filter |
|---|---|---|
| Bibliotek | ja | kurs |
| Sensor: køer | ja (to køer) | status |
| Rapporter | nei | modul, kurs, datoer |
| Kalibrering | nei | kurs |
| Kurs, seksjoner, klasser | nei (klasser har modulsøk inne i én klasse) | nei |
| Deltakersidene, kullstatus, admin-plattform | nei | kullstatus: kurs |

Søkefeltet i biblioteket og i sensorkøene er to ulike implementasjoner; #1027 fant at det ene
søkte i råformatet og traff på tvers av språk, det andre ikke.

## Lagre

| Måte | Hvor |
|---|---|
| Egen «Lagre»-knapp | kurs (kursdetaljen), seksjoner (editor), samtale (Rediger-fanen), admin-plattform |
| Lagres i det du gjør handlingen | klasser (legg til medlem/kurs), bibliotek, deltakersidene (svar, lesing) |
| Begge på samme side | samtale: innstillinger lagres ved endring, Rediger med knapp |

## Detaljvisning

| Side | Hvordan åpnes et element |
|---|---|
| Kurs, seksjoner, klasser | ny side (`/…/:id`) |
| Bibliotek | lenke til samtalen for modulen (ny side) |
| Sensor: køer | detaljpanel under lista, samme side |
| Deltaker: Mine kurs | trekkspill (åpnes i lista) |
| Rapporter | drilldown-tabell under, samme side |

## Tilbake

Etter #1052 følger «Tilbake» opphavet i kurs → seksjon/modul. Sensor og rapporter har ingen
«tilbake» (alt er på én side). Modularbeidsflaten (samtalen) har ingen tilbake-knapp i det hele tatt.

## Det tallene ikke fanger

- **Plassering:** står hovedknappen øverst til høyre, nederst, eller inne i raden? Det krever
  skjermbilder — se galleriet.
- **Tomme lister:** hva står det når det ikke er noe? Del 1 viser at fire forfattersider skriver sin
  egen tekst; hva teksten *sier* er ikke målt.
- **Tastatur:** #977 viste at ett av to like søkefelt ikke kunne betjenes med tastatur. Ikke
  systematisk målt for resten.

## Slik er det målt

Opptelling i `public/*.js`, `public/static/admin-content-*.js` og HTML-filene av: `window.confirm(`,
`window.prompt(`, `<dialog id=…>`, `id="*Search*"`/`id="*Filter*"`, `id="save*"`, `href="…/new"`.
Kolonnene «Detaljvisning», «Lagre» og «Tilbake» er lest ut av koden for hånd. Tallene sier hva som
finnes, ikke hvor ofte det brukes.
