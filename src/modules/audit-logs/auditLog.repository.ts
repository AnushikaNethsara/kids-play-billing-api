import { AuditLogModel, type AuditLogHydrated } from './auditLog.model';
import type { RecordAuditLogInput, ListAuditLogsQuery } from './auditLog.types';
import { getSkip } from '../../common/utils/pagination';

export const auditLogRepository = {
  async create(input: RecordAuditLogInput): Promise<AuditLogHydrated> {
    return AuditLogModel.create({
      userId: input.userId,
      userName: input.userName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? null,
    });
  },

  async list(
    query: ListAuditLogsQuery,
  ): Promise<{ logs: AuditLogHydrated[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.userId) filter.userId = query.userId;
    if (query.action) filter.action = query.action;
    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.$gte = new Date(query.from);
      if (query.to) createdAt.$lte = new Date(query.to);
      filter.createdAt = createdAt;
    }

    const [logs, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(getSkip(query))
        .limit(query.limit)
        .exec(),
      AuditLogModel.countDocuments(filter),
    ]);

    return { logs, total };
  },
};
