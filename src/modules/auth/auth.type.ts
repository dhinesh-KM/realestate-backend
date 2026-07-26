export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  isVerified: boolean;
  createdAt: Date;
}

export interface RefreshTokenPayload {
  sub: string;       // userId
  family: string;    // token family for reuse detection
  iat: number;
  exp: number;
}