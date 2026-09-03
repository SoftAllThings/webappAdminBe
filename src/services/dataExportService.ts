import { PassThrough } from "stream";
import type { Archiver } from "archiver";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { pool } from "../config/database";

/**
 * Bulk CSV export for offline analysis.
 *
 * Design notes:
 * - Everything streams. stool_logs over a wide range can be large, so no
 *   dataset is ever fully materialised in memory.
 * - Identifying columns are EXCLUDED BY DEFAULT and gated behind explicit
 *   flags. The output is meant to be handed to an LLM, so the default posture
 *   is pseudonymous: UUIDs that still join across tables, no emails, no image
 *   keys, no free-form JSON blobs.
 * - Every export ships a README.md data dictionary. A bare CSV column called
 *   `churned_subs` reads as "subscribers who churned"; it isn't, and the
 *   reader has no way to know that without the dictionary.
 */

export type ExportOptions = {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  datasets: string[];
  includeEmails: boolean;
  includeRawPayloads: boolean;
};

export type DatasetResult = { key: string; rows: number; truncated: boolean };

/** Hard ceiling per dataset. Prevents an accidental full-table dump. */
const MAX_ROWS_PER_DATASET = 500_000;
const FIRESTORE_PAGE = 2_000;
const PG_PAGE = 5_000;

// ---------------------------------------------------------------- CSV helpers

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (value instanceof Timestamp) s = value.toDate().toISOString();
  else if (Array.isArray(value)) s = value.join("|");
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  // Excel/Sheets treat a leading =, +, - or @ as a formula. Neutralise.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

class CsvSink {
  readonly stream = new PassThrough();
  private count = 0;

  constructor(header: string[]) {
    this.stream.write(header.map(escapeCsv).join(",") + "\n");
  }

  /** Returns false once the row cap is hit. */
  write(row: unknown[]): boolean {
    if (this.count >= MAX_ROWS_PER_DATASET) return false;
    this.count += 1;
    return this.stream.write(row.map(escapeCsv).join(",") + "\n") || true;
  }

  end(): number {
    this.stream.end();
    return this.count;
  }

  get rows(): number {
    return this.count;
  }
}

/** Flatten a nested object into dotted keys, for metric_snapshots. */
function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    out[prefix] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Timestamp)) {
      flatten(v, key, out);
    } else {
      out[key] = v instanceof Timestamp ? v.toDate().toISOString() : v;
    }
  }
  return out;
}

/** Normalise a mixed-type Firestore date field to YYYY-MM-DD, or "" if absent. */
function normaliseDay(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Timestamp) return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  }
  return "";
}

function dayBounds(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(`${from}T00:00:00.000Z`),
    // `to` is inclusive, so run to the last instant of that UTC day.
    end: new Date(`${to}T23:59:59.999Z`),
  };
}

// Fixed, documented column set. Keeping this explicit (rather than deriving
// the union of keys across documents) means the CSV schema is stable between
// exports even when a nightly run writes a partial document.
const SNAPSHOT_PATHS = [
  "user.dau", "user.wau", "user.mau", "user.newSignups", "user.totalUsers",
  "engagement.poopsLogged", "engagement.activeLoggers",
  "engagement.retentionD1", "engagement.retentionD7", "engagement.retentionD30",
  "revenue.activeSubs", "revenue.mrr", "revenue.arr", "revenue.arpu",
  "revenue.newSubs", "revenue.churnedSubs", "revenue.churnRate",
  "revenue.trialsStarted", "revenue.trialsConverted", "revenue.trialConversionRate",
  "revenue.byStore.ios", "revenue.byStore.android", "revenue.byStore.stripe",
] as const;


/** Shapes returned by the two Postgres queries below. Declared explicitly so
 *  the keyset cursor does not create circular type inference. */
type IndividualRow = {
  id: string;
  organization_id: number;
  created_at: Date;
  updated_at: Date | null;
  timezone: string | null;
  profile_data: Record<string, unknown> | null;
};

type StoolLogRow = Record<string, unknown> & {
  id: string;
  individual_id: string;
  organization_id: number;
  created_at: Date;
};

// ------------------------------------------------------------------ datasets

type Dataset = {
  key: string;
  label: string;
  file: string;
  source: "firestore" | "postgres";
  description: string;
  run(sink: CsvSink, opts: ExportOptions): Promise<void>;
  header(opts: ExportOptions): string[];
};

