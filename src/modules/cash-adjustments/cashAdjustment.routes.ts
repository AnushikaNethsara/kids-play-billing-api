import { Router } from 'express';
import { cashAdjustmentController } from './cashAdjustment.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import {
  cashAdjustmentIdParamSchema,
  createCashAdjustmentSchema,
  listCashAdjustmentsQuerySchema,
  updateCashAdjustmentSchema,
  voidCashAdjustmentSchema,
} from './cashAdjustment.validation';

// Cash reconciliation is admin-only end to end.
const router = Router();
router.use(authenticate, requireRole(UserRole.ADMIN));

/**
 * @openapi
 * /cash-adjustments:
 *   post:
 *     summary: Record a cash surplus (+) or shortage (-) found at reconciliation (admin-only)
 *     tags: [Cash adjustments]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [businessDate, amount, reason]
 *             properties:
 *               businessDate: { type: string, example: "2026-11-07", description: Business day the count belongs to }
 *               amount: { type: integer, example: -1000, description: "Signed integer minor units. Positive is a surplus, negative a shortage, never 0." }
 *               reason: { type: string }
 *               notes: { type: string }
 *               countedCash: { type: integer, nullable: true, description: Cash counted in the drawer, minor units }
 *               expectedCash: { type: integer, nullable: true, description: Cash the daily close expected at the time, minor units }
 *     responses:
 *       201: { description: Cash adjustment recorded }
 *   get:
 *     summary: List cash adjustments, newest day first, with surplus, shortage and net in meta.totals (admin-only)
 *     tags: [Cash adjustments]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: period, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, VOIDED, ALL], default: ACTIVE } }
 *       - { in: query, name: kind, schema: { type: string, enum: [SURPLUS, SHORTAGE] } }
 *     responses:
 *       200: { description: List of cash adjustments }
 */
router.post('/', validate({ body: createCashAdjustmentSchema }), asyncHandler(cashAdjustmentController.create));
router.get('/', validate({ query: listCashAdjustmentsQuerySchema }), asyncHandler(cashAdjustmentController.list));

/**
 * @openapi
 * /cash-adjustments/{id}:
 *   get:
 *     summary: Get a cash adjustment (admin-only)
 *     tags: [Cash adjustments]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Cash adjustment details }
 *   patch:
 *     summary: Edit an active cash adjustment (admin-only). Audited with before and after.
 *     tags: [Cash adjustments]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Cash adjustment updated }
 */
router.get(
  '/:id',
  validate({ params: cashAdjustmentIdParamSchema }),
  asyncHandler(cashAdjustmentController.getById),
);
router.patch(
  '/:id',
  validate({ params: cashAdjustmentIdParamSchema, body: updateCashAdjustmentSchema }),
  asyncHandler(cashAdjustmentController.update),
);

/**
 * @openapi
 * /cash-adjustments/{id}/void:
 *   post:
 *     summary: Void a cash adjustment with a reason (admin-only). Never deleted.
 *     tags: [Cash adjustments]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Cash adjustment voided }
 */
router.post(
  '/:id/void',
  validate({ params: cashAdjustmentIdParamSchema, body: voidCashAdjustmentSchema }),
  asyncHandler(cashAdjustmentController.void),
);

export const cashAdjustmentRoutes = router;
