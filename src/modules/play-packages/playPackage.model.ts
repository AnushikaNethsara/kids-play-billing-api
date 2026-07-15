import { Schema, model, type HydratedDocument, Types } from 'mongoose';

export interface PlayPackageDocument {
  name: string;
  durationMinutes: number;
  price: number;
  isActive: boolean;
  description: string;
  sortOrder: number;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PlayPackageHydrated = HydratedDocument<PlayPackageDocument>;

const playPackageSchema = new Schema<PlayPackageDocument>(
  {
    name: { type: String, required: true, trim: true },
    durationMinutes: { type: Number, required: true, min: 1 },
    // Stored as integer minor units (LKR cents), never floating point.
    price: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
    description: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Cashiers list only active packages, sorted for display.
playPackageSchema.index({ isActive: 1, sortOrder: 1 });

export const PlayPackageModel = model<PlayPackageDocument>('PlayPackage', playPackageSchema);
