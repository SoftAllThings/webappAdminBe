import { Router } from "express";
import { analyticsController} from "../controllers/analyticsController";


const router = Router();

// GET /api/firebase/random-user
router.get("/data", analyticsController.getAnalytics);

export default router;
