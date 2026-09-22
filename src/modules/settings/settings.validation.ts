import { z } from 'zod';
import { PaperWidth } from './settings.model';

export const updateSettingsSchema = z
  .object({
    businessName: z.string().trim().min(1).max(200).optional(),
    address: z.string().trim().max(300).optional(),
    phoneNumber: z.string().trim().max(30).optional(),
    receiptHeader: z.string().trim().max(200).optional(),
    receiptFooter: z.string().trim().max(200).optional(),
    currency: z.string().trim().length(3).optional(),
    timezone: z.string().trim().min(1).optional(),
    taxEnabled: z.boolean().optional(),
    taxPercentage: z.number().min(0).max(100).optional(),
    maximumCashierDiscountPercentage: z.number().min(0).max(100).optional(),
    receiptPaperWidth: z.nativeEnum(PaperWidth).optional(),
    minimumBillableMinutes: z.number().int().min(0).max(24 * 60).optional(),
    maximumSessionHours: z.number().int().min(1).max(168).optional(),
    ticketSlipFooter: z.string().trim().max(200).optional(),
    printQrAsRaster: z.boolean().optional(),
    // Data URL preview (~150x150-ish PNG) and packed 1bpp raster, both produced client-side.
    // Generous but bounded caps - defense in depth against an oversized upload, not a tight
    // budget; the browser is already resizing before either ever reaches here.
    logoImageBase64: z.string().max(400_000).optional(),
    logoRasterBase64: z.string().max(150_000).optional(),
    logoRasterWidthDots: z.number().int().min(0).max(1024).optional(),
    logoRasterHeightDots: z.number().int().min(0).max(2000).optional(),
    showLogoOnReceipt: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });
