export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: string, httpStatus: number, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(entity = "Resource", code = "not_found", message = `${entity} not found.`) {
    super(code, 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, 409, message, details);
  }
}

/**
 * #999: en DOMENEREGEL sa nei, og regelen har en kode klienten kan slaa opp.
 *
 * ⚠️ `ValidationError` gir alltid koden `validation_error`. Klienten kan da ikke skille «Zod avviste
 * formen» fra «slettevernet slo inn», og viste derfor serverens `message` ordrett — norsk prosa i et
 * engelsk forfattergrensesnitt. Det var et bevisst unntak fra «koden er kontrakten»
 * (FEATURE_SURFACE_MAP §24), tatt fordi alternativet var verre: «Noe i skjemaet mangler eller er
 * feil utfylt» sendte forfatteren for aa lete i et skjema som ikke feilet.
 *
 * Med en egen kode kan klienten formulere setningen selv, paa brukerens spraak.
 *
 * `details` baerer TALLENE setningen trenger — antall kurs, antall bevis — som felt, ikke som
 * interpolert prosa. Ellers maatte klienten lese tallet ut av en setning.
 *
 * `message` beholdes som foer: den logges, og den er det en API-konsument uten oversettelsestabell
 * faar. Den er ikke lenger det brukeren ser.
 */
export class DomainRuleError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, 400, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("validation_error", 400, message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden.", code = "forbidden") {
    super(code, 403, message);
  }
}
