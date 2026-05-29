# UX-/produktvurdering av redesignspor for admin-grensesnitt

**Repo:** `jkosmo/a2-assessment-platform`  
**Branch:** `epic/admin-content-redesign`  
**Dato:** 2026-04-17

## Sammendrag

Dette redesignsporet er nærmere **ett produkt med to arbeidsmoduser** enn **to separate produkter**, men det er ikke robust nok koblet sammen ennå.

Det viktigste som gjenstår er ikke visuell stil, men **arbeidstilstand, statusforståelse og roundtrip mellom modusene**. Det er særlig tre ting som må løses for at løsningen faktisk skal oppleves som én samlet arbeidsflate:

1. en felles og konsekvent **statusmodell**
2. trygg overgang mellom modusene med **bevaring av arbeidstilstand**
3. en delt og konsistent **preview-/reviewflate**

Uten dette vil advanced editor fortsatt oppleves som «det egentlige verktøyet», mens chaten oppleves som en nyttig, men sekundær forflate.

---

## 1. Vanlige UX-feller når conversational UI og advanced editor skal fungere som én helhet

### 1.1 Ulik «sannhet» om samme modul

Når chat og advanced ikke tydelig jobber mot samme objektmodell, skjer dette raskt:

- chat føles som idé- og genereringsflate
- advanced føles som det egentlige systemet
- brukeren slutter å stole på at chat-endringer er «ekte»

Dette er den farligste fellen. Ikke fordi den er dramatisk, men fordi den lærer brukeren at én modus er leketøy og den andre er arbeid.

### 1.2 Ulik statuslogikk

Når «utkast», «lagret», «preview», «live» og «publisert» vises ulikt i de to modusene, bryter mentalmodellen sammen. I dette domenet er det ekstra alvorlig fordi modulen både er et arbeidsobjekt og et publiserbart objekt.

### 1.3 Ulik handlingsgrammatikk

Hvis brukeren kan gjøre X i chat, Y i advanced, og Z bare noen steder uten god forklaring, oppleves det ikke som to moduser, men som to halvferdige systemer.

### 1.4 Roundtrip uten bevaring av arbeid

Dette er den største operative UX-risikoen i dagens branch:

- shellen holder draft i JavaScript-minne
- advanced åpnes med `moduleId`
- tilbake til chat skjer med `moduleId` og `resumeEditing=1`
- men det betyr i praksis gjenoppretting fra valgt modul / lagret tilstand, ikke sikker overføring av usynkede lokale endringer mellom modusene

Det skaper en veldig konkret følelse av at det ikke er trygt å bytte modus midt i arbeidet.

### 1.5 Preview som sidefunksjon i stedet for felles review-surface

I conversational shell er preview sentral og kontinuerlig. I advanced editor er preview mer sekundær og handlingsdrevet. Det skaper to ulike arbeidsmåter rundt samme innhold.

### 1.6 For mange bekreftelser på feil steder

Hvis systemet krever bekreftelse for mange mellomsteg, mister brukeren flyt. Hvis systemet samtidig ikke beskytter overgang med usavede endringer, beskytter man feil ting.

---

## 2. Hva som må være sant for at dette skal oppleves som ett samlet produkt

For at conversational UI og advanced editor faktisk skal oppleves som én arbeidsflate, må følgende være sant:

### 2.1 Samme modul er alltid tydelig valgt i begge moduser

Modulnavn, modul-ID, språk og gjeldende status må være identisk synlig.

### 2.2 Samme statusmodell brukes overalt

Det kan ikke være egne shell-begreper og egne advanced-begreper. Det må finnes ett sett med tydelige begreper.

### 2.3 Preview er samme konsept i begge moduser

Preview må ikke være en knapp det ene stedet og hovedflate det andre. Det må være én felles review-overflate.

### 2.4 Brukeren mister aldri arbeid ved modusskifte

Ikke «som regel», ikke «hvis du har lagret», ikke «om du gikk riktig vei». Aldri.

### 2.5 Kritiske handlinger finnes begge steder

Minst disse må finnes begge steder:

- åpne modul
- lagre utkast
- preview
- publisere
- avpublisere
- arkivere
- gjenopprette

### 2.6 Modusene har forskjellig styrke, men ikke forskjellig autoritet

Chat er ikke bare utkastgenerator. Advanced er ikke det eneste stedet der ting blir «ekte». Begge må være reelle arbeidsflater.

### 2.7 Samme versjonskjede forklares likt begge steder

Brukeren må alltid forstå:

- hva som er live nå
- hva som er siste lagrede draft
- hva de redigerer akkurat nå

### 2.8 Samme språk- og locale-modell brukes konsekvent

