import { Types } from 'mongoose';
import { subscriptionPlanRepository } from './subscriptionPlan.repository';
import type { SubscriptionPlanHydrated } from './subscriptionPlan.model';
import { assertPlanConsistent } from './subscriptionPlan.validation';
import type {
  CreateSubscriptionPlanInput,
  ListSubscriptionPlansQuery,
  SubscriptionPlanPublic,
  UpdateSubscriptionPlanInput,
} from './subscriptionPlan.types';
import { NotFoundError } from '../../common/errors';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { buildPaginationMeta } from '../../common/utils/pagination';
import type { AuthenticatedUser } from '../../common/types/express';

export function toPublicPlan(plan: SubscriptionPlanHydrated): SubscriptionPlanPublic {
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    visitCredits: plan.visitCredits,
    visitMinutes: plan.visitMinutes,
    graceMinutes: plan.graceMinutes ?? 0,
    extraBlockPrice: plan.extraBlockPrice,
    maxChildren: plan.maxChildren ?? null,
    isActive: plan.isActive,
    description: plan.description,
    sortOrder: plan.sortOrder,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export const subscriptionPlanService = {
  async create(
    input: CreateSubscriptionPlanInput,
    actor: AuthenticatedUser,
  ): Promise<SubscriptionPlanPublic> {
    const graceMinutes = input.graceMinutes ?? 0;
    assertPlanConsistent({ visitMinutes: input.visitMinutes, graceMinutes });

    const plan = await subscriptionPlanRepository.create({
      name: input.name,
      price: input.price,
      visitCredits: input.visitCredits,
      visitMinutes: input.visitMinutes,
      graceMinutes,
      extraBlockPrice: input.extraBlockPrice,
      maxChildren: input.maxChildren ?? null,
      description: input.description ?? '',
      sortOrder: input.sortOrder ?? 0,
      createdBy: new Types.ObjectId(actor.id),
    });

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.SUBSCRIPTION_PLAN_CREATED,
      entityType: AuditEntityType.SUBSCRIPTION_PLAN,
      entityId: plan.id,
      after: toPublicPlan(plan),
    });

    return toPublicPlan(plan);
  },

  async list(query: ListSubscriptionPlansQuery) {
    const { plans, total } = await subscriptionPlanRepository.list(
      { isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );
    return {
      plans: plans.map(toPublicPlan),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
    };
  },

  async listActiveForCashier(): Promise<SubscriptionPlanPublic[]> {
    const plans = await subscriptionPlanRepository.listAllActive();
    return plans.map(toPublicPlan);
  },

  async getById(id: string): Promise<SubscriptionPlanPublic> {
    const plan = await subscriptionPlanRepository.findById(id);
    if (!plan) throw new NotFoundError('Subscription plan not found');
    return toPublicPlan(plan);
  },

  /**
   * Edits affect only subscriptions sold from now on. Every term is snapshotted at sale,
   * so a price or credit change here can never alter what a family has already bought.
   */
  async update(
    id: string,
    input: UpdateSubscriptionPlanInput,
    actor: AuthenticatedUser,
  ): Promise<SubscriptionPlanPublic> {
    const plan = await subscriptionPlanRepository.findById(id);
    if (!plan) throw new NotFoundError('Subscription plan not found');

    const before = toPublicPlan(plan);

    if (input.name !== undefined) plan.name = input.name;
    if (input.price !== undefined) plan.price = input.price;
    if (input.visitCredits !== undefined) plan.visitCredits = input.visitCredits;
    if (input.visitMinutes !== undefined) plan.visitMinutes = input.visitMinutes;
    if (input.graceMinutes !== undefined) plan.graceMinutes = input.graceMinutes;
    if (input.extraBlockPrice !== undefined) plan.extraBlockPrice = input.extraBlockPrice;
    if (input.maxChildren !== undefined) plan.maxChildren = input.maxChildren;
    if (input.description !== undefined) plan.description = input.description;
    if (input.sortOrder !== undefined) plan.sortOrder = input.sortOrder;
    plan.updatedBy = new Types.ObjectId(actor.id);

    assertPlanConsistent({ visitMinutes: plan.visitMinutes, graceMinutes: plan.graceMinutes ?? 0 });

    await plan.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.SUBSCRIPTION_PLAN_UPDATED,
      entityType: AuditEntityType.SUBSCRIPTION_PLAN,
      entityId: plan.id,
      before,
      after: toPublicPlan(plan),
    });

    return toPublicPlan(plan);
  },

  /**
   * No delete: a plan is referenced by every subscription sold from it. Deactivating stops
   * new sales while leaving sold subscriptions untouched.
   */
  async setStatus(id: string, isActive: boolean, actor: AuthenticatedUser): Promise<SubscriptionPlanPublic> {
    const plan = await subscriptionPlanRepository.findById(id);
    if (!plan) throw new NotFoundError('Subscription plan not found');

    const before = toPublicPlan(plan);
    plan.isActive = isActive;
    plan.updatedBy = new Types.ObjectId(actor.id);
    await plan.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.SUBSCRIPTION_PLAN_STATUS_CHANGED,
      entityType: AuditEntityType.SUBSCRIPTION_PLAN,
      entityId: plan.id,
      before,
      after: toPublicPlan(plan),
    });

    return toPublicPlan(plan);
  },
};
