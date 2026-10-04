import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { BillModel } from '../src/modules/bills/bill.model';
import { AuditLogModel } from '../src/modules/audit-logs/auditLog.model';
import { BusinessSettingsModel } from '../src/modules/settings/settings.model';

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';

function businessDate(daysAgo = 0): string {
  return DateTime.now().setZone(TIMEZONE).minus({ days: daysAgo }).toISODate() as string;
}

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:report-${Date.now()}-${ticketCounter}`;
}

async function payBill(
  accessToken: string,
  playPackageId: string,
  options: {
    paymentMethod?: string;
    childName?: string;
    phoneNumber?: string;
    discount?: { type: string; value: number };
  } = {},
) {
  const draft = await request(app)
    .post(`${API}/bills`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      items: [{ childName: options.childName ?? 'Child', playPackageId, quantity: 1 }],
      customer: { parentName: 'Nimal Perera', phoneNumber: options.phoneNumber ?? '0771234567' },
      paymentMethod: options.paymentMethod ?? 'CASH',
      ...(options.discount ? { discount: options.discount } : {}),
    });
  expect(draft.status).toBe(201);

  const paid = await request(app)
    .post(`${API}/bills/${draft.body.data.id}/complete`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ paymentMethod: options.paymentMethod ?? 'CASH' });
  expect(paid.status).toBe(200);
  return paid.body.data.bill as { id: string; billNumber: string; grandTotal: number };
}

function get(path: string, accessToken: string) {
  return request(app).get(`${API}${path}`).set('Authorization', `Bearer ${accessToken}`);
}

describe('reports', () => {
  describe('access', () => {
    it('is admin-only', async () => {
      const { accessToken } = await createCashier();
      const res = await get(`/reports/bill-register?from=${businessDate()}&to=${businessDate()}`, accessToken);
      expect(res.status).toBe(403);
    });

    it('rejects a range longer than 366 days', async () => {
      const { accessToken } = await createAdmin();
      const res = await get(`/reports/bill-register?from=${businessDate(400)}&to=${businessDate()}`, accessToken);
      expect(res.status).toBe(400);
    });
  });

  describe('daily close', () => {
    it('matches the dashboard summary for the same day', async () => {
      const { accessToken: cashierToken } = await createCashier();
      const { accessToken: adminToken } = await createAdmin();
      const pkg = await createPlayPackage({ price: 80000 });

      await payBill(cashierToken, pkg.id, { paymentMethod: 'CASH' });
      await payBill(cashierToken, pkg.id, { paymentMethod: 'CARD', discount: { type: 'PERCENTAGE', value: 10 } });

      const today = businessDate();
      const [close, summary] = await Promise.all([
        get(`/reports/daily-close?date=${today}`, adminToken),
        get(`/dashboard/summary?from=${today}&to=${today}`, adminToken),
      ]);

      expect(close.status).toBe(200);
      expect(close.body.data.summary).toEqual(summary.body.data);
      expect(close.body.data.summary.grossRevenue).toBe(160000);
      expect(close.body.data.summary.discounts).toBe(8000);
      expect(close.body.data.billNumberRange.first).toMatch(/^KPA-/);
      expect(close.body.data.header.generatedBy).toBe('Test Admin');

      const cash = close.body.data.paymentMethods.find((row: { paymentMethod: string }) => row.paymentMethod === 'CASH');
      expect(cash.amount).toBe(80000);
    });

    it('lists a bill paid that day and cancelled later under adjustments, and drops it from the totals', async () => {
      const { accessToken: cashierToken } = await createCashier();
      const { accessToken: adminToken } = await createAdmin();
      const pkg = await createPlayPackage({ price: 50000 });

      const bill = await payBill(cashierToken, pkg.id);
      const yesterdayNoon = DateTime.now().setZone(TIMEZONE).minus({ days: 1 }).set({ hour: 12 }).toJSDate();
      await BillModel.updateOne({ _id: bill.id }, { $set: { paidAt: yesterdayNoon } });

      const cancel = await request(app)
        .post(`${API}/bills/${bill.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Customer disputed the charge' });
      expect(cancel.status).toBe(200);

      const close = await get(`/reports/daily-close?date=${businessDate(1)}`, adminToken);
      expect(close.status).toBe(200);
      expect(close.body.data.summary.grossRevenue).toBe(0);
      expect(close.body.data.adjustments).toHaveLength(1);
      expect(close.body.data.adjustments[0]).toMatchObject({
        billId: bill.id,
        action: 'CANCELLED',
        amount: 50000,
        actorName: 'Test Admin',
        reason: 'Customer disputed the charge',
      });
    });
  });

  describe('bill register', () => {
    it('returns paid bills with totals that reconcile, and leaves test bills out', async () => {
      const { accessToken: cashierToken } = await createCashier();
      const { accessToken: adminToken } = await createAdmin();
      const pkg = await createPlayPackage({ price: 80000 });

      await payBill(cashierToken, pkg.id);
      const testBill = await payBill(cashierToken, pkg.id);
      await request(app)
        .post(`${API}/bills/${testBill.id}/test`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isTestBill: true, reason: 'Printer check' });

      const today = businessDate();
      const res = await get(`/reports/bill-register?from=${today}&to=${today}`, adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].phoneNumber).toBe('077****567');
      expect(res.body.data[0].parentName).toBe('');
      expect(res.body.meta.total).toBe(1);
      expect(res.body.meta.totals).toMatchObject({ billCount: 1, grossRevenue: 80000, netRevenue: 80000 });
    });

    it('line-level rows sum to the bill subtotals', async () => {
      const { accessToken: cashierToken } = await createCashier();
      const { accessToken: adminToken } = await createAdmin();
      const pkg = await createPlayPackage({ price: 80000 });

      await payBill(cashierToken, pkg.id);
      await payBill(cashierToken, pkg.id, { discount: { type: 'PERCENTAGE', value: 10 } });

      const today = businessDate();
      const [bills, lines] = await Promise.all([
        get(`/reports/bill-register?from=${today}&to=${today}`, adminToken),
        get(`/reports/bill-register?from=${today}&to=${today}&level=line`, adminToken),
      ]);

      const subtotal = bills.body.data.reduce((sum: number, row: { subtotal: number }) => sum + row.subtotal, 0);
      const lineTotal = lines.body.data.reduce((sum: number, row: { lineTotal: number }) => sum + row.lineTotal, 0);
      expect(lines.body.data).toHaveLength(2);
      expect(lineTotal).toBe(subtotal);
    });

    it('exports CSV with a BOM, plain decimals, a formula guard, masking and an audit entry', async () => {
      const { accessToken: cashierToken } = await createCashier();
      const { accessToken: adminToken, user: admin } = await createAdmin();
      const pkg = await createPlayPackage({ price: 80000 });

      await payBill(cashierToken, pkg.id, { childName: '=HYPERLINK("http://x","y")' });
      const today = businessDate();

      const masked = await get(`/reports/bill-register?from=${today}&to=${today}&format=csv`, adminToken);
      expect(masked.status).toBe(200);
      expect(masked.headers['content-type']).toContain('text/csv');
      expect(masked.headers['content-disposition']).toContain(`kpa-bill-register_${today}_${today}.csv`);
      expect(masked.text.startsWith('﻿')).toBe(true);
      expect(masked.text).toContain('800.00');
      expect(masked.text).toContain('077****567');
      expect(masked.text).not.toContain('Nimal Perera');

      const lines = await get(`/reports/bill-register?from=${today}&to=${today}&format=csv&level=line`, adminToken);
      expect(lines.text).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);

      const full = await get(
        `/reports/bill-register?from=${today}&to=${today}&format=csv&includeContact=true`,
        adminToken,
      );
      expect(full.text).toContain('0771234567');
      expect(full.text).toContain('Nimal Perera');

      const audits = await AuditLogModel.find({ action: 'REPORT_EXPORTED', userId: admin._id }).lean();
      expect(audits).toHaveLength(3);
      const withContact = audits.find((log) => (log.metadata as { includeContact?: boolean }).includeContact);
      expect(withContact?.metadata).toMatchObject({ rowCount: 1, completed: true, from: today, to: today });
    });

    it('does not audit a JSON preview', async () => {
      const { accessToken, user } = await createAdmin();
      await get(`/reports/bill-register?from=${businessDate()}&to=${businessDate()}`, accessToken);
      expect(await AuditLogModel.countDocuments({ action: 'REPORT_EXPORTED', userId: user._id })).toBe(0);
    });
  });

  describe('exceptions', () => {
    it('collects discounts, refunds, test flags and voids with who did them', async () => {
      const { accessToken: cashierToken } = await createCashier();
      const { accessToken: adminToken } = await createAdmin();
      const pkg = await createPlayPackage({ price: 80000 });

      await payBill(cashierToken, pkg.id, { discount: { type: 'PERCENTAGE', value: 10 } });

      const refunded = await payBill(cashierToken, pkg.id);
      await request(app)
        .post(`${API}/bills/${refunded.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Child was unwell' });

      const flagged = await payBill(cashierToken, pkg.id);
      await request(app)
        .post(`${API}/bills/${flagged.id}/test`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isTestBill: true, reason: 'Training' });

      const checkIn = await request(app)
        .post(`${API}/play-sessions`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ ticketCode: nextTicketCode(), childName: 'Kasun', playPackageId: pkg.id });
      await request(app)
        .post(`${API}/play-sessions/${checkIn.body.data.id}/void`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Wrong child' });

      const today = businessDate();
      const res = await get(`/reports/exceptions?from=${today}&to=${today}`, adminToken);

      expect(res.status).toBe(200);
      const { countsByType, rows } = res.body.data;
      expect(countsByType.DISCOUNT).toBe(1);
      expect(countsByType.REFUND).toBe(1);
      expect(countsByType.TEST_FLAG).toBe(1);
      expect(countsByType.VOID).toBe(1);

      const testFlag = rows.find((row: { type: string }) => row.type === 'TEST_FLAG');
      expect(testFlag).toMatchObject({ actorName: 'Test Admin', reason: 'Training', entityId: flagged.id });
      const refund = rows.find((row: { type: string }) => row.type === 'REFUND');
      expect(refund).toMatchObject({ actorName: 'Test Admin', cashierName: 'Test Cashier', amount: 80000 });
      const discount = rows.find((row: { type: string }) => row.type === 'DISCOUNT');
      expect(discount.detail).toBe('10.0% of subtotal');

      const onlyVoids = await get(`/reports/exceptions?from=${today}&to=${today}&type=VOID`, adminToken);
      expect(onlyVoids.body.data.rows).toHaveLength(1);
    });
  });

  describe('sessions', () => {
    it('lists sessions with billed minutes and flags the minimum charge', async () => {
      const { accessToken: cashierToken } = await createCashier();
      const { accessToken: adminToken } = await createAdmin();
      const pkg = await createPlayPackage({ durationMinutes: 60, price: 100_000 });
      await BusinessSettingsModel.updateOne({}, { $set: { minimumBillableMinutes: 30 } }, { upsert: true });

      const ticketCode = nextTicketCode();
      await request(app)
        .post(`${API}/play-sessions`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          ticketCode,
          childName: 'Kasun',
          playPackageId: pkg.id,
          checkInAt: new Date(Date.now() - 10 * 60_000).toISOString(),
          customer: { parentName: 'Nimal Perera', phoneNumber: '0771234567' },
        });
      const draft = await request(app)
        .post(`${API}/bills/from-sessions`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ ticketCodes: [ticketCode] });
      expect(draft.status).toBe(201);

      const today = businessDate();
      const res = await get(`/reports/sessions?from=${today}&to=${today}`, adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        ticketCode,
        status: 'CLOSED',
        billedMinutes: 30,
        minimumApplied: true,
        chargedAmount: 50_000,
        phoneNumber: '077****567',
      });
      expect(res.body.data[0].actualMinutes).toBeGreaterThanOrEqual(9);
      expect(res.body.data[0].billId).toBe(draft.body.data.id);

      const csv = await get(`/reports/sessions?from=${today}&to=${today}&format=csv`, adminToken);
      expect(csv.status).toBe(200);
      expect(csv.text).toContain(ticketCode);
      expect(csv.text).toContain('500.00');
    });
  });
});
