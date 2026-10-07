import type { BillStatus, DiscountType } from '../../common/constants/billStatus';
import type { SessionPricingMode, TieredPricing } from '../../common/constants/pricingModes';
import type { TierHourLine, TierOvertime } from './billCalculator';
import type { PaymentMethod } from '../../common/constants/paymentMethods';
import type { BillItemKind } from '../../common/constants/billItemKind';

/** A child on a play package at its flat price. `kind` may be omitted - older clients do. */
export interface CreatePlayItemInput {
  kind: typeof BillItemKind.PLAY;
  childName: string;
  playPackageId: string;
  quantity?: number;
}

/**
 * A group visit at a negotiated rate. Priced server-side as
 * `round(ratePerChildPerHour x headcount x visitMinutes / 60)`.
 */
export interface CreateGroupItemInput {
  kind: typeof BillItemKind.GROUP;
  groupName: string;
  headcount: number;
  /** Integer minor units, per child per hour. Entered freely, audited on every bill. */
  ratePerChildPerHour: number;
  visitMinutes: number;
  /** When the visit started. Defaults to now; only an admin may date it in the past. */
  visitAt?: string;
}

/** Something sold over the counter. Priced from the product's current price. */
export interface CreateProductItemInput {
  kind: typeof BillItemKind.PRODUCT;
  productId: string;
  quantity: number;
}

export type CreateBillItemInput = CreatePlayItemInput | CreateGroupItemInput | CreateProductItemInput;

export interface CreateBillDiscountInput {
  type: DiscountType;
  value: number;
}

export interface CreateBillInput {
  customer?: {
    customerId?: string;
    parentName?: string;
    phoneNumber?: string;
  };
  items: CreateBillItemInput[];
  discount?: CreateBillDiscountInput;
  paymentMethod?: PaymentMethod;
  notes?: string;
}

/**
 * Checkout. Identifies sessions by their printed ticket code rather than by database id,
 * which is what lets a device that has been offline since check-in compose a complete
 * checkout payload for a session the server has not seen yet - the sync engine pushes
 * the sessions first, and no id mapping is needed on either side.
 */
export interface CreateBillFromSessionsInput {
  ticketCodes: string[];
  /** Device clock time. Defaults to server time when omitted. */
  checkOutAt?: string;
  discount?: CreateBillDiscountInput;
  customer?: {
    customerId?: string;
    parentName?: string;
    phoneNumber?: string;
  };
  paymentMethod?: PaymentMethod;
  notes?: string;
}

export interface UpdateBillInput {
  customer?: {
    customerId?: string;
    parentName?: string;
    phoneNumber?: string;
  };
  items?: CreateBillItemInput[];
  discount?: CreateBillDiscountInput;
  paymentMethod?: PaymentMethod;
  notes?: string;
}

export interface CompleteBillInput {
  paymentMethod: PaymentMethod;
  paidAmount?: number;
  /**
   * Admin-only. Dates the payment to the bill's checkout time instead of now, so a
   * recovered checkout counts on the day it happened. A flag rather than a timestamp: the
   * server derives the time from the bill itself, so no caller can pick a date.
   */
  backdateToCheckout?: boolean;
}

export interface CancelBillInput {
  reason: string;
}

export interface RefundBillInput {
  reason: string;
}

export interface SetTestBillInput {
  isTestBill: boolean;
  /** Why this was a test. Optional when clearing the flag, since there is nothing to explain. */
  reason?: string;
}

export interface BillItemPublic {
  /** Always present here, resolved to PLAY on lines written before kinds existed. */
  kind: BillItemKind;
  childName: string;
  /** Null on GROUP and PRODUCT lines. */
  playPackageId: string | null;
  packageName: string;
  durationMinutes: number;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** PRODUCT lines only. */
  productId: string | null;
  /** GROUP lines only: when the visit started and how many minutes were charged. */
  visitAt: Date | null;
  visitMinutes: number | null;
  /** Present only on items billed from a timed play session; null on flat-price items. */
  playSessionId: string | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  billedMinutes: number | null;
  /** The rule this line was billed under. Always PRORATA on a flat-price line. */
  pricingMode: SessionPricingMode;
  graceMinutes: number;
  /** The hourly rates, overtime and rounding of a TIERED_HOURLY line. Null otherwise. */
  tieredPricing: TieredPricing | null;
  /**
   * How `lineTotal` splits, derived server-side from the line's own snapshot so no client
   * recomputes it. Null on anything that is not a block- or tier-priced session line.
   */
  blocksCharged: number | null;
  blockSubtotal: number | null;
  overageMinutes: number | null;
  overageAmount: number | null;
  graceApplied: boolean | null;
  /** TIERED_HOURLY only: one entry per whole hour charged. Null on every other line. */
  hourLines: TierHourLine[] | null;
  /** TIERED_HOURLY only: the extra time past grace, or null when there was none. */
  overtime: TierOvertime | null;
  /** TIERED_HOURLY only: the total before rounding. */
  rawTotal: number | null;
  /** TIERED_HOURLY only: `lineTotal - rawTotal`. */
  roundingAdjustment: number | null;
}

export interface BillPublic {
  id: string;
  billNumber: string | null;
  status: BillStatus;
  customerId: string | null;
  parentName: string;
  phoneNumber: string;
  items: BillItemPublic[];
  subtotal: number;
  discount: number;
  discountType: DiscountType;
  discountValue: number;
  tax: number;
  grandTotal: number;
  paidAmount: number;
  balance: number;
  paymentMethod: PaymentMethod | null;
  cashierId: string;
  cashierName: string;
  notes: string;
  paidAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  refundedAt: Date | null;
  refundedBy: string | null;
  refundReason: string | null;
  /** Set only on a payment recorded later by an admin and dated to the checkout time. */
  paymentRecordedAt: Date | null;
  paymentRecordedBy: string | null;
  paymentRecordedByName: string | null;
  /** Excluded from every dashboard figure and from the customer's lifetime spend. */
  isTestBill: boolean;
  testMarkedAt: Date | null;
  testMarkedBy: string | null;
  testReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListBillsQuery {
  page: number;
  limit: number;
  billNumber?: string;
  parentName?: string;
  phoneNumber?: string;
  cashierId?: string;
  status?: BillStatus;
  paymentMethod?: PaymentMethod;
  from?: string;
  to?: string;
  minTotal?: number;
  maxTotal?: number;
  /**
   * Separates time-billed bills from legacy flat-price ones. Both shapes coexist
   * permanently and price completely differently, so being able to report on one without
   * the other matters. A bill is never a mix of the two.
   */
  isTimed?: boolean;
  /** Bills carrying at least one line of this kind. */
  kind?: BillItemKind;
  /**
   * Omitted shows both kinds, which is what the bills screen wants - a test bill is still
   * a real record an admin needs to be able to find. Only the dashboard passes `false`.
   */
  isTestBill?: boolean;
  sort?: 'newest' | 'oldest' | 'total_desc' | 'total_asc';
}
