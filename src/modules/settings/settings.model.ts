import { Schema, model, type HydratedDocument } from 'mongoose';

export const PaperWidth = {
  '58MM': '58MM',
  '80MM': '80MM',
} as const;
export type PaperWidth = (typeof PaperWidth)[keyof typeof PaperWidth];

export interface BusinessSettingsDocument {
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
  createdAt: Date;
  updatedAt: Date;
}

export type BusinessSettingsHydrated = HydratedDocument<BusinessSettingsDocument>;

const businessSettingsSchema = new Schema<BusinessSettingsDocument>(
  {
    businessName: { type: String, default: 'Happy Kids Play Area' },
    address: { type: String, default: 'Colombo, Sri Lanka' },
    phoneNumber: { type: String, default: '' },
    receiptHeader: { type: String, default: 'WELCOME' },
    receiptFooter: { type: String, default: 'Thank you. Please visit again.' },
    currency: { type: String, default: 'LKR' },
    timezone: { type: String, default: 'Asia/Colombo' },
    taxEnabled: { type: Boolean, default: false },
    taxPercentage: { type: Number, default: 0, min: 0, max: 100 },
    maximumCashierDiscountPercentage: { type: Number, default: 10, min: 0, max: 100 },
    receiptPaperWidth: { type: String, enum: Object.values(PaperWidth), default: PaperWidth['58MM'] },
  },
  { timestamps: true },
);

export const BusinessSettingsModel = model<BusinessSettingsDocument>(
  'BusinessSettings',
  businessSettingsSchema,
);
