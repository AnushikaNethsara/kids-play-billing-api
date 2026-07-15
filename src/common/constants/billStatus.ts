export const BillStatus = {
  DRAFT: 'DRAFT',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;

export type BillStatus = (typeof BillStatus)[keyof typeof BillStatus];

export const DiscountType = {
  NONE: 'NONE',
  FIXED: 'FIXED',
  PERCENTAGE: 'PERCENTAGE',
} as const;

export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];
