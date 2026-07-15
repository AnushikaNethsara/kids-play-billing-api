import { Types } from 'mongoose';
import { billRepository } from './bill.repository';
import { billNumberService } from './billNumber.service';
import { playPackageRepository } from '../play-packages/playPackage.repository';
import { customerService } from '../customers/customer.service';
import { settingsService } from '../settings/settings.service';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { BillStatus, DiscountType } from '../../common/constants/billStatus';
import { UserRole } from '../../common/constants/roles';
import {
  AuthorizationError,
  InvalidStateError,
  NotFoundError,
  PaymentError,
  ValidationError,
} from '../../common/errors';
import { InvalidPlayPackageError } from './bill.errors';
import {
  calculateBillTotals,
  isDiscountAboveThreshold,
  validateDiscountPermission,
} from './billCalculator';
import type { BillHydrated, BillItemSubdocument } from './bill.model';
import type {
  BillPublic,
  BillItemPublic,
  CreateBillInput,
  UpdateBillInput,
  CompleteBillInput,
  CancelBillInput,
  RefundBillInput,
  ListBillsQuery,
} from './bill.types';
import type { AuthenticatedUser } from '../../common/types/express';
import { buildPaginationMeta } from '../../common/utils/pagination';

function toPublicItem(item: BillItemSubdocument): BillItemPublic {
  return {
    childName: item.childName,
    playPackageId: item.playPackageId.toString(),
    packageName: item.packageName,
    durationMinutes: item.durationMinutes,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
  };
}

export function toPublicBill(bill: BillHydrated): BillPublic {
  return {
    id: bill.id,
    billNumber: bill.billNumber,
    status: bill.status,
    customerId: bill.customerId ? bill.customerId.toString() : null,
    parentName: bill.parentName,
    phoneNumber: bill.phoneNumber,
    items: bill.items.map(toPublicItem),
    subtotal: bill.subtotal,
    discount: bill.discount,
    discountType: bill.discountType,
    discountValue: bill.discountValue,
    tax: bill.tax,
    grandTotal: bill.grandTotal,
    paidAmount: bill.paidAmount,
    balance: bill.balance,
    paymentMethod: bill.paymentMethod,
    cashierId: bill.cashierId.toString(),
    cashierName: bill.cashierName,
    notes: bill.notes,
    paidAt: bill.paidAt,
    cancelledAt: bill.cancelledAt,
    cancelledBy: bill.cancelledBy ? bill.cancelledBy.toString() : null,
    cancellationReason: bill.cancellationReason,
    refundedAt: bill.refundedAt,
    refundedBy: bill.refundedBy ? bill.refundedBy.toString() : null,
    refundReason: bill.refundReason,
    createdAt: bill.createdAt,
    updatedAt: bill.updatedAt,
  };
}

async function buildItemSnapshots(items: CreateBillInput['items']): Promise<BillItemSubdocument[]> {
  if (!items || items.length === 0) {
    throw new ValidationError('At least one bill item is required');
  }

  const snapshots: BillItemSubdocument[] = [];

  for (const item of items) {
    const pkg = await playPackageRepository.findById(item.playPackageId);
    if (!pkg) {
      throw new InvalidPlayPackageError('The selected play package does not exist');
    }
    if (!pkg.isActive) {
      throw new InvalidPlayPackageError('The selected play package is not currently available');
    }

    const quantity = item.quantity ?? 1;
    if (quantity < 1) {
      throw new ValidationError('Quantity must be at least 1');
    }

    snapshots.push({
      childName: item.childName,
      playPackageId: pkg._id,
      packageName: pkg.name,
      durationMinutes: pkg.durationMinutes,
      unitPrice: pkg.price,
      quantity,
      lineTotal: pkg.price * quantity,
    } as BillItemSubdocument);
  }

  return snapshots;
}

