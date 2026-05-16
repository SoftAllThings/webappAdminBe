import { Router } from "express";
import { modelComparisonController } from "../controllers/modelComparisonController";

const router = Router();

router.post("/compare", modelComparisonController.compare);

export default router;
