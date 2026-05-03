/**
 * Insights service — read briefs/daily-notes from Firestore, write feedback.
 *
 * Briefs are written by the insights-writer agent (running on Anthropic
 * Managed Agents) into the poopcheck-insights MCP server. Storage shape:
 *   - briefs/{period}/items/{date}    // weekly + monthly meeting briefs
 *   - daily_notes/{date}              // analyst pre-work, internal-only
 *   - section_feedback/{auto-id}      // 👍 / 👎 / wrong from the dashboard
 *
 * All Firestore Timestamps are serialized to ISO strings before returning.
 */

import {Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";

type Period = "daily" | "weekly" | "monthly";

function tsToIso(t: unknown): string | null {
  if (t instanceof Timestamp) return t.toDate().toISOString();
  if (typeof t === "string") return t;
  return null;
}

/** Recursively replace Firestore Timestamps in a Brief/DailyNote with ISO strings. */
function serializeDoc<T = unknown>(value: T): T {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => serializeDoc(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeDoc(v);
    }
    return out as unknown as T;
  }
  return value;
}

export const insightsService = {
  /**
   * List recent briefs of a period. Returns shells (date + headlines + open
   * threads) — not the full body. Use getBrief to fetch one in full.
   */
  async listBriefs(period: Period, limit = 12) {
    const snap = await db
      .collection("briefs")
      .doc(period)
      .collection("items")
      .orderBy("date", "desc")
      .limit(limit)
      .get();

    return snap.docs.map((doc) => {
      const d = doc.data() as {
        date?: string;
        period?: string;
        generatedAt?: Timestamp;
        modelRunId?: string;
        sections?: Array<{id: string; headline: string; status: string}>;
        openThreads?: unknown[];
      };
      const tldr = d.sections?.find((s) => s.id === "tldr");
      return {
        date: d.date ?? doc.id,
        period: d.period ?? period,
        generatedAt: tsToIso(d.generatedAt),
        modelRunId: d.modelRunId ?? null,
        tldrHeadline: tldr?.headline ?? null,
        sectionStatuses: (d.sections ?? []).map((s) => ({id: s.id, status: s.status})),
        openThreadCount: d.openThreads?.length ?? 0,
      };
    });
  },

  /** Fetch one full brief or null if missing. */
  async getBrief(period: Period, date: string) {
    const doc = await db
      .collection("briefs")
      .doc(period)
      .collection("items")
      .doc(date)
      .get();
    if (!doc.exists) return null;
    return serializeDoc(doc.data());
  },

  /** Recent daily analyst notes, newest first. */
  async listDailyNotes(limit = 14) {
    const snap = await db
      .collection("daily_notes")
      .orderBy("date", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((doc) => serializeDoc(doc.data()));
  },

  /** Write a feedback entry. Returns the new doc id. */
  async writeFeedback(input: {
    briefDate: string;
    briefPeriod: Period;
    sectionId: string;
    verdict: "useful" | "noise" | "wrong";
    note?: string;
  }) {
    const docRef = await db.collection("section_feedback").add({
      briefDate: input.briefDate,
      briefPeriod: input.briefPeriod,
      sectionId: input.sectionId,
      verdict: input.verdict,
      ...(input.note ? {note: input.note} : {}),
      submittedAt: Timestamp.now(),
    });
    return {id: docRef.id};
  },
};