UI-locale, preview-locale og innholdslocale må skilles tydelig og vises på samme måte i begge moduser.

---

## 3. Hvilke handlinger hører hjemme hvor

## 3.1 Handlinger som primært bør høre hjemme i conversational UI

Dette er oppgaver der intensjon er viktigere enn feltpresisjon:

- opprette ny modul
- starte fra kildemateriale
- generere scenario / oppgavetekst og veiledning
- generere MCQ
- høy-nivå revisjoner i naturlig språk
- raskt be om ny versjon av tekst
- starte oversettelse eller språkvariantarbeid
- gjenoppta arbeid på en eksisterende modul

Chat bør være best når brukeren tenker:

**«Hjelp meg å komme videre.»**

Ikke når brukeren tenker:

**«Jeg må kontrollere alle strukturdetaljer.»**

## 3.2 Handlinger som primært bør høre hjemme i advanced editor

Dette er oppgaver der presisjon, inspeksjon og struktur er viktigere enn flyt:

- detaljredigering per felt
- rubric / vurderingsregler
- assessment policy
- submission schema
- tekniske versjonsreferanser
- inspeksjon av lagret innhold
- finjustering av MCQ på spørsmål-, alternativ- og fasitnivå
- feilretting og parity-kontroll på tvers av locale
- kalibrering, kurs og andre admin-domener utenfor kjerneforfatting

Advanced bør være best når brukeren tenker:

**«Jeg må være helt sikker på hva som faktisk er lagret og publisert.»**

## 3.3 Handlinger som bør finnes begge steder

Dette er avgjørende. Hvis disse ikke finnes begge steder, vil løsningene føles som to systemer:

- åpne valgt modul
- se status
- preview
- bytte preview-locale
- lagre utkast
- publisere
- avpublisere
- arkivere / gjenopprette
- gå til den andre modusen
- se hva som er usavet

Forskjellen bør være:

- i chat: høy-nivå, handlingsorientert
- i advanced: eksplisitt, detaljert, full kontroll

---

## 4. Forslag til informasjonsarkitektur / mental modell

## 4.1 Anbefalt modell: fire begreper, ikke tre

### Arbeidsutkast

Dette er det brukeren redigerer akkurat nå.

Det kan:

- komme fra chatgenerering
- komme fra manuell redigering
- være usavet
- eksistere lokalt i arbeidsflaten

Dette bør vises som:

- gul/oransje status: **Ulagrede endringer**
- tydelig «sist lagret» eller «ikke lagret ennå»
- aldri blandet med publiseringsstatus

### Lagret utkastversjon

Dette er en append-only, lagret versjon i backend.

Det betyr:

- ikke live
- trygg å gå tilbake til
- eksplisitt versjonsnummer

Dette bør vises som:

- **Lagret utkast vN**
- dato og tid
- «ikke synlig for deltakere»

### Publisert versjon

Dette er live-versjonen.

Det betyr:

- aktiv for deltakere
- tydelig separert fra arbeidsutkast
- alltid lett å identifisere

Dette bør vises som:

- grønn badge: **Publisert vN**
- publisert tidspunkt
- gjerne «denne er live nå»

### Preview

Preview er ikke en egen lagringstilstand.

Preview er bare en visning av én av tilstandene over.

Det er viktig at preview aldri fremstår som en slags fjerde status.

## 4.2 Anbefalt fast statuslinje i begge moduser

Øverst i både chat og advanced bør det finnes en fast state rail:

- **Modul:** [navn]
- **Du redigerer:** Arbeidsutkast / Lagret utkast vN / Publisert vN
- **Live nå:** Publisert vM
- **Endringer:** Ulagrede endringer / Alt lagret
- **Preview viser:** Arbeidsutkast / Publisert versjon
- **Språk:** UI / Preview / Innhold

Dette må være identisk i begge moduser.

## 4.3 Viktigste prinsipp

**Publiseringsstatus og redigeringsstatus må aldri blandes i samme badge alene.**

En modul kan være publisert samtidig som brukeren sitter med ulagrede endringer. Det må vises som to separate sannheter.

---

## 5. Anbefalt overgangsmodell mellom conversational og advanced

## 5.1 Fra chat til advanced

Når brukeren klikker «Åpne detaljredigering», bør systemet gjøre ett av to:

### A. Hvis det finnes ulagrede endringer i shell

Vis et lite overgangsvalg:

- Fortsett i advanced med nåværende arbeidsutkast
- Lagre som utkastversjon først
- Avbryt

### B. Hvis det ikke finnes ulagrede endringer

Gå direkte til advanced på samme modul.

Det viktige er at advanced må kunne åpnes i **samme arbeidskontekst**, ikke bare på samme modul.

## 5.2 Fra advanced tilbake til chat

