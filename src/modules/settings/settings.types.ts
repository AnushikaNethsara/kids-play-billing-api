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
  minimumBillableMinutes?: number;
  maximumSessionHours?: number;
  ticketSlipFooter?: string;
  printQrAsRaster?: boolean;
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
  minimumBillableMinutes: number;
  maximumSessionHours: number;
  ticketSlipFooter: string;
  printQrAsRaster: boolean;
  updatedAt: Date;
}
