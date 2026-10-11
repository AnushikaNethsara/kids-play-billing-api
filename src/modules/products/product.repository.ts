import { ProductModel, type ProductHydrated } from './product.model';
import { getSkip } from '../../common/utils/pagination';

export const productRepository = {
  async findById(id: string): Promise<ProductHydrated | null> {
    return ProductModel.findById(id).exec();
  },

  async create(data: {
    name: string;
    price: number;
    description: string;
    sortOrder: number;
    createdBy: string;
  }): Promise<ProductHydrated> {
    return ProductModel.create({ ...data, updatedBy: data.createdBy });
  },

  async list(
    filter: { isActive?: boolean },
    pagination: { page: number; limit: number },
  ): Promise<{ products: ProductHydrated[]; total: number }> {
    const mongoFilter: Record<string, unknown> = {};
    if (filter.isActive !== undefined) mongoFilter.isActive = filter.isActive;

    const [products, total] = await Promise.all([
      ProductModel.find(mongoFilter)
        .sort({ sortOrder: 1, name: 1 })
        .skip(getSkip(pagination))
        .limit(pagination.limit)
        .exec(),
      ProductModel.countDocuments(mongoFilter),
    ]);

    return { products, total };
  },

  async listAllActive(): Promise<ProductHydrated[]> {
    return ProductModel.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).exec();
  },
};
