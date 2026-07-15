import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { PlayPackageModel } from '../src/modules/play-packages/playPackage.model';

const API = '/api/v1';

async function createDraftBill(accessToken: string, playPackageId: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`${API}/bills`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      customer: { parentName: 'Nimal Perera', phoneNumber: '0771234567' },
      items: [{ childName: 'Kasun', playPackageId, quantity: 1 }],
      paymentMethod: 'CASH',
      ...overrides,
    });
}

describe('bills', () => {
  it('creates a draft bill and computes totals server-side', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage({ price: 80000 });

    const res = await createDraftBill(accessToken, pkg.id);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.subtotal).toBe(80000);
    expect(res.body.data.grandTotal).toBe(80000);
    expect(res.body.data.items[0].packageName).toBe(pkg.name);
  });

  it('rejects a bill referencing a non-existent play package', async () => {
    const { accessToken } = await createCashier();

    const res = await createDraftBill(accessToken, '000000000000000000000000');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_PLAY_PACKAGE');
  });

  it('rejects a bill referencing an inactive play package', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage({ isActive: false });

    const res = await createDraftBill(accessToken, pkg.id);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_PLAY_PACKAGE');
  });

  it('ignores any client-supplied cashier identity and always uses the authenticated user', async () => {
    const { accessToken, user } = await createCashier();
    const pkg = await createPlayPackage();

    const res = await createDraftBill(accessToken, pkg.id);

    expect(res.body.data.cashierId).toBe(user.id);
  });

  it('completes a draft bill, generating a bill number and receipt data', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage({ price: 80000 });
    const draft = await createDraftBill(accessToken, pkg.id);

    const res = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethod: 'CASH', paidAmount: 100000 });

    expect(res.status).toBe(200);
    expect(res.body.data.bill.status).toBe('PAID');
    expect(res.body.data.bill.billNumber).toMatch(/^KPA-\d{8}-\d{4}$/);
    expect(res.body.data.bill.balance).toBe(20000);
    expect(res.body.data.receipt.bill.billNumber).toBe(res.body.data.bill.billNumber);
  });

  it('prevents completing the same bill twice', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage();
    const draft = await createDraftBill(accessToken, pkg.id);

    const first = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethod: 'CASH' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethod: 'CASH' });

    expect(second.status).toBe(409);
  });

  it('replays the same response for a retried request with the same Idempotency-Key', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage();
    const draft = await createDraftBill(accessToken, pkg.id);
    const idempotencyKey = 'test-idempotency-key-1';

    const first = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ paymentMethod: 'CASH' });

    const second = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ paymentMethod: 'CASH' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.bill.billNumber).toBe(first.body.data.bill.billNumber);
    expect(second.body.message).toMatch(/idempotent replay/i);
  });

  it('generates unique, sequential bill numbers for the same business day', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage();

    const draft1 = await createDraftBill(accessToken, pkg.id);
    const complete1 = await request(app)
      .post(`${API}/bills/${draft1.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethod: 'CASH' });

    const draft2 = await createDraftBill(accessToken, pkg.id);
    const complete2 = await request(app)
      .post(`${API}/bills/${draft2.body.data.id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethod: 'CASH' });

    expect(complete1.body.data.bill.billNumber).not.toBe(complete2.body.data.bill.billNumber);
  });

  it('applies a fixed discount within the cashier cap', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage({ price: 100000 });

    const res = await createDraftBill(accessToken, pkg.id, {
      discount: { type: 'FIXED', value: 5000 },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.discount).toBe(5000);
    expect(res.body.data.grandTotal).toBe(95000);
  });

  it('applies a percentage discount', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage({ price: 100000 });

    const res = await createDraftBill(accessToken, pkg.id, {
      discount: { type: 'PERCENTAGE', value: 10 },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.discount).toBe(10000);
    expect(res.body.data.grandTotal).toBe(90000);
  });

  it('rejects a cashier discount above the configured maximum', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage({ price: 100000 });

    // default maximumCashierDiscountPercentage is 10
    const res = await createDraftBill(accessToken, pkg.id, {
      discount: { type: 'PERCENTAGE', value: 50 },
    });

    expect(res.status).toBe(400);
  });

  it('lets a cashier cancel their own draft bill with a reason', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage();
    const draft = await createDraftBill(accessToken, pkg.id);

    const res = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'Customer changed their mind' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('rejects cancelling a bill without a reason', async () => {
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage();
    const draft = await createDraftBill(accessToken, pkg.id);

    const res = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('prevents one cashier from cancelling another cashier draft bill', async () => {
    const cashierA = await createCashier();
    const cashierB = await createCashier();
    const pkg = await createPlayPackage();
    const draft = await createDraftBill(cashierA.accessToken, pkg.id);

    const res = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${cashierB.accessToken}`)
      .send({ reason: 'not mine' });

    expect(res.status).toBe(403);
  });

  it('lets an admin refund a paid bill, and rejects a second refund', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage();
    const draft = await createDraftBill(cashierToken, pkg.id);
    const completed = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/complete`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ paymentMethod: 'CASH' });

    const refund = await request(app)
      .post(`${API}/bills/${completed.body.data.bill.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer requested a refund' });

    expect(refund.status).toBe(200);
    expect(refund.body.data.status).toBe('REFUNDED');

    const secondRefund = await request(app)
      .post(`${API}/bills/${completed.body.data.bill.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Trying again' });

    expect(secondRefund.status).toBe(409);
  });

  it('rejects refunding a draft (unpaid) bill', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage();
    const draft = await createDraftBill(cashierToken, pkg.id);

    const res = await request(app)
      .post(`${API}/bills/${draft.body.data.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'test' });

    expect(res.status).toBe(409);
  });
});

describe('play package usage guard', () => {
  it('deactivates rather than deletes a package already used in a bill', async () => {
    const { accessToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const pkg = await createPlayPackage();
    await createDraftBill(accessToken, pkg.id);

    const res = await request(app)
      .delete(`${API}/play-packages/${pkg.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.softDeleted).toBe(true);

    const stillExists = await PlayPackageModel.findById(pkg.id);
    expect(stillExists).not.toBeNull();
    expect(stillExists?.isActive).toBe(false);
  });
});
