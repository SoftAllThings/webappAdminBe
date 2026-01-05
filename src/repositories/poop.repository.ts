import { pool } from "../config/database";
import { PoopRecord, CreatePoopRecord, UpdatePoopRecord } from "../types/poop";
import { executeQueryWithRetry } from "../utils/queryHelper";

export interface BristolStatsResult {
  bristolStats: Array<{ bristol_type: number; num: number }>;
  summary: {
    totalPoops: number;
    handledPoops: number;
    readyForAI: number;
    remainingToHandle: number;
  };
}

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
}

const READ_ONLY_FIELDS = [
  "id",
  "created_at",
  "updated_at",
  "s3_key",
  "s3_url",
  "gpt_bristol_type",
  "user_id",
];

export class PoopRepository {
  async findAll(
    offset: number,
    limit: number,
    bristolType?: number
  ): Promise<PaginatedResult<PoopRecord>> {
    let countQuery = "SELECT COUNT(*) as total FROM app.poop";
    let dataQuery = "SELECT * FROM app.poop";
    const queryParams: any[] = [];

    // Always filter for unprocessed records
    countQuery += " WHERE image_good_for_ml IS NULL AND skipped IS NOT TRUE";
    dataQuery += " WHERE image_good_for_ml IS NULL AND skipped IS NOT TRUE";

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

    // Apply max limit
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
      rows: result.rows,
      total,
    };
  }

  async findById(id: string): Promise<PoopRecord | null> {
    const query = "SELECT * FROM app.poop WHERE id = $1";
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  async create(data: CreatePoopRecord): Promise<PoopRecord> {
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
  }

  async update(
    id: string,
    data: Partial<UpdatePoopRecord>
  ): Promise<PoopRecord | null> {
    console.log("📝 Repository update called with:", { id, data });

    const entries = Object.entries(data).filter(([key, value]) => {
      return !READ_ONLY_FIELDS.includes(key) && value !== undefined;
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

    console.log("📝 Generated query:", query);
    console.log("📝 Query values:", values);

    console.log("🔄 Executing update query with retry logic...");
    const result = await executeQueryWithRetry(pool, query, values);
    console.log("✅ Update successful, result:", result.rows[0]);

    return result.rows[0] || null;
  }

  async search(
    criteria: Partial<PoopRecord>,
    offset: number,
    limit: number
  ): Promise<PaginatedResult<PoopRecord>> {
    const whereConditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

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
      rows: result.rows,
      total,
    };
  }

  async getLastTypeVerified(): Promise<{ bristol_type: number } | null> {
    const query = `
      SELECT bristol_type FROM app.poop
      WHERE image_good_for_ml = TRUE
      ORDER BY first_check_date DESC
      LIMIT 1
    `;
    const result = await pool.query(query);
    return result.rows[0] || null;
  }

  async getBristolStats(): Promise<BristolStatsResult> {
    const [bristolResult, totalResult, handledResult, readyResult] =
      await Promise.all([
        pool.query(`
          SELECT bristol_type, count(bristol_type) as num
          FROM app.readyToTrainView
          GROUP BY bristol_type
          ORDER BY bristol_type
        `),
        pool.query(`SELECT COUNT(*) as count FROM app.poop`),
        pool.query(`
          SELECT COUNT(*) as count FROM app.poop
          WHERE image_good_for_ml IS NOT NULL OR skipped IS NOT NULL
        `),
        pool.query(`SELECT COUNT(*) as count FROM app.readyToTrainView`),
      ]);

    const totalPoops = parseInt(totalResult.rows[0]?.count || "0");
    const handledPoops = parseInt(handledResult.rows[0]?.count || "0");
    const readyForAI = parseInt(readyResult.rows[0]?.count || "0");
    const remainingToHandle = totalPoops - readyForAI;

    return {
      bristolStats: bristolResult.rows.map((row) => ({
        bristol_type: row.bristol_type,
        num: parseInt(row.num),
      })),
      summary: {
        totalPoops,
        handledPoops,
        readyForAI,
        remainingToHandle,
      },
    };
  }
}

export const poopRepository = new PoopRepository();
