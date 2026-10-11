import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(100),
  // Integer minor units. Zero is allowed for a giveaway that still needs counting.
  price: z.number().int().min(0),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().optional(),
});

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    price: z.number().int().min(0).optional(),
    description: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const updateProductStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
});

export const productIdParamSchema = z.object({
  id: z.string().length(24, 'Invalid product id'),
});
