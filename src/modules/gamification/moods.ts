// Humørene båten kan ha (#1138). Felles for alle maskotpakker: regelen som velger humøret, står i boatMood.ts, og en
// pakke (mascots/<navn>/mascot.json) gir hvert humør en linje og et bilde.
//
// Egen fil uten avhengigheter, så maskotpakken kan leses uten å laste resten av appen (også av testserveren for e2e).

export type BoatMood = "ny" | "mett" | "sulten" | "sur" | "dramatisk";
export const BOAT_MOODS: readonly BoatMood[] = ["ny", "mett", "sulten", "sur", "dramatisk"];
