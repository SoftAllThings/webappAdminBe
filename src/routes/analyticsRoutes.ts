import { Router } from "express";
import { analyticsController} from "../controllers/analyticsController";


const router = Router();

router.get("/unique-users", analyticsController.getUniqueUsers.bind(analyticsController));
router.get("/data", analyticsController.getAnalytics);

export default router;
