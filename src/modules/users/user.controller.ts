import type { Request, Response } from 'express';
import { userService } from './user.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import type { CreateUserInput, UpdateUserInput, ListUsersQuery } from './user.types';
import { AuthenticationError } from '../../common/errors';

function requireActor(req: Request) {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

export const userController = {
  async create(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const user = await userService.createUser(req.body as CreateUserInput, actor);
    sendSuccess(res, user, { statusCode: 201, message: 'User created successfully' });
  },

  async list(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as ListUsersQuery;
    const { users, meta } = await userService.listUsers(query);
    sendSuccess(res, users, { meta });
  },

  async getById(req: Request, res: Response): Promise<void> {
    const user = await userService.getUserById(req.params.id);
    sendSuccess(res, user);
  },

  async update(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const user = await userService.updateUser(req.params.id, req.body as UpdateUserInput, actor);
    sendSuccess(res, user, { message: 'User updated successfully' });
  },

  async updateStatus(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const { isActive } = req.body as { isActive: boolean };
    const user = await userService.setUserStatus(req.params.id, isActive, actor);
    sendSuccess(res, user, { message: `User ${isActive ? 'activated' : 'deactivated'} successfully` });
  },

  async resetPassword(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const { newPassword } = req.body as { newPassword: string };
    await userService.resetPassword(req.params.id, newPassword, actor);
    sendSuccess(res, null, { message: 'Password reset successfully' });
  },
};
