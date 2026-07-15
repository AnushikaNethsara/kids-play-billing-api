import { Types } from 'mongoose';
import { playPackageRepository } from './playPackage.repository';
import type { PlayPackageHydrated } from './playPackage.model';
import type {
  CreatePlayPackageInput,
  UpdatePlayPackageInput,
  ListPlayPackagesQuery,
  PlayPackagePublic,
} from './playPackage.types';
import { NotFoundError } from '../../common/errors';
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
    isActive: pkg.isActive,
    description: pkg.description,
    sortOrder: pkg.sortOrder,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  };
}

async function isPackageUsedInBills(packageId: string): Promise<boolean> {
  const count = await BillModel.countDocuments({ 'items.playPackageId': packageId }).exec();
  return count > 0;
}

export const playPackageService = {
  async create(input: CreatePlayPackageInput, actor: AuthenticatedUser): Promise<PlayPackagePublic> {
    const pkg = await playPackageRepository.create({
      name: input.name,
      durationMinutes: input.durationMinutes,
      price: input.price,
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
    const priceChanged = input.price !== undefined && input.price !== pkg.price;

    if (input.name !== undefined) pkg.name = input.name;
    if (input.durationMinutes !== undefined) pkg.durationMinutes = input.durationMinutes;
    if (input.price !== undefined) pkg.price = input.price;
    if (input.description !== undefined) pkg.description = input.description;
    if (input.sortOrder !== undefined) pkg.sortOrder = input.sortOrder;
    pkg.updatedBy = new Types.ObjectId(actor.id);

    await pkg.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: priceChanged ? AuditAction.PACKAGE_PRICE_CHANGED : AuditAction.PACKAGE_UPDATED,
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
