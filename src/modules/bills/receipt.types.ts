import type { PaperWidth } from '../settings/settings.model';
import type { PaymentMethod } from '../../common/constants/paymentMethods';
import type { BillItemKind } from '../../common/constants/billItemKind';

export interface ReceiptItem {
  /** Selects the layout: a child's play, a group visit, or an over-the-counter sale. */
  kind: BillItemKind;
  /** The child; on a PRODUCT line sold onto a visit, the child it was for. Empty otherwise. */
  childName: string;
  packageName: string;
  durationMinutes: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /**
   * Present only for items billed from a timed play session. Pre-formatted in the
   * business timezone so the renderers - and the mobile app, which reprints from a
   * cached copy - never have to do timezone maths of their own.
   */
  checkInTime?: string;
  checkOutTime?: string;
  billedMinutes?: number;
  /** Human-readable elapsed time, e.g. "1h 17m". */
  billedDuration?: string;
  /**
   * Present only on a block-priced line. Pre-formatted for the same reason the times are:
   * the mobile app reprints from a cached copy and must never work the split out itself.
   * `blockSummary` reads "2 x 1h + 11m", or "1 x 1h (10m free)" while grace is covering it.
   */
  blockSummary?: string;
  overageMinutes?: number;
  overageAmount?: number;
  /**
   * Present only on a TIERED_HOURLY line: one row per hour charged (hours from the 4th on
   * collapsed into one row), then the extra time, each with its amount. Pre-formatted for
   * the same reason as `blockSummary`.
   */
  tierLines?: { label: string; amount: number }[];
  /** TIERED_HOURLY only, and only when non-zero: what rounding added or removed. */
  roundingAdjustment?: number;
  /**
   * GROUP lines only, pre-formatted in the business timezone like the session times:
   * the visit date ("04/10/2026"), start time ("10:00 AM") and length ("2h").
   */
  visitDate?: string;
  visitTime?: string;
  visitDuration?: string;
}

export interface ReceiptData {
  business: {
    name: string;
    address: string;
    phoneNumber: string;
  };
  bill: {
    billNumber: string | null;
    date: string;
    time: string;
    /**
     * yyyy-MM-dd when the payment was recorded later and dated to the checkout; null on a
     * normal payment. Printed so a reprint does not pass off a late entry as a till sale.
     */
    paymentRecordedDate: string | null;
    cashierName: string;
    parentName: string;
    items: ReceiptItem[];
    subtotal: number;
    discount: number;
    tax: number;
    grandTotal: number;
    paidAmount: number;
    balance: number;
    paymentMethod: PaymentMethod | null;
  };
  receipt: {
    paperWidth: PaperWidth;
    header: string;
    footer: string;
    currency: string;
  };
}
