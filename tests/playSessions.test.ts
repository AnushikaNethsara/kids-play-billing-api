import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { BusinessSettingsModel } from '../src/modules/settings/settings.model';
import { PlaySessionModel } from '../src/modules/play-sessions/playSession.model';
import { SessionPricingMode } from '../src/common/constants/pricingModes';

const API = '/api/v1';

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:test-${Date.now()}-${ticketCounter}`;
}

/** An hour of play for LKR 1000.00 - the rate used in the business's worked examples. */
async function createHourlyPackage() {
  return createPlayPackage({ name: '1 Hour', durationMinutes: 60, price: 100_000 });
}

async function checkIn(
  accessToken: string,
  playPackageId: string,
  overrides: Record<string, unknown> = {},
) {
  return request(app)
    .post(`${API}/play-sessions`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      ticketCode: nextTicketCode(),
      childName: 'Kasun',
      playPackageId,
      customer: { parentName: 'Nimal Perera', phoneNumber: '0771234567' },
      ...overrides,
    });
}

/** Check-in placed a fixed number of minutes in the past, so elapsed time is predictable. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function setMinimumBillableMinutes(minutes: number) {
  await BusinessSettingsModel.updateOne(
    {},
    { $set: { minimumBillableMinutes: minutes } },
    { upsert: true },
  );
}

describe('play sessions', () => {
  describe('check-in', () => {
    it('opens an active session carrying the package rate snapshot', async () => {
      const { accessToken, user } = await createCashier();
      const pkg = await createHourlyPackage();

      const res = await checkIn(accessToken, pkg.id);

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data.childName).toBe('Kasun');
      expect(res.body.data.packageName).toBe('1 Hour');
      expect(res.body.data.rateDurationMinutes).toBe(60);
      expect(res.body.data.unitPrice).toBe(100_000);
      expect(res.body.data.checkInCashierId).toBe(user.id);
      expect(res.body.data.checkOutAt).toBeNull();
    });

    it('is idempotent on the ticket code, so a retried offline sync never double-books', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();

      const first = await checkIn(accessToken, pkg.id, { ticketCode });
      const replay = await checkIn(accessToken, pkg.id, { ticketCode, childName: 'Someone Else' });

      expect(first.status).toBe(201);
      expect(replay.status).toBe(200);
      expect(replay.body.data.id).toBe(first.body.data.id);
      // The replay must not overwrite the original - it is a retry, not an edit.
      expect(replay.body.data.childName).toBe('Kasun');
      expect(await PlaySessionModel.countDocuments({ ticketCode })).toBe(1);
    });

    it('accepts a device-supplied check-in time for an offline check-in', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const checkInAt = minutesAgo(40);

      const res = await checkIn(accessToken, pkg.id, { checkInAt });

      expect(res.status).toBe(201);
      expect(new Date(res.body.data.checkInAt).toISOString()).toBe(checkInAt);
    });

    it('rejects a check-in time from a device whose clock is in the future', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();

      const res = await checkIn(accessToken, pkg.id, {
        checkInAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/device clock/i);
    });

    it('rejects a check-in older than the maximum session length', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();

      const res = await checkIn(accessToken, pkg.id, { checkInAt: minutesAgo(20 * 60) });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/hours old/i);
    });

    it('rejects an inactive play package', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createPlayPackage({ isActive: false });

      const res = await checkIn(accessToken, pkg.id);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_PLAY_PACKAGE');
    });

    it('requires authentication', async () => {
      const pkg = await createHourlyPackage();

      const res = await request(app)
        .post(`${API}/play-sessions`)
        .send({ ticketCode: nextTicketCode(), childName: 'Kasun', playPackageId: pkg.id });

      expect(res.status).toBe(401);
    });
  });

  describe('scanning a ticket', () => {
    it('prices an active session pro-rata as of now', async () => {
      await setMinimumBillableMinutes(15);
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();
      await checkIn(accessToken, pkg.id, { ticketCode, checkInAt: minutesAgo(75) });

      const res = await request(app)
        .get(`${API}/play-sessions/ticket/${ticketCode}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.session.ticketCode).toBe(ticketCode);
      // 75 minutes at LKR 1000.00/60min = LKR 1250.00. Allow a minute of test latency.
      expect(res.body.data.quote.billedMinutes).toBeGreaterThanOrEqual(75);
      expect(res.body.data.quote.billedMinutes).toBeLessThanOrEqual(76);
      expect(res.body.data.quote.lineTotal).toBeGreaterThanOrEqual(125_000);
      expect(res.body.data.quote.lineTotal).toBeLessThanOrEqual(126_667);
      expect(res.body.data.quote.minimumApplied).toBe(false);
    });

    it('applies the minimum billable time to a very short visit', async () => {
      await setMinimumBillableMinutes(15);
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();
      await checkIn(accessToken, pkg.id, { ticketCode, checkInAt: minutesAgo(3) });

      const res = await request(app)
        .get(`${API}/play-sessions/ticket/${ticketCode}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.body.data.quote.minimumApplied).toBe(true);
      expect(res.body.data.quote.billedMinutes).toBe(15);
      expect(res.body.data.quote.lineTotal).toBe(25_000);
    });

    it('flags a session that has run past the maximum session length', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();
      // Bypass the check-in guard to simulate a ticket abandoned overnight.
      await checkIn(accessToken, pkg.id, { ticketCode });
      await PlaySessionModel.updateOne(
        { ticketCode },
        { $set: { checkInAt: new Date(Date.now() - 20 * 60 * 60_000) } },
      );

      const res = await request(app)
        .get(`${API}/play-sessions/ticket/${ticketCode}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.body.data.quote.exceedsMaximumSession).toBe(true);
    });

    it('returns 404 for an unknown ticket code', async () => {
      const { accessToken } = await createCashier();

      const res = await request(app)
        .get(`${API}/play-sessions/ticket/KPA1:does-not-exist`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('listing', () => {
    it('filters to the currently playing board', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      await checkIn(accessToken, pkg.id);

      const res = await request(app)
        .get(`${API}/play-sessions?status=ACTIVE`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const row of res.body.data) {
        expect(row.session.status).toBe('ACTIVE');
        expect(row.quote).not.toBeNull();
      }
    });
  });

  describe('voiding', () => {
    it('voids a mistaken check-in so it can never be billed', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const checkedIn = await checkIn(accessToken, pkg.id);

      const res = await request(app)
        .post(`${API}/play-sessions/${checkedIn.body.data.id}/void`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ reason: 'Checked in the wrong child' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('VOIDED');
      expect(res.body.data.voidReason).toBe('Checked in the wrong child');
    });

    it('stops a cashier voiding another cashier\'s session', async () => {
      const { accessToken: ownerToken } = await createCashier();
      const { accessToken: otherToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const checkedIn = await checkIn(ownerToken, pkg.id);

      const res = await request(app)
        .post(`${API}/play-sessions/${checkedIn.body.data.id}/void`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ reason: 'Not mine to void' });

      expect(res.status).toBe(403);
    });

    it('lets an admin void any session', async () => {
      const { accessToken: cashierToken } = await createCashier();
      const { accessToken: adminToken } = await createAdmin();
      const pkg = await createHourlyPackage();
      const checkedIn = await checkIn(cashierToken, pkg.id);

      const res = await request(app)
        .post(`${API}/play-sessions/${checkedIn.body.data.id}/void`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Cleared overnight' });

      expect(res.status).toBe(200);
    });

    it('requires a reason', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const checkedIn = await checkIn(accessToken, pkg.id);

      const res = await request(app)
        .post(`${API}/play-sessions/${checkedIn.body.data.id}/void`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ reason: 'x' });

      expect(res.status).toBe(400);
    });
  });

  describe('checkout', () => {
    it('bills the two worked business examples end to end', async () => {
      await setMinimumBillableMinutes(15);
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();

      const shortTicket = nextTicketCode();
      const longTicket = nextTicketCode();
      const checkInAt15 = new Date(Date.now() - 60 * 60_000).toISOString();
      const checkInAt75 = new Date(Date.now() - 120 * 60_000).toISOString();
      await checkIn(accessToken, pkg.id, { ticketCode: shortTicket, checkInAt: checkInAt15 });
      await checkIn(accessToken, pkg.id, { ticketCode: longTicket, checkInAt: checkInAt75 });

      // 15 minutes of play: check out 45 minutes after a check-in placed 60 minutes ago.
      const shortRes = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          ticketCodes: [shortTicket],
          checkOutAt: new Date(new Date(checkInAt15).getTime() + 15 * 60_000).toISOString(),
        });

      expect(shortRes.status).toBe(201);
      expect(shortRes.body.data.grandTotal).toBe(25_000);

      // 75 minutes of play.
      const longRes = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          ticketCodes: [longTicket],
          checkOutAt: new Date(new Date(checkInAt75).getTime() + 75 * 60_000).toISOString(),
        });

      expect(longRes.status).toBe(201);
      expect(longRes.body.data.grandTotal).toBe(125_000);
      expect(longRes.body.data.items[0].billedMinutes).toBe(75);
      expect(longRes.body.data.items[0].playSessionId).not.toBeNull();
    });

    it('closes the session and links it to the bill', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();
      await checkIn(accessToken, pkg.id, { ticketCode, checkInAt: minutesAgo(30) });

      const billRes = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCodes: [ticketCode] });

      const session = await PlaySessionModel.findOne({ ticketCode });
      expect(session?.status).toBe('CLOSED');
      expect(session?.billId?.toString()).toBe(billRes.body.data.id);
      expect(session?.checkOutAt).not.toBeNull();
      expect(session?.billedMinutes).toBeGreaterThanOrEqual(30);
    });

    it('refuses to check the same ticket out twice', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();
      await checkIn(accessToken, pkg.id, { ticketCode, checkInAt: minutesAgo(30) });

      const first = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCodes: [ticketCode] });
      const second = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCodes: [ticketCode] });

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(second.body.error.message).toMatch(/already been checked out/i);
    });

    it('refuses to check out a voided ticket', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();
      const checkedIn = await checkIn(accessToken, pkg.id, { ticketCode });
      await request(app)
        .post(`${API}/play-sessions/${checkedIn.body.data.id}/void`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ reason: 'Wrong child' });

      const res = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCodes: [ticketCode] });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/voided/i);
    });

    it('bills several children on one visit as separate lines', async () => {
      await setMinimumBillableMinutes(15);
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const first = nextTicketCode();
      const second = nextTicketCode();
      const checkInAt = new Date(Date.now() - 90 * 60_000).toISOString();
      await checkIn(accessToken, pkg.id, { ticketCode: first, childName: 'Kasun', checkInAt });
      await checkIn(accessToken, pkg.id, { ticketCode: second, childName: 'Amaya', checkInAt });

      const res = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          ticketCodes: [first, second],
          checkOutAt: new Date(new Date(checkInAt).getTime() + 60 * 60_000).toISOString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.subtotal).toBe(200_000);
      expect(res.body.data.items.map((i: { childName: string }) => i.childName).sort()).toEqual([
        'Amaya',
        'Kasun',
      ]);
    });

    it('leaves every ticket billable when one code in the batch is unknown', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const good = nextTicketCode();
      await checkIn(accessToken, pkg.id, { ticketCode: good, checkInAt: minutesAgo(30) });

      const res = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCodes: [good, 'KPA1:unknown-ticket'] });

      expect(res.status).toBe(404);
      // The claim on the valid ticket must have been rolled back - the child is still
      // playing and their ticket has to remain checkoutable.
      const session = await PlaySessionModel.findOne({ ticketCode: good });
      expect(session?.status).toBe('ACTIVE');
      expect(session?.checkOutAt).toBeNull();
      expect(session?.billedMinutes).toBeNull();
    });

    it('applies a discount and enforces the cashier cap', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();
      const checkInAt = new Date(Date.now() - 120 * 60_000).toISOString();
      await checkIn(accessToken, pkg.id, { ticketCode, checkInAt });

      const res = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          ticketCodes: [ticketCode],
          checkOutAt: new Date(new Date(checkInAt).getTime() + 60 * 60_000).toISOString(),
          discount: { type: 'PERCENTAGE', value: 90 },
        });

      expect(res.status).toBe(400);
      const session = await PlaySessionModel.findOne({ ticketCode });
      expect(session?.status).toBe('ACTIVE');
    });

    it('takes payment through the unchanged completion path', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();
      const checkInAt = new Date(Date.now() - 120 * 60_000).toISOString();
      await checkIn(accessToken, pkg.id, { ticketCode, checkInAt });

      const draft = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          ticketCodes: [ticketCode],
          checkOutAt: new Date(new Date(checkInAt).getTime() + 60 * 60_000).toISOString(),
        });

      const paid = await request(app)
        .post(`${API}/bills/${draft.body.data.id}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', `test-${ticketCode}`)
        .send({ paymentMethod: 'CASH', paidAmount: 100_000 });

      expect(paid.status).toBe(200);
      expect(paid.body.data.bill.status).toBe('PAID');
      expect(paid.body.data.bill.billNumber).toMatch(/^KPA-\d{8}-\d{6}$/);

      const receipt = await request(app)
        .get(`${API}/bills/${draft.body.data.id}/receipt/text`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(receipt.status).toBe(200);
      expect(receipt.text).toMatch(/In \d{2}:\d{2} [AP]M {2}Out \d{2}:\d{2} [AP]M/);
      expect(receipt.text).toMatch(/Time: 1h/);
    });

    it('reopens sessions when the bill is cancelled, because the children are still playing', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();
      await checkIn(accessToken, pkg.id, { ticketCode, checkInAt: minutesAgo(30) });

      const draft = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCodes: [ticketCode] });

      const cancelled = await request(app)
        .post(`${API}/bills/${draft.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ reason: 'Scanned the wrong ticket' });

      expect(cancelled.status).toBe(200);
      const session = await PlaySessionModel.findOne({ ticketCode });
      expect(session?.status).toBe('ACTIVE');
      expect(session?.billId).toBeNull();

      // ...and the ticket really is billable again.
      const rebill = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCodes: [ticketCode] });
      expect(rebill.status).toBe(201);
    });

    it('does not reopen sessions on a refund, because that visit really happened', async () => {
      const { accessToken: cashierToken } = await createCashier();
      const { accessToken: adminToken } = await createAdmin();
      const pkg = await createHourlyPackage();
      const ticketCode = nextTicketCode();
      await checkIn(cashierToken, pkg.id, { ticketCode, checkInAt: minutesAgo(60) });

      const draft = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ ticketCodes: [ticketCode] });
      await request(app)
        .post(`${API}/bills/${draft.body.data.id}/complete`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ paymentMethod: 'CASH' });

      const refunded = await request(app)
        .post(`${API}/bills/${draft.body.data.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Equipment was out of order' });

      expect(refunded.status).toBe(200);
      const session = await PlaySessionModel.findOne({ ticketCode });
      expect(session?.status).toBe('CLOSED');
    });

    it('rejects an empty ticket list', async () => {
      const { accessToken } = await createCashier();

      const res = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCodes: [] });

      expect(res.status).toBe(400);
    });
  });

  describe('children by phone number', () => {
    it('lists the distinct children checked in under a phone number, most recent first', async () => {
      const { accessToken } = await createCashier();
      const pkg = await createHourlyPackage();
      const phoneNumber = '0779998888';

      await checkIn(accessToken, pkg.id, {
        childName: 'Amaya',
        customer: { parentName: 'Sunil Silva', phoneNumber },
        checkInAt: minutesAgo(120),
      });
      await checkIn(accessToken, pkg.id, {
        childName: 'Binura',
        customer: { parentName: 'Sunil Silva', phoneNumber },
        checkInAt: minutesAgo(60),
      });
      // A repeat visit for the first child shouldn't produce a duplicate entry.
      await checkIn(accessToken, pkg.id, {
        childName: 'Amaya',
        customer: { parentName: 'Sunil Silva', phoneNumber },
        checkInAt: minutesAgo(10),
      });

      const res = await request(app)
        .get(`${API}/customers/children`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ phoneNumber });

      expect(res.status).toBe(200);
      expect(res.body.data.map((child: { childName: string }) => child.childName)).toEqual([
        'Amaya',
        'Binura',
      ]);
    });

    it('is empty for a phone number with no history', async () => {
      const { accessToken } = await createCashier();

      const res = await request(app)
        .get(`${API}/customers/children`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ phoneNumber: '0700000000' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });
});

/**
 * "Pay for the first hour, then extra time" end to end.
 *
 * Every boundary case here pins BOTH check-in and check-out to explicit timestamps rather
 * than leaning on the wall clock. Elapsed minutes are rounded up, so a few hundred
 * milliseconds of drift turns 70 minutes into 71 and flips the assertion by a whole
 * grace step - which would make this suite flaky in exactly the place it matters most.
 */
describe('block-with-grace pricing', () => {
  /** LKR 600.00 buys the first hour, then 10 minutes of grace after each completed hour. */
  async function createBlockPackage() {
    return createPlayPackage({
      name: '1 Hour Pass',
      durationMinutes: 60,
      price: 60_000,
      pricingMode: SessionPricingMode.BLOCK_WITH_GRACE,
      graceMinutes: 10,
    });
  }

  /** A check-in far enough back that any exit time under test is still in the past. */
  const CHECK_IN_AT = () => minutesAgo(300);

  function exitAfter(checkInAt: string, minutes: number): string {
    return new Date(new Date(checkInAt).getTime() + minutes * 60_000).toISOString();
  }

  async function checkOut(accessToken: string, ticketCode: string, checkOutAt: string) {
    return request(app)
      .post(`${API}/bills/from-sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ticketCodes: [ticketCode], checkOutAt });
  }

  it('snapshots the pricing rule onto the session at check-in', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createBlockPackage();

    const res = await checkIn(accessToken, pkg.id);

    expect(res.status).toBe(201);
    expect(res.body.data.pricingMode).toBe('BLOCK_WITH_GRACE');
    expect(res.body.data.graceMinutes).toBe(10);
    expect(res.body.data.unitPrice).toBe(60_000);
    expect(res.body.data.rateDurationMinutes).toBe(60);
  });

  it.each([
    [20, 60_000],
    [60, 60_000],
    [70, 60_000],
    [71, 71_000],
    [90, 90_000],
    [120, 120_000],
    [130, 120_000],
    [131, 131_000],
  ])('bills a %i-minute visit at %i', async (minutes, expected) => {
    const { accessToken } = await createCashier();
    const pkg = await createBlockPackage();
    const checkInAt = CHECK_IN_AT();

    const session = await checkIn(accessToken, pkg.id, { checkInAt });
    const res = await checkOut(accessToken, session.body.data.ticketCode, exitAfter(checkInAt, minutes));

    expect(res.status).toBe(201);
    expect(res.body.data.subtotal).toBe(expected);
    expect(res.body.data.items[0].billedMinutes).toBe(minutes);
  });

  it('returns the split on the bill item so the receipt never recomputes it', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createBlockPackage();
    const checkInAt = CHECK_IN_AT();

    const session = await checkIn(accessToken, pkg.id, { checkInAt });
    const res = await checkOut(accessToken, session.body.data.ticketCode, exitAfter(checkInAt, 131));

    const item = res.body.data.items[0];
    expect(item.pricingMode).toBe('BLOCK_WITH_GRACE');
    expect(item.graceMinutes).toBe(10);
    expect(item.blocksCharged).toBe(2);
    expect(item.blockSubtotal).toBe(120_000);
    expect(item.overageMinutes).toBe(11);
    expect(item.overageAmount).toBe(11_000);
    expect(item.graceApplied).toBe(false);
    // The derived split must always reconcile against the stored authority.
    expect(item.blockSubtotal + item.overageAmount).toBe(item.lineTotal);
  });

  it('quotes a live session with a countdown to the next charge', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createBlockPackage();

    const session = await checkIn(accessToken, pkg.id, { checkInAt: minutesAgo(65) });
    const res = await request(app)
      .get(`${API}/play-sessions/ticket/${session.body.data.ticketCode}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.quote.lineTotal).toBe(60_000);
    expect(res.body.data.quote.breakdown.graceApplied).toBe(true);
    expect(res.body.data.quote.breakdown.inExtraTime).toBe(false);
    expect(res.body.data.quote.nextChargeAt).not.toBeNull();
  });

  it('does not apply the minimum billable time, which would overstate play time', async () => {
    // The block fee is already the floor, so the money is the same either way - but
    // billedMinutes is what the dashboard sums and what the receipt prints.
    const { accessToken } = await createCashier();
    await setMinimumBillableMinutes(30);
    const pkg = await createBlockPackage();
    const checkInAt = CHECK_IN_AT();

    const session = await checkIn(accessToken, pkg.id, { checkInAt });
    const res = await checkOut(accessToken, session.body.data.ticketCode, exitAfter(checkInAt, 5));

    expect(res.body.data.subtotal).toBe(60_000);
    expect(res.body.data.items[0].billedMinutes).toBe(5);
  });

  it('prices from the session snapshot even after the package is switched to pro-rata', async () => {
    const { accessToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createBlockPackage();
    const checkInAt = CHECK_IN_AT();

    const session = await checkIn(accessToken, pkg.id, { checkInAt });

    await request(app)
      .patch(`${API}/play-packages/${pkg.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pricingMode: 'PRORATA' });

    const res = await checkOut(accessToken, session.body.data.ticketCode, exitAfter(checkInAt, 20));

    // Still a full block. Pro-rata would have charged 20_000.
    expect(res.body.data.subtotal).toBe(60_000);
    expect(res.body.data.items[0].pricingMode).toBe('BLOCK_WITH_GRACE');
  });

  it('bills a block child and a pro-rata child on one visit, each by its own rule', async () => {
    const { accessToken } = await createCashier();
    const blockPkg = await createBlockPackage();
    const prorataPkg = await createHourlyPackage();
    const checkInAt = CHECK_IN_AT();

    const blockSession = await checkIn(accessToken, blockPkg.id, { checkInAt, childName: 'Kasun' });
    const prorataSession = await checkIn(accessToken, prorataPkg.id, { checkInAt, childName: 'Amaya' });

    const res = await request(app)
      .post(`${API}/bills/from-sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        ticketCodes: [blockSession.body.data.ticketCode, prorataSession.body.data.ticketCode],
        checkOutAt: exitAfter(checkInAt, 90),
      });

    expect(res.status).toBe(201);
    const [block, prorata] = res.body.data.items;
    expect(block.lineTotal).toBe(90_000); // one block + 30 chargeable minutes
    expect(prorata.lineTotal).toBe(150_000); // 90 min of a LKR 1000.00/hour rate
    expect(prorata.pricingMode).toBe('PRORATA');
    expect(res.body.data.subtotal).toBe(240_000);
  });

  it('prints the split on the receipt instead of a per-minute rate', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createBlockPackage();
    const checkInAt = CHECK_IN_AT();

    const session = await checkIn(accessToken, pkg.id, { checkInAt });
    const bill = await checkOut(accessToken, session.body.data.ticketCode, exitAfter(checkInAt, 131));
    await request(app)
      .post(`${API}/bills/${bill.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethod: 'CASH' });

    const res = await request(app)
      .get(`${API}/bills/${bill.body.data.id}/receipt/text`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('2 x 1h + 11m');
    expect(res.text).toContain('incl. extra 11m');
    // The pro-rata form would read as a per-minute rate and invite multiplying it out.
    expect(res.text).not.toContain('/60m');
    // 58mm paper is 32 columns; a line over that wraps badly on a thermal printer.
    for (const line of res.text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
  });

  it('freezes the charged amount on the session and clears it if the bill is cancelled', async () => {
    // The dashboard sums chargedAmount, so a reopened ticket that kept one would report
    // revenue that was reversed - and double-count it once the child is billed again.
    const { accessToken } = await createCashier();
    const pkg = await createBlockPackage();
    const checkInAt = CHECK_IN_AT();

    const session = await checkIn(accessToken, pkg.id, { checkInAt });
    const bill = await checkOut(accessToken, session.body.data.ticketCode, exitAfter(checkInAt, 90));

    const closed = await PlaySessionModel.findOne({ ticketCode: session.body.data.ticketCode });
    expect(closed?.chargedAmount).toBe(90_000);

    await request(app)
      .post(`${API}/bills/${bill.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'scanned the wrong ticket' });

    const reopened = await PlaySessionModel.findOne({ ticketCode: session.body.data.ticketCode });
    expect(reopened?.status).toBe('ACTIVE');
    expect(reopened?.billedMinutes).toBeNull();
    expect(reopened?.chargedAmount).toBeNull();
  });
});

describe('block pricing configuration', () => {
  it('defaults an existing-shaped package to pro-rata with no grace', async () => {
    const { accessToken } = await createAdmin();

    const res = await request(app)
      .post(`${API}/play-packages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Plain', durationMinutes: 60, price: 60_000 });

    expect(res.status).toBe(201);
    expect(res.body.data.pricingMode).toBe('PRORATA');
    expect(res.body.data.graceMinutes).toBe(0);
  });

  it('rejects a grace that is not shorter than the block', async () => {
    const { accessToken } = await createAdmin();

    const res = await request(app)
      .post(`${API}/play-packages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Unreachable',
        durationMinutes: 60,
        price: 60_000,
        pricingMode: 'BLOCK_WITH_GRACE',
        graceMinutes: 60,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects shortening a block below a grace that was already valid', async () => {
    // The check has to run against the merged package: this patch is unremarkable on its
    // own, and only conflicts with the grace already stored.
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({
      durationMinutes: 60,
      pricingMode: SessionPricingMode.BLOCK_WITH_GRACE,
      graceMinutes: 30,
    });

    const res = await request(app)
      .patch(`${API}/play-packages/${pkg.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ durationMinutes: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('audits a switch of pricing mode as a price change', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({ durationMinutes: 60, price: 60_000 });

    await request(app)
      .patch(`${API}/play-packages/${pkg.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ pricingMode: 'BLOCK_WITH_GRACE', graceMinutes: 10 });

    const logs = await request(app)
      .get(`${API}/audit-logs?entityType=PLAY_PACKAGE`)
      .set('Authorization', `Bearer ${accessToken}`);

    const actions = logs.body.data.map((entry: { action: string }) => entry.action);
    expect(actions).toContain('PACKAGE_PRICE_CHANGED');
  });
});
