/**
 * Exports a random sample of verified-good logs from app.readyToTrainView
 * for sharing via Google Drive.
 *
 * Produces ./out-3k/ containing:
 *   - metadata.jsonl  (one record per line; sample_id matches image filename)
 *   - images/         (sample_0001.jpg … sample_NNNN.jpg)
 *   - README.md
 *
 * Run: npm run export-3k
 * Override size with: SAMPLE_SIZE=30 npm run export-3k   (smoke test)
 * Then: cd out-3k && zip -r ../softallthings-3k.zip .
 */
import * as fs from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";
import { pool } from "../src/config/database";
import { fetchObjectBytes } from "../src/services/s3Service";

dotenv.config();

const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || "3000", 10);
const DOWNLOAD_CONCURRENCY = 10;
const PER_DOWNLOAD_TIMEOUT_MS = 60_000;
const OUT_DIR = path.resolve(process.cwd(), "out-3k");
const IMAGES_DIR = path.join(OUT_DIR, "images");
const MAPPING_PATH = path.resolve(process.cwd(), "mapping.json");

// Fields stripped from the JSONL output. s3_key/s3_url are internal storage
// pointers; presigned URLs in the view would be expired by the time the
// recipient sees them anyway.
const STRIPPED_FIELDS = new Set(["s3_key", "s3_url"]);

async function loadReverseMaps(): Promise<Map<string, Map<number, string>>> {
  const raw = await fs.readFile(MAPPING_PATH, "utf8");
  // mapping.json uses JSONC-style line comments; strip them before parsing.
  const cleaned = raw.replace(/^\s*\/\/.*$/gm, "");
  const mapping: Record<string, unknown> = JSON.parse(cleaned);

  const reverseMaps = new Map<string, Map<number, string>>();
  for (const [field, value] of Object.entries(mapping)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const reverse = new Map<number, string>();
    for (const [label, code] of Object.entries(value as Record<string, unknown>)) {
      if (typeof code === "number") reverse.set(code, label);
    }
    if (reverse.size > 0) reverseMaps.set(field, reverse);
  }
  return reverseMaps;
}

const README = `# SoftAllThings Training Sample

A random sample of verified-good stool log records from production, drawn from
the \`app.readyToTrainView\` view. Each record has a paired image in \`images/\`.

## File layout
- \`metadata.jsonl\` — one record per line (NDJSON / JSON Lines)
- \`images/\` — JPG files; each record's \`image_file\` field points to its image
- \`README.md\` — this file

## Loading the metadata

Python (pandas):
\`\`\`python
import pandas as pd
df = pd.read_json("metadata.jsonl", lines=True)
\`\`\`

Python (stdlib):
\`\`\`python
import json
with open("metadata.jsonl") as f:
    records = [json.loads(line) for line in f]
\`\`\`

Shell (jq):
\`\`\`bash
jq -c 'select(.bristol_type == 5)' metadata.jsonl
\`\`\`

## Notes
- Sample is uniformly random across all rows in \`app.readyToTrainView\`.
- No user identifiers are included.
- Each \`sample_id\` is opaque (\`sample_NNNN\`) — there is no grouping by user.
- Internal storage pointers (\`s3_key\`, \`s3_url\`) are stripped from records.
- All other view columns are passed through unchanged; nulls mean the field
  was not captured for that log.
`;

interface Row {
  s3_key: string | null;
  [key: string]: unknown;
}

async function fetchRows(limit: number): Promise<Row[]> {
  // SELECT * — the view's column set is the source of truth for what's
  // safe to share. We strip a small denylist (s3_key, s3_url) below.
  const sql = `
    SELECT *
    FROM app.readyToTrainView
    WHERE s3_key IS NOT NULL
    ORDER BY random()
    LIMIT $1
  `;
  const res = await pool.query<Row>(sql, [limit]);
  return res.rows;
}

