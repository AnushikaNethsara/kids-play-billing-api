/**
 * The automatic multi-child discount: an admin sets tiers in Settings, and a bill with that
 * many children on play gets the percentage off its play time. Products are charged in
 * full, the cashier's discount applies on top to what is left, and the rule is snapshotted
 * on the draft.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage, createProduct } from './helpers/factories';
import { SessionPricingMode } from '../src/common/constants/pricingModes';

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';
const TIERS = [
  { minChildren: 2, percentage: 10 },
  { minChildren: 3, percentage: 20 },
];

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:multi-${Date.now()}-${ticketCounter}`;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function setTiers(adminToken: string, tiers: typeof TIERS) {
  const res = await request(app).patch(`${API}/settings`).set(auth(adminToken)).send({ multiChildDiscountTiers: tiers });
  expect(res.status).toBe(200);
}

/** LKR 350 per started 30m block - 20 minutes in, each child costs exactly 350. */
function createBlock() {
  return createPlayPackage({
    name: '30m block',
    durationMinutes: 30,
    price: 35_000,
    pricingMode: SessionPricingMode.BLOCK_WITH_GRACE,
    graceMinutes: 5,
  });
}

async function checkIn(
  token: string,
  playPackageId: string,
  options: { childNames?: string[]; extras?: { productId: string; quantity: number }[] } = {},
) {
  const ticketCode = nextTicketCode();
  const res = await request(app)
    .post(`${API}/play-sessions`)
    .set(auth(token))
    .send({
      ticketCode,
      ...(options.childNames ? { childNames: options.childNames } : { childName: 'Kasun' }),
      playPackageId,
      checkInAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      customer: { parentName: 'Nimal Perera', phoneNumber: '0771234567' },
      ...(options.extras
        ? { extras: options.extras.map((extra, i) => ({ ...extra, localId: `${ticketCode}-x${i}` })) }
        : {}),
    });
  expect(res.status).toBe(201);
  return ticketCode;
}

function checkOut(token: string, ticketCodes: string[], discount?: { type: string; value: number }) {
  return request(app)
    .post(`${API}/bills/from-sessions`)
    .set(auth(token))
    .send({ ticketCodes, ...(discount ? { discount } : {}) });
}

async function pay(token: string, billId: string) {
  const res = await request(app).post(`${API}/bills/${billId}/complete`).set(auth(token)).send({ paymentMethod: 'CASH' });
  expect(res.status).toBe(200);
  return res.body.data.bill;
}

