import type { Request, Response } from 'express';
import { authService } from './auth.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError } from '../../common/errors';
import type { LoginInput } from './auth.types';

function requestContext(req: Request) {
  return {
    userAgent: req.header('user-agent') ?? null,
    ipAddress: req.ip ?? null,
  };
}

export const authController = {
  async login(req: Request, res: Response): Promise<void> {
    const { user, tokens } = await authService.login(req.body as LoginInput, requestContext(req));
    sendSuccess(res, { user, ...tokens }, { message: 'Login successful' });
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body as { refreshToken: string };
    const tokens = await authService.refresh(refreshToken, requestContext(req));
    sendSuccess(res, tokens, { message: 'Token refreshed' });
  },

  async logout(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body as { refreshToken: string };
    await authService.logout(refreshToken);
    sendSuccess(res, null, { message: 'Logged out successfully' });
  },

  async me(req: Request, res: Response): Promise<void> {
    if (!req.user) throw new AuthenticationError();
    const user = await authService.me(req.user.id);
    sendSuccess(res, user);
  },
};
