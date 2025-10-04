import { Router, Request, Response } from "express";

const router = Router();

// Simple health check endpoint that doesn't require database
router.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Wake up endpoint - lighter than full poop data
router.get("/wake", (req: Request, res: Response) => {
  res.status(200).json({
    status: "awake",
    message: "Service is now active",
    timestamp: new Date().toISOString(),
  });
});

export default router;
