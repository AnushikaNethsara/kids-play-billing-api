import { Schema, model, type HydratedDocument } from 'mongoose';

export interface CustomerDocument {
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

export type CustomerHydrated = HydratedDocument<CustomerDocument>;

const customerSchema = new Schema<CustomerDocument>(
  {
    parentName: { type: String, default: '', trim: true },
    phoneNumber: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    notes: { type: String, default: '' },
    visitCount: { type: Number, default: 0 },
    // Integer minor units (LKR cents).
    totalSpent: { type: Number, default: 0 },
    lastVisitAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Cashiers search returning customers by phone number at the point of sale.
customerSchema.index({ phoneNumber: 1 });

export const CustomerModel = model<CustomerDocument>('Customer', customerSchema);
