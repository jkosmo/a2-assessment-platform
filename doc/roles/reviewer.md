# Vurderer og klagebehandler

Plattformen har to separate roller for manuell behandling:

| Rolle | Intern kode | Ansvar |
|---|---|---|
| Manuell vurderer | `REVIEWER` | Behandler besvarelser flagget for manuell gjennomgang |
| Klagebehandler | `APPEAL_HANDLER` | Behandler klager fra deltakere |

Én person kan ha begge rollene, men de er separate tilgangskontroller i systemet.

---

## Manuell vurderer (`REVIEWER`)

### Tilgang

- `/review` — vurderingskø og arbeidsflate
- `/participant` — kan se moduler og egne besvarelser (primært for kontekst)

API:
- `GET /api/reviews` — vurderingskø
- `GET /api/reviews/:id` — vurderingsarbeidsflate
- `POST /api/reviews/:id/claim` — ta eierskap til en gjennomgang
- `POST /api/reviews/:id/resolve` — avgjøre gjennomgangen (bestått/ikke bestått)

### Manuell gjennomgang — steg for steg

Besvarelser flagges automatisk for manuell gjennomgang når:
- AI-vurderingen er usikker (f.eks. tvetydig besvarelse)
- Innholdsadministrator har konfigurert obligatorisk manuell gjennomgang for modulen
- Systemet oppdager røde flagg (f.eks. tegn på plagiat eller irrelevant innhold)

**Slik behandler du en manuell gjennomgang:**

1. Gå til `/review` — køen viser ventende gjennomganger
2. Klikk **Gjør krav** på en sak for å ta eierskap
   - Saken låses til deg og vises ikke lenger for andre vurderere
3. Les besvarelsen og AI-vurderingen nøye i arbeidsflaten
4. Gjennomgå rubrikken — hvert punkt er vurdert av AI med begrunnelse
5. Velg **Bestått** eller **Ikke bestått** og legg til en kort begrunnelse
6. Klikk **Lagre avgjørelse**
7. Deltakeren varsles automatisk om utfallet

**Merk:** Én sak kan bare klaimes av én vurderer om gangen. Dersom du ikke kan fullføre, frigjør saken ved å navigere bort — den vil dukke opp i køen igjen etter en stund.

### Vanlige spørsmål

**Hva gjør jeg om besvarelsen er på et annet språk enn forventet?**
Vurder på grunnlag av innholdet uavhengig av språk. AI-en er trent på flerspråklig innhold.

**Kan jeg angre en avgjørelse?**
Nei. En manuell avgjørelse er endelig med mindre deltakeren sender inn en klage.

---

## Klagebehandler (`APPEAL_HANDLER`)

### Tilgang

- `/review` — klagebehandlingskø
- `/profile` — egen profil

API:
- `GET /api/appeals` — klager under behandling
- `GET /api/appeals/:id` — klagedetaljer og arbeidsflate
- `POST /api/appeals/:id/claim` — ta eierskap til en klage
- `POST /api/appeals/:id/resolve` — avgjøre klagen

### Klagebehandling — steg for steg

Klager opprettes av deltakere som ikke er enig i vurderingsutfallet.

1. Gå til `/review` → **Klager**-fanen
2. Klikk **Gjør krav** på en klage
3. Les klagegrunn og hele vurderingshistorikken (AI + evt. manuell vurdering)
4. Vurder om klagen er berettiget:
   - **Godkjenn klage** — endre utfall til bestått (eller endre karakter)
   - **Avvis klage** — oppretthold opprinnelig beslutning
5. Klikk **Lagre avgjørelse** med begrunnelse
6. Deltakeren varsles om klageresultatet

### SLA-krav

Klager har en behandlingsfrist. Systemet overvåker klage-SLA og sender varsel til administrator dersom en klage overskrider fristen.

Forventet behandlingstid konfigureres av administrator under plattforminnstillinger.

### Vanlige spørsmål

**Kan samme person behandle sin egen besvarelse og klage?**
Systemet hindrer ikke dette teknisk, men det bør unngås av habilitetshensyn.

**Hva om deltakeren klager igjen etter at klagen er avgjort?**
En ny klage kan ikke opprettes på samme besvarelse dersom forrige klage allerede er avgjort.
