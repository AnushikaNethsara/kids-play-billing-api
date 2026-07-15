import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createAdmin, createCashier } from './helpers/factories';

const API = '/api/v1';

describe('role-based access control', () => {
  it('blocks a cashier from listing users (admin-only)', async () => {
    const { accessToken } = await createCashier();

    const res = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('allows an admin to list users', async () => {
    const { accessToken } = await createAdmin();

    const res = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
  });

  it('blocks a cashier from creating a play package', async () => {
    const { accessToken } = await createCashier();

    const res = await request(app)
      .post(`${API}/play-packages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '3 Hours', durationMinutes: 180, price: 200000 });

    expect(res.status).toBe(403);
  });

  it('blocks a cashier from the admin dashboard', async () => {
    const { accessToken } = await createCashier();

    const res = await request(app)
      .get(`${API}/dashboard/summary`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('blocks a cashier from issuing a refund', async () => {
    const { accessToken } = await createCashier();

    const res = await request(app)
      .post(`${API}/bills/000000000000000000000000/refund`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'test' });

    expect(res.status).toBe(403);
  });
});
