import type { Request, Response } from 'express';
import { auditLogService } from './auditLog.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { buildPaginationMeta } from '../../common/utils/pagination';
import type { ListAuditLogsQuery } from './auditLog.types';

export const auditLogController = {
  async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ListAuditLogsQuery;
    const { logs, total } = await auditLogService.list(query);
    sendSuccess(res, logs, { meta: buildPaginationMeta(query, total) });
  },
};
