import {Router} from 'express';
import { analyticsController } from '../controllers/analyticsController';

const router = Router();

// GET /api/analytics?metric=dailyPosts&from=2026-02-01&to=2026-02-10
router.get("/", analyticsController.getAnalytics);

export default router;