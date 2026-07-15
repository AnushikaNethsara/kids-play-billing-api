import { Router } from 'express';
import { userController } from './user.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import {
  createUserSchema,
  updateUserSchema,
  updateUserStatusSchema,
  resetPasswordSchema,
  listUsersQuerySchema,
  userIdParamSchema,
} from './user.validation';

const router = Router();

router.use(authenticate, requireRole(UserRole.ADMIN));

/**
 * @openapi
 * /users:
 *   post:
 *     summary: Create a cashier or admin account
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, role]
 *             properties:
 *               name: { type: string, example: "Cashier 02" }
 *               email: { type: string, example: "cashier02@example.com" }
 *               password: { type: string, example: "ChangeMe123!" }
 *               role: { type: string, enum: [ADMIN, CASHIER] }
 *     responses:
 *       201: { description: User created }
 *   get:
 *     summary: List users with pagination and filters
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [ADMIN, CASHIER] }
 *       - in: query
 *         name: isActive
 *         schema: { type: string, enum: ["true", "false"] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200: { description: Paginated list of users }
 */
router.post('/', validate({ body: createUserSchema }), asyncHandler(userController.create));
router.get('/', validate({ query: listUsersQuerySchema }), asyncHandler(userController.list));

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     summary: Get a user by id
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: User details }
 *       404: { description: User not found }
 *   patch:
 *     summary: Update a user's name or email
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: User updated }
 */
router.get('/:id', validate({ params: userIdParamSchema }), asyncHandler(userController.getById));
router.patch(
  '/:id',
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  asyncHandler(userController.update),
);

/**
 * @openapi
 * /users/{id}/status:
 *   patch:
 *     summary: Activate or deactivate a user
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *       200: { description: User status updated }
 */
router.patch(
  '/:id/status',
  validate({ params: userIdParamSchema, body: updateUserStatusSchema }),
  asyncHandler(userController.updateStatus),
);

/**
 * @openapi
 * /users/{id}/reset-password:
 *   post:
 *     summary: Reset a user's password (admin-issued)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPassword]
 *             properties:
 *               newPassword: { type: string, example: "NewPass123!" }
 *     responses:
 *       200: { description: Password reset }
 */
router.post(
  '/:id/reset-password',
  validate({ params: userIdParamSchema, body: resetPasswordSchema }),
  asyncHandler(userController.resetPassword),
);

export const userRoutes = router;
