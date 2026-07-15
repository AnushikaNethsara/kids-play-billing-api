import type { AuditAction, AuditEntityType } from '../../common/constants/auditActions';

export interface RecordAuditLogInput {
  userId: string | null;
  userName: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface ListAuditLogsQuery {
  page: number;
  limit: number;
  entityType?: AuditEntityType;
  entityId?: string;
  userId?: string;
  action?: AuditAction;
  from?: string;
  to?: string;
}
