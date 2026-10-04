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
 *     summary: List customers with pagination and search
 *     tags: [Customers]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: Paginated list of customers }
 */
router.post('/', validate({ body: createCustomerSchema }), asyncHandler(customerController.create));
router.get('/', validate({ query: listCustomersQuerySchema }), asyncHandler(customerController.list));

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
