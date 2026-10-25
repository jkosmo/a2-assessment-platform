# Icons — the platform's own library, chosen by meaning

Contents: [How an icon is written](#how-an-icon-is-written) · [Where an icon goes](#where-an-icon-goes) ·
[How to choose](#how-to-choose) · [Catalogue by meaning](#catalogue-by-meaning) · [The full list](#the-full-list)

The platform draws icons itself, from one library (Lucide). An icon is therefore the same in
every course, whatever the source was — a presentation, a document, a transcript, or the author's
own words. The source's own icons are never copied in; they tell you **what each step or card
stands for**, and you pick the library's icon for that meaning.

## How an icon is written

```markdown
![](icon:file-text)
```

- `icon:` followed by the library's name for the icon: lower-case words joined with hyphens.
- Empty alt text: the icon repeats the heading or the step and says nothing more.
- No `assets[]` entry: the platform serves the icon. `produce-course.mjs` checks every name
  against the list in this folder and fails on one it does not know.

## Where an icon goes

- **First in a card heading:** `### ![](icon:lightbulb) Idémyldring`.
- **In a step table, in the first column, which has no name:**

  ```markdown
  | | Steg | Hva du gjør |
  |---|---|---|
  | ![](icon:target) | **Forstå oppdraget** | Mandat, målgruppe, krav og rapportmal. |
  | ![](icon:folder-open) | **Klargjør kilder** | Dokumenter, intervjuer, data og notater. |
  ```

- **In a flow figure's steps**, as `icon` in the figure's description
  ([figure-design.md](figure-design.md#flows--drawn-by-a-script)). Then the step's line in the text
  under the figure has no icon of its own.
- Nowhere else. An icon in running text, in a list item or in a highlighted box is noise.
- A set of cards or steps either all have icons or none have. One icon per card or step, and the
  same icon never twice in one set.

## How to choose

1. Say in one word what the card or step **is about** (a document, a meeting, a check, a risk).
2. Find that word in the [catalogue](#catalogue-by-meaning). Take the first icon on the row
   unless another on the row fits the sentence better.
3. Not in the catalogue? Search [the full list](#the-full-list) for an English word for the
   meaning. Use the name exactly as it stands there.
4. Still nothing that fits? **No icon**, for the whole set. A near miss misleads more than a
   blank.

The icons are line drawings, 24 px, in the text colour. A concrete object reads better than an
abstract one: a step about writing gets a pen, not a sparkle.

## Catalogue by meaning

Norwegian words the author or the source uses — and the icon the platform has for them. Names in
`code` are the ones you write after `icon:`.

### Oppgave, mål og framdrift

| Betyr | Ikon |
|---|---|
| mål, hensikt, treffe | `target`, `goal`, `crosshair` |
| oppdrag, mandat, avtale | `handshake`, `scroll-text` |
| steg, retning, neste | `arrow-right`, `chevrons-right`, `route` |
| milepæl, delmål | `milestone`, `flag` |
| plan, framdriftsplan | `calendar-days`, `chart-gantt`, `list-ordered` |
| gjort, ferdig, godkjent | `check`, `circle-check`, `badge-check` |
| sjekkliste, kontroll | `list-checks`, `clipboard-check`, `square-check` |
| start, sett i gang | `play`, `rocket` |
| gjenta, iterere, ny runde | `refresh-cw`, `repeat`, `rotate-ccw` |
| prioritere, sortere, velge ut | `funnel`, `arrow-down-wide-narrow`, `list-filter` |
| resultat, premie, bestått | `trophy`, `award`, `medal` |
| vekst, bedring, trend | `trending-up`, `chart-line` |

### Dokumenter, kilder og tekst

| Betyr | Ikon |
|---|---|
| dokument, rapport, notat | `file-text`, `file`, `notebook-text` |
| flere dokumenter, vedlegg | `files`, `paperclip`, `folder` |
| kilder, materiale, arkiv | `folder-open`, `archive`, `library` |
| bok, håndbok, oppslagsverk | `book-open`, `book`, `book-bookmark` |
| skrive, utkast, redigere | `pen-line`, `pencil`, `notebook-pen` |
| mal, skjema | `layout-template`, `file-input`, `clipboard` |
| sitat, formulering | `quote`, `text-quote` |
| oversette, språk | `languages` |
| søk, finn, undersøk | `search`, `file-search`, `scan-search` |
| oppsummere, forkorte | `list-collapse`, `text-align-start` |
| struktur, disposisjon, kapitler | `list-tree`, `list`, `layout-list` |
| tabell, oversikt | `table`, `table-properties` |
| lagre, ta vare på | `save`, `hard-drive` |
| kopiere, gjenbruke | `copy`, `clipboard-copy` |
| lenke, henvisning | `link`, `external-link` |
| slette, forkaste | `trash`, `file-x` |
| vedtak, protokoll, referat | `file-check`, `scroll`, `stamp` |

### Mennesker og samarbeid

| Betyr | Ikon |
|---|---|
| person, deltaker, kandidat | `user`, `user-round` |
| gruppe, team, målgruppe | `users`, `users-round` |
| leder, ansvarlig | `user-check`, `crown` |
| rolle, tilgang | `user-cog`, `id-card`, `key-round` |
| møte, samtale | `messages-square`, `message-circle`, `presentation` |
| spørsmål, avklaring | `message-circle-question-mark`, `circle-question-mark` |
| tilbakemelding, vurdering fra andre | `message-square-text`, `thumbs-up` |
| avtale, enighet | `handshake` |
| kunde, bruker, publikum | `contact`, `users`, `megaphone` |
| opplæring, kurs, læring | `graduation-cap`, `school`, `book-open` |
| presentere, foredra | `presentation`, `projector`, `mic` |
| lytte, høre | `ear`, `headphones` |
| tale, diktere, opptak | `mic`, `audio-lines`, `voicemail` |

### Tid

| Betyr | Ikon |
|---|---|
| tid, tidsbruk, varighet | `clock`, `timer`, `hourglass` |
| frist, dato | `calendar`, `calendar-clock`, `alarm-clock` |
| historikk, tidligere | `clock-arrow-left` |
| venter, pause | `pause`, `hourglass` |
| raskt, effektivt | `zap`, `gauge` |

### Vurdering, kvalitet og risiko

| Betyr | Ikon |
|---|---|
| kvalitetssikre, kontrollere | `shield-check`, `clipboard-check`, `badge-check` |
| vurdere, veie, avgjøre | `scale`, `gavel` |
| risiko, advarsel | `triangle-alert`, `shield-alert`, `siren` |
| feil, avvik | `circle-x`, `bug`, `octagon-alert` |
| viktig, merk | `circle-alert`, `info`, `bookmark` |
| personvern, taushet, sikring | `lock`, `shield`, `eye-off` |
| åpent, synlig, innsyn | `eye`, `lock-open` |
| måle, tall, statistikk | `chart-bar`, `chart-pie`, `calculator`, `percent` |
| sammenligne, alternativer | `scale`, `columns-2`, `git-compare` |
| prøve ut, eksperiment | `flask-conical`, `test-tube`, `beaker` |
| regel, lov, krav | `scale`, `gavel`, `book-bookmark` |

### Idé, tenking og KI

| Betyr | Ikon |
|---|---|
| idé, innsikt, forslag | `lightbulb` |
| tenke, resonnere, analysere | `brain`, `brain-circuit` |
| KI, modell, assistent | `bot`, `sparkles`, `brain-circuit` |
| prompt, instruks | `terminal`, `message-square-code`, `text-cursor-input` |
| kontekst, grunnlag, lag | `layers`, `database` |
| samtale, chat | `message-circle`, `messages-square` |
| lerret, arbeidsflate | `layout-dashboard`, `panels-top-left`, `square-pen` |
| prosjekt, samling | `folder-kanban`, `briefcase`, `boxes` |
| dyp, grundig | `telescope`, `microscope`, `binoculars` |
| automatisere, agent | `workflow`, `cog`, `bot` |
| kreativ, utforme | `palette`, `wand-sparkles`, `shapes` |
| kunnskap, fakta | `book-open`, `library`, `brain` |

### Verktøy, teknikk og arbeidsplass

| Betyr | Ikon |
|---|---|
| innstillinger, oppsett | `settings`, `sliders-horizontal`, `cog` |
| verktøy, hjelpemiddel | `wrench`, `hammer`, `pocket-knife` |
| data, database, lager | `database`, `server`, `hard-drive` |
| sky, nett, tjeneste | `cloud`, `globe`, `wifi` |
| datamaskin, skjerm | `monitor`, `laptop`, `smartphone` |
| skjermbilde, bilde, figur | `image`, `camera`, `chart-no-axes-combined` |
| video, opptak | `video`, `film`, `clapperboard` |
| e-post, sende | `mail`, `send`, `inbox` |
| last ned, last opp | `download`, `upload`, `cloud-upload` |
| kode, system | `code`, `braces`, `cpu` |
| integrasjon, kobling | `plug`, `cable`, `network` |
| utskrift, papir | `printer`, `file-output` |
| bygg, kontor, virksomhet | `building-complex`, `building`, `briefcase` |
| anlegg, bygge, arbeid ute | `hard-hat`, `construction`, `truck` |
| helse, omsorg | `heart-pulse`, `stethoscope`, `cross` |
| økonomi, kostnad, budsjett | `coins`, `banknote`, `wallet`, `receipt` |
| miljø, bærekraft | `leaf`, `recycle`, `sprout` |
| reise, transport, logistikk | `plane`, `car`, `ship`, `package` |
| hjem, sted, område | `house`, `map-pin`, `map` |

### Tegn og retning

| Betyr | Ikon |
|---|---|
| ja, riktig | `check`, `circle-check` |
| nei, feil, forbudt | `x`, `circle-x`, `ban` |
| legg til, mer | `plus`, `circle-plus` |
| fjern, mindre | `minus`, `circle-minus` |
| fram, tilbake | `arrow-right`, `arrow-left`, `arrow-left-right` |
| opp, ned | `arrow-up`, `arrow-down`, `arrow-up-down` |
| del, splitt, slå sammen | `split`, `merge`, `git-branch` |
| utvid, forminsk | `maximize-2`, `minimize-2`, `expand` |
| fest, merk, flagg | `pin`, `bookmark`, `flag` |
| stjerne, favoritt, kvalitet | `star`, `sparkle`, `gem` |

## The full list

Every name the platform knows is in [icon-names.txt](icon-names.txt), one per line, in
alphabetical order — the library's own names, in English. When the catalogue has no row for a
meaning, search that file for an English word (`meeting`, `report`, `risk`) and read the names
around it; most names are the object they draw.
