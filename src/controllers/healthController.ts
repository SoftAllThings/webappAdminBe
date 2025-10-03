import { Request, Response } from "express";

// Health check controller
export const healthCheck = (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    message: "Server is running!",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
};

// API info controller
export const apiInfo = (req: Request, res: Response): void => {
  res.status(200).json({
    success: true,
    data: {
      name: "WebApp Admin Backend API",
      version: "1.0.0",
      description: "Backend API for WebApp Admin",
      endpoints: {
        health: "/api/health",
        info: "/api/info",
      },
    },
  });
};
