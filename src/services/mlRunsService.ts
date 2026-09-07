import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * Reads ML training-run manifests and benchmark leaderboards from S3.
 *
 * Producers are in the AI project:
 *   deployment/ml/run_manifest.py  -> ml-runs/<run_id>/manifest.json
 *   benchmark/score.py --publish   -> ml-benchmarks/<run_id>/results.json
 *
 * S3 is the source of truth rather than Postgres because the training box has
 * AWS credentials already and no DB access — see the prefix convention in
 * run_manifest.py before changing these paths.
 */

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const BUCKET = process.env.ML_ARTIFACTS_BUCKET || process.env.S3_BUCKET || "softallthingspoops";
const RUNS_PREFIX = "ml-runs/";
const BENCH_PREFIX = "ml-benchmarks/";

// Manifests are small and rewritten only when a run finishes, so a short TTL
// keeps the page snappy without risking a stale leaderboard after a publish.
const CACHE_TTL_MS = 60_000;

let client: S3Client | null = null;
function getClient(): S3Client {
  if (client) return client;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials missing (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)");
  }
  client = new S3Client({ region: REGION, credentials: { accessKeyId, secretAccessKey } });
  return client;
}

type CacheEntry = { at: number; value: unknown };
const cache = new Map<string, CacheEntry>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value as T);
  return load().then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const res = await getClient().send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    const body = await res.Body?.transformToString();
    return body ? (JSON.parse(body) as T) : null;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

/** One S3 "directory" per run; the run_id is the path segment after the prefix. */
async function listRunIds(prefix: string): Promise<string[]> {
  const ids: string[] = [];
  let token: string | undefined;
  do {
    const res = await getClient().send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken: token,
      }),
    );
    for (const p of res.CommonPrefixes ?? []) {
      const id = p.Prefix?.slice(prefix.length).replace(/\/$/, "");
      if (id) ids.push(id);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return ids;
}

export type TrainingManifest = {
  schema_version: number;
  kind: string;
  run_id: string;
  created_at: string;
  git?: { sha?: string; branch?: string; dirty?: boolean };
  dataset?: Record<string, unknown>;
  split?: Record<string, unknown>;
  config?: Record<string, unknown>;
  training?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
  notes?: string | null;
};

export type BenchmarkResult = {
  run_id: string;
  scored_at?: string;
  prompt_version?: string;
  gold_set_size?: number;
  model_run_id?: string | null;
  models: Record<string, { composite: number; fields: Record<string, unknown> }>;
};

/** Newest first. A run whose manifest is missing or unreadable is skipped, not fatal. */
export async function listTrainingRuns(): Promise<TrainingManifest[]> {
  return cached("runs", async () => {
    const ids = await listRunIds(RUNS_PREFIX);
    const loaded = await Promise.all(
      ids.map((id) => readJson<TrainingManifest>(`${RUNS_PREFIX}${id}/manifest.json`)),
    );
    return loaded
      .filter((m): m is TrainingManifest => m !== null)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  });
}

export async function getTrainingRun(runId: string): Promise<TrainingManifest | null> {
  return readJson<TrainingManifest>(`${RUNS_PREFIX}${runId}/manifest.json`);
}

export async function listBenchmarks(): Promise<BenchmarkResult[]> {
  return cached("benchmarks", async () => {
    const ids = await listRunIds(BENCH_PREFIX);
    const loaded = await Promise.all(
      ids.map((id) => readJson<BenchmarkResult>(`${BENCH_PREFIX}${id}/results.json`)),
    );
    return loaded
      .filter((b): b is BenchmarkResult => b !== null)
      .sort((a, b) => (b.scored_at ?? "").localeCompare(a.scored_at ?? ""));
  });
}

export async function getBenchmark(runId: string): Promise<BenchmarkResult | null> {
  return readJson<BenchmarkResult>(`${BENCH_PREFIX}${runId}/results.json`);
}

/** Clears the TTL cache so a fresh publish shows up without waiting it out. */
export function invalidateCache(): void {
  cache.clear();
}
