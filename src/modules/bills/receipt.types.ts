import type { PaperWidth } from '../settings/settings.model';
import type { PaymentMethod } from '../../common/constants/paymentMethods';

export interface ReceiptItem {
  childName: string;
  packageName: string;
  durationMinutes: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
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
