import type { PaymentMethod } from '../../common/constants/paymentMethods';
import type { ExpenseStatus } from './expense.model';

export interface ExpenseCategoryPublic {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpensePublic {
  id: string;
  spentOn: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  description: string;
  vendor: string;
  reference: string;
  paymentMethod: PaymentMethod;
  status: ExpenseStatus;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExpenseInput {
  spentOn: string;
  amount: number;
  categoryId: string;
  description?: string;
  vendor?: string;
  reference?: string;
  paymentMethod: PaymentMethod;
}

export type UpdateExpenseInput = Partial<CreateExpenseInput>;

export interface ListExpensesQuery {
  page: number;
  limit: number;
  period?: string;
  from?: string;
  to?: string;
  categoryId?: string;
  paymentMethod?: PaymentMethod;
  status: ExpenseStatus | 'ALL';
}

export interface CreateExpenseCategoryInput {
  name: string;
  sortOrder?: number;
}

export interface UpdateExpenseCategoryInput {
  name?: string;
  sortOrder?: number;
  isActive?: boolean;
}
