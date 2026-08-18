# Admin Content — Informasjonsarkitektur (fryst)

**Repo:** `jkosmo/a2-assessment-platform`
**Branch:** `epic/admin-content-redesign`
**Dato:** 2026-04-17 (oppdatert 2026-04-18)
**Status:** Fryst — normativt grunnlag for #321–#327, implementert og live på epic-branch

---

## 1. Overordnet IA-modell

Admin-content er organisert som **fire tydelig adskilte workspaces**, med modulbiblioteket som primær inngang.

```
/admin-content                          ← Module library (primær inngang)
/admin-content/module/:moduleId/conversation  ← Module workspace (tre faner)
/admin-content/module/:moduleId/advanced      ← 301 → …/conversation (siden slettet i #896 S3c)
/admin-content/courses                  ← Courses workspace
/admin-content/courses/new              ← Opprett kurs
/admin-content/courses/:courseId        ← Rediger kurs
/admin-content/calibration              ← Calibration workspace (rolle-beskyttet)
```

---

## 2. Workspace-definisjoner

### Module library (`/admin-content`)
Primær inngang for admin-content. Viser alle moduler i en tabell med filter og søk.

**Ansvar:**
- Discovery og oversikt over moduler
- Opprett ny modul
- Åpne modul i arbeidsflaten
- Arkiver / gjenopprett modul
- Dupliser modul
- Vise antall kurs modulen brukes i

**Archive er ikke en egen workspace** — det er et filter og en radhandling i biblioteket.

---

### Module workspace
En delt workspace. Valgt modul er alltid eksplisitt.

**#896 S1:** conversation-ruten har ikke lenger en Samtale/Avansert-modusbryter. Den viser
tre faner på samme modul — **Forhåndsvisning** (deltakerens lesevisning, uten
vurdererforventning, fasit eller skjulte kriterier), **Rediger** (standard: samtale +
innholdsfelt) og **Innstillinger**.

**#896 S3c (v2.19.0): Avansert-modusen finnes ikke lenger.** Denne seksjonen beskrev to moduser
med hver sin styrke — samtale for generering, Avansert for presisjon. Det var to hjem for samme
oppførsel, som gled fra hverandre og måtte rettes to steder. Presisjonsarbeidet ligger nå i
**Innstillinger** (kriterier, vurderingsinstruks, innsendingsskjema, poengregler, gyldighet,
modultype) og **Rediger** (innholdsfeltene). Ruten `/advanced` er en 301 hit.

**Modulflaten (`/admin-content/module/:moduleId/conversation`):**
- Tre faner på én modul, én arbeidsflate
- Samtalen genererer og reviderer; feltene redigeres direkte
- Siden v2.19.1: samtalen **foreslår** når feltene har ulagrede endringer — den overskriver aldri
- Fast handlingslinje (v2.19.0) i stedet for handlinger parkert i samtaleloggen
- State rail, modulheader, publish/unpublish/lagre utkast

---

### Courses workspace (`/admin-content/courses`)
Eget workspace for sammensetting og vedlikehold av kurs.

**Ansvar:**
- Liste over kurs
- Opprett / rediger kurs
- Sett moduler i kurs med rekkefølge

**Courses er ikke en fane i modulflaten** — det er en selvstendig workspace. (Den var en tab i Avansert; den siden er slettet i S3c.)

---

### Calibration workspace (`/admin-content/calibration`)
Ekspert-workspace for kalibrering av moduler. Rolle-beskyttet.

**Ansvar:**
- Terskelverdiredigering per modul
- Filtrer og inspiser kalibreringssignaler
- Deep-link inn fra modulworkspace

**Calibration er ikke en fane i modulflaten** — det er en selvstendig workspace med rollekrav. (Den var en tab i Avansert; den siden er slettet i S3c.)

---

## 3. Top-level navigasjon (fryst)

Alle admin-content workspaces viser den samme sekundære navigasjonen:

| Label | Route | Aktiv for |
|-------|-------|-----------|
| `Moduler` | `/admin-content` | Module library + module workspace |
| `Kurs` | `/admin-content/courses` | Courses workspace |
| `Kalibrering` | `/admin-content/calibration` | Calibration workspace |

**Regler:**
- `Kalibrering` vises kun for brukere med riktig rolle
- Direktelenke til `/admin-content/calibration` uten rolle → access denied state (ikke redirect)
- Navet er konsistent på tvers av alle workspaces

---

## 4. State rail (fryst)

Modulworkspace viser en horisontal full-width state rail **under global top bar, over mode-specific content**.

