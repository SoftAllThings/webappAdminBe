import { Request, Response } from "express";
import { analyticsService } from "../services/analyticsService";
import { MetricType } from "../config/metrics_config";
export class AnalyticsController {
  async getUniqueUsers(_req: Request, res: Response): Promise<void> {
    try {
      const count = await analyticsService.getTotalUsersCount();
      res.status(200).json({ success: true, count });
    } catch (error) {
      console.error("Error in getUniqueUsers:", error);
      res.status(500).json({ success: false, error: { message: "Failed to fetch unique users count" } });
    }
  }

  async getAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const metric = req.query.metric as MetricType | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      // Validazioni super semplici (per ora)
      if (!metric || !from || !to ) {
        res.status(400).json({
          success: false,
          error: { message: "Missing query params: metric, from, to" },
        });
        return;
      }

     

      const result = await analyticsService.getData(metric, from, to);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error in getAnalytics:", error);
      res.status(500).json({
        success: false,
        error: { message: "Failed to fetch analytics" },
      });
    }
  }
}

export const analyticsController = new AnalyticsController();
