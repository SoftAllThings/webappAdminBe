import { Router } from "express";
import { healthCheck, apiInfo } from "../controllers/healthController";
import poopRoutes from "./poopRoutes";

const router = Router();

// Health check route
router.get("/health", healthCheck);

// API info route
router.get("/info", apiInfo);

// Poop data routes
router.use("/poop", poopRoutes);

export default router;
