import { Request, Response } from "express";
import {
  bqAnalyticsService,
  FunnelType,
  KNOWN_EVENTS,
} from "../services/bqAnalyticsService";

const DATE_RE = /^\d{8}$/;

function parseDateRange(req: Request): { from: string; to: string } | null {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) return null;
  if (from > to) return null;
  return { from, to };
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: { message } });
}

export const bqAnalyticsController = {
  async getKpis(req: Request, res: Response): Promise<void> {
    try {
      const range = parseDateRange(req);
      if (!range) {
        sendError(res, 400, "from and to are required as YYYYMMDD with from<=to");
        return;
      }
      const data = await bqAnalyticsService.getKpis(range);
      res.json({ success: true, data });
    } catch (err) {
      console.error("bq/kpis error:", err);
      sendError(res, 500, "Failed to fetch KPIs");
    }
  },

  async getEventTimeseries(req: Request, res: Response): Promise<void> {
    try {
      const range = parseDateRange(req);
      if (!range) {
        sendError(res, 400, "from and to are required as YYYYMMDD with from<=to");
        return;
      }
      const event = req.query.event as string | undefined;
      if (!event || !KNOWN_EVENTS.includes(event as typeof KNOWN_EVENTS[number])) {
        sendError(res, 400, "event param missing or not in whitelist");
        return;
      }
      const data = await bqAnalyticsService.getEventTimeseries(event, range);
      res.json({ success: true, data });
    } catch (err) {
      console.error("bq/events/timeseries error:", err);
      sendError(res, 500, "Failed to fetch event time-series");
    }
  },

  async getFunnel(req: Request, res: Response): Promise<void> {
    try {
      const range = parseDateRange(req);
      if (!range) {
        sendError(res, 400, "from and to are required as YYYYMMDD with from<=to");
        return;
      }
      const type = req.query.type as FunnelType | undefined;
      if (!type || !["signup", "scan", "paywall"].includes(type)) {
        sendError(res, 400, "type must be one of: signup | scan | paywall");
        return;
      }
      const data = await bqAnalyticsService.getFunnel(type, range);
      res.json({ success: true, data });
    } catch (err) {
      console.error("bq/funnel error:", err);
      sendError(res, 500, "Failed to fetch funnel");
    }
  },

  async getErrors(req: Request, res: Response): Promise<void> {
    try {
      const range = parseDateRange(req);
      if (!range) {
        sendError(res, 400, "from and to are required as YYYYMMDD with from<=to");
        return;
      }
      const data = await bqAnalyticsService.getErrors(range);
      res.json({ success: true, data });
    } catch (err) {
      console.error("bq/errors error:", err);
      sendError(res, 500, "Failed to fetch errors");
    }
  },

  getEventList(_req: Request, res: Response): void {
    res.json({ success: true, data: KNOWN_EVENTS });
  },
};
