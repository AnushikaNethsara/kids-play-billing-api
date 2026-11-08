import type { CashAdjustmentStatus } from './cashAdjustment.model';

export interface CashAdjustmentPublic {
  id: string;
  businessDate: string;
  /** Signed minor units: + surplus, - shortage. */
  amount: number;
  reason: string;
  notes: string;
  countedCash: number | null;
  expectedCash: number | null;
  status: CashAdjustmentStatus;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string;
  createdBy: string | null;
  createdByName: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCashAdjustmentInput {
  businessDate: string;
  amount: number;
  reason: string;
  notes?: string;
  countedCash?: number | null;
  expectedCash?: number | null;
}

export type UpdateCashAdjustmentInput = Partial<CreateCashAdjustmentInput>;

export interface ListCashAdjustmentsQuery {
  page: number;
  limit: number;
  period?: string;
  from?: string;
  to?: string;
  status: CashAdjustmentStatus | 'ALL';
  kind?: 'SURPLUS' | 'SHORTAGE';
}

export interface CashAdjustmentListTotals {
  /** Sum of surpluses (positive or 0). */
  surplus: number;
  /** Sum of shortages (negative or 0). */
  shortage: number;
  /** surplus + shortage. */
  net: number;
  count: number;
}
