import { Router } from 'express';
import { auditLogController } from './auditLog.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { UserRole } from '../../common/constants/roles';
import { listAuditLogsQuerySchema } from './auditLog.validation';

const router = Router();

router.use(authenticate, requireRole(UserRole.ADMIN));

/**
 * @openapi
 * /audit-logs:
 *   get:
 *     summary: List audit logs
 *     tags: [Audit Logs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: entityType
 *         schema: { type: string }
 *       - in: query
 *         name: entityId
 *         schema: { type: string }
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *     responses:
 *       200: { description: Paginated list of audit logs (admin-only) }
 */
router.get('/', validate({ query: listAuditLogsQuerySchema }), asyncHandler(auditLogController.list));

export const auditLogRoutes = router;
