import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  userId: string;
  role: string;
  familyId?: string;
}

export const signAccessToken = (payload: TokenPayload): string => {
  return jwt.sign({ userId: payload.userId, role: payload.role }, env.JWT_ACCESS_SECRET, {
    expiresIn: '15m',
  });
};

export const signRefreshToken = (payload: Required<TokenPayload>): string => {
  return jwt.sign(
    { userId: payload.userId, role: payload.role, familyId: payload.familyId },
    env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload;
};

export const verifyRefreshToken = (token: string): Required<TokenPayload> => {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as Required<TokenPayload>;
};
