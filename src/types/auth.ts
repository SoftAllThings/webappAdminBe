export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenPayload {
  username: string;
  role: string;
  iat: number;
}

export interface AuthUser {
  username: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface VerifyResponse {
  user: TokenPayload;
  valid: boolean;
}
