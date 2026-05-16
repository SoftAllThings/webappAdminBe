import { Router } from "express";
import { healthCheck, apiInfo } from "../controllers/healthController";
import { authenticateToken } from "../controllers/authController";
import authRoutes from "./authRoutes";
import poopRoutes from "./poopRoutes";
import analyticsRoutes from "./analyticsRoutes";
import blogRoutes from "./blogRoutes";
import v2AnalyticsRoutes from "./v2AnalyticsRoutes";
import bqRoutes from "./bqRoutes";
import insightsRoutes from "./insightsRoutes";
import chatRoutes from "./chatRoutes";
import modelComparisonRoutes from "./modelComparisonRoutes";

const router = Router();

// Health check route (public)
router.get("/health", healthCheck);

// API info route (public)
router.get("/info", apiInfo);

// Auth routes (public)
router.use("/auth", authRoutes);

// Protected routes (require authentication)
router.use("/poop", authenticateToken, poopRoutes);

router.use("/firebase", analyticsRoutes);

// V2 App analytics: query softai.individuals + softai.stool_logs (protected)
router.use("/v2-analytics", authenticateToken, v2AnalyticsRoutes);

// Blog routes (protected)
router.use("/blog", authenticateToken, blogRoutes);
// Blog routes (public - blog posts should be readable by everyone)
// router.use("/blog", blogRoutes);

// BigQuery-backed product analytics (protected)
router.use("/bq", authenticateToken, bqRoutes);

// Insights agent — read briefs, write section feedback (protected)
router.use("/insights", authenticateToken, insightsRoutes);

// Analyst chat (Claude + MCP, streaming SSE) — protected
router.use("/chat", authenticateToken, chatRoutes);

// ML model A/B comparison — runs old + new ONNX models side-by-side (protected)
router.use("/model-comparison", authenticateToken, modelComparisonRoutes);

export default router;
