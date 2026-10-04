/**
 * The admin's customer profile: a family's children, how often they come, their visit
 * calendar, and the visit timeline.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage, createProduct } from './helpers/factories';
import { BillModel } from '../src/modules/bills/bill.model';
import { CustomerModel } from '../src/modules/customers/customer.model';
import { PlaySessionModel } from '../src/modules/play-sessions/playSession.model';

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';
const PHONE = '0771234567';

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:insights-${Date.now()}-${ticketCounter}`;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Checks a family in on one ticket and checks them out and pays, all through the API. */
async function familyVisit(token: string, playPackageId: string, childNames: string[]) {
  const ticketCode = nextTicketCode();
  await request(app)
    .post(`${API}/play-sessions`)
    .set(auth(token))
    .send({
      ticketCode,
      childNames,
      playPackageId,
      checkInAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      customer: { parentName: 'Nimal Perera', phoneNumber: PHONE },
    });
  const draft = await request(app)
    .post(`${API}/bills/from-sessions`)
    .set(auth(token))
    .send({ ticketCodes: [ticketCode] });
  const paid = await request(app)
    .post(`${API}/bills/${draft.body.data.id}/complete`)
    .set(auth(token))
    .send({ paymentMethod: 'CASH' });
  return paid.body.data.bill as { id: string; grandTotal: number };
}

async function flatVisit(token: string, playPackageId: string, childName: string, extras: { productId: string }[] = []) {
  const draft = await request(app)
    .post(`${API}/bills`)
    .set(auth(token))
    .send({
      items: [
        { childName, playPackageId, quantity: 1 },
        ...extras.map((extra) => ({ kind: 'PRODUCT', productId: extra.productId, quantity: 1 })),
      ],
      customer: { parentName: 'Nimal Perera', phoneNumber: PHONE },
      paymentMethod: 'CASH',
    });
  const paid = await request(app)
    .post(`${API}/bills/${draft.body.data.id}/complete`)
    .set(auth(token))
    .send({ paymentMethod: 'CASH' });
  return paid.body.data.bill as { id: string; grandTotal: number };
}

/** Moves a bill back by whole days, so a history can be built inside one test. */
async function backdate(billId: string, days: number) {
  const paidAt = DateTime.now().setZone(TIMEZONE).minus({ days }).toJSDate();
  await BillModel.updateOne({ _id: billId }, { $set: { paidAt } });
  // The tickets it paid for move with it.
  await PlaySessionModel.updateMany(
    { billId },
    { $set: { checkInAt: new Date(paidAt.getTime() - 60 * 60_000), checkOutAt: paidAt } },
  );
}

async function customerId(): Promise<string> {
  const customer = await CustomerModel.findOne({ phoneNumber: '+94771234567' }).lean();
  return String(customer?._id);
}

describe('customer profile', () => {
  it('lists each child of a family once, across tickets and fixed-price bills', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({ name: '1 Hour', durationMinutes: 60, price: 100_000 });

    const first = await familyVisit(accessToken, pkg.id, ['Amal', 'Nimal']);
    await backdate(first.id, 10);
    await familyVisit(accessToken, pkg.id, ['Amal', 'Sara']);
    await flatVisit(accessToken, pkg.id, 'Amal');

    const res = await request(app).get(`${API}/customers/${await customerId()}/profile`).set(auth(accessToken));

    expect(res.status).toBe(200);
    const children = res.body.data.children as { name: string; visits: number; favouritePackage: string }[];
    expect(children.map((child) => child.name).sort()).toEqual(['Amal', 'Nimal', 'Sara']);
    const amal = children.find((child) => child.name === 'Amal');
    // Two tickets and a flat bill, but only two different days: the ticket 10 days ago
    // and today's ticket and bill.
    expect(amal?.visits).toBe(2);
    expect(amal?.favouritePackage).toBe('1 Hour');
  });

  it('reports how often the family comes', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage();

    const visits = [30, 20, 10, 0];
    for (const daysAgo of visits) {
      const bill = await flatVisit(accessToken, pkg.id, 'Kasun');
      if (daysAgo > 0) await backdate(bill.id, daysAgo);
    }
    // A second bill on a day that is already a visit adds nothing.
    await flatVisit(accessToken, pkg.id, 'Kasun');

    const res = await request(app).get(`${API}/customers/${await customerId()}/profile`).set(auth(accessToken));
    const { frequency, heatmap } = res.body.data;

    expect(frequency.totalVisits).toBe(4);
    expect(frequency.visitsLast90Days).toBe(4);
    expect(frequency.averageDaysBetweenVisits).toBe(10);
    expect(frequency.visitsThisWeek).toBeGreaterThanOrEqual(1);
    expect(heatmap).toHaveLength(4);
    expect(heatmap[heatmap.length - 1]).toEqual({
      day: DateTime.now().setZone(TIMEZONE).toISODate(),
      children: 2,
    });
  });

  it('is for admins only', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken: cashierToken } = await createCashier();
    const pkg = await createPlayPackage();
    await flatVisit(adminToken, pkg.id, 'Kasun');

    const res = await request(app).get(`${API}/customers/${await customerId()}/profile`).set(auth(cashierToken));
    expect(res.status).toBe(403);
  });
});

