import type { Request, Response } from 'express';
import { subscriptionPlanService } from './subscriptionPlan.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError } from '../../common/errors';
import { UserRole } from '../../common/constants/roles';
import type {
  CreateSubscriptionPlanInput,
  ListSubscriptionPlansQuery,
  UpdateSubscriptionPlanInput,
} from './subscriptionPlan.types';

function requireActor(req: Request) {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

export const subscriptionPlanController = {
  async create(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const plan = await subscriptionPlanService.create(req.body as CreateSubscriptionPlanInput, actor);
    sendSuccess(res, plan, { statusCode: 201, message: 'Subscription plan created successfully' });
  },

  async list(req: Request, res: Response): Promise<void> {
    // Cashiers only ever sell active plans; admins manage all of them.
    if (req.user?.role === UserRole.CASHIER) {
      sendSuccess(res, await subscriptionPlanService.listActiveForCashier());
      return;
    }

    const query = req.query as unknown as ListSubscriptionPlansQuery;
    const { plans, meta } = await subscriptionPlanService.list(query);
    sendSuccess(res, plans, { meta });
  },

  async getById(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await subscriptionPlanService.getById(req.params.id));
  },

  async update(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const plan = await subscriptionPlanService.update(
      req.params.id,
      req.body as UpdateSubscriptionPlanInput,
      actor,
    );
    sendSuccess(res, plan, { message: 'Subscription plan updated successfully' });
  },

  async updateStatus(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const { isActive } = req.body as { isActive: boolean };
    const plan = await subscriptionPlanService.setStatus(req.params.id, isActive, actor);
    sendSuccess(res, plan, {
      message: `Subscription plan ${isActive ? 'activated' : 'deactivated'} successfully`,
    });
  },
};
