import { Types, type FilterQuery } from 'mongoose';
import {
  CashAdjustmentModel,
  CashAdjustmentStatus,
  type CashAdjustmentDocument,
  type CashAdjustmentHydrated,
} from './cashAdjustment.model';
import type {
  CashAdjustmentListTotals,
  CashAdjustmentPublic,
  CreateCashAdjustmentInput,
  ListCashAdjustmentsQuery,
  UpdateCashAdjustmentInput,
} from './cashAdjustment.types';
import { InvalidStateError, NotFoundError, ValidationError } from '../../common/errors';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { buildPaginationMeta, getSkip } from '../../common/utils/pagination';
import { businessToday, resolveDayRange } from '../../common/utils/dateRange';
import { settingsService } from '../settings/settings.service';
import type { AuthenticatedUser } from '../../common/types/express';

export function toPublicCashAdjustment(adjustment: CashAdjustmentHydrated): CashAdjustmentPublic {
  return {
    id: adjustment.id,
    businessDate: adjustment.businessDate,
    amount: adjustment.amount,
    reason: adjustment.reason,
    notes: adjustment.notes ?? '',
    countedCash: adjustment.countedCash ?? null,
    expectedCash: adjustment.expectedCash ?? null,
    status: adjustment.status,
    voidedAt: adjustment.voidedAt,
    voidedBy: adjustment.voidedBy?.toString() ?? null,
    voidReason: adjustment.voidReason ?? '',
    createdBy: adjustment.createdBy?.toString() ?? null,
    createdByName: adjustment.createdByName ?? '',
    updatedBy: adjustment.updatedBy?.toString() ?? null,
    createdAt: adjustment.createdAt,
    updatedAt: adjustment.updatedAt,
  };
}

/** A drawer can only be counted on a day that has already started. */
async function assertNotFuture(businessDate: string): Promise<void> {
  const settings = await settingsService.getRaw();
  if (businessDate > businessToday(settings.timezone)) {
    throw new ValidationError('A cash adjustment cannot be dated in the future');
  }
}

async function findOrThrow(id: string): Promise<CashAdjustmentHydrated> {
  const adjustment = await CashAdjustmentModel.findById(id).exec();
  if (!adjustment) throw new NotFoundError('Cash adjustment not found');
  return adjustment;
}

async function buildListFilter(
  query: Omit<ListCashAdjustmentsQuery, 'page' | 'limit'>,
): Promise<FilterQuery<CashAdjustmentDocument>> {
  const filter: FilterQuery<CashAdjustmentDocument> = {};
  if (query.status !== 'ALL') filter.status = query.status;
  if (query.kind === 'SURPLUS') filter.amount = { $gt: 0 };
  if (query.kind === 'SHORTAGE') filter.amount = { $lt: 0 };

  // No range at all lists everything; a range uses the same presets as every report.
  if (query.period || query.from || query.to) {
    const settings = await settingsService.getRaw();
    const { fromDay, toDay } = resolveDayRange(settings.timezone, query);
    filter.businessDate = { $gte: fromDay, $lte: toDay };
  }
  return filter;
}

