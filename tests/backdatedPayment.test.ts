/**
 * Dating a recovered payment to its checkout.
 *
 * An admin recovering a till checkout that was abandoned before payment records it with
 * `backdateToCheckout`, so the bill number, `paidAt` and the day the revenue counts on are
 * the checkout's - not the day someone noticed. These tests pin that, the admin-only rule,
 * the bill-number collision a backdated second can hit once its counter row has expired,
 * and that a late entry never rewinds a parent's last visit.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { BillModel } from '../src/modules/bills/bill.model';
import { CounterModel } from '../src/modules/bills/counter.model';
import { CustomerModel } from '../src/modules/customers/customer.model';

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:backdate-${Date.now()}-${ticketCounter}`;
}

function billNumberAt(at: Date): string {
  return `KPA-${DateTime.fromJSDate(at).setZone(TIMEZONE).toFormat('yyyyMMdd-HHmmss')}`;
}

async function strandedCheckout(
  cashierToken: string,
  customer?: { parentName: string; phoneNumber: string },
) {
  const pkg = await createPlayPackage({ durationMinutes: 60, price: 100000 });
  const ticketCode = nextTicketCode();

  await request(app)
    .post(`${API}/play-sessions`)
    .set('Authorization', `Bearer ${cashierToken}`)
    .send({
      ticketCode,
      childName: 'Linara',
      playPackageId: pkg.id,
      checkInAt: new Date(Date.now() - 45 * 60_000).toISOString(),
      ...(customer ? { customer } : {}),
    });

  const draft = await request(app)
    .post(`${API}/bills/from-sessions`)
    .set('Authorization', `Bearer ${cashierToken}`)
    .send({ ticketCodes: [ticketCode] });
  expect(draft.status).toBe(201);
  return { draft: draft.body.data, pkg };
}

/**
 * Ages a stranded draft as if it had sat unpaid for `daysAgo` days. Check-in times are
 * bounded by the maximum session length, so the bill is rewritten underneath the API,
 * through the raw driver so the timestamps plugin cannot reset `createdAt`.
 */
async function ageDraft(billId: string, daysAgo: number): Promise<Date> {
  const checkOutAt = new Date(Date.now() - daysAgo * 24 * 60 * 60_000);
  await BillModel.collection.updateOne(
    { _id: new Types.ObjectId(billId) },
    {
      $set: {
        'items.0.checkInAt': new Date(checkOutAt.getTime() - 45 * 60_000),
        'items.0.checkOutAt': checkOutAt,
        createdAt: new Date(checkOutAt.getTime() + 300),
      },
    },
  );
  return checkOutAt;
}

function recordPayment(token: string, billId: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`${API}/bills/${billId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentMethod: 'CASH', ...body });
}

describe('dating a recovered payment to the checkout', () => {
  it('dates the payment, bill number and revenue to the checkout day', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken, user: admin } = await createAdmin();
    const { draft } = await strandedCheckout(cashierToken);
    const checkOutAt = await ageDraft(draft.id, 3);

    const res = await recordPayment(adminToken, draft.id, { backdateToCheckout: true });

    expect(res.status).toBe(200);
    const bill = res.body.data.bill;
    expect(new Date(bill.paidAt).getTime()).toBe(checkOutAt.getTime());
    expect(bill.billNumber).toBe(billNumberAt(checkOutAt));
    expect(Date.now() - new Date(bill.paymentRecordedAt).getTime()).toBeLessThan(60_000);
    expect(bill.paymentRecordedBy).toBe(admin.id);
    expect(bill.paymentRecordedByName).toBe(admin.name);

    const checkoutDay = DateTime.fromJSDate(checkOutAt).setZone(TIMEZONE).toISODate();
    const thatDay = await request(app)
      .get(`${API}/dashboard/summary?from=${checkoutDay}&to=${checkoutDay}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(thatDay.body.data.grossRevenue).toBe(draft.grandTotal);

    const today = await request(app)
      .get(`${API}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(today.body.data.grossRevenue).toBe(0);

    const logs = await request(app)
      .get(`${API}/audit-logs?action=BILL_PAYMENT_RECORDED_BY_OTHER`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(logs.body.data[0].metadata).toMatchObject({ backdatedToCheckout: true });

    const receipt = await request(app)
      .get(`${API}/bills/${draft.id}/receipt/text`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(receipt.text).toContain('Payment recorded');
  });

  it('leaves a normal payment dated now with no recorded-later marker', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { draft } = await strandedCheckout(cashierToken);

    const res = await recordPayment(cashierToken, draft.id);

    expect(res.status).toBe(200);
    expect(Date.now() - new Date(res.body.data.bill.paidAt).getTime()).toBeLessThan(60_000);
    expect(res.body.data.bill.paymentRecordedAt).toBeNull();
  });

  it('falls back to when the draft was made on a flat bill', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80000 });
    const created = await request(app)
      .post(`${API}/bills`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ childName: 'Child', playPackageId: pkg.id, quantity: 1 }] });
    const draft = created.body.data;

    const res = await recordPayment(adminToken, draft.id, { backdateToCheckout: true });

    expect(res.status).toBe(200);
    expect(res.body.data.bill.paidAt).toBe(draft.createdAt);
  });

  it('refuses the flag from a cashier and leaves the bill a draft', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { draft } = await strandedCheckout(cashierToken);

    const res = await recordPayment(cashierToken, draft.id, { backdateToCheckout: true });

    expect(res.status).toBe(403);
    expect((await BillModel.findById(draft.id))?.status).toBe('DRAFT');
  });

  it('takes the next suffix when a paid bill already holds that second', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const { draft } = await strandedCheckout(cashierToken);
    const checkOutAt = await ageDraft(draft.id, 2);

    // Another bill was paid in that same second, and its counter row has long expired.
    const { draft: other } = await strandedCheckout(cashierToken);
    await BillModel.collection.updateOne(
      { _id: new Types.ObjectId(other.id) },
      { $set: { status: 'PAID', billNumber: billNumberAt(checkOutAt), paidAt: checkOutAt } },
    );
    await CounterModel.deleteMany({});

    const res = await recordPayment(adminToken, draft.id, { backdateToCheckout: true });

    expect(res.status).toBe(200);
    expect(res.body.data.bill.billNumber).toBe(`${billNumberAt(checkOutAt)}-2`);
  });

  it('never moves a parent\'s last visit backwards', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const customer = { parentName: 'Anoja', phoneNumber: '0716962828' };
    const { draft, pkg } = await strandedCheckout(cashierToken, customer);
    await ageDraft(draft.id, 3);

    // The parent has been back, and paid, since that checkout.
    const recent = await request(app)
      .post(`${API}/bills`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ items: [{ childName: 'Linara', playPackageId: pkg.id, quantity: 1 }], customer });
    await recordPayment(cashierToken, recent.body.data.id);
    const before = await CustomerModel.findOne({ phoneNumber: customer.phoneNumber }).lean();

    await recordPayment(adminToken, draft.id, { backdateToCheckout: true });

    const after = await CustomerModel.findOne({ phoneNumber: customer.phoneNumber }).lean();
    expect(after?.lastVisitAt).toEqual(before?.lastVisitAt);
    expect(after?.visitCount).toBe((before?.visitCount ?? 0) + 1);
  });
});
