import { Schema, model, type HydratedDocument } from 'mongoose';
import { UserRole } from '../../common/constants/roles';

export interface UserDocument {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserHydrated = HydratedDocument<UserDocument>;

const userSchema = new Schema<UserDocument>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(UserRole), required: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Unique index on email: every login and account-creation check is by email.
userSchema.index({ email: 1 }, { unique: true });
// Supports admin user-list filtering by role and active status.
userSchema.index({ role: 1, isActive: 1 });

export const UserModel = model<UserDocument>('User', userSchema);
