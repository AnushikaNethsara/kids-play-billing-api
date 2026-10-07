/**
 * The customers report: who is new, who comes back, how often, and when they arrive.
 * Built on a controlled history - bills are created through the API and then moved to
 * exact business-local times, so every figure below is known in advance.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage, createProduct } from './helpers/factories';
import { BillModel } from '../src/modules/bills/bill.model';

const API = '/api/v1';
const TIMEZONE = 'Asia/Colombo';

/** Last month: wholly in the past, so every visit placed in it is a real past time. */
const MONTH = DateTime.now().setZone(TIMEZONE).minus({ months: 1 }).startOf('month');
const FROM = MONTH.toISODate() as string;
const TO = MONTH.endOf('month').toISODate() as string;

async function visit(
  accessToken: string,
  playPackageId: string,
  phoneNumber: string | null,
  at: DateTime,
  items?: Record<string, unknown>[],
) {
  const draft = await request(app)
    .post(`${API}/bills`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      items: items ?? [{ childName: 'Child', playPackageId, quantity: 1 }],
      ...(phoneNumber ? { customer: { parentName: 'Parent', phoneNumber } } : {}),
      paymentMethod: 'CASH',
    });
  const paid = await request(app)
    .post(`${API}/bills/${draft.body.data.id}/complete`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ paymentMethod: 'CASH' });
  await BillModel.updateOne({ _id: paid.body.data.bill.id }, { $set: { paidAt: at.toJSDate() } });
}

async function seedHistory() {
  const { accessToken } = await createAdmin();
  const pkg = await createPlayPackage();
  const socks = await createProduct();
  const at = (month: DateTime, day: number, hour: number, minute = 0) =>
    month.set({ day, hour, minute });

  // A: first came two months before the report month, then twice in it.
  await visit(accessToken, pkg.id, '0771111111', at(MONTH.minus({ months: 2 }), 10, 10));
  await visit(accessToken, pkg.id, '0771111111', at(MONTH, 5, 9));
  await visit(accessToken, pkg.id, '0771111111', at(MONTH, 12, 9, 30));
  // ...and a second bill on the 12th, which is not a second visit.
  await visit(accessToken, pkg.id, '0771111111', at(MONTH, 12, 11));
  // B: first-ever visit inside the report month.
  await visit(accessToken, pkg.id, '0772222222', at(MONTH, 7, 15, 30));
  // C: only the month before - not in the report's range.
  await visit(accessToken, pkg.id, '0773333333', at(MONTH.minus({ months: 1 }), 3, 10));
  // A walk-in with no number.
  await visit(accessToken, pkg.id, null, at(MONTH, 8, 12));
  // Socks on their own: a sale, not a visit.
  await visit(accessToken, pkg.id, '0774444444', at(MONTH, 9, 12), [
    { kind: 'PRODUCT', productId: socks.id, quantity: 1 },
  ]);

  return accessToken;
}

async function getReport(accessToken: string, query: Record<string, string>) {
  return request(app).get(`${API}/reports/customers`).query(query).set('Authorization', `Bearer ${accessToken}`);
}

describe('customers report', () => {
  it('separates new families from returning ones', async () => {
    const accessToken = await seedHistory();

    const res = await getReport(accessToken, { from: FROM, to: TO, groupBy: 'month' });

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({
      uniqueFamilies: 2,
      visits: 4,
      newFamilies: 1,
      returningFamilies: 1,
      returningShare: 0.5,
      anonymousVisits: 1,
    });
    expect(res.body.data.newVsReturning).toEqual([
      {
        label: MONTH.toFormat('yyyy-MM'),
        start: FROM,
        end: TO,
        visits: 4,
        families: 2,
        newFamilies: 1,
        returningFamilies: 1,
      },
    ]);
  });

  it('counts how many times each family came', async () => {
    const accessToken = await seedHistory();

    const res = await getReport(accessToken, { from: FROM, to: TO });

    expect(res.body.data.frequencyHistogram).toEqual([
      { label: '1', families: 1 },
      { label: '2-3', families: 1 },
      { label: '4-9', families: 0 },
      { label: '10+', families: 0 },
    ]);
  });

  it('follows each first-visit month forward', async () => {
    const accessToken = await seedHistory();

    const res = await getReport(accessToken, { from: FROM, to: TO });
    const cohorts = res.body.data.cohorts as { month: string; size: number; retention: number[] }[];

    expect(cohorts).toHaveLength(12);
    expect(cohorts[cohorts.length - 1].month).toBe(MONTH.toFormat('yyyy-MM'));
    // A: came in its first month, not the next, then again two months on.
    expect(cohorts[cohorts.length - 3]).toEqual({
      month: MONTH.minus({ months: 2 }).toFormat('yyyy-MM'),
      size: 1,
      retention: [1, 0, 1],
    });
    // C: never came back.
    expect(cohorts[cohorts.length - 2]).toMatchObject({ size: 1, retention: [1, 0] });
    expect(cohorts[cohorts.length - 1]).toMatchObject({ size: 1, retention: [1] });
  });

  it('places each visit at the hour it began, split by new and returning', async () => {
    const accessToken = await seedHistory();

    const res = await getReport(accessToken, { from: FROM, to: TO });
    const cells = res.body.data.dayHourHeatmap as {
      weekday: number;
      hour: number;
      newVisits: number;
      returningVisits: number;
    }[];
    const cellAt = (day: number, hour: number) => {
      const weekday = MONTH.set({ day }).weekday - 1;
      return cells.find((cell) => cell.weekday === weekday && cell.hour === hour);
    };

    expect(cells).toHaveLength(7 * 24);
    expect(cellAt(7, 15)?.newVisits).toBe(1);
    expect(cellAt(5, 9)?.returningVisits).toBeGreaterThanOrEqual(1);
    // The 12th counts once, at its first bill - 9:30, not 11:00.
    expect(cells.reduce((sum, cell) => sum + cell.newVisits + cell.returningVisits, 0)).toBe(3);
  });

  it('exports the period rows as CSV, for admins only', async () => {
    const accessToken = await seedHistory();
    const { accessToken: cashierToken } = await createCashier();

    const csv = await getReport(accessToken, { from: FROM, to: TO, groupBy: 'month', format: 'csv' });
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Period,From,To,Visits,Families,New families,Returning families');

    const forbidden = await getReport(cashierToken, { from: FROM, to: TO });
    expect(forbidden.status).toBe(403);
  });
});
