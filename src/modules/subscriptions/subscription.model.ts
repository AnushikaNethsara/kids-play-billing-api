import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import { SubscriptionStatus } from './subscriptionRules';

export interface SubscriptionChildSubdocument {
  name: string;
  addedAt: Date;
  addedBy: Types.ObjectId | null;
}

/**
 * One family's purchase of a SubscriptionPlan. Created when the bill selling it is paid.
 *
 * Every term of the plan is snapshotted here, the same discipline as a bill line's price:
 * an admin editing the plan afterwards never changes what this family bought.
 */
export interface SubscriptionDocument {
  /** Printed on the receipt as a QR, so the card can be scanned at the gate. */
  code: string;
  customerId: Types.ObjectId;
  /** Snapshotted at sale, so the cashier app can find a family offline by phone. */
  parentName: string;
  phoneNumber: string;

  planId: Types.ObjectId;
  planName: string;
  price: number;
  /** Credits the plan bought. Never changes; admin adjustments move `creditsTotal`. */
  creditsPurchased: number;
  /** Credits this subscription can use in all - `creditsPurchased` plus admin adjustments. */
  creditsTotal: number;
  /**
   * The compare-and-set counter every reservation runs against. Never above
   * `creditsTotal`; see `subscriptionRepository.reserveCredits`.
   */
  creditsUsed: number;
  visitMinutes: number;
  graceMinutes: number;
  extraBlockPrice: number;
  maxChildren: number | null;

  children: SubscriptionChildSubdocument[];

  startsAt: Date;
  expiresAt: Date;
  /** ACTIVE or CANCELLED only - EXPIRED and EXHAUSTED are derived. */
  status: SubscriptionStatus;

  /** The bill that sold it, and the line on that bill. Unique together. */
  saleBillId: Types.ObjectId;
  saleLineIndex: number;

  cancelledAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  cancelReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionHydrated = HydratedDocument<SubscriptionDocument>;

const subscriptionChildSchema = new Schema<SubscriptionChildSubdocument>(
  {
    name: { type: String, required: true, trim: true },
    addedAt: { type: Date, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

const subscriptionSchema = new Schema<SubscriptionDocument>(
  {
    code: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    parentName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    planId: { type: Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    planName: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    creditsPurchased: { type: Number, required: true, min: 0 },
    creditsTotal: { type: Number, required: true, min: 0 },
    creditsUsed: { type: Number, default: 0, min: 0 },
    visitMinutes: { type: Number, required: true, min: 1 },
    graceMinutes: { type: Number, default: 0, min: 0 },
    extraBlockPrice: { type: Number, required: true, min: 0 },
    maxChildren: { type: Number, default: null },
    children: { type: [subscriptionChildSchema], default: [] },
    startsAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(SubscriptionStatus),
      default: SubscriptionStatus.ACTIVE,
    },
    saleBillId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true },
    saleLineIndex: { type: Number, required: true, min: 0 },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: null },
  },
  { timestamps: true },
);

// One subscription per sold line: a retried payment, or the startup sweep running after a
// crash, reads the existing one back instead of selling the family a second.
subscriptionSchema.index({ saleBillId: 1, saleLineIndex: 1 }, { unique: true });
// The QR payload.
subscriptionSchema.index({ code: 1 }, { unique: true });
// A family's subscriptions, newest first - the check-in lookup.
subscriptionSchema.index({ customerId: 1, expiresAt: -1 });
subscriptionSchema.index({ phoneNumber: 1, expiresAt: -1 });
// The usable list the cashier app caches, and the expiring-soon filter.
subscriptionSchema.index({ status: 1, expiresAt: 1 });

export const SubscriptionModel = model<SubscriptionDocument>('Subscription', subscriptionSchema);
