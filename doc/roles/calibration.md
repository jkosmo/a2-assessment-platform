# Vurderingskvalitet (tidligere «Kalibrering»)

> Rebrandet i #836. Den gamle «Kalibrering»-flata lovde et interaktivt verktøy (glidebrytere per
> rubrikk-punkt, kalibreringsprøver med referansepoeng, hva-om-simulering) som aldri ble bygget.
> Denne siden beskriver det som **faktisk** finnes: et vurderingskvalitet-dashboard + én terskel-lever.

Vurderingskvalitet lar fagansvarlige se hvordan en modul scorer, og justere bestått-grensa.

## Roller og tilgang

Konfigurerbar per miljø via `participant-console.json` → `calibrationWorkspace.accessRoles`. Som standard
har `SUBJECT_MATTER_OWNER` og `ADMINISTRATOR` tilgang.

- `/admin-content/calibration` — flata «Vurderingskvalitet» (nås fra innholds-sub-nav-en).
- `/calibration` — **utgått** (301 → `/admin-content/calibration`).
- API: `GET /api/calibration/workspace`, `POST /api/calibration/workspace/publish-thresholds`.

## Hva flata gjør

1. **Velg modul.** Eier-filter defaulter til «Mine moduler» (bruk «Alle» for admin/andre); valgfritt
   filter på «Brukt i kurs». Velg deretter modul + versjon fra nedtrekk.
2. **Les kvalitetssignaler.** Tre kort med farge (bra / se-på / kritisk) + ren tekst:
   - **Bestått-andel** — hvor stor andel som består.
   - **Til manuell vurdering** — hvor ofte AI-en flagger svar for manuell gjennomgang.
   - **Referanse-dekning** — hvor godt modulens prompt-versjoner har referanse-svar (eksempel-svar AI-en
     kalibrerer mot). Redigeres i modul-editoren — flata lenker dit.
3. **Se poengfordelingen.** Histogram over de siste svarenes totalscore, med bestått-grensa tegnet inn.
4. **Juster grensa med preview.** Endre bestått-grensa (total; MCQ-/praktisk-minimum vises kun for moduler
   som bruker dem). En klient-side preview viser «X av Y siste svar består ved ny grense», med delta mot
   nåværende grense — beregnet fra de allerede-lastede svarene (siste N).
5. **Publiser.** «Publiser ny terskel» **lager og publiserer en ny modul-versjon** (bekreftes eksplisitt).

## Viktige notater

- Publisering påvirker kun **framtidige** vurderinger — tidligere svar re-scores ikke.
- Både lasting og publisering logges i audit-loggen.
- Preview-tallet gjelder utvalget som er lastet (siste N svar), ikke hele historikken.
- Usikker på terskelen? Start konservativt og evaluer effekten over noen uker.
