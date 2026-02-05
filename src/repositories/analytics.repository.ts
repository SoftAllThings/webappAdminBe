import {pool} from '../config/database'

export type AnalyticsMetric = 'dailyPosts';

export type AnaltyicsPoint = {
  date: string;
  value: number;
}


export class AnalyticsRepository {
  async getDailyPosts(from: string, to: string): Promise<AnaltyicsPoint[]> {
    const query = `SELECT
        DATE(created_at) as date,
        COUNT(*)::int as value
      FROM app.poop
      WHERE created_at >= $1 AND created_at <= $2
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at);`;

    const result = await pool.query(query, [from, to]);

    return result.rows.map(r => ({
      date: r.date.toISOString().slice(0,10),
      value: Number(r.value),
    }))

  }
}

export const analyticsRepository = new AnalyticsRepository();