/**
 * The one-off customer repair: data written before phone numbers were normalised is
 * rewritten, duplicate customers merged, bills and tickets linked to their family, and
 * every counter recomputed. The dry run must write nothing and report exactly what the
 * apply then does; a second apply must find nothing left to do.
 */

import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { app } from './helpers/testApp';
import { createAdmin, createPlayPackage } from './helpers/factories';
import { CustomerModel } from '../src/modules/customers/customer.model';
import { BillModel } from '../src/modules/bills/bill.model';
import { PlaySessionModel } from '../src/modules/play-sessions/playSession.model';
import { AuditLogModel } from '../src/modules/audit-logs/auditLog.model';
import { runCustomerCleanup } from '../src/modules/customers/customerCleanup';
import { ensureIndexes } from '../src/database/ensureIndexes';

const API = '/api/v1';

async function payBill(accessToken: string, playPackageId: string, phoneNumber: string) {
  const draft = await request(app)
    .post(`${API}/bills`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      items: [{ childName: 'Kasun', playPackageId, quantity: 1 }],
      customer: { parentName: 'Nimal Perera', phoneNumber },
      paymentMethod: 'CASH',
    });
  const paid = await request(app)
    .post(`${API}/bills/${draft.body.data.id}/complete`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ paymentMethod: 'CASH' });
  return paid.body.data.bill as { id: string };
}

/**
 * Puts the database into the state a deployment from before normalisation is in, by
 * writing straight to the collections - the API would normalise everything on the way in.
 */
async function seedLegacyData() {
  const { accessToken } = await createAdmin();
  const pkg = await createPlayPackage({ price: 80_000 });

  // A family whose number exists three ways: on its bill, and on two customer records.
  const familyBill = await payBill(accessToken, pkg.id, '0771234567');
  await BillModel.collection.updateOne(
    { _id: new Types.ObjectId(familyBill.id) },
    { $set: { phoneNumber: '077 123 4567', customerId: null } },
  );
  await CustomerModel.collection.updateMany({}, { $set: { phoneNumber: '+94 77 123 4567', email: 'nimal@example.com' } });
  const older = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  await CustomerModel.collection.insertOne({
    phoneNumber: '0771234567',
    parentName: '',
    email: '',
    notes: 'Allergic to peanuts',
    visitCount: 7,
    totalSpent: 999,
    lastVisitAt: null,
    createdAt: older,
    updatedAt: older,
  });

  // A family who paid but whose customer record never got created.
  const orphanBill = await payBill(accessToken, pkg.id, '0779999999');
  await CustomerModel.deleteOne({ phoneNumber: '+94779999999' });
  await BillModel.collection.updateOne(
    { _id: new Types.ObjectId(orphanBill.id) },
    { $set: { phoneNumber: '0779999999', customerId: null } },
  );

  // A ticket typed with spaces, never linked.
  await PlaySessionModel.create({
    ticketCode: `KPA1:cleanup-${Date.now()}`,
    status: 'ACTIVE',
    childName: 'Amal',
    playPackageId: new Types.ObjectId(pkg.id),
    packageName: pkg.name,
    rateDurationMinutes: 60,
    unitPrice: 80_000,
    phoneNumber: '077 123 4567',
    checkInAt: new Date(),
    checkInRecordedAt: new Date(),
    checkInCashierId: new Types.ObjectId(),
    checkInCashierName: 'Cashier',
  });
}

describe('customer cleanup', () => {
  it('reports without writing on a dry run', async () => {
    await seedLegacyData();
    const before = await CustomerModel.find({}).lean();

    const report = await runCustomerCleanup({ apply: false });

    expect(report.merges).toHaveLength(1);
    expect(report.merges[0].phoneNumber).toBe('+94771234567');
    expect(report.customersCreated).toBe(1);
    expect(report.billsLinked).toBe(2);
    expect(report.sessionsLinked).toBe(1);
    expect(report.phonesNormalised.bills).toBe(2);
    expect(report.phonesNormalised.sessions).toBe(1);
    expect(await CustomerModel.find({}).lean()).toEqual(before);
    expect(await BillModel.countDocuments({ customerId: null })).toBe(2);
  });

  it('merges, links and recomputes on apply, and a re-run finds nothing to do', async () => {
    await seedLegacyData();

    await runCustomerCleanup({ apply: true });

    const customers = await CustomerModel.find({}).sort({ phoneNumber: 1 }).lean();
    expect(customers.map((row) => row.phoneNumber)).toEqual(['+94771234567', '+94779999999']);

    const family = customers[0];
    // The oldest record survives, with what the duplicate knew folded in.
    expect(family.notes).toBe('Allergic to peanuts');
    expect(family.email).toBe('nimal@example.com');
    // Recomputed from the bills, not carried over from the stale counters.
    expect(family.visitCount).toBe(1);
    expect(family.totalSpent).toBe(80_000);
    expect(customers[1].visitCount).toBe(1);

    expect(await BillModel.countDocuments({ customerId: null })).toBe(0);
    expect(await BillModel.countDocuments({ phoneNumber: '+94771234567', customerId: family._id })).toBe(1);
    const session = await PlaySessionModel.findOne({}).lean();
    expect(session?.phoneNumber).toBe('+94771234567');
    expect(String(session?.customerId)).toBe(String(family._id));
    expect(await AuditLogModel.countDocuments({ action: 'CUSTOMERS_MERGED' })).toBe(1);

    const rerun = await runCustomerCleanup({ apply: true });
    expect(rerun.merges).toHaveLength(0);
    expect(rerun.customersCreated).toBe(0);
    expect(rerun.billsLinked).toBe(0);
    expect(rerun.sessionsLinked).toBe(0);
    expect(rerun.phonesNormalised).toEqual({ customers: 0, bills: 0, sessions: 0 });
  });
});

describe('phone indexes', () => {
  afterAll(async () => {
    await ensureIndexes();
  });

  it('rebuilds the customer phone index as unique and drops the superseded ones', async () => {
    await CustomerModel.init();
    await CustomerModel.collection.dropIndex('phoneNumber_1').catch(() => undefined);
    await CustomerModel.collection.createIndex({ phoneNumber: 1 }, { name: 'phoneNumber_1' });
    await BillModel.collection.createIndex({ phoneNumber: 1 }, { name: 'phoneNumber_1' });

    await ensureIndexes();

    const customerIndexes = (await CustomerModel.collection.indexes()) as Record<string, unknown>[];
    const phone = customerIndexes.find((index) => index.name === 'phoneNumber_1');
    expect(phone?.unique).toBe(true);
    expect(phone?.partialFilterExpression).toEqual({ phoneNumber: { $gt: '' } });

    const billIndexes = (await BillModel.collection.indexes()) as Record<string, unknown>[];
    expect(billIndexes.some((index) => index.name === 'phoneNumber_1')).toBe(false);
    expect(billIndexes.some((index) => index.name === 'phoneNumber_1_paidAt_-1')).toBe(true);
  });

  it('refuses a second customer with the same number', async () => {
    await CustomerModel.create({ phoneNumber: '+94771234567' });
    await expect(CustomerModel.create({ phoneNumber: '+94771234567' })).rejects.toMatchObject({ code: 11000 });
    // Customers without a number are not constrained.
    await CustomerModel.create({ phoneNumber: '' });
    await CustomerModel.create({ phoneNumber: '' });
  });
});
