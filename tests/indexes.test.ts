/**
 * The bills collection is the one place where an index left over from an earlier schema
 * silently broke correct code: a unique+sparse `billNumber_1` indexed every unpaid draft
 * under the same null key, so the second draft created while another was unpaid failed
 * with E11000 and reached the app as a 500. Mongoose cannot replace an index whose name
 * already exists with different options, so the schema change alone never took effect on
 * a live database. These tests pin both halves of the fix.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createCashier, createPlayPackage } from './helpers/factories';
import { BillModel } from '../src/modules/bills/bill.model';
import { ensureIndexes } from '../src/database/ensureIndexes';

const API = '/api/v1';

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:index-${Date.now()}-${ticketCounter}`;
}

/** Puts the collection back into the state a pre-fix deployment is in. */
async function installLegacyBillNumberIndex(): Promise<void> {
  await BillModel.init();
  try {
    await BillModel.collection.dropIndex('billNumber_1');
  } catch {
    // Not there yet on a fresh collection - nothing to drop.
  }
  await BillModel.collection.createIndex(
    { billNumber: 1 },
    { unique: true, sparse: true, name: 'billNumber_1' },
  );
}

async function billNumberIndex(): Promise<Record<string, unknown> | undefined> {
  const indexes = (await BillModel.collection.indexes()) as Record<string, unknown>[];
  return indexes.find((index) => index.name === 'billNumber_1');
}

async function checkIn(accessToken: string, playPackageId: string, ticketCode: string) {
  return request(app)
    .post(`${API}/play-sessions`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      ticketCode,
      childName: 'Kasun',
      playPackageId,
      checkInAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      customer: { parentName: 'Nimal Perera', phoneNumber: '0771234567' },
    });
}

describe('index reconciliation', () => {
  beforeEach(async () => {
    await installLegacyBillNumberIndex();
  });

  // Test files share one database, and the shared cleanup only empties collections.
  // Leaving the outdated index installed would break whichever file runs next.
  afterAll(async () => {
    await ensureIndexes();
  });

  it('replaces the outdated billNumber index with the partial one', async () => {
    await ensureIndexes();

    const index = await billNumberIndex();
    expect(index).toBeDefined();
    expect(index?.unique).toBe(true);
    expect(index?.sparse).toBeUndefined();
    expect(index?.partialFilterExpression).toEqual({ billNumber: { $type: 'string' } });
  });

  it('leaves an already-current index alone', async () => {
    await ensureIndexes();
    await ensureIndexes();

    const index = await billNumberIndex();
    expect(index?.partialFilterExpression).toEqual({ billNumber: { $type: 'string' } });
  });

  it('lets a second checkout draft be created while the first is still unpaid', async () => {
    await ensureIndexes();

    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage({ name: '1 Hour', durationMinutes: 60, price: 100_000 });
    const first = nextTicketCode();
    const second = nextTicketCode();
    await checkIn(accessToken, pkg.id, first);
    await checkIn(accessToken, pkg.id, second);

    const firstBill = await request(app)
      .post(`${API}/bills/from-sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ticketCodes: [first] });
    const secondBill = await request(app)
      .post(`${API}/bills/from-sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ticketCodes: [second] });

    expect(firstBill.status).toBe(201);
    expect(secondBill.status).toBe(201);
    expect(secondBill.body.data.billNumber).toBeNull();
  });

  it('answers a duplicate key with a conflict rather than a retryable server error', async () => {
    // No ensureIndexes() here: the collection keeps the outdated index, which is the
    // only way to provoke a duplicate key on a draft. An offline-first client retries a
    // 5xx forever, so this must not be one.
    const { accessToken } = await createCashier();
    const pkg = await createPlayPackage({ name: '1 Hour', durationMinutes: 60, price: 100_000 });
    const first = nextTicketCode();
    const second = nextTicketCode();
    await checkIn(accessToken, pkg.id, first);
    await checkIn(accessToken, pkg.id, second);

    await request(app)
      .post(`${API}/bills/from-sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ticketCodes: [first] });
    const res = await request(app)
      .post(`${API}/bills/from-sessions`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ticketCodes: [second] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_RESOURCE');
  });
});
