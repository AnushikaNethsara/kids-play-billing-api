import { settingsRepository } from './settings.repository';
import { resolveMaximumSessionHours, resolveMinimumBillableMinutes } from './settings.model';
import type { UpdateSettingsInput, BusinessSettingsPublic } from './settings.types';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import type { AuthenticatedUser } from '../../common/types/express';

function toPublic(settings: Awaited<ReturnType<typeof settingsRepository.getOrCreate>>): BusinessSettingsPublic {
  return {
    businessName: settings.businessName,
    address: settings.address,
    phoneNumber: settings.phoneNumber,
    receiptHeader: settings.receiptHeader,
    receiptFooter: settings.receiptFooter,
    currency: settings.currency,
    timezone: settings.timezone,
    taxEnabled: settings.taxEnabled,
    taxPercentage: settings.taxPercentage,
    maximumCashierDiscountPercentage: settings.maximumCashierDiscountPercentage,
    receiptPaperWidth: settings.receiptPaperWidth,
    minimumBillableMinutes: resolveMinimumBillableMinutes(settings),
    maximumSessionHours: resolveMaximumSessionHours(settings),
    ticketSlipFooter: settings.ticketSlipFooter ?? '',
    printQrAsRaster: settings.printQrAsRaster ?? false,
    updatedAt: settings.updatedAt,
  };
}

export const settingsService = {
  async get(): Promise<BusinessSettingsPublic> {
    const settings = await settingsRepository.getOrCreate();
    return toPublic(settings);
  },

  /** Returns the raw document for internal use by other services (bills, dashboard). */
  async getRaw() {
    return settingsRepository.getOrCreate();
  },

  async update(input: UpdateSettingsInput, actor: AuthenticatedUser): Promise<BusinessSettingsPublic> {
    const settings = await settingsRepository.getOrCreate();
    const before = toPublic(settings);

    Object.assign(settings, input);
    await settings.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.SETTINGS_UPDATED,
      entityType: AuditEntityType.SETTINGS,
      entityId: settings.id,
      before,
      after: toPublic(settings),
    });

    return toPublic(settings);
  },
};
