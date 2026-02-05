import { Request, Response } from "express";
import { analyticsService } from "../services/analyticsService";

export class AnalyticsController {
  async getAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const metric = req.query.metric as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      // Validazioni super semplici (per ora)
      if (!metric || !from || !to) {
        res.status(400).json({
          success: false,
          error: { message: "Missing query params: metric, from, to" },
        });
        return;
      }

      if (metric !== "dailyPosts") {
        res.status(400).json({
          success: false,
          error: { message: "Only metric supported for now: dailyPosts" },
        });
        return;
      }

      const result = await analyticsService.getDailyPosts(from, to);

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
