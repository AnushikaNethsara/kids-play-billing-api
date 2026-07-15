import type { PaperWidth } from './settings.model';

export interface UpdateSettingsInput {
  businessName?: string;
  address?: string;
  phoneNumber?: string;
  receiptHeader?: string;
  receiptFooter?: string;
  currency?: string;
  timezone?: string;
  taxEnabled?: boolean;
  taxPercentage?: number;
  maximumCashierDiscountPercentage?: number;
  receiptPaperWidth?: PaperWidth;
}

export interface BusinessSettingsPublic extends UpdateSettingsInput {
  businessName: string;
  address: string;
  phoneNumber: string;
  receiptHeader: string;
  receiptFooter: string;
  currency: string;
  timezone: string;
  taxEnabled: boolean;
  taxPercentage: number;
  maximumCashierDiscountPercentage: number;
  receiptPaperWidth: PaperWidth;
  updatedAt: Date;
}
