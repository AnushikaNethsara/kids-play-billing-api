export interface CustomerPublic {
  id: string;
  parentName: string;
  phoneNumber: string;
  email: string;
  notes: string;
  visitCount: number;
  totalSpent: number;
  lastVisitAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerInput {
  parentName?: string;
  phoneNumber?: string;
  email?: string;
  notes?: string;
}

export interface UpdateCustomerInput {
  parentName?: string;
  phoneNumber?: string;
  email?: string;
  notes?: string;
}

export interface ListCustomersQuery {
  page: number;
  limit: number;
  search?: string;
}
