---
name: complexity-scan
description: Running the monthly complexity scan of the A2 codebase (doc/COMPLEXITY_SCAN.md) — six agents, six areas, six patterns — and recording the result so the trend survives. Use when the scan is due or the user asks for it.
---

# Kompleksitetsskanning

Moved from CLAUDE.md (2026-11-14) so it loads only when the scan is run.

`doc/COMPLEXITY_SCAN.md` — seks agenter, seks områder, seks mønstre. Måler om kodebasen samler opp
slitasje: divergerende definisjoner, ueid policy, lag på lag, unåbare vakter, servertekst vist rått,
og løfter som ikke holdes.

Verdien er **trenden**, ikke funnene alene: gikk «hvor mange steder svarer på dette spørsmålet» opp
eller ned siden sist? Nullpunktet fra første kjøring (2026-08-21) står i fila.

⚠️ **Datoen for sist kjørt bor KUN i `doc/COMPLEXITY_SCAN.md`.** Ikke gjenta den her — to kopier av
samme faktum som må oppdateres i takt er nøyaktig feilklassen skanningen leter etter.
`scripts/ai-qa.ps1` leser datoen og sier fra når skanningen forfaller. Den blokkerer ikke.

Etter en kjøring: verifiser de tyngste funnene for hånd (agentene leser koden, de kjører den ikke),
skill defekt fra beslutning — beslutninger hører i `doc/DECISIONS.md` — og **oppdater datoen og
loggen**. Det siste er resetten; uten den finnes ingen trend.
