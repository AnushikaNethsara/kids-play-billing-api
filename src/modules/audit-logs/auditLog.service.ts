import { auditLogRepository } from './auditLog.repository';
import type { RecordAuditLogInput, ListAuditLogsQuery } from './auditLog.types';
import { logger } from '../../common/logger/logger';

export const auditLogService = {
  /**
   * Audit logging must never break the primary business operation it accompanies
   * (e.g. cancelling a bill should succeed even if writing the audit trail fails), so
   * failures here are logged but swallowed.
   */
  async record(input: RecordAuditLogInput): Promise<void> {
    try {
      await auditLogRepository.create(input);
    } catch (err) {
      logger.error({ err, action: input.action, entityId: input.entityId }, 'Failed to write audit log');
    }
  },

  async list(query: ListAuditLogsQuery) {
    const { logs, total } = await auditLogRepository.list(query);
    return {
      logs: logs.map((log) => ({
        id: log.id,
        userId: log.userId,
        userName: log.userName,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        before: log.before,
        after: log.after,
        metadata: log.metadata,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
      })),
      total,
    };
  },
};
