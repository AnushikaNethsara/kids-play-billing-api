/**
 * The admin's customer list: segments (new, one-time, regular, at risk...), visit and
 * spend ranges, date filters in the business timezone, and sorting. Bills are created
 * through the API and then moved to exact business-local times, so every family's
 * history is known in advance.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage, createProduct } from './helpers/factories';
import { BillModel } from '../src/modules/bills/bill.model';
import { CustomerModel } from '../src/modules/customers/customer.model';
import { customerService } from '../src/modules/customers/customer.service';

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';
const TODAY = DateTime.now().setZone(TIMEZONE).startOf('day');

/** `days` business days ago at `hour`:00 Colombo time. */
const ago = (days: number, hour = 10) => TODAY.minus({ days }).set({ hour });

const stored = (local: string) => `+94${local.slice(1)}`;

async function visit(
  accessToken: string,
  playPackageId: string,
  phoneNumber: string,
  at: DateTime,
  items?: Record<string, unknown>[],
): Promise<string> {
  const draft = await request(app)
    .post(`${API}/bills`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      items: items ?? [{ childName: 'Child', playPackageId, quantity: 1 }],
      customer: { parentName: `Parent ${phoneNumber.slice(-2)}`, phoneNumber },
      paymentMethod: 'CASH',
    });
  expect(draft.status).toBe(201);
  const paid = await request(app)
    .post(`${API}/bills/${draft.body.data.id}/complete`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ paymentMethod: 'CASH' });
  expect(paid.status).toBe(200);
  const billId = paid.body.data.bill.id as string;
  await BillModel.updateOne({ _id: billId }, { $set: { paidAt: at.toJSDate() } });
  return billId;
}

/** Bills were moved after payment, so the derived figures have to be rebuilt. */
async function recomputeAll() {
  for (const customer of await CustomerModel.find({}, { _id: 1 }).lean()) {
    await customerService.recomputeStats(customer._id.toString());
  }
}

async function seedHistory() {
  const { accessToken } = await createAdmin();
  const pkg = await createPlayPackage({ price: 80_000 });
  const socks = await createProduct();

  // A: one visit 10 days ago - new.
  await visit(accessToken, pkg.id, '0771000001', ago(10));
  // B: one visit 31 days ago - one-time, never came back.
  await visit(accessToken, pkg.id, '0771000002', ago(31));
  // C: one visit exactly 30 days ago - still new, on the edge.
  await visit(accessToken, pkg.id, '0771000003', ago(30));
  // D: five visit days in the last 90, two bills on the last one - regular.
  for (const days of [80, 60, 40, 20, 5]) await visit(accessToken, pkg.id, '0771000004', ago(days));
  await visit(accessToken, pkg.id, '0771000004', ago(5, 15));
  // E: twice, last 60 days ago - at risk.
  await visit(accessToken, pkg.id, '0771000005', ago(100));
  await visit(accessToken, pkg.id, '0771000005', ago(60));
  // F: twice, last 200 days ago - lost.
  await visit(accessToken, pkg.id, '0771000006', ago(400));
  await visit(accessToken, pkg.id, '0771000006', ago(200));
  // H: socks on their own - a sale, not a visit.
  await visit(accessToken, pkg.id, '0771000008', ago(5), [
    { kind: 'PRODUCT', productId: socks.id, quantity: 1 },
  ]);
  // G: a customer added by hand, never visited.
  await request(app)
    .post(`${API}/customers`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ parentName: 'Walk-in later', phoneNumber: '0771000007' });

  await recomputeAll();
  return accessToken;
}

async function list(accessToken: string, query: Record<string, string | number> = {}) {
  return request(app)
    .get(`${API}/customers`)
    .query({ limit: 100, ...query })
    .set('Authorization', `Bearer ${accessToken}`);
}

async function phones(accessToken: string, query: Record<string, string | number>) {
  const res = await list(accessToken, query);
  expect(res.status).toBe(200);
  return (res.body.data as { phoneNumber: string }[]).map((row) => row.phoneNumber).sort();
}

