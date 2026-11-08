import type { Request, Response } from 'express';
import { cashAdjustmentService } from './cashAdjustment.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError } from '../../common/errors';
import type {
  CreateCashAdjustmentInput,
  ListCashAdjustmentsQuery,
  UpdateCashAdjustmentInput,
} from './cashAdjustment.types';

function requireActor(req: Request) {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

export const cashAdjustmentController = {
  async create(req: Request, res: Response): Promise<void> {
    const adjustment = await cashAdjustmentService.create(req.body as CreateCashAdjustmentInput, requireActor(req));
    sendSuccess(res, adjustment, { statusCode: 201, message: 'Cash adjustment recorded' });
  },

  async list(req: Request, res: Response): Promise<void> {
    const { adjustments, meta } = await cashAdjustmentService.list(
      req.query as unknown as ListCashAdjustmentsQuery,
    );
    sendSuccess(res, adjustments, { meta });
  },

  async getById(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await cashAdjustmentService.getById(req.params.id));
  },

  async update(req: Request, res: Response): Promise<void> {
    const adjustment = await cashAdjustmentService.update(
      req.params.id,
      req.body as UpdateCashAdjustmentInput,
      requireActor(req),
    );
    sendSuccess(res, adjustment, { message: 'Cash adjustment updated' });
  },

  async void(req: Request, res: Response): Promise<void> {
    const { reason } = req.body as { reason: string };
    const adjustment = await cashAdjustmentService.void(req.params.id, reason, requireActor(req));
    sendSuccess(res, adjustment, { message: 'Cash adjustment voided' });
  },
};
