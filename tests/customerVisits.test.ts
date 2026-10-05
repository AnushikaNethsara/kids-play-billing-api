/**
 * Customer foundations: one phone number per family whatever way it was typed, one
 * definition of a visit, and counters that are derived from the bills rather than bumped
 * - so cancelling, refunding or marking a bill as a test always leaves them right.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createAdmin, createPlayPackage, createProduct } from './helpers/factories';
import { CustomerModel } from '../src/modules/customers/customer.model';
import { BillModel } from '../src/modules/bills/bill.model';
import { PlaySessionModel } from '../src/modules/play-sessions/playSession.model';
import { customerService } from '../src/modules/customers/customer.service';

const API = '/api/v1';
const STORED = '+94771234567';

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:visits-${Date.now()}-${ticketCounter}`;
}

async function payBill(
  accessToken: string,
  items: Record<string, unknown>[],
  phoneNumber = '0771234567',
) {
  const draft = await request(app)
    .post(`${API}/bills`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ items, customer: { parentName: 'Nimal Perera', phoneNumber }, paymentMethod: 'CASH' });
  expect(draft.status).toBe(201);
  const paid = await request(app)
    .post(`${API}/bills/${draft.body.data.id}/complete`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ paymentMethod: 'CASH' });
  expect(paid.status).toBe(200);
  return paid.body.data.bill;
}

async function customer() {
  return CustomerModel.findOne({ phoneNumber: STORED }).lean();
}

describe('phone numbers', () => {
  it('files every spelling of one number under the same customer', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80_000 });
    const play = [{ childName: 'Kasun', playPackageId: pkg.id, quantity: 1 }];

    await payBill(accessToken, play, '0771234567');
    await payBill(accessToken, play, '+94 77 123 4567');
    await payBill(accessToken, play, '771234567');

    expect(await CustomerModel.countDocuments({})).toBe(1);
    expect((await customer())?.phoneNumber).toBe(STORED);
    expect(await BillModel.countDocuments({ phoneNumber: STORED })).toBe(3);
  });

  it('finds a customer from the start of the number as the cashier types it', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage();
    await payBill(accessToken, [{ childName: 'Kasun', playPackageId: pkg.id, quantity: 1 }]);

    for (const typed of ['077 123', '+9477123', '4567']) {
      const res = await request(app)
        .get(`${API}/customers/search`)
        .query({ phoneNumber: typed })
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.map((row: { phoneNumber: string }) => row.phoneNumber)).toEqual([STORED]);
    }
  });
});

describe('what counts as a visit', () => {
  it('counts two play bills on the same day as one visit, and both as spend', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80_000 });
    const play = [{ childName: 'Kasun', playPackageId: pkg.id, quantity: 1 }];

    await payBill(accessToken, play);
    await payBill(accessToken, play);

    const row = await customer();
    expect(row?.visitCount).toBe(1);
    expect(row?.totalSpent).toBe(160_000);
  });

  it('counts play on two different days as two visits', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80_000 });
    const play = [{ childName: 'Kasun', playPackageId: pkg.id, quantity: 1 }];

    const earlier = await payBill(accessToken, play);
    await payBill(accessToken, play);
    await BillModel.updateOne(
      { _id: earlier.id },
      { $set: { paidAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) } },
    );
    const row = await customer();
    await customerService.recomputeStats(String(row?._id));

    expect((await customer())?.visitCount).toBe(2);
  });

  it('does not count a socks-only purchase as a visit, but does count the money', async () => {
    const { accessToken } = await createAdmin();
    const socks = await createProduct({ price: 30_000 });

    await payBill(accessToken, [{ kind: 'PRODUCT', productId: socks.id, quantity: 1 }]);

    const row = await customer();
    expect(row?.visitCount).toBe(0);
    expect(row?.totalSpent).toBe(30_000);
  });

  it('takes the visit and the spend back off when a paid bill is cancelled', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80_000 });
    const bill = await payBill(accessToken, [{ childName: 'Kasun', playPackageId: pkg.id, quantity: 1 }]);
    expect((await customer())?.visitCount).toBe(1);

    const res = await request(app)
      .post(`${API}/bills/${bill.id}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'Wrong family' });
    expect(res.status).toBe(200);

    const row = await customer();
    expect(row?.visitCount).toBe(0);
    expect(row?.totalSpent).toBe(0);
    expect(row?.lastVisitAt).toBeNull();
  });

  it('keeps a refunded visit, but not its money', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({ price: 80_000 });
    const bill = await payBill(accessToken, [{ childName: 'Kasun', playPackageId: pkg.id, quantity: 1 }]);

    await request(app)
      .post(`${API}/bills/${bill.id}/refund`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'Unhappy' });

    const row = await customer();
    expect(row?.visitCount).toBe(1);
    expect(row?.totalSpent).toBe(0);
  });
});

describe('linking bills and tickets to the family', () => {
  it('links the bill and the tickets it paid for to the customer at payment', async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage({ durationMinutes: 60, price: 100_000 });
    const ticketCode = nextTicketCode();
    await request(app)
      .post(`${API}/play-sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        ticketCode,
        childNames: ['Amal', 'Nimal'],
        playPackageId: pkg.id,
        checkInAt: new Date(Date.now() - 30 * 60_000).toISOString(),
        customer: { parentName: 'Nimal Perera', phoneNumber: '077-123-4567' },
      });

    const draft = await request(app)
      .post(`${API}/bills/from-sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ticketCodes: [ticketCode] });
    const paid = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethod: 'CASH' });

    const row = await customer();
    expect(paid.body.data.bill.customerId).toBe(String(row?._id));
    const session = await PlaySessionModel.findOne({ ticketCode }).lean();
    expect(session?.phoneNumber).toBe(STORED);
    expect(String(session?.customerId)).toBe(String(row?._id));
  });

  it("lists a family ticket's children one by one", async () => {
    const { accessToken } = await createAdmin();
    const pkg = await createPlayPackage();
    await request(app)
      .post(`${API}/play-sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        ticketCode: nextTicketCode(),
        childNames: ['Amal', 'Nimal', 'Sara'],
        playPackageId: pkg.id,
        customer: { phoneNumber: '0771234567' },
      });

    const res = await request(app)
      .get(`${API}/customers/children`)
      .query({ phoneNumber: '+94 77 123 4567' })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((child: { childName: string }) => child.childName).sort()).toEqual([
      'Amal',
      'Nimal',
      'Sara',
    ]);
  });
});
