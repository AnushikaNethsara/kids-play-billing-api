import { z } from 'zod';

export const createPlayPackageSchema = z.object({
  name: z.string().trim().min(1).max(100),
  durationMinutes: z.number().int().positive(),
  price: z.number().int().min(0),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().optional(),
});

export const updatePlayPackageSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    durationMinutes: z.number().int().positive().optional(),
    price: z.number().int().min(0).optional(),
    description: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const updatePlayPackageStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listPlayPackagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
});

export const playPackageIdParamSchema = z.object({
  id: z.string().length(24, 'Invalid play package id'),
});
