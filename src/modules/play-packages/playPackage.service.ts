import { Types } from 'mongoose';
import { playPackageRepository } from './playPackage.repository';
import {
  resolveGraceMinutes,
  resolvePricingMode,
  type PlayPackageHydrated,
} from './playPackage.model';
import { resolveTieredPricing } from './tieredPricing.schema';
import { assertPricingConsistent } from './playPackage.validation';
import {
  DEFAULT_SESSION_PRICING_MODE,
  RoundingMode,
  SessionPricingMode,
  TIER_MINUTES,
  type TieredPricing,
} from '../../common/constants/pricingModes';
import { env } from '../../config';
import type {
  TieredPricingInput,
  CreatePlayPackageInput,
  UpdatePlayPackageInput,
  ListPlayPackagesQuery,
  PlayPackagePublic,
} from './playPackage.types';
import { NotFoundError, ValidationError } from '../../common/errors';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { buildPaginationMeta } from '../../common/utils/pagination';
import type { AuthenticatedUser } from '../../common/types/express';
import { BillModel } from '../bills/bill.model';

function toPublic(pkg: PlayPackageHydrated): PlayPackagePublic {
  return {
    id: pkg.id,
    name: pkg.name,
    durationMinutes: pkg.durationMinutes,
    price: pkg.price,
    pricingMode: resolvePricingMode(pkg),
    graceMinutes: resolveGraceMinutes(pkg),
    tieredPricing: resolveTieredPricing(pkg),
    isActive: pkg.isActive,
    description: pkg.description,
    sortOrder: pkg.sortOrder,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  };
}

/** Fills in the defaults a client may leave out of a tiered config. */
function normaliseTieredPricing(input: TieredPricingInput): TieredPricing {
  return {
    hourlyRates: [...input.hourlyRates],
    overtimeMode: input.overtimeMode,
    overtimeBlockMinutes: input.overtimeBlockMinutes ?? 15,
    roundingStep: input.roundingStep ?? 0,
    roundingMode: input.roundingMode ?? RoundingMode.NEAREST,
  };
}

