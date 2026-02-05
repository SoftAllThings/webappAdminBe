import { analyticsRepository } from "../repositories/analytics.repository";

export class AnalyticsService {
  async getDailyPosts(from: string, to: string) {
    const data = await analyticsRepository.getDailyPosts(from, to);
    const total = data.reduce((sum, p)=> sum + p.value, 0);

    return {
      metric: "dailyPosts" as const,
      from,
      to,
      total,
      data
    }
  }
}

export const analyticsService = new AnalyticsService()