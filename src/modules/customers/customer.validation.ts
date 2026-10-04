import { z } from 'zod';
import { phoneNumberInputSchema } from '../../common/utils/phone';

export const createCustomerSchema = z.object({
  parentName: z.string().trim().max(100).optional(),
  phoneNumber: phoneNumberInputSchema.optional(),
  email: z.string().trim().email().toLowerCase().optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional(),
});

export const updateCustomerSchema = z
  .object({
    parentName: z.string().trim().max(100).optional(),
    phoneNumber: phoneNumberInputSchema.optional(),
    email: z.string().trim().email().toLowerCase().optional().or(z.literal('')),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

export const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).optional(),
});

export const customerIdParamSchema = z.object({
  id: z.string().length(24, 'Invalid customer id'),
});

export const searchCustomerQuerySchema = z.object({
  phoneNumber: z.string().trim().min(1, 'phoneNumber query parameter is required'),
});

export const childrenQuerySchema = z.object({
  phoneNumber: phoneNumberInputSchema.refine(Boolean, 'phoneNumber query parameter is required'),
});

export const listCustomerVisitsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
