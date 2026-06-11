import { Request, Response } from "express";
import { pool } from "../config/database";

// Keep the ping shorter than connectionTimeoutMillis so /api/health answers
// promptly; the losing pool.query still completes and warms the pool.
const HEALTH_DB_TIMEOUT_MS = 8000;

// Health check controller — pings the DB so the frontend's wake-up call
// warms a pooler connection before the data queries fire.
// NOTE: never set /api/health as Render's Health Check Path — it returns 503
// while the database is unreachable, which would make Render kill the dyno.
export const healthCheck = async (
  req: Request,
  res: Response
): Promise<void> => {
  const base = {
    message: "Server is running!",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("health DB ping timed out")),
          HEALTH_DB_TIMEOUT_MS
        );
      }),
    ]);
    res.status(200).json({ success: true, ...base, database: "connected" });
  } catch (error) {
    console.error("Health check DB ping failed:", (error as Error)?.message);
    res.status(503).json({ success: false, ...base, database: "unavailable" });
  } finally {
    if (timer) clearTimeout(timer);
  }
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
