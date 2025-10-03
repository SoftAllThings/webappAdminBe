import { Router } from "express";
import { healthCheck, apiInfo } from "../controllers/healthController";

const router = Router();

// Health check route
router.get("/health", healthCheck);

// API info route
router.get("/info", apiInfo);

export default router;
