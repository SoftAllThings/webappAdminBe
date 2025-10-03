import { Pool, PoolConfig } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Debug environment variables in production
console.log('🔍 Environment Debug:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_USER:', process.env.DB_USER ? 'SET' : 'NOT SET');
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? 'SET' : 'NOT SET');
console.log('DB_SSL:', process.env.DB_SSL);

const poolConfig: PoolConfig = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "webappadmin",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  max: parseInt(process.env.DB_MAX_CONNECTIONS || "20", 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || "30000", 10),
  connectionTimeoutMillis: parseInt(
    process.env.DB_CONNECTION_TIMEOUT || "2000",
    10
  ),
  // SSL configuration for cloud databases like Supabase
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
};

// Debug the actual pool configuration
console.log('🔧 Pool Configuration:');
console.log('Host:', poolConfig.host);
console.log('Port:', poolConfig.port);
console.log('Database:', poolConfig.database);
console.log('User:', poolConfig.user);
console.log('SSL:', poolConfig.ssl);

// Create a new pool instance
export const pool = new Pool(poolConfig);

// Handle pool errors
pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
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
