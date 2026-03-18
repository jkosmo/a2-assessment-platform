# Design: Dialogboksbasert feltredigering i Admin Content

**Issue:** #135
**Status:** Design vedtatt – klar for implementering
**Dato:** 2026-03-18

---

## Problemstilling

Admin Content har i dag ett langt skjema der alle modulfelter redigeres inline i ett sekvensiell skjema. Dette skaper tre konkrete problemer:

1. **Kognitiv overbelastning.** Innholdseiere (Subject Matter Owners) ser alle felter samtidig, inkludert tekniske JSON-felter de sjelden berører.
2. **Rå JSON eksponert direkte.** Syv felter vises som rå JSON (`rubricCriteriaJson`, `rubricScalingRuleJson`, `rubricPassRuleJson`, `promptExamplesJson`, `mcqQuestionsJson`, `moduleVersionSubmissionSchema`, `moduleVersionAssessmentPolicy`). Dette er uegnet for faglige innholdseiere.
3. **Ingen tydelig feltvalidering.** Å lagre ett felt krever at hele formen er gyldig.

---

## Mål

- Erstatte inline-redigering med dedikerte dialogbokser per innholdskort
- Gi strukturerte editorer for JSON-felter (ingen rå JSON for SMO-brukere)
- Støtte lokalisering per felt (EN / NB / NN) via faner i dialogen
- Oppfylle WCAG 2.1 AA: focus trap, `aria-labelledby`, Escape-lukking, fokus tilbake til trigger
- Bevare append-only versjonssemantikk (ingen PATCH-endepunkter kreves)

---

## Hva som ikke endres

- Append-only versjoneringsarkitektur: hvert lagret utkast skaper en ny versjon
- Publiseringsflyt: innholdseier publiserer eksplisitt
- Backend-datamodell og eksisterende API-endepunkter
- Rolleautentisering (SUBJECT_MATTER_OWNER)

---

## Arkitekturvalg: Immutable versioning beholdes

### Åpent spørsmål

Dialogboksdesignet antar enten:
- **A) Mutable draft-felt** i UI-state som ikke lagres til backend før brukeren trykker "Lagre utkast" eksplisitt, eller
- **B) Per-felt lagring** via nye PATCH-endepunkter

### Vedtatt: Alternativ A – UI-state buffering mot eksisterende POST-flyt

Begrunnelse:
- Ingen nye API-endepunkter påkrevd
- Bevarer append-only semantikk uten unntak
- Bruker bekrefter med én "Lagre alle endringer"-handling
- Lar innholdseier redigere flere felt i sekvens og lagre dem samlet

Kompromiss: Endringer i én dialogboks går tapt dersom siden lastes på nytt uten å lagre. Dette løses med en tydelig "Ulagrede endringer"-indikator i UI.

---

## Innholdskort-modell

Admin Content-siden organiseres i **7 innholdskort**. Hvert kort viser gjeldende verdi og en «Rediger»-knapp som åpner en dedikert dialog.

| # | Kortnavnn | Felter som redigeres | JSON-felter |
|---|-----------|---------------------|-------------|
| 1 | Moduldetaljer | tittel, beskrivelse, sertifiseringsnivå, gyldighetsperiode | Nei |
| 2 | Innleveringsskjema | submissionSchema (strukturert) | Ja – strukturert editor |
| 3 | Rubrikk | criteria, scalingRule, passRule | Ja – strukturert editor |
| 4 | Vurderingsregler | assessmentPolicy | Ja – strukturert editor |
| 5 | Prompt | systemPrompt, userPromptTemplate, examples | Delvis – examples er JSON |
| 6 | Flervalgsspørsmål | mcqQuestions | Ja – strukturert editor |
| 7 | Versjonsdetaljer | taskText, guidanceText | Nei |

---

## Interaksjonsdesign per dialogboks

