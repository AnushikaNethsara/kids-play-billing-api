import { Router } from 'express';
import { reportsController } from './reports.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import {
  billRegisterQuerySchema,
  dailyCloseQuerySchema,
  exceptionsQuerySchema,
  periodSummaryQuerySchema,
  sessionReportQuerySchema,
} from './reports.validation';

const router = Router();

router.use(authenticate, requireRole(UserRole.ADMIN));

/**
 * @openapi
 * /reports/daily-close:
 *   get:
 *     summary: Daily close (Z-report) for one business day (admin-only)
 *     description: >
 *       Recalculated live, with the same figures as the dashboard for that day. Bills paid
 *       that day but cancelled or refunded after it ended are listed under `adjustments`.
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: date, required: true, schema: { type: string, example: '2026-10-04' } }
 *     responses:
 *       200: { description: Totals, payment methods, cashiers, open items and adjustments }
 */
router.get('/daily-close', validate({ query: dailyCloseQuerySchema }), asyncHandler(reportsController.dailyClose));

/**
 * @openapi
 * /reports/bill-register:
 *   get:
 *     summary: Every bill paid in a period, one row per bill or per line
 *     description: >
 *       Bills with `paidAt` in range - PAID, REFUNDED, and CANCELLED after payment. Drafts
 *       are excluded. `format=csv` streams a UTF-8 CSV and writes a REPORT_EXPORTED audit
 *       entry. Phone numbers are masked unless `includeContact=true`.
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *       - { in: query, name: period, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [PAID, REFUNDED, CANCELLED] } }
 *       - { in: query, name: paymentMethod, schema: { type: string } }
 *       - { in: query, name: cashierId, schema: { type: string } }
 *       - { in: query, name: level, schema: { type: string, enum: [bill, line] } }
 *       - { in: query, name: format, schema: { type: string, enum: [json, csv] } }
 *       - { in: query, name: includeContact, schema: { type: boolean } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200 } }
 *     responses:
 *       200: { description: Rows, with pagination and totals in `meta` }
 */
router.get(
  '/bill-register',
  validate({ query: billRegisterQuerySchema }),
  asyncHandler(reportsController.billRegister),
);

/**
 * @openapi
 * /reports/exceptions:
 *   get:
 *     summary: Discounts, refunds, cancellations, test flags, voids, force-closes and late payments
 *     description: Each row is dated by when its action happened. Capped at 5000 rows (`truncated`).
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *       - { in: query, name: type, schema: { type: string } }
 *       - { in: query, name: format, schema: { type: string, enum: [json, csv] } }
 *     responses:
 *       200: { description: Rows, counts by type and by actor }
 */
router.get('/exceptions', validate({ query: exceptionsQuerySchema }), asyncHandler(reportsController.exceptions));

/**
 * @openapi
 * /reports/sessions:
 *   get:
 *     summary: Play sessions checked in during a period
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, CLOSED, VOIDED] } }
 *       - { in: query, name: format, schema: { type: string, enum: [json, csv] } }
 *       - { in: query, name: includeContact, schema: { type: boolean } }
 *     responses:
 *       200: { description: Session rows with pagination in `meta` }
 */
router.get('/sessions', validate({ query: sessionReportQuerySchema }), asyncHandler(reportsController.sessions));

/**
 * @openapi
 * /reports/period-summary:
 *   get:
 *     summary: Weekly, monthly or any-range summary, bucketed by day, week or month
 *     description: >
 *       Totals equal the dashboard summary for the same range. Buckets include empty days;
 *       weeks are ISO weeks (Monday start). `format=csv` exports one flat table, chosen by
 *       `breakdown`: the per-period rows plus a TOTAL row (default), or the cashier,
 *       package, product or payment-method table for the whole range.
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: period, schema: { type: string, enum: [today, yesterday, this_week, last_week, this_month, last_month, this_year] } }
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *       - { in: query, name: groupBy, schema: { type: string, enum: [day, week, month] } }
 *       - { in: query, name: format, schema: { type: string, enum: [json, csv] } }
 *       - { in: query, name: breakdown, schema: { type: string, enum: [period, cashier, package, product, paymentMethod] } }
 *     responses:
 *       200: { description: Totals, buckets and breakdown tables }
 */
router.get(
  '/period-summary',
  validate({ query: periodSummaryQuerySchema }),
  asyncHandler(reportsController.periodSummary),
);

export const reportRoutes = router;
