import { randomBytes } from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../config/database";
import { executeQueryWithRetry } from "../utils/queryHelper";
import { sourceTable, type SourceKey, type SourceTable } from "../services/dataSamples/catalog";

/**
 * SQL for the Data Samples tab: which photos are eligible, random sampling
 * per Bristol type, and the per-buyer delivery log (datasales schema,
 * migrations/008_create_data_samples.sql).
 */

/** public.businesses ids: 1 = the PoopCheck app itself, 4 = the website demo
 *  (every upload belongs to one shared "web-anonymous" individual). */
export const APP_ORG_ID = 1;
export const WEB_DEMO_ORG_ID = 4;

export interface SampleFilters {
  source: SourceKey;
  buyerId: number | null;
  excludeSentToBuyer: boolean;
  excludeSentToAnyBuyer: boolean;
  includeRejected: boolean;
  includeWebDemo: boolean;
  includeMinors: boolean;
}

export interface Candidate {
  row_id: string;
  bristol: number;
  person_ref: string | null;
  image_hash: string | null;
}

class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/** Photos already delivered (or prepared and not voided) are not offered again. */
function notAlreadySent(
  f: SampleFilters,
  p: Params,
  table: SourceTable,
  rowIdExpr: string,
  hashExpr: string | null,
): string {
  const perBuyer = f.excludeSentToBuyer && f.buyerId !== null;
  if (!f.excludeSentToAnyBuyer && !perBuyer) return "";
  const scope = f.excludeSentToAnyBuyer ? "" : `AND e.buyer_id = ${p.add(f.buyerId)}`;
  const live = `FROM datasales.export_items ei
                JOIN datasales.exports e ON e.id = ei.export_id
               WHERE e.status <> 'voided' AND NOT ei.failed ${scope}`;
  let sql = `
      AND NOT EXISTS (SELECT 1 ${live}
                        AND ei.source_table = '${table}' AND ei.source_row_id = ${rowIdExpr})`;
  if (hashExpr) {
    // The same photo re-submitted is a different stool_logs row with the same hash.
    sql += `
      AND (${hashExpr} IS NULL OR NOT EXISTS (SELECT 1 ${live} AND ei.image_hash = ${hashExpr}))`;
  }
  return sql;
}

/** One row per eligible photo: (row_id, bristol 1–7, person_ref, image_hash). */
function candidatesSql(f: SampleFilters, p: Params): string {
  if (f.source === "stool_logs") {
    const orgs = f.includeWebDemo ? [APP_ORG_ID, WEB_DEMO_ORG_ID] : [APP_ORG_ID];
    const minors = f.includeMinors
      ? ""
      : `AND (s.profile_snapshot->>'age') IS DISTINCT FROM 'Under 18'
         AND (i.profile_data->>'age') IS DISTINCT FROM 'Under 18'`;
    // DISTINCT ON keeps the first submission of each photo (by image hash).
    return `
      SELECT DISTINCT ON (COALESCE(s.image_hash, s.id::text))
             s.id::text AS row_id,
             substring(s.bristol_type FROM '[1-7]')::int AS bristol,
             CASE WHEN s.organization_id = ${p.add(APP_ORG_ID)} THEN i.external_individual_id END AS person_ref,
             s.image_hash
        FROM softai.stool_logs s
        JOIN softai.individuals i ON i.id = s.individual_id
       WHERE s.s3_image_key IS NOT NULL
         AND s.organization_id = ANY(${p.add(orgs)}::int[])
         AND substring(s.bristol_type FROM '[1-7]') IS NOT NULL
         ${minors}
         ${notAlreadySent(f, p, "softai.stool_logs", "s.id::text", "s.image_hash")}
       ORDER BY COALESCE(s.image_hash, s.id::text), s.created_at`;
  }

  const review =
    f.source === "ready_to_train"
      ? "AND p.image_good_for_ml = true" // = app.readyToTrainView's definition
      : f.includeRejected
        ? ""
        : "AND p.image_good_for_ml IS NOT FALSE";
  const minors = f.includeMinors ? "" : `AND (i.profile_data->>'age') IS DISTINCT FROM 'Under 18'`;
  return `
      SELECT p.id AS row_id,
             p.bristol_type::int AS bristol,
             p.user_id AS person_ref,
             NULL::text AS image_hash
        FROM app.poop p
        LEFT JOIN softai.individuals i
               ON i.organization_id = ${p.add(APP_ORG_ID)} AND i.external_individual_id = p.user_id
       WHERE p.s3_key IS NOT NULL
         AND p.bristol_type BETWEEN 1 AND 7
         ${review}
         ${minors}
         ${notAlreadySent(f, p, "app.poop", "p.id", null)}`;
}

