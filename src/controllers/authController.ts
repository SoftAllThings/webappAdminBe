import { Request, Response } from "express";
import { authService } from "../services/authService";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

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

    if (authService.validateCredentials(username, password)) {
      const result = authService.generateToken(username);

      res.json({
        success: true,
        data: result,
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

export const verifyToken = (req: Request, res: Response): void => {
  const authReq = req as AuthenticatedRequest;
  res.json({
    success: true,
    data: {
      user: authReq.user,
      valid: true,
    },
  });
};

// Re-export middleware for backwards compatibility
export { authenticateToken } from "../middleware/auth.middleware";