const DATASETS: Dataset[] = [
  {
    key: "users",
    label: "PoopCheck users",
    file: "users.csv",
    source: "firestore",
    description:
      "One row per registered PoopCheck consumer account, filtered by signup date.",
    header: (o) => [
      "uid",
      ...(o.includeEmails ? ["email"] : []),
      "created_at_date",
      "premium",
      "subscription_status",
      "product_id",
      "store",
      "premium_source",
    ],
    async run(sink, opts) {
      // `createdAt` is MIXED TYPE — a string on some documents and a Timestamp
      // on others (see userExportService.formatCreatedAtDate). Firestore orders
      // by type before value, so an orderBy("createdAt") range query silently
      // returns only the Timestamp-typed subset and drops every string-dated
      // user. Paginate by document id instead and filter on a normalised date,
      // so the result is complete regardless of how the field was written.
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      for (;;) {
        let q = db.collection("users").orderBy("__name__").limit(FIRESTORE_PAGE);
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.get();
        if (snap.empty) break;
        for (const doc of snap.docs) {
          const d = doc.data();
          const day = normaliseDay(d.createdAt);
          if (!day || day < opts.from || day > opts.to) continue;
          const sub = (d.subscription ?? {}) as Record<string, unknown>;
          const ok = sink.write([
            doc.id,
            ...(opts.includeEmails ? [d.email ?? ""] : []),
            day,
            d.premium ?? "",
            d.subscriptionStatus ?? "",
            sub.productId ?? "",
            sub.store ?? "",
            d.premiumSource ?? "",
          ]);
          if (!ok) return;
        }
        cursor = snap.docs[snap.docs.length - 1] ?? null;
        if (snap.size < FIRESTORE_PAGE) break;
      }
    },
  },

  {
    key: "metric_snapshots",
    label: "Daily metric snapshots",
    file: "metric_snapshots.csv",
    source: "firestore",
    description:
      "One row per UTC day, written nightly for D-2. Columns are a fixed, documented set of dotted metric paths; anything else in the document lands in extra_json.",
    header: () => ["date", ...SNAPSHOT_PATHS, "extra_json"],
    async run(sink, opts) {
      // Doc ids are YYYY-MM-DD so a lexicographic range IS a date range.
      const snap = await db
        .collection("metric_snapshots")
        .orderBy("__name__")
        .startAt(opts.from)
        .endAt(opts.to)
        .get();
      for (const doc of snap.docs) {
        const flat = flatten(doc.data());
        const known = new Set<string>(SNAPSHOT_PATHS);
        const extra: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(flat)) {
          if (!known.has(k) && k !== "date" && k !== "computedAt") extra[k] = v;
        }
        const row: unknown[] = [doc.id];
        for (const path of SNAPSHOT_PATHS) row.push(flat[path as string] ?? "");
        row.push(Object.keys(extra).length ? JSON.stringify(extra) : "");
        if (!sink.write(row)) return;
      }
    },
  },

  {
    key: "revenuecat_events",
    label: "RevenueCat webhook events",
    file: "revenuecat_events.csv",
    source: "firestore",
    description:
      "Raw subscription lifecycle events. One row per webhook row, NOT per user.",
    header: () => [
      "event_id",
      "event_type",
      "app_user_id",
      "received_at",
      "status",
    ],
    async run(sink, opts) {
      const { start, end } = dayBounds(opts.from, opts.to);
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      for (;;) {
        let q = db
          .collection("revenueCatWebhookEvents")
          .orderBy("receivedAt")
          .startAt(start)
          .endAt(end)
          .limit(FIRESTORE_PAGE);
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.get();
        if (snap.empty) break;
        for (const doc of snap.docs) {
          const d = doc.data();
          if (
            !sink.write([
              d.eventId ?? doc.id,
              d.eventType ?? "",
              d.appUserId ?? "",
              d.receivedAt,
              d.status ?? "",
            ])
          )
            return;
        }
        cursor = snap.docs[snap.docs.length - 1] ?? null;
        if (snap.size < FIRESTORE_PAGE) break;
      }
    },
  },

  {
    key: "softai_individuals",
    label: "SoftAI individuals (B2B)",
    file: "softai_individuals.csv",
    source: "postgres",
    description:
      "One row per individual known to the SoftAI B2B engine. Pseudonymous: the UUID joins to stool_logs, but external_individual_id (often a customer's own user id) is never exported.",
    header: (o) => [
      "individual_id",
      "organization_id",
      "created_at",
      "updated_at",
      "timezone",
      "profile_keys",
      ...(o.includeRawPayloads ? ["profile_data_json"] : []),
    ],
    async run(sink, opts) {
      const { start, end } = dayBounds(opts.from, opts.to);
      let lastCreated: Date | null = null;
      let lastId: string = "";
      for (;;) {
        const params: Array<Date | string | null> = [
          start,
          end,
          lastCreated,
          lastId || null,
        ];
        const { rows } = await pool.query<IndividualRow>(
          `SELECT id, organization_id, created_at, updated_at, timezone, profile_data
             FROM softai.individuals
            WHERE created_at >= $1 AND created_at <= $2
              AND ($3::timestamptz IS NULL OR (created_at, id) > ($3::timestamptz, $4::uuid))
            ORDER BY created_at, id
            LIMIT ${PG_PAGE}`,
          params,
        );
        if (rows.length === 0) break;
        for (const r of rows) {
          const profile = (r.profile_data ?? {}) as Record<string, unknown>;
          const ok = sink.write([
            r.id,
            r.organization_id,
            r.created_at,
            r.updated_at,
            r.timezone ?? "",
            Object.keys(profile).sort().join("|"),
            ...(opts.includeRawPayloads ? [profile] : []),
          ]);
          if (!ok) return;
        }
        const last = rows[rows.length - 1];
        if (!last) break;
        lastCreated = last.created_at;
        lastId = last.id;
        if (rows.length < PG_PAGE) break;
      }
    },
  },

  {
    key: "softai_stool_logs",
    label: "SoftAI stool logs (B2B, row level)",
    file: "softai_stool_logs.csv",
    source: "postgres",
    description:
      "One row per logged stool sample. HEALTH DATA. Joins to softai_individuals on individual_id. Image keys and raw payloads are excluded unless explicitly requested.",
    header: (o) => [
      "log_id",
      "individual_id",
      "organization_id",
      "created_at",
      "bristol_type", "bristol_type_confidence",
      "health", "health_confidence",
      "color", "color_confidence",
      "consistency", "consistency_confidence",
      "shape", "shape_confidence",
      "quantity", "quantity_confidence",
      "blood", "blood_confidence",
      "mucus", "mucus_confidence",
      "floating", "floating_confidence",
      "sleep", "stress", "diet", "caffeine", "toilet_time", "frequency",
      "last_meal", "food_groups",
      "smell_level", "pain_level", "duration_minutes", "water_glasses",
      "has_image",
      ...(o.includeRawPayloads ? ["app_payload_json", "profile_snapshot_json"] : []),
    ],
    async run(sink, opts) {
      const { start, end } = dayBounds(opts.from, opts.to);
      let lastCreated: Date | null = null;
      let lastId: string = "";
      for (;;) {
        const params: Array<Date | string | null> = [
          start,
          end,
          lastCreated,
          lastId || null,
        ];
        const { rows } = await pool.query<StoolLogRow>(
          `SELECT id, individual_id, organization_id, created_at,
                  bristol_type, bristol_type_confidence,
                  health, health_confidence,
                  color, color_confidence,
                  consistency, consistency_confidence,
                  shape, shape_confidence,
                  quantity, quantity_confidence,
                  blood, blood_confidence,
                  mucus, mucus_confidence,
                  floating, floating_confidence,
                  sleep, stress, diet, caffeine, toilet_time, frequency,
                  last_meal, food_groups,
                  smell_level, pain_level, duration_minutes, water_glasses,
                  (s3_image_key IS NOT NULL) AS has_image,
                  app_payload, profile_snapshot
             FROM softai.stool_logs
            WHERE created_at >= $1 AND created_at <= $2
              AND ($3::timestamptz IS NULL OR (created_at, id) > ($3::timestamptz, $4::uuid))
            ORDER BY created_at, id
            LIMIT ${PG_PAGE}`,
          params,
        );
        if (rows.length === 0) break;
        for (const r of rows) {
          const ok = sink.write([
            r.id, r.individual_id, r.organization_id, r.created_at,
            r.bristol_type, r.bristol_type_confidence,
            r.health, r.health_confidence,
            r.color, r.color_confidence,
            r.consistency, r.consistency_confidence,
            r.shape, r.shape_confidence,
            r.quantity, r.quantity_confidence,
            r.blood, r.blood_confidence,
            r.mucus, r.mucus_confidence,
            r.floating, r.floating_confidence,
            r.sleep, r.stress, r.diet, r.caffeine, r.toilet_time, r.frequency,
            r.last_meal, r.food_groups,
            r.smell_level, r.pain_level, r.duration_minutes, r.water_glasses,
            r.has_image,
            ...(opts.includeRawPayloads ? [r.app_payload, r.profile_snapshot] : []),
          ]);
          if (!ok) return;
        }
        const last = rows[rows.length - 1];
        if (!last) break;
        lastCreated = last.created_at;
        lastId = last.id;
        if (rows.length < PG_PAGE) break;
      }
    },
  },
];

