import { Schema, model } from 'mongoose';

/**
 * _id is the counter key (e.g. "KPA-20260715", one per business day). Incrementing it
 * via an atomic findOneAndUpdate is what makes bill-number generation safe under
 * concurrent cashiers without needing a multi-document transaction.
 */
export interface CounterDocument {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDocument>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const CounterModel = model<CounterDocument>('Counter', counterSchema);
