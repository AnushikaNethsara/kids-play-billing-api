import { z } from 'zod';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';

export const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  entityType: z.nativeEnum(AuditEntityType).optional(),
  entityId: z.string().optional(),
  userId: z.string().length(24).optional(),
  action: z.nativeEnum(AuditAction).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
