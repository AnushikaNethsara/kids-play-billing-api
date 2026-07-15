import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';

const API = '/api/v1';

describe('play packages', () => {
  it('lets an admin create a play package', async () => {
    const { accessToken } = await createAdmin();

    const res = await request(app)
      .post(`${API}/play-packages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '1 Hour', durationMinutes: 60, price: 80000 });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('1 Hour');
    expect(res.body.data.price).toBe(80000);
  });

  it('rejects a non-positive duration', async () => {
    const { accessToken } = await createAdmin();

    const res = await request(app)
      .post(`${API}/play-packages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bad Package', durationMinutes: 0, price: 1000 });

    expect(res.status).toBe(400);
  });

  it('rejects a negative price', async () => {
    const { accessToken } = await createAdmin();

    const res = await request(app)
      .post(`${API}/play-packages`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bad Package', durationMinutes: 30, price: -100 });

    expect(res.status).toBe(400);
  });

  it('only returns active packages to a cashier', async () => {
    await createPlayPackage({ name: 'Active Package', isActive: true });
    await createPlayPackage({ name: 'Inactive Package', isActive: false });
    const { accessToken } = await createCashier();

    const res = await request(app)
      .get(`${API}/play-packages`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const names = res.body.data.map((p: { name: string }) => p.name);
    expect(names).toContain('Active Package');
    expect(names).not.toContain('Inactive Package');
  });
});
