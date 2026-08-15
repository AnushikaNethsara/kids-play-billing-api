import type { PaperWidth } from '../settings/settings.model';
import type { PaymentMethod } from '../../common/constants/paymentMethods';

export interface ReceiptItem {
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
