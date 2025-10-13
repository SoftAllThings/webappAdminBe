import { pool } from "../config/database";
import { PoopRecord, CreatePoopRecord, UpdatePoopRecord } from "../types/poop";

export class PoopService {
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

      // For bristol_type filtering, limit to 300 records max
      const maxLimit =
        bristolType !== undefined && bristolType !== null
          ? Math.min(limit, 300)
          : limit;

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

  // Update an existing poop record
  async updatePoop(
    id: string,
    data: Partial<UpdatePoopRecord>
  ): Promise<PoopRecord | null> {
    try {
      const entries = Object.entries(data).filter(
        ([key, value]) => key !== "id" && value !== undefined
      );

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

      const result = await pool.query(query, values);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error updating poop record:", error);
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
