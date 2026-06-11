import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

import { testConnection, closePool } from "./config/database";
import {
  errorHandler,
  notFound,
  requestLogger,
} from "./middleware/errorHandler";
import indexRoutes from "./routes/index";

// Load environment variables
dotenv.config();

class Server {
  private app: Application;
  private port: number;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || "3001", 10);

    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {
    // Security middleware
    this.app.use(helmet());

    // CORS configuration
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:3002",
      "https://webappadmin.pages.dev",
      "https://softallthings.com",
    ];

    this.app.use(
      cors({
        origin: (origin, callback) => {
          // Allow requests with no origin (like mobile apps or curl requests)
          if (!origin) return callback(null, true);

          if (allowedOrigins.includes(origin)) {
            return callback(null, true);
          } else {
            return callback(new Error("Not allowed by CORS"));
          }
        },
        credentials: true,
      })
    );

    // Logging
    if (process.env.NODE_ENV === "development") {
      this.app.use(morgan("dev"));
    } else {
      this.app.use(morgan("combined"));
    }

    // Custom request logger
    this.app.use(requestLogger);

    // Body parsing middleware
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  }

  private initializeRoutes(): void {
    // API routes
    this.app.use("/api", indexRoutes);

    // Root route
    this.app.get("/", (req, res) => {
      res.json({
        success: true,
        message: "WebApp Admin Backend API",
        version: "1.0.0",
      });
    });
  }

  private initializeErrorHandling(): void {
    // 404 handler
    this.app.use(notFound);

    // Global error handler
    this.app.use(errorHandler);
  }

  public async start(): Promise<void> {
    // Start the server first — a cold DB/pooler must not crash-loop the
    // service; per-request retries recover once the DB is reachable.
    this.app.listen(this.port, () => {
      console.log(`🚀 Server running on port ${this.port}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`🔗 API Base URL: http://localhost:${this.port}/api`);
    });

    // Graceful shutdown
    process.on("SIGTERM", this.gracefulShutdown);
    process.on("SIGINT", this.gracefulShutdown);

    // Warm up the DB connection in the background
    if (process.env.NODE_ENV !== "development") {
      testConnection().catch((error: unknown) => {
        console.error(
          "⚠️ Initial DB warm-up failed; continuing (per-request retry will recover):",
          (error as Error)?.message
        );
      });
    }
  }

  private gracefulShutdown = async (): Promise<void> => {
    console.log(
      "\n🔄 Received shutdown signal. Graceful shutdown initiated..."
    );

    try {
      await closePool();
      console.log("✅ Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      console.error("❌ Error during graceful shutdown:", error);
      process.exit(1);
    }
  };

  public getApp(): Application {
    return this.app;
  }
}

export default Server;
