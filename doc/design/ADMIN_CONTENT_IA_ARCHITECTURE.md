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
/admin-content/module/:moduleId/conversation  ← Module workspace, Conversation-modus
/admin-content/module/:moduleId/advanced      ← Module workspace, Advanced-modus
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
- Åpne modul i Conversation eller Advanced
- Arkiver / gjenopprett modul
- Dupliser modul
- Vise antall kurs modulen brukes i

**Archive er ikke en egen workspace** — det er et filter og en radhandling i biblioteket.

---

### Module workspace — Conversation og Advanced
En delt workspace med to moduser. Valgt modul er alltid eksplisitt.

**Conversation (`/admin-content/module/:moduleId/conversation`):**
- Chat-drevet authoring
- Primær for generering, høy-nivå revisjoner, oversettelse

**Advanced (`/admin-content/module/:moduleId/advanced`):**
- Strukturert feltredigering
- Primær for presisjon, inspeksjon, rubric, MCQ-detaljredigering

**Delt i begge moduser:**
- State rail med seks felt (se nedenfor)
- Modulheader med navn og modusskifte
- Publish, unpublish, lagre utkast

---

### Courses workspace (`/admin-content/courses`)
Eget workspace for sammensetting og vedlikehold av kurs.

**Ansvar:**
- Liste over kurs
- Opprett / rediger kurs
- Sett moduler i kurs med rekkefølge

**Courses er ikke en tab i advanced** — det er en selvstendig workspace.

---

### Calibration workspace (`/admin-content/calibration`)
Ekspert-workspace for kalibrering av moduler. Rolle-beskyttet.

**Ansvar:**
- Terskelverdiredigering per modul
- Filtrer og inspiser kalibreringssignaler
- Deep-link inn fra modulworkspace

**Calibration er ikke en tab i advanced** — det er en selvstendig workspace med rollekrav.

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

Seks felt — identisk i Conversation og Advanced:

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
| Åpne i Samtale | Module library |
| Åpne i Avansert | Module library |
| Dupliser | Module library |
| Arkiver / Gjenopprett | Module library |
| Lagre utkast | Module workspace (begge moduser) |
| Publiser | Module workspace (begge moduser) |
| Avpubliser | Module workspace (begge moduser) |
| Slett | Module workspace, sekundær meny (blokkert hvis i kurs) |
| Import / Export | Module workspace, sekundær meny |

---

## 7. Implementerte ruter

#322 er landet. Alle module workspace-ruter er aktive:

| Destinasjon | Rute |
|-------------|------|
| Åpne i Samtale | `/admin-content/module/:moduleId/conversation` |
| Åpne i Avansert | `/admin-content/module/:moduleId/advanced` |

Bakoverkompatible overgangsruter (`/admin-content?moduleId=` og `/admin-content/advanced?moduleId=`) støttes fortsatt i overgangsfasen men er ikke lenger primær navigasjon.

---

## 8. Kildegrunnlag

- `issue1_body.md` — `issue8_body.md`: Spesifikasjoner for child issues #321–#327 og epic #328
- `doc/design/UX_PRODUCT_ASSESSMENT_ADMIN_CONTENT_REDESIGN_2026-04-17.md`: UX-vurdering
- `doc/design/CONVERSATIONAL_ADMIN_CONTENT_DESIGN.md`: Eksisterende designbeslutninger
