import { Schema, model, type HydratedDocument, Types } from 'mongoose';

/**
 * Something sold over the counter alongside play - socks today. A flat price per unit,
 * with none of a play package's time-based pricing.
 *
 * Like a package, a product's price is snapshotted onto every bill line and every session
 * extra that sells it, so editing the price here never changes what an issued bill or a
 * child already wearing the socks is charged.
 */
export interface ProductDocument {
  name: string;
  /** Integer minor units (LKR cents) per unit. */
  price: number;
  isActive: boolean;
  description: string;
  sortOrder: number;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductHydrated = HydratedDocument<ProductDocument>;

const productSchema = new Schema<ProductDocument>(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
    description: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Cashiers list only active products, sorted for display.
productSchema.index({ isActive: 1, sortOrder: 1 });

export const ProductModel = model<ProductDocument>('Product', productSchema);
