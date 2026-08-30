# UI-inventar (#1046)

Tellingen, ikke anbefalingen. Skrevet 30.08.2026 etter produkteierens diagnose:

> «Kilden til variasjon er at skjermbilder er utviklet på ulike tidspunkt i prosessen. Endringer vi
> har gjort et sted er ikke tatt andre steder. Dette skaper kompleksitet for bruker.»

⚠️ Diagnosen er etterprøvbar, og den holder. Under er dateringen som viser det.

---

## Flatene, datert

| Flate | Først | Sist rørt | Linjer |
|---|---|---|---|
| `participant.js` | 2026-03-08 | 2026-08-29 | 4285 |
| `review.js` | 2026-03-22 | 2026-08-30 | 1769 |
| `profile.js` | 2026-03-22 | 2026-08-30 | 811 |
| `results.js` | 2026-03-17 | 2026-08-30 | 685 |
| `participant-completed.js` | 2026-03-10 | 2026-08-30 | 525 |
| `admin-platform.js` | 2026-03-22 | 2026-08-30 | 489 |
| `cohort-status.js` | 2026-07-19 | 2026-08-30 | 329 |
| **`certificate.js`** | 2026-06-21 | **2026-06-23** | 150 |
| **`consent-guard.js`** | 2026-03-22 | **2026-03-22** | 241 |

De to nederste er de dypeste lagene: `certificate.js` var urørt i to måneder, `consent-guard.js` i
fem — den er aldri endret siden den ble skrevet.

---

## Delte moduler: hvem bruker hva

| Modul | Sist endret | Brukt av | Mangler hos |
|---|---|---|---|
| `api-client` | — | 8/8 | — |
| `i18n-locale` | 2026-06-22 | 8/8 | — |
| `consent-guard` | — | 7/8 | certificate |
| `workspace-nav` | 2026-08-23 | 7/8 | certificate |
| `localized-resource` | 2026-08-30 | **7/8** | participant |
| `api-error` | 2026-08-29 | 5/8 | admin-platform, cohort-status, certificate |
| `format-display` | 2026-06-22 | 5/8 | admin-platform, cohort-status, certificate |
| `dom-visibility` | 2026-08-23 | 5/8 | results, participant-completed, certificate |
| `loading` | 2026-06-22 | **3/8** | profile, participant-completed, admin-platform, cohort-status, certificate |
| `toast` | 2026-06-24 | **3/8** | results, profile, participant-completed, cohort-status, certificate |
| `decision-reason` | 2026-08-27 | 2/8 | (gjelder bare flater som viser vedtak) |

---

## Det inventaret fant med en gang

⚠️ **`certificate.js` hadde samme språkfeil som #1040, og var ikke med i sveipet for #1042.**

Den henter `/api/courses/completions/{id}`, som serveren lokaliserer ved henting, og språkbyttet
kalte bare `applyTranslations()`. **Kursnavnet på et utskrevet bevis sto på feil språk.**

Den sto ikke i QA-funnet som startet #1027, så den kom aldri med i lista. Dateringen fant den på
første forsøk: dypeste lag, mangler alt.

Rettet samme dag og lagt i kontrakten (#1044), som nå dekker sju flater.

---

## Hva tallene betyr

**`loading` og `toast` er de største sprikene** — 3 av 8, og begge har eksistert siden mars/juni.
Det er ikke fordi noen valgte noe annet; det er fordi flatene ble skrevet før eller uten dem.

**`api-error` er nyeste tenkning** (2026-08-29, etter #983 og #972) og mangler hos tre. To av dem —
`admin-platform` og `cohort-status` — har fortsatt rå servertekst, som skralletesten i
`raw-server-error-guard` teller: 2 hver.

**`certificate.js` bruker to delte moduler av elleve.** Den er ikke feil designet; den er gammel.

---

## Metoden videre: spre, ikke design

Er variasjonen lag i tid, finnes den beste versjonen allerede — den nyeste. Standardisering blir da
å spre den siste avgjørelsen.

1. Finn implementasjonene og **dater dem**
2. Den nyeste er referansen — med mindre det finnes en grunn til at den ikke er det, og da skal
   grunnen skrives ned
3. Spre den: én modul, én kontrakt, etter mønsteret fra #1042/#1044

⚠️ Punkt 2 er ikke en formalitet. I #1027 gjorde den nyeste avgjørelsen («serveren eier språket»)
en eldre og helt riktig løsning (#736) til en no-op. Å datere uten å spørre hvorfor den eldre
finnes, ville skjult at premissen var flyttet.

---

## Foreslått rekkefølge, med begrunnelse

| # | Egenskap | Hvorfor først |
|---|---|---|
| 1 | `api-error` til de tre som mangler | Nyeste tenkning, brukersynlig, og skralletesten måler framgangen alt |
| 2 | `loading` + `toast` | Størst sprik (3/8), og det brukeren merker som «ulike skjermer oppfører seg ulikt» |
| 3 | `certificate.js` løftes helt | Dypeste laget; liten fil, så billig å ta samlet |

⚠️ **Ikke start med et komponentbibliotek.** Inventaret skal avgjøre hva som er verdt å
standardisere. I #1042 var svaret at tre av seks flater manglet egenskapen helt — og det visste
ingen før sveipet. Her ble svaret at én flate manglet nesten alt.
