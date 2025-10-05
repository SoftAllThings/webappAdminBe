import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET || "your-super-secret-jwt-key-change-this";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "B0nQHfEb5jy5";

// Login endpoint
export const login = (req: Request, res: Response): void => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({
        success: false,
        error: { message: "Username and password are required" },
      });
      return;
    }

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      // Generate JWT token
      const token = jwt.sign(
        {
          username: ADMIN_USERNAME,
          role: "admin",
          iat: Math.floor(Date.now() / 1000),
        },
        JWT_SECRET,
        { expiresIn: "24h" }
      );

      res.json({
        success: true,
        data: {
          token,
          user: {
            username: ADMIN_USERNAME,
            role: "admin",
          },
        },
      });
    } else {
      res.status(401).json({
        success: false,
        error: { message: "Invalid credentials" },
      });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      error: { message: "Internal server error" },
    });
  }
};

// Middleware to verify JWT token
export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({
      success: false,
      error: { message: "Access token required" },
    });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      res.status(403).json({
        success: false,
        error: { message: "Invalid or expired token" },
      });
      return;
    }

    // Add user info to request object
    (req as any).user = user;
    next();
  });
};

// Verify token endpoint (for checking if token is still valid)
export const verifyToken = (req: Request, res: Response) => {
  // If we reach here, the token is valid (middleware passed)
  res.json({
    success: true,
    data: {
      user: (req as any).user,
      valid: true,
    },
  });
};