### Åpningsmekanisme
- Hvert innholdskort har en «Rediger»-knapp (sekundær stil)
- Klikk åpner `<dialog>` via `showModal()` – gir innebygd focus trap og Escape-lukking

### Dialogstruktur
```
┌─────────────────────────────────────────┐
│  [Rediger: Moduldetaljer]        [✕]   │
│  ─────────────────────────────────────  │
│  [EN-GB] [NB] [NN]  ← lokaliseringsfaner│
│                                         │
│  Tittel *                               │
│  [________________________]             │
│                                         │
│  Beskrivelse                            │
│  [________________________]             │
│  [________________________]             │
│                                         │
│  ─────────────────────────────────────  │
│            [Avbryt]   [Oppdater utkast] │
└─────────────────────────────────────────┘
```

### Fokushåndtering
- Fokus flyttes til første interaktivt element i dialogen ved åpning
- Escape lukker dialogen uten å lagre
- «Avbryt» lukker dialogen uten å lagre
- «Oppdater utkast» oppdaterer UI-state og lukker dialogen
- Fokus returnerer til «Rediger»-knappen som åpnet dialogen

### Lokaliseringslogikk
- Lokaliserte felter vises med faner: EN-GB | NB | NN
- Alle tre lokalversjoner lagres samlet ved «Oppdater utkast»
- Aktiv lokalfane huskes gjennom dialogøkten

---

## Strukturerte editorer for JSON-felter

JSON-felter skal aldri vises som rå JSON til SMO-brukere. Hver felttype får en dedikert editor:

### Rubrikk-kriterier (`rubricCriteriaJson`)
- Liste av kriterie-rader med: navn (lokalisert), maks poeng, beskrivelse
- «Legg til kriterium» og slett-knapp per rad
- Validering: hvert kriterium må ha navn og positiv maks-verdi

### Skaleringstregel (`rubricScalingRuleJson`) og Beståttregel (`rubricPassRuleJson`)
- Nøkkel-verdi-tabell med validerte tallfelter
- Tydelige etiketter som forklarer hva hvert felt kontrollerer

### Vurderingspolicy (`moduleVersionAssessmentPolicy`)
- Strukturert skjema med terskelverdier (totalMin, mcqMinPercent, practicalMinPercent osv.)
- Kobles til kalibreringslogikk

### Innleveringsskjema (`moduleVersionSubmissionSchema`)
- Feltliste: felttype, etikett (lokalisert), påkrevd/valgfri
- Drag-and-drop-rekkefølge er nice-to-have, ikke MVP

### MCQ-spørsmål (`mcqQuestionsJson`)
- Listebasert editor: spørsmålstekst (lokalisert), svaralternativer (lokalisert), korrekt svar
- Validering: minst to alternativer, nøyaktig ett riktig svar

### Prompt-eksempler (`promptExamplesJson`)
- Nøkkel-verdi-par: eksempel input / forventet output
- Frivillig felt

---

## WCAG 2.1 AA-krav

| Krav | Implementering |
|------|----------------|
| Focus trap | `showModal()` gir innebygd focus containment |
| Escape-lukking | Innebygd i `<dialog>` + eksplisitt Escape-lytter |
| `aria-labelledby` | `<dialog aria-labelledby="dialog-title-id">` |
| Fokus tilbake til trigger | Referanse til triggerelement lagres ved åpning |
| Tastaturnavigasjon | Tab/Shift+Tab innen dialogen, Enter for submit |
| Fargkontrast | Arver fra `shared.css` – allerede AA-godkjent |
| Skip-link | Eksisterende skip-nav i `admin-content.html` beholdes |
| Skjermleser-status | `aria-live="polite"` for lagrestatus og valideringsfeil |

---

## Kortvisning (read-only sammendrag)

Når dialogen er lukket, viser hvert innholdskort:
- Feltnavnet som overskrift
- En forkortet visning av gjeldende verdi (maks 2 linjer)
- Versjonsbadge dersom versjonsdata er tilgjengelig (f.eks. «Rubrikk v3»)
- En «Rediger»-knapp

