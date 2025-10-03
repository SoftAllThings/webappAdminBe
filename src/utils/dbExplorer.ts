import { pool } from "../config/database";

// Function to examine the app.poop table structure
export const examinePoopTable = async () => {
  try {
    const client = await pool.connect();

    // Get table schema information
    const schemaQuery = `
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length
      FROM information_schema.columns 
      WHERE table_schema = 'app' AND table_name = 'poop'
      ORDER BY ordinal_position;
    `;

    const schemaResult = await client.query(schemaQuery);
    console.log("\n📋 app.poop Table Schema:");
    console.table(schemaResult.rows);

    // Get sample data (first 3 rows)
    const sampleQuery = "SELECT * FROM app.poop LIMIT 3";
    const sampleResult = await client.query(sampleQuery);
    console.log("\n📊 Sample Data:");
    console.log(JSON.stringify(sampleResult.rows, null, 2));

    // Get row count
    const countQuery = "SELECT COUNT(*) as total_rows FROM app.poop";
    const countResult = await client.query(countQuery);
    console.log(`\n📈 Total rows: ${countResult.rows[0]?.total_rows}`);

    client.release();
    return {
      schema: schemaResult.rows,
      sampleData: sampleResult.rows,
      totalRows: countResult.rows[0]?.total_rows,
    };
  } catch (error) {
    console.error("❌ Error examining app.poop table:", error);
    throw error;
  }
};

// Function to test if app.poop table exists
export const checkPoopTableExists = async () => {
  try {
    const client = await pool.connect();
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'app' AND table_name = 'poop'
      );
    `;
    const result = await client.query(query);
    client.release();
    return result.rows[0]?.exists;
  } catch (error) {
    console.error("❌ Error checking if app.poop table exists:", error);
    return false;
  }
};
