/**
 * Manual bills: a till bill the cashier missed and wrote on paper, entered later by an
 * admin. It must be priced exactly like a till checkout, and count on the day it happened.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage, createProduct } from './helpers/factories';
import { BillModel } from '../src/modules/bills/bill.model';
import { PlaySessionModel } from '../src/modules/play-sessions/playSession.model';
import { AuditLogModel } from '../src/modules/audit-logs/auditLog.model';

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';

function post(path: string, token: string, body: object, headers: Record<string, string> = {}) {
  const req = request(app).post(`${API}${path}`).set('Authorization', `Bearer ${token}`);
  for (const [key, value] of Object.entries(headers)) req.set(key, value);
  return req.send(body);
}

function get(path: string, token: string) {
  return request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`);
}

/** 14:00 business time, `daysAgo` days ago, plus `minutes`. */
function at(daysAgo: number, minutes = 0): Date {
  return DateTime.now()
    .setZone(TIMEZONE)
    .minus({ days: daysAgo })
    .set({ hour: 14, minute: 0, second: 0, millisecond: 0 })
    .plus({ minutes })
    .toJSDate();
}

function dayOf(date: Date): string {
  return DateTime.fromJSDate(date).setZone(TIMEZONE).toISODate() as string;
}

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:manual-${Date.now()}-${ticketCounter}`;
}

describe('manual bills', () => {
  it('dates the bill, its number and its revenue to the book check-out, not to today', async () => {
    const { accessToken, user } = await createAdmin();
    const pkg = await createPlayPackage({ durationMinutes: 60, price: 80000 });
    const checkInAt = at(3);
    const checkOutAt = at(3, 90);

    const res = await post('/bills/manual', accessToken, {
      tickets: [{ playPackageId: pkg.id, childNames: ['Sahan'], checkInAt: checkInAt.toISOString() }],
      checkOutAt: checkOutAt.toISOString(),
      customer: { parentName: 'Nimal Perera', phoneNumber: '0771234567' },
      paymentMethod: 'CASH',
      reason: 'Till offline',
      reference: 'Book page 14',
    });

    expect(res.status).toBe(201);
    const bill = res.body.data;
    expect(bill.status).toBe('PAID');
    expect(new Date(bill.paidAt).getTime()).toBe(checkOutAt.getTime());
    expect(bill.billNumber).toBe(
      `KPA-${DateTime.fromJSDate(checkOutAt).setZone(TIMEZONE).toFormat('yyyyMMdd-HHmmss')}`,
    );
    // 90 minutes of a LKR 800.00 hour, pro-rata.
    expect(bill.grandTotal).toBe(120000);
    expect(bill.entrySource).toBe('MANUAL');
    expect(bill.manualEntryReason).toBe('Till offline');
    expect(bill.manualEntryReference).toBe('Book page 14');
    expect(bill.paymentRecordedByName).toBe(user.name);
    expect(bill.items[0].playSessionId).toBeTruthy();

    const session = await PlaySessionModel.findById(bill.items[0].playSessionId);
    expect(session?.status).toBe('CLOSED');
    expect(session?.entrySource).toBe('MANUAL');

    const audit = await AuditLogModel.findOne({ action: 'BILL_MANUAL_ENTRY', entityId: bill.id });
    expect(audit?.metadata).toMatchObject({ reason: 'Till offline', reference: 'Book page 14' });
    // Not a force-close: the exit time is the book's, not an abandoned ticket's.
    expect(await AuditLogModel.countDocuments({ action: 'SESSION_FORCE_CLOSED' })).toBe(0);

    const day = dayOf(checkOutAt);
    const today = dayOf(new Date());
    const [thatDay, todaySummary] = await Promise.all([
      get(`/dashboard/summary?from=${day}&to=${day}`, accessToken),
      get(`/dashboard/summary?from=${today}&to=${today}`, accessToken),
    ]);
    expect(thatDay.body.data.netRevenue).toBe(120000);
    expect(thatDay.body.data.paidBillsCount).toBe(1);
    expect(todaySummary.body.data.netRevenue).toBe(0);

    // The reprint of that day's close explains the bill that appeared after it ended.
    const close = await get(`/reports/daily-close?date=${day}`, accessToken);
    expect(close.body.data.adjustments).toEqual([
      expect.objectContaining({ action: 'MANUAL_ENTRY', billId: bill.id, amount: 120000, reason: 'Till offline' }),
    ]);

    const listed = await get('/bills?entrySource=MANUAL', accessToken);
    expect(listed.body.data.map((row: { id: string }) => row.id)).toEqual([bill.id]);
  });

  it('prices a family ticket with extras exactly as the till would', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken: cashierToken } = await createCashier();
    const pkg = await createPlayPackage({ durationMinutes: 60, price: 80000 });
    const socks = await createProduct({ name: 'Socks', price: 30000 });

    // The till, live: 75 minutes, two children, one pair of socks.
    const ticketCode = nextTicketCode();
    const liveIn = new Date(Date.now() - 75 * 60_000);
    await post('/play-sessions', cashierToken, {
      ticketCode,
      childNames: ['A', 'B'],
      playPackageId: pkg.id,
      checkInAt: liveIn.toISOString(),
      extras: [{ localId: `x-${ticketCode}`, productId: socks.id, quantity: 1 }],
    });
    const live = await post('/bills/from-sessions', cashierToken, {
      ticketCodes: [ticketCode],
      checkOutAt: new Date(liveIn.getTime() + 75 * 60_000).toISOString(),
    });
    expect(live.status).toBe(201);

    const manual = await post('/bills/manual', adminToken, {
      tickets: [
        {
          playPackageId: pkg.id,
          childNames: ['A', 'B'],
          checkInAt: at(2).toISOString(),
          extras: [{ productId: socks.id, quantity: 1 }],
        },
      ],
      checkOutAt: at(2, 75).toISOString(),
      paymentMethod: 'CARD',
      reason: 'Printer jammed',
    });

    expect(manual.status).toBe(201);
    expect(manual.body.data.subtotal).toBe(live.body.data.subtotal);
    expect(manual.body.data.grandTotal).toBe(live.body.data.grandTotal);
    expect(manual.body.data.items).toHaveLength(2);
  });

  it('attributes the bill to the cashier who took the money', async () => {
    const { accessToken } = await createAdmin();
    const { user: cashier } = await createCashier();
    const pkg = await createPlayPackage();

    const res = await post('/bills/manual', accessToken, {
      tickets: [{ playPackageId: pkg.id, childNames: ['Kid'], checkInAt: at(1).toISOString() }],
      checkOutAt: at(1, 60).toISOString(),
      paymentMethod: 'CASH',
      cashierId: cashier.id,
      reason: 'Till offline',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.cashierId).toBe(cashier.id);
    expect(res.body.data.cashierName).toBe(cashier.name);
  });

  it('is admin-only and refuses impossible times', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage();
    const body = (checkInAt: Date, checkOutAt: Date) => ({
      tickets: [{ playPackageId: pkg.id, childNames: ['Kid'], checkInAt: checkInAt.toISOString() }],
      checkOutAt: checkOutAt.toISOString(),
      paymentMethod: 'CASH',
      reason: 'Till offline',
    });

    expect((await post('/bills/manual', cashierToken, body(at(1), at(1, 60)))).status).toBe(403);
    // Check-out before check-in.
    expect((await post('/bills/manual', accessToken, body(at(1, 60), at(1)))).status).toBe(400);
    // In the future.
    const soon = new Date(Date.now() + 60 * 60_000);
    expect((await post('/bills/manual', accessToken, body(new Date(), soon))).status).toBe(400);
    // Longer than a day.
    expect((await post('/bills/manual', accessToken, body(at(3), at(1)))).status).toBe(400);
    // No reason.
    const { reason: _reason, ...noReason } = body(at(1), at(1, 60));
    expect((await post('/bills/manual', accessToken, noReason)).status).toBe(400);

    expect(await BillModel.countDocuments()).toBe(0);
    expect(await PlaySessionModel.countDocuments()).toBe(0);
  });

  it('leaves nothing behind when the payment fails', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({ durationMinutes: 60, price: 80000 });

    const res = await post('/bills/manual', accessToken, {
      tickets: [{ playPackageId: pkg.id, childNames: ['Kid'], checkInAt: at(1).toISOString() }],
      checkOutAt: at(1, 60).toISOString(),
      paymentMethod: 'CASH',
      paidAmount: 100,
      reason: 'Till offline',
    });

    expect(res.status).toBe(422);
    expect(await BillModel.countDocuments()).toBe(0);
    expect(await PlaySessionModel.countDocuments()).toBe(0);
  });

  it('records one bill for a double-submitted form with the same Idempotency-Key', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage();
    const body = {
      tickets: [{ playPackageId: pkg.id, childNames: ['Kid'], checkInAt: at(1).toISOString() }],
      checkOutAt: at(1, 60).toISOString(),
      paymentMethod: 'CASH',
      reason: 'Till offline',
    };

    const first = await post('/bills/manual', accessToken, body, { 'Idempotency-Key': 'manual-key-1' });
    const second = await post('/bills/manual', accessToken, body, { 'Idempotency-Key': 'manual-key-1' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await BillModel.countDocuments()).toBe(1);
  });
});
