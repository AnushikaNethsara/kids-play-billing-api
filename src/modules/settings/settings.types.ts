import type { MultiChildDiscountTier, PaperWidth } from './settings.model';

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
  logoImageBase64?: string;
  logoRasterBase64?: string;
  logoRasterWidthDots?: number;
  logoRasterHeightDots?: number;
  showLogoOnReceipt?: boolean;
  /** Every Nth visit is flagged as reward due. 0 = off. */
  loyaltyVisitInterval?: number;
  /** Automatic play-time discount by children on the bill. Empty = off. */
  multiChildDiscountTiers?: MultiChildDiscountTier[];
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
  logoImageBase64: string;
  logoRasterBase64: string;
  logoRasterWidthDots: number;
  logoRasterHeightDots: number;
  showLogoOnReceipt: boolean;
  loyaltyVisitInterval: number;
  multiChildDiscountTiers: MultiChildDiscountTier[];
  updatedAt: Date;
}
