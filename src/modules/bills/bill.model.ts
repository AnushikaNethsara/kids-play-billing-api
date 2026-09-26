import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import { BillStatus, DiscountType } from '../../common/constants/billStatus';
import {
  DEFAULT_SESSION_PRICING_MODE,
  SessionPricingMode,
} from '../../common/constants/pricingModes';
import { PaymentMethod } from '../../common/constants/paymentMethods';

export interface BillItemSubdocument {
  childName: string;
  playPackageId: Types.ObjectId;
  packageName: string;
  /**
   * For a session-billed item this is the RATE denominator: `unitPrice` buys this many
   * minutes. For legacy flat-price items it is descriptive only.
   */
  durationMinutes: number;
  unitPrice: number;
  quantity: number;
  lineTotal: number;

  /**
   * Set only on items billed from a timed play session. Null on bills created through
   * the flat-price `POST /bills` path and on every bill predating play sessions, which
   * is what selects the legacy `unitPrice * quantity` presentation - no data migration
   * was needed to introduce time-based billing.
   */
  playSessionId: Types.ObjectId | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  billedMinutes: number | null;

  /**
   * The pricing rule this line was billed under, snapshotted with the rate.
   *
   * Only these two inputs are stored, not the resulting split: `lineTotal` stays the sole
   * authority on the money, and a stored split that disagreed with it would be a new way
   * for a bill to contradict itself. Because every input is snapshotted, the split is
   * reproduced exactly whenever it is needed for display - see `toPublicItem`.
   *
   * A flat-price line is always PRORATA with no grace, whatever its package says now.
   */
  pricingMode: SessionPricingMode;
  graceMinutes: number;
}

export interface BillDocument {
  billNumber: string | null;
  status: BillStatus;
  customerId: Types.ObjectId | null;
  parentName: string;
  phoneNumber: string;
  items: BillItemSubdocument[];
  subtotal: number;
  discount: number;
  discountType: DiscountType;
  discountValue: number;
  tax: number;
  grandTotal: number;
  paidAmount: number;
  balance: number;
  paymentMethod: PaymentMethod | null;
  cashierId: Types.ObjectId;
  cashierName: string;
  notes: string;
  paidAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  cancellationReason: string | null;
  refundedAt: Date | null;
  refundedBy: Types.ObjectId | null;
  refundReason: string | null;

  /**
   * Marks a bill that was rung up to try the system out rather than to take money from a
   * customer - a staff training run, a printer check, a demo. The bill itself is left
   * completely intact (it keeps its bill number, its receipt and its place in the list),
   * but every revenue and dashboard aggregation skips it.
   *
   * A flag rather than a status: a test bill still went through DRAFT -> PAID like any
   * other, and overloading the status would break the lifecycle transitions that the rest
   * of the money path depends on. It is only settable once the bill is out of DRAFT, so a
   * bill can never be pre-marked as test while it is still being built at the till.
   */
  isTestBill: boolean;
  testMarkedAt: Date | null;
  testMarkedBy: Types.ObjectId | null;
  testReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type BillHydrated = HydratedDocument<BillDocument>;

const billItemSchema = new Schema<BillItemSubdocument>(
  {
    childName: { type: String, required: true, trim: true },
    playPackageId: { type: Schema.Types.ObjectId, ref: 'PlayPackage', required: true },
    // Snapshotted at billing time - historical reports must never recompute using the
    // package's current price, since prices change over time.
    packageName: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    lineTotal: { type: Number, required: true },
    playSessionId: { type: Schema.Types.ObjectId, ref: 'PlaySession', default: null },
    checkInAt: { type: Date, default: null },
    checkOutAt: { type: Date, default: null },
    billedMinutes: { type: Number, default: null },
    pricingMode: {
      type: String,
      enum: Object.values(SessionPricingMode),
      default: DEFAULT_SESSION_PRICING_MODE,
    },
    graceMinutes: { type: Number, default: 0 },
  },
  { _id: false },
);

const billSchema = new Schema<BillDocument>(
  {
    billNumber: { type: String, default: null },
    status: {
      type: String,
      enum: Object.values(BillStatus),
      default: BillStatus.DRAFT,
    },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    parentName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    items: { type: [billItemSchema], default: [] },
    subtotal: { type: Number, required: true, default: 0 },
    discount: { type: Number, required: true, default: 0 },
    discountType: { type: String, enum: Object.values(DiscountType), default: DiscountType.NONE },
    discountValue: { type: Number, default: 0 },
    tax: { type: Number, required: true, default: 0 },
    grandTotal: { type: Number, required: true, default: 0 },
    paidAmount: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: Object.values(PaymentMethod), default: null },
    cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cashierName: { type: String, required: true },
    notes: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, default: null },
    refundedAt: { type: Date, default: null },
    refundedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    refundReason: { type: String, default: null },

    isTestBill: { type: Boolean, default: false },
    testMarkedAt: { type: Date, default: null },
    testMarkedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    testReason: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * Bill number lookups (receipts, reprints) and uniqueness once assigned at completion.
 *
 * This must be a PARTIAL index, not a sparse one. `billNumber` has `default: null`, so
 * every draft carries the field explicitly - and a sparse index only skips documents
 * where the field is *absent*, not where it is null. Under `sparse: true` every unpaid
 * draft was indexed under the same `null` key, so creating a second draft while another
 * was still unpaid failed with a duplicate-key error. Filtering on `$type: 'string'`
 * indexes only bills that have actually been assigned a number at completion.
 *
 * Existing deployments carry the old index: drop `billNumber_1` once so this definition
 * can be rebuilt, otherwise Mongo keeps the old options and the bug persists.
 */
billSchema.index(
  { billNumber: 1 },
  { unique: true, partialFilterExpression: { billNumber: { $type: 'string' } } },
);
// Dashboard revenue aggregations filter by status + paidAt range.
billSchema.index({ status: 1, paidAt: -1 });
// Cashier performance reports filter by cashier + paidAt range.
billSchema.index({ cashierId: 1, paidAt: -1 });
// Customer's phone number lookup on the bill list/search screen.
billSchema.index({ phoneNumber: 1 });
// Default bill listing sort/filter by creation date.
billSchema.index({ createdAt: -1 });
// Payment-method breakdown reports.
billSchema.index({ paymentMethod: 1, paidAt: -1 });
// Every dashboard aggregation now filters test bills out before anything else, so the
// flag leads this index rather than trailing the revenue one - almost all bills are
// real, which makes it the cheapest discriminator to apply first.
billSchema.index({ isTestBill: 1, status: 1, paidAt: -1 });

export const BillModel = model<BillDocument>('Bill', billSchema);
