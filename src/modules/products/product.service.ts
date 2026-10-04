import { Types } from 'mongoose';
import { productRepository } from './product.repository';
import type { ProductHydrated } from './product.model';
import type {
  CreateProductInput,
  ListProductsQuery,
  ProductPublic,
  UpdateProductInput,
} from './product.types';
import { NotFoundError } from '../../common/errors';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { buildPaginationMeta } from '../../common/utils/pagination';
import type { AuthenticatedUser } from '../../common/types/express';
import { BillModel } from '../bills/bill.model';
import { PlaySessionModel } from '../play-sessions/playSession.model';

export function toPublicProduct(product: ProductHydrated): ProductPublic {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    isActive: product.isActive,
    description: product.description,
    sortOrder: product.sortOrder,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/**
 * A product a bill or a session has sold keeps its id resolvable, the same rule play
 * packages follow - the snapshot carries the name and price, but reports group by the id.
 */
async function isProductReferenced(productId: string): Promise<boolean> {
  const [bills, sessions] = await Promise.all([
    BillModel.countDocuments({ 'items.productId': productId }).exec(),
    PlaySessionModel.countDocuments({ 'extras.productId': productId }).exec(),
  ]);
  return bills + sessions > 0;
}

export const productService = {
  async create(input: CreateProductInput, actor: AuthenticatedUser): Promise<ProductPublic> {
    const product = await productRepository.create({
      name: input.name,
      price: input.price,
      description: input.description ?? '',
      sortOrder: input.sortOrder ?? 0,
      createdBy: actor.id,
    });

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.PRODUCT_CREATED,
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
      after: toPublicProduct(product),
    });

    return toPublicProduct(product);
  },

  async list(query: ListProductsQuery) {
    const { products, total } = await productRepository.list(
      { isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );
    return {
      products: products.map(toPublicProduct),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
    };
  },

  async listActiveForCashier(): Promise<ProductPublic[]> {
    const products = await productRepository.listAllActive();
    return products.map(toPublicProduct);
  },

  async getById(id: string): Promise<ProductPublic> {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError('Product not found');
    return toPublicProduct(product);
  },

  async update(id: string, input: UpdateProductInput, actor: AuthenticatedUser): Promise<ProductPublic> {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError('Product not found');

    const before = toPublicProduct(product);
    const priceChanged = input.price !== undefined && input.price !== product.price;

    if (input.name !== undefined) product.name = input.name;
    if (input.price !== undefined) product.price = input.price;
    if (input.description !== undefined) product.description = input.description;
    if (input.sortOrder !== undefined) product.sortOrder = input.sortOrder;
    product.updatedBy = new Types.ObjectId(actor.id);
    await product.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: priceChanged ? AuditAction.PRODUCT_PRICE_CHANGED : AuditAction.PRODUCT_UPDATED,
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
      before,
      after: toPublicProduct(product),
    });

    return toPublicProduct(product);
  },

  async setStatus(id: string, isActive: boolean, actor: AuthenticatedUser): Promise<ProductPublic> {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError('Product not found');

    const before = toPublicProduct(product);
    product.isActive = isActive;
    product.updatedBy = new Types.ObjectId(actor.id);
    await product.save();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.PRODUCT_STATUS_CHANGED,
      entityType: AuditEntityType.PRODUCT,
      entityId: product.id,
      before,
      after: toPublicProduct(product),
    });

    return toPublicProduct(product);
  },

  /** Deactivates instead of deleting once anything has sold the product. */
  async delete(id: string, actor: AuthenticatedUser): Promise<{ softDeleted: boolean }> {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError('Product not found');

    if (await isProductReferenced(id)) {
      if (product.isActive) {
        product.isActive = false;
        product.updatedBy = new Types.ObjectId(actor.id);
        await product.save();

        await auditLogService.record({
          userId: actor.id,
          userName: actor.name,
          action: AuditAction.PRODUCT_STATUS_CHANGED,
          entityType: AuditEntityType.PRODUCT,
          entityId: product.id,
          metadata: { reason: 'Deactivated instead of deleted - product has already been sold' },
        });
      }
      return { softDeleted: true };
    }

    await product.deleteOne();

    await auditLogService.record({
      userId: actor.id,
      userName: actor.name,
      action: AuditAction.PRODUCT_DELETED,
      entityType: AuditEntityType.PRODUCT,
      entityId: id,
      before: toPublicProduct(product),
    });

    return { softDeleted: false };
  },
};
