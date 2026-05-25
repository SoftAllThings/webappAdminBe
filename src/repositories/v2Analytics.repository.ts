import { pool } from "../config/database";

// ---- Types ----

export interface IndividualRow {
  id: string;
  organization_id: number;
  external_individual_id: string;
  profile_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StoolLogRow {
  id: string;
  individual_id: string;
  organization_id: number;
  event_id: string | null;
  s3_image_key: string | null;
  bristol_type: string | null;
  bristol_type_confidence: number | null;
  health: string | null;
  color: string | null;
  consistency: string | null;
  shape: string | null;
  quantity: string | null;
  blood: string | null;
  mucus: string | null;
  floating: string | null;
  sleep: string | null;
  stress: string | null;
  diet: string | null;
  caffeine: string | null;
  toilet_time: string | null;
  frequency: string | null;
  last_meal: string | null;
  food_groups: string[] | null;
  smell_level: number | null;
  pain_level: number | null;
  duration_minutes: number | null;
  water_glasses: number | null;
  profile_snapshot: Record<string, unknown> | null;
  created_at: string;
}

export interface Paginated<T> {
  rows: T[];
  total: number;
}

export interface IndividualsFilters {
  organizationId: number | undefined;
  sex: string | undefined;
  diet: string | undefined;
  ageMin: number | undefined;
  ageMax: number | undefined;
  stressLevel: string | undefined;
  physicalActivityLevel: string | undefined;
  waterIntake: string | undefined;
  alcoholConsumption: string | undefined;
  medicalCondition: string | undefined;
  createdAfter: string | undefined;
  createdBefore: string | undefined;
  profileFilters: Record<string, string> | undefined;
  limit: number;
  offset: number;
  sortBy: "created_at" | "updated_at" | undefined;
  sortDir: "asc" | "desc" | undefined;
}

export interface StoolLogsFilters {
  organizationId: number | undefined;
  individualId: string | undefined;
  bristolType: string | undefined;
  health: string | undefined;
  color: string | undefined;
  consistency: string | undefined;
  shape: string | undefined;
  quantity: string | undefined;
  blood: string | undefined;
  mucus: string | undefined;
  floating: string | undefined;
  sleep: string | undefined;
  stress: string | undefined;
  diet: string | undefined;
  caffeine: string | undefined;
  toiletTime: string | undefined;
  frequency: string | undefined;
  foodGroup: string | undefined;
  painMin: number | undefined;
  painMax: number | undefined;
  smellMin: number | undefined;
  smellMax: number | undefined;
  durationMin: number | undefined;
  durationMax: number | undefined;
  waterMin: number | undefined;
  waterMax: number | undefined;
  createdAfter: string | undefined;
  createdBefore: string | undefined;
  profileSex: string | undefined;
  profileDiet: string | undefined;
  profileAgeMin: number | undefined;
  profileAgeMax: number | undefined;
  limit: number;
  offset: number;
  sortBy: "created_at" | undefined;
  sortDir: "asc" | "desc" | undefined;
}

// ---- Helpers ----

function pushFilter(
  params: any[],
  clauses: string[],
  clause: string,
  value: any
): void {
  params.push(value);
  clauses.push(clause.replace("?", `$${params.length}`));
}

function buildIndividualsWhere(
  f: IndividualsFilters
): { sql: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];

