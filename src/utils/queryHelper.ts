import { Pool, QueryResult } from "pg";

const CONNECTION_ERROR_CODES = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "XX000", // Supabase termination code
];

export const isConnectionError = (error: any): boolean => {
  return CONNECTION_ERROR_CODES.some(
    (code) =>
      error.code === code ||
      error.message?.includes(code) ||
      error.message?.includes("shutdown") ||
      error.message?.includes("termination")
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
      console.log(`🔄 Query attempt ${attempt}/${retries}`);
      const result = await pool.query(query, params);
      console.log(`✅ Query successful on attempt ${attempt}`);
      return result;
    } catch (error: any) {
      console.error(
        `❌ Query attempt ${attempt}/${retries} failed:`,
        error.message
      );
      console.error(`❌ Error code: ${error.code}`);

      if (attempt < retries && isConnectionError(error)) {
        console.log(`🔄 Retrying in ${attempt * 1000}ms...`);
        await delay(attempt * 1000);
        continue;
      }

      console.error(`❌ Giving up after ${attempt} attempts`);
      throw error;
    }
  }
  throw new Error("All retry attempts failed");
};
