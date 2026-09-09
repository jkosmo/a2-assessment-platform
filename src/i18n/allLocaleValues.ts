import { localizedTextCodec } from "../codecs/localizedTextCodec.js";

/**
 * #1027: alle språkvariantene av en lagret tekst, til SØK.
 *
 * ⚠️ Køene søkte før over den rå JSON-strengen. Det traff på tvers av språk — utilsiktet, men
 * nyttig: en behandler fant saken uansett hvilket språk tittelen ble skrevet på. Lokaliserer
 * serveren tittelen uten å sende variantene, blir søket smalere enn det var.
 *
 * Returnerer en liste, ikke en sammenslått streng: klienten skal kunne søke i hver enkelt uten å
 * treffe over en ordgrense som bare finnes fordi to språk står ved siden av hverandre.
 */
export function allLocaleValues(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const parsed = localizedTextCodec.parse(raw);
  if (parsed && typeof parsed === "object") {
    return Object.values(parsed).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  return typeof raw === "string" && raw.trim().length > 0 ? [raw] : [];
}
