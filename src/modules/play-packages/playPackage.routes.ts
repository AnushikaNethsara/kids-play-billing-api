import { Router } from 'express';
import { playPackageController } from './playPackage.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import {
  createPlayPackageSchema,
  updatePlayPackageSchema,
  updatePlayPackageStatusSchema,
  listPlayPackagesQuerySchema,
  playPackageIdParamSchema,
} from './playPackage.validation';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /play-packages:
 *   post:
 *     summary: Create a play package (admin-only)
 *     tags: [Play Packages]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "1 Hour" }
 *               durationMinutes:
 *                 type: integer
 *                 example: 60
 *                 description: Required except under TIERED_HOURLY, where it is always 60.
 *               price:
 *                 type: integer
 *                 example: 80000
 *                 description: Integer minor units (LKR cents). Required except under TIERED_HOURLY, where it is the 1st hour's rate.
 *               pricingMode:
 *                 type: string
 *                 enum: [PRORATA, BLOCK_WITH_GRACE, TIERED_HOURLY]
 *                 default: PRORATA
 *                 description: TIERED_HOURLY is rejected while TIERED_PRICING_ENABLED is off.
 *               graceMinutes:
 *                 type: integer
 *                 example: 10
 *                 description: Minutes forgiven after each completed block or hour. Ignored under PRORATA.
 *               tieredPricing:
 *                 type: object
 *                 description: Required under TIERED_HOURLY.
 *                 required: [hourlyRates, overtimeMode]
 *                 properties:
 *                   hourlyRates:
 *                     type: array
 *                     minItems: 4
 *                     maxItems: 4
 *                     items: { type: integer }
 *                     example: [60000, 50000, 40000, 40000]
 *                     description: 1st, 2nd and 3rd hour rates, then the rate repeated from the 4th hour on. Minor units.
 *                   overtimeMode: { type: string, enum: [PER_MINUTE, BLOCK] }
 *                   overtimeBlockMinutes: { type: integer, minimum: 1, maximum: 60, default: 15 }
 *                   roundingStep:
 *                     type: integer
 *                     enum: [0, 100, 1000, 5000, 10000]
 *                     default: 0
 *                     description: Rounds the session total to this many minor units. 0 means no rounding.
 *                   roundingMode: { type: string, enum: [UP, DOWN, NEAREST], default: NEAREST }
 *               description: { type: string }
 *               sortOrder: { type: integer }
 *     responses:
 *       201: { description: Play package created }
 *   get:
 *     summary: List play packages (cashiers see active packages only)
 *     tags: [Play Packages]
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
 *       200: { description: List of play packages }
 */
router.post(
  '/',
  requireRole(UserRole.ADMIN),
  validate({ body: createPlayPackageSchema }),
  asyncHandler(playPackageController.create),
);
router.get('/', validate({ query: listPlayPackagesQuerySchema }), asyncHandler(playPackageController.list));

/**
 * @openapi
 * /play-packages/{id}:
 *   get:
 *     summary: Get a play package by id
 *     tags: [Play Packages]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Play package details }
 *   patch:
 *     summary: Update a play package (admin-only)
 *     tags: [Play Packages]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Play package updated }
 *   delete:
 *     summary: Delete a play package, or deactivate it if already used in bills (admin-only)
 *     tags: [Play Packages]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Play package deleted or deactivated }
 */
router.get(
  '/:id',
  validate({ params: playPackageIdParamSchema }),
  asyncHandler(playPackageController.getById),
);
router.patch(
  '/:id',
  requireRole(UserRole.ADMIN),
  validate({ params: playPackageIdParamSchema, body: updatePlayPackageSchema }),
  asyncHandler(playPackageController.update),
);
router.delete(
  '/:id',
  requireRole(UserRole.ADMIN),
  validate({ params: playPackageIdParamSchema }),
  asyncHandler(playPackageController.remove),
);

/**
 * @openapi
 * /play-packages/{id}/status:
 *   patch:
 *     summary: Activate or deactivate a play package (admin-only)
 *     tags: [Play Packages]
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
 *       200: { description: Play package status updated }
 */
router.patch(
  '/:id/status',
  requireRole(UserRole.ADMIN),
  validate({ params: playPackageIdParamSchema, body: updatePlayPackageStatusSchema }),
  asyncHandler(playPackageController.updateStatus),
);

export const playPackageRoutes = router;
