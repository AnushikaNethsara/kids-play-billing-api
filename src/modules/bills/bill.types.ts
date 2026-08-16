import type { BillStatus, DiscountType } from '../../common/constants/billStatus';
import type { PaymentMethod } from '../../common/constants/paymentMethods';

export interface CreateBillItemInput {
  childName: string;
  playPackageId: string;
  quantity?: number;
}

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
}

export interface CancelBillInput {
  reason: string;
}

export interface RefundBillInput {
  reason: string;
}

export interface BillItemPublic {
  childName: string;
  playPackageId: string;
  packageName: string;
  durationMinutes: number;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** Present only on items billed from a timed play session; null on flat-price items. */
  playSessionId: string | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  billedMinutes: number | null;
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
  sort?: 'newest' | 'oldest' | 'total_desc' | 'total_asc';
}
