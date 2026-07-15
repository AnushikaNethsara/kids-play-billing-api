import { Schema, model } from 'mongoose';

/**
 * Stores the first response produced for a given Idempotency-Key + route, so that
 * retried requests (e.g. a mobile app retrying after a dropped response) receive the
 * exact same result instead of erroring or double-processing the bill. TTL-expired
 * after 24h since the header is only meant to cover short retry windows.
 */
export interface IdempotencyKeyDocument {
  _id: string;
  statusCode: number;
  responseBody: unknown;
  createdAt: Date;
}

const idempotencyKeySchema = new Schema<IdempotencyKeyDocument>({
  _id: { type: String, required: true },
  statusCode: { type: Number, required: true },
  // Not `required` - a placeholder record with responseBody: null is written first to
  // claim the key before the operation runs, then filled in once it completes.
  responseBody: { type: Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
});

idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export const IdempotencyKeyModel = model<IdempotencyKeyDocument>(
  'IdempotencyKey',
  idempotencyKeySchema,
);
