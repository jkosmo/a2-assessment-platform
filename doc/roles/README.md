# Brukerroller — oversikt

Plattformen har seks roller. Hver bruker har én rolle, og tilgang til funksjoner styres av rollen.

| Rolle | Intern kode | Dokument |
|---|---|---|
| Deltaker | `PARTICIPANT` | [participant.md](participant.md) |
| Innholdsadministrator | `SUBJECT_MATTER_OWNER` | [admin-content.md](admin-content.md) |
| Manuell vurderer | `REVIEWER` | [reviewer.md](reviewer.md) |
| Klagebehandler | `APPEAL_HANDLER` | [reviewer.md](reviewer.md) |
| Kalibrerer | `SUBJECT_MATTER_OWNER` (konfigurerbar) | [calibration.md](calibration.md) |
| Rapportleser | `REPORT_READER` | [report-reader.md](report-reader.md) |
| Plattformadministrator | `ADMINISTRATOR` | Har alle tilganger fra rollene over |

## Tilgangsmatrise

| Funksjonalitet | PARTICIPANT | SUBJECT_MATTER_OWNER | REVIEWER | APPEAL_HANDLER | REPORT_READER | ADMINISTRATOR |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Levere besvarelse | ✓ | | | | | ✓ |
| Se egne resultater | ✓ | | | | | ✓ |
| Anke beslutning | ✓ | | | | | ✓ |
| Kursfremdrift og kursbevis | ✓ | | | | | ✓ |
| Opprette/publisere moduler | | ✓ | | | | ✓ |
| Administrere kurs | | ✓ | | | | ✓ |
| Kalibreringssarbeidsflate | | ✓* | | | | ✓ |
| Manuell gjennomgang | | | ✓ | | | ✓ |
| Klagebehandling | | | | ✓ | | ✓ |
| Rapporter og statistikk | | ✓ | | | ✓ | ✓ |
| Plattformkonfigurasjon | | | | | | ✓ |

\* Kalibreringstilgang er konfigurerbar per miljø. Se [calibration.md](calibration.md).
