import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { env } from '../src/config';
import { BusinessSettingsModel } from '../src/modules/settings/settings.model';
import { PlaySessionModel } from '../src/modules/play-sessions/playSession.model';
import {
  OvertimeMode,
  RoundingMode,
  SessionPricingMode,
} from '../src/common/constants/pricingModes';

/**
 * Family tickets: one QR covering several children on the same package, who check out
 * together. The rule under test throughout is that a family ticket costs exactly what the
 * same children on separate tickets would.
 */

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';
const FAMILY = ['Amal', 'Nimal', 'Sara'];

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:family-${Date.now()}-${ticketCounter}`;
}

function businessDate(): string {
  return DateTime.now().setZone(TIMEZONE).toISODate() as string;
}

/** Far enough back that every exit time under test is still in the past. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function exitAfter(checkInAt: string, minutes: number): string {
  return new Date(new Date(checkInAt).getTime() + minutes * 60_000).toISOString();
}

async function checkIn(accessToken: string, body: Record<string, unknown>) {
  return request(app)
    .post(`${API}/play-sessions`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ ticketCode: nextTicketCode(), ...body });
}

async function checkOut(accessToken: string, ticketCode: string, checkOutAt?: string) {
  return request(app)
    .post(`${API}/bills/from-sessions`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ ticketCodes: [ticketCode], checkOutAt });
}

/** Checks out the same visit once as a family ticket and once as a single child. */
async function billFamilyAndSingle(playPackageId: string, minutes: number) {
  const { accessToken } = await createAdmin();
  const checkInAt = minutesAgo(400);

  const family = await checkIn(accessToken, { childNames: FAMILY, playPackageId, checkInAt });
  const single = await checkIn(accessToken, { childName: 'Kasun', playPackageId, checkInAt });
  expect(family.status).toBe(201);
  expect(single.status).toBe(201);

  const familyBill = await checkOut(accessToken, family.body.data.ticketCode, exitAfter(checkInAt, minutes));
  const singleBill = await checkOut(accessToken, single.body.data.ticketCode, exitAfter(checkInAt, minutes));
  expect(familyBill.status).toBe(201);
  expect(singleBill.status).toBe(201);

  return { familyBill: familyBill.body.data, singleBill: singleBill.body.data };
}

describe('family tickets', () => {
  describe('check-in', () => {
    it('opens one ticket covering every child', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createPlayPackage({ durationMinutes: 60, price: 100_000 });

      const res = await checkIn(accessToken, { childNames: FAMILY, playPackageId: pkg.id });

      expect(res.status).toBe(201);
      expect(res.body.data.childNames).toEqual(FAMILY);
      expect(res.body.data.childCount).toBe(3);
      expect(res.body.data.childName).toBe('Amal, Nimal, Sara');
    });

    it('still reports a single child as a ticket of one', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createPlayPackage();

      const res = await checkIn(accessToken, { childName: 'Kasun', playPackageId: pkg.id });

      expect(res.status).toBe(201);
      expect(res.body.data.childNames).toEqual(['Kasun']);
      expect(res.body.data.childCount).toBe(1);
    });

    it('is idempotent on the ticket code, so a retried sync never books the family twice', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createPlayPackage();
      const ticketCode = nextTicketCode();

      const first = await checkIn(accessToken, { ticketCode, childNames: FAMILY, playPackageId: pkg.id });
      const replay = await checkIn(accessToken, { ticketCode, childNames: FAMILY, playPackageId: pkg.id });

      expect(first.status).toBe(201);
      expect(replay.status).toBe(200);
      expect(replay.body.data.id).toBe(first.body.data.id);
      expect(await PlaySessionModel.countDocuments({ ticketCode })).toBe(1);
    });

    it.each([
      ['no names at all', {}],
      ['both a name and a list', { childName: 'Kasun', childNames: FAMILY }],
      ['an empty list', { childNames: [] }],
      ['a blank name', { childNames: ['Amal', '  '] }],
      ['more than ten children', { childNames: Array.from({ length: 11 }, (_, i) => `Child ${i + 1}`) }],
    ])('rejects %s', async (_label, names) => {
      const { accessToken } = await createCashier();
      const pkg = await createPlayPackage();

      const res = await checkIn(accessToken, { playPackageId: pkg.id, ...names });

      expect(res.status).toBe(400);
    });
  });

  describe('pricing', () => {
    it('quotes the whole family and keeps the per-child figure alongside', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createPlayPackage({ durationMinutes: 60, price: 100_000 });
      const checkInAt = minutesAgo(30);

      const created = await checkIn(accessToken, { childNames: FAMILY, playPackageId: pkg.id, checkInAt });
      const res = await request(app)
        .get(`${API}/play-sessions/ticket/${encodeURIComponent(created.body.data.ticketCode)}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      const { quote } = res.body.data;
      expect(quote.childCount).toBe(3);
      expect(quote.lineTotal).toBe(quote.perChildLineTotal * 3);
      // The breakdown explains one child's price.
      expect(quote.breakdown.lineTotal).toBe(quote.perChildLineTotal);
    });

    it('bills a pro-rata family at three times one child, on one line', async () => {
      const pkg = await createPlayPackage({ durationMinutes: 60, price: 100_000 });

      // 75 minutes at LKR 1000.00/hour is LKR 1250.00 a child.
      const { familyBill, singleBill } = await billFamilyAndSingle(pkg.id, 75);

      expect(singleBill.grandTotal).toBe(125_000);
      expect(familyBill.grandTotal).toBe(375_000);
      expect(familyBill.items).toHaveLength(1);
      expect(familyBill.items[0]).toMatchObject({
        childName: 'Amal, Nimal, Sara',
        quantity: 3,
        lineTotal: 375_000,
        billedMinutes: 75,
      });
    });

    it('applies the minimum billable time per child', async () => {
      await BusinessSettingsModel.updateOne({}, { $set: { minimumBillableMinutes: 15 } }, { upsert: true });
      const pkg = await createPlayPackage({ durationMinutes: 60, price: 100_000 });

      const { familyBill, singleBill } = await billFamilyAndSingle(pkg.id, 5);

      expect(singleBill.grandTotal).toBe(25_000);
      expect(familyBill.grandTotal).toBe(75_000);
    });

    it('bills a block-with-grace family at three times one child', async () => {
      const pkg = await createPlayPackage({
        durationMinutes: 60,
        price: 60_000,
        pricingMode: SessionPricingMode.BLOCK_WITH_GRACE,
        graceMinutes: 10,
      });

      const { familyBill, singleBill } = await billFamilyAndSingle(pkg.id, 71);

      expect(singleBill.grandTotal).toBe(71_000);
      expect(familyBill.grandTotal).toBe(213_000);
    });

    describe('tiered hourly', () => {
      beforeEach(() => {
        env.tieredPricingEnabled = true;
      });
      afterEach(() => {
        env.tieredPricingEnabled = false;
      });

      it('rounds one child and multiplies, so the family matches separate tickets', async () => {
        const pkg = await createPlayPackage({
          durationMinutes: 60,
          price: 60_000,
          pricingMode: SessionPricingMode.TIERED_HOURLY,
          graceMinutes: 10,
          tieredPricing: {
            hourlyRates: [60_000, 50_000, 40_000, 40_000],
            overtimeMode: OvertimeMode.PER_MINUTE,
            overtimeBlockMinutes: 15,
            roundingStep: 10_000,
            roundingMode: RoundingMode.UP,
          },
        });

        const { familyBill, singleBill } = await billFamilyAndSingle(pkg.id, 95);

        expect(familyBill.grandTotal).toBe(singleBill.grandTotal * 3);
        expect(familyBill.items[0].quantity).toBe(3);
      });
    });

    it('freezes the family total on the ticket and clears it if the bill is cancelled', async () => {
      const { accessToken } = await createAdmin();
      const pkg = await createPlayPackage({ durationMinutes: 60, price: 100_000 });
      const checkInAt = minutesAgo(200);
      const created = await checkIn(accessToken, { childNames: FAMILY, playPackageId: pkg.id, checkInAt });
      const ticketCode = created.body.data.ticketCode;

      const bill = await checkOut(accessToken, ticketCode, exitAfter(checkInAt, 60));
      expect((await PlaySessionModel.findOne({ ticketCode }))?.chargedAmount).toBe(300_000);

      await request(app)
        .post(`${API}/bills/${bill.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ reason: 'Wrong family' });

      const reopened = await PlaySessionModel.findOne({ ticketCode });
      expect(reopened?.status).toBe('ACTIVE');
      expect(reopened?.chargedAmount).toBeNull();
      expect(reopened?.childCount).toBe(3);
    });

    it('prints every child and the per-child price on the receipt', async () => {
      const { accessToken } = await createAdmin();
      const pkg = await createPlayPackage({ name: '1 Hour', durationMinutes: 60, price: 100_000 });
      const checkInAt = minutesAgo(200);
      const created = await checkIn(accessToken, { childNames: FAMILY, playPackageId: pkg.id, checkInAt });
      const draft = await checkOut(accessToken, created.body.data.ticketCode, exitAfter(checkInAt, 60));
      await request(app)
        .post(`${API}/bills/${draft.body.data.id}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ paymentMethod: 'CASH' });

      const receipt = await request(app)
        .get(`${API}/bills/${draft.body.data.id}/receipt/text`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(receipt.status).toBe(200);
      expect(receipt.text).toContain('Children (3): Amal, Nimal, Sara');
      expect(receipt.text).toMatch(/Per child +1,?000\.00/);
      expect(receipt.text).toMatch(/1 Hour x 3 +3,?000\.00/);
    });

    it('bills a ticket from before family tickets as one child', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createPlayPackage({ durationMinutes: 60, price: 100_000 });
      const checkInAt = minutesAgo(200);
      const created = await checkIn(accessToken, { childName: 'Kasun', playPackageId: pkg.id, checkInAt });
      const ticketCode = created.body.data.ticketCode;
      // Strip the new fields, as on a ticket written by the previous release.
      await PlaySessionModel.collection.updateOne({ ticketCode }, { $unset: { childCount: '', childNames: '' } });

      const bill = await checkOut(accessToken, ticketCode, exitAfter(checkInAt, 60));

      expect(bill.status).toBe(201);
      expect(bill.body.data.grandTotal).toBe(100_000);
      expect(bill.body.data.items[0].quantity).toBe(1);
    });
  });

  describe('reporting', () => {
    it('counts every child on a family ticket as a child served', async () => {
      const { accessToken: adminToken } = await createAdmin();
      const pkg = await createPlayPackage({ durationMinutes: 60, price: 100_000 });
      const checkInAt = minutesAgo(90);
      const created = await checkIn(adminToken, { childNames: FAMILY, playPackageId: pkg.id, checkInAt });

      const draft = await checkOut(adminToken, created.body.data.ticketCode, exitAfter(checkInAt, 60));
      const paid = await request(app)
        .post(`${API}/bills/${draft.body.data.id}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentMethod: 'CASH' });
      expect(paid.status).toBe(200);

      const today = businessDate();
      const [summary, register, sessions, dashboardSessions] = await Promise.all([
        request(app).get(`${API}/dashboard/summary?from=${today}&to=${today}`).set('Authorization', `Bearer ${adminToken}`),
        request(app)
          .get(`${API}/reports/bill-register?from=${today}&to=${today}`)
          .set('Authorization', `Bearer ${adminToken}`),
        request(app).get(`${API}/reports/sessions?from=${today}&to=${today}`).set('Authorization', `Bearer ${adminToken}`),
        request(app).get(`${API}/dashboard/sessions?period=today`).set('Authorization', `Bearer ${adminToken}`),
      ]);

      expect(summary.body.data.childrenServed).toBe(3);
      expect(register.body.data[0].childrenCount).toBe(3);
      expect(sessions.body.data[0].childCount).toBe(3);
      expect(dashboardSessions.body.data.sessionCount).toBe(1);
      expect(dashboardSessions.body.data.childCount).toBe(3);
      // Three children for an hour is three hours of play.
      expect(dashboardSessions.body.data.totalPlayMinutes).toBe(180);
      expect(dashboardSessions.body.data.averagePlayMinutes).toBe(60);
      expect(dashboardSessions.body.data.revenuePerPlayHour).toBe(100_000);

      // The period summary's buckets count child-minutes too, so they add up to its total.
      const period = await request(app)
        .get(`${API}/reports/period-summary?from=${today}&to=${today}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(period.status).toBe(200);
      expect(period.body.data.totalsRow.playMinutes).toBe(180);
      expect(period.body.data.buckets[0].playMinutes).toBe(180);
    });

    it('counts each child on a family ticket in the hours it was present', async () => {
      const { accessToken: adminToken } = await createAdmin();
      const now = new Date();
      await PlaySessionModel.create({
        ticketCode: nextTicketCode(),
        status: 'ACTIVE',
        childName: FAMILY.join(', '),
        childNames: FAMILY,
        childCount: 3,
        playPackageId: new Types.ObjectId(),
        packageName: '1 Hour',
        rateDurationMinutes: 60,
        unitPrice: 100_000,
        checkInAt: new Date(now.getTime() - 5 * 60_000),
        checkInRecordedAt: now,
        checkInCashierId: new Types.ObjectId(),
        checkInCashierName: 'Test Cashier',
      });

      const res = await request(app)
        .get(`${API}/dashboard/occupancy?period=today`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const total = res.body.data.reduce((sum: number, point: { childCount: number }) => sum + point.childCount, 0);
      expect(total).toBeGreaterThanOrEqual(3);
      expect(total % 3).toBe(0);
    });
  });
});
