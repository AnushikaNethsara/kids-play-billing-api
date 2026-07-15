import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from './helpers/testApp';
import { UserModel } from '../src/modules/users/user.model';
import { UserRole } from '../src/common/constants/roles';

const API = '/api/v1';

describe('auth', () => {
  it('logs in with valid credentials and returns tokens', async () => {
    const passwordHash = await bcrypt.hash('CorrectPass123!', 4);
    await UserModel.create({
      name: 'Login Test',
      email: 'login-test@example.com',
      passwordHash,
      role: UserRole.ADMIN,
    });

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'login-test@example.com', password: 'CorrectPass123!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.email).toBe('login-test@example.com');
  });

  it('rejects an incorrect password', async () => {
    const passwordHash = await bcrypt.hash('CorrectPass123!', 4);
    await UserModel.create({
      name: 'Login Test 2',
      email: 'login-test-2@example.com',
      passwordHash,
      role: UserRole.ADMIN,
    });

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'login-test-2@example.com', password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects login for a deactivated account', async () => {
    const passwordHash = await bcrypt.hash('CorrectPass123!', 4);
    await UserModel.create({
      name: 'Inactive User',
      email: 'inactive@example.com',
      passwordHash,
      role: UserRole.CASHIER,
      isActive: false,
    });

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'inactive@example.com', password: 'CorrectPass123!' });

    expect(res.status).toBe(401);
  });

  it('rejects /auth/me without a token', async () => {
    const res = await request(app).get(`${API}/auth/me`);
    expect(res.status).toBe(401);
  });

  it('returns the current user profile with a valid token', async () => {
    const passwordHash = await bcrypt.hash('CorrectPass123!', 4);
    await UserModel.create({
      name: 'Me Test',
      email: 'me-test@example.com',
      passwordHash,
      role: UserRole.ADMIN,
    });

    const loginRes = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'me-test@example.com', password: 'CorrectPass123!' });

    const meRes = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe('me-test@example.com');
    expect(meRes.body.data.passwordHash).toBeUndefined();
  });
});
