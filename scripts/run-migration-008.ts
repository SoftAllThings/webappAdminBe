/**
 * Runner for migrations/008_create_data_samples.sql (Data Samples tab).
 *
 * The migration is plain additive DDL, so it runs as one transaction: either
 * the whole datasales schema appears or nothing does.
 *
 * Run: npm run migrate-008
 */
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();

async function main(): Promise<void> {
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../migrations/008_create_data_samples.sql"),
    "utf8",
  );
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 30000,
  });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");

    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'datasales' ORDER BY table_name`,
    );
    console.table(rows);
    if (rows.length !== 3) throw new Error("Expected 3 tables in schema datasales");
    console.log("✅ datasales schema ready");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("❌ Migration failed:", error);
  process.exit(1);
});