Seks felt (QA r7 #1: «Modul» og «Språk» er senere fjernet som overflødige — de står i modulkortet og i språkvelgeren):

| Felt | Verdier |
|------|---------|
| **Modul** | Modulnavn |
| **Du redigerer** | `Arbeidsutkast` / `Lagret utkast vN` / `Publisert vN` |
| **Live nå** | `Publisert vN` / `Ikke publisert` |
| **Endringer** | `Ulagrede endringer` / `Alt lagret` |
| **Preview viser** | `Arbeidsutkast` / `Publisert versjon` |
| **Språk** | `UI: <locale> · Preview: <locale>` |

`Live nå` viser **aldri** timestamp eller versjonskjede — kun en av de to verdiene over.

---

## 5. Objektmodell

| Objekt | Type | Hjem |
|--------|------|------|
| Module | Innholdsobjekt | Module library + Module workspace |
| Archive | Status på modul | Filter + radhandling i library |
| Course | Innholdsobjekt (samling av moduler) | Courses workspace |
| Calibration | Ekspertverktøy | Calibration workspace |

**Archive er ikke et top-level objekt.** Det er en tilstand en modul kan ha.

---

## 6. Lifecycle action placement (fryst)

| Handling | Eies av |
|----------|---------|
| Åpne modul | Module library |
| Dupliser | Module library |
| Arkiver / Gjenopprett | Module library |
| Lagre utkast | Module workspace |
| Publiser | Module workspace |
| Avpubliser | Module workspace |
| Slett | Module workspace, sekundær meny (blokkert hvis i kurs) |
| Import / Export | Module workspace, sekundær meny |

### Publiseringsgaten (#896 S4)

Publisering er øyeblikket innhold når deltakeren, og dermed stedet en halvoversatt modul må
stoppes. Gaten blokkerer dersom et deltakersynlig felt mangler ett av `en-GB` / `nb` / `nn`.
Feltene — hvert enkelt bare når det finnes, siden et fraværende valgfritt felt ikke er uoversatt:

| Felt | Hvorfor |
|------|---------|
| `title` | Vises i modullista og arbeidsrommet |
| `description` | Vises for deltakeren i modullista — innhold, ikke oppsett |
| `taskText` | Scenarioet deltakeren svarer på (mangler for `MCQ_ONLY`) |
| `assessorExpectedContent` | Brukes i vurderingen og i tilbakemeldingen |
| `candidateTaskConstraints` | Vises for deltakeren sammen med oppgaven |
| `mcq.question<N>` | Spørsmålstekst, alternativer, fasit og begrunnelse. For `MCQ_ONLY` *er* spørsmålene vurderingen. Rapporteres per spørsmål, ikke per felt — én handlingsbar linje i stedet for åtte |

- **Blokkerende, ikke advarsel.** En advarsel ved publisering er en advarsel ingen leser.
- **Meldingen navngir felt × språk**, og handlingen «Oversett det som mangler» fyller kun hullene:
  språk som allerede har tekst beholder forfatterens egne ord. Deretter lagres det som en vanlig
  ny versjon, og publiseringen prøves på nytt.
- **Gaten gjelder alle veier inn til publisering** — forfatterens knapp, kurskaskaden og
  auto-publisering ved import. Kalibreringens terskelpublisering er unntatt (den republiserer en
  allerede live versjon uten ny tekst). Se `doc/FEATURE_SURFACE_MAP.md` § 18.
- Gaten forutsetter #905: før den ble en feilet oversettelse lagret som tre kopier av kildeteksten
  og var ikke til å skille fra en ekte oversettelse.

#### Gaten gjelder også seksjoner (#916)

Vedtatt 2026-08-18. En læringsseksjon er lesestoff deltakeren møter direkte — det finnes ingen
vurdering rundt den og ingen annen flate som gjentar innholdet — så et språkhull har nøyaktig
samme konsekvens som i en modul. Samme regel, samme feltdata (`field` + `missingLocales`), samme
blokkerende oppførsel.

| Felt | Hvorfor |
|------|---------|
| `title` | Vises i kursforløpet, i lesevisningen og i seksjonslista |
| `bodyMarkdown` | Seksjonen **er** innholdet sitt |

Det er hele den deltakersynlige flaten. Lokaliserte SVG-varianter (#657) er bevisst utenfor: de
genereres fra teksten, de har en dokumentert tilbakefallsvei (en uoversatt tegning vises på
kildespråket i stedet for ikke i det hele tatt), og en seksjon med figurer skal ikke måles
strengere enn en uten.

**Én mekanisk forskjell fra modulen, med én konsekvens.** En modul skiller lagring fra
publisering; en seksjon gjør ikke det — lagring *er* publisering (siste-versjon-vinner). Å avvise
lagringen ville betydd at en forfatter som skriver på norsk ikke får lagre i det hele tatt, altså
å bytte en språkfeil mot tapt arbeid. Derfor: **den eksplisitte Publiser-handlingen og
kurskaskaden blokkerer (422), mens lagring holdes tilbake** — versjonen lagres, men aktiveres
ikke, og svaret sier hvilke felt × språk som mangler. Det er samme løsning som modulens
import-dør bruker på samme konflikt. Se `doc/FEATURE_SURFACE_MAP.md` § 23.

~~**Kjent begrensning — Avansert-siden.**~~ Publiserte du derfra, blokkerte gaten på samme måte,
men «Oversett det som mangler» fantes ikke der — den bodde i samtaleflaten. Begrunnelsen den gang
var at Avansert skulle bort i S3c, og at å bygge utbedringsflyten to steder ville være arbeid som
kastes. **Det holdt: siden er slettet (v2.19.0), og begrensningen med den.** Det finnes én vei til
publisering nå, og den har handlingen.

---

## 7. Implementerte ruter

#322 er landet. Alle module workspace-ruter er aktive:

| Destinasjon | Rute |
|-------------|------|
| Åpne i Samtale | `/admin-content/module/:moduleId/conversation` |
| ~~Åpne i Avansert~~ | 301 → `…/conversation` (siden slettet, S3c) |

Bakoverkompatible overgangsruter (`/admin-content?moduleId=` og `/admin-content/advanced?moduleId=`) støttes fortsatt i overgangsfasen men er ikke lenger primær navigasjon.

---

## 8. Kildegrunnlag

- `issue1_body.md` — `issue8_body.md`: Spesifikasjoner for child issues #321–#327 og epic #328
- `doc/design/UX_PRODUCT_ASSESSMENT_ADMIN_CONTENT_REDESIGN_2026-04-17.md`: UX-vurdering
- `doc/design/CONVERSATIONAL_ADMIN_CONTENT_DESIGN.md`: Eksisterende designbeslutninger