«Tilbake til samtale» bør:

- åpne samme modul
- gjenopprette samme redigeringskontekst
- helst samme locale og preview-locale
- vise hva som har endret seg siden sist
- lande brukeren i riktig tilstand, ikke i generisk startskjerm

## 5.3 Vurdering av dagens roundtrip

Dagens løsning gjør noe riktig:

- shell sender brukeren til advanced med `moduleId`
- advanced bygger tilbake-lenke med `moduleId` og `resumeEditing=1`
- shell kan da laste valgt modul og opprette draft fra lastet modulinnhold

Det som ikke er godt nok løst ennå:

- shellens arbeidsutkast lever i minnet
- advanced får ikke automatisk med seg dette arbeidsutkastet som redigerbar tilstand
- roundtripen bevarer modulkontekst bedre enn arbeidstilstand

## 5.4 Anbefaling

Innfør en eksplisitt **shared working draft context** som kan bæres mellom modusene.

Dette kan løses som:

- backend-lagret draft-session
- lokal persisted workspace state knyttet til `moduleId`
- eksplisitt handoff-payload mellom rutene

Den beste løsningen her er:

**backend-lagret working draft metadata kombinert med lokal buffer for siste usavede UI-tilstand.**

Det er mer robust enn bare `sessionStorage`, og mindre skjørt enn bare query params.

---

## 6. Konkrete UX-anbefalinger for å redusere friksjon

## 6.1 Færre bekreftelser

Bekreft bare når konsekvensen er reell og vanskelig å reversere.

### Ingen bekreftelse for

- generer utkast
- generer MCQ
- revider tekst
- bytt locale
- åpne advanced
- åpne preview
- lagre feltendringer i dialog

### Én enkel bekreftelse for

- publiser
- avpubliser
- arkiver
- gjenopprett

### Hard bekreftelse kun for

- slett modul

Hvis brukeren forlater modul eller modus med usavede endringer, bruk ikke en generisk browser-confirm. Bruk en tydelig handlingsdialog:

- Lagre utkast
- Fortsett uten å lagre
- Avbryt

## 6.2 Tydeligere primærhandlinger

Hver modus bør ha nøyaktig én tydelig primærhandling av gangen.

### I chat

- før generering: **Generer utkast**
- etter generering: **Lagre utkast**
- når lagret draft finnes: **Publiser**

### I advanced

- når det er usavede endringer: **Lagre utkast**
- når lagret draft finnes: **Publiser**
- preview og tekniske handlinger bør være sekundære

Ikke vis «save», «publish», «preview», «open advanced», «pick another», «restore archived» som like sterke valg samtidig i samme steg.

## 6.3 Bedre plassering av preview

Preview bør være:

- permanent og synlig i shell
- permanent eller dockbar i advanced
- samme komponent og samme visningslogikk begge steder

Anbefaling for advanced:

- høyre sidepanel med participant preview
- veksling mellom «Preview» og «Technical»
- samme preview-komponent som i shell

Dette vil gjøre de to modusene dramatisk mer sammenhengende.

## 6.4 Klarere lagre/publiser-status

Disse tre statusene bør alltid vises tydelig:

- **Ulagrede endringer**
- **Lagret utkast vN**
- **Publisert vM**

I tillegg bør systemet vise:

- «Preview viser arbeidsutkast» eller «Preview viser publisert versjon»
- «Sist lagret av [navn/tid]» der det finnes
- forskjellen mellom live og draft som egen rad, ikke bare badge

## 6.5 Bedre MCQ-redigering

MCQ er en typisk kilde til modal splittelse.

Anbefaling:

- chat håndterer generering og høy-nivå revisjon
- advanced håndterer presis redigering
- begge moduser viser tydelig:
  - antall spørsmål
  - antall alternativer
  - språkstatus per spørsmål

## 6.6 Redusere følelsen av «to produkter»

Følgende bør harmoniseres mellom modusene:

- samme toppstatus og terminologi
- samme preview
- samme hovedobjekt i header
- samme knapper for lagre/publiser
- samme språk om versjoner
- samme statusbadges

Visuell konsistens alene er kosmetikk. Det som trengs er konseptuell konsistens.

---

## 7. WCAG- og tilgjengelighetshensyn som er spesielt viktige

## 7.1 Viktigste prioriteringer

### Tydelig fokusstyring i dialoger og ved modusskifte

Fokus må alltid tilbakeføres riktig ved åpning og lukking av dialoger og ved overgang mellom arbeidsmoduser.

### Ikke bruk bare farge for status

Live, draft, shell og unsaved må ha tekst, ikon eller label, ikke bare badgefarge.

### ARIA-live i chat må være kontrollert

