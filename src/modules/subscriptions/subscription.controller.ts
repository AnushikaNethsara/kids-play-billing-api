import type { Request, Response } from 'express';
import { subscriptionService } from './subscription.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError } from '../../common/errors';
import type {
  AdjustSubscriptionCreditsInput,
  ExtendSubscriptionInput,
  ListSubscriptionsQuery,
  SubscriptionSummaryQuery,
  UpdateSubscriptionChildrenInput,
} from './subscription.types';

function requireActor(req: Request) {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

export const subscriptionController = {
  async list(req: Request, res: Response): Promise<void> {
    const { subscriptions, meta } = await subscriptionService.list(
      req.query as unknown as ListSubscriptionsQuery,
    );
    sendSuccess(res, subscriptions, { meta });
  },

  async summary(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await subscriptionService.summary(req.query as SubscriptionSummaryQuery));
  },

  async activeCache(_req: Request, res: Response): Promise<void> {
    sendSuccess(res, await subscriptionService.listUsableForCache());
  },

  async getById(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await subscriptionService.getDetail(req.params.id));
  },

  async getByCode(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await subscriptionService.getByCode(req.params.code));
  },

  async updateChildren(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const subscription = await subscriptionService.updateChildren(
      req.params.id,
      req.body as UpdateSubscriptionChildrenInput,
      actor,
    );
    sendSuccess(res, subscription, { message: 'Children updated successfully' });
  },

  async adjustCredits(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const subscription = await subscriptionService.adjustCredits(
      req.params.id,
      req.body as AdjustSubscriptionCreditsInput,
      actor,
    );
    sendSuccess(res, subscription, { message: 'Credits adjusted successfully' });
  },

  async extend(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const subscription = await subscriptionService.extend(
      req.params.id,
      req.body as ExtendSubscriptionInput,
      actor,
    );
    sendSuccess(res, subscription, { message: 'Subscription expiry updated successfully' });
  },
};
