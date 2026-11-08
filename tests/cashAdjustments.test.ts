/**
 * Cash over/short: a signed difference found when the drawer is counted. It is never
 * revenue - it is added to profit beside expenses - and it lands on its business day.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { AuditLogModel } from '../src/modules/audit-logs/auditLog.model';

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

async function addAdjustment(token: string, amount: number, businessDay = businessDate(), reason = 'Drawer count') {
  const res = await post('/cash-adjustments', token, { businessDate: businessDay, amount, reason });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; amount: number; createdByName: string; status: string };
}

async function payCashBill(token: string, playPackageId: string) {
  const draft = await post('/bills', token, {
    items: [{ childName: 'Child', playPackageId, quantity: 1 }],
    paymentMethod: 'CASH',
  });
  expect(draft.status).toBe(201);
  const paid = await post(`/bills/${draft.body.data.id}/complete`, token, { paymentMethod: 'CASH' });
  expect(paid.status).toBe(200);
  return paid.body.data.bill as { grandTotal: number };
}

describe('cash adjustments', () => {
  it('is admin-only', async () => {
    const { accessToken } = await createCashier();
    const res = await post('/cash-adjustments', accessToken, {
      businessDate: businessDate(),
      amount: -1000,
      reason: 'Short',
    });
    expect(res.status).toBe(403);
    expect((await get('/cash-adjustments', accessToken)).status).toBe(403);
  });

  it('records who created it, and refuses zero, future dates and a missing reason', async () => {
    const { accessToken, user } = await createAdmin();

    const created = await addAdjustment(accessToken, -1000);
    expect(created.amount).toBe(-1000);
    expect(created.createdByName).toBe(user.name);
    expect(created.status).toBe('ACTIVE');

    const audit = await AuditLogModel.findOne({ action: 'CASH_ADJUSTMENT_CREATED', entityId: created.id });
    expect(audit?.userName).toBe(user.name);

    expect(
      (await post('/cash-adjustments', accessToken, { businessDate: businessDate(), amount: 0, reason: 'x' })).status,
    ).toBe(400);
    expect(
      (await post('/cash-adjustments', accessToken, { businessDate: businessDate(), amount: 10.5, reason: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (await post('/cash-adjustments', accessToken, { businessDate: businessDate(), amount: 100 })).status,
    ).toBe(400);
    const tomorrow = DateTime.now().setZone(TIMEZONE).plus({ days: 1 }).toISODate();
    expect(
      (await post('/cash-adjustments', accessToken, { businessDate: tomorrow, amount: 100, reason: 'x' })).status,
    ).toBe(400);
  });

  it('adds to profit, never to revenue, on its own business day', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken: cashierToken } = await createCashier();
    const pkg = await createPlayPackage({ price: 80000 });
    const bill = await payCashBill(cashierToken, pkg.id);

    await addAdjustment(adminToken, -1000); // LKR 10.00 short
    await addAdjustment(adminToken, -10000); // LKR 100.00 short
    await addAdjustment(adminToken, 50000); // LKR 500.00 over
    await addAdjustment(adminToken, 2000); // LKR 20.00 over
    await addAdjustment(adminToken, -77700, businessDate(3)); // another day
    const voided = await addAdjustment(adminToken, 99900);
    expect((await post(`/cash-adjustments/${voided.id}/void`, adminToken, { reason: 'Typo' })).status).toBe(200);

    const today = businessDate();
    const range = `from=${today}&to=${today}`;
    const [summary, pl, period, close, list] = await Promise.all([
      get(`/dashboard/summary?${range}`, adminToken),
      get(`/reports/profit-loss?${range}`, adminToken),
      get(`/reports/period-summary?${range}`, adminToken),
      get(`/reports/daily-close?date=${today}`, adminToken),
      get(`/cash-adjustments?${range}`, adminToken),
    ]);

    const s = summary.body.data;
    expect(s.netRevenue).toBe(bill.grandTotal);
    expect(s.cashOverShort).toBe(41000);
    expect(s.cashSurplus).toBe(52000);
    expect(s.cashShortage).toBe(-11000);
    expect(s.cashAdjustmentCount).toBe(4);
    expect(s.netProfit).toBe(bill.grandTotal + 41000);

    expect(pl.body.data.netProfit).toBe(s.netProfit);
    expect(pl.body.data.cashOverShort).toEqual({ net: 41000, surplus: 52000, shortage: -11000, count: 4 });

    expect(period.body.data.totalsRow.cashOverShort).toBe(41000);
    expect(period.body.data.buckets[0].cashOverShort).toBe(41000);
    expect(period.body.data.buckets[0].netProfit).toBe(s.netProfit);

    const cash = close.body.data.cashAdjustments;
    expect(close.body.data.summary).toEqual(s);
    expect(cash.net).toBe(41000);
    expect(cash.expectedCashInDrawer).toBe(bill.grandTotal);
    expect(cash.countedCashInDrawer).toBe(bill.grandTotal + 41000);
    // The four active ones; the void happened today, before the day ended.
    expect(cash.items).toHaveLength(4);

    expect(list.body.meta.totals).toEqual({ surplus: 52000, shortage: -11000, net: 41000, count: 4 });

    const earlier = businessDate(3);
    const old = await get(`/dashboard/summary?from=${earlier}&to=${earlier}`, adminToken);
    expect(old.body.data.cashOverShort).toBe(-77700);
    expect(old.body.data.netProfit).toBe(-77700);
  });

  it('audits edits, refuses editing a voided one, and lists both on the exceptions report', async () => {
    const { accessToken } = await createAdmin();
    const adjustment = await addAdjustment(accessToken, -1000);

    const edited = await patch(`/cash-adjustments/${adjustment.id}`, accessToken, { amount: -1500 });
    expect(edited.status).toBe(200);
    expect(edited.body.data.amount).toBe(-1500);

    const voided = await post(`/cash-adjustments/${adjustment.id}/void`, accessToken, { reason: 'Found the cash' });
    expect(voided.status).toBe(200);
    expect(voided.body.data.status).toBe('VOIDED');
    expect((await post(`/cash-adjustments/${adjustment.id}/void`, accessToken, { reason: 'Again' })).status).toBe(
      409,
    );
    expect((await patch(`/cash-adjustments/${adjustment.id}`, accessToken, { amount: -10 })).status).toBe(409);

    const today = businessDate();
    const exceptions = await get(`/reports/exceptions?from=${today}&to=${today}`, accessToken);
    const types = exceptions.body.data.rows.map((row: { type: string }) => row.type);
    expect(types).toContain('CASH_ADJUSTMENT_EDIT');
    expect(types).toContain('CASH_ADJUSTMENT_VOID');
    const edit = exceptions.body.data.rows.find((row: { type: string }) => row.type === 'CASH_ADJUSTMENT_EDIT');
    expect(edit.amount).toBe(-500);
  });
});
