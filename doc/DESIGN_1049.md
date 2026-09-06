# Designnotat: skille omfang fra kompleksitet (#1049)

Skrevet før endringen, etter regel 1 i `CHANGE_DESIGN_RULES.md`.

## Problemet, slik produkteier formulerte det

> Det er ikke slik at det å skrive langt er vanskeligere enn å være kort.

`COMPLEXITY_BUDGET` blander to uavhengige akser i én tabell per sertifiseringsnivå:

- **kompleksitet** — `actorsMax`, `conceptsMax`, `tradeoffsMax`. Hører til nivået.
- **omfang** — `minWords`, `maxWords`, `timeBudgetMinutes`. Gjør det ikke.

Hver oppgave vi genererer arver dermed påstanden om at et vanskeligere spørsmål krever et lengre
svar.

## ⚠️ Funn: tallene står TO steder

Undersøkelsen viste noe saken ikke visste. De samme tallene finnes både i tabellen og i **prosaen**:

```
MODULE_DRAFT_LEVEL_GUIDELINES.advanced:
  "… Maximum scenario complexity: 3 actors, 2 trade-offs, 4 required concepts.
   Expected answer: 400–700 words, 30 minutes."

COMPLEXITY_BUDGET.advanced:
  { actorsMax: 3, conceptsMax: 4, tradeoffsMax: 2, minWords: 400, maxWords: 700, timeBudgetMinutes: 30 }
```

Begge sendes til modellen i samme prompt — prosaen på linje 778, tabellen på 783–788. Det er samme
tall skrevet to ganger, i to formater, fra to kilder.

**Det gjør en overstyring meningsløs alene.** Endrer forfatteren omfanget, men prosaen fortsatt sier
«Expected answer: 400–700 words», får modellen to motstridende instrukser — og vi vet ikke hvilken
den følger.

Dette er samme klasse som har truffet oss sju ganger: samme sannhet på to steder, som glir fra
hverandre.

## Beslutning

Tre steg, i denne rekkefølgen. Hvert er verdifullt alene.

**1. Prosaen slutter å gjenta tallene.** Retningslinjene beholder den kvalitative veiledningen — «bruk
et enkelt språk», «unngå lagdelte spenninger» — og lar tallene komme fra tabellen, som allerede
skrives inn i prompten rett under. Én sannhet, ett sted.

**2. Tabellen deles i to.** `LEVEL_COMPLEXITY` for aktører, begreper og avveininger.
`LEVEL_SCOPE` for ord og tid. Dagens verdier beholdes uendret, så ingen generert oppgave endrer seg
av dette steget alene.

**3. Omfanget kan overstyres per modul**, med nivåets verdi som standard.

## Hva som IKKE gjøres nå

**Omfanget får ikke påvirke vedtak.** I dag er det rådgivende for genereringen, og det skal det
fortsatt være. Skal det senere gates automatisk stryk (#1048), må det kreve en egen, eksplisitt
aktivering — en forfatter som justerer hvordan oppgaven skrives, skal ikke ved et uhell gjøre stryk
mer sannsynlig.

**`minimalPassingAnswerWordCount` lagres ikke i denne omgang.** Den regnes ut per oppgave av
svarbarhetssjekken og kastes. Å ta vare på den er riktig, men den hører til #1048 — det er der den
skal brukes.

## Vakt

En test som feiler hvis tallene kommer tilbake i prosaen. Uten den kommer de tilbake ved neste
redigering av retningslinjene, og da er vi tilbake til to kilder uten at noe blir rødt.
