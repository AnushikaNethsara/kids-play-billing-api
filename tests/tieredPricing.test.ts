import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { env } from '../src/config';
import {
  OvertimeMode,
  RoundingMode,
  SessionPricingMode,
  type TieredPricing,
} from '../src/common/constants/pricingModes';

const API = '/api/v1';

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:tiered-${Date.now()}-${ticketCounter}`;
}

const TIERS: TieredPricing = {
  hourlyRates: [60_000, 50_000, 40_000, 40_000],
  overtimeMode: OvertimeMode.PER_MINUTE,
  overtimeBlockMinutes: 15,
  roundingStep: 0,
  roundingMode: RoundingMode.NEAREST,
};

async function createTieredPackage(overrides: Partial<TieredPricing> = {}) {
  return createPlayPackage({
    name: 'Tiered Hourly',
    durationMinutes: 60,
    price: 60_000,
    pricingMode: SessionPricingMode.TIERED_HOURLY,
    graceMinutes: 10,
    tieredPricing: { ...TIERS, ...overrides },
  });
}

/** Far enough back that every exit time under test is still in the past. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function exitAfter(checkInAt: string, minutes: number): string {
  return new Date(new Date(checkInAt).getTime() + minutes * 60_000).toISOString();
}

async function checkIn(accessToken: string, playPackageId: string, checkInAt: string) {
  return request(app)
    .post(`${API}/play-sessions`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ ticketCode: nextTicketCode(), childName: 'Kasun', playPackageId, checkInAt });
}

async function checkOut(accessToken: string, ticketCode: string, checkOutAt: string) {
  return request(app)
    .post(`${API}/bills/from-sessions`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ ticketCodes: [ticketCode], checkOutAt });
}

describe('tiered hourly pricing', () => {
  beforeEach(() => {
    env.tieredPricingEnabled = true;
  });
  afterEach(() => {
    env.tieredPricingEnabled = false;
  });

  it('snapshots the tiers onto the session at check-in', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createTieredPackage();

    const res = await checkIn(accessToken, pkg.id, minutesAgo(300));

    expect(res.status).toBe(201);
    expect(res.body.data.pricingMode).toBe('TIERED_HOURLY');
    expect(res.body.data.graceMinutes).toBe(10);
    expect(res.body.data.tieredPricing).toEqual(TIERS);
  });

  it.each([
    [30, 60_000],
    [70, 60_000],
    [71, 69_167],
    [131, 117_333],
    [240, 190_000],
  ])('bills a %i-minute visit at %i', async (minutes, expected) => {
    const { accessToken } = await createCashier();
    const pkg = await createTieredPackage();
    const checkInAt = minutesAgo(300);

    const session = await checkIn(accessToken, pkg.id, checkInAt);
    const res = await checkOut(
      accessToken,
      session.body.data.ticketCode,
      exitAfter(checkInAt, minutes),
    );

    expect(res.status).toBe(201);
    expect(res.body.data.items[0].lineTotal).toBe(expected);
    expect(res.body.data.subtotal).toBe(expected);
    expect(res.body.data.items[0].billedMinutes).toBe(minutes);
  });

  it('returns the hour split and rounding on the bill item', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createTieredPackage({ roundingStep: 1_000, roundingMode: RoundingMode.UP });
    const checkInAt = minutesAgo(300);

    const session = await checkIn(accessToken, pkg.id, checkInAt);
    const res = await checkOut(accessToken, session.body.data.ticketCode, exitAfter(checkInAt, 131));

    const item = res.body.data.items[0];
    expect(item.pricingMode).toBe('TIERED_HOURLY');
    expect(item.hourLines).toEqual([
      { hour: 1, rate: 60_000, amount: 60_000 },
      { hour: 2, rate: 50_000, amount: 50_000 },
    ]);
    expect(item.overtime).toMatchObject({ hour: 3, minutes: 11, amount: 7_333 });
    expect(item.rawTotal).toBe(117_333);
    expect(item.lineTotal).toBe(118_000);
    expect(item.roundingAdjustment).toBe(667);
  });

  it('keeps charging the snapshot after the package is repriced', async () => {
    const { accessToken } = await createCashier();
    const admin = await createAdmin();
    const pkg = await createTieredPackage();
    const checkInAt = minutesAgo(300);
    const session = await checkIn(accessToken, pkg.id, checkInAt);

    const patch = await request(app)
      .patch(`${API}/play-packages/${pkg.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ tieredPricing: { ...TIERS, hourlyRates: [90_000, 90_000, 90_000, 90_000] } });
    expect(patch.status).toBe(200);
    expect(patch.body.data.price).toBe(90_000);

    const res = await checkOut(accessToken, session.body.data.ticketCode, exitAfter(checkInAt, 71));
    expect(res.body.data.items[0].lineTotal).toBe(69_167);
  });

  it('prints the hours, extra time and rounding on the receipt', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createTieredPackage({ roundingStep: 100, roundingMode: RoundingMode.NEAREST });
    const checkInAt = minutesAgo(300);
    const session = await checkIn(accessToken, pkg.id, checkInAt);
    const draft = await checkOut(
      accessToken,
      session.body.data.ticketCode,
      exitAfter(checkInAt, 131),
    );

    const paid = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', `tiered-${draft.body.data.id}`)
      .send({ paymentMethod: 'CASH', paidAmount: 117_300 });
    expect(paid.status).toBe(200);

    const receipt = await request(app)
      .get(`${API}/bills/${draft.body.data.id}/receipt/text`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(receipt.status).toBe(200);
    expect(receipt.text).toMatch(/Hour 1 @600\/h +600\.00/);
    expect(receipt.text).toMatch(/Hour 2 @500\/h +500\.00/);
    expect(receipt.text).toMatch(/Extra 11m @400\/h +73\.33/);
    expect(receipt.text).toMatch(/Rounding +-0\.33/);
    expect(receipt.text).toMatch(/Tiered Hourly +1,173\.00/);
    for (const line of receipt.text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
  });

  it('collapses the hours from the 4th on into one receipt row', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createTieredPackage();
    const checkInAt = minutesAgo(400);
    const session = await checkIn(accessToken, pkg.id, checkInAt);
    const draft = await checkOut(
      accessToken,
      session.body.data.ticketCode,
      exitAfter(checkInAt, 360),
    );
    await request(app)
      .post(`${API}/bills/${draft.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', `tiered-${draft.body.data.id}`)
      .send({ paymentMethod: 'CASH', paidAmount: 270_000 });

    const receipt = await request(app)
      .get(`${API}/bills/${draft.body.data.id}/receipt/text`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(receipt.text).toMatch(/Hrs 4-6 @400\/h +1,200\.00/);
    expect(receipt.text).not.toMatch(/Hour 5/);
  });

  describe('package configuration', () => {
    async function createViaApi(body: Record<string, unknown>) {
      const { accessToken } = await createAdmin();
      return request(app)
        .post(`${API}/play-packages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Tiered', pricingMode: 'TIERED_HOURLY', graceMinutes: 10, ...body });
    }

    it('creates a tiered package, deriving its duration and price from the tiers', async () => {
      const res = await createViaApi({
        tieredPricing: { hourlyRates: TIERS.hourlyRates, overtimeMode: 'PER_MINUTE' },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.durationMinutes).toBe(60);
      expect(res.body.data.price).toBe(60_000);
      expect(res.body.data.tieredPricing).toEqual(TIERS);
    });

    it.each([
      ['three rates', { hourlyRates: [60_000, 50_000, 40_000], overtimeMode: 'PER_MINUTE' }, 10],
      ['an invalid rounding step', { ...TIERS, roundingStep: 2_500 }, 10],
      ['a block longer than an hour', { ...TIERS, overtimeMode: 'BLOCK', overtimeBlockMinutes: 90 }, 10],
      ['a grace of a whole hour', TIERS, 60],
    ])('rejects %s', async (_label, tieredPricing, graceMinutes) => {
      const res = await createViaApi({ tieredPricing, graceMinutes });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a tiered package with no tiers', async () => {
      const res = await createViaApi({});
      expect(res.status).toBe(400);
    });

    it('refuses tiered packages while the feature flag is off', async () => {
      env.tieredPricingEnabled = false;
      const res = await createViaApi({ tieredPricing: TIERS });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/TIERED_PRICING_ENABLED/);
    });

    it('audits a change of tier rates as a price change', async () => {
      const { accessToken } = await createAdmin();
      const pkg = await createTieredPackage();

      await request(app)
        .patch(`${API}/play-packages/${pkg.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ tieredPricing: { ...TIERS, hourlyRates: [60_000, 45_000, 40_000, 40_000] } });

      const logs = await request(app)
        .get(`${API}/audit-logs?entityType=PLAY_PACKAGE`)
        .set('Authorization', `Bearer ${accessToken}`);

      const actions = logs.body.data.map((entry: { action: string }) => entry.action);
      expect(actions).toContain('PACKAGE_PRICE_CHANGED');
    });
  });
});
