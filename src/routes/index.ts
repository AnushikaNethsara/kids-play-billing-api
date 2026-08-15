import { Router } from 'express';
import { authRoutes } from '../modules/auth/auth.routes';
import { userRoutes } from '../modules/users/user.routes';
import { playPackageRoutes } from '../modules/play-packages/playPackage.routes';
import { playSessionRoutes } from '../modules/play-sessions/playSession.routes';
import { customerRoutes } from '../modules/customers/customer.routes';
import { billRoutes } from '../modules/bills/bill.routes';
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes';
import { settingsRoutes } from '../modules/settings/settings.routes';
import { auditLogRoutes } from '../modules/audit-logs/auditLog.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/play-packages', playPackageRoutes);
router.use('/play-sessions', playSessionRoutes);
router.use('/customers', customerRoutes);
router.use('/bills', billRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/settings', settingsRoutes);
router.use('/audit-logs', auditLogRoutes);

export const apiRouter = router;
