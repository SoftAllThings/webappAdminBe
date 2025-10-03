import { Request, Response, NextFunction } from "express";

// Error interface
export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

// Global error handler middleware
export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  console.error(`Error ${statusCode}: ${message}`);
  console.error(err.stack);

  res.status(statusCode).json({
    success: false,
    error: {
      message:
        process.env.NODE_ENV === "production" && statusCode === 500
          ? "Something went wrong!"
          : message,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    },
  });
};

// Not found middleware
export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.originalUrl} not found`,
    },
  });
};

// Request logging middleware
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
};