function buildRecord(
  row: Row,
  sampleId: string,
  reverseMaps: Map<string, Map<number, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sample_id: sampleId,
    image_file: `images/${sampleId}.jpg`,
  };
  for (const [key, value] of Object.entries(row)) {
    if (STRIPPED_FIELDS.has(key)) continue;
    const reverse = reverseMaps.get(key);
    if (reverse && typeof value === "number") {
      // Decode int → label. Unknown int falls back to the raw value
      // rather than null, so nothing is silently dropped.
      out[key] = reverse.get(value) ?? value;
    } else {
      out[key] = value instanceof Date ? value.toISOString() : value;
    }
  }
  return out;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

async function main(): Promise<void> {
  const reverseMaps = await loadReverseMaps();
  console.log(`Loaded label mappings for: ${Array.from(reverseMaps.keys()).join(", ")}`);

  console.log(`Fetching ${SAMPLE_SIZE} random rows from app.readyToTrainView…`);
  const rows = await fetchRows(SAMPLE_SIZE);
  console.log(`Got ${rows.length} rows.`);

  if (rows.length === 0) {
    throw new Error("No rows returned — view is empty or all rows lack s3_key.");
  }

  // Sequential opaque ids, zero-padded to keep filenames sorted.
  const idWidth = String(rows.length).length;
  const tasks = rows.map((row, i) => ({
    sampleId: `sample_${pad(i + 1, idWidth)}`,
    row,
  }));

  await fs.mkdir(IMAGES_DIR, { recursive: true });

  console.log(`Downloading ${tasks.length} images (concurrency=${DOWNLOAD_CONCURRENCY}, timeout=${PER_DOWNLOAD_TIMEOUT_MS}ms)…`);
  let done = 0;
  const succeeded = new Set<string>();
  const failures: Array<{ sampleId: string; s3_key: string | null; error: string }> = [];
  await runWithConcurrency(tasks, DOWNLOAD_CONCURRENCY, async ({ sampleId, row }) => {
    try {
      if (!row.s3_key) throw new Error("null s3_key");
      const fetchPromise = fetchObjectBytes(row.s3_key);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${PER_DOWNLOAD_TIMEOUT_MS}ms`)), PER_DOWNLOAD_TIMEOUT_MS),
      );
      const { body } = await Promise.race([fetchPromise, timeoutPromise]);
      await fs.writeFile(path.join(IMAGES_DIR, `${sampleId}.jpg`), body);
      succeeded.add(sampleId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ sampleId, s3_key: row.s3_key, error: msg });
    } finally {
      done++;
      if (done % 100 === 0 || done === tasks.length) {
        console.log(`  ${done} / ${tasks.length} (ok=${succeeded.size}, failed=${failures.length})`);
      }
    }
  });

  // Only emit metadata for successfully downloaded images, so the JSONL and the
  // images/ folder stay perfectly in sync.
  const lines = tasks
    .filter(({ sampleId }) => succeeded.has(sampleId))
    .map(({ sampleId, row }) => JSON.stringify(buildRecord(row, sampleId, reverseMaps)));
  await fs.writeFile(path.join(OUT_DIR, "metadata.jsonl"), lines.join("\n") + "\n");
  await fs.writeFile(path.join(OUT_DIR, "README.md"), README);

  if (failures.length > 0) {
    await fs.writeFile(path.join(OUT_DIR, "failures.json"), JSON.stringify(failures, null, 2));
    console.log(`\nWARNING: ${failures.length} download(s) failed. See out-3k/failures.json.`);
  }

  console.log(`\nDone. ${succeeded.size} images + metadata at: ${OUT_DIR}`);
  console.log("Next:");
  console.log("  1. Spot-check metadata.jsonl for anything unexpected.");
  console.log("  2. cd out-3k && zip -r ../softallthings-3k.zip .");
  console.log("  3. Upload softallthings-3k.zip to Drive, share the link.");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Export failed:", err);
    pool.end().finally(() => process.exit(1));
  });