/** Eligible photos per Bristol type, after every filter and exclusion. */
export async function countAvailable(f: SampleFilters): Promise<Map<number, number>> {
  const p = new Params();
  const sql = `WITH c AS (${candidatesSql(f, p)})
               SELECT bristol, count(*)::int AS n FROM c GROUP BY bristol`;
  const { rows } = await executeQueryWithRetry(pool, sql, p.values);
  return new Map(rows.map((r: { bristol: number; n: number }) => [r.bristol, r.n]));
}

/** One random eligible photo — for the live JSON preview. */
export async function pickRandomCandidate(f: SampleFilters): Promise<Candidate | null> {
  const p = new Params();
  const sql = `WITH c AS (${candidatesSql(f, p)}) SELECT * FROM c ORDER BY random() LIMIT 1`;
  const { rows } = await executeQueryWithRetry(pool, sql, p.values);
  return rows[0] ?? null;
}

/** Uniform random sample with a quota per Bristol type. */
export async function sampleCandidates(
  client: PoolClient,
  f: SampleFilters,
  quotas: Map<number, number>,
): Promise<Candidate[]> {
  const p = new Params();
  const types = [...quotas.keys()];
  const sql = `
    WITH c AS (${candidatesSql(f, p)}),
    r AS (SELECT c.*, row_number() OVER (PARTITION BY c.bristol ORDER BY random()) AS rn FROM c)
    SELECT r.row_id, r.bristol, r.person_ref, r.image_hash
      FROM r
      JOIN unnest(${p.add(types)}::int[], ${p.add(types.map((t) => quotas.get(t)))}::int[]) AS q(bristol, n)
        ON q.bristol = r.bristol
     WHERE r.rn <= q.n`;
  const { rows } = await client.query<Candidate>(sql, p.values);
  return rows;
}

// ------------------------------------------------------- rows for the zip

/**
 * Full rows for a batch of sampled ids, normalised for the field extractors:
 * `profile_json` (stool_logs: snapshot at log time; app.poop: the user's
 * current SoftAI profile), `person_ref`, and `image_key`.
 */
export async function fetchRows(
  table: SourceTable,
  ids: string[],
  withModelVotes: boolean,
): Promise<Map<string, Record<string, unknown>>> {
  const sql =
    table === "softai.stool_logs"
      ? `SELECT s.id::text AS id, s.s3_image_key AS image_key, s.created_at, s.timezone,
                s.bristol_type, s.consistency, s.shape, s.quantity, s.color, s.health,
                s.blood, s.mucus, s.floating,
                s.bristol_type_confidence, s.consistency_confidence, s.shape_confidence,
                s.quantity_confidence, s.color_confidence, s.health_confidence,
                s.blood_confidence, s.mucus_confidence, s.floating_confidence,
                s.sleep, s.stress, s.caffeine, s.toilet_time, s.frequency, s.last_meal,
                s.food_groups, s.smell_level, s.duration_minutes, s.water_glasses,
                s.app_payload->>'discomfortLevel' AS discomfort,
                s.profile_snapshot AS profile_json,
                ${withModelVotes ? "s.ensemble_metadata->'perModel'" : "NULL::jsonb"} AS model_votes_json,
                CASE WHEN s.organization_id = $1 THEN i.external_individual_id END AS person_ref
           FROM softai.stool_logs s
           JOIN softai.individuals i ON i.id = s.individual_id
          WHERE s.id = ANY($2::uuid[])`
      : `SELECT p.*, p.s3_key AS image_key, p.user_id AS person_ref, i.profile_data AS profile_json
           FROM app.poop p
           LEFT JOIN softai.individuals i
                  ON i.organization_id = $1 AND i.external_individual_id = p.user_id
          WHERE p.id = ANY($2::varchar[])`;
  const { rows } = await executeQueryWithRetry(pool, sql, [APP_ORG_ID, ids]);
  return new Map(rows.map((r: Record<string, unknown>) => [String(r.id), r]));
}

// ------------------------------------------------------------------ buyers

export interface BuyerSummary {
  id: number;
  name: string;
  notes: string | null;
  created_at: Date;
  next_sample_seq: number;
  export_count: number;
  delivered_samples: number;
  last_export_at: Date | null;
}

