import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { PlaySessionModel } from '../src/modules/play-sessions/playSession.model';
import { BusinessSettingsModel } from '../src/modules/settings/settings.model';

const API = '/api/v1';

async function payBill(accessToken: string, playPackageId: string, paymentMethod = 'CASH') {
  const draft = await request(app)
    .post(`${API}/bills`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ items: [{ childName: 'Child', playPackageId, quantity: 1 }], paymentMethod });

  return request(app)
    .post(`${API}/bills/${draft.body.data.id}/complete`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ paymentMethod });
}

describe('dashboard aggregation', () => {
  it('reflects paid bills in the summary and revenue endpoints', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80000 });

    await payBill(cashierToken, pkg.id, 'CASH');
    await payBill(cashierToken, pkg.id, 'CARD');

    const summary = await request(app)
      .get(`${API}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(summary.status).toBe(200);
    expect(summary.body.data.paidBillsCount).toBe(2);
    expect(summary.body.data.grossRevenue).toBe(160000);
    expect(summary.body.data.netRevenue).toBe(160000);
    expect(summary.body.data.cashPayments.count).toBe(1);
    expect(summary.body.data.cardPayments.count).toBe(1);

    const revenue = await request(app)
      .get(`${API}/dashboard/revenue?period=today&groupBy=day`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(revenue.status).toBe(200);
    expect(revenue.body.data.length).toBe(1);
    expect(revenue.body.data[0].billCount).toBe(2);
  });

  it('excludes cancelled bills from revenue and lists a top cashier', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 50000 });

    await payBill(cashierToken, pkg.id);

    const draft = await request(app)
      .post(`${API}/bills`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ items: [{ childName: 'Child', playPackageId: pkg.id, quantity: 1 }], paymentMethod: 'CASH' });
    await request(app)
      .post(`${API}/bills/${draft.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ reason: 'no longer needed' });

    const summary = await request(app)
      .get(`${API}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(summary.body.data.grossRevenue).toBe(50000);
    expect(summary.body.data.cancelledBillsCount).toBe(1);
    expect(summary.body.data.topCashier).not.toBeNull();
  });
});

describe('dashboard session metrics', () => {
  /** Closes a session directly, so the test controls the exact play window. */
  async function closedSession(overrides: {
    checkInAt: Date;
    checkOutAt: Date;
    billedMinutes: number;
    unitPrice?: number;
    rateDurationMinutes?: number;
  }) {
    return PlaySessionModel.create({
      ticketCode: `KPA1:dash-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: 'CLOSED',
      childName: 'Kasun',
      playPackageId: new Types.ObjectId(),
      packageName: '1 Hour',
      rateDurationMinutes: overrides.rateDurationMinutes ?? 60,
      unitPrice: overrides.unitPrice ?? 100_000,
      checkInAt: overrides.checkInAt,
      checkInRecordedAt: overrides.checkInAt,
      checkOutAt: overrides.checkOutAt,
      billedMinutes: overrides.billedMinutes,
      checkInCashierId: new Types.ObjectId(),
      checkInCashierName: 'Test Cashier',
    });
  }

  it('averages play time and prices revenue per play hour', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const now = new Date();

    // 30 min and 90 min of play at LKR 1000.00/hour -> LKR 500.00 + LKR 1500.00.
    await closedSession({
      checkInAt: new Date(now.getTime() - 120 * 60_000),
      checkOutAt: new Date(now.getTime() - 90 * 60_000),
      billedMinutes: 30,
    });
    await closedSession({
      checkInAt: new Date(now.getTime() - 120 * 60_000),
      checkOutAt: new Date(now.getTime() - 30 * 60_000),
      billedMinutes: 90,
    });

    const res = await request(app)
      .get(`${API}/dashboard/sessions?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sessionCount).toBe(2);
    expect(res.body.data.totalPlayMinutes).toBe(120);
    expect(res.body.data.averagePlayMinutes).toBe(60);
    expect(res.body.data.longestPlayMinutes).toBe(90);
    // LKR 2000.00 of revenue across 2 hours of play.
    expect(res.body.data.revenuePerPlayHour).toBe(100_000);
  });

  it('counts sessions that were floored at the minimum', async () => {
    const { accessToken: adminToken } = await createAdmin();
    await BusinessSettingsModel.updateOne(
      {},
      { $set: { minimumBillableMinutes: 15 } },
      { upsert: true },
    );
    const now = new Date();

    await closedSession({
      checkInAt: new Date(now.getTime() - 20 * 60_000),
      checkOutAt: new Date(now.getTime() - 17 * 60_000),
      billedMinutes: 15, // a 3-minute visit raised to the floor
    });
    await closedSession({
      checkInAt: new Date(now.getTime() - 90 * 60_000),
      checkOutAt: new Date(now.getTime() - 30 * 60_000),
      billedMinutes: 60,
    });

    const res = await request(app)
      .get(`${API}/dashboard/sessions?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data.minimumAppliedCount).toBe(1);
  });

  it('is admin-only', async () => {
    const { accessToken: cashierToken } = await createCashier();

    const res = await request(app)
      .get(`${API}/dashboard/sessions?period=today`)
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(res.status).toBe(403);
  });

  it('counts a session in every hour it spans, not just the hour it started', async () => {
    const { accessToken: adminToken } = await createAdmin();

    // A single visit spanning parts of three hours must contribute to all three -
    // grouping by check-in hour would report arrivals, which answers a different question.
    const checkInAt = new Date();
    checkInAt.setUTCHours(4, 15, 0, 0);
    const checkOutAt = new Date(checkInAt);
    checkOutAt.setUTCHours(6, 40, 0, 0);

    await closedSession({ checkInAt, checkOutAt, billedMinutes: 145 });

    const res = await request(app)
      .get(`${API}/dashboard/occupancy?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(24);

    const occupiedHours = res.body.data.filter(
      (point: { childCount: number }) => point.childCount > 0,
    );
    expect(occupiedHours).toHaveLength(3);
    for (const point of occupiedHours) {
      expect(point.childCount).toBe(1);
    }

    // Hours are reported in the business timezone (Asia/Colombo, UTC+5:30), so a visit
    // starting 04:15 UTC shows up in the local morning, not at 04:00.
    expect(occupiedHours.map((point: { hour: number }) => point.hour)).toEqual([9, 10, 11]);
  });
});
