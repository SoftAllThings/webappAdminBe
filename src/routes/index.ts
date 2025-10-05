import { Router } from "express";
import { healthCheck, apiInfo } from "../controllers/healthController";
import { authenticateToken } from "../controllers/authController";
import authRoutes from "./authRoutes";
import poopRoutes from "./poopRoutes";

const router = Router();

// Health check route (public)
router.get("/health", healthCheck);

// API info route (public)
router.get("/info", apiInfo);

// Auth routes (public)
router.use("/auth", authRoutes);

// Protected routes (require authentication)
router.use("/poop", authenticateToken, poopRoutes);

export default router;