  if (f.organizationId !== undefined) {
    pushFilter(params, clauses, "organization_id = ?", f.organizationId);
  }
  if (f.sex) {
    pushFilter(
      params,
      clauses,
      "LOWER(profile_data->>'sex') = LOWER(?)",
      f.sex
    );
  }
  if (f.diet) {
    pushFilter(
      params,
      clauses,
      "LOWER(profile_data->>'diet') = LOWER(?)",
      f.diet
    );
  }
  if (f.ageMin !== undefined) {
    pushFilter(
      params,
      clauses,
      "(profile_data->>'age')::numeric >= ?",
      f.ageMin
    );
  }
  if (f.ageMax !== undefined) {
    pushFilter(
      params,
      clauses,
      "(profile_data->>'age')::numeric <= ?",
      f.ageMax
    );
  }
  if (f.stressLevel) {
    pushFilter(
      params,
      clauses,
      "LOWER(profile_data->>'stressLevel') = LOWER(?)",
      f.stressLevel
    );
  }
  if (f.physicalActivityLevel) {
    pushFilter(
      params,
      clauses,
      "LOWER(profile_data->>'physicalActivityLevel') = LOWER(?)",
      f.physicalActivityLevel
    );
  }
  if (f.waterIntake) {
    pushFilter(
      params,
      clauses,
      "LOWER(profile_data->>'waterIntake') = LOWER(?)",
      f.waterIntake
    );
  }
  if (f.alcoholConsumption) {
    pushFilter(
      params,
      clauses,
      "LOWER(profile_data->>'alcoholConsumption') = LOWER(?)",
      f.alcoholConsumption
    );
  }
  if (f.medicalCondition) {
    const pattern = `%${f.medicalCondition}%`;
    params.push(pattern, pattern);
    const p1 = params.length - 1;
    const p2 = params.length;
    clauses.push(
      `(profile_data->>'knownConditions' ILIKE $${p1} OR profile_data->>'medicalConditions' ILIKE $${p2})`
    );
  }
  if (f.createdAfter) {
    pushFilter(params, clauses, "created_at >= ?", f.createdAfter);
  }
  if (f.createdBefore) {
    pushFilter(params, clauses, "created_at <= ?", f.createdBefore);
  }
  if (f.profileFilters) {
    for (const [key, val] of Object.entries(f.profileFilters)) {
      if (!/^[A-Za-z0-9_]+$/.test(key)) continue; // safe key
      pushFilter(
        params,
        clauses,
        `LOWER(profile_data->>'${key}') = LOWER(?)`,
        val
      );
    }
  }

  const sql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { sql, params };
}

function buildStoolLogsWhere(f: StoolLogsFilters): {
  sql: string;
  params: any[];
} {
  const clauses: string[] = [];
  const params: any[] = [];

  const equals: Array<[string, string | undefined]> = [
    ["organization_id", f.organizationId as any],
    ["individual_id", f.individualId],
    ["bristol_type", f.bristolType],
    ["health", f.health],
    ["color", f.color],
    ["consistency", f.consistency],
    ["shape", f.shape],
    ["quantity", f.quantity],
    ["blood", f.blood],
    ["mucus", f.mucus],
    ["floating", f.floating],
    ["sleep", f.sleep],
    ["stress", f.stress],
    ["diet", f.diet],
    ["caffeine", f.caffeine],
    ["toilet_time", f.toiletTime],
    ["frequency", f.frequency],
  ];

  for (const [col, val] of equals) {
    if (val !== undefined && val !== null && val !== "") {
      pushFilter(params, clauses, `${col} = ?`, val);
    }
  }

  if (f.foodGroup) {
    pushFilter(params, clauses, "? = ANY(food_groups)", f.foodGroup);
  }

  const ranges: Array<[string, string, number | undefined]> = [
    ["pain_level", ">=", f.painMin],
    ["pain_level", "<=", f.painMax],
    ["smell_level", ">=", f.smellMin],
    ["smell_level", "<=", f.smellMax],
    ["duration_minutes", ">=", f.durationMin],
    ["duration_minutes", "<=", f.durationMax],
    ["water_glasses", ">=", f.waterMin],
    ["water_glasses", "<=", f.waterMax],
  ];
  for (const [col, op, val] of ranges) {
    if (val !== undefined && val !== null) {
      pushFilter(params, clauses, `${col} ${op} ?`, val);
    }
  }

  if (f.createdAfter) {
    pushFilter(params, clauses, "created_at >= ?", f.createdAfter);
  }
  if (f.createdBefore) {
    pushFilter(params, clauses, "created_at <= ?", f.createdBefore);
  }

  if (f.profileSex) {
    pushFilter(
      params,
      clauses,
      "LOWER(profile_snapshot->>'sex') = LOWER(?)",
      f.profileSex
    );
  }
  if (f.profileDiet) {
    pushFilter(
      params,
      clauses,
      "LOWER(profile_snapshot->>'diet') = LOWER(?)",
      f.profileDiet
    );
  }
  if (f.profileAgeMin !== undefined) {
    pushFilter(
      params,
      clauses,
      "(profile_snapshot->>'age')::numeric >= ?",
      f.profileAgeMin
    );
  }
  if (f.profileAgeMax !== undefined) {
    pushFilter(
      params,
      clauses,
      "(profile_snapshot->>'age')::numeric <= ?",
      f.profileAgeMax
    );
  }

  const sql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { sql, params };
}

