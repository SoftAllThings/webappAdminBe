  import { db } from "../config/firebase";
  import { METRIC_CONFIG, MetricType } from "../config/metrics_config";
  import { Timestamp } from "firebase-admin/firestore";

  export type AnalyticsMetric = {
    date: string;
    value: number
  };

  export type AnalyticsResult = {
    data: AnalyticsMetric[];
    average: number;
    total: number;
  }

  export class AnalyticsService {

    async getData(metric: MetricType, from: string, to: string): Promise<AnalyticsResult> {

      
      const config = METRIC_CONFIG[metric as keyof typeof METRIC_CONFIG]

      const fromISO = new Date(from).toISOString();
      const toDate = new Date(to)
      toDate.setHours(23, 59, 59);
      const toISO = toDate.toISOString()


      if (!config) {throw new Error ('Unsupported metric')};


    
      const snapshot = await db.collection(config.collection)
        .where(config.dateField, ">=", fromISO)
        .where(config.dateField, "<=",toISO)
        .get();

      if (snapshot.empty) {
        throw new Error("No users found in Firestore");
      }

      const docs = snapshot.docs;
      const dates = docs.map(doc =>
    doc.get(config.dateField).slice(0, 10)
  );

    const counts: Record<string, number> = {};

  dates.forEach(date => {
    counts[date] = (counts[date] || 0) + 1;
  });


    const analyticsData = Object.entries(counts).map(
    ([date, value]) => ({
      date,
      value,
    })
  );
  const total = analyticsData.reduce((sum, d) => sum + d.value,0);
    const average = analyticsData.length > 0 ? total / analyticsData.length : 0
      return {data: analyticsData, average, total};
    }
  }

  
  export const analyticsService = new AnalyticsService();

