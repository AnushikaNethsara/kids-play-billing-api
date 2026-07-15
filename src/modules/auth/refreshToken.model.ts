import { Schema, model, type HydratedDocument, Types } from 'mongoose';

export interface RefreshTokenDocument {
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenHash: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

export type RefreshTokenHydrated = HydratedDocument<RefreshTokenDocument>;

const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Only a SHA-256 hash of the refresh token is ever persisted - the raw JWT is
    // never stored, so a database leak cannot be used to mint new sessions.
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByTokenHash: { type: String, default: null },
    userAgent: { type: String, default: null },
    ipAddress: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1 });
// TTL cleanup: once a refresh token's own expiry has passed there is no reason to keep it.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel = model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema);
