export const UserRole = {
  ADMIN: 'ADMIN',
  CASHIER: 'CASHIER',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];