export { DATASETS, CsvSink, escapeCsv, MAX_ROWS_PER_DATASET, dayBounds, PG_PAGE };

// ------------------------------------------------------- README / manifest

/**
 * The data dictionary is the point of this export.
 *
 * A CSV column named `churned_subs` reads as "subscribers who churned". It
 * isn't — it counts both the CANCELLATION and the EXPIRATION of the same
 * person. Anyone (or any model) analysing the raw file has no way to know
 * that. Every trap below exists because the number is misleading without it.
 */
function buildReadme(opts: ExportOptions, results: DatasetResult[]): string {
  const included = new Set(opts.datasets);
  const inc = (k: string) => included.has(k);

  return `# PoopCheck / SoftAI data export

Range: **${opts.from} .. ${opts.to}** (UTC, inclusive both ends)
Generated: ${new Date().toISOString()}

Read this file before analysing anything here. Several columns do not mean
what their names suggest, and in this data **0 usually means "not collected"
rather than "the quantity was zero"**.

## Files

${results.map((r) => `- \`${DATASETS.find((d) => d.key === r.key)?.file}\` — ${r.rows.toLocaleString()} rows${r.truncated ? " **(TRUNCATED at the row cap — incomplete)**" : ""}`).join("\n")}

## Two separate worlds — do not join them

