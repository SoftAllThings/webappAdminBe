import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

if (!ADMIN_PASSWORD) {
  throw new Error("ADMIN_PASSWORD environment variable is required");
}

export interface TokenPayload {
  username: string;
  role: string;
  iat: number;
}

export interface AuthResult {
  token: string;
  user: {
    username: string;
    role: string;
  };
}

export class AuthService {
  validateCredentials(username: string, password: string): boolean {
    return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
  }

  generateToken(username: string): AuthResult {
    const token = jwt.sign(
      {
        username,
        role: "admin",
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET!,
      { expiresIn: "24h" }
    );

    return {
      token,
      user: {
        username,
        role: "admin",
      },
    };
  }
}

export const authService = new AuthService();
