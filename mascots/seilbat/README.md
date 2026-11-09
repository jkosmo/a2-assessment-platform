# Maskotpakken «seilbat»

Alt som hører til maskoten ligger i denne mappa: bildene, tekstene, bildetekstene i e-post, figuren på fremdriftslinja i
«Mine kurs» og faviconet. Seilbåten er pakken plattformen bruker. Vil en organisasjon ha sin egen metafor, lager den en
ny pakke ved siden av denne (se nederst). Planen står i `doc/design/MASKOTPAKKE.md`.

**Ikke i pakken**, felles for alle pakker: regelen for hvilket humør brukeren har (`src/modules/gamification/boatMood.ts`),
grensen på 30 % mellom figurens to tilstander, tallene på Profil, og at e-post bruker innebygde bilder.

## Filene

```
mascots/<navn>/
  mascot.json       beskriver pakken (nøklene under)
  images/*.jpg      bildene til humørene og e-postene
  figure/*.svg      figuren på fremdriftslinja, én fil per tilstand
  figure.css        figurens stil og feiringens animasjon
  favicon.svg       faviconet, og de tre PNG-ene ved siden av
  README.md         denne fila
```

Mappenavnet er pakkens navn. Det står i bildeadressene (`/static/mascot/<navn>/...`), så det må være små bokstaver,
tall og bindestrek. Alle filer pakken viser til, må ligge inne i mappa.

## Nøklene i `mascot.json`

Alle tekster finnes på tre språk: `nb`, `nn` og `en-GB`. Ingen kan være tom.

| Nøkkel | Hva |
|---|---|
| `version` | Versjonen av formatet. Må være den koden leser (nå `2`). Når koden krever en ny nøkkel, økes versjonen, og sjekken sier hva som mangler. |
| `name` | Pakkens navn, vist i forhåndsvisningen. |
| `moods.<humør>.image` | Bildet på Profil for humøret: et filnavn i `images/`. |
| `moods.<humør>.line` | Linja ved siden av bildet. |
| `emails.<situasjon>.image` | Bildet øverst i e-posten: et filnavn i `images/`. Flere situasjoner og humør kan dele bilde. |
| `emails.<situasjon>.alt` | Bildeteksten (alt-teksten) i e-posten. |
| `emailTexts.courseNewVersionIntro` | Setningen i e-posten om en ny hovedversjon av et kurs. `{course}` blir kursets tittel, `{major}` versjonen. |
| `emailTexts.courseAssignedIntro` | Begynnelsen av innledningen i e-posten om nye kurs. Resten følger etter et mellomrom, med liten forbokstav: «du har fått 3 nye kurs på A-2 læringsplattform.» Teksten bør derfor slutte med kolon, som «Fortøyningen er sluppet:». Kom i versjon 2. |
| `figure.direction` | Hvilken side linja fylles fra. Bare `fromRight` er bygget. |
| `figure.states.<tilstand>` | SVG-fila for tilstanden, for eksempel `figure/flatt.svg`. |
| `figure.css` | Stilfila for figuren. |
| `figure.widthPx` | Figurens bredde på linja, i piksler. |
| `figure.sternPx` | Fra figurens venstrekant til punktet som står på grensa mellom tomt og fylt. |
| `figure.stripeReachPx.flatt`, `.fullt` | Hvor langt til høyre fartsstripene rekker, så de ikke klippes ved linjas kant. |
| `figure.celebrationMs` | Hvor lenge feiringen varer. Må være lik varigheten til animasjonen i `figure.css`. |
| `favicon.svg`, `.png32`, `.png16`, `.appleTouchIcon` | Faviconet: SVG, PNG 32 × 32, PNG 16 × 16 og ikonet for hjemskjerm (180 × 180). |

**Humørene** (`moods`): `ny` (aldri gjort noe), `mett` (aktiv denne uka), `sulten` (forrige uke), `sur` (to uker siden),
`dramatisk` (tre uker eller mer).

**E-postsituasjonene** (`emails`): `courseNewVersion` (kurset har fått ny hovedversjon), `courseAssigned` (kurs
tildelt), `dueSoon` (fristen nærmer seg), `overdue` (fristen er passert), `passed` (bestått), `notPassed` (ikke
bestått), `underReview` (til sensor), `appeal` (anke) og `discussion` (diskusjon).

**Figurens tilstander** (`figure.states`): `flatt` (under 30 % av kurset), `fullt` (30 % eller mer) og `feiring` (når
kurset fullføres).

Sjekken avviser nøkler koden ikke kjenner, så en skrivefeil i et navn blir oppdaget.

## Kravene

**Bildene** (`images/`):
- JPEG, nøyaktig 600 × 200 piksler, under 30 kB. E-posten tegner dem i den størrelsen, og e-posten skal være lett.
- Bildeteksten sier hva bildet viser, kort.

**Tekstene**: ingen adresser. En tekst med `http:`, `https:` eller `www.` ville stoppet e-posten (samme regel som
e-postene selv har), så sjekken avviser den.

**Figuren** (`figure/*.svg`):
- SVG-en settes rett inn i siden, så den kan ikke ha `<script>`, `on…`-attributter (som `onload`), `<foreignObject>`
  eller referanser til noe utenfor fila. `href="#id"` og `url(#id)` til noe i samme fil går fint.
- Gi delene egne klasser og fargelegg dem i `figure.css`, med portalens fargevariabler (`var(--color-primary)` og de
  andre i `public/static/shared.css`), så figuren følger portalens farger. Seilbåten gir rotelementet klassen
  `course-boat-svg`, som `figure.css` gjør til en blokk.
- Tegn figuren 60 × 34 som seilbåten, eller juster målene i `figure`.

**`figure.css`**:
- Henter ingenting utenfra (ingen `url(...)` til andre filer, ingen `@import`).
- Feiringen er en animasjon på klassen `.course-boat--leaving`, og den skal vare `figure.celebrationMs`. Koden fjerner
  figuren etter så lang tid, også om animasjonen ikke sier fra at den er ferdig.
- Ta med en regel for `prefers-reduced-motion: reduce` som slår av animasjonen.

## Lage en ny pakke

1. Kopier mappa: `mascots/seilbat/` til `mascots/<navn>/`.
2. Bytt bildene, tekstene, figuren og faviconet. Endre `mascot.json` så den viser til de nye filene.
3. Kjør sjekken. Den lister alt som er galt i alle pakker på én gang:
   ```
   npm run mascot:check
   ```
4. Se resultatet. Forhåndsvisningen tegner alle e-poster (ni situasjoner × tre språk), alle humør og alle figurens
   tilstander til én HTML-fil (`dist/mascot-preview-<navn>.html`), som du åpner i en nettleser:
   ```
   npm run mascot:preview -- <navn>
   ```
5. Velg pakken i `mascot.config.json` i roten av repoet: `{ "mascot": "<navn>" }`. Valget følger med i utrullingen, så
   app og worker alltid bruker samme pakke. Både web og worker sjekker pakken når de starter, og stopper med en melding
   om noe er galt.

En e-post som allerede er sendt, endres ikke av et bytte. E-poster som venter i køen, lages når de sendes, med pakken
som gjelder da.
