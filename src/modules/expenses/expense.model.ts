import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import { PaymentMethod } from '../../common/constants/paymentMethods';

export const ExpenseStatus = {
  ACTIVE: 'ACTIVE',
  VOIDED: 'VOIDED',
} as const;

export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];

/**
 * Money the business paid out - rent, salaries, a plumber. Admin-entered, counted on a
 * cash basis: an expense belongs to the business day it is dated (`spentOn`), and that is
 * the day it comes off profit.
 *
 * `spentOn` is a `YYYY-MM-DD` string in the business timezone rather than an instant. An
 * expense belongs to a day, not a moment, and a string day cannot drift across midnight
 * when the timezone setting changes. It also sorts and compares correctly as text, and its
 * first seven characters are the `YYYY-MM` month label the period summary uses.
 *
 * Never hard-deleted. A mistake is voided with a reason, so profit figures that change
 * after the fact always have a visible explanation.
 */
export interface ExpenseDocument {
  spentOn: string;
  /** Integer minor units (LKR cents). Always positive. */
  amount: number;
  categoryId: Types.ObjectId;
  /** Snapshot of the category name when the expense was entered or last re-categorised. */
  categoryName: string;
  description: string;
  vendor: string;
  reference: string;
  paymentMethod: PaymentMethod;
  status: ExpenseStatus;
  voidedAt: Date | null;
  voidedBy: Types.ObjectId | null;
  voidReason: string;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ExpenseHydrated = HydratedDocument<ExpenseDocument>;

const expenseSchema = new Schema<ExpenseDocument>(
  {
    spentOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'amount must be an integer in minor units' },
    },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    categoryName: { type: String, required: true },
    description: { type: String, default: '' },
    vendor: { type: String, default: '' },
    reference: { type: String, default: '' },
    paymentMethod: { type: String, enum: Object.values(PaymentMethod), required: true },
    status: { type: String, enum: Object.values(ExpenseStatus), default: ExpenseStatus.ACTIVE },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Every report reads active expenses by day range.
expenseSchema.index({ status: 1, spentOn: 1 });
expenseSchema.index({ categoryId: 1, spentOn: 1 });

export const ExpenseModel = model<ExpenseDocument>('Expense', expenseSchema);
