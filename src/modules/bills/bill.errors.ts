import { AppError } from '../../common/errors';

export class ConflictInProgressError extends AppError {
  constructor() {
    super(
      'An identical request is already being processed, please retry shortly',
      409,
      'REQUEST_IN_PROGRESS',
    );
  }
}

export class InvalidPlayPackageError extends AppError {
  constructor(message = 'The selected play package is not available') {
    super(message, 422, 'INVALID_PLAY_PACKAGE');
  }
}
