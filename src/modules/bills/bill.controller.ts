import type { Request, Response } from 'express';
import { billService } from './bill.service';
import { receiptService } from './receipt.service';
import { settingsService } from '../settings/settings.service';
import { idempotencyService } from './idempotency.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError, AuthorizationError, NotFoundError } from '../../common/errors';
import { UserRole } from '../../common/constants/roles';
import type {
  CreateBillInput,
  CreateBillFromSessionsInput,
  UpdateBillInput,
  CompleteBillInput,
  CancelBillInput,
  RefundBillInput,
  ListBillsQuery,
} from './bill.types';

const IDEMPOTENCY_HEADER = 'idempotency-key';

function requireActor(req: Request) {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

async function assertCanView(req: Request, billId: string) {
  const actor = requireActor(req);
  const bill = await billService.getById(billId);
  if (actor.role === UserRole.CASHIER && bill.cashierId.toString() !== actor.id) {
    throw new AuthorizationError('Cashiers may only view their own bills');
  }
  return bill;
}

export const billController = {
  async create(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const bill = await billService.createDraft(req.body as CreateBillInput, actor);
    sendSuccess(res, bill, { statusCode: 201, message: 'Draft bill created successfully' });
  },

  async createFromSessions(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const bill = await billService.createDraftFromSessions(
      req.body as CreateBillFromSessionsInput,
      actor,
    );
    sendSuccess(res, bill, { statusCode: 201, message: 'Draft bill created from tickets' });
  },

  async list(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const query = req.query as unknown as ListBillsQuery;

    // Cashiers only ever see their own bills - any cashierId filter they send is
    // overridden, mirroring the rule that the cashier identity always comes from the
    // authenticated session, never from client-supplied input.
    if (actor.role === UserRole.CASHIER) {
      query.cashierId = actor.id;
    }

    const { bills, meta } = await billService.list(query);
    sendSuccess(res, bills, { meta });
  },

  async getById(req: Request, res: Response): Promise<void> {
    const bill = await assertCanView(req, req.params.id);
    sendSuccess(res, await billService.getPublicById(bill.id));
  },

  async getByBillNumber(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const bill = await billService.getByBillNumber(req.params.billNumber);
    if (actor.role === UserRole.CASHIER && bill.cashierId !== actor.id) {
      throw new AuthorizationError('Cashiers may only view their own bills');
    }
    sendSuccess(res, bill);
  },

  async update(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const bill = await billService.updateDraft(req.params.id, req.body as UpdateBillInput, actor);
    sendSuccess(res, bill, { message: 'Bill updated successfully' });
  },

  async complete(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const billId = req.params.id;
    const idempotencyKeyHeader = req.header(IDEMPOTENCY_HEADER);
    const scopedKey = idempotencyKeyHeader ? `complete-bill:${billId}:${idempotencyKeyHeader}` : undefined;

    const runCompletion = async () => {
      const bill = await billService.completeBill(billId, req.body as CompleteBillInput, actor);
      const [rawBill, settings] = await Promise.all([
        billService.getById(bill.id),
        settingsService.getRaw(),
      ]);
      const receipt = receiptService.buildReceiptData(rawBill, settings);
      return { statusCode: 200, body: { bill, receipt } };
    };

    if (!scopedKey) {
      const result = await runCompletion();
      sendSuccess(res, result.body, { message: 'Bill completed successfully' });
      return;
    }

    const { statusCode, body, replayed } = await idempotencyService.run(scopedKey, runCompletion);
    sendSuccess(res, body, {
      statusCode,
      message: replayed ? 'Bill was already completed (idempotent replay)' : 'Bill completed successfully',
    });
  },

  async cancel(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const bill = await billService.cancelBill(req.params.id, req.body as CancelBillInput, actor);
    sendSuccess(res, bill, { message: 'Bill cancelled successfully' });
  },

  async refund(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const bill = await billService.refundBill(req.params.id, req.body as RefundBillInput, actor);
    sendSuccess(res, bill, { message: 'Bill refunded successfully' });
  },

  async receipt(req: Request, res: Response): Promise<void> {
    await assertCanView(req, req.params.id);
    const [bill, settings] = await Promise.all([
      billService.getById(req.params.id),
      settingsService.getRaw(),
    ]);
    if (!bill.paidAt) throw new NotFoundError('This bill has not been paid yet, no receipt is available');
    const receiptData = receiptService.buildReceiptData(bill, settings);
    sendSuccess(res, receiptData);
  },

  async plainTextReceipt(req: Request, res: Response): Promise<void> {
    await assertCanView(req, req.params.id);
    const [bill, settings] = await Promise.all([
      billService.getById(req.params.id),
      settingsService.getRaw(),
    ]);
    if (!bill.paidAt) throw new NotFoundError('This bill has not been paid yet, no receipt is available');
    const receiptData = receiptService.buildReceiptData(bill, settings);
    const text = receiptService.buildPlainTextReceipt(receiptData);
    res.type('text/plain').send(text);
  },

  async printData(req: Request, res: Response): Promise<void> {
    await assertCanView(req, req.params.id);
    const [bill, settings] = await Promise.all([
      billService.getById(req.params.id),
      settingsService.getRaw(),
    ]);
    const receiptData = receiptService.buildReceiptData(bill, settings);
    sendSuccess(res, receiptData);
  },

};
