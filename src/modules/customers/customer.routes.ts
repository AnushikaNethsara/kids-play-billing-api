import { Router } from 'express';
import { customerController } from './customer.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { UserRole } from '../../common/constants/roles';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuerySchema,
  customerIdParamSchema,
  searchCustomerQuerySchema,
  childrenQuerySchema,
  listCustomerVisitsQuerySchema,
  lookupCustomerQuerySchema,
} from './customer.validation';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /customers:
 *   post:
 *     summary: Create a customer record
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Customer created }
 *   get:
 *     summary: List customers with search, segment and visit filters
 *     description: >
 *       Dates are business dates (YYYY-MM-DD) in the business timezone, both ends
 *       inclusive, and either end may be given alone. A visit is one business day with a
 *       paid or refunded, non-test bill with play time on it. Segments are relative to
 *       today - new (first visit in the last 30 days), one_time (a single visit, more than
 *       30 days ago), returning (2+ visits), regular (4+ visits in the last 90 days),
 *       at_risk (returning, last seen 45-180 days ago), lost (last seen over 180 days
 *       ago), never (no visit yet). Amounts are integer minor units.
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - in: query
 *         name: segment
 *         schema: { type: string, enum: [new, one_time, returning, regular, at_risk, lost, never] }
 *       - { in: query, name: minVisits, schema: { type: integer, minimum: 0 } }
 *       - { in: query, name: maxVisits, schema: { type: integer, minimum: 0 } }
 *       - { in: query, name: minSpent, schema: { type: integer, minimum: 0 } }
 *       - { in: query, name: maxSpent, schema: { type: integer, minimum: 0 } }
 *       - { in: query, name: lastVisitFrom, schema: { type: string, format: date } }
 *       - { in: query, name: lastVisitTo, schema: { type: string, format: date } }
 *       - { in: query, name: firstVisitFrom, schema: { type: string, format: date } }
 *       - { in: query, name: firstVisitTo, schema: { type: string, format: date } }
 *       - { in: query, name: joinedFrom, schema: { type: string, format: date } }
 *       - { in: query, name: joinedTo, schema: { type: string, format: date } }
 *       - { in: query, name: visitedFrom, schema: { type: string, format: date } }
 *       - { in: query, name: visitedTo, schema: { type: string, format: date } }
 *       - { in: query, name: hasPhone, schema: { type: boolean } }
 *       - { in: query, name: hasEmail, schema: { type: boolean } }
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [createdAt, lastVisitAt, firstVisitAt, visitCount, totalSpent, parentName]
 *           default: createdAt
 *       - { in: query, name: order, schema: { type: string, enum: [asc, desc], default: desc } }
 *     responses:
 *       200: { description: Paginated list of customers }
 *       400: { description: Invalid filter, or a range that runs backwards }
 */
router.post('/', validate({ body: createCustomerSchema }), asyncHandler(customerController.create));
router.get('/', validate({ query: listCustomersQuerySchema }), asyncHandler(customerController.list));

/**
 * @openapi
 * /customers/segments:
 *   get:
 *     summary: Number of customers in each segment right now (admin-only)
 *     description: >
 *       Counts for the customer list's segment tabs, plus `all`. Ignores every other list
 *       filter. Segments overlap, so they do not add up to `all`.
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Counts: all, new, one_time, returning, regular, at_risk, lost, never" }
 */
router.get(
  '/segments',
  requireRole(UserRole.ADMIN),
  asyncHandler(customerController.segmentCounts),
);

/**
 * @openapi
 * /customers/search:
 *   get:
 *     summary: Search customers by phone number (indexed, fast lookup at point of sale)
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: phoneNumber
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Matching customers }
 */
router.get(
  '/search',
  validate({ query: searchCustomerQuerySchema }),
  asyncHandler(customerController.search),
);

/**
 * @openapi
 * /customers/lookup:
 *   get:
 *     summary: A family at the till - visits, usual children, loyalty reward due
 *     description: >
 *       Exact match on the (normalised) phone number; `data` is null for a number the
 *       business has not seen. `loyalty.rewardDue` is true when today's visit is a
 *       multiple of `BusinessSettings.loyaltyVisitInterval` - a flag only, nothing is
 *       discounted automatically.
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: phoneNumber, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The family, or null }
 */
router.get(
  '/lookup',
  validate({ query: lookupCustomerQuerySchema }),
  asyncHandler(customerController.lookup),
);

/**
 * @openapi
 * /customers/children:
 *   get:
 *     summary: Distinct children previously checked in under a phone number, most recent first
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: phoneNumber
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Children previously checked in under this phone number }
 */
router.get(
  '/children',
  validate({ query: childrenQuerySchema }),
  asyncHandler(customerController.getChildren),
);

/**
 * @openapi
 * /customers/{id}:
 *   get:
 *     summary: Get a customer by id
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Customer details }
 *   patch:
 *     summary: Update a customer
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Customer updated }
 */
router.get(
  '/:id',
  validate({ params: customerIdParamSchema }),
  asyncHandler(customerController.getById),
);
router.patch(
  '/:id',
  validate({ params: customerIdParamSchema, body: updateCustomerSchema }),
  asyncHandler(customerController.update),
);

/**
 * @openapi
 * /customers/{id}/profile:
 *   get:
 *     summary: A family's children, visit frequency and visit calendar (admin-only)
 *     description: >
 *       A visit is one business day with a paid or refunded, non-test bill that has play
 *       time on it. `children` merges every ticket and fixed-price bill, one row per
 *       child; `heatmap` lists the visit days of the last 365 days with the children who
 *       came on each.
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The profile }
 *       404: { description: Customer not found }
 */
router.get(
  '/:id/profile',
  requireRole(UserRole.ADMIN),
  validate({ params: customerIdParamSchema }),
  asyncHandler(customerController.getProfile),
);

/**
 * @openapi
 * /customers/{id}/visits:
 *   get:
 *     summary: A family's visits, newest first, one row per visit day (admin-only)
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: Visit rows, with pagination in `meta` }
 */
router.get(
  '/:id/visits',
  requireRole(UserRole.ADMIN),
  validate({ params: customerIdParamSchema, query: listCustomerVisitsQuerySchema }),
  asyncHandler(customerController.listVisits),
);

export const customerRoutes = router;