export async function listBuyers(): Promise<BuyerSummary[]> {
  const { rows } = await executeQueryWithRetry(
    pool,
    `SELECT b.id, b.name, b.notes, b.created_at, b.next_sample_seq,
            count(e.id) FILTER (WHERE e.status <> 'voided')::int AS export_count,
            COALESCE(sum(e.delivered_count) FILTER (WHERE e.status = 'delivered'), 0)::int AS delivered_samples,
            max(e.created_at) FILTER (WHERE e.status <> 'voided') AS last_export_at
       FROM datasales.buyers b
       LEFT JOIN datasales.exports e ON e.buyer_id = b.id
      GROUP BY b.id
      ORDER BY lower(b.name)`,
  );
  return rows;
}

export async function createBuyer(name: string, notes: string | null): Promise<BuyerSummary> {
  const { rows } = await pool.query(
    `INSERT INTO datasales.buyers (name, notes, pseudonym_key)
     VALUES ($1, $2, $3)
     RETURNING id, name, notes, created_at, next_sample_seq,
               0 AS export_count, 0 AS delivered_samples, NULL::timestamptz AS last_export_at`,
    // Per-buyer HMAC key: user pseudonyms are stable across this buyer's
    // deliveries but cannot be matched against another buyer's.
    [name, notes, randomBytes(32)],
  );
  return rows[0];
}

// ----------------------------------------------------------------- exports

export type ExportStatus = "prepared" | "delivered" | "voided";

export interface ExportSummary {
  id: string;
  buyer_id: number;
  source: SourceKey;
  config: Record<string, unknown>;
  requested_count: number;
  prepared_count: number;
  delivered_count: number | null;
  status: ExportStatus;
  created_by: string | null;
  created_at: Date;
  delivered_at: Date | null;
  voided_at: Date | null;
  per_type: Record<string, number> | null;
}

const EXPORT_COLUMNS = `
  e.id, e.buyer_id, e.source, e.config, e.requested_count, e.prepared_count,
  e.delivered_count, e.status, e.created_by, e.created_at, e.delivered_at, e.voided_at,
  (SELECT json_object_agg(t.bristol_type, t.n)
     FROM (SELECT bristol_type, count(*)::int AS n
             FROM datasales.export_items
            WHERE export_id = e.id AND NOT failed
            GROUP BY bristol_type) t) AS per_type`;

export async function listExports(buyerId: number): Promise<ExportSummary[]> {
  const { rows } = await executeQueryWithRetry(
    pool,
    `SELECT ${EXPORT_COLUMNS} FROM datasales.exports e
      WHERE e.buyer_id = $1 ORDER BY e.created_at DESC LIMIT 200`,
    [buyerId],
  );
  return rows;
}

export async function getExport(exportId: string): Promise<ExportSummary | null> {
  const { rows } = await executeQueryWithRetry(
    pool,
    `SELECT ${EXPORT_COLUMNS} FROM datasales.exports e WHERE e.id = $1`,
    [exportId],
  );
  return rows[0] ?? null;
}

export interface NewExport {
  buyerId: number;
  source: SourceKey;
  config: Record<string, unknown>;
  requested: number;
  createdBy: string | null;
}

/**
 * Locks the buyer, samples, reserves sample numbers and records every item —
 * all in one transaction, so two exports for the same buyer can never pick
 * the same photo.
 */
