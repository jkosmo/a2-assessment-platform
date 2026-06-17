# Læringsseksjoner — brukerguide

> Bruker- og forfatterveiledning for læringsseksjoner i kurs (#476). Teknisk referanse:
> [API_REFERENCE.md](API_REFERENCE.md); design/IA: [DESIGN_476_LMS_SECTIONS_IA.md](DESIGN_476_LMS_SECTIONS_IA.md).

## Hva er en læringsseksjon?

En **læringsseksjon** er lesestoff (markdown med tekst, bilder, lenker og evt. embedded video)
som kan legges **mellom moduler i et kurs**. Der en modul tester og vurderer deltakeren, er en
seksjon innhold deltakeren leser før hen går videre. Seksjoner er **gjenbrukbare** — samme
seksjon kan brukes i flere kurs (et bibliotek, slik moduler fungerer).

Et kurs blir dermed et **forløp** av elementer: moduler (vurdert) og seksjoner (lest), i den
rekkefølgen forfatteren bestemmer.

---

## For forfattere (SMO/administrator)

### 1. Opprett eller rediger en seksjon

1. Gå til **Innholdsforvaltning → Seksjoner**.
2. **«+ Ny seksjon»** (eller **«Rediger»** på en eksisterende).
3. Skriv en **tittel** og innholdet i **Markdown**-feltet. **Forhåndsvisningen** til høyre
   viser hvordan deltakeren ser det (samme sanitisering som i deltaker-visningen).
4. Klikk **«Lagre ny versjon»**. Hver lagring oppretter en ny, immutabel versjon — historiske
   visninger påvirkes ikke (siste versjon vises til nye lesere).

> **Tips — markdown:** overskrifter (`#`), lister, **fet**/_kursiv_, lenker `[tekst](url)`,
> bilder og kodeblokker støttes. Skript og utrygge elementer fjernes automatisk.

### 2. Flere språk (nb / nn / en-GB)

- Bruk **språk-fanene** øverst i editoren til å skrive hvert språk manuelt.
- **«Oversett fra dette språket»** bruker KI til å oversette tittel + innhold til de andre
  språkene (markdown bevares). **Se alltid over** resultatet før du lagrer — du eier teksten;
  oversettelse er et utgangspunkt, ikke en automatisk sannhet.
- En deltaker ser seksjonen på sitt profilspråk; mangler et språk, faller visningen tilbake til
  et utfylt språk (aldri tomt).

### 3. Embedded video

Du kan lime inn en `<iframe>` mot **betrodde video-verter** (YouTube, youtube-nocookie, Vimeo).
Andre iframes fjernes av sikkerhetshensyn.

### 4. Legg seksjonen inn i et kurs

1. **Innholdsforvaltning → Kurs** → åpne kurset.
2. Under **«Innhold i kurset»**: bruk nedtrekkslista nederst og **«Legg til seksjon»** (velg fra
   biblioteket). Seksjoner vises med **blått [SEKSJON]-merke**, moduler med [MODUL].
3. Bruk **↑/↓** for å plassere seksjonen i ønsket rekkefølge mellom modulene.
4. **«Lagre kurs»**, deretter **«Publiser kurs»**.

### 5. Eksport / import

Kurs-eksport (**«Eksporter»** på et kurs) tar med seksjonene og rekkefølgen i pakkefila, og
**«Importer kurs-pakke»** gjenskaper dem i målmiljøet. (Eldre pakker uten seksjoner importeres
fortsatt.)

---

## For deltakere

- I et kurs vises seksjoner i forløpet med **«Les»** og et **«Ikke lest»/«Lest»**-merke.
- Klikk en seksjon → innholdet åpnes i en lesevisning (mobilvennlig).
- Klikk **«Marker som lest»** når du er ferdig → seksjonen telles som fullført.
- **Fremdrift** teller **alle elementer**: en seksjon som er lest og en modul som er bestått
  teller likt mot «X/Y fullført».

---

## Begrensninger / på vei

- **Bilde-opplasting** (`{{asset:...}}`) i seksjoner er under arbeid (#483/#489) — foreløpig
  refereres bilder via URL.
- **Versjons-pinning per deltaker** (at en deltaker midt i kurset beholder en bestemt versjon)
  kommer senere; nå vises siste versjon.
