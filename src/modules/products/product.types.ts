export interface ProductPublic {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
  description: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductInput {
  name: string;
  price: number;
  description?: string;
  sortOrder?: number;
}

export interface UpdateProductInput {
  name?: string;
  price?: number;
  description?: string;
  sortOrder?: number;
}

export interface ListProductsQuery {
  page: number;
  limit: number;
  isActive?: boolean;
}
