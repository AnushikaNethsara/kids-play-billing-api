import { Schema, model } from 'mongoose';

/**
 * _id is the counter key (e.g. "KPA-20260926-143215", one per second in which a bill was
 * completed). Incrementing it via an atomic findOneAndUpdate is what makes bill-number
 * generation safe under concurrent cashiers without needing a multi-document transaction.
 *
 * The key used to be one per business day, back when the bill number carried a daily
 * sequence. It no longer does - see billNumber.service.ts - but the atomic counter is kept
 * because it is what makes a collision impossible by construction rather than something to
 * detect and retry.
 */
export interface CounterDocument {
  _id: string;
  seq: number;
  createdAt: Date;
}

const counterSchema = new Schema<CounterDocument>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
  /**
   * Expires the row a day after it is written. A per-second key means roughly one document
   * per bill rather than one per day, so without this the collection would grow forever.
   * Safe to expire: the key embeds the date, so once that second has passed it can never
   * be asked for again.
   *
   * Counter rows written before this field existed have no `createdAt` and are simply
   * ignored by the TTL - a handful of inert daily rows, not worth a migration.
   */
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});

export const CounterModel = model<CounterDocument>('Counter', counterSchema);