function sameTieredPricing(a: TieredPricing | null, b: TieredPricing | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Tiered packages stay switched off until every cashier device runs a build that can
 * price them. An older app would show a pro-rata running total for a tiered session.
 * The charge would still be right, because the server prices it, but the screen would not.
 */
function assertTieredPricingEnabled(pricingMode: SessionPricingMode): void {
  if (pricingMode === SessionPricingMode.TIERED_HOURLY && !env.tieredPricingEnabled) {
    throw new ValidationError(
      'Tiered hourly packages are not enabled yet. Set TIERED_PRICING_ENABLED=true once every cashier device is updated.',
    );
  }
}

async function isPackageUsedInBills(packageId: string): Promise<boolean> {
  const count = await BillModel.countDocuments({ 'items.playPackageId': packageId }).exec();
  return count > 0;
}

export const playPackageService = {
  async create(input: CreatePlayPackageInput, actor: AuthenticatedUser): Promise<PlayPackagePublic> {
    const pricingMode = input.pricingMode ?? DEFAULT_SESSION_PRICING_MODE;
    assertTieredPricingEnabled(pricingMode);
    const graceMinutes = input.graceMinutes ?? 0;
    const tieredPricing = input.tieredPricing ? normaliseTieredPricing(input.tieredPricing) : null;
    const isTiered = pricingMode === SessionPricingMode.TIERED_HOURLY;

    // A tiered package's duration and price are derived, so lists and older clients see
    // an hourly package priced "from" its 1st-hour rate.
    const durationMinutes = isTiered ? TIER_MINUTES : (input.durationMinutes as number);
    const price = isTiered && tieredPricing ? tieredPricing.hourlyRates[0] : (input.price as number);
    assertPricingConsistent({ pricingMode, durationMinutes, graceMinutes, tieredPricing });

    const pkg = await playPackageRepository.create({
      name: input.name,
      durationMinutes,
      price,
      pricingMode,
      graceMinutes,
      tieredPricing,
      description: input.description ?? '',
      sortOrder: input.sortOrder ?? 0,
      createdBy: actor.id,
    });

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.PACKAGE_CREATED,
      entityType: AuditEntityType.PLAY_PACKAGE,
      entityId: pkg.id,
      after: toPublic(pkg),
    });

    return toPublic(pkg);
  },

  async list(query: ListPlayPackagesQuery) {
    const { packages, total } = await playPackageRepository.list(
      { isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );

    return {
      packages: packages.map(toPublic),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
    };
  },

  async listActiveForCashier(): Promise<PlayPackagePublic[]> {
    const packages = await playPackageRepository.listAllActive();
    return packages.map(toPublic);
  },

  async getById(id: string): Promise<PlayPackagePublic> {
    const pkg = await playPackageRepository.findById(id);
    if (!pkg) throw new NotFoundError('Play package not found');
    return toPublic(pkg);
  },

  async update(
    id: string,
    input: UpdatePlayPackageInput,
    actor: AuthenticatedUser,
  ): Promise<PlayPackagePublic> {
    const pkg = await playPackageRepository.findById(id);
    if (!pkg) throw new NotFoundError('Play package not found');

    const before = toPublic(pkg);

    // Everything that moves what a visit costs is a price change, not a routine edit.
    // `durationMinutes` always was one - it is the rate denominator - but was only ever
    // logged as PACKAGE_UPDATED; the pricing mode and the grace are the same kind of
    // change, so all of them are audited together now, tiered rates included.
    const nextTieredPricing = input.tieredPricing
      ? normaliseTieredPricing(input.tieredPricing)
      : undefined;
    const pricingChanged =
      (input.price !== undefined && input.price !== pkg.price) ||
      (input.durationMinutes !== undefined && input.durationMinutes !== pkg.durationMinutes) ||
      (input.pricingMode !== undefined && input.pricingMode !== resolvePricingMode(pkg)) ||
      (input.graceMinutes !== undefined && input.graceMinutes !== resolveGraceMinutes(pkg)) ||
      (nextTieredPricing !== undefined &&
        !sameTieredPricing(nextTieredPricing, resolveTieredPricing(pkg)));

    if (input.pricingMode !== undefined && input.pricingMode !== resolvePricingMode(pkg)) {
      assertTieredPricingEnabled(input.pricingMode);
    }

    if (input.name !== undefined) pkg.name = input.name;
    if (input.durationMinutes !== undefined) pkg.durationMinutes = input.durationMinutes;
    if (input.price !== undefined) pkg.price = input.price;
    if (input.pricingMode !== undefined) pkg.pricingMode = input.pricingMode;
    if (input.graceMinutes !== undefined) pkg.graceMinutes = input.graceMinutes;
    if (nextTieredPricing !== undefined) pkg.tieredPricing = nextTieredPricing;

    // Keep the derived fields of a tiered package in step with its tiers.
    const mergedTiered = resolveTieredPricing(pkg);
    if (resolvePricingMode(pkg) === SessionPricingMode.TIERED_HOURLY && mergedTiered) {
      pkg.durationMinutes = TIER_MINUTES;
      pkg.price = mergedTiered.hourlyRates[0];
    }
    if (input.description !== undefined) pkg.description = input.description;
    if (input.sortOrder !== undefined) pkg.sortOrder = input.sortOrder;
    pkg.updatedBy = new Types.ObjectId(actor.id);

    // Checked against the merged document, not the patch: lowering durationMinutes alone
    // can invalidate a grace that was fine when it was saved.
    assertPricingConsistent({
      pricingMode: resolvePricingMode(pkg),
      durationMinutes: pkg.durationMinutes,
      graceMinutes: resolveGraceMinutes(pkg),
      tieredPricing: mergedTiered,
    });

    await pkg.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: pricingChanged ? AuditAction.PACKAGE_PRICE_CHANGED : AuditAction.PACKAGE_UPDATED,
      entityType: AuditEntityType.PLAY_PACKAGE,
      entityId: pkg.id,
      before,
      after: toPublic(pkg),
    });

    return toPublic(pkg);
  },

  async setStatus(id: string, isActive: boolean, actor: AuthenticatedUser): Promise<PlayPackagePublic> {
    const pkg = await playPackageRepository.findById(id);
    if (!pkg) throw new NotFoundError('Play package not found');

    const before = toPublic(pkg);
    pkg.isActive = isActive;
    pkg.updatedBy = new Types.ObjectId(actor.id);
    await pkg.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.PACKAGE_STATUS_CHANGED,
      entityType: AuditEntityType.PLAY_PACKAGE,
      entityId: pkg.id,
      before,
      after: toPublic(pkg),
    });

    return toPublic(pkg);
  },

  /**
   * Packages already referenced by historical bills are deactivated instead of removed,
   * since bill items keep a price/name snapshot that must remain resolvable and reports
   * must not silently lose the package a past bill was billed against.
   */
  async delete(id: string, actor: AuthenticatedUser): Promise<{ softDeleted: boolean }> {
    const pkg = await playPackageRepository.findById(id);
    if (!pkg) throw new NotFoundError('Play package not found');

    const usedInBills = await isPackageUsedInBills(id);

    if (usedInBills) {
      if (pkg.isActive) {
        pkg.isActive = false;
        pkg.updatedBy = new Types.ObjectId(actor.id);
        await pkg.save();

        await auditLogService.record({
          userId: actor.id,
          userName: actor.name,
          action: AuditAction.PACKAGE_STATUS_CHANGED,
          entityType: AuditEntityType.PLAY_PACKAGE,
          entityId: pkg.id,
          metadata: { reason: 'Deactivated instead of deleted - package is referenced by existing bills' },
        });
      }
      return { softDeleted: true };
    }

    await pkg.deleteOne();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.PACKAGE_DELETED,
      entityType: AuditEntityType.PLAY_PACKAGE,
      entityId: id,
      before: toPublic(pkg),
    });

    return { softDeleted: false };
  },
};
