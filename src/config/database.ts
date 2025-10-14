import { Pool, PoolConfig } from "pg";
import dotenv from "dotenv";

dotenv.config();

const poolConfig: PoolConfig = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "webappadmin",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  max: parseInt(process.env.DB_MAX_CONNECTIONS || "5", 10), // Reduced for Supabase
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || "10000", 10), // Reduced timeout
  connectionTimeoutMillis: parseInt(
    process.env.DB_CONNECTION_TIMEOUT || "5000",
    10
  ), // Increased timeout
  // Supabase specific settings
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  // Add query timeout
  query_timeout: 10000,
  // Add keepalive settings
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

// Create a new pool instance
export const pool = new Pool(poolConfig);

// Handle pool errors - don't crash the app
pool.on("error", (err) => {
  console.error("Unexpected error on idle client error:", err);
  // Log the error but don't exit - let the pool recover
  console.log("🔄 Pool will attempt to recover...");
});

// Test database connection
export const testConnection = async (): Promise<void> => {
  try {
    const client = await pool.connect();
    console.log("✅ Database connected successfully");
    const result = await client.query("SELECT NOW()");
    console.log("Database time:", result.rows[0]?.now);
    client.release();
  } catch (error) {
    console.error("❌ Error connecting to database:", error);
    throw error;
  }
};

// Graceful shutdown
export const closePool = async (): Promise<void> => {
  try {
    await pool.end();
    console.log("Database pool has ended");
  } catch (error) {
    console.error("Error closing database pool:", error);
  }
};
