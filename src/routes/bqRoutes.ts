import { Router } from "express";
import { bqAnalyticsController } from "../controllers/bqAnalyticsController";

const router = Router();

router.get("/kpis", bqAnalyticsController.getKpis);
router.get("/events/timeseries", bqAnalyticsController.getEventTimeseries);
router.get("/events/list", bqAnalyticsController.getEventList);
router.get("/funnel", bqAnalyticsController.getFunnel);
router.get("/errors", bqAnalyticsController.getErrors);

export default router;
