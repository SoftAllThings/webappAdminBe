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

export type EventBreakdownPoint = {
  date: string;
  value: string;
  count: number;
  uniqueUsers: number;
};

// Top-N distinct param values to keep per breakdown query — anything beyond
// rolls up into an "Other" bucket so the chart stays readable.
const BREAKDOWN_TOP_N = 10;

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

// Mirrors ANALYTICS_EVENTS in PoopCheck/src/types/analytics.types.ts.
// Keep in sync when new pc_* events are added on the client.
export const KNOWN_EVENTS = [
  // Onboarding
  "pc_ob_step_viewed",
  "pc_ob_completed",
  "pc_ob_skipped",

  // Auth
  "pc_auth_signup_started",
  "pc_auth_signup_completed",
  "pc_auth_signup_failed",
  "pc_auth_login_started",
  "pc_auth_login_completed",
  "pc_auth_login_failed",
  "pc_auth_logout",

  // Scan / Analysis
  "pc_scan_camera_opened",
  "pc_scan_photo_captured",
  "pc_scan_gallery_opened",
  "pc_scan_gallery_picked",
  "pc_scan_gallery_cancelled",
  "pc_scan_preview_resize_started",
  "pc_scan_preview_resize_failed",
  "pc_scan_preview_load_failed",
  "pc_scan_crop_opened",
  "pc_scan_crop_failed",
  "pc_scan_image_prep_started",
  "pc_scan_image_prep_crop_failed",
  "pc_scan_image_prep_compress_failed",
  "pc_scan_image_prep_fallback_raw",
  "pc_scan_image_prep_succeeded",
  "pc_scan_analyze_request_started",
  "pc_scan_analyze_first_sse",
  "pc_scan_edit_action",
  "pc_scan_questions_started",
  "pc_scan_questions_completed",
  "pc_scan_questions_abandoned",
  "pc_scan_analysis_started",
  "pc_scan_analysis_completed",
  "pc_scan_first_completed",
  "pc_scan_result_viewed",

  // Paywall / Premium
  "pc_pw_viewed",
  "pc_pw_plan_selected",
  "pc_pw_purchase_initiated",
  "pc_pw_purchase_completed",
  "pc_pw_purchase_failed",
  "pc_pw_dismissed",

  // Chat
  "pc_chat_opened",
  "pc_chat_message_sent",
  "pc_chat_history_viewed",
  "pc_chat_closed",

  // Community
  "pc_comm_feed_viewed",
  "pc_comm_post_published",
  "pc_comm_post_viewed",
  "pc_comm_post_liked",
  "pc_comm_post_unliked",
  "pc_comm_comment_added",
  "pc_comm_reply_added",
  "pc_comm_profile_viewed",
  "pc_comm_leaderboard_viewed",

  // Navigation
  "pc_nav_screen_view",

  // Notifications
  "pc_notif_permission_granted",
  "pc_notif_permission_denied",
  "pc_notif_opened",

  // Errors / Friction
  "pc_err_camera_denied",
  "pc_err_analysis_failed",

  // System / Stability
  "pc_sys_app_launch",
  "pc_sys_memory_warning",
  "pc_sys_oom_near",

  // Account / Settings
  "pc_acct_settings_opened",
  "pc_acct_lifestyle_updated",
  "pc_acct_account_updated",
  "pc_acct_widget_added",
  "pc_acct_delete_initiated",
  "pc_acct_delete_confirmed",

  // Revenue / Subscription
  "pc_rev_subscription_renewed",
  "pc_rev_subscription_cancelled",
  "pc_rev_trial_started",
  "pc_rev_trial_converted",
  "pc_sub_cancel_reminder_shown",
  "pc_sub_cancel_reminder_cta_tapped",
  "pc_sub_cancel_reminder_dismissed",

  // Sharing
  "pc_share_result_shared",
  "pc_share_referral_sent",

  // Dashboard (Profile carousel cards)
  "pc_dash_card_viewed",
  "pc_dash_card_tapped",
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

  async getEventBreakdownTimeseries(
    event: string,
    breakdownParam: string,
    { from, to }: DateRange
  ): Promise<EventBreakdownPoint[]> {
    if (!KNOWN_EVENTS.includes(event as typeof KNOWN_EVENTS[number])) {
      throw new Error(`Unknown event: ${event}`);
    }
    const key = cacheKey("timeseries_breakdown", {
      event,
      breakdownParam,
      from,
      to,
    });
    const cached = cache.get<EventBreakdownPoint[]>(key);
    if (cached) return cached;

    // Single query: extract the param value (string|int|float|double), keep the
    // top N values by total count, fold the rest into "Other", then aggregate
    // by (date, value).
    const query = `
      WITH per_value AS (
        SELECT
          event_date AS date,
          COALESCE(
            ep.value.string_value,
            CAST(ep.value.int_value AS STRING),
            CAST(ep.value.float_value AS STRING),
            CAST(ep.value.double_value AS STRING),
            '(null)'
          ) AS value,
          user_pseudo_id
        FROM ${getEventsTable()}, UNNEST(event_params) AS ep
        WHERE _TABLE_SUFFIX BETWEEN @from AND @to
          AND event_name = @event
          AND ep.key = @breakdownParam
      ),
      ranked AS (
        SELECT value, COUNT(*) AS total
        FROM per_value
        GROUP BY value
        ORDER BY total DESC
        LIMIT @topN
      ),
      normalized AS (
        SELECT
          date,
          IF(value IN (SELECT value FROM ranked), value, 'Other') AS value,
          user_pseudo_id
        FROM per_value
      )
      SELECT
        date,
        value,
        COUNT(*) AS count,
        COUNT(DISTINCT user_pseudo_id) AS unique_users
      FROM normalized
      GROUP BY date, value
      ORDER BY date, value
    `;

    const rows = await runQuery<{
      date: string;
      value: string | null;
      count: number;
      unique_users: number;
    }>(query, {
      from,
      to,
      event,
      breakdownParam,
      topN: BREAKDOWN_TOP_N,
    });

    const result: EventBreakdownPoint[] = rows.map((r) => ({
      date: formatDate(r.date),
      value: r.value ?? "(null)",
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
