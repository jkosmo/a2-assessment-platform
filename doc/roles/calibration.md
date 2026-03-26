# Kalibrerer (kalibreringssarbeidsflate)

Kalibrering brukes for å justere vurderingsterskler slik at AI-vurderingen er kalibrert mot faktiske forventninger.

## Roller og tilgang

Kalibreringstilgang er **konfigurerbar per miljø**. Som standard har `SUBJECT_MATTER_OWNER` tilgang, men administrator kan endre dette i plattformkonfigurasjonen (`participant-console.json`, feltet `calibrationWorkspace.accessRoles`).

- `/calibration` — kalibreringssarbeidsflate
- API: `GET/POST /api/calibration/*`

## Hva kalibrering er

AI-vurderingssystemet bruker tersklene i rubrikken til å avgjøre om en besvarelse er bestått eller ikke. Kalibrering lar fagansvarlige:

1. Se historiske vurderinger og justere poenggrenser
2. Sette terskel for hva som regnes som «bestått» per rubrikk-punkt
3. Vurdere kalibreringsprøver (eksempelbessvarelser) og gi referansepoeng

Kalibreringsdataene brukes av AI-en i påfølgende vurderinger.

## Kalibreringssarbeidsflate — steg for steg

### 1. Starte en kalibreringssesjon

1. Gå til `/calibration`
2. Velg modul fra nedtrekkslisten
3. Klikk **Start kalibrering** — arbeidsflaten laster siste publiserte modulversjon

### 2. Gjennomgå og sette terskler

1. Arbeidsflaten viser rubrikken med alle vurderingspunkter
2. For hvert punkt vises:
   - Nåværende terskel
   - Historiske poengfordelinger fra faktiske vurderinger
3. Juster terskel per punkt ved å dra glidebryteren eller skrive inn verdi
4. Se live-forhåndsvisning av hvordan ny terskel ville ha påvirket tidligere vurderinger

### 3. Vurdere kalibreringsprøver

Kalibreringsprøver er eksempelbessvarelser med fasit-poeng.

1. Klikk **Last kalibreringsprøver** i arbeidsflaten
2. For hvert eksempel:
   - Les besvarelsen
   - Gi referansepoeng per rubrikk-punkt
   - Merk om det er et «bestått»- eller «ikke bestått»-eksempel
3. Lagre kalibreringsprøvene

### 4. Fullføre kalibreringen

1. Klikk **Lagre kalibrering**
2. Systemet lagrer tersklene og kalibreringsprøvene
3. Fremtidige vurderinger av denne modulen bruker de nye tersklene

## Viktige notater

- Kalibrering påvirker kun **fremtidige** vurderinger — allerede fullførte besvarelser revurderes ikke automatisk
- Kalibreringssendringer logges i audit-loggen
- Om du er usikker på terskelverdier, start med en konservativ justering og evaluer effekten over noen uker

## Vanlige spørsmål

**Kan jeg se hvilken effekt endringen ville ha hatt historisk?**
Ja. Arbeidsflaten viser en simulering («hva-om») basert på historiske poeng.

**Hva om jeg gjør en feil i kalibreringen?**
Rediger kalibreringen og lagre nye verdier. Tidligere vurderinger revurderes ikke, men du kan triggere manuell gjennomgang for enkeltbesvarelser om nødvendig.
