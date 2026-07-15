import type { Request, Response } from 'express';
import { settingsService } from './settings.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError } from '../../common/errors';
import type { UpdateSettingsInput } from './settings.types';

export const settingsController = {
  async get(_req: Request, res: Response): Promise<void> {
    const settings = await settingsService.get();
    sendSuccess(res, settings);
  },

  async update(req: Request, res: Response): Promise<void> {
    if (!req.user) throw new AuthenticationError();
    const settings = await settingsService.update(req.body as UpdateSettingsInput, req.user);
    sendSuccess(res, settings, { message: 'Settings updated successfully' });
  },
};
