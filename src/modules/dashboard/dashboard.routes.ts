import { Router } from 'express';
import { dashboardController } from './dashboard.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import { dashboardQuerySchema, revenueQuerySchema, recentBillsQuerySchema } from './dashboard.validation';

const router = Router();

router.use(authenticate, requireRole(UserRole.ADMIN));

/**
 * @openapi
 * /dashboard/summary:
 *   get:
 *     summary: Business KPIs for a period (admin-only)
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: period, schema: { type: string } }, { in: query, name: from, schema: { type: string } }, { in: query, name: to, schema: { type: string } }]
 *     responses:
 *       200: { description: Revenue, discounts, refunds, payment breakdown, top package/cashier }
 */
router.get('/summary', validate({ query: dashboardQuerySchema }), asyncHandler(dashboardController.summary));

/**
 * @openapi
 * /dashboard/revenue:
 *   get:
 *     summary: Chart-ready revenue time series, bucketed in the business timezone
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: groupBy
 *         schema: { type: string, enum: [day, month, year], default: day }
 *     responses:
 *       200: { description: Array of revenue points }
 */
router.get('/revenue', validate({ query: revenueQuerySchema }), asyncHandler(dashboardController.revenue));

/**
 * @openapi
 * /dashboard/bills:
 *   get:
 *     summary: Bill counts by status for a period
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Counts of DRAFT/PAID/CANCELLED/REFUNDED bills }
 */
router.get('/bills', validate({ query: dashboardQuerySchema }), asyncHandler(dashboardController.bills));

/**
 * @openapi
 * /dashboard/packages:
 *   get:
 *     summary: Package sales performance for a period
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Quantity sold and revenue per play package, sorted by revenue }
 */
router.get('/packages', validate({ query: dashboardQuerySchema }), asyncHandler(dashboardController.packages));

/**
 * @openapi
 * /dashboard/payment-methods:
 *   get:
 *     summary: Revenue and transaction count by payment method for a period
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Breakdown by CASH/CARD/BANK_TRANSFER/OTHER }
 */
router.get(
  '/payment-methods',
  validate({ query: dashboardQuerySchema }),
  asyncHandler(dashboardController.paymentMethods),
);

/**
 * @openapi
 * /dashboard/cashiers:
 *   get:
 *     summary: Cashier performance for a period
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Per-cashier bill count, revenue, discounts given, cancellations }
 */
router.get('/cashiers', validate({ query: dashboardQuerySchema }), asyncHandler(dashboardController.cashiers));

/**
 * @openapi
 * /dashboard/recent-bills:
 *   get:
 *     summary: Most recently created bills across all cashiers
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Recent bills, newest first }
 */
router.get(
  '/recent-bills',
  validate({ query: recentBillsQuerySchema }),
  asyncHandler(dashboardController.recentBills),
);

export const dashboardRoutes = router;