export const billService = {
  async createDraft(input: CreateBillInput, actor: AuthenticatedUser): Promise<BillPublic> {
    const settings = await settingsService.getRaw();
    const items = await buildItemSnapshots(input.items);

    const discountType = input.discount?.type ?? DiscountType.NONE;
    const discountValue = input.discount?.value ?? 0;

    const preDiscountTotals = calculateBillTotals({
      items,
      discountType: DiscountType.NONE,
      discountValue: 0,
      taxEnabled: false,
      taxPercentage: 0,
    });

    validateDiscountPermission({
      role: actor.role,
      subtotal: preDiscountTotals.subtotal,
      discountType,
      discountValue,
      maximumCashierDiscountPercentage: settings.maximumCashierDiscountPercentage,
    });

    const totals = calculateBillTotals({
      items,
      discountType,
      discountValue,
      taxEnabled: settings.taxEnabled,
      taxPercentage: settings.taxPercentage,
    });

    const bill = await billRepository.create({
      status: BillStatus.DRAFT,
      customerId: input.customer?.customerId ? new Types.ObjectId(input.customer.customerId) : null,
      parentName: input.customer?.parentName ?? '',
      phoneNumber: input.customer?.phoneNumber ?? '',
      items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      discountType,
      discountValue,
      tax: totals.tax,
      grandTotal: totals.grandTotal,
      paymentMethod: input.paymentMethod ?? null,
      // The cashier is always taken from the authenticated session - any cashier
      // identifier sent by the client is ignored to prevent bills being attributed
      // to someone other than the person who is actually operating the till.
      cashierId: new Types.ObjectId(actor.id),
      cashierName: actor.name,
      notes: input.notes ?? '',
    });

    return toPublicBill(bill);
  },

  async updateDraft(id: string, input: UpdateBillInput, actor: AuthenticatedUser): Promise<BillPublic> {
    const bill = await this.getById(id);

    if (bill.status !== BillStatus.DRAFT) {
      throw new InvalidStateError('Only draft bills can be updated');
    }

    if (actor.role === UserRole.CASHIER && bill.cashierId.toString() !== actor.id) {
      throw new AuthorizationError('Cashiers may only update their own draft bills');
    }

    const settings = await settingsService.getRaw();

    if (input.customer) {
      if (input.customer.customerId !== undefined) {
        bill.customerId = input.customer.customerId ? new Types.ObjectId(input.customer.customerId) : null;
      }
      if (input.customer.parentName !== undefined) bill.parentName = input.customer.parentName;
      if (input.customer.phoneNumber !== undefined) bill.phoneNumber = input.customer.phoneNumber;
    }
    if (input.paymentMethod !== undefined) bill.paymentMethod = input.paymentMethod;
    if (input.notes !== undefined) bill.notes = input.notes;

    if (input.items) {
      bill.items = await buildItemSnapshots(input.items);
    }

    const discountType = input.discount?.type ?? bill.discountType;
    const discountValue = input.discount?.value ?? bill.discountValue;

    const preDiscountTotals = calculateBillTotals({
      items: bill.items,
      discountType: DiscountType.NONE,
      discountValue: 0,
      taxEnabled: false,
      taxPercentage: 0,
    });

    validateDiscountPermission({
      role: actor.role,
      subtotal: preDiscountTotals.subtotal,
      discountType,
      discountValue,
      maximumCashierDiscountPercentage: settings.maximumCashierDiscountPercentage,
    });

    const totals = calculateBillTotals({
      items: bill.items,
      discountType,
      discountValue,
      taxEnabled: settings.taxEnabled,
      taxPercentage: settings.taxPercentage,
    });

    bill.discountType = discountType;
    bill.discountValue = discountValue;
    bill.subtotal = totals.subtotal;
    bill.discount = totals.discount;
    bill.tax = totals.tax;
    bill.grandTotal = totals.grandTotal;

    await bill.save();

    return toPublicBill(bill);
  },

  async getById(id: string): Promise<BillHydrated> {
    const bill = await billRepository.findById(id);
    if (!bill) throw new NotFoundError('Bill not found');
    return bill;
  },

  async getPublicById(id: string): Promise<BillPublic> {
    return toPublicBill(await this.getById(id));
  },

  async getByBillNumber(billNumber: string): Promise<BillPublic> {
    const bill = await billRepository.findByBillNumber(billNumber);
    if (!bill) throw new NotFoundError('Bill not found');
    return toPublicBill(bill);
  },

  async list(query: ListBillsQuery) {
    const { bills, total } = await billRepository.list(query);
    return {
      bills: bills.map(toPublicBill),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
    };
  },

  /**
   * The core financial write. Recomputes totals from the bill's own stored item
   * snapshots and current settings rather than trusting anything the caller sends,
   * then atomically transitions DRAFT -> PAID so this can never run twice for the
   * same bill even under concurrent retries.
   */
  async completeBill(
    id: string,
    input: CompleteBillInput,
    actor: AuthenticatedUser,
  ): Promise<BillPublic> {
    const bill = await this.getById(id);

    if (bill.status !== BillStatus.DRAFT) {
      throw new InvalidStateError('Only draft bills can be completed');
    }

    const settings = await settingsService.getRaw();

    const totals = calculateBillTotals({
      items: bill.items,
      discountType: bill.discountType,
      discountValue: bill.discountValue,
      taxEnabled: settings.taxEnabled,
      taxPercentage: settings.taxPercentage,
    });

    const paidAmount = input.paidAmount ?? totals.grandTotal;
    if (paidAmount < totals.grandTotal) {
      throw new PaymentError('Paid amount is less than the grand total');
    }
    const balance = paidAmount - totals.grandTotal;

    const billNumber = await billNumberService.generate(settings.timezone);
    const paidAt = new Date();

    const updated = await billRepository.completeIfDraft(id, {
      billNumber,
      status: BillStatus.PAID,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      grandTotal: totals.grandTotal,
      paidAmount,
      balance,
      paymentMethod: input.paymentMethod,
      paidAt,
    });

    if (!updated) {
      throw new InvalidStateError('Bill is no longer in draft status - it may have already been completed');
    }

    if (isDiscountAboveThreshold(totals.subtotal, bill.discountType, bill.discountValue, settings.maximumCashierDiscountPercentage)) {
      await auditLogService.record({
        userId: actor.id,
        userName: actor.name,
        action: AuditAction.BILL_DISCOUNT_ABOVE_THRESHOLD,
        entityType: AuditEntityType.BILL,
        entityId: updated.id,
        metadata: {
          discountType: bill.discountType,
          discountValue: bill.discountValue,
          subtotal: totals.subtotal,
          discount: totals.discount,
          thresholdPercentage: settings.maximumCashierDiscountPercentage,
        },
      });
    }

    if (updated.customerId || updated.phoneNumber) {
      await customerService.recordVisit(
        {
          id: updated.customerId ? updated.customerId.toString() : undefined,
          parentName: updated.parentName || undefined,
          phoneNumber: updated.phoneNumber || undefined,
        },
        totals.grandTotal,
        paidAt,
      );
    }

    return toPublicBill(updated);
  },

  async cancelBill(id: string, input: CancelBillInput, actor: AuthenticatedUser): Promise<BillPublic> {
    const bill = await this.getById(id);

    let allowedStatuses: BillStatus[];
    if (actor.role === UserRole.CASHIER) {
      if (bill.cashierId.toString() !== actor.id) {
        throw new AuthorizationError('Cashiers may only cancel their own bills');
      }
      allowedStatuses = [BillStatus.DRAFT];
    } else {
      allowedStatuses = [BillStatus.DRAFT, BillStatus.PAID];
    }

    if (!allowedStatuses.includes(bill.status)) {
      throw new InvalidStateError('This bill cannot be cancelled from its current status');
    }

    const before = toPublicBill(bill);

    const updated = await billRepository.transitionIfStatusIn(id, allowedStatuses, {
      status: BillStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelledBy: new Types.ObjectId(actor.id),
      cancellationReason: input.reason,
    });

    if (!updated) {
      throw new InvalidStateError('This bill cannot be cancelled from its current status');
    }

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.BILL_CANCELLED,
      entityType: AuditEntityType.BILL,
      entityId: updated.id,
      before,
      after: toPublicBill(updated),
      metadata: { reason: input.reason },
    });

    return toPublicBill(updated);
  },

  async refundBill(id: string, input: RefundBillInput, actor: AuthenticatedUser): Promise<BillPublic> {
    const bill = await this.getById(id);

    if (bill.status !== BillStatus.PAID) {
      throw new InvalidStateError('Only paid bills can be refunded');
    }

    const before = toPublicBill(bill);

    const updated = await billRepository.transitionIfStatusIn(id, [BillStatus.PAID], {
      status: BillStatus.REFUNDED,
      refundedAt: new Date(),
      refundedBy: new Types.ObjectId(actor.id),
      refundReason: input.reason,
    });

    if (!updated) {
      throw new InvalidStateError('Only paid bills can be refunded, or this bill was already refunded');
    }

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.BILL_REFUNDED,
      entityType: AuditEntityType.BILL,
      entityId: updated.id,
      before,
      after: toPublicBill(updated),
      metadata: { reason: input.reason },
    });

    return toPublicBill(updated);
  },
};