Felter med ulagrede endringer får en gul «Ulagret»-badge på kortet.

---

## Dataflyt

```
Innholdseier åpner dialog
    ↓
Dialog laster gjeldende verdi fra UI-state
    ↓
Bruker redigerer
    ↓
«Oppdater utkast» → oppdaterer UI-state (ikke backend)
    ↓
Kort viser oppdatert verdi + «Ulagret»-badge
    ↓
Bruker klikker «Lagre alle endringer»
    ↓
Eksisterende POST-flyt (ny versjon opprettes i backend)
    ↓
«Ulagret»-badge forsvinner
```

---

## Sub-issues (se #135)

| Sub-issue | Innhold |
|-----------|---------|
| #135-A | Dialog: Moduldetaljer (tittel, beskrivelse, sertifiseringsnivå) |
| #135-B | Dialog: Innleveringsskjema (strukturert editor) |
| #135-C | Dialog: Rubrikk (kriterier, skalering, beståttregel) |
| #135-D | Dialog: Vurderingsregler / assessmentPolicy |
| #135-E | Dialog: Prompt (systemPrompt, userPromptTemplate, eksempler) |
| #135-F | Dialog: Flervalgsspørsmål (MCQ-editor) |
| #135-G | Dialog: Versjonsdetaljer (taskText, guidanceText) |
| #135-H | Infrastruktur: dialog-komponent, fokushåndtering, fane-logikk |
| #135-I | Kortvisning: read-only sammendrag med versjonsbadge og «Ulagret»-indikator |

---

## Prioritert rekkefølge

**MVP (leveranse 1):**
1. #135-H – Infrastruktur og dialog-rammeverk
2. #135-A – Moduldetaljer (enklest felt, ingen JSON)
3. #135-I – Kortvisning med Ulagret-indikator

**Leveranse 2:**
4. #135-G – Versjonsdetaljer (taskText, guidanceText) – også uten JSON
5. #135-F – MCQ-editor
6. #135-C – Rubrikk-editor

**Leveranse 3:**
7. #135-B – Innleveringsskjema
8. #135-D – Vurderingsregler
9. #135-E – Prompt-editor

---

## Åpne spørsmål

1. **Autosave til sessionStorage?** Dersom bruker utilsiktet laster siden på nytt, kan ulagrede dialog-endringer gjenopprettes fra sessionStorage. Anbefalt for leveranse 2.
2. **Rubrikk-editor dybde:** Skal criteria-editoren støtte nesting (sub-kriterier) i MVP, eller kun flat liste?
3. **Versjonsvisning i kort:** Skal kortvisningen vise versjonsnummer for gjeldende lagret utkast (f.eks. «Rubrikk v4 (utkast)») eller kun publisert versjon?
4. **Mobilvisning:** Dialoger på smal skjerm – full-screen overlay eller bottom sheet?

---

## Sammenheng med eksisterende design

Dette designet bygger på [PHASE2_ADMIN_CONTENT_WORKSPACE_V2_DESIGN.md](PHASE2_ADMIN_CONTENT_WORKSPACE_V2_DESIGN.md):
- Append-only versjonssemantikk bevares (ikke-mål i V2-designet)
- Versjonsbadge-mønster (`vN`) gjenbrukes fra V2
- LLM-assistert import fra #95 beholdes som inngangsport parallelt med dialogredigering

---

## Referanser

- GitHub issue #135: EPIC: Dialogboksbasert feltredigering i Admin Content
- [PHASE2_ADMIN_CONTENT_WORKSPACE_V2_DESIGN.md](PHASE2_ADMIN_CONTENT_WORKSPACE_V2_DESIGN.md)
- [ASSESSMENT_DECISION_POLICY.md](ASSESSMENT_DECISION_POLICY.md)
- MDN: `<dialog>` og `showModal()` – https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog
- WCAG 2.1 SC 2.1.2 No Keyboard Trap
