import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createExpenseCategory, createPlayPackage } from './helpers/factories';
import { AuditLogModel } from '../src/modules/audit-logs/auditLog.model';
import { ExpenseCategoryModel } from '../src/modules/expenses/expenseCategory.model';

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';

function businessDate(daysAgo = 0): string {
  return DateTime.now().setZone(TIMEZONE).minus({ days: daysAgo }).toISODate() as string;
}

function get(path: string, token: string) {
  return request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`);
}

function post(path: string, token: string, body: object) {
  return request(app).post(`${API}${path}`).set('Authorization', `Bearer ${token}`).send(body);
}

function patch(path: string, token: string, body: object) {
  return request(app).patch(`${API}${path}`).set('Authorization', `Bearer ${token}`).send(body);
}

async function addExpense(
  token: string,
  categoryId: string,
  overrides: Partial<{ spentOn: string; amount: number; paymentMethod: string; description: string }> = {},
) {
  const res = await post('/expenses', token, {
    spentOn: overrides.spentOn ?? businessDate(),
    amount: overrides.amount ?? 500000,
    categoryId,
    paymentMethod: overrides.paymentMethod ?? 'CASH',
    description: overrides.description ?? 'Electricity bill',
  });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; amount: number; categoryName: string; status: string };
}

async function payCashBill(token: string, playPackageId: string) {
  const draft = await post('/bills', token, {
    items: [{ childName: 'Child', playPackageId, quantity: 1 }],
    customer: { parentName: 'Nimal Perera', phoneNumber: '0771234567' },
    paymentMethod: 'CASH',
  });
  expect(draft.status).toBe(201);
  const paid = await post(`/bills/${draft.body.data.id}/complete`, token, { paymentMethod: 'CASH' });
  expect(paid.status).toBe(200);
  return paid.body.data.bill as { grandTotal: number };
}

describe('expenses', () => {
  describe('access', () => {
    it('is admin-only', async () => {
      const { accessToken } = await createCashier();
      const category = await createExpenseCategory();

      expect((await get('/expenses', accessToken)).status).toBe(403);
      expect((await get('/expense-categories', accessToken)).status).toBe(403);
      expect((await get(`/reports/profit-loss?from=${businessDate()}&to=${businessDate()}`, accessToken)).status).toBe(
        403,
      );
      const create = await post('/expenses', accessToken, {
        spentOn: businessDate(),
        amount: 100,
        categoryId: category.id,
        paymentMethod: 'CASH',
      });
      expect(create.status).toBe(403);
    });
  });

  describe('recording', () => {
    it('creates an expense with a snapshot of the category name and audits it', async () => {
      const { accessToken } = await createAdmin();
      const category = await createExpenseCategory({ name: 'Utilities' });

      const expense = await addExpense(accessToken, category.id, { amount: 1234500 });

      expect(expense.amount).toBe(1234500);
      expect(expense.categoryName).toBe('Utilities');
      expect(expense.status).toBe('ACTIVE');
      expect(await AuditLogModel.countDocuments({ action: 'EXPENSE_CREATED', entityId: expense.id })).toBe(1);
    });

    it('refuses non-integer, zero and negative amounts', async () => {
      const { accessToken } = await createAdmin();
      const category = await createExpenseCategory();
      for (const amount of [12.5, 0, -100]) {
        const res = await post('/expenses', accessToken, {
          spentOn: businessDate(),
          amount,
          categoryId: category.id,
          paymentMethod: 'CASH',
        });
        expect(res.status).toBe(400);
      }
    });

    it('refuses a future date and an inactive category', async () => {
      const { accessToken } = await createAdmin();
      const active = await createExpenseCategory();
      const inactive = await createExpenseCategory({ isActive: false });

      const future = DateTime.now().setZone(TIMEZONE).plus({ days: 2 }).toISODate();
      const futureRes = await post('/expenses', accessToken, {
        spentOn: future,
        amount: 100,
        categoryId: active.id,
        paymentMethod: 'CASH',
      });
      expect(futureRes.status).toBe(400);

      const inactiveRes = await post('/expenses', accessToken, {
        spentOn: businessDate(),
        amount: 100,
        categoryId: inactive.id,
        paymentMethod: 'CASH',
      });
      expect(inactiveRes.status).toBe(409);
    });

    it('lists by range with the filtered total in meta', async () => {
      const { accessToken } = await createAdmin();
      const category = await createExpenseCategory();
      await addExpense(accessToken, category.id, { amount: 1000, spentOn: businessDate() });
      await addExpense(accessToken, category.id, { amount: 2000, spentOn: businessDate() });
      await addExpense(accessToken, category.id, { amount: 4000, spentOn: businessDate(10) });

      const today = await get(`/expenses?from=${businessDate()}&to=${businessDate()}`, accessToken);
      expect(today.status).toBe(200);
      expect(today.body.data).toHaveLength(2);
      expect(today.body.meta.totals).toEqual({ amount: 3000, count: 2 });

      const all = await get('/expenses', accessToken);
      expect(all.body.meta.totals).toEqual({ amount: 7000, count: 3 });
    });
  });

  describe('edit and void', () => {
    it('edits an active expense and audits before and after', async () => {
      const { accessToken } = await createAdmin();
      const category = await createExpenseCategory();
      const expense = await addExpense(accessToken, category.id, { amount: 1000 });

      const res = await patch(`/expenses/${expense.id}`, accessToken, { amount: 1500 });
      expect(res.status).toBe(200);
      expect(res.body.data.amount).toBe(1500);

      const log = await AuditLogModel.findOne({ action: 'EXPENSE_UPDATED', entityId: expense.id }).lean();
      expect((log?.before as { amount: number }).amount).toBe(1000);
      expect((log?.after as { amount: number }).amount).toBe(1500);
    });

    it('voids with a reason, once, and a voided expense cannot be edited', async () => {
      const { accessToken } = await createAdmin();
      const category = await createExpenseCategory();
      const expense = await addExpense(accessToken, category.id);

      expect((await post(`/expenses/${expense.id}/void`, accessToken, {})).status).toBe(400);

      const voided = await post(`/expenses/${expense.id}/void`, accessToken, { reason: 'Entered twice' });
      expect(voided.status).toBe(200);
      expect(voided.body.data.status).toBe('VOIDED');
      expect(voided.body.data.voidReason).toBe('Entered twice');

      expect((await post(`/expenses/${expense.id}/void`, accessToken, { reason: 'again' })).status).toBe(409);
      expect((await patch(`/expenses/${expense.id}`, accessToken, { amount: 1 })).status).toBe(409);

      const active = await get('/expenses', accessToken);
      expect(active.body.meta.totals.amount).toBe(0);
      const voidedList = await get('/expenses?status=VOIDED', accessToken);
      expect(voidedList.body.data).toHaveLength(1);
    });
  });

  describe('categories', () => {
    it('refuses a duplicate name ignoring case', async () => {
      const { accessToken } = await createAdmin();
      expect((await post('/expense-categories', accessToken, { name: 'Rent' })).status).toBe(201);
      expect((await post('/expense-categories', accessToken, { name: 'rent' })).status).toBe(409);
    });

    it('a rename keeps old expenses under the name they were filed with', async () => {
      const { accessToken } = await createAdmin();
      const category = await createExpenseCategory({ name: 'Power' });
      const expense = await addExpense(accessToken, category.id);

      expect((await patch(`/expense-categories/${category.id}`, accessToken, { name: 'Electricity' })).status).toBe(200);

      const res = await get(`/expenses/${expense.id}`, accessToken);
      expect(res.body.data.categoryName).toBe('Power');
    });

    it('deletes an unused category, but only deactivates one with expenses', async () => {
      const { accessToken } = await createAdmin();
      const unused = await createExpenseCategory();
      const used = await createExpenseCategory();
      await addExpense(accessToken, used.id);

      const deleted = await request(app)
        .delete(`${API}/expense-categories/${unused.id}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(deleted.body.data.softDeleted).toBe(false);
      expect(await ExpenseCategoryModel.exists({ _id: unused._id })).toBeNull();

      const kept = await request(app)
        .delete(`${API}/expense-categories/${used.id}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(kept.body.data.softDeleted).toBe(true);
      expect((await ExpenseCategoryModel.findById(used.id))?.isActive).toBe(false);
    });
  });

  describe('profit', () => {
    it('net profit is net revenue less active expenses, and every report agrees', async () => {
      const { accessToken: cashierToken } = await createCashier();
      const { accessToken: adminToken } = await createAdmin();
      const pkg = await createPlayPackage({ price: 80000 });
      const category = await createExpenseCategory({ name: 'Cleaning' });

      const bill = await payCashBill(cashierToken, pkg.id);
      await addExpense(adminToken, category.id, { amount: 30000, paymentMethod: 'CASH' });
      await addExpense(adminToken, category.id, { amount: 10000, paymentMethod: 'BANK_TRANSFER' });
      const voided = await addExpense(adminToken, category.id, { amount: 99999 });
      await post(`/expenses/${voided.id}/void`, adminToken, { reason: 'Mistake' });

      const today = businessDate();
      const range = `from=${today}&to=${today}`;
      const [summary, pl, period, close] = await Promise.all([
        get(`/dashboard/summary?${range}`, adminToken),
        get(`/reports/profit-loss?${range}`, adminToken),
        get(`/reports/period-summary?${range}`, adminToken),
        get(`/reports/daily-close?date=${today}`, adminToken),
      ]);

      const s = summary.body.data;
      expect(s.expenses).toBe(40000);
      expect(s.cashExpenses).toBe(30000);
      expect(s.netProfit).toBe(s.netRevenue - 40000);
      expect(s.netRevenue).toBe(bill.grandTotal);

      expect(pl.status).toBe(200);
      expect(pl.body.data.netProfit).toBe(s.netProfit);
      expect(pl.body.data.expenses.total).toBe(40000);
      expect(pl.body.data.expenses.byCategory).toEqual([
        expect.objectContaining({ categoryName: 'Cleaning', amount: 40000, count: 2 }),
      ]);

      expect(period.body.data.totalsRow.netProfit).toBe(s.netProfit);
      expect(period.body.data.buckets[0].expenses).toBe(40000);

      expect(close.body.data.summary).toEqual(s);
      expect(close.body.data.expenses.total).toBe(40000);
      expect(close.body.data.expenses.expectedCashInDrawer).toBe(bill.grandTotal - 30000);
    });

    it('counts an expense on the business day it is dated, across a month boundary', async () => {
      const { accessToken } = await createAdmin();
      const category = await createExpenseCategory();
      const now = DateTime.now().setZone(TIMEZONE);
      const lastOfPrevMonth = now.startOf('month').minus({ days: 1 }).toISODate() as string;
      const firstOfMonth = now.startOf('month').toISODate() as string;

      await addExpense(accessToken, category.id, { amount: 7000, spentOn: lastOfPrevMonth });

      const prev = await get(`/dashboard/summary?from=${lastOfPrevMonth}&to=${lastOfPrevMonth}`, accessToken);
      const current = await get(`/dashboard/summary?from=${firstOfMonth}&to=${now.toISODate()}`, accessToken);
      expect(prev.body.data.expenses).toBe(7000);
      expect(current.body.data.expenses).toBe(0);

      // A day with an expense and no sales still shows on the revenue chart, as a loss.
      const series = await get(`/dashboard/revenue?from=${lastOfPrevMonth}&to=${lastOfPrevMonth}`, accessToken);
      expect(series.body.data).toEqual([
        expect.objectContaining({ date: lastOfPrevMonth, expenses: 7000, netProfit: -7000 }),
      ]);
    });

    it('lists expense voids and edits on the exceptions report', async () => {
      const { accessToken } = await createAdmin();
      const category = await createExpenseCategory({ name: 'Rent' });
      const edited = await addExpense(accessToken, category.id, { amount: 5000 });
      const voided = await addExpense(accessToken, category.id, { amount: 2000 });
      await patch(`/expenses/${edited.id}`, accessToken, { amount: 4000 });
      await post(`/expenses/${voided.id}/void`, accessToken, { reason: 'Duplicate' });

      const res = await get(`/reports/exceptions?from=${businessDate()}&to=${businessDate()}`, accessToken);
      const rows = res.body.data.rows as Array<{ type: string; amount: number; reason: string }>;
      expect(rows.find((row) => row.type === 'EXPENSE_EDIT')?.amount).toBe(-1000);
      expect(rows.find((row) => row.type === 'EXPENSE_VOID')).toMatchObject({ amount: 2000, reason: 'Duplicate' });
    });

    it('exports the P&L and expense register as CSV', async () => {
      const { accessToken } = await createAdmin();
      const category = await createExpenseCategory({ name: 'Marketing' });
      await addExpense(accessToken, category.id, { amount: 123456 });
      const range = `from=${businessDate()}&to=${businessDate()}`;

      const pl = await get(`/reports/profit-loss?${range}&format=csv`, accessToken);
      expect(pl.status).toBe(200);
      expect(pl.text).toContain('Expenses,Marketing,1234.56');
      expect(pl.text).toContain('Result,Net profit,-1234.56');

      const register = await get(`/reports/expenses?${range}&format=csv`, accessToken);
      expect(register.status).toBe(200);
      expect(register.text).toContain('Marketing');
      expect(register.text).toContain('1234.56');
    });
  });
});
