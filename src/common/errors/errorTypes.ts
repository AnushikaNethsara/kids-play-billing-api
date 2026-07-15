import { AppError } from './AppError';

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(message, 401, 'AUTHENTICATION_ERROR', details);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action', details?: unknown) {
    super(message, 403, 'AUTHORIZATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class DuplicateResourceError extends AppError {
  constructor(message = 'Resource already exists', details?: unknown) {
    super(message, 409, 'DUPLICATE_RESOURCE', details);
  }
}

export class InvalidStateError extends AppError {
  constructor(message = 'Resource is not in a valid state for this operation', details?: unknown) {
    super(message, 409, 'INVALID_STATE', details);
  }
}

export class PaymentError extends AppError {
  constructor(message = 'Payment or calculation error', details?: unknown) {
    super(message, 422, 'PAYMENT_ERROR', details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later', details?: unknown) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', details);
  }
}
