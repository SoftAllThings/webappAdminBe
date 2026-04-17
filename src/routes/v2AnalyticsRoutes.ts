import { Router } from "express";
import { v2AnalyticsController } from "../controllers/v2AnalyticsController";

const router = Router();

router.get(
  "/overview",
  v2AnalyticsController.getOverview.bind(v2AnalyticsController)
);

router.get(
  "/individuals",
  v2AnalyticsController.listIndividuals.bind(v2AnalyticsController)
);
router.get(
  "/individuals/aggregates",
  v2AnalyticsController.individualsAggregate.bind(v2AnalyticsController)
);
router.get(
  "/individuals/profile-keys",
  v2AnalyticsController.listProfileKeys.bind(v2AnalyticsController)
);

router.get(
  "/stool-logs",
  v2AnalyticsController.listStoolLogs.bind(v2AnalyticsController)
);
router.get(
  "/stool-logs/aggregates",
  v2AnalyticsController.stoolLogsAggregate.bind(v2AnalyticsController)
);
router.get(
  "/stool-logs/stats",
  v2AnalyticsController.stoolLogsNumericStats.bind(v2AnalyticsController)
);

export default router;