describe('multi-child discount', () => {
  it('takes 10% off the play time of a family ticket of two, and none off the socks', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    await setTiers(adminToken, TIERS);
    const pkg = await createBlock();
    const product = await createProduct({ price: 30_000 });
    const ticket = await checkIn(accessToken, pkg.id, {
      childNames: ['Kasun', 'Nimali'],
      extras: [{ productId: product.id, quantity: 1 }],
    });

    const res = await checkOut(accessToken, [ticket]);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      subtotal: 100_000,
      multiChildDiscount: 7_000,
      multiChildDiscountPercentage: 10,
      multiChildCount: 2,
      discount: 7_000,
      grandTotal: 93_000,
    });
  });

  it('counts tickets checked out together - three children get the 20% tier', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    await setTiers(adminToken, TIERS);
    const pkg = await createBlock();
    const tickets = [await checkIn(accessToken, pkg.id), await checkIn(accessToken, pkg.id), await checkIn(accessToken, pkg.id)];

    const res = await checkOut(accessToken, tickets);
    expect(res.body.data).toMatchObject({ multiChildCount: 3, multiChildDiscount: 21_000, grandTotal: 84_000 });
  });

  it("lets a cashier's discount apply on top, capped against the manual part only", async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    await setTiers(adminToken, TIERS);
    const pkg = await createBlock();

    const ok = await checkOut(accessToken, [await checkIn(accessToken, pkg.id, { childNames: ['A', 'B', 'C'] })], {
      type: 'PERCENTAGE',
      value: 10,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ multiChildDiscount: 21_000, discount: 29_400, grandTotal: 75_600 });

    // The default cashier cap is 10%: 15% manual is refused even though 20% came off already.
    const refused = await checkOut(accessToken, [await checkIn(accessToken, pkg.id, { childNames: ['D', 'E', 'F'] })], {
      type: 'PERCENTAGE',
      value: 15,
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });

  it('gives a single child nothing, and nobody anything when no tiers are set', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    const pkg = await createBlock();

    const untiered = await checkOut(accessToken, [await checkIn(accessToken, pkg.id, { childNames: ['A', 'B'] })]);
    expect(untiered.body.data).toMatchObject({ multiChildDiscount: 0, grandTotal: 70_000 });

    await setTiers(adminToken, TIERS);
    const single = await checkOut(accessToken, [await checkIn(accessToken, pkg.id)]);
    expect(single.body.data).toMatchObject({ multiChildDiscount: 0, multiChildDiscountPercentage: 0, grandTotal: 35_000 });
  });

  it('keeps the rule the draft was made under when the tiers change before payment', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    await setTiers(adminToken, TIERS);
    const pkg = await createBlock();
    const draft = await checkOut(accessToken, [await checkIn(accessToken, pkg.id, { childNames: ['A', 'B'] })]);

    await setTiers(adminToken, [{ minChildren: 2, percentage: 50 }]);
    const paid = await pay(accessToken, draft.body.data.id);
    expect(paid).toMatchObject({ multiChildDiscount: 7_000, grandTotal: 63_000 });
  });

  it('prints the automatic and the manual discount on separate receipt lines', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    await setTiers(adminToken, TIERS);
    const pkg = await createBlock();
    const draft = await checkOut(accessToken, [await checkIn(accessToken, pkg.id, { childNames: ['A', 'B'] })], {
      type: 'FIXED',
      value: 3_000,
    });
    const paid = await pay(accessToken, draft.body.data.id);

    const text = await request(app).get(`${API}/bills/${paid.id}/receipt/text`).set(auth(accessToken));
    expect(text.text).toMatch(/Multi-child \(2 kids, 10%\)\s+-70\.00/);
    expect(text.text).toMatch(/Discount\s+-30\.00/);
  });

  it('counts in the dashboard discounts, and the daily close still matches', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    await setTiers(adminToken, TIERS);
    const pkg = await createBlock();
    const draft = await checkOut(accessToken, [await checkIn(accessToken, pkg.id, { childNames: ['A', 'B'] })]);
    await pay(accessToken, draft.body.data.id);

    const today = DateTime.now().setZone(TIMEZONE).toISODate();
    const [summary, close] = await Promise.all([
      request(app).get(`${API}/dashboard/summary?from=${today}&to=${today}`).set(auth(adminToken)),
      request(app).get(`${API}/reports/daily-close?date=${today}`).set(auth(adminToken)),
    ]);
    expect(summary.body.data).toMatchObject({
      grossRevenue: 70_000,
      discounts: 7_000,
      multiChildDiscounts: 7_000,
      netRevenue: 63_000,
    });
    expect(close.body.data.summary).toEqual(summary.body.data);
  });

  it('still lets an admin correct the bill afterwards', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    await setTiers(adminToken, TIERS);
    const pkg = await createBlock();
    const draft = await checkOut(accessToken, [await checkIn(accessToken, pkg.id, { childNames: ['A', 'B'] })]);
    const paid = await pay(accessToken, draft.body.data.id);

    const tooMuch = await request(app)
      .post(`${API}/bills/${paid.id}/corrections`)
      .set(auth(adminToken))
      .send({ expectedRevision: 0, amountReceived: 63_001, reason: 'Testing the charge' });
    expect(tooMuch.status).toBe(422);

    const corrected = await request(app)
      .post(`${API}/bills/${paid.id}/corrections`)
      .set(auth(adminToken))
      .send({ expectedRevision: 0, amountReceived: 60_000, reason: 'Parent paid LKR 600' });
    expect(corrected.status).toBe(200);
    expect(corrected.body.data).toMatchObject({ writeOff: 3_000, grandTotal: 60_000, multiChildDiscount: 7_000 });
  });
});
