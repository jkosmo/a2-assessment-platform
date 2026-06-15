# Design: Læringsseksjoner — IA + wireframes (#476 / D1 #484)

Godkjent 2026-06-15. Styrer UI-byggingen av U1 (#488), U3 (#490), P1 (#491).
Ingen ny topp-navigasjon — flatene henger på eksisterende sider og mønstre
(`shared.css`-tokens, `content-area-nav`-faner, 720px innholdskolonne).

## Informasjonsarkitektur

- **Authoring — Seksjoner:** ny fane «Seksjoner» i `content-area-nav` ved siden av
  Moduler/Kurs. Seksjoner er et **bibliotek** (frittstående, gjenbrukbare på tvers av
  kurs) — speiler hvordan moduler fungerer.
- **Authoring — Kursbygger:** dagens kurs-detalj-side; modul-lista blir en blandet
  element-liste (moduler + seksjoner). «Legg til seksjon» = **velg fra bibliotek** (a).
- **Delivery — Deltaker:** ny lese-side i kursflyten, mellom modul-sidene.

## Besluttede valg

1. **Editor = laptop** (side-ved-side markdown + forhåndsvisning). **Deltaker (P1) =
   mobil-først responsiv** — studenter kan være på mobil.
2. **Editor:** eksplisitt språk-veksling (nb/nn/en-GB), forfatter sjekker/redigerer hvert
   språk manuelt (jf. lærer-styrt locale). **Deltaker:** ingen inline språkvelger; rendrer
   språket fra studentens profil.
3. **«Legg til seksjon» = velg fra bibliotek** (gjenbruk på tvers av kurs; B1/B2 støtter det).

## Wireframes

### U1 — Seksjons-editor (`/admin-content/sections`, laptop)
```
Moduler │ Kurs │ [Seksjoner]                      content-area-nav
Seksjoner                              [+ Ny seksjon]
┌─ tabell (maxW 720) ────────────────────────────┐
│ Tittel            │ Versjon │ Sist endret │ ✎ 🗑 │
└─────────────────────────────────────────────────┘

— Editor —
[← Tilbake]  Tittel: [____]   språk: (nb)(nn)(en-GB)
┌── Markdown (~350px) ──┐ ┌── Forhåndsvisning (~350px) ─┐
│ # Overskrift          │ │ Overskrift                  │
│ **fet**, {{asset:x}}  │ │ fet, [bilde]                │
└───────────────────────┘ └─────────────────────────────┘
[Lagre ny versjon]   (preview = samme F3-sanitiseringspolicy)
```

### U3 — Kursbygger med blandede elementer (kurs-detalj-side)
```
Kurs: «HMS-grunnkurs»                         [Publiser]
Elementer (dra for rekkefølge):               maxW 720
┌─────────────────────────────────────────────────┐
│ ⠿ 1  [MODUL]    Brannvern              ✎         │
│ ⠿ 2  [SEKSJON]  Intro til HMS          ✎         │
│ ⠿ 3  [MODUL]    Førstehjelp            ✎         │
└─────────────────────────────────────────────────┘
[+ Legg til modul]   [+ Legg til seksjon ▾ (bibliotek)]
   → lagrer via PUT /courses/:id/items (B2)
```

### P1 — Deltaker-visning (mobil-først, i kursflyten)
```
HMS-grunnkurs · steg 2 av 3                    full bredde mobil
┌─────────────────────────────────────────────────┐
│ Intro til HMS                                     │ sanitisert HTML (F3/X1)
│ (rendret markdown: tekst, bilder, evt. video)     │ skalerbar tekst,
│ ...                                               │ alt-tekst på bilder
└─────────────────────────────────────────────────┘
[← Forrige]                         [Marker lest →]
   (Marker lest = P2 senere; nå bare navigasjon)
```

## API-kobling (allerede bygget)

- U1: `POST/GET/PATCH/PUT/DELETE /api/admin/content/sections` (B1 #485)
- U3: `GET/PUT /api/admin/content/courses/:id/items` (B2 #486)
- P1: leser kursets items + aktiv seksjonsversjons `bodyMarkdown`, rendrer via
  `renderSectionMarkdown` (F3 #482 / X1 #493) med studentens profil-locale.
