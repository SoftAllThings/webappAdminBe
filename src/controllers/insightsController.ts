import {Request, Response} from "express";
import {insightsService} from "../services/insightsService";

const PERIOD_VALUES = new Set(["daily", "weekly", "monthly"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VERDICT_VALUES = new Set(["useful", "noise", "wrong"]);

function parsePeriod(value: unknown): "daily" | "weekly" | "monthly" | null {
  if (typeof value !== "string") return null;
  return PERIOD_VALUES.has(value)
    ? (value as "daily" | "weekly" | "monthly")
    : null;
}

function parseLimit(value: unknown, defaultValue: number, max: number): number {
  if (typeof value !== "string") return defaultValue;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return defaultValue;
  return Math.min(n, max);
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({success: false, error: {message}});
}

export const insightsController = {
  async listBriefs(req: Request, res: Response): Promise<void> {
    try {
      const period = parsePeriod(req.params.period);
      if (!period) {
        sendError(res, 400, "period must be daily, weekly, or monthly");
        return;
      }
      const limit = parseLimit(req.query.limit, 12, 60);
      const briefs = await insightsService.listBriefs(period, limit);
      res.json({success: true, data: briefs});
    } catch (err) {
      console.error("insights/listBriefs error:", err);
      sendError(res, 500, "Failed to list briefs");
    }
  },

  async getBrief(req: Request, res: Response): Promise<void> {
    try {
      const period = parsePeriod(req.params.period);
      const date = req.params.date;
      if (!period) {
        sendError(res, 400, "period must be daily, weekly, or monthly");
        return;
      }
      if (!date || !DATE_RE.test(date)) {
        sendError(res, 400, "date must be YYYY-MM-DD");
        return;
      }
      const brief = await insightsService.getBrief(period, date);
      if (!brief) {
        sendError(res, 404, `No ${period} brief for ${date}`);
        return;
      }
      res.json({success: true, data: brief});
    } catch (err) {
      console.error("insights/getBrief error:", err);
      sendError(res, 500, "Failed to fetch brief");
    }
  },

  async listDailyNotes(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseLimit(req.query.limit, 14, 60);
      const notes = await insightsService.listDailyNotes(limit);
      res.json({success: true, data: notes});
    } catch (err) {
      console.error("insights/listDailyNotes error:", err);
      sendError(res, 500, "Failed to list daily notes");
    }
  },

  async submitFeedback(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as {
        briefDate?: string;
        briefPeriod?: string;
        sectionId?: string;
        verdict?: string;
        note?: string;
      };
      const period = parsePeriod(body.briefPeriod);
      if (!period) {
        sendError(res, 400, "briefPeriod must be daily, weekly, or monthly");
        return;
      }
      if (!DATE_RE.test(body.briefDate ?? "")) {
        sendError(res, 400, "briefDate must be YYYY-MM-DD");
        return;
      }
      if (!body.sectionId || typeof body.sectionId !== "string") {
        sendError(res, 400, "sectionId is required");
        return;
      }
      if (!body.verdict || !VERDICT_VALUES.has(body.verdict)) {
        sendError(res, 400, "verdict must be useful, noise, or wrong");
        return;
      }
      const result = await insightsService.writeFeedback({
        briefDate: body.briefDate!,
        briefPeriod: period,
        sectionId: body.sectionId,
        verdict: body.verdict as "useful" | "noise" | "wrong",
        ...(typeof body.note === "string" && body.note.length <= 600
          ? {note: body.note}
          : {}),
      });
      res.status(201).json({success: true, data: result});
    } catch (err) {
      console.error("insights/submitFeedback error:", err);
      sendError(res, 500, "Failed to submit feedback");
    }
  },
};
