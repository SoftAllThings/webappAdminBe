export type MetricType = 'users' | 'poops' | 'aiChats' | 'journal' | 'feedComments' | 'feedPosts';


export const METRIC_CONFIG = {
    users: {
        collection: "users",
        dateField: "createdAt",
        dateType: 'ISO-String'

    },
    poops: {
        collection: "poops",
        dateField: "createdDate",
        dateType: 'ISO-String'

    },
    aiChats: {
        collection: "aiChats",
        dateField: "createdDate",
        dateType: 'TimeStamp'

    },
    journal: {
        collection: "journal",
        dateField: "createdDate",
        dateType: 'TimeStamp'

    },

    feedComments: {
        collection: "feedComments",
        dateField: "createdDate",
        dateType: "ISO-String"
    },
    feedPosts: {
        collection: "feedPosts",
        dateField: "createdDate",
        dateType: "ISO-String"
    }
    
} as const;