const families = (...locals: string[]) => locals.map(stored).sort();

describe('customer segments', () => {
  it('puts each family in the right segments', async () => {
    const token = await seedHistory();

    expect(await phones(token, { segment: 'new' })).toEqual(families('0771000001', '0771000003'));
    expect(await phones(token, { segment: 'one_time' })).toEqual(families('0771000002'));
    expect(await phones(token, { segment: 'returning' })).toEqual(
      families('0771000004', '0771000005', '0771000006'),
    );
    expect(await phones(token, { segment: 'regular' })).toEqual(families('0771000004'));
    expect(await phones(token, { segment: 'at_risk' })).toEqual(families('0771000005'));
    expect(await phones(token, { segment: 'lost' })).toEqual(families('0771000006'));
    expect(await phones(token, { segment: 'never' })).toEqual(families('0771000007', '0771000008'));
  });

  it('counts each segment for the tab badges, admin only', async () => {
    const token = await seedHistory();

    const res = await request(app)
      .get(`${API}/customers/segments`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      all: 8,
      new: 2,
      one_time: 1,
      returning: 3,
      regular: 1,
      at_risk: 1,
      lost: 1,
      never: 2,
    });

    const { accessToken: cashier } = await createCashier();
    const refused = await request(app)
      .get(`${API}/customers/segments`)
      .set('Authorization', `Bearer ${cashier}`);
    expect(refused.status).toBe(403);
  });

  it('keeps firstVisitAt right when the first bill is cancelled out of the history', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage();
    const first = await visit(accessToken, pkg.id, '0771000009', ago(50));
    await visit(accessToken, pkg.id, '0771000009', ago(10));
    await recomputeAll();
    expect(await phones(accessToken, { segment: 'new' })).toEqual([]);

    await BillModel.updateOne({ _id: first }, { $set: { status: 'CANCELLED' } });
    await customerService.recomputeStatsForBill({ phoneNumber: stored('0771000009') });

    const customer = await CustomerModel.findOne({ phoneNumber: stored('0771000009') }).lean();
    expect(customer?.visitCount).toBe(1);
    expect(customer?.firstVisitAt?.toISOString()).toBe(ago(10).toJSDate().toISOString());
    expect(await phones(accessToken, { segment: 'new' })).toEqual(families('0771000009'));
  });
});

