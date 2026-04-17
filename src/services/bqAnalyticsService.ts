import NodeCache from "node-cache";
import { getBq, getEventsTable } from "../config/bigquery";

const cache = new NodeCache({ stdTTL: 600 });

export type DateRange = { from: string; to: string };

export type Kpis = {
  dau: number;
  signups: number;
  scansCompleted: number;
  ahaUsers: number;
  purchases: number;
};

export type EventSeriesPoint = {
  date: string;
  count: number;
  uniqueUsers: number;
};

export type FunnelType = "signup" | "scan" | "paywall";

export type FunnelStep = {
  step: string;
  users: number;
  dropOffPct: number;
};

export type ErrorRow = {
  event_name: string;
  count: number;
  uniqueUsers: number;
};

export const KNOWN_EVENTS = [
  "pc_auth_signup_started",
  "pc_auth_signup_completed",
  "pc_auth_signup_failed",
  "pc_auth_login_completed",
  "pc_scan_camera_opened",
  "pc_scan_photo_captured",
  "pc_scan_questions_started",
  "pc_scan_questions_completed",
  "pc_scan_analysis_started",
  "pc_scan_analysis_completed",
  "pc_scan_first_completed",
  "pc_scan_result_viewed",
  "pc_pw_viewed",
  "pc_pw_plan_selected",
  "pc_pw_purchase_initiated",
  "pc_pw_purchase_completed",
  "pc_pw_purchase_failed",
  "pc_chat_opened",
  "pc_chat_message_sent",
  "pc_comm_post_published",
  "pc_comm_post_viewed",
  "pc_comm_post_liked",
  "pc_notif_permission_granted",
  "pc_notif_opened",
  "pc_err_camera_denied",
  "pc_err_analysis_failed",
] as const;

const FUNNEL_STEPS: Record<FunnelType, { step: string; event: string }[]> = {
  signup: [
    { step: "Onboarding completed", event: "pc_ob_completed" },
    { step: "Signup started", event: "pc_auth_signup_started" },
    { step: "Signup completed", event: "pc_auth_signup_completed" },
  ],
  scan: [
    { step: "Camera opened", event: "pc_scan_camera_opened" },
    { step: "Photo captured", event: "pc_scan_photo_captured" },
    { step: "Questions completed", event: "pc_scan_questions_completed" },
    { step: "Analysis completed", event: "pc_scan_analysis_completed" },
  ],
  paywall: [
    { step: "Paywall viewed", event: "pc_pw_viewed" },
    { step: "Plan selected", event: "pc_pw_plan_selected" },
    { step: "Purchase initiated", event: "pc_pw_purchase_initiated" },
    { step: "Purchase completed", event: "pc_pw_purchase_completed" },
  ],
};

function cacheKey(name: string, params: Record<string, string>): string {
  return `${name}:${Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")}`;
}

async function runQuery<T>(
  query: string,
  params: Record<string, unknown>
): Promise<T[]> {
  const [rows] = await getBq().query({
    query,
    params,
    useLegacySql: false,
  });
  return rows as T[];
}

