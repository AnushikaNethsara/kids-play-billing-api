import type { Request, Response } from 'express';
import { playPackageService } from './playPackage.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError } from '../../common/errors';
import { UserRole } from '../../common/constants/roles';
import type {
  CreatePlayPackageInput,
  UpdatePlayPackageInput,
  ListPlayPackagesQuery,
} from './playPackage.types';

function requireActor(req: Request) {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

export const playPackageController = {
  async create(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const pkg = await playPackageService.create(req.body as CreatePlayPackageInput, actor);
    sendSuccess(res, pkg, { statusCode: 201, message: 'Play package created successfully' });
  },

  async list(req: Request, res: Response): Promise<void> {
    // Cashiers only ever need active packages for billing; admins can see all.
    if (req.user?.role === UserRole.CASHIER) {
      const packages = await playPackageService.listActiveForCashier();
      sendSuccess(res, packages);
      return;
    }

    const query = req.query as unknown as ListPlayPackagesQuery;
    const { packages, meta } = await playPackageService.list(query);
    sendSuccess(res, packages, { meta });
  },

  async getById(req: Request, res: Response): Promise<void> {
    const pkg = await playPackageService.getById(req.params.id);
    sendSuccess(res, pkg);
  },

  async update(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const pkg = await playPackageService.update(req.params.id, req.body as UpdatePlayPackageInput, actor);
    sendSuccess(res, pkg, { message: 'Play package updated successfully' });
  },

  async updateStatus(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const { isActive } = req.body as { isActive: boolean };
    const pkg = await playPackageService.setStatus(req.params.id, isActive, actor);
    sendSuccess(res, pkg, { message: `Play package ${isActive ? 'activated' : 'deactivated'} successfully` });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const result = await playPackageService.delete(req.params.id, actor);
    sendSuccess(res, result, {
      message: result.softDeleted
        ? 'Play package is used in existing bills and was deactivated instead of deleted'
        : 'Play package deleted successfully',
    });
  },
};
