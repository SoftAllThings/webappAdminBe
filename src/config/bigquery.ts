import { BigQuery } from "@google-cloud/bigquery";
import path from "path";
import fs from "fs";

let _bq: BigQuery | null = null;
let _eventsTable: string | null = null;

function init(): { bq: BigQuery; eventsTable: string } {
  const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID;
  const BQ_DATASET = process.env.BQ_DATASET;

  if (!BQ_PROJECT_ID) {
    throw new Error("BQ_PROJECT_ID environment variable is required");
  }
  if (!BQ_DATASET) {
    throw new Error("BQ_DATASET environment variable is required");
  }

  let credentials: Record<string, unknown>;

  if (process.env.BQ_SERVICE_ACCOUNT_KEY) {
    credentials = JSON.parse(process.env.BQ_SERVICE_ACCOUNT_KEY);
  } else if (process.env.BQ_SERVICE_ACCOUNT_PATH) {
    const keyPath = path.resolve(process.env.BQ_SERVICE_ACCOUNT_PATH);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`BigQuery service account key not found at ${keyPath}`);
    }
    credentials = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  } else {
    throw new Error(
      "BigQuery credentials missing. Set BQ_SERVICE_ACCOUNT_KEY (JSON) or BQ_SERVICE_ACCOUNT_PATH (file path)"
    );
  }

  const bq = new BigQuery({ projectId: BQ_PROJECT_ID, credentials: credentials as any });
  const eventsTable = `\`${BQ_PROJECT_ID}.${BQ_DATASET}.events_*\``;
  console.log(`✅ BigQuery client initialized for ${BQ_PROJECT_ID}.${BQ_DATASET}`);
  return { bq, eventsTable };
}

export function getBq(): BigQuery {
  if (!_bq) {
    const { bq, eventsTable } = init();
    _bq = bq;
    _eventsTable = eventsTable;
  }
  return _bq;
}

export function getEventsTable(): string {
  if (!_eventsTable) {
    const { bq, eventsTable } = init();
    _bq = bq;
    _eventsTable = eventsTable;
  }
  return _eventsTable;
}