export async function createExport(
  input: NewExport,
  filters: SampleFilters,
  quotas: Map<number, number>,
  shuffle: <T>(items: T[]) => T[],
): Promise<{ export: ExportSummary; items: number } | { error: "buyer_not_found" | "nothing_available" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const buyer = await client.query<{ next_sample_seq: number }>(
      `SELECT next_sample_seq FROM datasales.buyers WHERE id = $1 FOR UPDATE`,
      [input.buyerId],
    );
    const start = buyer.rows[0]?.next_sample_seq;
    if (start === undefined) {
      await client.query("ROLLBACK");
      return { error: "buyer_not_found" };
    }

    const picked = shuffle(await sampleCandidates(client, filters, quotas));
    if (picked.length === 0) {
      await client.query("ROLLBACK");
      return { error: "nothing_available" };
    }

    await client.query(
      `UPDATE datasales.buyers SET next_sample_seq = next_sample_seq + $2 WHERE id = $1`,
      [input.buyerId, picked.length],
    );
    const created = await client.query<{ id: string }>(
      `INSERT INTO datasales.exports (buyer_id, source, config, requested_count, prepared_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.buyerId, input.source, input.config, input.requested, picked.length, input.createdBy],
    );
    const exportId = created.rows[0]!.id;

    const table = sourceTable(input.source);
    const CHUNK = 5_000;
    for (let offset = 0; offset < picked.length; offset += CHUNK) {
      const chunk = picked.slice(offset, offset + CHUNK);
      const seqs = chunk.map((_, k) => offset + k + 1);
      await client.query(
        `INSERT INTO datasales.export_items
           (export_id, seq, sample_id, source_table, source_row_id, image_hash, person_ref, bristol_type)
         SELECT $1, t.seq, t.sample_id, $2, t.row_id, t.image_hash, t.person_ref, t.bristol
           FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::smallint[])
                AS t(seq, sample_id, row_id, image_hash, person_ref, bristol)`,
        [
          exportId,
          table,
          seqs,
          seqs.map((s) => formatSampleId(start + s - 1)),
          chunk.map((c) => c.row_id),
          chunk.map((c) => c.image_hash),
          chunk.map((c) => c.person_ref),
          chunk.map((c) => c.bristol),
        ],
      );
    }

    await client.query("COMMIT");
    const exp = await getExport(exportId);
    return { export: exp!, items: picked.length };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Unique per buyer across all deliveries: month 2 continues where month 1 ended. */
export function formatSampleId(n: number): string {
  return `sample_${String(n).padStart(6, "0")}`;
}

export interface ExportItem {
  seq: number;
  sample_id: string;
  source_row_id: string;
  person_ref: string | null;
  bristol_type: number;
}

export interface DownloadBundle {
  export: ExportSummary;
  buyer: { id: number; name: string; pseudonym_key: Buffer };
  items: ExportItem[];
}

export async function getDownloadBundle(exportId: string): Promise<DownloadBundle | null> {
  const exp = await getExport(exportId);
  if (!exp) return null;
  const [buyer, items] = await Promise.all([
    executeQueryWithRetry(
      pool,
      `SELECT id, name, pseudonym_key FROM datasales.buyers WHERE id = $1`,
      [exp.buyer_id],
    ),
    executeQueryWithRetry(
      pool,
      `SELECT seq, sample_id, source_row_id, person_ref, bristol_type
         FROM datasales.export_items
        WHERE export_id = $1 AND NOT failed
        ORDER BY seq`,
      [exportId],
    ),
  ]);
  if (!buyer.rows[0]) return null;
  return { export: exp, buyer: buyer.rows[0], items: items.rows };
}

/** First complete download flips prepared → delivered; failed photos stop counting as sent. */
export async function recordDelivery(
  exportId: string,
  deliveredCount: number,
  failedSeqs: number[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (failedSeqs.length > 0) {
      await client.query(
        `UPDATE datasales.export_items SET failed = true WHERE export_id = $1 AND seq = ANY($2::int[])`,
        [exportId, failedSeqs],
      );
    }
    await client.query(
      `UPDATE datasales.exports
          SET status = CASE WHEN status = 'prepared' THEN 'delivered' ELSE status END,
              delivered_count = $2,
              delivered_at = COALESCE(delivered_at, now())
        WHERE id = $1`,
      [exportId, deliveredCount],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Voided exports release their photos for future deliveries. */
export async function voidExport(exportId: string): Promise<ExportSummary | null> {
  const { rowCount } = await pool.query(
    `UPDATE datasales.exports SET status = 'voided', voided_at = now()
      WHERE id = $1 AND status <> 'voided'`,
    [exportId],
  );
  return rowCount ? getExport(exportId) : null;
}

export interface PersonDelivery {
  buyer_id: number;
  buyer_name: string;
  export_id: string;
  status: ExportStatus;
  created_at: Date;
  samples: number;
}

/** Which buyers received a person's photos — for deletion / access requests. */
export async function findDeliveriesForPerson(personRef: string): Promise<PersonDelivery[]> {
  const { rows } = await executeQueryWithRetry(
    pool,
    `SELECT b.id AS buyer_id, b.name AS buyer_name, e.id AS export_id, e.status, e.created_at,
            count(*)::int AS samples
       FROM datasales.export_items ei
       JOIN datasales.exports e ON e.id = ei.export_id
       JOIN datasales.buyers b ON b.id = e.buyer_id
      WHERE ei.person_ref = $1 AND NOT ei.failed
      GROUP BY b.id, b.name, e.id
      ORDER BY e.created_at DESC`,
    [personRef],
  );
  return rows;
}
