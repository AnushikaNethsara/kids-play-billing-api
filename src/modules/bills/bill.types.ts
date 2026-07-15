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
  sort?: 'newest' | 'oldest' | 'total_desc' | 'total_asc';
}
