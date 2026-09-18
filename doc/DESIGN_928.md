# Design #928 — drift mellom oppgavetekst og vurderingskriterier: sjekk ved lagring

Status: **forslag, venter på produkteier** (2026-09-18). Produkteiers beslutning fra 18.08 står:
*sjekk ved lagring, ikke ved tastetrykk; ett varsel per reell endring; beskjeden der forfatteren
står, med henvisning til Innstillinger.*

## Anbefaling

**Fjern dagens banner og erstatt det med ett spørsmål etter lagring fra Rediger.**

1. **Målet: ordforskjell, ikke hash.** Når en fritekstmodul med lagrede kriterier lagres fra Rediger,
   sammenlignes oppgavetekst + forventning + rammer (innholdsspråket) med forrige versjons tekster
   som **ordmengder** (små bokstaver, tegnsetting fjernet). Er Jaccard-likheten under **0,85**, er
   det en reell endring. En rettet skrivefeil gir 0,98 og er stille; et omskrevet scenario gir
   0,4–0,7 og varsler. Terskelen er en konstant med kommentar, og måles mot ekte lagringer på stage
   før den festes (se «Verifiser mot virkeligheten»).
2. **Én beskjed, der forfatteren står.** Etter at lagringen er bekreftet, kommer spørsmålet som
   toast-spørsmål (samme mekanisme som «Utkastet er klart»): *«Oppgaveteksten er vesentlig endret.
   Vurderingskriteriene under Innstillinger ble laget fra den forrige teksten. Generere dem på
   nytt?»* — **Generer på nytt** / **Behold**. Innstillinger-fanen får prikk (`markTabAttention`,
   #926) uansett svar, til forfatteren har vært innom.
3. **Generer på nytt** går til `criteriaTools.handleDriftRegenerate` slik den er — inkludert
   bekreftelsen når kriterier er redigert for hånd (`shell.drift.regenerate.confirm`). **Behold**
   lukker og gjør ingenting mer; neste lagring måler mot den *nye* forrige versjonen, så det samme
   varselet kommer ikke igjen for samme endring.
4. **Blueprint-hashen** (`generated_from_blueprint_hash`, #450) beholdes som lagret felt — den
   sier hvilken plan kriteriene ble laget fra og brukes av «Vis forskjell» — men banneret som
   klassifiserte den, tas bort: det har vært unåbart siden v2.18.13 (issue-ens punkt 1), og to
   uavhengige varsler for samme spørsmål er ett for mye.

## Hvorfor ikke bare gjøre banneret synlig

Banneret måler feil ting (planen, ikke teksten), og har ingen naturlig plass: Rediger dekkes av
skjemaet, Forhåndsvisning er deltakerens, Innstillinger er der kriteriene *er* — et varsel der
kommer for sent. Spørsmålet hører til øyeblikket teksten endres, og det øyeblikket er lagringen.

## Åpne spørsmål til produkteier

- Terskel 0,85 er et utgangspunkt. Vil du se tallene fra stage (fordelingen av likhet per faktisk
  lagring) før vi fester den, eller er det greit å starte der og justere?
- Skal «Behold» **også** stemple kriteriene som «bevisst beholdt» (skrive ny hash), slik at «Vis
  forskjell» vet at avviket er godkjent? (Anbefalt: ja — det er det `handleDriftKeep` gjør i dag.)

## Omfang når det bestilles

`admin-content-shell.js` (`saveDraftBundleInBackground` → etter-lagring-sjekk), en ren funksjon
`textDriftScore(prev, next)` i egen liten modul med enhetstester, fjerning av
`renderDriftBannerHtml`/`attachDriftBannerHandlers`/`resolveDriftState` (−60 linjer i skallet),
tre tekstnøkler × tre språk, e2e som lagrer et omskrevet scenario og ser spørsmålet. Én kveld.