export const bqAnalyticsService = {
  async getKpis({ from, to }: DateRange): Promise<Kpis> {
    const key = cacheKey("kpis", { from, to });
    const cached = cache.get<Kpis>(key);
    if (cached) return cached;

    const query = `
      SELECT
        COUNT(DISTINCT user_pseudo_id) AS dau,
        COUNT(DISTINCT IF(event_name = 'pc_auth_signup_completed', user_pseudo_id, NULL)) AS signups,
        COUNTIF(event_name = 'pc_scan_analysis_completed') AS scans_completed,
        COUNT(DISTINCT IF(event_name = 'pc_scan_first_completed', user_pseudo_id, NULL)) AS aha_users,
        COUNTIF(event_name = 'pc_pw_purchase_completed') AS purchases
      FROM ${getEventsTable()}
      WHERE _TABLE_SUFFIX BETWEEN @from AND @to
    `;

    const rows = await runQuery<{
      dau: number;
      signups: number;
      scans_completed: number;
      aha_users: number;
      purchases: number;
    }>(query, { from, to });

    const row = rows[0] ?? {
      dau: 0,
      signups: 0,
      scans_completed: 0,
      aha_users: 0,
      purchases: 0,
    };

    const result: Kpis = {
      dau: Number(row.dau),
      signups: Number(row.signups),
      scansCompleted: Number(row.scans_completed),
      ahaUsers: Number(row.aha_users),
      purchases: Number(row.purchases),
    };
    cache.set(key, result);
    return result;
  },

  async getEventTimeseries(
    event: string,
    { from, to }: DateRange
  ): Promise<EventSeriesPoint[]> {
    if (!KNOWN_EVENTS.includes(event as typeof KNOWN_EVENTS[number])) {
      throw new Error(`Unknown event: ${event}`);
    }
    const key = cacheKey("timeseries", { event, from, to });
    const cached = cache.get<EventSeriesPoint[]>(key);
    if (cached) return cached;

    const query = `
      SELECT
        event_date AS date,
        COUNT(*) AS count,
        COUNT(DISTINCT user_pseudo_id) AS unique_users
      FROM ${getEventsTable()}
      WHERE _TABLE_SUFFIX BETWEEN @from AND @to
        AND event_name = @event
      GROUP BY event_date
      ORDER BY event_date
    `;

    const rows = await runQuery<{
      date: string;
      count: number;
      unique_users: number;
    }>(query, { from, to, event });

    const result = rows.map((r) => ({
      date: formatDate(r.date),
      count: Number(r.count),
      uniqueUsers: Number(r.unique_users),
    }));
    cache.set(key, result);
    return result;
  },

  async getFunnel(
    type: FunnelType,
    { from, to }: DateRange
  ): Promise<FunnelStep[]> {
    const key = cacheKey("funnel", { type, from, to });
    const cached = cache.get<FunnelStep[]>(key);
    if (cached) return cached;

    const steps = FUNNEL_STEPS[type];
    const selects = steps
      .map(
        (s, i) =>
          `COUNT(DISTINCT IF(event_name = '${s.event}', user_pseudo_id, NULL)) AS step_${i}`
      )
      .join(",\n        ");

    const query = `
      SELECT ${selects}
      FROM ${getEventsTable()}
      WHERE _TABLE_SUFFIX BETWEEN @from AND @to
        AND event_name IN UNNEST(@events)
    `;

    const rows = await runQuery<Record<string, number>>(query, {
      from,
      to,
      events: steps.map((s) => s.event),
    });

    const row = rows[0] ?? {};
    const result: FunnelStep[] = steps.map((s, i) => {
      const users = Number(row[`step_${i}`] ?? 0);
      const prev = i === 0 ? users : Number(row[`step_${i - 1}`] ?? 0);
      const dropOffPct = prev > 0 ? ((prev - users) / prev) * 100 : 0;
      return {
        step: s.step,
        users,
        dropOffPct: i === 0 ? 0 : Number(dropOffPct.toFixed(1)),
      };
    });
    cache.set(key, result);
    return result;
  },

  async getErrors({ from, to }: DateRange): Promise<ErrorRow[]> {
    const key = cacheKey("errors", { from, to });
    const cached = cache.get<ErrorRow[]>(key);
    if (cached) return cached;

    const query = `
      SELECT
        event_name,
        COUNT(*) AS count,
        COUNT(DISTINCT user_pseudo_id) AS unique_users
      FROM ${getEventsTable()}
      WHERE _TABLE_SUFFIX BETWEEN @from AND @to
        AND STARTS_WITH(event_name, 'pc_err_')
      GROUP BY event_name
      ORDER BY count DESC
    `;

    const rows = await runQuery<{
      event_name: string;
      count: number;
      unique_users: number;
    }>(query, { from, to });

    const result = rows.map((r) => ({
      event_name: r.event_name,
      count: Number(r.count),
      uniqueUsers: Number(r.unique_users),
    }));
    cache.set(key, result);
    return result;
  },
};

function formatDate(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
