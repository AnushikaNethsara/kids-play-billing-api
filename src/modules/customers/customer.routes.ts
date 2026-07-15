import { Router } from 'express';
import { customerController } from './customer.controller';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuerySchema,
  customerIdParamSchema,
  searchCustomerQuerySchema,
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

export const customerRoutes = router;
