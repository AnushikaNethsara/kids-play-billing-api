/**
 * Custom bills: group visits at a negotiated rate, and products (socks) sold either over
 * the counter or onto a child who is playing.
 *
 * These pin the money (the group formula, the price snapshot), who may do what (products
 * are admin-managed, only an admin may date a group visit to an earlier day), the
 * idempotency the offline till relies on (extras keyed by localId), and that reporting
 * counts children and packages correctly once a bill is no longer one child per line.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage, createProduct } from './helpers/factories';
import { ProductModel } from '../src/modules/products/product.model';
import { AuditLogModel } from '../src/modules/audit-logs/auditLog.model';

const API = '/api/v1';

let counter = 0;
function nextCode(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function createBill(token: string, body: Record<string, unknown>) {
  return request(app).post(`${API}/bills`).set('Authorization', `Bearer ${token}`).send(body);
}

function completeBill(token: string, billId: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`${API}/bills/${billId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentMethod: 'CASH', ...body });
}

const SUNFLOWER = {
  kind: 'GROUP',
  groupName: 'Sunflower Pre-school',
  headcount: 20,
  ratePerChildPerHour: 30_000,
  visitMinutes: 120,
};

describe('group bills', () => {
  it('prices a group as headcount x rate x hours, server-side', async () => {
    const { accessToken } = await createCashier();

    const res = await createBill(accessToken, { items: [SUNFLOWER] });

    expect(res.status).toBe(201);
    const [line] = res.body.data.items;
    expect(line.kind).toBe('GROUP');
    expect(line.packageName).toBe('Sunflower Pre-school');
    expect(line.quantity).toBe(20);
    expect(line.unitPrice).toBe(30_000);
    expect(line.durationMinutes).toBe(60);
    expect(line.visitMinutes).toBe(120);
    expect(line.playPackageId).toBeNull();
    // 20 x LKR 300.00 x 2h = LKR 12,000.00
    expect(line.lineTotal).toBe(1_200_000);
    expect(res.body.data.grandTotal).toBe(1_200_000);
  });

  it('prices a part-hour visit pro-rata, rounding once at the end', async () => {
    const { accessToken } = await createCashier();

    const res = await createBill(accessToken, {
      items: [{ ...SUNFLOWER, headcount: 7, ratePerChildPerHour: 33_333, visitMinutes: 50 }],
    });

    // 33333 x 7 x 50 / 60 = 194442.5 -> 194443
    expect(res.body.data.items[0].lineTotal).toBe(194_443);
  });

  it('rejects a nonsense headcount or a zero rate', async () => {
    const { accessToken } = await createCashier();

    expect((await createBill(accessToken, { items: [{ ...SUNFLOWER, headcount: 0 }] })).status).toBe(400);
    expect((await createBill(accessToken, { items: [{ ...SUNFLOWER, ratePerChildPerHour: 0 }] })).status).toBe(400);
    expect((await createBill(accessToken, { items: [{ ...SUNFLOWER, ratePerChildPerHour: 300.5 }] })).status).toBe(400);
  });

  it('audits every group rate, recording who typed it', async () => {
    const { accessToken, user } = await createCashier();

    const res = await createBill(accessToken, { items: [SUNFLOWER] });

    const log = await AuditLogModel.findOne({ entityId: res.body.data.id, action: 'BILL_GROUP_RATE_ENTERED' }).lean();
    expect(log).not.toBeNull();
    expect(log?.userId?.toString()).toBe(user.id);
    const metadata = log?.metadata as { groups: { ratePerChildPerHour: number; headcount: number }[] };
    expect(metadata.groups[0]).toMatchObject({ ratePerChildPerHour: 30_000, headcount: 20 });
  });

  it('lets a cashier date a visit within the day but not to an earlier day', async () => {
    const { accessToken } = await createCashier();

    const recent = await createBill(accessToken, { items: [{ ...SUNFLOWER, visitAt: minutesAgo(90) }] });
    expect(recent.status).toBe(201);

    const old = await createBill(accessToken, { items: [{ ...SUNFLOWER, visitAt: minutesAgo(3 * 24 * 60) }] });
    expect(old.status).toBe(403);
  });

  it('refuses a visit in the future', async () => {
    const { accessToken } = await createAdmin();

    const res = await createBill(accessToken, {
      items: [{ ...SUNFLOWER, visitAt: new Date(Date.now() + 60 * 60_000).toISOString() }],
    });

    expect(res.status).toBe(400);
  });

  it('lets an admin back-enter a visit and count its revenue on the visit day', async () => {
    const { accessToken } = await createAdmin();
    const visitAt = new Date(Date.now() - 3 * 24 * 60 * 60_000);

    const draft = await createBill(accessToken, {
      items: [{ ...SUNFLOWER, visitAt: visitAt.toISOString() }],
    });
    expect(draft.status).toBe(201);

    const paid = await completeBill(accessToken, draft.body.data.id, { backdateToCheckout: true });

    expect(paid.status).toBe(200);
    // Dated to the end of the visit - when the group would have paid at the till.
    const expected = visitAt.getTime() + 120 * 60_000;
    expect(new Date(paid.body.data.bill.paidAt).getTime()).toBe(expected);
    expect(paid.body.data.bill.paymentRecordedAt).not.toBeNull();
  });

  it('prints the group, the visit and the sum on the receipt', async () => {
    const { accessToken } = await createCashier();
    const draft = await createBill(accessToken, { items: [SUNFLOWER] });
    await completeBill(accessToken, draft.body.data.id);

    const text = await request(app)
      .get(`${API}/bills/${draft.body.data.id}/receipt/text`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(text.status).toBe(200);
    expect(text.text).toContain('Group: Sunflower Pre-school');
    expect(text.text).toContain('20 kids x 2h @300/h');
    expect(text.text).toContain('12,000.00');
    expect(text.text).not.toContain('Child:');
  });
});

describe('products', () => {
  it('is managed by admins only, and cashiers see only active products', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken: cashierToken } = await createCashier();

    const denied = await request(app)
      .post(`${API}/products`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ name: 'Long socks', price: 30_000 });
    expect(denied.status).toBe(403);

    const created = await request(app)
      .post(`${API}/products`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Hidden socks ${nextCode('p')}`, price: 30_000 });
    expect(created.status).toBe(201);

    await request(app)
      .patch(`${API}/products/${created.body.data.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    const list = await request(app).get(`${API}/products`).set('Authorization', `Bearer ${cashierToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((product: { id: string }) => product.id)).not.toContain(created.body.data.id);
  });

  it('sells over the counter at a snapshotted price that a later edit cannot change', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    const socks = await createProduct({ name: 'Long socks', price: 30_000 });

    const draft = await createBill(accessToken, { items: [{ kind: 'PRODUCT', productId: socks.id, quantity: 2 }] });
    expect(draft.status).toBe(201);
    expect(draft.body.data.items[0]).toMatchObject({
      kind: 'PRODUCT',
      packageName: 'Long socks',
      productId: socks.id,
      unitPrice: 30_000,
      quantity: 2,
      lineTotal: 60_000,
      childName: '',
    });

    await request(app)
      .patch(`${API}/products/${socks.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: 99_000 });

    const paid = await completeBill(accessToken, draft.body.data.id);
    expect(paid.body.data.bill.grandTotal).toBe(60_000);
  });

  it('refuses an inactive product', async () => {
    const { accessToken } = await createCashier();
    const socks = await createProduct({ isActive: false });

    const res = await createBill(accessToken, { items: [{ kind: 'PRODUCT', productId: socks.id, quantity: 1 }] });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_PRODUCT');
  });

  it('deactivates rather than deletes a product that has been sold', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    const socks = await createProduct();
    await createBill(accessToken, { items: [{ kind: 'PRODUCT', productId: socks.id, quantity: 1 }] });

    const res = await request(app)
      .delete(`${API}/products/${socks.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.softDeleted).toBe(true);
    expect((await ProductModel.findById(socks.id))?.isActive).toBe(false);
  });

  it('still accepts a play line with no kind, as older clients send it', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage({ price: 80_000 });

    const res = await createBill(accessToken, { items: [{ childName: 'Kasun', playPackageId: pkg.id }] });

    expect(res.status).toBe(201);
    expect(res.body.data.items[0].kind).toBe('PLAY');
  });
});

describe('socks sold onto a playing child', () => {
  async function checkIn(token: string, overrides: Record<string, unknown> = {}) {
    const pkg = await createPlayPackage({ durationMinutes: 60, price: 100_000 });
    return request(app)
      .post(`${API}/play-sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ticketCode: nextCode('KPA1:t'),
        childName: 'Kasun',
        playPackageId: pkg.id,
        checkInAt: minutesAgo(60),
        ...overrides,
      });
  }

  function addExtras(token: string, ticketCode: string, extras: Record<string, unknown>[]) {
    return request(app)
      .post(`${API}/play-sessions/ticket/${encodeURIComponent(ticketCode)}/extras`)
      .set('Authorization', `Bearer ${token}`)
      .send({ extras });
  }

  function checkOut(token: string, ticketCodes: string[]) {
    return request(app)
      .post(`${API}/bills/from-sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ticketCodes });
  }

  it('takes extras at check-in and charges them at checkout, after the child', async () => {
    const { accessToken } = await createCashier();
    const socks = await createProduct({ name: 'Half socks', price: 20_000 });

    const session = await checkIn(accessToken, {
      extras: [{ localId: nextCode('x'), productId: socks.id, quantity: 1 }],
    });
    expect(session.status).toBe(201);
    expect(session.body.data.extras).toHaveLength(1);
    expect(session.body.data.extrasTotal).toBe(20_000);

    const bill = await checkOut(accessToken, [session.body.data.ticketCode]);

    expect(bill.status).toBe(201);
    const [play, extra] = bill.body.data.items;
    expect(play.kind).toBe('PLAY');
    expect(play.playSessionId).not.toBeNull();
    expect(extra).toMatchObject({ kind: 'PRODUCT', packageName: 'Half socks', childName: 'Kasun', lineTotal: 20_000 });
    // The time (a partial minute rounds up, so not exactly an hour) plus the socks.
    expect(bill.body.data.grandTotal).toBe(play.lineTotal + 20_000);
  });

  it('adds extras later, idempotently per localId', async () => {
    const { accessToken } = await createCashier();
    const socks = await createProduct({ price: 30_000 });
    const session = await checkIn(accessToken);
    const ticketCode = session.body.data.ticketCode;
    const extra = { localId: nextCode('x'), productId: socks.id, quantity: 2 };

    const first = await addExtras(accessToken, ticketCode, [extra]);
    const retry = await addExtras(accessToken, ticketCode, [extra]);

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body.data.extras).toHaveLength(1);
    expect(retry.body.data.extrasTotal).toBe(60_000);
  });

  it('merges extras carried on a replayed check-in without selling any twice', async () => {
    const { accessToken } = await createCashier();
    const socks = await createProduct({ price: 30_000 });
    const pkg = await createPlayPackage();
    const first = { localId: nextCode('x'), productId: socks.id, quantity: 1 };
    const later = { localId: nextCode('x'), productId: socks.id, quantity: 1 };
    const body = { ticketCode: nextCode('KPA1:t'), childName: 'Kasun', playPackageId: pkg.id };

    await request(app).post(`${API}/play-sessions`).set('Authorization', `Bearer ${accessToken}`).send({ ...body, extras: [first] });
    const replay = await request(app)
      .post(`${API}/play-sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...body, extras: [first, later] });

    expect(replay.status).toBe(200);
    expect(replay.body.data.extras.map((extra: { localId: string }) => extra.localId)).toEqual([
      first.localId,
      later.localId,
    ]);
  });

  it('keeps the price an extra was added at, whatever the product costs by checkout', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    const socks = await createProduct({ price: 30_000 });
    const session = await checkIn(accessToken, {
      extras: [{ localId: nextCode('x'), productId: socks.id, quantity: 1 }],
    });

    await request(app)
      .patch(`${API}/products/${socks.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price: 50_000 });
    const bill = await checkOut(accessToken, [session.body.data.ticketCode]);

    expect(bill.body.data.items[1].lineTotal).toBe(30_000);
  });

  it('refuses an extra once the child has been checked out', async () => {
    const { accessToken } = await createCashier();
    const socks = await createProduct();
    const session = await checkIn(accessToken);
    await checkOut(accessToken, [session.body.data.ticketCode]);

    const res = await addExtras(accessToken, session.body.data.ticketCode, [
      { localId: nextCode('x'), productId: socks.id, quantity: 1 },
    ]);

    expect(res.status).toBe(409);
  });

  it('removes a mistaken extra before checkout, and audits it', async () => {
    const { accessToken } = await createCashier();
    const socks = await createProduct();
    const localId = nextCode('x');
    const session = await checkIn(accessToken, { extras: [{ localId, productId: socks.id, quantity: 1 }] });
    const ticketCode = session.body.data.ticketCode;

    const res = await request(app)
      .delete(`${API}/play-sessions/ticket/${encodeURIComponent(ticketCode)}/extras/${localId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'wrong size' });

    expect(res.status).toBe(200);
    expect(res.body.data.extras).toHaveLength(0);
    expect(await AuditLogModel.countDocuments({ action: 'SESSION_EXTRA_REMOVED', entityId: session.body.data.id })).toBe(1);

    const bill = await checkOut(accessToken, [ticketCode]);
    expect(bill.body.data.items).toHaveLength(1);
  });

  it('keeps extras owed when a checkout is cancelled, and bills them on the next one', async () => {
    const { accessToken } = await createCashier();
    const socks = await createProduct({ price: 30_000 });
    const session = await checkIn(accessToken, {
      extras: [{ localId: nextCode('x'), productId: socks.id, quantity: 1 }],
    });
    const ticketCode = session.body.data.ticketCode;

    const first = await checkOut(accessToken, [ticketCode]);
    await request(app)
      .post(`${API}/bills/${first.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'staying longer' });
    const second = await checkOut(accessToken, [ticketCode]);

    expect(second.status).toBe(201);
    expect(second.body.data.items.filter((item: { kind: string }) => item.kind === 'PRODUCT')).toHaveLength(1);
  });

  it('still lists a checkout with socks as a timed bill', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    const socks = await createProduct();
    const session = await checkIn(accessToken, {
      extras: [{ localId: nextCode('x'), productId: socks.id, quantity: 1 }],
    });
    const bill = await checkOut(accessToken, [session.body.data.ticketCode]);

    const timed = await request(app)
      .get(`${API}/bills?isTimed=true&limit=100`)
      .set('Authorization', `Bearer ${adminToken}`);
    const flat = await request(app)
      .get(`${API}/bills?isTimed=false&limit=100`)
      .set('Authorization', `Bearer ${adminToken}`);

    const ids = (res: request.Response) => res.body.data.map((b: { id: string }) => b.id);
    expect(ids(timed)).toContain(bill.body.data.id);
    expect(ids(flat)).not.toContain(bill.body.data.id);
  });
});

describe('reporting with custom bills', () => {
  it('counts a group by its headcount, socks as nobody, and keeps both out of package sales', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    const socks = await createProduct({ price: 30_000 });

    const before = await request(app)
      .get(`${API}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    const beforeProducts = await request(app)
      .get(`${API}/dashboard/products?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    const soldBefore =
      beforeProducts.body.data.find((row: { productId: string }) => row.productId === socks.id)?.quantitySold ?? 0;

    const draft = await createBill(accessToken, {
      items: [SUNFLOWER, { kind: 'PRODUCT', productId: socks.id, quantity: 3 }],
    });
    await completeBill(accessToken, draft.body.data.id);

    const after = await request(app)
      .get(`${API}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    const products = await request(app)
      .get(`${API}/dashboard/products?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);
    const packages = await request(app)
      .get(`${API}/dashboard/packages?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    const delta = (key: string) => after.body.data[key] - before.body.data[key];
    expect(delta('childrenServed')).toBe(20);
    expect(delta('grossRevenue')).toBe(1_200_000 + 90_000);
    expect(after.body.data.revenueByKind.group - before.body.data.revenueByKind.group).toBe(1_200_000);
    expect(after.body.data.revenueByKind.product - before.body.data.revenueByKind.product).toBe(90_000);
    expect(after.body.data.groupVisits.headcount - before.body.data.groupVisits.headcount).toBe(20);
    expect(delta('productUnitsSold')).toBe(3);

    const row = products.body.data.find((r: { productId: string }) => r.productId === socks.id);
    expect(row.quantitySold - soldBefore).toBe(3);
    expect(packages.body.data.every((p: { playPackageId: string | null }) => p.playPackageId)).toBe(true);
  });

  it('filters the bills list by kind of line', async () => {
    const { accessToken: adminToken } = await createAdmin();
    const { accessToken } = await createCashier();
    const draft = await createBill(accessToken, { items: [SUNFLOWER] });

    const groups = await request(app)
      .get(`${API}/bills?kind=GROUP&limit=100`)
      .set('Authorization', `Bearer ${adminToken}`);
    const play = await request(app)
      .get(`${API}/bills?kind=PLAY&limit=100`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(groups.body.data.map((b: { id: string }) => b.id)).toContain(draft.body.data.id);
    expect(play.body.data.map((b: { id: string }) => b.id)).not.toContain(draft.body.data.id);
  });
});
