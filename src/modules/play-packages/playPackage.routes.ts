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
 *             required: [name, durationMinutes, price]
 *             properties:
 *               name: { type: string, example: "1 Hour" }
 *               durationMinutes: { type: integer, example: 60 }
 *               price: { type: integer, example: 80000, description: "Integer minor units (LKR cents)" }
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
