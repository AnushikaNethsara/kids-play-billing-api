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
  /** Floor applied to a play session's billed duration, so very short visits still bill sanely. */
  minimumBillableMinutes: number;
  /** Sanity cap on a session's length - bounds a wrong device clock and flags abandoned tickets. */
  maximumSessionHours: number;
  /** Printed at the bottom of the check-in slip the parent keeps. */
  ticketSlipFooter: string;
  /** Printers that do not implement the native GS ( k QR command need a raster bitmap instead. */
  printQrAsRaster: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_MINIMUM_BILLABLE_MINUTES = 15;
export const DEFAULT_MAXIMUM_SESSION_HOURS = 12;

export type BusinessSettingsHydrated = HydratedDocument<BusinessSettingsDocument>;

const businessSettingsSchema = new Schema<BusinessSettingsDocument>(
  {
    businessName: { type: String, default: 'Jellybean Kids Play Zone' },
    address: { type: String, default: 'Badulla Road, Bidunuwewa, Bandarawela' },
    phoneNumber: { type: String, default: '' },
    receiptHeader: { type: String, default: 'WELCOME' },
    receiptFooter: { type: String, default: 'Thank you. Please visit again.' },
    currency: { type: String, default: 'LKR' },
    timezone: { type: String, default: 'Asia/Colombo' },
    taxEnabled: { type: Boolean, default: false },
    taxPercentage: { type: Number, default: 0, min: 0, max: 100 },
    maximumCashierDiscountPercentage: { type: Number, default: 10, min: 0, max: 100 },
    receiptPaperWidth: { type: String, enum: Object.values(PaperWidth), default: PaperWidth['58MM'] },
    minimumBillableMinutes: {
      type: Number,
      default: DEFAULT_MINIMUM_BILLABLE_MINUTES,
      min: 0,
      max: 24 * 60,
    },
    maximumSessionHours: { type: Number, default: DEFAULT_MAXIMUM_SESSION_HOURS, min: 1, max: 168 },
    ticketSlipFooter: { type: String, default: 'Keep this slip - required for checkout.' },
    printQrAsRaster: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/**
 * Settings documents created before play sessions existed have no value stored for these
 * paths. Mongoose applies schema defaults on hydration, but every consumer of these two
 * numbers is doing money arithmetic, so they are read through these helpers rather than
 * trusting that - an `undefined` reaching the pro-rata calculation would produce NaN.
 */
export function resolveMinimumBillableMinutes(settings: Pick<BusinessSettingsDocument, 'minimumBillableMinutes'>): number {
  const value = settings.minimumBillableMinutes;
  return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_MINIMUM_BILLABLE_MINUTES;
}

export function resolveMaximumSessionHours(settings: Pick<BusinessSettingsDocument, 'maximumSessionHours'>): number {
  const value = settings.maximumSessionHours;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_MAXIMUM_SESSION_HOURS;
}

export const BusinessSettingsModel = model<BusinessSettingsDocument>(
  'BusinessSettings',
  businessSettingsSchema,
);
