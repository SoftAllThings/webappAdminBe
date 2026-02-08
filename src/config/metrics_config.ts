export type MetricType = 'users' | 'poops'


export const METRIC_CONFIG = {
    users: {
        collection: "users",
        dateField: "createdAt"
    },
    poops: {
        collection: "poops",
        dateField: "createdDate"
    },
} as const;