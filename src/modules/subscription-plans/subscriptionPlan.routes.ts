import { Router } from 'express';
import { subscriptionPlanController } from './subscriptionPlan.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import {
  createSubscriptionPlanSchema,
  listSubscriptionPlansQuerySchema,
  subscriptionPlanIdParamSchema,
  updateSubscriptionPlanSchema,
  updateSubscriptionPlanStatusSchema,
} from './subscriptionPlan.validation';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /subscription-plans:
 *   post:
 *     summary: Create a subscription plan (admin-only)
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price, visitCredits, visitMinutes, extraBlockPrice]
 *             properties:
 *               name: { type: string, example: "Monthly 8 visits" }
 *               price: { type: integer, example: 300000, description: Integer minor units (LKR cents). }
 *               visitCredits: { type: integer, example: 8, description: One credit is one child for one visit block. }
 *               visitMinutes: { type: integer, example: 120, description: How long one credit lets a child play. }
 *               graceMinutes: { type: integer, example: 10, description: Overrun forgiven after each block. Must be shorter than visitMinutes. }
 *               extraBlockPrice: { type: integer, example: 80000, description: Cash per child per block once credits run out. Minor units. }
 *               maxChildren: { type: integer, nullable: true, example: 3, description: Children that may be named on one subscription. Null means the ticket maximum (10). }
 *               description: { type: string }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Subscription plan created }
 *   get:
 *     summary: List subscription plans (cashiers see active plans only)
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: isActive
 *         schema: { type: string, enum: ["true", "false"] }
 *     responses:
 *       200: { description: List of subscription plans }
 */
router.post(
  '/',
  requireRole(UserRole.ADMIN),
  validate({ body: createSubscriptionPlanSchema }),
  asyncHandler(subscriptionPlanController.create),
);
router.get(
  '/',
  validate({ query: listSubscriptionPlansQuerySchema }),
  asyncHandler(subscriptionPlanController.list),
);

/**
 * @openapi
 * /subscription-plans/{id}:
 *   get:
 *     summary: Get a subscription plan
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Subscription plan }
 *   patch:
 *     summary: Update a subscription plan (admin-only). Affects only subscriptions sold afterwards.
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Subscription plan updated }
 */
router.get(
  '/:id',
  validate({ params: subscriptionPlanIdParamSchema }),
  asyncHandler(subscriptionPlanController.getById),
);
router.patch(
  '/:id',
  requireRole(UserRole.ADMIN),
  validate({ params: subscriptionPlanIdParamSchema, body: updateSubscriptionPlanSchema }),
  asyncHandler(subscriptionPlanController.update),
);

/**
 * @openapi
 * /subscription-plans/{id}/status:
 *   patch:
 *     summary: Activate or deactivate a subscription plan (admin-only)
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Subscription plan status updated }
 */
router.patch(
  '/:id/status',
  requireRole(UserRole.ADMIN),
  validate({ params: subscriptionPlanIdParamSchema, body: updateSubscriptionPlanStatusSchema }),
  asyncHandler(subscriptionPlanController.updateStatus),
);

export const subscriptionPlanRoutes = router;