describe('customer list filters', () => {
  it('filters by visit count and spend', async () => {
    const token = await seedHistory();

    // Two bills on one day are one visit: D has 5 visits, not 6.
    expect(await phones(token, { minVisits: 5 })).toEqual(families('0771000004'));
    expect(await phones(token, { minVisits: 2, maxVisits: 2 })).toEqual(
      families('0771000005', '0771000006'),
    );
    // ...but both bills are spend: 6 x LKR 800.00.
    expect(await phones(token, { minSpent: 480_000 })).toEqual(families('0771000004'));
  });

  it('filters by last and first visit dates', async () => {
    const token = await seedHistory();

    expect(
      await phones(token, { lastVisitFrom: ago(61).toISODate()!, lastVisitTo: ago(31).toISODate()! }),
    ).toEqual(families('0771000002', '0771000005'));
    expect(await phones(token, { firstVisitFrom: ago(100).toISODate()! })).toEqual(
      families('0771000001', '0771000002', '0771000003', '0771000004', '0771000005'),
    );
  });

  it('finds families who visited in a range, one visit per day', async () => {
    const token = await seedHistory();

    expect(
      await phones(token, { visitedFrom: ago(65).toISODate()!, visitedTo: ago(55).toISODate()! }),
    ).toEqual(families('0771000004', '0771000005'));
    // Socks on their own are not a visit.
    expect(await phones(token, { visitedFrom: ago(5).toISODate()! })).toEqual(families('0771000004'));
  });

  it('reads dates in the business timezone, not UTC', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage();
    // 02:00 in Colombo is still the previous evening in UTC.
    const at = ago(3, 2);
    await visit(accessToken, pkg.id, '0771000010', at);
    await recomputeAll();

    const colomboDay = at.toISODate()!;
    const utcDay = at.toUTC().toISODate()!;
    expect(utcDay).not.toBe(colomboDay);

    expect(await phones(accessToken, { visitedFrom: colomboDay, visitedTo: colomboDay })).toEqual(
      families('0771000010'),
    );
    expect(await phones(accessToken, { visitedFrom: utcDay, visitedTo: utcDay })).toEqual([]);
    expect(await phones(accessToken, { lastVisitFrom: colomboDay, lastVisitTo: colomboDay })).toEqual(
      families('0771000010'),
    );
  });

  it('matches a bill by phone number when it was never linked to the customer', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage();
    const billId = await visit(accessToken, pkg.id, '0771000011', ago(4));
    await BillModel.updateOne({ _id: billId }, { $unset: { customerId: 1 } });

    expect(await phones(accessToken, { visitedFrom: ago(4).toISODate()! })).toEqual(
      families('0771000011'),
    );
  });

  it('ignores cancelled and test bills but counts refunded ones', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage();
    const cancelled = await visit(accessToken, pkg.id, '0771000012', ago(6));
    const test = await visit(accessToken, pkg.id, '0771000013', ago(6));
    const refunded = await visit(accessToken, pkg.id, '0771000014', ago(6));
    await BillModel.updateOne({ _id: cancelled }, { $set: { status: 'CANCELLED' } });
    await BillModel.updateOne({ _id: test }, { $set: { isTestBill: true } });
    await BillModel.updateOne({ _id: refunded }, { $set: { status: 'REFUNDED' } });

    const day = ago(6).toISODate()!;
    expect(await phones(accessToken, { visitedFrom: day, visitedTo: day })).toEqual(
      families('0771000014'),
    );
  });

  it('filters by contact details', async () => {
    const { accessToken } = await createAdmin();
    await request(app)
      .post(`${API}/customers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parentName: 'Has email', phoneNumber: '0771000015', email: 'a@example.com' });
    await request(app)
      .post(`${API}/customers`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parentName: 'No phone' });

    const named = async (query: Record<string, string>) =>
      ((await list(accessToken, query)).body.data as { parentName: string }[]).map((row) => row.parentName);
    expect(await named({ hasEmail: 'true' })).toEqual(['Has email']);
    expect(await named({ hasPhone: 'false' })).toEqual(['No phone']);
  });

  it('rejects a range that runs backwards', async () => {
    const { accessToken } = await createAdmin();
    expect((await list(accessToken, { minVisits: 5, maxVisits: 2 })).status).toBe(400);
    expect((await list(accessToken, { visitedFrom: '2026-10-10', visitedTo: '2026-10-01' })).status).toBe(400);
    expect((await list(accessToken, { segment: 'vip' })).status).toBe(400);
  });
});

describe('customer list sorting', () => {
  it('sorts by visits and spend, and puts families who never visited last', async () => {
    const token = await seedHistory();

    const byVisits = await list(token, { sort: 'visitCount', order: 'desc', limit: 3 });
    expect(byVisits.body.data.map((row: { phoneNumber: string }) => row.phoneNumber)[0]).toBe(
      stored('0771000004'),
    );

    for (const order of ['asc', 'desc']) {
      const res = await list(token, { sort: 'lastVisitAt', order });
      const rows = res.body.data as { lastVisitAt: string | null }[];
      expect(rows).toHaveLength(8);
      expect(rows.slice(-2).every((row) => row.lastVisitAt === null)).toBe(true);
      expect(rows.slice(0, -2).every((row) => row.lastVisitAt !== null)).toBe(true);
    }

    const oldestFirst = await list(token, { sort: 'lastVisitAt', order: 'asc', limit: 1 });
    expect(oldestFirst.body.data[0].phoneNumber).toBe(stored('0771000006'));
  });

  it('pages through ties without repeating or skipping anyone', async () => {
    const token = await seedHistory();

    const seen: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const res = await list(token, { sort: 'visitCount', order: 'asc', limit: 3, page });
      seen.push(...res.body.data.map((row: { id: string }) => row.id));
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });
});
