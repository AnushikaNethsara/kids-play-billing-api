import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import {
  createAdmin,
  createCashier,
  createPlayPackage,
  createProduct,
  createSubscriptionPlan,
} from './helpers/factories';
import { SubscriptionModel } from '../src/modules/subscriptions/subscription.model';
import { SubscriptionLedgerModel } from '../src/modules/subscriptions/subscriptionLedger.model';
import { subscriptionService } from '../src/modules/subscriptions/subscription.service';
import { subscriptionRepository } from '../src/modules/subscriptions/subscription.repository';
import { BillModel } from '../src/modules/bills/bill.model';

const API = '/api/v1';
const PHONE = '0771234567';

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:sub-${Date.now()}-${ticketCounter}`;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Sells a subscription end to end - draft, then payment - and returns it. */
async function sellSubscription(
  token: string,
  planId: string,
  children: string[] = ['Amal', 'Sara'],
  idempotencyKey?: string,
) {
  const draft = await request(app)
    .post(`${API}/bills`)
    .set(auth(token))
    .send({
      customer: { parentName: 'Nimal Perera', phoneNumber: PHONE },
      items: [{ kind: 'SUBSCRIPTION', subscriptionPlanId: planId, children }],
    });
  expect(draft.status).toBe(201);

  const paying = request(app).post(`${API}/bills/${draft.body.data.id}/complete`).set(auth(token));
  if (idempotencyKey) paying.set('Idempotency-Key', idempotencyKey);
  const paid = await paying.send({ paymentMethod: 'CASH' });
  expect(paid.status).toBe(200);

  const subscription = await SubscriptionModel.findOne({ saleBillId: draft.body.data.id }).exec();
  expect(subscription).not.toBeNull();
  return { billId: draft.body.data.id as string, subscription: subscription!, paid };
}

function checkInOnSubscription(
  token: string,
  subscriptionId: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post(`${API}/play-sessions`)
    .set(auth(token))
    .send({
      ticketCode: nextTicketCode(),
      childNames: ['Amal', 'Sara'],
      subscriptionId,
      ...overrides,
    });
}

function checkOut(token: string, ticketCodes: string[]) {
  return request(app).post(`${API}/bills/from-sessions`).set(auth(token)).send({ ticketCodes });
}

async function reload(id: string) {
  return (await SubscriptionModel.findById(id).exec())!;
}

/** The counters and the ledger must always tell the same story. */
async function expectLedgerAgrees(id: string) {
  const subscription = await reload(id);
  const delta = await subscriptionRepository.ledgerBalanceDelta(id);
  expect(subscription.creditsPurchased + delta).toBe(subscription.creditsTotal - subscription.creditsUsed);
}

describe('subscription plans', () => {
  it('lets an admin create a plan and refuses a grace as long as the visit', async () => {
    const { accessToken } = await createAdmin();

    const created = await request(app)
      .post(`${API}/subscription-plans`)
      .set(auth(accessToken))
      .send({ name: 'Monthly 8', price: 300_000, visitCredits: 8, visitMinutes: 120, graceMinutes: 10, extraBlockPrice: 80_000 });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ visitCredits: 8, visitMinutes: 120, graceMinutes: 10, maxChildren: null });

    const bad = await request(app)
      .post(`${API}/subscription-plans`)
      .set(auth(accessToken))
      .send({ name: 'Bad', price: 1, visitCredits: 1, visitMinutes: 60, graceMinutes: 60, extraBlockPrice: 1 });
    expect(bad.status).toBe(400);

    const lowered = await request(app)
      .patch(`${API}/subscription-plans/${created.body.data.id}`)
      .set(auth(accessToken))
      .send({ visitMinutes: 10 });
    expect(lowered.status).toBe(400);
  });

  it('keeps plan management admin-only and shows cashiers active plans only', async () => {
    const { accessToken } = await createCashier();
    await createSubscriptionPlan({ name: 'On sale' });
    await createSubscriptionPlan({ name: 'Retired', isActive: false });

    const create = await request(app)
      .post(`${API}/subscription-plans`)
      .set(auth(accessToken))
      .send({ name: 'X', price: 1, visitCredits: 1, visitMinutes: 60, extraBlockPrice: 1 });
    expect(create.status).toBe(403);

    const list = await request(app).get(`${API}/subscription-plans`).set(auth(accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((plan: { name: string }) => plan.name)).toEqual(['On sale']);
  });
});

describe('selling a subscription', () => {
  it('creates the subscription when the sale is paid, snapshotting every term', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan({ price: 300_000, visitCredits: 8 });

    const { subscription, paid, billId } = await sellSubscription(accessToken, plan.id);

    expect(paid.body.data.bill.grandTotal).toBe(300_000);
    expect(subscription.code).toMatch(/^KPS-[A-Z2-9]{8}$/);
    expect(subscription.creditsTotal).toBe(8);
    expect(subscription.creditsUsed).toBe(0);
    expect(subscription.children.map((child) => child.name)).toEqual(['Amal', 'Sara']);
    // Valid to the end of the same day next month.
    const paidAt = new Date(paid.body.data.bill.paidAt);
    expect(subscription.startsAt.getTime()).toBe(paidAt.getTime());
    expect(subscription.expiresAt.getTime()).toBeGreaterThan(paidAt.getTime() + 27 * 24 * 3600_000);

    // The card is written back onto the line, so the receipt prints it.
    const line = paid.body.data.bill.items[0];
    expect(line.kind).toBe('SUBSCRIPTION');
    const bill = await BillModel.findById(billId).exec();
    expect(bill!.items[0].subscriptionSale!.code).toBe(subscription.code);
    const text = await request(app).get(`${API}/bills/${billId}/receipt/text`).set(auth(accessToken));
    expect(text.text).toContain(`Card: ${subscription.code}`);
    expect(text.text).toContain('8 visits x 1h');
  });

  it('never creates a second subscription for the same sale', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan();
    const { billId } = await sellSubscription(accessToken, plan.id, ['Amal'], 'pay-once-key');

    const bill = await BillModel.findById(billId).exec();
    await subscriptionService.ensureForBill(bill!, null);
    await subscriptionService.sweepMissing();

    expect(await SubscriptionModel.countDocuments({ saleBillId: billId })).toBe(1);
  });

  it('is unaffected by later edits to the plan', async () => {
    const { accessToken } = await createCashier();
    const admin = await createAdmin();
    const plan = await createSubscriptionPlan({ visitCredits: 8 });
    const { subscription } = await sellSubscription(accessToken, plan.id);

    await request(app)
      .patch(`${API}/subscription-plans/${plan.id}`)
      .set(auth(admin.accessToken))
      .send({ visitCredits: 2, price: 1 })
      .expect(200);

    const after = await reload(subscription.id);
    expect(after.creditsTotal).toBe(8);
    expect(after.price).toBe(300_000);
  });

  it('must be sold on its own bill, with a phone number, to named children within the plan limit', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan({ maxChildren: 2 });
    const product = await createProduct();
    const line = { kind: 'SUBSCRIPTION', subscriptionPlanId: plan.id, children: ['Amal'] };

    const mixed = await request(app)
      .post(`${API}/bills`)
      .set(auth(accessToken))
      .send({ customer: { phoneNumber: PHONE }, items: [line, { kind: 'PRODUCT', productId: product.id, quantity: 1 }] });
    expect(mixed.status).toBe(400);

    const noPhone = await request(app).post(`${API}/bills`).set(auth(accessToken)).send({ items: [line] });
    expect(noPhone.status).toBe(400);

    const tooMany = await request(app)
      .post(`${API}/bills`)
      .set(auth(accessToken))
      .send({ customer: { phoneNumber: PHONE }, items: [{ ...line, children: ['A', 'B', 'C'] }] });
    expect(tooMany.status).toBe(400);

    const twice = await request(app)
      .post(`${API}/bills`)
      .set(auth(accessToken))
      .send({ customer: { phoneNumber: PHONE }, items: [{ ...line, children: ['Amal', 'amal '] }] });
    expect(twice.status).toBe(400);
  });

  it('cannot be refunded, and can be cancelled only while unused', async () => {
    const { accessToken } = await createCashier();
    const admin = await createAdmin();
    const plan = await createSubscriptionPlan();

    const unused = await sellSubscription(accessToken, plan.id, ['Amal']);
    const refund = await request(app)
      .post(`${API}/bills/${unused.billId}/refund`)
      .set(auth(admin.accessToken))
      .send({ reason: 'changed mind' });
    expect(refund.status).toBe(409);

    const cancel = await request(app)
      .post(`${API}/bills/${unused.billId}/cancel`)
      .set(auth(admin.accessToken))
      .send({ reason: 'sold the wrong plan' });
    expect(cancel.status).toBe(200);
    expect((await reload(unused.subscription.id)).status).toBe('CANCELLED');

    const used = await sellSubscription(accessToken, plan.id, ['Amal']);
    await checkInOnSubscription(accessToken, used.subscription.id, { childNames: ['Amal'] }).expect(201);
    const refused = await request(app)
      .post(`${API}/bills/${used.billId}/cancel`)
      .set(auth(admin.accessToken))
      .send({ reason: 'too late' });
    expect(refused.status).toBe(409);
    expect((await BillModel.findById(used.billId).exec())!.status).toBe('PAID');
    expect((await reload(used.subscription.id)).status).toBe('ACTIVE');
  });

  it('counts the sale as subscription revenue and nobody through the door', async () => {
    const { accessToken } = await createCashier();
    const admin = await createAdmin();
    const plan = await createSubscriptionPlan({ price: 300_000 });
    await sellSubscription(accessToken, plan.id);

    const summary = await request(app).get(`${API}/dashboard/summary?period=today`).set(auth(admin.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data.revenueByKind.subscription).toBe(300_000);
    expect(summary.body.data.revenueByKind.play).toBe(0);
    expect(summary.body.data.subscriptionsSold).toBe(1);
    expect(summary.body.data.childrenServed).toBe(0);
  });
});

describe('checking in on a subscription', () => {
  it('reserves one credit per child and takes the family from the subscription', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan();
    const { subscription } = await sellSubscription(accessToken, plan.id);

    const res = await checkInOnSubscription(accessToken, subscription.id);

    expect(res.status).toBe(201);
    expect(res.body.data.playPackageId).toBeNull();
    expect(res.body.data.subscription).toMatchObject({ creditsReserved: 2, rejectedReason: null, code: subscription.code });
    expect(res.body.data.phoneNumber).toBe(subscription.phoneNumber);
    expect((await reload(subscription.id)).creditsUsed).toBe(2);
    expect(await SubscriptionLedgerModel.countDocuments({ subscriptionId: subscription._id, type: 'RESERVE' })).toBe(1);
    await expectLedgerAgrees(subscription.id);
  });

  it('does not reserve twice for a retried check-in', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan();
    const { subscription } = await sellSubscription(accessToken, plan.id);
    const ticketCode = nextTicketCode();

    await checkInOnSubscription(accessToken, subscription.id, { ticketCode }).expect(201);
    await checkInOnSubscription(accessToken, subscription.id, { ticketCode }).expect(200);

    expect((await reload(subscription.id)).creditsUsed).toBe(2);
    await expectLedgerAgrees(subscription.id);
  });

  it('gives the last credit to only one of two simultaneous check-ins', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan({ visitCredits: 1 });
    const { subscription } = await sellSubscription(accessToken, plan.id, ['Amal']);

    const results = await Promise.all([
      checkInOnSubscription(accessToken, subscription.id, { childNames: ['Amal'] }),
      checkInOnSubscription(accessToken, subscription.id, { childNames: ['Amal'] }),
    ]);

    // Both are accepted - a child at the gate is never turned away by a sync - but only one
    // holds the credit; the other will be charged in cash.
    expect(results.map((res) => res.status)).toEqual([201, 201]);
    const reasons = results.map((res) => res.body.data.subscription.rejectedReason).sort();
    expect(reasons).toEqual(['INSUFFICIENT_CREDITS', null].sort());
    expect((await reload(subscription.id)).creditsUsed).toBe(1);
    await expectLedgerAgrees(subscription.id);
  });

  it('accepts a child not named on the subscription but reserves nothing for them', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan();
    const { subscription } = await sellSubscription(accessToken, plan.id, ['Amal']);

    const res = await checkInOnSubscription(accessToken, subscription.id, { childNames: ['Cousin'] });

    expect(res.status).toBe(201);
    expect(res.body.data.subscription).toMatchObject({ creditsReserved: 0, rejectedReason: 'CHILD_NOT_ON_SUBSCRIPTION' });
    expect((await reload(subscription.id)).creditsUsed).toBe(0);
  });

  it('marks an expired subscription and charges the whole visit in cash', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan({ extraBlockPrice: 80_000 });
    const { subscription } = await sellSubscription(accessToken, plan.id, ['Amal']);
    // Expired before the child arrived.
    await SubscriptionModel.updateOne({ _id: subscription._id }, { $set: { expiresAt: new Date(Date.now() - 60 * 60_000) } });

    const res = await checkInOnSubscription(accessToken, subscription.id, {
      childNames: ['Amal'],
      checkInAt: minutesAgo(30),
    });
    expect(res.body.data.subscription.rejectedReason).toBe('EXPIRED');

    const bill = await checkOut(accessToken, [res.body.data.ticketCode]);
    expect(bill.status).toBe(201);
    expect(bill.body.data.grandTotal).toBe(80_000);
    expect(bill.body.data.items[0].subscription).toMatchObject({ creditsUsed: 0, shortfallBlocks: 1 });
  });

  it('gives a voided ticket its credits back exactly once', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan();
    const { subscription } = await sellSubscription(accessToken, plan.id);
    const session = await checkInOnSubscription(accessToken, subscription.id);

    await request(app)
      .post(`${API}/play-sessions/${session.body.data.id}/void`)
      .set(auth(accessToken))
      .send({ reason: 'wrong family' })
      .expect(200);
    await request(app)
      .post(`${API}/play-sessions/${session.body.data.id}/void`)
      .set(auth(accessToken))
      .send({ reason: 'again' })
      .expect(409);

    expect((await reload(subscription.id)).creditsUsed).toBe(0);
    await expectLedgerAgrees(subscription.id);
  });

  it('quotes the ticket in credits', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan({ visitMinutes: 60, graceMinutes: 10 });
    const { subscription } = await sellSubscription(accessToken, plan.id);
    const session = await checkInOnSubscription(accessToken, subscription.id, { checkInAt: minutesAgo(75) });

    const res = await request(app)
      .get(`${API}/play-sessions/ticket/${encodeURIComponent(session.body.data.ticketCode)}`)
      .set(auth(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.quote.subscription).toMatchObject({
      creditsPerChild: 2,
      creditsNeeded: 4,
      creditsReserved: 2,
      creditsAvailable: 6,
      shortfallBlocks: 0,
    });
    expect(res.body.data.quote.lineTotal).toBe(0);
  });
});

describe('checking out a subscription ticket', () => {
  it('bills a visit within the first block at nothing and completes without a payment method', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan();
    const { subscription } = await sellSubscription(accessToken, plan.id);
    const session = await checkInOnSubscription(accessToken, subscription.id, { checkInAt: minutesAgo(30) });

    const bill = await checkOut(accessToken, [session.body.data.ticketCode]);
    expect(bill.status).toBe(201);
    expect(bill.body.data.grandTotal).toBe(0);
    expect(bill.body.data.items[0].subscription).toMatchObject({ creditsUsed: 2, shortfallBlocks: 0, creditsRemainingAfter: 6 });
    // Credits are not money: no block split of the cash fallback rate.
    expect(bill.body.data.items[0].blocksCharged).toBeNull();

    const paid = await request(app)
      .post(`${API}/bills/${bill.body.data.id}/complete`)
      .set(auth(accessToken))
      .send({});
    expect(paid.status).toBe(200);
    expect(paid.body.data.bill.status).toBe('PAID');
    expect(paid.body.data.bill.paymentMethod).toBeNull();

    const text = await request(app).get(`${API}/bills/${bill.body.data.id}/receipt/text`).set(auth(accessToken));
    expect(text.text).toContain(`Subscription ${subscription.code}`);
    expect(text.text).toContain('2 visits used');
    expect(text.text).toContain('Covered by subscription');
  });

  it('still requires a payment method on a bill with money to take', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage();
    const draft = await request(app)
      .post(`${API}/bills`)
      .set(auth(accessToken))
      .send({ items: [{ childName: 'Kasun', playPackageId: pkg.id }] });

    const res = await request(app).post(`${API}/bills/${draft.body.data.id}/complete`).set(auth(accessToken)).send({});
    expect(res.status).toBe(400);
  });

  it('takes another credit per child for each block past the grace', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan({ visitMinutes: 60, graceMinutes: 10 });
    const { subscription } = await sellSubscription(accessToken, plan.id);
    const session = await checkInOnSubscription(accessToken, subscription.id, { checkInAt: minutesAgo(75) });

    const bill = await checkOut(accessToken, [session.body.data.ticketCode]);

    expect(bill.body.data.grandTotal).toBe(0);
    expect(bill.body.data.items[0].subscription).toMatchObject({ creditsUsed: 4, shortfallBlocks: 0 });
    expect((await reload(subscription.id)).creditsUsed).toBe(4);
    expect(await SubscriptionLedgerModel.countDocuments({ subscriptionId: subscription._id, type: 'CHECKOUT_EXTRA' })).toBe(1);
    await expectLedgerAgrees(subscription.id);
  });

  it('charges the blocks no credit covers at the extra block price', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan({ visitCredits: 3, extraBlockPrice: 80_000 });
    const { subscription } = await sellSubscription(accessToken, plan.id);
    // Two children, 75 minutes: 4 credits needed, 2 reserved, only 1 left to take.
    const session = await checkInOnSubscription(accessToken, subscription.id, { checkInAt: minutesAgo(75) });

    const bill = await checkOut(accessToken, [session.body.data.ticketCode]);

    expect(bill.body.data.items[0].subscription).toMatchObject({ creditsUsed: 3, shortfallBlocks: 1, creditsRemainingAfter: 0 });
    expect(bill.body.data.items[0].lineTotal).toBe(80_000);
    expect(bill.body.data.grandTotal).toBe(80_000);
    expect((await reload(subscription.id)).creditsUsed).toBe(3);
    await expectLedgerAgrees(subscription.id);
  });

  it('honours a visit that began before expiry even when it ends after', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan();
    const { subscription } = await sellSubscription(accessToken, plan.id);
    const session = await checkInOnSubscription(accessToken, subscription.id, { checkInAt: minutesAgo(75) });
    // Expired while the children were playing.
    await SubscriptionModel.updateOne({ _id: subscription._id }, { $set: { expiresAt: new Date(Date.now() - 30 * 60_000) } });

    const bill = await checkOut(accessToken, [session.body.data.ticketCode]);

    expect(bill.body.data.items[0].subscription).toMatchObject({ creditsUsed: 4, shortfallBlocks: 0 });
    expect(bill.body.data.grandTotal).toBe(0);
  });

  it('gives the checkout credits back when the checkout is cancelled, and counts again next time', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan();
    const { subscription } = await sellSubscription(accessToken, plan.id);
    const session = await checkInOnSubscription(accessToken, subscription.id, { checkInAt: minutesAgo(75) });
    const ticketCode = session.body.data.ticketCode;

    const first = await checkOut(accessToken, [ticketCode]);
    expect((await reload(subscription.id)).creditsUsed).toBe(4);

    await request(app)
      .post(`${API}/bills/${first.body.data.id}/cancel`)
      .set(auth(accessToken))
      .send({ reason: 'staying longer' })
      .expect(200);
    // Back to the reservation alone, and the ticket is playing again.
    expect((await reload(subscription.id)).creditsUsed).toBe(2);
    const reopened = await request(app).get(`${API}/play-sessions/ticket/${encodeURIComponent(ticketCode)}`).set(auth(accessToken));
    expect(reopened.body.data.session.status).toBe('ACTIVE');
    expect(reopened.body.data.session.subscription.creditsUsed).toBeNull();

    const second = await checkOut(accessToken, [ticketCode]);
    expect(second.status).toBe(201);
    expect(second.body.data.items[0].subscription.creditsUsed).toBe(4);
    expect((await reload(subscription.id)).creditsUsed).toBe(4);
    await expectLedgerAgrees(subscription.id);
  });

  it('bills a subscription ticket and a paid ticket together', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan();
    const pkg = await createPlayPackage({ price: 100_000, durationMinutes: 60 });
    const { subscription } = await sellSubscription(accessToken, plan.id, ['Amal']);

    const onSub = await checkInOnSubscription(accessToken, subscription.id, { childNames: ['Amal'], checkInAt: minutesAgo(30) });
    const paid = await request(app)
      .post(`${API}/play-sessions`)
      .set(auth(accessToken))
      .send({ ticketCode: nextTicketCode(), childName: 'Cousin', playPackageId: pkg.id, checkInAt: minutesAgo(30) });

    const bill = await checkOut(accessToken, [onSub.body.data.ticketCode, paid.body.data.ticketCode]);

    expect(bill.status).toBe(201);
    const [subscriptionLine, paidLine] = bill.body.data.items;
    expect(subscriptionLine.lineTotal).toBe(0);
    expect(paidLine.lineTotal).toBeGreaterThan(0);
    expect(bill.body.data.grandTotal).toBe(paidLine.lineTotal);
  });
});

describe('managing a subscription', () => {
  it('lets an admin grant and remove unused credits, never used ones', async () => {
    const { accessToken } = await createCashier();
    const admin = await createAdmin();
    const plan = await createSubscriptionPlan({ visitCredits: 8 });
    const { subscription } = await sellSubscription(accessToken, plan.id);
    await checkInOnSubscription(accessToken, subscription.id).expect(201);

    const forbidden = await request(app)
      .post(`${API}/subscriptions/${subscription.id}/adjust`)
      .set(auth(accessToken))
      .send({ delta: 2, reason: 'goodwill' });
    expect(forbidden.status).toBe(403);

    const granted = await request(app)
      .post(`${API}/subscriptions/${subscription.id}/adjust`)
      .set(auth(admin.accessToken))
      .send({ delta: 2, reason: 'goodwill' });
    expect(granted.status).toBe(200);
    expect(granted.body.data).toMatchObject({ creditsTotal: 10, creditsRemaining: 8 });

    const tooMany = await request(app)
      .post(`${API}/subscriptions/${subscription.id}/adjust`)
      .set(auth(admin.accessToken))
      .send({ delta: -9, reason: 'mistake' });
    expect(tooMany.status).toBe(409);

    const detail = await request(app).get(`${API}/subscriptions/${subscription.id}`).set(auth(admin.accessToken));
    expect(detail.body.data.ledger.map((entry: { type: string }) => entry.type)).toEqual(['ADMIN_ADJUST', 'RESERVE']);
    await expectLedgerAgrees(subscription.id);
  });

  it('lets an admin move the expiry, and a cashier edit the children within the limit', async () => {
    const { accessToken } = await createCashier();
    const admin = await createAdmin();
    const plan = await createSubscriptionPlan({ maxChildren: 2 });
    const { subscription } = await sellSubscription(accessToken, plan.id, ['Amal']);

    const later = new Date(subscription.expiresAt.getTime() + 7 * 24 * 3600_000).toISOString();
    const extended = await request(app)
      .post(`${API}/subscriptions/${subscription.id}/extend`)
      .set(auth(admin.accessToken))
      .send({ expiresAt: later, reason: 'closed for a week' });
    expect(extended.status).toBe(200);
    expect(extended.body.data.expiresAt).toBe(later);

    const renamed = await request(app)
      .patch(`${API}/subscriptions/${subscription.id}/children`)
      .set(auth(accessToken))
      .send({ children: ['Amal', 'Sara'] });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.children.map((child: { name: string }) => child.name)).toEqual(['Amal', 'Sara']);

    const tooMany = await request(app)
      .patch(`${API}/subscriptions/${subscription.id}/children`)
      .set(auth(accessToken))
      .send({ children: ['Amal', 'Sara', 'Kasun'] });
    expect(tooMany.status).toBe(400);
  });

  it('reports sales, redemptions and what is still owed in visits', async () => {
    const { accessToken } = await createCashier();
    const admin = await createAdmin();
    const plan = await createSubscriptionPlan({ price: 300_000, visitCredits: 8 });
    const { subscription } = await sellSubscription(accessToken, plan.id);
    const session = await checkInOnSubscription(accessToken, subscription.id, { checkInAt: minutesAgo(75) });
    await checkOut(accessToken, [session.body.data.ticketCode]).expect(201);
    // A free credit is outstanding but carries no money.
    await request(app)
      .post(`${API}/subscriptions/${subscription.id}/adjust`)
      .set(auth(admin.accessToken))
      .send({ delta: 1, reason: 'goodwill' })
      .expect(200);

    const forbidden = await request(app).get(`${API}/subscriptions/summary`).set(auth(accessToken));
    expect(forbidden.status).toBe(403);

    const res = await request(app).get(`${API}/subscriptions/summary?period=today`).set(auth(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      soldCount: 1,
      soldRevenue: 300_000,
      creditsRedeemed: 4,
      activeCount: 1,
      outstandingCredits: 5,
      // 4 of the 8 bought credits are unused, at LKR 375 each; the granted one is free.
      outstandingValue: 150_000,
    });
  });

  it('finds a family by phone, by card code, and in the offline cache', async () => {
    const { accessToken } = await createCashier();
    const plan = await createSubscriptionPlan();
    const { subscription } = await sellSubscription(accessToken, plan.id);

    const lookup = await request(app).get(`${API}/customers/lookup?phoneNumber=${PHONE}`).set(auth(accessToken));
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.subscriptions.map((sub: { id: string }) => sub.id)).toEqual([subscription.id]);

    const byCode = await request(app).get(`${API}/subscriptions/by-code/${subscription.code.toLowerCase()}`).set(auth(accessToken));
    expect(byCode.status).toBe(200);
    expect(byCode.body.data.status).toBe('ACTIVE');

    const cache = await request(app).get(`${API}/subscriptions/active-cache`).set(auth(accessToken));
    expect(cache.body.data).toHaveLength(1);
    expect(cache.body.data[0]).toMatchObject({ code: subscription.code, creditsRemaining: 8, children: ['Amal', 'Sara'] });

    const exhausted = await request(app).get(`${API}/subscriptions?status=EXHAUSTED`).set(auth(accessToken));
    expect(exhausted.body.data).toHaveLength(0);
  });
});