describe('customer visit timeline', () => {
  it('shows one row per visit day, newest first, with what happened', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({ name: '1 Hour', durationMinutes: 60, price: 100_000 });
    const socks = await createProduct({ name: 'Socks', price: 30_000 });

    const older = await flatVisit(accessToken, pkg.id, 'Kasun');
    await backdate(older.id, 5);
    const family = await familyVisit(accessToken, pkg.id, ['Amal', 'Nimal']);
    const withSocks = await flatVisit(accessToken, pkg.id, 'Amal', [{ productId: socks.id }]);

    const res = await request(app)
      .get(`${API}/customers/${await customerId()}/visits`)
      .query({ limit: 1 })
      .set(auth(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    const [today] = res.body.data;
    expect(today.date).toBe(DateTime.now().setZone(TIMEZONE).toISODate());
    expect(today.children.sort()).toEqual(['Amal', 'Nimal']);
    expect(today.packages).toEqual(['1 Hour']);
    expect(today.extrasTotal).toBe(30_000);
    expect(today.amount).toBe(family.grandTotal + withSocks.grandTotal);
    expect(today.bills).toHaveLength(2);
    expect(today.timeIn).not.toBeNull();

    const next = await request(app)
      .get(`${API}/customers/${await customerId()}/visits`)
      .query({ limit: 1, page: 2 })
      .set(auth(accessToken));
    expect(next.body.data[0].children).toEqual(['Kasun']);
  });

  it('refuses a phone number already used by another customer', async () => {
    const { accessToken } = await createAdmin();
    const first = await request(app).post(`${API}/customers`).set(auth(accessToken)).send({ phoneNumber: PHONE });
    const second = await request(app)
      .post(`${API}/customers`)
      .set(auth(accessToken))
      .send({ phoneNumber: '0779999999' });

    const res = await request(app)
      .patch(`${API}/customers/${second.body.data.id}`)
      .set(auth(accessToken))
      .send({ phoneNumber: '+94 77 123 4567' });

    expect(first.status).toBe(201);
    expect(res.status).toBe(409);
  });
});

describe('customer lookup at the till', () => {
  async function lookup(token: string, phoneNumber: string) {
    return request(app).get(`${API}/customers/lookup`).query({ phoneNumber }).set(auth(token));
  }

  it('answers null for a number the business has not seen', async () => {
    const { accessToken } = await createCashier();
    const res = await lookup(accessToken, '0700000000');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('tells the cashier how often the family comes and who usually plays', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken: cashierToken } = await createCashier();
    const pkg = await createPlayPackage();

    const first = await familyVisit(adminToken, pkg.id, ['Amal', 'Nimal']);
    await backdate(first.id, 9);
    const second = await familyVisit(adminToken, pkg.id, ['Amal', 'Sara']);
    await backdate(second.id, 2);

    const res = await lookup(cashierToken, '+94 77 123 4567');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      phoneNumber: '+94771234567',
      visitCount: 2,
      visitedToday: false,
      loyalty: { interval: 0, nextVisitNumber: 3, rewardDue: false },
    });
    expect(res.body.data.usualChildren[0]).toBe('Amal');
    expect([...res.body.data.usualChildren].sort()).toEqual(['Amal', 'Nimal', 'Sara']);
  });

  it('flags the Nth visit as reward due, and keeps it due for the rest of that day', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage();
    const settings = await request(app)
      .patch(`${API}/settings`)
      .set(auth(accessToken))
      .send({ loyaltyVisitInterval: 3 });
    expect(settings.body.data.loyaltyVisitInterval).toBe(3);

    for (const daysAgo of [9, 2]) {
      const bill = await flatVisit(accessToken, pkg.id, 'Kasun');
      await backdate(bill.id, daysAgo);
    }

    const before = await lookup(accessToken, PHONE);
    expect(before.body.data.loyalty).toEqual({ interval: 3, nextVisitNumber: 3, rewardDue: true });

    // Paid today: the reward was for today's visit, and a second check-in today is still it.
    await flatVisit(accessToken, pkg.id, 'Kasun');
    const after = await lookup(accessToken, PHONE);
    expect(after.body.data.visitedToday).toBe(true);
    expect(after.body.data.loyalty).toEqual({ interval: 3, nextVisitNumber: 3, rewardDue: true });

    await request(app).patch(`${API}/settings`).set(auth(accessToken)).send({ loyaltyVisitInterval: 0 });
  });
});
