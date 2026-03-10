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
