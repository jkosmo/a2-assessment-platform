# Visuell tolkning av bildetungt kildemateriale (#601) — designanbefaling

> Status: **beslutningsdokument** — venter på retningsvalg fra SMO/eier før implementering.
> Relatert: #479 (kildemateriale-ingest), pilot-funn om ingest som flaskehals.

## Problemet (kort)

`sourceMaterialExtractionService` trekker i dag **kun ut tekst-runs** fra PPTX/PPT/PDF. Bilder,
diagrammer, skjermbilder og innbrent tekst **droppes stille**. En bildetung deck (typisk
strategi-/møte-presentasjon der innholdet *er* diagrammer) gir nesten ingen brukbar tekst →
LLM-pipelinen lager en tynn/feil modul, og **forfatteren får ingen indikasjon på hvorfor**.

## Anbefaling: hybrid, faset — «deteksjon først, vision bak terskel»

Jeg anbefaler **ikke** å velge mellom OCR og vision som et enten/eller, men å fase det slik at den
billige, risikofrie delen som faktisk fjerner den stille feilen leveres først:

### Fase 1 — Deteksjon + forfatter-tilbakemelding (rask gevinst, ingen LLM-kost, ingen personvern-eksponering)
Etter tekst-ekstrahering: beregn et **tekst-tetthetssignal** (f.eks. tegn per slide/side, og/eller
antall innebygde bilder vs. tekstmengde). Under en terskel ⇒ vis en **tydelig melding til
forfatteren**: «Dette kildematerialet ser bildetungt ut — lite tekst ble hentet ut. Modulen kan bli
tynn. [Last opp en tekstrik kilde] eller [kjør visuell tolkning].»

Dette alene løser kjerneklagen i #601 (stille feil → forfatteren skjønner ikke hvorfor). Null
LLM-kost, ingen nye avhengigheter, kan leveres som en liten egen skive.

### Fase 2 — Visuell ekstrahering bak terskel (kvalitet)
Når tekst-utbyttet er lavt (eller forfatteren ber om det): render hver slide/side til bilde og la en
**Claude multimodal-modell** beskrive/ekstrahere diagrammer, skjermbilder og innbrent tekst til
strukturert tekst. Slå sammen med tekst-run-ekstraheringen. Resultatet lagres som vanlig
kildemateriale — **ingen endring nedstrøms**.

**Hvorfor Claude multimodal fremfor Tesseract-OCR:** innholdet *er* diagram-/skjermbilde-**semantikk**,
ikke bare bokstavelig tekst. OCR gir kun løse ord; vision fanger «hva sier diagrammet». Plattformen
bruker allerede Claude-modeller.

## Arkitektur-passform
- Ligger i den eksisterende **async parse-job-pipelinen i parser-workeren** — en ny «visuell»
  parse-modus som returnerer tekst på samme form som i dag.
- **Ny avhengighet (Fase 2):** rasterisering av slides/sider til bilder. PDF→bilde er rett frem
  (poppler/pdfium). **PPTX→bilde er den tunge biten** — krever typisk LibreOffice headless
  (PPTX→PDF→raster) i parser-containeren. Dette er den reelle kostnaden ved Fase 2 og bør
  what-if/størrelse-vurderes mot container-image og kaldstart.

## Hensyn (gjelder Fase 2)
- **Personvern (hard gate):** slides kan inneholde PII → bildene går til LLM. Må gjennom **samme
  maskering/policy som assessment-pipelinen** før noe sendes. Dette er en forutsetning, ikke en
  opsjon.
- **Kost/latens:** vision per slide koster tokens og tid. Derfor **terskel-gating** (kun ved lavt
  tekst-utbytte) + **caching per asset** (hash av fila → cache resultatet).
- **Format-dekning:** PPTX/PPT + skannet/bildetung PDF har samme problem; begge dekkes av
  raster→vision-stien.

## Beslutninger jeg trenger fra deg
1. **Retning:** hybrid (anbefalt) vs. kun-deteksjon-nå vs. full-vision-alltid?
2. **Faseplan:** levere **Fase 1 (deteksjon + advarsel)** nå som en liten egen skive, og ta **Fase 2
   (vision + rasterizer + personvern-review)** som et større, separat arbeid?
3. **Fase 2-omfang:** er LibreOffice-i-parser-containeren (for PPTX-raster) akseptabelt, eller skal
   vi begrense Fase 2 til PDF først (lavere risiko) og ta PPTX senere?

## Akseptkriterier (fra #601, uendret)
- [ ] Beslutning om retning.
- [ ] Deteksjon av bildetungt/lav-tekst kildemateriale + tydelig forfatter-tilbakemelding.
- [ ] Visuell ekstrahering bak terskel/flagg i parse-job-pipelinen.
- [ ] Personvern: vision-input gjennom eksisterende sensitiv-data-policy.
- [ ] E2e/integration: bildetungt test-deck → ikke-tomt tekstutbytte.
