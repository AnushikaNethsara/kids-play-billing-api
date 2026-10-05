import { Schema, model, type HydratedDocument, Types } from 'mongoose';

/**
 * Why a subscription's balance moved.
 *
 * - RESERVE: credits taken at check-in, one per child.
 * - CHECKOUT_EXTRA: further credits taken at checkout for a stay longer than one block.
 * - VOID_REVERSAL: a voided check-in giving its reserved credits back.
 * - CHECKOUT_REVERSAL: a cancelled checkout giving its extra credits back; the child is
 *   playing again and the time is recounted at the next checkout.
 * - ADMIN_ADJUST: an admin adding or removing credits by hand, with a reason.
 */
export const SubscriptionLedgerType = {
  RESERVE: 'RESERVE',
  CHECKOUT_EXTRA: 'CHECKOUT_EXTRA',
  VOID_REVERSAL: 'VOID_REVERSAL',
  CHECKOUT_REVERSAL: 'CHECKOUT_REVERSAL',
  ADMIN_ADJUST: 'ADMIN_ADJUST',
} as const;
export type SubscriptionLedgerType = (typeof SubscriptionLedgerType)[keyof typeof SubscriptionLedgerType];

/**
 * The append-only history of a subscription's credits. `delta` is the change in credits
 * the family has left: negative when credits are used, positive when they come back or
 * are granted. So `creditsPurchased + sum(delta) = creditsTotal - creditsUsed` always.
 *
 * The counters on the Subscription are what every reservation is checked against; this is
 * the record of how they got there, shown on the admin portal and used by the tests to
 * prove the two never drift.
 */
export interface SubscriptionLedgerDocument {
  subscriptionId: Types.ObjectId;
  type: SubscriptionLedgerType;
  delta: number;
  playSessionId: Types.ObjectId | null;
  ticketCode: string | null;
  billId: Types.ObjectId | null;
  reason: string | null;
  actorId: Types.ObjectId | null;
  actorName: string;
  at: Date;
}

export type SubscriptionLedgerHydrated = HydratedDocument<SubscriptionLedgerDocument>;

const subscriptionLedgerSchema = new Schema<SubscriptionLedgerDocument>({
  subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', required: true },
  type: { type: String, enum: Object.values(SubscriptionLedgerType), required: true },
  delta: { type: Number, required: true },
  playSessionId: { type: Schema.Types.ObjectId, ref: 'PlaySession', default: null },
  ticketCode: { type: String, default: null },
  billId: { type: Schema.Types.ObjectId, ref: 'Bill', default: null },
  reason: { type: String, default: null },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorName: { type: String, default: '' },
  at: { type: Date, required: true },
});

subscriptionLedgerSchema.index({ subscriptionId: 1, at: -1 });
// Redemptions per day, for the subscriptions report.
subscriptionLedgerSchema.index({ type: 1, at: -1 });

export const SubscriptionLedgerModel = model<SubscriptionLedgerDocument>(
  'SubscriptionLedger',
  subscriptionLedgerSchema,
);
