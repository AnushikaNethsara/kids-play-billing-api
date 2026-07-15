import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import type { AuditAction, AuditEntityType } from '../../common/constants/auditActions';

export interface AuditLogDocument {
  userId: Types.ObjectId | null;
  userName: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: Date;
}

export type AuditLogHydrated = HydratedDocument<AuditLogDocument>;

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, required: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Admin audit-log browsing: most recent first, and filter by entity.
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });

export const AuditLogModel = model<AuditLogDocument>('AuditLog', auditLogSchema);
