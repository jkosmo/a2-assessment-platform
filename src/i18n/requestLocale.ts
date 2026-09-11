import type { Request } from "express";
import { env } from "../config/env.js";
import type { SupportedLocale } from "./locale.js";

/**
 * #984: ÉN reserve for «hvilket språk gjelder for denne forespørselen».
 *
 * `authenticate` setter alltid `context.locale` (alle tre veiene — Entra, agent-token, mock), og
 * `resolveRequestLocale` returnerer aldri tomt. Reserven her er derfor for ruter som kjører UTEN
 * `authenticate`, og for lesbarhet: 27 rutesteder hadde hver sin — `?? "nb"` femten steder,
 * `?? "en-GB"` ti, `?? env.DEFAULT_LOCALE` to. Ingen av dem var i bruk, og de var uenige om hva
 * som skulle skje den dagen én av dem ble det.
 *
 * ⚠️ Reserven er den KONFIGURERTE standarden, ikke et språk noen skrev inn i en rute. Det er samme
 * verdi `authenticate` ville landet på uten `x-locale` og uten gjenkjennelig `Accept-Language`.
 */
export function requestLocale(request: Pick<Request, "context">): SupportedLocale {
  return request.context?.locale ?? env.DEFAULT_LOCALE;
}
