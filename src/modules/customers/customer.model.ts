import { Schema, model, type HydratedDocument } from 'mongoose';

export interface CustomerDocument {
  parentName: string;
  phoneNumber: string;
  email: string;
  notes: string;
  visitCount: number;
  totalSpent: number;
  lastVisitAt: Date | null;
  firstVisitAt: Date | null;
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
    firstVisitAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Cashiers search returning customers by phone number at the point of sale.
// One customer per family. Partial, because a customer created by hand may have no
// number yet, and any number of those is fine. Phones are normalised before they get
// here (`common/utils/phone.ts`), so spelling cannot split a family across two records.
customerSchema.index(
  { phoneNumber: 1 },
  { unique: true, partialFilterExpression: { phoneNumber: { $gt: '' } } },
);

// The admin's customer list filters and sorts on the derived visit figures.
customerSchema.index({ lastVisitAt: -1 });
customerSchema.index({ firstVisitAt: -1 });
customerSchema.index({ visitCount: -1 });
customerSchema.index({ totalSpent: -1 });

export const CustomerModel = model<CustomerDocument>('Customer', customerSchema);
