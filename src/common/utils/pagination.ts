export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationMeta {
  [key: string]: unknown;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export function getSkip({ page, limit }: PaginationParams): number {
  return (page - 1) * limit;
}

export function buildPaginationMeta(params: PaginationParams, total: number): PaginationMeta {
  const totalPages = Math.max(Math.ceil(total / params.limit), 1);
  return {
    page: params.page,
    limit: params.limit,
    total,
    totalPages,
    hasNextPage: params.page < totalPages,
    hasPrevPage: params.page > 1,
  };
}
