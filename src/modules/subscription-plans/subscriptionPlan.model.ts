import { Schema, model, type HydratedDocument, Types } from 'mongoose';

/**
 * A monthly subscription an admin offers - "LKR 3,000 for 8 visits". A template only: every
 * term below is snapshotted onto the Subscription when one is sold, so editing a plan never
 * changes what a family already paid for. See docs/subscriptions.md.
 */
export interface SubscriptionPlanDocument {
  name: string;
  /** Integer minor units (LKR cents). */
  price: number;
  /** Visit credits the plan buys. One credit is one child for one `visitMinutes` block. */
  visitCredits: number;
  /** How long one credit lets a child play. A shorter stay still uses the whole credit. */
  visitMinutes: number;
  /**
   * Minutes of overrun forgiven after each completed block before the next credit is
   * taken - the same meaning as PlayPackage.graceMinutes. Always shorter than visitMinutes.
   */
  graceMinutes: number;
  /**
   * Cash charged per child per block once the subscription has no credits left to cover
   * it (a long stay on the last credit, or a check-in the server could not reserve).
   * Integer minor units.
   */
  extraBlockPrice: number;
  /** How many children may be named on one subscription. Null means the ticket maximum. */
  maxChildren: number | null;
  isActive: boolean;
  description: string;
  sortOrder: number;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionPlanHydrated = HydratedDocument<SubscriptionPlanDocument>;

const subscriptionPlanSchema = new Schema<SubscriptionPlanDocument>(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    visitCredits: { type: Number, required: true, min: 1 },
    visitMinutes: { type: Number, required: true, min: 1 },
    graceMinutes: { type: Number, default: 0, min: 0 },
    extraBlockPrice: { type: Number, required: true, min: 0 },
    maxChildren: { type: Number, default: null, min: 1 },
    isActive: { type: Boolean, default: true },
    description: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Cashiers list only active plans, sorted for display.
subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });

export const SubscriptionPlanModel = model<SubscriptionPlanDocument>(
  'SubscriptionPlan',
  subscriptionPlanSchema,
);
