import { Router } from "express";
import { analyticsController} from "../controllers/analyticsController";
import { authenticateToken } from "../controllers/authController";
import { userExportController } from "../controllers/userExportController";


const router = Router();

router.get("/unique-users", analyticsController.getUniqueUsers.bind(analyticsController));
router.get(
  "/users-with-email",
  analyticsController.getUsersWithEmail.bind(analyticsController)
);
router.get("/data", analyticsController.getAnalytics);
router.post(
  "/users/export-csv",
  authenticateToken,
  userExportController.exportUsersCsv.bind(userExportController)
);

export default router;
