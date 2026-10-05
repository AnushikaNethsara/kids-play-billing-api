import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import { BillStatus, DiscountType } from '../../common/constants/billStatus';
import {
  DEFAULT_SESSION_PRICING_MODE,
  SessionPricingMode,
  type TieredPricing,
} from '../../common/constants/pricingModes';
import { tieredPricingSchema } from '../play-packages/tieredPricing.schema';
import { PaymentMethod } from '../../common/constants/paymentMethods';
import { BillItemKind } from '../../common/constants/billItemKind';

/**
 * The plan terms a SUBSCRIPTION line sold, snapshotted when the draft was built so the
 * subscription created at payment carries exactly what the customer was quoted, even if an
 * admin edits the plan between draft and payment. `subscriptionId`, `code` and `expiresAt`
 * are written back once payment has created the subscription, so the receipt can print
 * them without a second lookup.
 */
export interface BillItemSubscriptionSaleSubdocument {
  planId: Types.ObjectId;
  visitCredits: number;
  visitMinutes: number;
  graceMinutes: number;
  extraBlockPrice: number;
  maxChildren: number | null;
  children: string[];
  subscriptionId: Types.ObjectId | null;
  code: string | null;
  expiresAt: Date | null;
}

/**
 * On a ticket paid for with subscription credits: what it used, frozen at checkout. The
 * line's `lineTotal` is only the cash part - `shortfallBlocks x unitPrice`, where
 * `unitPrice` is the plan's extra block price - and is usually 0.
 */
export interface BillItemSubscriptionUseSubdocument {
  subscriptionId: Types.ObjectId;
  code: string;
  creditsUsed: number;
  shortfallBlocks: number;
  /** Credits the family had left straight after this checkout, for the receipt. */
  creditsRemainingAfter: number;
  rejectedReason: string | null;
}

export interface BillItemSubdocument {
  /**
   * What the line is for - see BillItemKind. Absent on every line written before kinds
   * existed, all of which were PLAY lines; read it through `resolveItemKind`, never raw.
   */
  kind: BillItemKind;
  /**
   * The child on a PLAY line. On a PRODUCT line sold onto a play session, the child it was
   * for; otherwise empty. Unused on a GROUP line, which names the group in `packageName`.
   */
  childName: string;
  /** Set on PLAY lines only. */
  playPackageId: Types.ObjectId | null;
  /**
   * The line's printed name, snapshotted: the package on a PLAY line, the product on a
   * PRODUCT line, and the group (the pre-school's name) on a GROUP line.
   */
  packageName: string;
  /**
   * For a session-billed item this is the RATE denominator: `unitPrice` buys this many
   * minutes. For legacy flat-price items it is descriptive only. On a GROUP line it is
   * always GROUP_RATE_MINUTES (the rate is per child per hour); 0 on a PRODUCT line.
   */
  durationMinutes: number;
  unitPrice: number;
  /** Units on a flat line, the headcount on a GROUP line, meaningless on a session line. */
  quantity: number;
  lineTotal: number;

  /** PRODUCT lines only: the product sold. */
  productId: Types.ObjectId | null;
  /**
   * GROUP lines only: when the visit started and how long it lasted. `visitMinutes` is the
   * time charged for, not the rate denominator - that stays in `durationMinutes`.
   */
  visitAt: Date | null;
  visitMinutes: number | null;

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
   * Only these inputs are stored, not the resulting split: `lineTotal` stays the sole
   * authority on the money, and a stored split that disagreed with it would be a new way
   * for a bill to contradict itself. Because every input is snapshotted, the split is
   * reproduced exactly whenever it is needed for display - see `toPublicItem`.
   *
   * A flat-price line is always PRORATA with no grace, whatever its package says now.
   */
  pricingMode: SessionPricingMode;
  graceMinutes: number;
  /**
   * The hourly rates, overtime and rounding of a TIERED_HOURLY line. Null on every other
   * line. `lineTotal` already includes the rounding.
   */
  tieredPricing: TieredPricing | null;

  /** SUBSCRIPTION lines only. Null on every other line. */
  subscriptionSale: BillItemSubscriptionSaleSubdocument | null;
  /** A ticket paid for with subscription credits. Null on every other line. */
  subscription: BillItemSubscriptionUseSubdocument | null;
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
   * Set only when an admin recorded the payment after the fact, dated to the checkout
   * time - the recovery path for a till checkout that was abandoned before payment.
   * `paidAt` (and so the bill number and the day the revenue counts on) is the checkout
   * time; these record when the payment was actually entered, and by whom, so the gap is
   * visible on the bill itself and not only in the audit log. Null on a normal payment.
   */
  paymentRecordedAt: Date | null;
  paymentRecordedBy: Types.ObjectId | null;
  paymentRecordedByName: string | null;

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

const billItemSubscriptionSaleSchema = new Schema<BillItemSubscriptionSaleSubdocument>(
  {
    planId: { type: Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    visitCredits: { type: Number, required: true, min: 1 },
    visitMinutes: { type: Number, required: true, min: 1 },
    graceMinutes: { type: Number, default: 0, min: 0 },
    extraBlockPrice: { type: Number, required: true, min: 0 },
    maxChildren: { type: Number, default: null },
    children: { type: [String], default: [] },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null },
    code: { type: String, default: null },
    expiresAt: { type: Date, default: null },
  },
  { _id: false },
);

const billItemSubscriptionUseSchema = new Schema<BillItemSubscriptionUseSubdocument>(
  {
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription', required: true },
    code: { type: String, required: true },
    creditsUsed: { type: Number, required: true, min: 0 },
    shortfallBlocks: { type: Number, required: true, min: 0 },
    creditsRemainingAfter: { type: Number, required: true },
    rejectedReason: { type: String, default: null },
  },
  { _id: false },
);

const billItemSchema = new Schema<BillItemSubdocument>(
  {
    kind: { type: String, enum: Object.values(BillItemKind), default: BillItemKind.PLAY },
    // Not `required`: Mongoose rejects an empty string on a required String, and a product
    // sold over the counter has no child.
    childName: { type: String, default: '', trim: true },
    playPackageId: { type: Schema.Types.ObjectId, ref: 'PlayPackage', default: null },
    // Snapshotted at billing time - historical reports must never recompute using the
    // package's current price, since prices change over time.
    packageName: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    lineTotal: { type: Number, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    visitAt: { type: Date, default: null },
    visitMinutes: { type: Number, default: null },
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
    tieredPricing: { type: tieredPricingSchema, default: null },
    subscriptionSale: { type: billItemSubscriptionSaleSchema, default: null },
    subscription: { type: billItemSubscriptionUseSchema, default: null },
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

    paymentRecordedAt: { type: Date, default: null },
    paymentRecordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    paymentRecordedByName: { type: String, default: null },

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
// A family's bills, newest first: the customer profile, its visits and its counters.
billSchema.index({ phoneNumber: 1, paidAt: -1 });
// Default bill listing sort/filter by creation date.
billSchema.index({ createdAt: -1 });
// Payment-method breakdown reports.
billSchema.index({ paymentMethod: 1, paidAt: -1 });
// Every dashboard aggregation now filters test bills out before anything else, so the
// flag leads this index rather than trailing the revenue one - almost all bills are
// real, which makes it the cheapest discriminator to apply first.
billSchema.index({ isTestBill: 1, status: 1, paidAt: -1 });
// The bills list's kind filter, and the product delete check.
billSchema.index({ 'items.kind': 1 });
billSchema.index({ 'items.productId': 1 });

export const BillModel = model<BillDocument>('Bill', billSchema);
