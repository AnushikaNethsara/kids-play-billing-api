import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';

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
