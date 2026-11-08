// Felles versjonssjekk for stage-skriptene (testgjennomgangen 2026-11, avsnitt 3.2).
//
// ⚠️ Før dette krevde hver release-fil NØYAKTIG én versjon, for eksempel `expect(json.version).toBe("2.127.0")`. Filene
// kjører i serie, så når den første testen feilet, hoppet Playwright over resten: mot 2.145.0 målte 21 filer ingenting og ga
// bare én rød linje hver. `release-2-136-dialogene.spec.ts` ble holdt grønn ved å skrive inn ny versjon ved hver release.
//
// En release-fil spør om stage har MINST den versjonen testen ble skrevet for. Spørsmålet «er det nøyaktig den versjonen vi
// tror på stage?» hører hjemme ett sted: `deployed-surface.spec.ts`.

/** Tall for tall: negativ når `a` er eldre enn `b`, 0 når de er like, positiv når `a` er nyere. */
export function sammenlignVersjon(a: string, b: string): number {
  const tall = (versjon: string) => versjon.split(".").map((del) => Number.parseInt(del, 10));
  const [x, y] = [tall(a), tall(b)];
  for (let i = 0; i < 3; i += 1) {
    const forskjell = (x[i] ?? 0) - (y[i] ?? 0);
    if (forskjell !== 0) return forskjell;
  }
  return 0;
}

/** Krever at `/version` er en gyldig versjon og minst `minst`. Gir versjonen tilbake, så fila kan notere den. */
export async function forventMinstVersjon(base: string, minst: string): Promise<string> {
  const versjon = String((await (await fetch(`${base}/version`)).json()).version);
  // Uten formsjekken ville en ugyldig versjon gitt NaN, og NaN < 0 er usant: sjekken ville sluppet den gjennom.
  if (!/^\d+\.\d+\.\d+$/.test(versjon) || sammenlignVersjon(versjon, minst) < 0) {
    throw new Error(`stage er ${versjon}, testen krever minst ${minst}`);
  }
  return versjon;
}