export const cashAdjustmentService = {
  async create(input: CreateCashAdjustmentInput, actor: AuthenticatedUser): Promise<CashAdjustmentPublic> {
    await assertNotFuture(input.businessDate);

    const adjustment = await CashAdjustmentModel.create({
      businessDate: input.businessDate,
      amount: input.amount,
      reason: input.reason,
      notes: input.notes ?? '',
      countedCash: input.countedCash ?? null,
      expectedCash: input.expectedCash ?? null,
      createdBy: actor.id,
      createdByName: actor.name,
      updatedBy: actor.id,
    });

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.CASH_ADJUSTMENT_CREATED,
      entityType: AuditEntityType.CASH_ADJUSTMENT,
      entityId: adjustment.id,
      after: toPublicCashAdjustment(adjustment),
    });

    return toPublicCashAdjustment(adjustment);
  },

  async list(query: ListCashAdjustmentsQuery) {
    const filter = await buildListFilter(query);
    const pagination = { page: query.page, limit: query.limit };

    const [adjustments, total, [sums]] = await Promise.all([
      CashAdjustmentModel.find(filter)
        .sort({ businessDate: -1, createdAt: -1 })
        .skip(getSkip(pagination))
        .limit(pagination.limit)
        .exec(),
      CashAdjustmentModel.countDocuments(filter),
      CashAdjustmentModel.aggregate<{ surplus: number; shortage: number }>([
        { $match: filter },
        {
          $group: {
            _id: null,
            surplus: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
            shortage: { $sum: { $cond: [{ $lt: ['$amount', 0] }, '$amount', 0] } },
          },
        },
      ]),
    ]);

    const surplus = sums?.surplus ?? 0;
    const shortage = sums?.shortage ?? 0;
    const totals: CashAdjustmentListTotals = { surplus, shortage, net: surplus + shortage, count: total };

    return {
      adjustments: adjustments.map(toPublicCashAdjustment),
      meta: { ...buildPaginationMeta(pagination, total), totals },
    };
  },

  async getById(id: string): Promise<CashAdjustmentPublic> {
    return toPublicCashAdjustment(await findOrThrow(id));
  },

  /** Edits are allowed, but each is audited with before and after and shows on the exceptions report. */
  async update(
    id: string,
    input: UpdateCashAdjustmentInput,
    actor: AuthenticatedUser,
  ): Promise<CashAdjustmentPublic> {
    const adjustment = await findOrThrow(id);
    if (adjustment.status !== CashAdjustmentStatus.ACTIVE) {
      throw new InvalidStateError('A voided cash adjustment cannot be edited');
    }
    if (input.businessDate !== undefined) await assertNotFuture(input.businessDate);

    const before = toPublicCashAdjustment(adjustment);

    if (input.businessDate !== undefined) adjustment.businessDate = input.businessDate;
    if (input.amount !== undefined) adjustment.amount = input.amount;
    if (input.reason !== undefined) adjustment.reason = input.reason;
    if (input.notes !== undefined) adjustment.notes = input.notes;
    if (input.countedCash !== undefined) adjustment.countedCash = input.countedCash ?? null;
    if (input.expectedCash !== undefined) adjustment.expectedCash = input.expectedCash ?? null;
    adjustment.updatedBy = new Types.ObjectId(actor.id);
    await adjustment.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.CASH_ADJUSTMENT_UPDATED,
      entityType: AuditEntityType.CASH_ADJUSTMENT,
      entityId: adjustment.id,
      before,
      after: toPublicCashAdjustment(adjustment),
    });

    return toPublicCashAdjustment(adjustment);
  },

  /** Compare-and-set out of ACTIVE, so two admins voiding at once record one void. */
  async void(id: string, reason: string, actor: AuthenticatedUser): Promise<CashAdjustmentPublic> {
    const before = await findOrThrow(id);
    const voided = await CashAdjustmentModel.findOneAndUpdate(
      { _id: before._id, status: CashAdjustmentStatus.ACTIVE },
      {
        $set: {
          status: CashAdjustmentStatus.VOIDED,
          voidedAt: new Date(),
          voidedBy: new Types.ObjectId(actor.id),
          voidReason: reason,
          updatedBy: new Types.ObjectId(actor.id),
        },
      },
      { new: true },
    ).exec();
    if (!voided) throw new InvalidStateError('Cash adjustment is already voided');

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.CASH_ADJUSTMENT_VOIDED,
      entityType: AuditEntityType.CASH_ADJUSTMENT,
      entityId: voided.id,
      before: toPublicCashAdjustment(before),
      after: toPublicCashAdjustment(voided),
      metadata: { reason },
    });

    return toPublicCashAdjustment(voided);
  },
};
