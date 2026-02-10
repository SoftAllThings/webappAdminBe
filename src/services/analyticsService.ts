  import { db } from "../config/firebase";
  import { METRIC_CONFIG, MetricType } from "../config/metrics_config";
  import {Timestamp} from 'firebase-admin/firestore'

  export type AnalyticsMetric = {
    date: string;
    value: number
  };

  export type AnalyticsResult = {
    data: AnalyticsMetric[];
    average: number | null;
    total: number |null ;
    max: number | null;
    min: number | null;
  }

  export class AnalyticsService {

    async getData(metric: MetricType, from: string, to: string): Promise<AnalyticsResult> {

      
      const config = METRIC_CONFIG[metric as keyof typeof METRIC_CONFIG]


      let fromDate: any;
      let toDate: any;

      if (config.dateType === "ISO-String") {
        fromDate = new Date(from).toISOString();
        const toISODay = new Date(to)
        toISODay.setHours(23, 59, 59);
        toDate = toISODay.toISOString()
      } else {
        fromDate = Timestamp.fromDate(new Date(from));
        const toTimeStamp = new Date(to)
        toTimeStamp.setHours(23,590,59)
        toDate = Timestamp.fromDate(toTimeStamp)
      }

      if (!config) {throw new Error ('Unsupported metric')};


    
      const snapshot = await db.collection(config.collection)
        .where(config.dateField, ">=", fromDate)
        .where(config.dateField, "<=",toDate)
        .get();

      if (snapshot.empty) {
        return {
          data: [],
          total: null,
          average: null,
          max: null,
          min: null,
        }
      }

      const docs = snapshot.docs;
      const dates = docs.map(doc =>{
        const rawDate = doc.get(config.dateField);
        if (typeof rawDate === 'string') {
          return rawDate.slice(0,10);
        } else {
          return rawDate.toDate().toISOString().slice(0,10)
        }

      }
  );


  const findDatesInBetween = (from: string, to: string): string[] => {
    const datesInBetween: string[] = [];
    const additionalDate = new Date(from)

    while (additionalDate <= new Date(to)) {
      datesInBetween.push(additionalDate.toISOString().slice(0,10))
      additionalDate.setDate(additionalDate.getDate() + 1)
    }
      
    return datesInBetween;
  }

  const allDays = findDatesInBetween(from, to);

  const counts: Record<string, number> = {}
  allDays.forEach(day => {
    counts[day] = 0;
  })


  dates.forEach(date => {
    if (counts[date] !== undefined)
    {counts[date] += 1;}
  });


    const analyticsData = Object.entries(counts).map(
    ([date, value]) => ({
      date,
      value,
    })
  );
  const total = analyticsData.reduce((sum, d) => sum + d.value,0);
    const average = analyticsData.length > 0 ? total / analyticsData.length : 0;

    const max = analyticsData.reduce((max, d) => (max > d.value? max : d.value),0);

    const min = analyticsData.reduce((min, d) => (d.value>min? min : d.value), Infinity)

      return {data: analyticsData, average, total, max, min};
    }
  }

  
  export const analyticsService = new AnalyticsService();

analyticsService.getData('users', '2026-01-02', '2026-01-04')