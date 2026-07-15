import { Router } from 'express';
import { settingsController } from './settings.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import { updateSettingsSchema } from './settings.validation';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /settings:
 *   get:
 *     summary: Get business settings
 *     tags: [Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Current business settings }
 *   patch:
 *     summary: Update business settings (admin-only)
 *     tags: [Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Settings updated }
 *       403: { description: Cashiers cannot update settings }
 */
router.get('/', asyncHandler(settingsController.get));
router.patch(
  '/',
  requireRole(UserRole.ADMIN),
  validate({ body: updateSettingsSchema }),
  asyncHandler(settingsController.update),
);

export const settingsRoutes = router;
