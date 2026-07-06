# Agent-tilgang: la ChatGPT/Claude bygge kursutkast for deg

Gjelder fagansvarlige (SUBJECT_MATTER_OWNER) og administratorer. Teknisk referanse:
`doc/API_REFERENCE.md` (Agent authoring) og `doc/design/AGENT_AUTHORING_647.md`.

## Hva er dette?

Du kan gi en KI-agent (ChatGPT, Claude) et **kortlivet tilgangstoken** slik at den kan
opprette kurs, moduler og læringsseksjoner **som utkast** direkte i plattformen — fra en
samtale du har med den. Agenten kan aldri publisere, endre eller slette noe: tokenet er
begrenset til å lage utkast, og alt den lager må du selv gjennomgå og publisere i admin-UI.

## Slik gjør du det

1. Åpne **Profil** → seksjonen **«Agent-tilgang»** (synlig kun for fagansvarlige/administratorer).
2. Gi tokenet en merkelapp (f.eks. «GDPR-kurs med ChatGPT») og velg gyldighet (15–60 min).
3. Klikk **«Lag token»** → tokenet (`aat_…`) vises **én gang**. Klikk **Kopiér**.
4. Lim det inn i agent-samtalen, f.eks.:
   > Her er tilgang: `aat_…`. Lag et kurs mot https://<din-installasjon> basert på denne
   > samtalen, med to læringsseksjoner og tre fritekstmoduler på bokmål.
5. Agenten validerer, oppretter utkastene og gir deg lenker rett inn i admin-UI.
6. Gjennomgå innholdet og publiser manuelt — modul for modul, deretter kurset.

## Sikkerhet — det du trenger å vite

- **Tokenet dør av seg selv** innen tiden du valgte (maks 1 time). Ny økt = nytt token.
- **Vises aldri igjen**: mistet det? Lag et nytt. Lekket det? Klikk **«Trekk tilbake»** i
  tabellen — det virker umiddelbart.
- **Alt spores**: alt agenten lager logges på deg (du er avsender), med et kjørings-spor
  (`agentRunId`) administratorer kan slå opp.
- Tokenet virker **kun i denne installasjonen** og kun for utkast — det gir ikke tilgang til
  deltakerdata, publisering, sletting eller administrasjon.
- Ikke del tokenet med andre personer — hver bruker lager sitt eget (det er ett klikk).

## Vanlige spørsmål

**Agenten sier 401/utløpt midt i jobben?** Lag et nytt token og lim det inn — agenten
fortsetter der den slapp (det som allerede er opprettet, er trygt lagret som utkast).

**Hvor blir det av utkastene hvis noe feiler underveis?** De ligger i biblioteket som
vanlige utkast (usynlige for deltakere). Behold, fullfør eller arkiver+slett dem i admin-UI.
