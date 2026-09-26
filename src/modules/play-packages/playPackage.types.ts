import type { SessionPricingMode } from '../../common/constants/pricingModes';

export interface PlayPackagePublic {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  pricingMode: SessionPricingMode;
  graceMinutes: number;
  isActive: boolean;
  description: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlayPackageInput {
  name: string;
  durationMinutes: number;
  price: number;
  pricingMode?: SessionPricingMode;
  graceMinutes?: number;
  description?: string;
  sortOrder?: number;
}

export interface UpdatePlayPackageInput {
  name?: string;
  durationMinutes?: number;
  price?: number;
  pricingMode?: SessionPricingMode;
  graceMinutes?: number;
  description?: string;
  sortOrder?: number;
}

export interface ListPlayPackagesQuery {
  page: number;
  limit: number;
  isActive?: boolean;
}
