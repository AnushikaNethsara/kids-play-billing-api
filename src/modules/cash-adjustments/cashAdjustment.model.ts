import { Schema, model, type HydratedDocument, Types } from 'mongoose';

export const CashAdjustmentStatus = {
  ACTIVE: 'ACTIVE',
  VOIDED: 'VOIDED',
} as const;

export type CashAdjustmentStatus = (typeof CashAdjustmentStatus)[keyof typeof CashAdjustmentStatus];

/**
 * A cash difference found when the drawer was counted at reconciliation: positive is a
 * surplus (more cash than expected), negative a shortage. Admin-entered.
 *
 * It is not revenue. Revenue stays the sum of the bills, so the payment-method totals keep
 * adding up to net revenue. The difference is its own figure, "cash over/short", and it is
 * added to profit: `netProfit = netRevenue - expenses + cashOverShort`.
 *
 * `businessDate` is a `YYYY-MM-DD` string in the business timezone, for the same reasons as
 * `Expense.spentOn`: a count belongs to a day, not a moment, and a string day cannot drift
 * across midnight when the timezone setting changes.
 *
 * Never hard-deleted. A mistake is voided with a reason, so a day's figures that change
 * after the fact always have a visible explanation.
 */
export interface CashAdjustmentDocument {
  businessDate: string;
  /** Signed integer minor units (LKR cents). Never zero. + surplus, - shortage. */
  amount: number;
  reason: string;
  notes: string;
  /** Optional: what was counted in the drawer, in minor units. */
  countedCash: number | null;
  /** Optional: what the daily close expected when this was recorded, in minor units. */
  expectedCash: number | null;
  status: CashAdjustmentStatus;
  voidedAt: Date | null;
  voidedBy: Types.ObjectId | null;
  voidReason: string;
  createdBy: Types.ObjectId | null;
  createdByName: string;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CashAdjustmentHydrated = HydratedDocument<CashAdjustmentDocument>;

const cashAdjustmentSchema = new Schema<CashAdjustmentDocument>(
  {
    businessDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (value: number) => Number.isInteger(value) && value !== 0,
        message: 'amount must be a non-zero integer in minor units',
      },
    },
    reason: { type: String, required: true, trim: true },
    notes: { type: String, default: '' },
    countedCash: { type: Number, default: null },
    expectedCash: { type: Number, default: null },
    status: { type: String, enum: Object.values(CashAdjustmentStatus), default: CashAdjustmentStatus.ACTIVE },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Every report reads active adjustments by day range.
cashAdjustmentSchema.index({ status: 1, businessDate: 1 });

export const CashAdjustmentModel = model<CashAdjustmentDocument>('CashAdjustment', cashAdjustmentSchema);
