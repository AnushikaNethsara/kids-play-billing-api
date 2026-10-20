/**
 * Admin corrections to paid bills.
 *
 * Sometimes the money printed on a bill is not what was collected - the customer paid
 * short - or the payment method or customer was recorded wrongly. An admin corrects the
 * paid bill; the shortfall is written off as `writeOff` (never mixed into the cashier's
 * discount), every report follows, and the bill keeps an atomic, append-only history.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { CustomerModel } from '../src/modules/customers/customer.model';
import { normalizePhone } from '../src/common/utils/phone';

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';

function today(): string {
  return DateTime.now().setZone(TIMEZONE).toISODate() as string;
}

function get(path: string, accessToken: string) {
  return request(app).get(`${API}${path}`).set('Authorization', `Bearer ${accessToken}`);
}

function correct(billId: string, accessToken: string, body: Record<string, unknown>) {
  return request(app)
    .post(`${API}/bills/${billId}/corrections`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);
}

interface PaidBill {
  id: string;
  billNumber: string;
  paidAt: string;
  subtotal: number;
  discount: number;
  grandTotal: number;
  paidAmount: number;
  revision: number;
}

async function payBill(
  accessToken: string,
  options: { price?: number; phoneNumber?: string; paidAmount?: number; complete?: boolean } = {},
): Promise<PaidBill> {
  const pkg = await createPlayPackage({ durationMinutes: 60, price: options.price ?? 100000 });
  const draft = await request(app)
    .post(`${API}/bills`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      items: [{ childName: 'Kasun', playPackageId: pkg.id, quantity: 1 }],
      customer: { parentName: 'Nimal Perera', phoneNumber: options.phoneNumber ?? '0771234567' },
    });
  expect(draft.status).toBe(201);
  if (options.complete === false) return draft.body.data;

  const paid = await request(app)
    .post(`${API}/bills/${draft.body.data.id}/complete`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ paymentMethod: 'CASH', ...(options.paidAmount ? { paidAmount: options.paidAmount } : {}) });
  expect(paid.status).toBe(200);
  return paid.body.data.bill;
}

describe('correcting a paid bill', () => {
  it('writes off a shortfall, keeps the bill number and paid date, and records the history', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken, { price: 100000, paidAmount: 150000 });

    const res = await correct(bill.id, adminToken, {
      expectedRevision: 0,
      amountReceived: 80000,
      reason: 'Customer only had LKR 800 cash',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'PAID',
      billNumber: bill.billNumber,
      paidAt: bill.paidAt,
      subtotal: 100000,
      discount: 0,
      writeOff: 20000,
      writeOffReason: 'Customer only had LKR 800 cash',
      grandTotal: 80000,
      paidAmount: 80000,
      balance: 0,
      revision: 1,
    });
    expect(res.body.data.lastEditedByName).toBeTruthy();

    const history = await get(`/bills/${bill.id}/revisions`, adminToken);
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({ revision: 1, reason: 'Customer only had LKR 800 cash' });
    expect(history.body.data[0].changes).toEqual(
      expect.arrayContaining([
        { field: 'writeOff', from: 0, to: 20000 },
        { field: 'grandTotal', from: 100000, to: 80000 },
        { field: 'paidAmount', from: 150000, to: 80000 },
        { field: 'balance', from: 50000, to: 0 },
      ]),
    );

    const logs = await get(`/audit-logs?action=BILL_CORRECTED`, adminToken);
    expect(logs.body.data).toHaveLength(1);
    expect(logs.body.data[0]).toMatchObject({
      entityId: bill.id,
      before: { grandTotal: 100000 },
      after: { grandTotal: 80000 },
      metadata: { writeOffDelta: 20000, revision: 1 },
    });
  });

  it('undoes a write-off when the full amount turns up, keeping both revisions', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken);

    await correct(bill.id, adminToken, { expectedRevision: 0, amountReceived: 60000, reason: 'Paid short' });
    const res = await correct(bill.id, adminToken, {
      expectedRevision: 1,
      amountReceived: 100000,
      reason: 'Parent came back and paid the rest',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ writeOff: 0, writeOffReason: null, grandTotal: 100000, revision: 2 });

    const history = await get(`/bills/${bill.id}/revisions`, adminToken);
    expect(history.body.data.map((entry: { revision: number }) => entry.revision)).toEqual([2, 1]);
  });

  it('rejects a stale revision so two admins cannot overwrite each other', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken);

    const first = await correct(bill.id, adminToken, { expectedRevision: 0, paymentMethod: 'CARD', reason: 'Was card' });
    const second = await correct(bill.id, adminToken, {
      expectedRevision: 0,
      amountReceived: 50000,
      reason: 'Paid short',
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    const current = await get(`/bills/${bill.id}`, adminToken);
    expect(current.body.data).toMatchObject({ paymentMethod: 'CARD', grandTotal: 100000, revision: 1 });
  });

  it('rejects a correction that changes nothing', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken);

    const res = await correct(bill.id, adminToken, {
      expectedRevision: 0,
      amountReceived: 100000,
      paymentMethod: 'CASH',
      reason: 'No change at all',
    });
    expect(res.status).toBe(400);
  });

  it('rejects an amount above what the bill charged', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken);

    const res = await correct(bill.id, adminToken, {
      expectedRevision: 0,
      amountReceived: 100001,
      reason: 'Paid extra',
    });
    expect(res.status).toBe(422);
  });

  it('requires a reason', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken);

    const res = await correct(bill.id, adminToken, { expectedRevision: 0, paymentMethod: 'CARD' });
    expect(res.status).toBe(400);
  });

  it('is admin-only, for both the correction and its history', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const bill = await payBill(cashierToken);

    const res = await correct(bill.id, cashierToken, { expectedRevision: 0, paymentMethod: 'CARD', reason: 'Was card' });
    expect(res.status).toBe(403);
    expect((await get(`/bills/${bill.id}/revisions`, cashierToken)).status).toBe(403);
  });

  it('only corrects PAID bills', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const body = { expectedRevision: 0, paymentMethod: 'CARD', reason: 'Was card' };

    const draft = await payBill(adminToken, { complete: false });
    expect((await correct(draft.id, adminToken, body)).status).toBe(409);

    const refunded = await payBill(adminToken);
    await request(app)
      .post(`${API}/bills/${refunded.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Refund' });
    expect((await correct(refunded.id, adminToken, body)).status).toBe(409);

    const cancelled = await payBill(adminToken);
    await request(app)
      .post(`${API}/bills/${cancelled.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Cancel' });
    expect((await correct(cancelled.id, adminToken, body)).status).toBe(409);
  });

  it('flows into the dashboard and the daily close, which still agree', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken);
    await correct(bill.id, adminToken, {
      expectedRevision: 0,
      amountReceived: 70000,
      paymentMethod: 'CARD',
      reason: 'Card payment, LKR 300 short',
    });

    const [summary, close] = await Promise.all([
      get(`/dashboard/summary?from=${today()}&to=${today()}`, adminToken),
      get(`/reports/daily-close?date=${today()}`, adminToken),
    ]);

    expect(summary.body.data).toMatchObject({
      grossRevenue: 100000,
      discounts: 0,
      writeOffs: 30000,
      netRevenue: 70000,
      cashPayments: { amount: 0, count: 0 },
      cardPayments: { amount: 70000, count: 1 },
    });
    expect(close.body.data.summary).toEqual(summary.body.data);
  });

  it('lists the correction in the exceptions report', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken);
    await correct(bill.id, adminToken, { expectedRevision: 0, amountReceived: 90000, reason: 'Paid short' });

    const res = await get(`/reports/exceptions?from=${today()}&to=${today()}&type=BILL_CORRECTION`, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.rows[0]).toMatchObject({
      type: 'BILL_CORRECTION',
      entityId: bill.id,
      reference: bill.billNumber,
      amount: 10000,
      reason: 'Paid short',
    });
  });

  it('moves the bill, and its spend, to the family whose phone number it gets', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken, { phoneNumber: '0771111111' });

    const res = await correct(bill.id, adminToken, {
      expectedRevision: 0,
      customer: { phoneNumber: '0772222222' },
      reason: 'Wrong phone number typed at the till',
    });
    expect(res.status).toBe(200);

    const oldFamily = await CustomerModel.findOne({ phoneNumber: normalizePhone('0771111111') }).lean();
    const newFamily = await CustomerModel.findOne({ phoneNumber: normalizePhone('0772222222') }).lean();
    expect(oldFamily?.totalSpent).toBe(0);
    expect(newFamily?.totalSpent).toBe(100000);
    expect(res.body.data.customerId).toBe(newFamily?._id.toString());
  });

  it('refunds the corrected amount, which is what was really taken', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken);
    await correct(bill.id, adminToken, { expectedRevision: 0, amountReceived: 60000, reason: 'Paid short' });

    const refund = await request(app)
      .post(`${API}/bills/${bill.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Unhappy customer' });
    expect(refund.status).toBe(200);

    const summary = await get(`/dashboard/summary?from=${today()}&to=${today()}`, adminToken);
    expect(summary.body.data).toMatchObject({ refunds: 60000, writeOffs: 40000, netRevenue: 0 });
  });

  it('leaves the history out of the bill list and prints the write-off on the receipt', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const bill = await payBill(adminToken);
    await correct(bill.id, adminToken, { expectedRevision: 0, amountReceived: 75000, reason: 'Paid short' });

    const list = await get('/bills', adminToken);
    expect(list.body.data[0]).toMatchObject({ id: bill.id, writeOff: 25000, revision: 1 });
    expect(list.body.data[0]).not.toHaveProperty('revisions');

    const text = await get(`/bills/${bill.id}/receipt/text`, adminToken);
    expect(text.text).toMatch(/Write-off\s+-/);
    expect(text.text).toMatch(/Corrected \d{2}\/\d{2}\/\d{4}/);
  });
});
