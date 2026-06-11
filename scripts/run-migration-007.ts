/**
 * One-off runner for migrations/007_add_poop_review_indexes.sql.
 *
 * Uses a dedicated pg.Client (NOT the app pool) with no query_timeout:
 * pg's client-side query timeout does not cancel the server statement — it
 * destroys the connection, which would abort the index build mid-flight and
 * leave an INVALID index that IF NOT EXISTS then skips on re-run.
 *
 * CREATE INDEX CONCURRENTLY cannot run inside a transaction, so each
 * statement is sent individually (simple protocol, no implicit batching).
 *
 * Run: npm run migrate-007
 */
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();

const INDEXES = [
  {
    name: "idx_poop_review_queue_created_at",
    create: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_poop_review_queue_created_at
       ON app.poop (created_at DESC)
       WHERE image_good_for_ml IS NULL AND skipped IS NOT TRUE`,
  },
  {
    name: "idx_poop_verified_first_check_date",
    create: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_poop_verified_first_check_date
       ON app.poop (first_check_date DESC)
       WHERE image_good_for_ml = TRUE`,
  },
];

async function main(): Promise<void> {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 30000,
    // no query_timeout: the index build must not be killed client-side
  });

  await client.connect();
  try {
    // Supabase sets a server-side statement_timeout that cancels long index
    // builds; lift it for this session only (session pooler = dedicated backend).
    await client.query("SET statement_timeout = 0");

    for (const { name, create } of INDEXES) {
      // A previously interrupted CONCURRENTLY build leaves an INVALID index
      // that IF NOT EXISTS would silently keep — drop it first.
      const { rows: existing } = await client.query(
        `SELECT x.indisvalid
           FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
          WHERE i.relname = $1`,
        [name]
      );
      if (existing.length > 0 && !existing[0].indisvalid) {
        console.log(`▶ dropping INVALID leftover index ${name}`);
        await client.query(`DROP INDEX CONCURRENTLY app.${name}`);
      }

      console.log(`▶ creating ${name}`);
      const started = Date.now();
      await client.query(create);
      console.log(`  done in ${Date.now() - started}ms`);
    }

    console.log("▶ ANALYZE app.poop");
    await client.query("ANALYZE app.poop");

    const { rows } = await client.query(
      `SELECT i.relname, x.indisvalid
         FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
        WHERE i.relname IN ('idx_poop_review_queue_created_at',
                            'idx_poop_verified_first_check_date')`
    );
    console.table(rows);
    const invalid = rows.filter((r: any) => !r.indisvalid);
    if (rows.length < 2 || invalid.length > 0) {
      throw new Error(
        "Index verification failed — drop the invalid index with " +
          "DROP INDEX CONCURRENTLY and re-run (see migrations/007_add_poop_review_indexes.sql)"
      );
    }
    console.log("✅ Both indexes present and valid");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("❌ Migration failed:", error);
  process.exit(1);
});
