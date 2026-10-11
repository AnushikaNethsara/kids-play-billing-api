import type { Request, Response } from 'express';
import { productService } from './product.service';
import { sendSuccess } from '../../common/utils/apiResponse';
import { AuthenticationError } from '../../common/errors';
import { UserRole } from '../../common/constants/roles';
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from './product.types';

function requireActor(req: Request) {
  if (!req.user) throw new AuthenticationError();
  return req.user;
}

export const productController = {
  async create(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const product = await productService.create(req.body as CreateProductInput, actor);
    sendSuccess(res, product, { statusCode: 201, message: 'Product created successfully' });
  },

  async list(req: Request, res: Response): Promise<void> {
    // Cashiers only ever need what they can sell; admins can see everything.
    if (req.user?.role === UserRole.CASHIER) {
      sendSuccess(res, await productService.listActiveForCashier());
      return;
    }

    const { products, meta } = await productService.list(req.query as unknown as ListProductsQuery);
    sendSuccess(res, products, { meta });
  },

  async getById(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await productService.getById(req.params.id));
  },

  async update(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const product = await productService.update(req.params.id, req.body as UpdateProductInput, actor);
    sendSuccess(res, product, { message: 'Product updated successfully' });
  },

  async updateStatus(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const { isActive } = req.body as { isActive: boolean };
    const product = await productService.setStatus(req.params.id, isActive, actor);
    sendSuccess(res, product, { message: `Product ${isActive ? 'activated' : 'deactivated'} successfully` });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const actor = requireActor(req);
    const result = await productService.delete(req.params.id, actor);
    sendSuccess(res, result, {
      message: result.softDeleted
        ? 'Product has already been sold and was deactivated instead of deleted'
        : 'Product deleted successfully',
    });
  },
};
