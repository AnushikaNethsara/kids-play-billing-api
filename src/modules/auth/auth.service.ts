import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'crypto';
import { env } from '../../config/env';
import { userRepository } from '../users/user.repository';
import { toPublicUser } from '../users/user.service';
import { RefreshTokenModel } from './refreshToken.model';
import type { AccessTokenPayload, RefreshTokenPayload, LoginInput, TokenPair } from './auth.types';
import { AuthenticationError } from '../../common/errors';
import type { UserPublic } from '../users/user.types';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function getExpiryDate(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded?.exp) throw new Error('Token is missing an expiry claim');
  return new Date(decoded.exp * 1000);
}

async function issueTokenPair(
  user: { id: string; role: UserPublic['role']; name: string; email: string },
  context: { userAgent?: string | null; ipAddress?: string | null },
): Promise<TokenPair> {
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  });

  const refreshToken = signRefreshToken({ sub: user.id, jti: randomUUID() });

  await RefreshTokenModel.create({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: getExpiryDate(refreshToken),
    userAgent: context.userAgent ?? null,
    ipAddress: context.ipAddress ?? null,
  });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshTokenExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  };
}

export const authService = {
  async login(
    input: LoginInput,
    context: { userAgent?: string | null; ipAddress?: string | null },
  ): Promise<{ user: UserPublic; tokens: TokenPair }> {
    const user = await userRepository.findByEmail(input.email, true);
    if (!user) throw new AuthenticationError('Invalid email or password');

    if (!user.isActive) throw new AuthenticationError('This account has been deactivated');

    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordMatches) throw new AuthenticationError('Invalid email or password');

    user.lastLoginAt = new Date();
    await user.save();

    const tokens = await issueTokenPair(
      { id: user.id, role: user.role, name: user.name, email: user.email },
      context,
    );

    return { user: toPublicUser(user), tokens };
  },

  async refresh(
    refreshToken: string,
    context: { userAgent?: string | null; ipAddress?: string | null },
  ): Promise<TokenPair> {
    let payload: RefreshTokenPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
    } catch {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await RefreshTokenModel.findOne({ tokenHash });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AuthenticationError('Refresh token has been revoked or expired');
    }

    const user = await userRepository.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new AuthenticationError('Account is no longer active');
    }

    const tokens = await issueTokenPair(
      { id: user.id, role: user.role, name: user.name, email: user.email },
      context,
    );

    // Rotate: the presented refresh token is single-use. Revoking it here means a
    // stolen-and-replayed token is immediately detectable (it will already be revoked).
    stored.revokedAt = new Date();
    stored.replacedByTokenHash = hashToken(tokens.refreshToken);
    await stored.save();

    return tokens;
  },

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await RefreshTokenModel.updateOne(
      { tokenHash, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  },

  async me(userId: string): Promise<UserPublic> {
    const user = await userRepository.findById(userId);
    if (!user) throw new AuthenticationError('User not found');
    return toPublicUser(user);
  },
};
