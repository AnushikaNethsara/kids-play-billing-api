import { Router } from 'express';
import { subscriptionController } from './subscription.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import {
  adjustSubscriptionCreditsSchema,
  extendSubscriptionSchema,
  listSubscriptionsQuerySchema,
  subscriptionCodeParamSchema,
  subscriptionIdParamSchema,
  subscriptionSummaryQuerySchema,
  updateSubscriptionChildrenSchema,
} from './subscription.validation';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /subscriptions:
 *   get:
 *     summary: List subscriptions
 *     description: Subscriptions are sold through POST /bills with a SUBSCRIPTION line and created when that bill is paid.
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: phoneNumber, schema: { type: string } }
 *       - { in: query, name: customerId, schema: { type: string } }
 *       - { in: query, name: code, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, EXHAUSTED, EXPIRED, CANCELLED] } }
 *       - { in: query, name: expiringWithinDays, schema: { type: integer } }
 *     responses:
 *       200: { description: List of subscriptions }
 */
router.get('/', validate({ query: listSubscriptionsQuerySchema }), asyncHandler(subscriptionController.list));

/**
 * @openapi
 * /subscriptions/summary:
 *   get:
 *     summary: Subscriptions report (admin-only) - sales, redemptions and expiries in a period, plus outstanding credits now
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: period, schema: { type: string, enum: [today, yesterday, this_week, last_week, this_month, last_month, this_year], default: this_month } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Subscription summary }
 */
router.get(
  '/summary',
  requireRole(UserRole.ADMIN),
  validate({ query: subscriptionSummaryQuerySchema }),
  asyncHandler(subscriptionController.summary),
);

/**
 * @openapi
 * /subscriptions/active-cache:
 *   get:
 *     summary: Every subscription that can be checked in with right now, for the cashier app's offline cache
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Usable subscriptions with phone, children and remaining credits }
 */
router.get('/active-cache', asyncHandler(subscriptionController.activeCache));

/**
 * @openapi
 * /subscriptions/by-code/{code}:
 *   get:
 *     summary: Resolve a scanned or typed subscription card code
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: code, required: true, schema: { type: string, example: KPS-7GQ2M9XA } }
 *     responses:
 *       200: { description: Subscription }
 *       404: { description: No subscription for this code }
 */
router.get(
  '/by-code/:code',
  validate({ params: subscriptionCodeParamSchema }),
  asyncHandler(subscriptionController.getByCode),
);

/**
 * @openapi
 * /subscriptions/{id}:
 *   get:
 *     summary: A subscription with its credit ledger
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Subscription and ledger, newest entry first }
 */
router.get('/:id', validate({ params: subscriptionIdParamSchema }), asyncHandler(subscriptionController.getById));

/**
 * @openapi
 * /subscriptions/{id}/children:
 *   patch:
 *     summary: Replace the children named on a subscription (audited)
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [children]
 *             properties:
 *               children: { type: array, items: { type: string }, example: ["Amal", "Sara"] }
 *     responses:
 *       200: { description: Children updated }
 */
router.patch(
  '/:id/children',
  validate({ params: subscriptionIdParamSchema, body: updateSubscriptionChildrenSchema }),
  asyncHandler(subscriptionController.updateChildren),
);

/**
 * @openapi
 * /subscriptions/{id}/adjust:
 *   post:
 *     summary: Add or remove credits by hand (admin-only, audited)
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [delta, reason]
 *             properties:
 *               delta: { type: integer, example: 2, description: Positive grants credits, negative removes unused ones. }
 *               reason: { type: string }
 *     responses:
 *       200: { description: Credits adjusted }
 *       409: { description: Would remove credits already used }
 */
router.post(
  '/:id/adjust',
  requireRole(UserRole.ADMIN),
  validate({ params: subscriptionIdParamSchema, body: adjustSubscriptionCreditsSchema }),
  asyncHandler(subscriptionController.adjustCredits),
);

/**
 * @openapi
 * /subscriptions/{id}/extend:
 *   post:
 *     summary: Change a subscription's expiry (admin-only, audited)
 *     tags: [Subscriptions]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [expiresAt, reason]
 *             properties:
 *               expiresAt: { type: string, format: date-time }
 *               reason: { type: string }
 *     responses:
 *       200: { description: Expiry updated }
 */
router.post(
  '/:id/extend',
  requireRole(UserRole.ADMIN),
  validate({ params: subscriptionIdParamSchema, body: extendSubscriptionSchema }),
  asyncHandler(subscriptionController.extend),
);

export const subscriptionRoutes = router;
