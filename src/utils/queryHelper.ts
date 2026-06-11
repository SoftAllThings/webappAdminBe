import { Pool, QueryResult } from "pg";

const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "XX000", // Supabase/Supavisor internal error
  "08000", // connection_exception family —
  "08001", // Supavisor's "Failed to connect to database: :timeout" is 08006
  "08003",
  "08006",
  "57P01", // admin_shutdown / crash_shutdown / cannot_connect_now
  "57P02",
  "57P03",
]);

const RETRYABLE_MESSAGE_FRAGMENTS = [
  "failed to connect", // Supavisor: "Failed to connect to database: :timeout"
  "timeout exceeded when trying to connect", // pg-pool acquisition timeout
  "timeout expired", // pg client connect timeout
  "connection terminated", // socket killed mid-query or during connect
  "shutdown",
  "termination",
];

export const isConnectionError = (error: any): boolean => {
  // Client-side query_timeout on a genuinely slow query — retrying would
  // just multiply the wait. Never match bare "timeout".
  if (error?.message === "Query read timeout") return false;
  if (error?.code && RETRYABLE_CODES.has(error.code)) return true;
  const message = (error?.message || "").toLowerCase();
  return RETRYABLE_MESSAGE_FRAGMENTS.some((fragment) =>
    message.includes(fragment)
  );
};

export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const executeQueryWithRetry = async (
  pool: Pool,
  query: string,
  params: any[] = [],
  retries: number = 3
): Promise<QueryResult> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await pool.query(query, params);
      if (attempt > 1) {
        console.log(`✅ Query successful on attempt ${attempt}`);
      }
      return result;
    } catch (error: any) {
      console.error(
        `❌ Query attempt ${attempt}/${retries} failed:`,
        error.message
      );
      console.error(`❌ Error code: ${error.code}`);

      if (attempt < retries && isConnectionError(error)) {
        console.log(`🔄 Retrying in ${attempt * 500}ms...`);
        await delay(attempt * 500);
        continue;
      }

      console.error(`❌ Giving up after ${attempt} attempts`);
      throw error;
    }
  }
  throw new Error("All retry attempts failed");
};
