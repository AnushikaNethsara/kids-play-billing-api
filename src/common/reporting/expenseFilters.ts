import { DateTime } from 'luxon';
import { ExpenseModel, ExpenseStatus } from '../../modules/expenses/expense.model';
import { PaymentMethod } from '../constants/paymentMethods';
import { formatBusinessDate } from '../utils/dateRange';

/**
 * The one definition of "expenses" every profit figure uses: active (not voided)
 * expenses dated inside an inclusive business-day range. Cash basis - an expense counts
 * on the day it is dated, whatever period it paid for.
 */
export function activeExpensesMatch(fromDay: string, toDay: string) {
  return { status: ExpenseStatus.ACTIVE, spentOn: { $gte: fromDay, $lte: toDay } };
}

/** An instant range resolved in the business timezone, as the business days it covers. */
export function toDayRange(start: Date, end: Date, timezone: string): { fromDay: string; toDay: string } {
  return { fromDay: formatBusinessDate(start, timezone), toDay: formatBusinessDate(end, timezone) };
}

export interface ExpenseTotals {
  /** Integer minor units. */
  total: number;
  count: number;
  /** The part paid in cash - money that left the drawer. */
  cashAmount: number;
}

export async function expenseTotals(fromDay: string, toDay: string): Promise<ExpenseTotals> {
  const [row] = await ExpenseModel.aggregate<ExpenseTotals>([
    { $match: activeExpensesMatch(fromDay, toDay) },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
        count: { $sum: 1 },
        cashAmount: { $sum: { $cond: [{ $eq: ['$paymentMethod', PaymentMethod.CASH] }, '$amount', 0] } },
      },
    },
  ]);
  return { total: row?.total ?? 0, count: row?.count ?? 0, cashAmount: row?.cashAmount ?? 0 };
}

export interface ExpenseCategoryRow {
  categoryId: string;
  /** The most recent name an expense in range was filed under. */
  categoryName: string;
  amount: number;
  count: number;
}

/** Grouped by category id, so a renamed category still lands on one row. Largest first. */
export async function expensesByCategory(fromDay: string, toDay: string): Promise<ExpenseCategoryRow[]> {
  const rows = await ExpenseModel.aggregate<{ _id: unknown; categoryName: string; amount: number; count: number }>([
    { $match: activeExpensesMatch(fromDay, toDay) },
    { $sort: { spentOn: 1, createdAt: 1 } },
    {
      $group: {
        _id: '$categoryId',
        categoryName: { $last: '$categoryName' },
        amount: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { amount: -1, categoryName: 1 } },
  ]);
  return rows.map((row) => ({
    categoryId: String(row._id),
    categoryName: row.categoryName,
    amount: row.amount,
    count: row.count,
  }));
}

/** Expense totals per business day (`YYYY-MM-DD`), for bucketing by day, week, month or year. */
export async function expensesByDay(
  fromDay: string,
  toDay: string,
): Promise<Array<{ day: string; amount: number; cashAmount: number }>> {
  const rows = await ExpenseModel.aggregate<{ _id: string; amount: number; cashAmount: number }>([
    { $match: activeExpensesMatch(fromDay, toDay) },
    {
      $group: {
        _id: '$spentOn',
        amount: { $sum: '$amount' },
        cashAmount: { $sum: { $cond: [{ $eq: ['$paymentMethod', PaymentMethod.CASH] }, '$amount', 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((row) => ({ day: row._id, amount: row.amount, cashAmount: row.cashAmount }));
}

/**
 * The bucket label a business day falls in, matching the labels the bill aggregates write
 * (`%Y-%m-%d`, `%G-W%V`, `%Y-%m`, `%Y`).
 */
export function dayToBucketLabel(day: string, groupBy: 'day' | 'week' | 'month' | 'year'): string {
  switch (groupBy) {
    case 'day':
      return day;
    case 'month':
      return day.slice(0, 7);
    case 'year':
      return day.slice(0, 4);
    case 'week':
      return DateTime.fromISO(day).toFormat("kkkk-'W'WW");
  }
}

/**
 * Profit as a share of net revenue, in basis points (an integer: 2550 = 25.50%). Null
 * when there is no revenue to divide by.
 */
export function profitMarginBasisPoints(netProfit: number, netRevenue: number): number | null {
  if (netRevenue <= 0) return null;
  return Math.round((netProfit * 10000) / netRevenue);
}
