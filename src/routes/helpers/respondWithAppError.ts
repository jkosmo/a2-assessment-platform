import type express from "express";

/**
 * Formen en feil maa ha for aa kunne skrives som svar. `AppError` oppfyller den, men det gjoer ogsaa
 * `UrlFetchError` og andre domenefeil som baerer kode og melding uten aa arve klassen.
 *
 * ⚠️ Typen er formen, ikke klassen, med vilje: en vakt som bare godtok `AppError` ville sendt de
 * andre tilbake til aa skrive kroppen for haand — som er nettopp problemet.
 */
type RespondableError = { code: string; message: string; details?: unknown; httpStatus?: number };

/**
 * Skriver en `AppError` som HTTP-svar, med SAMME kropp som den globale feilhaandteringen.
 *
 * ⚠️ Fjorten ruter hadde hver sin haandrullede versjon: `{ error, message }`, uten `details`.
 * Det gikk bra saa lenge ingen feil BAR data — men #999 lot domenevaktene sende tallene setningen
 * trenger, og da viste de rutene «used in {count} course(s): {courseTitles}» med plassholderne
 * staaende. Verre enn den norske prosaen de erstattet.
 *
 * Ruter som fanger selv (for aa legge paa egen status eller logge) skal bruke denne, ikke skrive
 * kroppen for haand. Da kan ikke de to formene drive fra hverandre igjen.
 */
export function respondWithAppError(response: express.Response, error: RespondableError, status?: number): void {
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  if (error.details !== undefined) body.details = error.details;
  // `status` er for de faa rutene som oversetter en domenefeil til en annen HTTP-status enn feilen
  // selv baerer — url-henting mapper f.eks. `too_large` til 415. De skal fortsatt sende `details`.
  response.status(status ?? error.httpStatus ?? 500).json(body);
}