Nye meldinger, genereringsstatus og lagre/publiser-resultat må annonseres for skjermleser uten å skape støy.

### Langkjørende LLM-operasjoner må være avbrytbare og forståelige

Brukeren må få tydelig status og kunne avbryte. Ikke bare spinner. Ikke blokkering av hele UI.

### Klare labels for locale

Det må være tydelig forskjell mellom:

- språk for UI
- språk for preview
- språk for innhold som redigeres

### Keyboard-operabilitet for hele flyten

Ikke bare skjemaelementene. Også:

- chatvalg
- locale tabs
- MCQ-dialog
- preview-locale buttons
- overgang mellom modusene

### Feilmeldinger må være konkrete og plassert nær handlingen

Toast kan bekrefte, men bør ikke alene bære viktige feil eller valideringsbeskjeder.

### Preview må være semantisk strukturert

Overskrifter, seksjoner, spørsmål, alternativer og rasjonale må ha ryddig semantikk for skjermlesere.

### Autosized tekstfelt må ikke skape hoppende fokus eller uforutsigbar scroll

Dette er spesielt viktig i lange adminøkter.

### Tabeller og scrollområder må ha gode labels

Dette gjelder særlig kalibreringsområdet, men samme nivå bør brukes ellers.

## 7.2 AI-spesifikke tilgjengelighetshensyn

- vis tydelig hva som er AI-generert vs manuelt redigert
- vis hva som er foreslått, akseptert og lagret
- ikke gjør brukerens kontroll avhengig av å forstå chathistorikken alene
- vis endringsoppsummering eller diff der det er mulig

---

## 8. Prioritert liste over de viktigste forbedringene

## 1. Innfør én felles statusmodell på tvers av begge moduser

Dette er høyeste prioritet.

Systemet må tydelig skille mellom:

- arbeidsutkast
- lagret utkastversjon
- publisert versjon
- hva preview viser akkurat nå

Uten dette vil resten fortsatt oppleves som to systemer.

## 2. Bevar usavede endringer ved modusskifte

Dette er den viktigste konkrete UX-risikoen i dagens branch.

Det som må på plass:

- shared working draft context
- trygg handoff chat → advanced
- trygg handoff advanced → chat

## 3. Gjør preview til en delt, konsistent review-surface

Conversational shell er allerede på riktig vei. Advanced må få samme konsept.

Det som bør leveres:

- integrert preview i advanced
- samme preview-komponent
- samme statusmarkering

## 4. Standardiser hvilke handlinger som finnes begge steder

Minstekrav:

- lagre utkast
- publisere
- avpublisere
- arkivere / gjenopprette
- preview
- locale-bytte
- modulvalg

## 5. Forenkle bekreftelsesmodellen

Bekreft bare publiserings- og destruktive handlinger.

Bruk spesifikk «leave with unsaved changes»-dialog ved faktisk fare.

## 6. Gjør advanced til presisjonsmodus, ikke annet produkt

Advanced bør ikke føles som en egen app.

Det krever:

- samme statuslinje
- samme preview
- samme terminologi
- opprydding i startmoduser og struktur som nå føles mer historisk enn målrettet

## 7. Lukk parity-gapene mellom chat og advanced

Særlig disse områdene må harmoniseres:

- språk/locale
- MCQ-redigering
- preview-atferd
- publiseringsforståelse
- hvilke innholdstyper som kan revideres hvor

## 8. Legg på tilgjengelighetsstramming før bred utrulling

Dette er ikke pynt etterpå. Det er kjernearbeid i et verktøy med:

- langvarig bruk
- komplekse skjema
- modal dialog
- AI-genererte endringer
- mange statusoverganger

---

## Konklusjon

Redesignsporet har en god og tydelig retning. Det er et reelt forsøk på å bygge én arbeidsflate med to moduser, ikke bare en chatbot ved siden av et gammelt skjema.

Men brukeropplevelsen vil fortsatt kjennes delt helt til disse tre tingene er løst:

- felles statusmodell
- trygg roundtrip med bevart arbeid
- delt preview-/reviewflate

Når de tre er på plass, kan conversational UI og advanced editor oppleves som to moduser av samme produkt.

Uten dem vil advanced fortsatt føles som stedet man må gå for å gjøre det «ordentlig».

---

## Kildegrunnlag

Vurderingen er basert på følgende filer i branchen `epic/admin-content-redesign`:

- `doc/design/CONVERSATIONAL_ADMIN_CONTENT_DESIGN.md`
- `doc/design/CONVERSATIONAL_ADMIN_CONTENT_IMPLEMENTATION_STATUS.md`
- `public/admin-content.html`
- `public/admin-content-advanced.html`
- `public/static/admin-content-shell.js`
- `public/admin-content.js`