This archive contains data from two unrelated products:

- **PoopCheck** (\`users.csv\`, \`metric_snapshots.csv\`, \`revenuecat_events.csv\`)
  — the consumer iOS/Android app. Keyed on Firebase uid.
- **SoftAI** (\`softai_*.csv\`) — the B2B API product. Keyed on its own UUIDs,
  scoped by \`organization_id\`.

**There is no join key between them.** A PoopCheck user and a SoftAI
individual are different entities. Do not merge, correlate, or compute a
figure that spans both files.

Within SoftAI, \`softai_stool_logs.individual_id\` joins to
\`softai_individuals.individual_id\`. Always group by \`organization_id\` —
these are different paying customers and a blended total is meaningless.
${
  inc("metric_snapshots")
    ? `
## metric_snapshots.csv — traps

One row per UTC day. Written nightly at 22:00 UTC **for D-2**, so the two most
recent days are structurally absent. A missing row is a missing snapshot, not
a zero day.

| Column | What it actually is |
|---|---|
| \`revenue.churnedSubs\` | Counts **both** CANCELLATION and EXPIRATION for the same user, and includes trial abandonment. Over-counts real churners by up to 2x, by a non-constant factor. **Never report as "subscribers lost".** |
| \`revenue.churnRate\` | A **per-day** fraction, not a period rate. Never sum it across days; compound as 1-(1-r)^n. |
| \`revenue.arpu\` | Actually ARPPU — mrr / activeSubs. activeSubs includes trialing and billing_issue users paying nothing. |
| \`revenue.byStore.*\` | **Subscriber head counts, not money.** There is no MRR-by-store metric anywhere. |
| \`revenue.trialsStarted\` / \`trialsConverted\` / \`trialConversionRate\` | Structurally **always 0** — not instrumented. Never report as a business result. |
| \`revenue.mrr\` | Reconstructed from webhook prices treated as USD (currency is never read), inflated by trialing users, and flat-assumed for subscribers predating 2026-04-13. |
| \`engagement.retentionD1/D7/D30\` | 0 means EITHER nobody returned OR nobody signed up that day. Daily cohorts are tiny (~7/day) — near noise. |
| \`user.totalUsers\` | A **live** Firebase Auth count stamped into every backfilled row, so the series is flat-then-jump, not a growth curve. |
`
    : ""
}${
    inc("revenuecat_events")
      ? `
## revenuecat_events.csv — traps

**One row per webhook event, not per user.** One person generates many rows.
Count \`DISTINCT app_user_id\` when you mean people.

- There is **no REFUND event type**. A refund appears as a CANCELLATION.
- There is no TRIAL_STARTED / TRIAL_CONVERTED — trials are \`period_type: TRIAL\`
  on INITIAL_PURCHASE, which is not exported.
- Rows with \`status\` other than \`processed\` were never applied — filter them
  out or your totals include work that failed.
- CANCELLATION = auto-renew turned off (access usually continues).
  EXPIRATION = access actually lost. They are different questions.
`
      : ""
  }${
    inc("users")
      ? `
## users.csv — traps

\`subscription_status\` is exactly one of: \`active\`, \`trialing\`,
\`grace_period\`, \`billing_issue\`, \`canceled\` (single l), \`paused\`,
\`expired\`, \`refunded\`, \`unknown\`. **There is no \`in_trial\`** — trial
users are \`trialing\`.

\`premium\` can be true while \`subscription_status\` is \`expired\` — users
granted premium via legacy IAP or manually are not recalculated. Say which
definition you used.
${opts.includeEmails ? "\n**This export includes email addresses.**\n" : "\nEmail addresses are excluded from this export.\n"}`
      : ""
  }${
    inc("softai_stool_logs") || inc("softai_individuals")
      ? `
## softai_*.csv — traps

**This is health data.** Row-level clinical observations about identifiable
individuals (pseudonymous UUIDs, but stable across the file).

- Label columns (\`bristol_type\`, \`health\`, \`color\`, \`blood\`, \`mucus\`, ...)
  are **nullable VARCHARs with no database constraint**. Case variants and
  legacy values exist — \`'None'\` and \`'none'\` are different strings. Normalise
  with \`lower(trim(x))\` before grouping, and check for values outside the
  expected set before trusting any rate.
- A NULL label means the model did not produce one, **not** a negative finding.
  Report the recorded denominator alongside any percentage.
- \`*_confidence\` columns are model confidences (0..1), not clinical certainty.
- \`has_image\` is a boolean; the underlying S3 key is deliberately not exported.
- \`food_groups\` is a Postgres array, flattened here as \`|\`-separated values.
- Always group by \`organization_id\`. Blending customers produces a number
  that describes nobody.
${opts.includeRawPayloads ? "\n**This export includes raw JSON payloads** (app_payload, profile_snapshot, profile_data), which may contain arbitrary customer-supplied fields including personal details.\n" : "\nRaw JSON payloads (app_payload, profile_snapshot, profile_data) are excluded.\n"}`
      : ""
  }
