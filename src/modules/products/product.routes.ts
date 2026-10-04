import { Router } from 'express';
import { productController } from './product.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import {
  createProductSchema,
  listProductsQuerySchema,
  productIdParamSchema,
  updateProductSchema,
  updateProductStatusSchema,
} from './product.validation';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /products:
 *   post:
 *     summary: Create a product sold over the counter, such as socks (admin-only)
 *     tags: [Products]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price]
 *             properties:
 *               name: { type: string, example: "Long socks" }
 *               price: { type: integer, example: 25000, description: Integer minor units (LKR cents) per unit }
 *               description: { type: string }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Product created }
 *   get:
 *     summary: List products (cashiers get every active product, unpaginated)
 *     tags: [Products]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *       - { in: query, name: isActive, schema: { type: string, enum: ["true", "false"] } }
 *     responses:
 *       200: { description: List of products }
 */
router.post(
  '/',
  requireRole(UserRole.ADMIN),
  validate({ body: createProductSchema }),
  asyncHandler(productController.create),
);
router.get('/', validate({ query: listProductsQuerySchema }), asyncHandler(productController.list));

/**
 * @openapi
 * /products/{id}:
 *   get:
 *     summary: Get a product by id
 *     tags: [Products]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: Product details }
 *   patch:
 *     summary: Update a product (admin-only). A price change is audited as such.
 *     tags: [Products]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Product updated }
 *   delete:
 *     summary: Delete a product, or deactivate it if it has already been sold (admin-only)
 *     tags: [Products]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Product deleted or deactivated }
 */
router.get('/:id', validate({ params: productIdParamSchema }), asyncHandler(productController.getById));
router.patch(
  '/:id',
  requireRole(UserRole.ADMIN),
  validate({ params: productIdParamSchema, body: updateProductSchema }),
  asyncHandler(productController.update),
);
router.delete(
  '/:id',
  requireRole(UserRole.ADMIN),
  validate({ params: productIdParamSchema }),
  asyncHandler(productController.remove),
);

/**
 * @openapi
 * /products/{id}/status:
 *   patch:
 *     summary: Activate or deactivate a product (admin-only)
 *     tags: [Products]
 *     security: [{ bearerAuth: [] }]
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
 *       200: { description: Product status updated }
 */
router.patch(
  '/:id/status',
  requireRole(UserRole.ADMIN),
  validate({ params: productIdParamSchema, body: updateProductStatusSchema }),
  asyncHandler(productController.updateStatus),
);

export const productRoutes = router;
