/**
 * Test bills: an admin marking a checked-out bill as "this was not real business".
 *
 * The bill itself must survive completely intact - number, totals, receipt, its place in
 * the bill list - while disappearing from every figure that claims to describe the
 * business's income. These tests pin both halves of that, plus the rule that a bill still
 * being built at the till cannot be pre-marked.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { CustomerModel } from '../src/modules/customers/customer.model';

const API = '/api/v1';

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:test-${Date.now()}-${ticketCounter}`;
}

async function createDraft(accessToken: string, playPackageId: string, phoneNumber = '0771234567') {
  const res = await request(app)
    .post(`${API}/bills`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      items: [{ childName: 'Child', playPackageId, quantity: 1 }],
      customer: { parentName: 'Nimal Perera', phoneNumber },
      paymentMethod: 'CASH',
    });
  return res.body.data;
}

async function payBill(accessToken: string, playPackageId: string, phoneNumber = '0771234567') {
  const draft = await createDraft(accessToken, playPackageId, phoneNumber);
  const res = await request(app)
    .post(`${API}/bills/${draft.id}/complete`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ paymentMethod: 'CASH' });
  return res.body.data.bill;
}

function markAsTest(accessToken: string, billId: string, isTestBill: boolean, reason?: string) {
  return request(app)
    .post(`${API}/bills/${billId}/test`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ isTestBill, ...(reason ? { reason } : {}) });
}

describe('marking a bill as a test bill', () => {
  it('refuses a bill that has not been checked out yet', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80000 });

    const draft = await createDraft(cashierToken, pkg.id);
    const res = await markAsTest(adminToken, draft.id, true, 'training');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('is admin-only', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const pkg = await createPlayPackage({ price: 80000 });

    const bill = await payBill(cashierToken, pkg.id);
    const res = await markAsTest(cashierToken, bill.id, true, 'training');

    expect(res.status).toBe(403);
  });

  it('marks a paid bill and leaves its money and bill number untouched', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80000 });

    const bill = await payBill(cashierToken, pkg.id);
    const res = await markAsTest(adminToken, bill.id, true, 'printer check');

    expect(res.status).toBe(200);
    expect(res.body.data.isTestBill).toBe(true);
    expect(res.body.data.testReason).toBe('printer check');
    expect(res.body.data.testMarkedAt).not.toBeNull();
    expect(res.body.data.status).toBe('PAID');
    expect(res.body.data.billNumber).toBe(bill.billNumber);
    expect(res.body.data.grandTotal).toBe(bill.grandTotal);
  });

  it('is idempotent when the bill is already in the requested state', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80000 });

    const bill = await payBill(cashierToken, pkg.id);
    await markAsTest(adminToken, bill.id, true, 'training');
    const second = await markAsTest(adminToken, bill.id, true, 'training');

    expect(second.status).toBe(200);
    expect(second.body.data.isTestBill).toBe(true);

    // The customer correction must not be applied twice by a retry.
    const customer = await CustomerModel.findOne({ phoneNumber: '0771234567' });
    expect(customer?.visitCount).toBe(0);
    expect(customer?.totalSpent).toBe(0);
  });
});

describe('test bills and reporting', () => {
  it('removes the bill from every revenue figure and puts it back when unmarked', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80000 });

    await payBill(cashierToken, pkg.id, '0770000001');
    const testBill = await payBill(cashierToken, pkg.id, '0770000002');

    const before = await request(app)
      .get(`${API}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.body.data.paidBillsCount).toBe(2);
    expect(before.body.data.grossRevenue).toBe(160000);

    await markAsTest(adminToken, testBill.id, true, 'staff training');

    const after = await request(app)
      .get(`${API}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.body.data.paidBillsCount).toBe(1);
    expect(after.body.data.grossRevenue).toBe(80000);
    expect(after.body.data.netRevenue).toBe(80000);
    expect(after.body.data.cashPayments.count).toBe(1);
    expect(after.body.data.childrenServed).toBe(1);

    const revenue = await request(app)
      .get(`${API}/dashboard/revenue?period=today&groupBy=day`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revenue.body.data[0].billCount).toBe(1);
    expect(revenue.body.data[0].grossRevenue).toBe(80000);

    const cashiers = await request(app)
      .get(`${API}/dashboard/cashiers?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(cashiers.body.data[0].billCount).toBe(1);
    expect(cashiers.body.data[0].revenue).toBe(80000);

    const packages = await request(app)
      .get(`${API}/dashboard/packages?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(packages.body.data[0].quantitySold).toBe(1);

    const restored = await markAsTest(adminToken, testBill.id, false);
    expect(restored.status).toBe(200);
    expect(restored.body.data.isTestBill).toBe(false);
    expect(restored.body.data.testReason).toBeNull();

    const final = await request(app)
      .get(`${API}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(final.body.data.paidBillsCount).toBe(2);
    expect(final.body.data.grossRevenue).toBe(160000);
  });

  it('keeps the bill visible in the bills list and filterable both ways', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80000 });

    await payBill(cashierToken, pkg.id, '0770000001');
    const testBill = await payBill(cashierToken, pkg.id, '0770000002');
    await markAsTest(adminToken, testBill.id, true, 'demo');

    const all = await request(app)
      .get(`${API}/bills`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(all.body.data).toHaveLength(2);

    const realOnly = await request(app)
      .get(`${API}/bills?isTestBill=false`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(realOnly.body.data).toHaveLength(1);
    expect(realOnly.body.data[0].id).not.toBe(testBill.id);

    const testOnly = await request(app)
      .get(`${API}/bills?isTestBill=true`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(testOnly.body.data).toHaveLength(1);
    expect(testOnly.body.data[0].id).toBe(testBill.id);
  });

  it('unwinds the visit and lifetime spend it added to the customer', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80000 });

    const bill = await payBill(cashierToken, pkg.id, '0779999999');

    const afterPayment = await CustomerModel.findOne({ phoneNumber: '0779999999' });
    expect(afterPayment?.visitCount).toBe(1);
    expect(afterPayment?.totalSpent).toBe(80000);

    await markAsTest(adminToken, bill.id, true, 'training');

    const afterMarking = await CustomerModel.findOne({ phoneNumber: '0779999999' });
    expect(afterMarking?.visitCount).toBe(0);
    expect(afterMarking?.totalSpent).toBe(0);

    await markAsTest(adminToken, bill.id, false);

    const afterRestore = await CustomerModel.findOne({ phoneNumber: '0779999999' });
    expect(afterRestore?.visitCount).toBe(1);
    expect(afterRestore?.totalSpent).toBe(80000);
  });

  it('excludes the play sessions behind a test checkout from the session metrics', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ durationMinutes: 60, price: 100000 });
    const ticketCode = nextTicketCode();

    await request(app)
      .post(`${API}/play-sessions`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        ticketCode,
        childName: 'Kasun',
        playPackageId: pkg.id,
        checkInAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        customer: { parentName: 'Nimal Perera', phoneNumber: '0771234567' },
      });

    const draft = await request(app)
      .post(`${API}/bills/from-sessions`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ ticketCodes: [ticketCode] });

    await request(app)
      .post(`${API}/bills/${draft.body.data.id}/complete`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ paymentMethod: 'CASH' });

    const before = await request(app)
      .get(`${API}/dashboard/sessions?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.body.data.sessionCount).toBe(1);

    const marked = await markAsTest(adminToken, draft.body.data.id, true, 'training checkout');
    expect(marked.status).toBe(200);

    const after = await request(app)
      .get(`${API}/dashboard/sessions?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.body.data.sessionCount).toBe(0);
    expect(after.body.data.totalPlayMinutes).toBe(0);

    const occupancy = await request(app)
      .get(`${API}/dashboard/occupancy?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(occupancy.body.data.every((point: { childCount: number }) => point.childCount === 0)).toBe(
      true,
    );
  });

  it('writes an audit entry for both directions', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80000 });

    const bill = await payBill(cashierToken, pkg.id);
    await markAsTest(adminToken, bill.id, true, 'demo for a supplier');
    await markAsTest(adminToken, bill.id, false);

    const logs = await request(app)
      .get(`${API}/audit-logs?entityType=BILL`)
      .set('Authorization', `Bearer ${adminToken}`);

    const actions = logs.body.data.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('BILL_MARKED_AS_TEST');
    expect(actions).toContain('BILL_UNMARKED_AS_TEST');
  });
});
