import { pool } from "../config/database";
import { PoopRecord, CreatePoopRecord, UpdatePoopRecord } from "../types/poop";

export class PoopService {
  // Helper method to execute queries with retry logic
  private async executeQuery(
    query: string,
    params: any[] = [],
    retries: number = 3
  ): Promise<any> {
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

        // If it's a connection error and we have retries left, wait and try again
        if (attempt < retries && this.isConnectionError(error)) {
          console.log(`🔄 Retrying in ${attempt * 1000}ms...`);
          await this.delay(attempt * 1000);
          continue;
        }

        // Re-throw the error if we're out of retries or it's not a connection error
        console.error(`❌ Giving up after ${attempt} attempts`);
        throw error;
      }
    }
    throw new Error("All retry attempts failed");
  }

  // Helper to identify connection errors
  private isConnectionError(error: any): boolean {
    const connectionErrorCodes = [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENOTFOUND",
      "XX000", // Supabase termination code
    ];

    return connectionErrorCodes.some(
      (code) =>
        error.code === code ||
        error.message?.includes(code) ||
        error.message?.includes("shutdown") ||
        error.message?.includes("termination")
    );
  }

  // Helper for delays
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Get all poop records with pagination
  async getAllPoops(
    page: number = 1,
    limit: number = 10,
    bristolType?: number
  ): Promise<{ records: PoopRecord[]; total: number }> {
    try {
      const offset = (page - 1) * limit;

      // Build dynamic query based on bristol_type filter
      let countQuery = "SELECT COUNT(*) as total FROM app.poop";
      let dataQuery = "SELECT * FROM app.poop";
      const queryParams: any[] = [];

      // Always include image_good_for_ml IS NULL condition
      countQuery += " WHERE image_good_for_ml IS NULL";
      dataQuery += " WHERE image_good_for_ml IS NULL";

      if (bristolType !== undefined && bristolType !== null) {
        countQuery += " AND bristol_type = $1";
        dataQuery += " AND bristol_type = $1";
        queryParams.push(bristolType);
      }

      // Get total count
      const countResult = await pool.query(
        countQuery,
        bristolType !== undefined && bristolType !== null ? [bristolType] : []
      );
      const total = parseInt(countResult.rows[0]?.total || "0");

      // Always limit to 100 records max (both filtered and unfiltered)
      const maxLimit = Math.min(limit, 100);

      // Get paginated records
      dataQuery +=
        " ORDER BY created_at DESC LIMIT $" +
        (queryParams.length + 1) +
        " OFFSET $" +
        (queryParams.length + 2);
      queryParams.push(maxLimit, offset);

      const result = await pool.query(dataQuery, queryParams);

      return {
        records: result.rows,
        total,
      };
    } catch (error) {
      console.error("Error fetching poop records:", error);
      throw error;
    }
  }

  // Get a single poop record by ID
  async getPoopById(id: string): Promise<PoopRecord | null> {
    try {
      const query = "SELECT * FROM app.poop WHERE id = $1";
      const result = await pool.query(query, [id]);

      return result.rows[0] || null;
    } catch (error) {
      console.error("Error fetching poop record by ID:", error);
      throw error;
    }
  }

  // Create a new poop record
  async createPoop(data: CreatePoopRecord): Promise<PoopRecord> {
    try {
      const columns = Object.keys(data).join(", ");
      const values = Object.values(data);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");

      const query = `
        INSERT INTO app.poop (${columns})
        VALUES (${placeholders})
        RETURNING *
      `;

      const result = await pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error("Error creating poop record:", error);
      throw error;
    }
  }

  async getLastTypeVerified(): Promise<number | null> {
    try {
      const query = `
        SELECT bristol_type FROM app.poop
        WHERE image_good_for_ml = TRUE
        ORDER BY first_check_date DESC
        LIMIT 1
      `;
      const result = await pool.query(query);
      if (result.rows.length > 0) {
        return result.rows[0];
      } else {
        return null;
      }
    } catch (error) {
      console.error("Error fetching last verified bristol type:", error);
      throw error;
    }
  }

  // Update an existing poop record
  async updatePoop(
    id: string,
    data: Partial<UpdatePoopRecord>
  ): Promise<PoopRecord | null> {
    try {
      console.log("📝 updatePoop called with:", { id, data });

      const entries = Object.entries(data).filter(([key, value]) => {
        // Filter out read-only fields and undefined values
        const readOnlyFields = [
          "id",
          "created_at",
          "updated_at",
          "s3_key",
          "s3_url",
          "gpt_bristol_type",
          "user_id",
        ];
        return !readOnlyFields.includes(key) && value !== undefined;
      });

      console.log("📝 Filtered entries (excluding read-only fields):", entries);

      if (entries.length === 0) {
        throw new Error("No valid fields to update");
      }

      const setClause = entries
        .map(([key, _], index) => `${key} = $${index + 2}`)
        .join(", ");
      const values = [id, ...entries.map(([_, value]) => value)];

      const query = `
        UPDATE app.poop 
        SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `;

      console.log("� Generated query:", query);
      console.log("📝 Query values:", values);

      console.log("�🔄 Executing update query with retry logic...");
      const result = await this.executeQuery(query, values);
      console.log("✅ Update successful, result:", result.rows[0]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("❌ Error updating poop record:", error);
      throw error;
    }
  }

  // Search poop records by criteria
  async searchPoops(
    criteria: Partial<PoopRecord>,
    page: number = 1,
    limit: number = 10
  ): Promise<{ records: PoopRecord[]; total: number }> {
    try {
      const offset = (page - 1) * limit;
      const whereConditions: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Build WHERE clause dynamically based on criteria
      Object.entries(criteria).forEach(([key, value]) => {
        if (
          value !== undefined &&
          value !== null &&
          key !== "created_at" &&
          key !== "updated_at"
        ) {
          whereConditions.push(`${key} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      });

      const whereClause =
        whereConditions.length > 0
          ? `WHERE ${whereConditions.join(" AND ")}`
          : "";

      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM app.poop ${whereClause}`;
      const countResult = await pool.query(countQuery, values);
      const total = parseInt(countResult.rows[0]?.total || "0");

      // Get paginated records
      const query = `
        SELECT * FROM app.poop 
        ${whereClause}
        ORDER BY created_at DESC 
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      const result = await pool.query(query, [...values, limit, offset]);

      return {
        records: result.rows,
        total,
      };
    } catch (error) {
      console.error("Error searching poop records:", error);
      throw error;
    }
  }
}
