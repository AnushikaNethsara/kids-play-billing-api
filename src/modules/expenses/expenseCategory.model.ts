import { Schema, model, type HydratedDocument, Types } from 'mongoose';

/**
 * What an expense was for - Rent, Salaries, Utilities. Admin-managed. Every expense keeps
 * a snapshot of its category's name, so renaming a category never rewrites how an old
 * expense reads in a report; reports still group by `categoryId`.
 */
export interface ExpenseCategoryDocument {
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ExpenseCategoryHydrated = HydratedDocument<ExpenseCategoryDocument>;

const expenseCategorySchema = new Schema<ExpenseCategoryDocument>(
  {
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Names are unique ignoring case, so "Rent" and "rent" cannot both exist.
expenseCategorySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
expenseCategorySchema.index({ isActive: 1, sortOrder: 1 });

export const ExpenseCategoryModel = model<ExpenseCategoryDocument>('ExpenseCategory', expenseCategorySchema);
