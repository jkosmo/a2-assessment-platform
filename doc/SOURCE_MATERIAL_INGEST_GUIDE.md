# Kildemateriale: filer, URL og crawl

Når du oppretter en modul i **Samtale**, er det første steget *kildemateriale* — innholdet
LLM-en bruker som grunnlag for å lage modulutkast, oppgavetekst og MCQ. Du kan kombinere flere
kilder; hver kilde blir en «chip» du kan fjerne med ×.

## Kildetyper

| Knapp | Hva den gjør | Grenser |
|-------|--------------|---------|
| **Last opp fil** | Henter tekst fra PDF/Word/tekstfiler. Du kan velge flere filer samtidig. | Inntil **10 MB** per fil. |
| **Hent fra URL** | Henter hovedteksten fra én nettside (eller `.txt`). | 10 henting/min. |
| **Crawl nettsted** | Følger lenker fra en start-URL og henter flere sider på samme nettsted. | Se under. 3 crawl/min. |
| **Ekstern LLM** | Kopierer en forfatter-prompt du kan lime inn i en ekstern LLM, og importere svaret. | — |
| (skrivefelt) | Lim inn eller skriv notater direkte. | — |

Du kan også bare skrive notater i tekstfeltet og trykke **Neste**.

## Crawl nettsted (#479)

«Crawl nettsted» er nyttig når kildematerialet er spredt over flere sider på samme nettsted —
f.eks. en dokumentasjonsseksjon eller en artikkelserie — så du slipper å hente hver side manuelt.

1. Trykk **Crawl nettsted**.
2. Lim inn en **start-URL** (f.eks. forsiden til dokumentasjonsdelen).
3. Vent mens sidene hentes. Resultatet legges til som **én** kilde-chip, merket med vertsnavn og
   antall sider, f.eks. `eksempel.no (12 sider)`.

**Slik fungerer crawlen:**

- **Kun samme nettsted.** Bare lenker til samme vertsnavn som start-URL-en følges; eksterne
  lenker ignoreres.
- **Inntil 20 sider, 2 hopp** fra start-URL-en. Når grensen nås, stopper crawlen og chip-en sier
  at grensen ble nådd — det den rakk å hente er fortsatt med.
- **Respekterer `robots.txt`.** Sider nettstedet ber roboter holde seg unna, hoppes over.
- **Høflig tempo.** En kort pause mellom hver side, så vi ikke belaster nettstedet.
- **Trygt.** Hver side valideres mot interne/private adresser før den hentes (samme vern som
  «Hent fra URL»).

Hvis ingen sider kunne hentes (f.eks. start-URL-en er blokkert eller tom), får du en feilmelding
og ingen kilde legges til — prøv «Hent fra URL» på en enkeltside i stedet.

> Tips: Vil du bare ha én side, bruk **Hent fra URL**. Bruk **Crawl** når du vil ha en hel
> seksjon i én operasjon.