// ---- Allowed group-by columns ----

const INDIVIDUAL_PROFILE_KEYS = [
  "sex",
  "diet",
  "age",
  "stressLevel",
  "physicalActivityLevel",
  "waterIntake",
  "alcoholConsumption",
  "weightUnit",
  "heightUnit",
  "gender",
  "knownConditions",
];

const STOOL_GROUPABLE_COLS = [
  "bristol_type",
  "health",
  "color",
  "consistency",
  "shape",
  "quantity",
  "blood",
  "mucus",
  "floating",
  "sleep",
  "stress",
  "diet",
  "caffeine",
  "toilet_time",
  "frequency",
  "organization_id",
];

// ---- Repository ----

export class V2AnalyticsRepository {
  async getOverview(): Promise<{
    individuals: number;
    stoolLogs: number;
    organizations: number;
    latestStoolLogAt: string | null;
    latestIndividualAt: string | null;
  }> {
    const [
      individualsRes,
      stoolLogsRes,
      orgsRes,
      latestLogRes,
      latestIndRes,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::bigint AS c FROM softai.individuals`),
      pool.query(`SELECT COUNT(*)::bigint AS c FROM softai.stool_logs`),
      pool.query(
        `SELECT COUNT(DISTINCT organization_id)::bigint AS c FROM softai.individuals`
      ),
      pool.query(
        `SELECT MAX(created_at) AS ts FROM softai.stool_logs`
      ),
      pool.query(
        `SELECT MAX(created_at) AS ts FROM softai.individuals`
      ),
    ]);

    return {
      individuals: parseInt(individualsRes.rows[0]?.c ?? "0"),
      stoolLogs: parseInt(stoolLogsRes.rows[0]?.c ?? "0"),
      organizations: parseInt(orgsRes.rows[0]?.c ?? "0"),
      latestStoolLogAt: latestLogRes.rows[0]?.ts ?? null,
      latestIndividualAt: latestIndRes.rows[0]?.ts ?? null,
    };
  }

  async listIndividuals(
    filters: IndividualsFilters
  ): Promise<Paginated<IndividualRow>> {
    const { sql, params } = buildIndividualsWhere(filters);
    const sortBy = filters.sortBy === "updated_at" ? "updated_at" : "created_at";
    const sortDir = filters.sortDir === "asc" ? "ASC" : "DESC";

    const countQuery = `SELECT COUNT(*)::bigint AS c FROM softai.individuals ${sql}`;
    const dataQuery = `
      SELECT id, organization_id, external_individual_id, profile_data,
             created_at, updated_at
      FROM softai.individuals
      ${sql}
      ORDER BY ${sortBy} ${sortDir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const [countRes, dataRes] = await Promise.all([
      pool.query(countQuery, params),
      pool.query(dataQuery, [...params, filters.limit, filters.offset]),
    ]);

    return {
      rows: dataRes.rows as IndividualRow[],
      total: parseInt(countRes.rows[0]?.c ?? "0"),
    };
  }

  async individualsAggregate(
    groupBy: string,
    filters: IndividualsFilters
  ): Promise<Array<{ bucket: string; count: number }>> {
    const { sql, params } = buildIndividualsWhere(filters);

    let groupExpr: string;
    if (groupBy === "age_bucket") {
      groupExpr = `CASE
        WHEN (profile_data->>'age')::numeric < 18 THEN '<18'
        WHEN (profile_data->>'age')::numeric BETWEEN 18 AND 24 THEN '18-24'
        WHEN (profile_data->>'age')::numeric BETWEEN 25 AND 34 THEN '25-34'
        WHEN (profile_data->>'age')::numeric BETWEEN 35 AND 44 THEN '35-44'
        WHEN (profile_data->>'age')::numeric BETWEEN 45 AND 54 THEN '45-54'
        WHEN (profile_data->>'age')::numeric BETWEEN 55 AND 64 THEN '55-64'
        WHEN (profile_data->>'age')::numeric >= 65 THEN '65+'
        ELSE 'unknown'
      END`;
    } else if (groupBy === "organization_id") {
      groupExpr = "organization_id::text";
    } else if (INDIVIDUAL_PROFILE_KEYS.includes(groupBy)) {
      groupExpr = `COALESCE(profile_data->>'${groupBy}', 'unknown')`;
    } else {
      throw new Error(`Invalid groupBy for individuals: ${groupBy}`);
    }

    const q = `
      SELECT ${groupExpr} AS bucket, COUNT(*)::bigint AS count
      FROM softai.individuals
      ${sql}
      GROUP BY bucket
      ORDER BY count DESC
      LIMIT 50
    `;

    const res = await pool.query(q, params);
    return res.rows.map((r) => ({
      bucket: r.bucket ?? "unknown",
      count: parseInt(r.count),
    }));
  }

  async listStoolLogs(
    filters: StoolLogsFilters
  ): Promise<Paginated<StoolLogRow>> {
    const { sql, params } = buildStoolLogsWhere(filters);
    const sortBy = "created_at";
    const sortDir = filters.sortDir === "asc" ? "ASC" : "DESC";

    const countQuery = `SELECT COUNT(*)::bigint AS c FROM softai.stool_logs ${sql}`;
    const dataQuery = `
      SELECT id, individual_id, organization_id, event_id, s3_image_key,
             bristol_type, bristol_type_confidence,
             health, color, consistency, shape, quantity,
             blood, mucus, floating,
             sleep, stress, diet, caffeine, toilet_time, frequency,
             last_meal, food_groups,
             smell_level, pain_level, duration_minutes, water_glasses,
             profile_snapshot, created_at
      FROM softai.stool_logs
      ${sql}
      ORDER BY ${sortBy} ${sortDir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const [countRes, dataRes] = await Promise.all([
      pool.query(countQuery, params),
      pool.query(dataQuery, [...params, filters.limit, filters.offset]),
    ]);

    return {
      rows: dataRes.rows as StoolLogRow[],
      total: parseInt(countRes.rows[0]?.c ?? "0"),
    };
  }

  async stoolLogsAggregate(
    groupBy: string,
    filters: StoolLogsFilters
  ): Promise<Array<{ bucket: string; count: number }>> {
    const { sql, params } = buildStoolLogsWhere(filters);

    let groupExpr: string;
    if (groupBy === "day" || groupBy === "week" || groupBy === "month") {
      groupExpr = `to_char(date_trunc('${groupBy}', created_at), 'YYYY-MM-DD')`;
    } else if (groupBy === "food_group") {
      // unnest array
      const q = `
        SELECT fg AS bucket, COUNT(*)::bigint AS count
        FROM softai.stool_logs, unnest(COALESCE(food_groups, ARRAY[]::text[])) AS fg
        ${sql}
        GROUP BY bucket
        ORDER BY count DESC
        LIMIT 50
      `;
      const res = await pool.query(q, params);
      return res.rows.map((r) => ({
        bucket: r.bucket ?? "unknown",
        count: parseInt(r.count),
      }));
    } else if (groupBy === "profile_sex") {
      groupExpr = "COALESCE(LOWER(profile_snapshot->>'sex'), 'unknown')";
    } else if (groupBy === "profile_diet") {
      groupExpr = "COALESCE(LOWER(profile_snapshot->>'diet'), 'unknown')";
    } else if (STOOL_GROUPABLE_COLS.includes(groupBy)) {
      groupExpr = `COALESCE(${groupBy}::text, 'unknown')`;
    } else {
      throw new Error(`Invalid groupBy for stool_logs: ${groupBy}`);
    }

    const isTimeBucket =
      groupBy === "day" || groupBy === "week" || groupBy === "month";
    const orderBy = isTimeBucket ? "bucket ASC" : "count DESC";
    // Time series can need up to a year of buckets; dimensional groupings
    // (sex, diet, bristol_type, etc.) should never legitimately need more
    // than ~100 buckets and the dashboard truncates anyway.
    const limit = isTimeBucket ? 365 : 100;

    const q = `
      SELECT ${groupExpr} AS bucket, COUNT(*)::bigint AS count
      FROM softai.stool_logs
      ${sql}
      GROUP BY bucket
      ORDER BY ${orderBy}
      LIMIT ${limit}
    `;

    const res = await pool.query(q, params);
    return res.rows.map((r) => ({
      bucket: r.bucket ?? "unknown",
      count: parseInt(r.count),
    }));
  }

  async stoolLogsNumericStats(
    filters: StoolLogsFilters
  ): Promise<{
    avgPain: number | null;
    avgSmell: number | null;
    avgDuration: number | null;
    avgWater: number | null;
    avgBristol: number | null;
    withBloodPct: number | null;
    withMucusPct: number | null;
    total: number;
  }> {
    const { sql, params } = buildStoolLogsWhere(filters);

    const q = `
      SELECT
        COUNT(*)::bigint AS total,
        AVG(pain_level)::numeric AS avg_pain,
        AVG(smell_level)::numeric AS avg_smell,
        AVG(duration_minutes)::numeric AS avg_duration,
        AVG(water_glasses)::numeric AS avg_water,
        AVG(NULLIF(REGEXP_REPLACE(bristol_type, '[^0-9]', '', 'g'), '')::numeric) AS avg_bristol,
        SUM(CASE WHEN blood IS NOT NULL AND blood <> 'none' THEN 1 ELSE 0 END)::numeric AS blood_cnt,
        SUM(CASE WHEN mucus IS NOT NULL AND mucus <> 'none' THEN 1 ELSE 0 END)::numeric AS mucus_cnt
      FROM softai.stool_logs
      ${sql}
    `;
    const res = await pool.query(q, params);
    const r = res.rows[0] ?? {};
    const total = parseInt(r.total ?? "0");
    const num = (v: any) => (v === null || v === undefined ? null : Number(v));

    return {
      total,
      avgPain: num(r.avg_pain),
      avgSmell: num(r.avg_smell),
      avgDuration: num(r.avg_duration),
      avgWater: num(r.avg_water),
      avgBristol: num(r.avg_bristol),
      withBloodPct: total ? Number(r.blood_cnt) / total : null,
      withMucusPct: total ? Number(r.mucus_cnt) / total : null,
    };
  }

  async listProfileKeys(
    organizationId?: number
  ): Promise<
    Array<{ key: string; occurrences: number; sampleValues: string[] }>
  > {
    const params: unknown[] = [];
    let orgFilter = "";
    if (organizationId !== undefined) {
      params.push(organizationId);
      orgFilter = `WHERE i.organization_id = $${params.length}`;
    }
    const q = `
      SELECT key,
             COUNT(*)::bigint AS occurrences,
             (ARRAY_AGG(DISTINCT value))[1:10] AS sample_values
      FROM (
        SELECT k AS key, v::text AS value
        FROM softai.individuals i,
             LATERAL jsonb_each_text(COALESCE(i.profile_data, '{}'::jsonb)) AS t(k, v)
        ${orgFilter}
      ) s
      GROUP BY key
      ORDER BY occurrences DESC
      LIMIT 40
    `;
    const res = await pool.query(q, params);
    return res.rows.map((r) => ({
      key: r.key,
      occurrences: parseInt(r.occurrences),
      sampleValues: (r.sample_values ?? []).filter(Boolean).slice(0, 10),
    }));
  }
}

export const v2AnalyticsRepository = new V2AnalyticsRepository();