## Analysing this

Prefer computing with code over reading values by eye — the whole reason this
is a CSV is that arithmetic over it can be exact. State the denominator with
every rate, and say "no data" rather than 0 when a file has no rows for a
window.
`;
}

function buildManifest(opts: ExportOptions, results: DatasetResult[]) {
  return {
    generatedAt: new Date().toISOString(),
    range: { from: opts.from, to: opts.to, timezone: "UTC", inclusive: "both" },
    options: {
      includeEmails: opts.includeEmails,
      includeRawPayloads: opts.includeRawPayloads,
    },
    rowCapPerDataset: MAX_ROWS_PER_DATASET,
    datasets: results.map((r) => ({
      key: r.key,
      file: DATASETS.find((d) => d.key === r.key)?.file,
      source: DATASETS.find((d) => d.key === r.key)?.source,
      rows: r.rows,
      truncated: r.truncated,
    })),
  };
}

// ------------------------------------------------------------ orchestration

/** Streams every requested dataset into `archive`, then README + manifest. */
export async function streamExportZip(
  archive: Archiver,
  opts: ExportOptions,
): Promise<DatasetResult[]> {
  const results: DatasetResult[] = [];

  for (const key of opts.datasets) {
    const ds = DATASETS.find((d) => d.key === key);
    if (!ds) continue;

    const sink = new CsvSink(ds.header(opts));
    archive.append(sink.stream, { name: ds.file });

    try {
      await ds.run(sink, opts);
    } catch (err) {
      // Surface the failure inside the archive rather than aborting the whole
      // export — a broken BigQuery credential should not lose the other files.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[export] dataset ${key} failed:`, err);
      sink.write([`ERROR: ${message}`]);
    }

    const rows = sink.end();
    results.push({ key, rows, truncated: rows >= MAX_ROWS_PER_DATASET });
  }

  archive.append(buildReadme(opts, results), { name: "README.md" });
  archive.append(JSON.stringify(buildManifest(opts, results), null, 2), {
    name: "manifest.json",
  });

  return results;
}

export function listDatasets() {
  return DATASETS.map((d) => ({
    key: d.key,
    label: d.label,
    file: d.file,
    source: d.source,
    description: d.description,
  }));
}
