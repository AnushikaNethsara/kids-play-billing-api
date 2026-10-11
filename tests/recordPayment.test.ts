/**
 * Recording payment on a checkout that was abandoned at the till.
 *
 * A session checkout claims its tickets before payment, so a cashier who leaves the
 * Payment screen without confirming strands a DRAFT. The admin portal recovers it through
 * the ordinary complete endpoint; these tests pin that this works for a bill another user
 * created, leaves the claimed session alone, and is audited as such.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/testApp';
import { createAdmin, createCashier, createPlayPackage } from './helpers/factories';
import { PlaySessionModel } from '../src/modules/play-sessions/playSession.model';

const API = '/api/v1';

let ticketCounter = 0;
function nextTicketCode(): string {
  ticketCounter += 1;
  return `KPA1:record-${Date.now()}-${ticketCounter}`;
}

async function strandedCheckout(cashierToken: string) {
  const pkg = await createPlayPackage({ durationMinutes: 60, price: 100000 });
  const ticketCode = nextTicketCode();

  await request(app)
    .post(`${API}/play-sessions`)
    .set('Authorization', `Bearer ${cashierToken}`)
    .send({
      ticketCode,
      childName: 'Linara',
      playPackageId: pkg.id,
      checkInAt: new Date(Date.now() - 45 * 60_000).toISOString(),
    });

  const draft = await request(app)
    .post(`${API}/bills/from-sessions`)
    .set('Authorization', `Bearer ${cashierToken}`)
    .send({ ticketCodes: [ticketCode] });
  expect(draft.status).toBe(201);
  return { draft: draft.body.data, ticketCode };
}

describe('recording payment on a stranded checkout draft', () => {
  it("lets an admin complete a cashier's draft and audits who recorded it", async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const { draft, ticketCode } = await strandedCheckout(cashierToken);

    const res = await request(app)
      .post(`${API}/bills/${draft.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', 'admin-record-1')
      .send({ paymentMethod: 'CASH', paidAmount: draft.grandTotal });

    expect(res.status).toBe(200);
    expect(res.body.data.bill).toMatchObject({
      status: 'PAID',
      grandTotal: draft.grandTotal,
      paidAmount: draft.grandTotal,
      cashierId: draft.cashierId,
    });
    expect(res.body.data.bill.billNumber).toMatch(/^KPA-/);

    // The child left long ago; recording the payment must not put the ticket back in play.
    const session = await PlaySessionModel.findOne({ ticketCode }).lean();
    expect(session?.status).toBe('CLOSED');

    const logs = await request(app)
      .get(`${API}/audit-logs?action=BILL_PAYMENT_RECORDED_BY_OTHER`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(logs.body.data).toHaveLength(1);
    expect(logs.body.data[0]).toMatchObject({
      entityId: draft.id,
      metadata: { originalCashierId: draft.cashierId, paymentMethod: 'CASH' },
    });
  });

  it('does not audit a cashier paying their own checkout', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const { draft } = await strandedCheckout(cashierToken);

    const res = await request(app)
      .post(`${API}/bills/${draft.id}/complete`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ paymentMethod: 'CASH' });
    expect(res.status).toBe(200);

    const logs = await request(app)
      .get(`${API}/audit-logs?action=BILL_PAYMENT_RECORDED_BY_OTHER&entityId=${draft.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(
      logs.body.data.filter((entry: { entityId: string }) => entry.entityId === draft.id),
    ).toHaveLength(0);
  });

  it('still refuses an amount below the total', async () => {
    const { accessToken: cashierToken } = await createCashier();
    const { accessToken: adminToken } = await createAdmin();
    const { draft } = await strandedCheckout(cashierToken);

    const res = await request(app)
      .post(`${API}/bills/${draft.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentMethod: 'CASH', paidAmount: draft.grandTotal - 1 });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
