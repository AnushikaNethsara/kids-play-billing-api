export interface SubscriptionPlanPublic {
  id: string;
  name: string;
  price: number;
  visitCredits: number;
  visitMinutes: number;
  graceMinutes: number;
  extraBlockPrice: number;
  maxChildren: number | null;
  isActive: boolean;
  description: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubscriptionPlanInput {
  name: string;
  price: number;
  visitCredits: number;
  visitMinutes: number;
  graceMinutes?: number;
  extraBlockPrice: number;
  maxChildren?: number | null;
  description?: string;
  sortOrder?: number;
}

export type UpdateSubscriptionPlanInput = Partial<CreateSubscriptionPlanInput>;

export interface ListSubscriptionPlansQuery {
  page: number;
  limit: number;
  isActive?: boolean;
}
