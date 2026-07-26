export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  constructor(message: string, public readonly isOperational = true) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  readonly statusCode = 400;
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
}
