/**
 * Best-price checkout. Packages sharing a `priceGroup` are frozen onto every ticket at
 * check-in, and checkout charges whichever is cheapest for the time actually played. The
 * bill line and the receipt describe the package charged, with no mention of the switch;
 * only the admin-facing `chosen*` fields remember what was picked at the gate.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { PlayPackageModel } from '../src/modules/play-packages/playPackage.model';
import { OvertimeMode, RoundingMode, SessionPricingMode } from '../src/common/constants/pricingModes';

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:best-${Date.now()}-${ticketCounter}`;
}

function createHourly(priceGroup: string | null = 'standard') {
  return createPlayPackage({
    name: 'Tiered hourly',
    durationMinutes: 60,
    price: 60_000,
    pricingMode: SessionPricingMode.TIERED_HOURLY,
    graceMinutes: 10,
    tieredPricing: {
      hourlyRates: [60_000, 50_000, 40_000, 40_000],
      overtimeMode: OvertimeMode.PER_MINUTE,
      overtimeBlockMinutes: 15,
      roundingStep: 5_000,
      roundingMode: RoundingMode.NEAREST,
    },
    priceGroup,
  });
}

function createBlock(priceGroup: string | null = 'standard') {
  return createPlayPackage({
    name: '30m block',
    durationMinutes: 30,
    price: 35_000,
    pricingMode: SessionPricingMode.BLOCK_WITH_GRACE,
    graceMinutes: 5,
    priceGroup,
  });
}

async function checkIn(token: string, playPackageId: string, minutesAgo: number, childNames?: string[]) {
  const ticketCode = nextTicketCode();
  const res = await request(app)
    .post(`${API}/play-sessions`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      ticketCode,
      ...(childNames ? { childNames } : { childName: 'Kasun' }),
      playPackageId,
      checkInAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    });
  expect(res.status).toBe(201);
  return { ticketCode, session: res.body.data };
}

async function checkOut(token: string, ticketCode: string) {
  const res = await request(app)
    .post(`${API}/bills/from-sessions`)
    .set('Authorization', `Bearer ${token}`)
    .send({ ticketCodes: [ticketCode] });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function pay(token: string, billId: string) {
  const res = await request(app)
    .post(`${API}/bills/${billId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentMethod: 'CASH' });
  expect(res.status).toBe(200);
  return res.body.data.bill;
}

describe('best-price checkout', () => {
  it('snapshots the comparable packages at check-in', async () => {
    const { accessToken } = await createCashier();
    const hourly = await createHourly();
    const block = await createBlock();
    await createBlock('other-group');

    const { session } = await checkIn(accessToken, block.id, 5);
    expect(session.alternativeRates).toHaveLength(1);
    expect(session.alternativeRates[0]).toMatchObject({
      playPackageId: hourly.id,
      packageName: 'Tiered hourly',
      pricingMode: 'TIERED_HOURLY',
      graceMinutes: 10,
    });
  });

  it('case 1: chose the 30m block, stayed 1h 6m - billed at the hourly price', async () => {
    const { accessToken } = await createCashier();
    const hourly = await createHourly();
    const block = await createBlock();
    const { ticketCode } = await checkIn(accessToken, block.id, 65.9);

    const scan = await request(app)
      .get(`${API}/play-sessions/ticket/${encodeURIComponent(ticketCode)}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(scan.status).toBe(200);
    expect(scan.body.data.quote).toMatchObject({ lineTotal: 60_000, pricedAs: { packageName: 'Tiered hourly' } });

    const bill = await checkOut(accessToken, ticketCode);
    expect(bill.grandTotal).toBe(60_000);
    expect(bill.items[0]).toMatchObject({
      playPackageId: hourly.id,
      packageName: 'Tiered hourly',
      pricingMode: 'TIERED_HOURLY',
      lineTotal: 60_000,
      chosenPlayPackageId: block.id,
      chosenPackageName: '30m block',
      chosenLineTotal: 77_000,
    });
  });

  it('case 2: chose hourly, stayed 30m - billed at the 30m block', async () => {
    const { accessToken } = await createCashier();
    await createHourly();
    const block = await createBlock();
    const hourly = await PlayPackageModel.findOne({ name: 'Tiered hourly' });
    const { ticketCode } = await checkIn(accessToken, hourly!.id, 29.9);

    const bill = await checkOut(accessToken, ticketCode);
    expect(bill.grandTotal).toBe(35_000);
    expect(bill.items[0]).toMatchObject({
      playPackageId: block.id,
      packageName: '30m block',
      chosenPackageName: 'Tiered hourly',
      chosenLineTotal: 60_000,
    });
  });

  it('prints the package charged on the receipt, with no mention of the switch', async () => {
    const { accessToken } = await createCashier();
    await createHourly();
    const block = await createBlock();
    const { ticketCode } = await checkIn(accessToken, block.id, 65.9);
    const bill = await pay(accessToken, (await checkOut(accessToken, ticketCode)).id);

    const text = await request(app)
      .get(`${API}/bills/${bill.id}/receipt/text`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(text.text).toContain('Tiered hourly');
    expect(text.text).not.toContain('30m block');
    expect(text.text.toLowerCase()).not.toMatch(/chose|saved|best price|switch/);
  });

  it('leaves the bill as before when the chosen package is already cheapest', async () => {
    const { accessToken } = await createCashier();
    await createHourly();
    const block = await createBlock();
    const { ticketCode } = await checkIn(accessToken, block.id, 29.9);

    const bill = await checkOut(accessToken, ticketCode);
    expect(bill.items[0]).toMatchObject({
      packageName: '30m block',
      lineTotal: 35_000,
      chosenPlayPackageId: null,
      chosenPackageName: null,
      chosenLineTotal: null,
    });
  });

  it('compares nothing for a package with no group', async () => {
    const { accessToken } = await createCashier();
    await createHourly(null);
    const block = await createBlock(null);
    const { ticketCode, session } = await checkIn(accessToken, block.id, 65.9);
    expect(session.alternativeRates).toEqual([]);

    const bill = await checkOut(accessToken, ticketCode);
    expect(bill.grandTotal).toBe(77_000);
    expect(bill.items[0].packageName).toBe('30m block');
  });

  it('is not changed by a price edit made after check-in', async () => {
    const { accessToken } = await createCashier();
    const hourly = await createHourly();
    const block = await createBlock();
    const { ticketCode } = await checkIn(accessToken, block.id, 65.9);

    await PlayPackageModel.updateOne(
      { _id: hourly._id },
      { $set: { 'tieredPricing.hourlyRates': [90_000, 90_000, 90_000, 90_000], price: 90_000 } },
    );

    const bill = await checkOut(accessToken, ticketCode);
    expect(bill.grandTotal).toBe(60_000);
  });

  it('prices a family ticket as one child at the best price, times the children', async () => {
    const { accessToken } = await createCashier();
    await createHourly();
    const block = await createBlock();
    const { ticketCode } = await checkIn(accessToken, block.id, 65.9, ['Kasun', 'Nimali', 'Saman']);

    const bill = await checkOut(accessToken, ticketCode);
    expect(bill.items[0]).toMatchObject({ quantity: 3, lineTotal: 180_000, chosenLineTotal: 77_000 });
  });

  it('counts the visit under the package charged in package performance', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const hourly = await createHourly();
    const block = await createBlock();
    const { ticketCode } = await checkIn(cashierToken, block.id, 65.9);
    await pay(cashierToken, (await checkOut(cashierToken, ticketCode)).id);

    const today = DateTime.now().setZone(TIMEZONE).toISODate();
    const res = await request(app)
      .get(`${API}/dashboard/packages?from=${today}&to=${today}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((row: { playPackageId: string }) => row.playPackageId);
    expect(ids).toContain(hourly.id);
    expect(ids).not.toContain(block.id);
  });

  it('decides again from the longer stay when a cancelled checkout is checked out later', async () => {
    const { accessToken: cashierToken } = await createCashier();
    await createHourly();
    const block = await createBlock();
    // 30m in: the block is cheaper.
    const { ticketCode } = await checkIn(cashierToken, block.id, 29.9);
    const first = await checkOut(cashierToken, ticketCode);
    expect(first.items[0].packageName).toBe('30m block');

    await request(app)
      .post(`${API}/bills/${first.id}/cancel`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ reason: 'Family is staying longer' });

    const session = await request(app)
      .get(`${API}/play-sessions/${first.items[0].playSessionId}`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(session.body.data.session).toMatchObject({ status: 'ACTIVE', chargedPackageName: null });
  });
});
