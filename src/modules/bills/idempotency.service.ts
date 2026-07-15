import { IdempotencyKeyModel } from './idempotencyKey.model';
import { ConflictInProgressError } from './bill.errors';

const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
}

export const idempotencyService = {
  /**
   * Runs `fn` exactly once per idempotency key. A retried request with the same key
   * gets the exact stored response instead of re-running the operation. A genuinely
   * concurrent request with the same key (racing before the first has finished) is
   * rejected with a 409 rather than allowed to run `fn` a second time in parallel -
   * the atomic DRAFT->PAID transition in billRepository.completeIfDraft is the final
   * backstop against double payment regardless of this layer.
   */
  async run<T>(key: string, fn: () => Promise<IdempotentResult<T>>): Promise<IdempotentResult<T> & { replayed: boolean }> {
    const existing = await IdempotencyKeyModel.findById(key).exec();
    if (existing && existing.statusCode !== 0) {
      return { statusCode: existing.statusCode, body: existing.responseBody as T, replayed: true };
    }

    try {
      await IdempotencyKeyModel.create({ _id: key, statusCode: 0, responseBody: null });
    } catch (err) {
      const mongoErr = err as { code?: number };
      if (mongoErr.code === MONGO_DUPLICATE_KEY_ERROR_CODE) {
        throw new ConflictInProgressError();
      }
      throw err;
    }

    try {
      const result = await fn();
      await IdempotencyKeyModel.findByIdAndUpdate(key, {
        statusCode: result.statusCode,
        responseBody: result.body,
      }).exec();
      return { ...result, replayed: false };
    } catch (err) {
      await IdempotencyKeyModel.findByIdAndDelete(key).exec();
      throw err;
    }
  },
};
