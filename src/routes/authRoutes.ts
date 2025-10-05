import { Router } from "express";
import {
  login,
  verifyToken,
  authenticateToken,
} from "../controllers/authController";

const router = Router();

// Login route
router.post("/login", login);

// Verify token route (protected)
router.get("/verify", authenticateToken, verifyToken);

export default router;
